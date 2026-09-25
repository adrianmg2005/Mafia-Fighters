// LUCHADOR DE PLATFORM FIGHTER: máquina de estados completa, por ticks.
//
// Toda la lógica compartida del roster vive aquí; lo que diferencia a un
// personaje son DATOS (`stats` + `moveTable`, ver characters/samuel.js). No
// hay ni un `if (personaje === ...)` en este archivo, y no puede haberlo: un
// movimiento con comportamiento especial se expresa como un campo de su
// entrada (charge, armor, counter, helplessAtApex, spawn...) y se interpreta
// aquí de forma genérica.
//
// UNIDADES: frames y px/frame, sin `dt` (ver engine/physics.js). `update()` es
// exactamente un frame de simulación.
//
// El luchador NO resuelve golpes ni blast zones: eso es de la simulación
// (engine/simulation.js), que ve a los dos a la vez. Aquí se decide qué hace
// cada uno con su input y qué le pasa cuando le dan (`receiveHit`).

import { movePhase } from '../engine/movePhase.js';
import {
  moveBody, applyGravity, applyFriction, approach, findLedge, ledgeHangPosition,
  LEDGE_INVULN_FRAMES, LEDGE_REGRAB_COOLDOWN, AIR_FRICTION,
  LEDGE_TRUMP_VX, LEDGE_TRUMP_VY, LEDGE_TRUMP_FRAMES,
  GRAVITY, FAST_FALL_MULTIPLIER, GROUND_JUMP_VELOCITY, SHORT_HOP_VELOCITY,
  DOUBLE_JUMP_VELOCITY, JUMP_SQUAT_FRAMES,
} from '../engine/physics.js';
import {
  computeLaunch, decayKnockback, buryFrames, shieldstunFrames, launchDirection,
  calculateKnockback, knockbackVelocity, hitstunFrames, isTumble, applyDI, cancelLaunch, jumpOutOfLaunch,
} from '../engine/combat.js';
import {
  InputTracker, resolveAttack, relativeDirection, createEmptyInputState,
} from '../engine/inputManager.js';

// Celda del sprite (el cuerpo golpeable es más pequeño: stats.hurtbox*).
export const FIGHTER_WIDTH = 80;
export const FIGHTER_HEIGHT = 120;

export const STARTING_STOCKS = 3;
export const RESPAWN_DELAY_FRAMES = 90;
export const RESPAWN_INVULN_FRAMES = 120;

export const STATES = Object.freeze({
  IDLE: 'idle',
  WALK: 'walk',
  DASH: 'dash',
  RUN: 'run',
  CROUCH: 'crouch',
  JUMPSQUAT: 'jumpsquat',
  AIR: 'air',
  LANDING: 'landing',
  ACTION: 'action', // cualquier movimiento de la moveTable, en suelo o en el aire
  CHARGE: 'charge', // cargando el especial neutro
  SHIELD: 'shield',
  SHIELDSTUN: 'shieldstun',
  SHIELD_DROP: 'shield_drop',
  SHIELD_BREAK: 'shield_break',
  DIZZY: 'dizzy',
  HITSTUN: 'hitstun',
  TUMBLE: 'tumble',
  KNOCKDOWN: 'knockdown',
  HELPLESS: 'helpless',
  LEDGE_HANG: 'ledge_hang',
  TRUMPED: 'trumped', // le han robado el borde: expulsado, sin actuar ni intangibilidad
  GRABBING: 'grabbing',
  GRABBED: 'grabbed',
  BURIED: 'buried',
  CINEMATIC: 'cinematic',
  DEAD: 'dead',
  RESPAWN: 'respawn',
  ELIMINATED: 'eliminated',
});

const S = STATES;

// Estados en los que el luchador está en el suelo sin comprometerse a nada:
// desde aquí se puede atacar, saltar, escudarse o moverse.
const GROUND_NEUTRAL = new Set([S.IDLE, S.WALK, S.DASH, S.RUN, S.CROUCH]);
// Nadie puede golpear a un luchador en estos estados.
const UNTOUCHABLE = new Set([S.DEAD, S.ELIMINATED, S.RESPAWN, S.CINEMATIC, S.GRABBED]);

// Lo que hereda un personaje que no declare un stat. Los de salto y caída son
// las constantes GLOBALES del diseño (engine/physics.js), no una copia: un
// número repetido a mano aquí dejaba la constante global sin efecto.
const DEFAULT_STATS = {
  weight: 100,
  walkSpeed: 2.4,
  dashSpeed: 5.2, // velocidad de CARRERA, tras el dash inicial
  initialDashSpeed: 6.0,
  initialDashFrames: 4,
  maxAirSpeed: 3.6,
  airAcceleration: 0.55,
  gravity: GRAVITY,
  maxFallSpeed: 11,
  groundJumpVelocity: GROUND_JUMP_VELOCITY,
  shortHopVelocity: SHORT_HOP_VELOCITY,
  doubleJumpVelocity: DOUBLE_JUMP_VELOCITY,
  jumpSquatFrames: JUMP_SQUAT_FRAMES,
  hurtboxWidth: 52,
  hurtboxHeight: 108,
  shieldMax: 50,
  finalMeterMax: 100,
  airJumps: 1, // saltos en el aire (el Modo Despertado de Samuel tiene 3)
  // Heavy Armor PASIVA: golpes de MENOS de este daño no lanzan ni aturden (el
  // % entra). 0 = sin armadura pasiva.
  passiveArmor: 0,
};

// --- Tiempos del sistema (no de un personaje) ------------------------------
const WALK_ACCEL = 0.4; // px/f² hasta la velocidad de andar
// Tras un dash, volver a pulsar una dirección en estos frames arranca otro
// dash con UN solo toque: es lo que hace posible el dash dance en teclado,
// donde exigir doble toque en cada cambio de sentido lo mataba.
const DASH_DANCE_WINDOW = 8;
const LANDING_LAG = 3;
// Aéreo que toca suelo DESPUÉS de sus frames activos: autocancel.
const AUTOCANCEL_LANDING_LAG = 4;
const HELPLESS_LANDING_LAG = 14;
const DEFAULT_AERIAL_LANDING_LAG = 6;
const SHIELD_DEPLETE = 0.14; // escudo mantenido
const SHIELD_REGEN = 0.07;
const SHIELD_DROP_FRAMES = 7;
const SHIELD_BREAK_POP = -9; // salta por los aires al romperse
const SHIELD_BREAK_DIZZY = 240;
const SHIELD_RESET = 30; // vida del escudo tras recuperarse de la rotura
const LEDGE_ACTION_DELAY = 4; // frames colgado antes de aceptar input
const LEDGE_MAX_HANG = 300; // 5 s colgado: se suelta solo
const KNOCKDOWN_MIN = 20; // tumbado: mínimo antes de poder levantarse
const KNOCKDOWN_MAX = 100; // se levanta solo
export const TECH_WINDOW = 10; // escudo en los 10 frames previos al impacto
// Anti-machaque del tech: una pulsación de escudo solo cuenta si la anterior
// fue hace más de esto. Sin ello, machacar el escudo sin mirar daría techs
// garantizados y la ventana de 10 frames no significaría nada.
const TECH_LOCKOUT = 40;
export const AIR_DODGE_SPEED = 6.5;
export const AIR_DODGE_TRAVEL = 18; // frames de desplazamiento sin gravedad
const GRAB_BASE_FRAMES = 90;
const GRAB_MASH = 3; // frames que resta al agarre cada pulsación del agarrado
const DEFAULT_SPECIAL_AIR_CONTROL = 0.3;

const NEUTRAL_INPUT = createEmptyInputState();
// Umbrales de la estela de lanzamiento, en unidades de knockback.
const TRAIL_KB = 38;
const TRAIL_TINT_KB = 60;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class Fighter {
  /**
   * @param {object} opts
   * @param {'p1'|'p2'} opts.slot
   * @param {object} opts.config  entrada del roster (ver samuel.js)
   */
  constructor({ slot, config }) {
    this.slot = slot;
    this.input = new InputTracker();
    this.setCharacter(config);
    this.resetForMatch({
      x: 0, y: 0, facing: 1, surfaceId: null,
    });
  }

  setCharacter(config) {
    this.id = config.id;
    this.name = config.name;
    this.color = config.color;
    this.art = config.art;
    this.baseStats = { ...DEFAULT_STATS, ...(config.stats || {}) };
    this.baseMoves = config.moveTable;
    // MODO DESPERTADO: otros stats y otra tabla mientras dure (`awakened` en
    // la config). Sin ella, despertar solo cambia el aspecto.
    this.awakenedStats = { ...this.baseStats, ...(config.awakened?.stats || {}) };
    this.awakenedMoves = config.awakened?.moveTable ?? config.moveTable;
    this.halfWidth = this.baseStats.hurtboxWidth / 2;
    this.height = this.baseStats.hurtboxHeight;
  }

  /** Stats en vigor: los del Modo Despertado mientras dure. */
  get stats() {
    return this.awakenFrames > 0 ? this.awakenedStats : this.baseStats;
  }

  /** Tabla de movimientos en vigor: la despertada SUSTITUYE a la normal. */
  get moves() {
    return this.awakenFrames > 0 ? this.awakenedMoves : this.baseMoves;
  }

  /** Velocidad de movimiento `name` con la ralentización que le toque (nube). */
  speed(name) {
    return this.stats[name] * this.slowFactor;
  }

  // --- Ciclo de vida ----------------------------------------------------------

  resetForMatch(spawn) {
    this.stocks = STARTING_STOCKS;
    this.meter = 0;
    this.matchStats = { kos: 0, falls: 0, damageDealt: 0 };
    this.placeAt(spawn);
  }

  /** Coloca al luchador de pie en un punto y le limpia TODO el estado de combate. */
  placeAt({
    x, y, facing = 1, surfaceId = null,
  }) {
    this.x = x;
    this.y = y;
    this.facing = facing;
    this.vx = 0;
    this.vy = 0;
    this.kbx = 0;
    this.kby = 0;
    this.grounded = surfaceId !== null;
    this.surfaceId = surfaceId;
    this.percent = 0;
    this.state = S.IDLE;
    this.stateFrame = 0;
    this.clearCombatState();
    this.shieldHp = this.stats.shieldMax;
    this.storedChargeFrames = 0;
    this.input.reset();
  }

  // Todo lo que pertenece al golpe/estado en curso. Si algo de esto
  // sobreviviera a un respawn o a una revancha, el primer golpe de la vida
  // nueva saldría con la carga, el agarre o el hitstun de la anterior: un bug
  // silencioso que no rompe nada visible.
  clearCombatState() {
    // Morir o reiniciar quita el Despertar.
    this.awakenFrames = 0;
    // Ralentización de una nube del rival (la pone la simulación cada frame).
    this.slowFactor = 1;
    this.driftStopped = false;
    this.freeFinalUsed = false;
    this.slamPhase = null;
    this.slamHang = 0;
    this.move = null;
    this.moveId = null;
    this.moveInstance = 0;
    this.moveFrame = 0;
    this.hitGroups = new Set();
    this.charging = false;
    this.chargeFrames = 0;
    this.chargeButton = null;
    this.queuedNext = false;
    this.loops = 0;
    this.driftSign = 1;
    this.turnAtEnd = false;
    this.counterDamage = 0;
    this.airDodgeDir = null;
    this.ledgePathFrom = null;
    this.ledgePathTo = null;
    this.jumpReleased = false;
    this.lastDashFrame = -Infinity;
    this.helplessDrift = 0.5;
    this.hitstun = 0;
    this.tumble = false;
    this.lagFrames = 0;
    this.jumpsLeft = this.stats.airJumps;
    this.airDodgeUsed = false;
    this.fastFalling = false;
    this.helpless = false;
    this.intangibleFrames = 0;
    this.hitFlash = 0;
    this.armorFlash = 0;
    this.ledge = null;
    this.ledgeCooldown = 0;
    this.dropThroughFrames = 0;
    this.holding = null;
    this.heldBy = null;
    this.grabTimer = 0;
    this.buryTimer = 0;
    this.respawnTimer = 0;
    this.respawnFrames = 0;
    this.cinePose = null;
    this.cineProgress = -1;
    this.pendingDI = false;
    this.launchKb = 0;
    this.launchBy = null;
    this.ledgeGrabT = 0;
    this.lastShieldPress = -Infinity;
    this.techPressFrame = -Infinity;
  }

  // --- Consultas ---------------------------------------------------------------

  get isAlive() {
    return this.state !== S.DEAD && this.state !== S.ELIMINATED;
  }

  /** Ventana de un movimiento [from, to] activa en el frame actual. */
  inWindow(win) {
    return !!win && this.moveFrame >= win.from && this.moveFrame <= win.to;
  }

  isIntangible() {
    if (this.intangibleFrames > 0) return true;
    if (this.state === S.RESPAWN) return true;
    // Un movimiento que ARRANCA en este tick todavía está en su frame 0 (el
    // contador sube al principio del tick siguiente), pero los golpes del
    // tick se resuelven ya. Sin contar ese frame como el 1, toda esquiva, tech
    // y opción de borde tenía un frame vulnerable justo al empezar.
    const win = this.state === S.ACTION ? this.move?.intangible : null;
    if (win && Math.max(1, this.moveFrame) >= win.from && this.moveFrame <= win.to) return true;
    return false;
  }

  canBeHit() {
    return !UNTOUCHABLE.has(this.state) && !this.isIntangible();
  }

  isShielding() {
    return this.state === S.SHIELD || this.state === S.SHIELDSTUN;
  }

  counterActive() {
    return this.state === S.ACTION && !!this.move?.counter && this.inWindow(this.move.counter);
  }

  armorActive(damage) {
    // Pasiva (Modo Despertado): cualquier golpe por DEBAJO del umbral.
    if (this.stats.passiveArmor > 0 && damage < this.stats.passiveArmor) return true;
    const armor = this.state === S.ACTION ? this.move?.armor : null;
    return !!armor && this.inWindow(armor) && damage <= armor.maxDamage;
  }

  /** Caja golpeable en mundo. Agachado mide el 70%; enterrado solo asoma el torso. */
  hurtbox() {
    let h = this.height;
    if (this.state === S.CROUCH) h *= 0.7;
    if (this.state === S.BURIED) h *= 0.45;
    if (this.state === S.KNOCKDOWN) h *= 0.4;
    return {
      x: this.x - this.halfWidth, y: this.y - h, w: this.halfWidth * 2, h,
    };
  }

  /** Multiplicador de la carga de smash en curso (1 sin carga, hasta charge.mul). */
  chargeMultiplier() {
    const charge = this.move?.charge;
    if (!charge) return 1;
    return 1 + (charge.mul - 1) * Math.min(1, this.chargeFrames / charge.max);
  }

  hitboxDamage(hb) {
    if (hb.damage === 'counter') return this.counterDamage;
    return hb.damage * this.chargeMultiplier();
  }

  /**
   * Hitboxes activas en este frame, en coordenadas de mundo. Mientras se
   * carga un smash no hay ninguna: la animación está congelada ANTES de sus
   * frames activos.
   */
  activeHitboxes() {
    if (this.state !== S.ACTION || !this.move?.hitboxes || this.charging) return [];
    const out = [];
    for (const hb of this.move.hitboxes) {
      if (this.moveFrame < hb.from || this.moveFrame > hb.to) continue;
      const group = hb.group ?? 'main';
      if (this.hitGroups.has(group)) continue;
      const cx = this.x + hb.x * this.facing;
      const cy = this.y + hb.y;
      out.push({
        hb,
        group,
        box: {
          x: cx - hb.w / 2, y: cy - hb.h / 2, w: hb.w, h: hb.h,
        },
      });
    }
    return out;
  }

  // --- Tick --------------------------------------------------------------------

  /**
   * Un frame de simulación.
   * @param {object} rawInput  input de este frame (booleanos)
   * @param {object} world     simulación: geometry, frame, emit(),
   *                           spawnProjectile(), controlsEnabled
   */
  update(rawInput, world) {
    this.world = world;
    this.input.update(world.controlsEnabled ? rawInput : NEUTRAL_INPUT, world.frame);
    // Primer frame tras el hitlag de un golpe: la dirección mantenida AHORA
    // inclina la trayectoria (DI), antes de moverse ni un píxel.
    if (this.pendingDI) this.applyPendingDI();
    this.stateFrame += 1;
    if (this.awakenFrames > 0) {
      this.awakenFrames -= 1;
      if (this.awakenFrames === 0) {
        this.jumpsLeft = Math.min(this.jumpsLeft, this.stats.airJumps);
        world.emit({ type: 'awakenEnd', slot: this.slot, x: this.x, y: this.y - this.height / 2 });
      }
    }
    if (this.hitFlash > 0) this.hitFlash -= 1;
    if (this.armorFlash > 0) this.armorFlash -= 1;
    if (this.intangibleFrames > 0) this.intangibleFrames -= 1;
    if (this.ledgeCooldown > 0) this.ledgeCooldown -= 1;
    if (this.dropThroughFrames > 0) this.dropThroughFrames -= 1;
    if (!this.isShielding() && this.state !== S.SHIELD_BREAK && this.state !== S.DIZZY) {
      this.shieldHp = Math.min(this.stats.shieldMax, this.shieldHp + SHIELD_REGEN);
    }
    this.recordTechPress(world.frame);

    // Dónde estaba al empezar el tick: el barrido del borde y el punto EXACTO
    // de cruce de una blast zone salen del recorrido prev -> actual.
    this.prevX = this.x;
    this.prevY = this.y;
    const skipPhysics = this.runState();
    if (skipPhysics) return;
    this.physicsStep();
    this.checkLedgeGrab();
  }

  recordTechPress(frame) {
    if (!this.input.pressed.shield) return;
    if (frame - this.lastShieldPress >= TECH_LOCKOUT) this.techPressFrame = frame;
    this.lastShieldPress = frame;
  }

  canTech() {
    return this.world.frame - this.techPressFrame <= TECH_WINDOW;
  }

  setState(state) {
    this.state = state;
    this.stateFrame = 0;
  }

  /** Devuelve true si este estado no usa la física (colgado, agarrado, muerto...). */
  runState() {
    switch (this.state) {
      case S.DEAD: return this.tickDead();
      case S.ELIMINATED: return true;
      case S.CINEMATIC: return true;
      case S.GRABBED: return this.tickGrabbed();
      case S.RESPAWN: return this.tickRespawn();
      case S.LEDGE_HANG: return this.tickLedgeHang();
      case S.TRUMPED: this.tickTrumped(); return false;
      case S.BURIED: return this.tickBuried();
      case S.IDLE:
      case S.WALK:
      case S.DASH:
      case S.RUN:
      case S.CROUCH: this.tickGroundNeutral(); return false;
      case S.JUMPSQUAT: this.tickJumpSquat(); return false;
      case S.AIR:
      case S.TUMBLE: this.tickAirNeutral(); return false;
      case S.LANDING: this.tickLanding(); return false;
      case S.ACTION: return this.tickAction();
      case S.CHARGE: this.tickCharge(); return false;
      case S.SHIELD: this.tickShield(); return false;
      case S.SHIELDSTUN: this.tickShieldstun(); return false;
      case S.SHIELD_DROP: this.tickTimed(SHIELD_DROP_FRAMES); return false;
      case S.SHIELD_BREAK: return false; // vuela sin control hasta aterrizar
      case S.DIZZY: this.tickTimed(SHIELD_BREAK_DIZZY, () => { this.shieldHp = SHIELD_RESET; }); return false;
      case S.HITSTUN: this.tickHitstun(); return false;
      case S.KNOCKDOWN: this.tickKnockdown(); return false;
      case S.HELPLESS: this.airControl(this.helplessDrift); return false;
      case S.GRABBING: this.tickGrabbing(); return false;
      default: return false;
    }
  }

  // Estados que solo esperan N frames y vuelven a neutro.
  tickTimed(frames, onEnd = null) {
    applyFriction(this, true);
    if (this.stateFrame >= frames) {
      onEnd?.();
      this.toNeutral();
    }
  }

  toNeutral() {
    this.move = null;
    this.moveId = null;
    this.setState(this.grounded ? S.IDLE : S.AIR);
  }

  // --- Suelo -------------------------------------------------------------------

  tickGroundNeutral() {
    if (!this.grounded) {
      this.setState(S.AIR);
      this.tickAirNeutral();
      return;
    }
    if (this.tryGroundAction()) return;

    const inp = this.input;
    const h = inp.horizontal;

    if (inp.held.down) {
      if (this.state !== S.CROUCH) this.setState(S.CROUCH);
      applyFriction(this, true);
      return;
    }

    if (h !== 0) {
      const fresh = (h < 0 && inp.pressed.left) || (h > 0 && inp.pressed.right);
      const recentDash = this.world.frame - this.lastDashFrame <= DASH_DANCE_WINDOW;
      const dashRequest = fresh && (inp.doubleTapped(h < 0 ? 'left' : 'right') || inp.held.dash || recentDash);
      if (this.state === S.DASH) {
        if (h !== this.facing) {
          // DASH DANCE: invertir durante el dash inicial arranca otro dash al
          // instante y a velocidad plena, sin frenada. Es la finta del género.
          this.startDash(h);
        } else if (this.stateFrame >= this.stats.initialDashFrames) {
          this.setState(S.RUN);
        }
      } else if (this.state === S.RUN) {
        // PIVOT: invertir corriendo da media vuelta directamente en dash.
        if (h !== this.facing) this.startDash(h);
      } else if (dashRequest) {
        this.startDash(h);
      } else if (this.state !== S.WALK) {
        this.setState(S.WALK);
      }

      if (this.state === S.DASH) {
        // Dash inicial: velocidad fija y alta desde el primer frame.
        this.vx = h * this.speed('initialDashSpeed');
        this.lastDashFrame = this.world.frame;
      } else if (this.state === S.RUN) {
        this.vx = approach(this.vx, h * this.speed('dashSpeed'), 0.6);
        this.lastDashFrame = this.world.frame;
      } else {
        this.facing = h;
        this.vx = approach(this.vx, h * this.speed('walkSpeed'), WALK_ACCEL);
      }
      return;
    }

    if (this.state !== S.IDLE) this.setState(S.IDLE);
    applyFriction(this, true);
  }

  startDash(dir) {
    this.facing = dir;
    this.setState(S.DASH);
    this.vx = dir * this.speed('initialDashSpeed');
    this.lastDashFrame = this.world.frame;
    this.world.emit({ type: 'dash', slot: this.slot, x: this.x, y: this.y, dir });
  }

  /** Acciones desde el suelo en neutro. Devuelve true si alguna ha arrancado. */
  tryGroundAction() {
    const inp = this.input;
    const dir = inp.modifierDirection();
    const running = this.state === S.DASH || this.state === S.RUN;

    if (this.tryButtons(['ultra', 'special', 'smash', 'attack', 'grab'], { grounded: true, running }, dir)) return true;
    if (inp.held.shield) {
      if (inp.pressed.shield && inp.held.down) return this.startMove('spotdodge');
      if (inp.pressed.shield && inp.horizontal !== 0) return this.startRoll(inp.horizontal);
      this.setState(S.SHIELD);
      return true;
    }
    if (inp.buffered('jump')) {
      // S + salto encima de una semisólida = bajar a través de ella (1.A).
      if (inp.held.down && this.onPlatform()) {
        inp.consume('jump');
        this.dropThrough();
        return true;
      }
      this.startJumpSquat();
      return true;
    }
    return false;
  }

  /**
   * Arranca el primer botón con una pulsación GUARDADA en el buffer (ver
   * InputTracker.buffered) y la consume. Una pulsación que no produce nada
   * —un agarre en el aire, un Final Smash sin medidor— no se consume: sigue
   * esperando su ventana por si el siguiente frame sí puede.
   */
  tryButtons(buttons, { grounded, running = false }, dir) {
    const inp = this.input;
    for (const button of buttons) {
      if (!inp.buffered(button)) continue;
      if (button === 'ultra' && !this.canFinalSmash()) continue;
      const resolved = resolveAttack(button, { grounded, facing: this.facing, running }, dir);
      if (resolved && this.startResolved(resolved)) {
        inp.consume(button);
        return true;
      }
    }
    return false;
  }

  onPlatform() {
    return this.grounded && !!this.world.geometry.platforms.find((p) => p.id === this.surfaceId);
  }

  dropThrough() {
    this.grounded = false;
    this.surfaceId = null;
    this.vy = 1;
    this.dropThroughFrames = 8;
    this.setState(S.AIR);
    this.world.emit({ type: 'dropThrough', slot: this.slot, x: this.x, y: this.y });
  }

  startRoll(dir) {
    const forward = dir === this.facing;
    if (!this.startMove('roll')) return false;
    this.driftSign = forward ? 1 : -1;
    this.turnAtEnd = forward;
    this.world.emit({ type: 'dodge', slot: this.slot, x: this.x, y: this.y });
    return true;
  }

  canFinalSmash() {
    const final = this.moves.final;
    if (!final) return false;
    // El Final Smash despertado (`free`) sale sin medidor, UNA vez por
    // Despertar: sin ese tope se podría lanzar la gorra en bucle 10 s.
    return this.meter >= this.stats.finalMeterMax || (!!final.finalSmash?.free && !this.freeFinalUsed);
  }

  /** Spec del Final Smash de tipo `kind` ('gallos' o 'battle'), de la tabla que lo tenga. */
  finalSmashSpec(kind) {
    for (const table of [this.moves, this.baseMoves, this.awakenedMoves]) {
      const spec = table.final?.finalSmash;
      if (spec && (spec.kind ?? 'gallos') === kind) return spec;
    }
    return null;
  }

  startJumpSquat() {
    // La pulsación que arranca el salto se gasta aquí: si siguiera en el
    // buffer, al despegar saldría además un doble salto.
    this.input.consume('jump');
    this.setState(S.JUMPSQUAT);
    this.jumpReleased = false;
  }

  // El jump squat es donde se resuelve el conflicto de W: en teclado, "arriba"
  // y "saltar" son la misma tecla, así que U+W pulsados casi a la vez
  // arrancarían siempre un salto. Durante los 3 frames de squat, un ataque con
  // arriba mantenido CANCELA el salto en su versión de suelo (U-Tilt, U-Smash
  // o Up Special), que es además exactamente como funciona el U-Smash desde
  // salto en Smash. Cualquier otro ataque se queda en el buffer y sale como
  // aéreo en el mismo frame del despegue.
  tickJumpSquat() {
    const inp = this.input;
    if (!inp.held.jump) this.jumpReleased = true;
    if (inp.held.up) {
      const upMoves = { attack: 'utilt', smash: 'usmash', special: 'uspecial' };
      for (const [button, move] of Object.entries(upMoves)) {
        if (inp.buffered(button) && this.startMove(move)) {
          inp.consume(button);
          return;
        }
      }
    }
    applyFriction(this, true);
    if (this.stateFrame < this.stats.jumpSquatFrames) return;

    const full = !this.jumpReleased && inp.held.jump;
    this.grounded = false;
    this.surfaceId = null;
    this.vy = full ? this.stats.groundJumpVelocity : this.stats.shortHopVelocity;
    const maxAir = this.speed('maxAirSpeed');
    this.vx = clamp(this.vx * 0.8 + inp.horizontal * 1.2, -maxAir * 1.1, maxAir * 1.1);
    this.setState(S.AIR);
    this.world.emit({
      type: 'jump', slot: this.slot, x: this.x, y: this.y, full,
    });
    // Aéreo guardado durante el squat: sale ya, en el frame del despegue.
    this.tryButtons(['special', 'attack', 'smash'], { grounded: false }, inp.modifierDirection());
  }

  tickLanding() {
    applyFriction(this, true);
    if (this.stateFrame >= this.lagFrames) this.toNeutral();
  }

  // --- Aire --------------------------------------------------------------------

  tickAirNeutral() {
    if (this.grounded) {
      this.toNeutral();
      return;
    }
    if (this.tryAirAction()) return;
    this.airControl(1);
    this.checkFastFall();
  }

  // CAÍDA RÁPIDA INMEDIATA: pulsar S en cualquier momento a partir del ápice
  // (vy ≥ 0) pone la velocidad de caída rápida de golpe. La pulsación entra
  // en el buffer: pulsada unos frames antes del ápice, se aplica justo en él.
  /** Caída rápida: 1.6x la velocidad terminal (physics.FAST_FALL_MULTIPLIER). */
  fastFallSpeed() {
    return this.stats.maxFallSpeed * FAST_FALL_MULTIPLIER;
  }

  checkFastFall() {
    if (!this.fastFalling && this.vy + this.kby >= 0 && this.input.buffered('down')) {
      this.input.consume('down');
      this.fastFalling = true;
      this.vy = this.fastFallSpeed();
      this.world.emit({ type: 'fastFall', slot: this.slot, x: this.x, y: this.y });
    }
  }

  // Desde el aire (y desde el TUMBLE, en cuanto acaba el hitstun), la esquiva
  // aérea y el Up Special CORTAN el retroceso que quede a la mitad
  // (combat.cancelLaunch); el doble salto corta solo la parte horizontal y
  // suma la vertical al salto (combat.jumpOutOfLaunch). Los aéreos no tocan el
  // retroceso: atacar no frena un vuelo.
  tryAirAction() {
    const inp = this.input;
    const dir = inp.modifierDirection();
    if (this.tryButtons(['ultra', 'special', 'attack', 'smash'], { grounded: false }, dir)) {
      if (this.moveId === 'uspecial') cancelLaunch(this);
      return true;
    }
    if (inp.pressed.shield && !this.airDodgeUsed) return this.startAirDodge();
    if (inp.buffered('jump') && this.jumpsLeft > 0) {
      inp.consume('jump');
      this.jumpsLeft -= 1;
      this.vy = this.stats.doubleJumpVelocity;
      // El doble salto permite cambiar de dirección: es la herramienta de
      // recovery horizontal de un personaje sin movilidad aérea.
      this.vx = inp.horizontal * this.speed('maxAirSpeed');
      this.fastFalling = false;
      jumpOutOfLaunch(this);
      this.setState(S.AIR);
      this.world.emit({ type: 'doubleJump', slot: this.slot, x: this.x, y: this.y });
      return true;
    }
    return false;
  }

  startAirDodge() {
    const inp = this.input;
    const dx = inp.horizontal;
    const dy = (inp.held.down ? 1 : 0) - (inp.held.up ? 1 : 0);
    if (!this.startMove('airdodge')) return false;
    this.airDodgeUsed = true;
    this.fastFalling = false;
    cancelLaunch(this);
    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy);
      this.airDodgeDir = { x: dx / len, y: dy / len };
    } else {
      this.airDodgeDir = null;
    }
    this.world.emit({ type: 'dodge', slot: this.slot, x: this.x, y: this.y });
    return true;
  }

  /**
   * Control aéreo: acelera hacia la dirección mantenida hasta maxAirSpeed. Si
   * ya se va más rápido (inercia de un salto con carrera, un lanzamiento), no
   * frena de golpe: solo el rozamiento aéreo.
   */
  airControl(factor) {
    const h = this.input.horizontal;
    const max = this.speed('maxAirSpeed') * factor;
    if (h === 0 || factor <= 0) {
      this.vx = approach(this.vx, 0, AIR_FRICTION);
      return;
    }
    const target = h * max;
    if (Math.abs(this.vx) > max && Math.sign(this.vx) === h) {
      this.vx = approach(this.vx, target, AIR_FRICTION);
    } else {
      this.vx = approach(this.vx, target, this.stats.airAcceleration * Math.max(factor, 0.3));
    }
  }

  // --- Movimientos ---------------------------------------------------------------

  startResolved({ move, turn }) {
    if (move === 'nspecial' && this.moves.nspecial?.chargeShot) return this.startNeutralSpecial();
    if (move === 'sspecial' && turn) this.facing = -this.facing;
    return this.startMove(move, { turn: turn && move !== 'sspecial' });
  }

  startMove(id, { turn = false } = {}) {
    const move = this.moves[id];
    if (!move) return false;
    if (move.finalSmash) {
      if (!this.canFinalSmash()) return false;
      if (this.meter >= this.stats.finalMeterMax || !move.finalSmash.free) this.meter = 0;
      else this.freeFinalUsed = true;
    }
    if (turn) this.facing = -this.facing;
    this.move = move;
    this.moveId = id;
    this.moveInstance += 1;
    this.moveFrame = 0;
    this.hitGroups.clear();
    this.charging = false;
    this.chargeFrames = 0;
    this.chargeButton = move.charge ? 'smash' : null;
    this.queuedNext = false;
    this.driftSign = 1;
    this.driftStopped = false;
    this.turnAtEnd = false;
    // Desde dónde salió (el agarre de comando solo atrapa en el suelo si salió de él).
    this.moveStartedGrounded = this.grounded;
    this.setState(S.ACTION);
    this.world?.emit({
      type: 'moveStart', slot: this.slot, move: id, x: this.x, y: this.y,
    });
    return true;
  }

  // --- Especial neutro cargable -------------------------------------------------

  chargeLevel(frames) {
    const spec = this.moves.nspecial.chargeShot;
    return clamp(Math.floor(frames / spec.framesPerLevel) + 1, 1, spec.levels.length);
  }

  startNeutralSpecial() {
    const spec = this.moves.nspecial?.chargeShot;
    if (!spec) return false;
    if (!this.grounded || this.storedChargeFrames >= spec.maxFrames) {
      return this.fireCharge(this.storedChargeFrames);
    }
    this.chargeFrames = this.storedChargeFrames;
    this.move = this.moves.nspecial;
    this.moveId = 'nspecial';
    this.setState(S.CHARGE);
    return true;
  }

  fireCharge(frames) {
    const spec = this.moves.nspecial.chargeShot;
    const level = this.chargeLevel(frames);
    this.storedChargeFrames = 0;
    return this.startMove(spec.levels[level - 1]);
  }

  tickCharge() {
    const inp = this.input;
    const spec = this.moves.nspecial.chargeShot;
    this.chargeFrames = Math.min(spec.maxFrames, this.chargeFrames + 1);
    applyFriction(this, true);
    if (!this.grounded) {
      this.storedChargeFrames = this.chargeFrames;
      this.setState(S.AIR);
      return;
    }
    // Soltar el eructo: volver a pulsar O (o llegar a la carga máxima).
    if ((inp.pressed.special && this.stateFrame > 3) || this.chargeFrames >= spec.maxFrames) {
      this.fireCharge(this.chargeFrames);
      return;
    }
    // Guardar la carga: escudo (y salto, que es la cancelación natural).
    if (inp.pressed.shield || inp.pressed.jump) {
      this.storedChargeFrames = this.chargeFrames;
      this.world.emit({
        type: 'chargeStored', slot: this.slot, x: this.x, y: this.y, level: this.chargeLevel(this.chargeFrames),
      });
      if (inp.pressed.jump) this.startJumpSquat();
      else this.setState(S.IDLE);
      // La O que abrió la carga no puede disparar el eructo al guardarla.
      inp.consume('special');
    }
  }

  // --- Tick de un movimiento de la moveTable ------------------------------------

  tickAction() {
    const m = this.move;
    const inp = this.input;

    // SMASH CARGADO: la animación se congela en `charge.frame` mientras se
    // mantenga I, hasta `charge.max` frames.
    if (this.charging) {
      if (inp.held[this.chargeButton] && this.chargeFrames < m.charge.max) {
        this.chargeFrames += 1;
        applyFriction(this, this.grounded);
        return false;
      }
      this.charging = false;
      this.world.emit({
        type: 'chargeRelease', slot: this.slot, x: this.x, y: this.y, charge: this.chargeFrames / m.charge.max,
      });
    }

    this.moveFrame += 1;
    const f = this.moveFrame;

    if (m.charge && f === m.charge.frame && inp.held[this.chargeButton]) {
      this.charging = true;
      this.world.emit({ type: 'chargeStart', slot: this.slot, x: this.x, y: this.y });
    }

    // Opción de borde: el cuerpo viaja del colgado a la losa sin física.
    if (m.ledgePath && this.ledgePathFrom) {
      const done = this.stepLedgePath(m.ledgePath);
      if (!done) return true;
    }

    for (const v of m.velocity || []) {
      if (v.frame !== f) continue;
      if (v.vxScale != null) this.vx *= v.vxScale;
      if (v.vx != null) this.vx = v.vx * this.facing;
      // Salida ANGULABLE: la dirección mantenida en ese frame decide la deriva.
      if (v.vxFromInput != null && this.input.horizontal !== 0) this.vx = this.input.horizontal * v.vxFromInput;
      if (v.vy != null) {
        this.vy = v.vy;
        this.kby = 0;
        if (v.vy < 0) {
          this.grounded = false;
          this.surfaceId = null;
        }
      }
      this.fastFalling = false;
    }
    if (m.drift && f >= m.drift.from && f <= m.drift.to) {
      // Frenado en seco (stopOnHit): el golpe que conecta corta la deriva.
      this.vx = this.driftStopped ? 0 : m.drift.vx * this.facing * this.driftSign;
    }
    // ABRAZO AÉREO, con el rival en brazos: 1) SIGUE SUBIENDO con su propia
    // gravedad hasta el ápice del salto; 2) se queda `hang` frames quieto en
    // el aire (el micro-parón); 3) se voltean y caen en picado a `vy`; al
    // tocar suelo, el estampado (onLand -> landSlam).
    if (m.slam) {
      const slam = m.slam;
      if (this.slamPhase === 'rise' && this.vy >= 0) {
        this.slamPhase = 'hang';
        this.slamHang = 0;
        this.world.emit({
          type: 'fx', fx: 'slamApex', slot: this.slot, x: this.x, y: this.y, facing: this.facing,
        });
      }
      if (this.slamPhase === 'hang') {
        this.vy = 0;
        this.slamHang += 1;
        if (this.slamHang > slam.hang) this.slamPhase = 'dive';
      }
      if (this.slamPhase === 'dive') {
        if (this.grounded) {
          this.landSlam(m);
          return false;
        }
        this.vy = slam.vy;
      }
      this.vx = 0;
      this.kby = 0;
      this.fastFalling = false;
    }
    // PICADO: velocidad vertical FORZADA cada frame (por encima de la caída
    // terminal y de la rápida), sin deriva horizontal.
    if (m.dive && f >= m.dive.from && f <= m.dive.to && !this.grounded) {
      this.vy = m.dive.vy;
      this.vx = 0;
      this.kby = 0;
      this.fastFalling = false;
    }
    for (const s of m.spawn || []) {
      if (s.frame === f) this.world.spawnProjectile(this, s);
    }
    for (const e of m.fx || []) {
      if (e.frame === f) {
        this.world.emit({
          type: 'fx', fx: e.fx, slot: this.slot, x: this.x, y: this.y, facing: this.facing,
        });
      }
    }
    if (m.pummel && f === m.pummel.frame) this.applyPummel(m.pummel);
    if (m.throw && f === m.throw.frame) this.applyThrow(m.throw);

    // Encadenar (Jab 1 -> Jab 2 -> ráfaga, bloque de motor -> lanzarlo).
    if (m.next && inp.pressed[m.next.button] && f >= m.next.from && f <= m.next.to) this.queuedNext = true;
    if (this.queuedNext && f >= m.next.at) {
      const next = m.next.move;
      this.queuedNext = false;
      this.startMove(next);
      return false;
    }

    // Recovery: al llegar al ápice, caída indefensa.
    if (m.helplessAtApex && f >= m.helplessAtApex && !this.grounded && this.vy >= 0) {
      this.enterHelpless();
      return false;
    }

    // Esquiva aérea direccional: viaje en línea recta sin gravedad.
    if (this.moveId === 'airdodge' && this.airDodgeDir && f <= AIR_DODGE_TRAVEL) {
      const k = 1 - f / (AIR_DODGE_TRAVEL + 4);
      this.vx = this.airDodgeDir.x * AIR_DODGE_SPEED * k;
      this.vy = this.airDodgeDir.y * AIR_DODGE_SPEED * k;
    } else if (!this.grounded) {
      const aerial = m.landingLag != null && !m.helplessAtApex;
      const diving = (m.dive && f >= m.dive.from && f <= m.dive.to) || !!m.slam;
      if (!diving) {
        this.airControl(m.airControl ?? (aerial ? 1 : DEFAULT_SPECIAL_AIR_CONTROL));
        if (aerial) this.checkFastFall();
      }
    } else if (!(m.drift && f >= m.drift.from && f <= m.drift.to)) {
      applyFriction(this, true);
    }

    if (f >= (m.frames ?? 1)) this.finishMove();
    return false;
  }

  finishMove() {
    const m = this.move;
    if (m.loop) {
      this.loops += 1;
      const inp = this.input;
      const stillMashing = inp.held[m.loop.button]
        || this.world.frame - inp.lastPress[m.loop.button] <= m.loop.grace;
      if (this.loops < m.loop.max && (this.loops < m.loop.min || stillMashing)) {
        this.moveFrame = 0;
        this.hitGroups.clear();
        return;
      }
      this.loops = 0;
      this.startMove(m.loop.exit);
      return;
    }
    this.loops = 0;
    if (this.turnAtEnd) this.facing = -this.facing;
    if (this.holding) {
      // Tras un golpe o un lanzamiento que no ha soltado al rival (el
      // pummel), se vuelve a sujetarlo.
      this.move = null;
      this.moveId = null;
      this.setState(S.GRABBING);
      return;
    }
    if (m.onEnd === 'helpless' && !this.grounded) {
      this.enterHelpless();
      return;
    }
    this.toNeutral();
  }

  enterHelpless() {
    // Cuánto control horizontal queda en caída indefensa. Lo puede declarar
    // el movimiento que la provoca (`helplessAirControl`): es lo que decide si
    // volver a la losa tras el recovery es una sentencia o una lectura.
    this.helplessDrift = this.move?.helplessAirControl ?? 0.5;
    this.move = null;
    this.moveId = null;
    this.helpless = true;
    this.fastFalling = false;
    this.setState(S.HELPLESS);
  }

  // --- Borde -----------------------------------------------------------------

  canGrabLedgeNow() {
    // "Si está en caída (!isGrounded && vy >= 0)": la velocidad vertical que
    // cuenta es la TOTAL, propia más retroceso — un lanzado que aún sube no
    // puede engancharse al pasar junto al borde.
    if (this.grounded || this.vy + this.kby < 0 || this.ledgeCooldown > 0 || this.input.held.down) return false;
    if (this.state === S.AIR || this.state === S.TUMBLE || this.state === S.HELPLESS) return true;
    // La esquiva aérea puede agarrar el borde en su segunda mitad, como en
    // Ultimate: es media recuperación de cualquier personaje sin tercer salto.
    if (this.state === S.ACTION && this.moveId === 'airdodge') return this.moveFrame > 12;
    return false;
  }

  checkLedgeGrab() {
    if (!this.canGrabLedgeNow()) return;
    const found = findLedge(this, this.prevX, this.prevY, this.world.geometry.ledges);
    if (found) this.grabLedge(found.ledge, found.t);
  }

  /**
   * Anclaje al borde: TODA la inercia fuera (propia y de retroceso) y las
   * manos exactamente en el punto del borde. `t` es en qué punto del recorrido
   * del frame llegaron las manos: si dos luchadores agarran el mismo borde en
   * el mismo frame, el que llegó DESPUÉS es el que se lo queda (ver
   * Simulation.resolveLedgeTrumps).
   */
  grabLedge(ledge, t = 1) {
    const pos = ledgeHangPosition(this, ledge);
    this.x = pos.x;
    this.y = pos.y;
    this.vx = 0;
    this.vy = 0;
    this.kbx = 0;
    this.kby = 0;
    this.grounded = false;
    this.surfaceId = null;
    this.move = null;
    this.moveId = null;
    this.ledge = ledge;
    this.ledgeGrabT = t;
    this.facing = -ledge.side; // de cara al escenario
    this.intangibleFrames = LEDGE_INVULN_FRAMES;
    // Colgarse devuelve el doble salto y la esquiva aérea (1.B).
    this.jumpsLeft = this.stats.airJumps;
    this.airDodgeUsed = false;
    this.fastFalling = false;
    this.helpless = false;
    this.tumble = false;
    this.setState(S.LEDGE_HANG);
    this.world.emit({
      type: 'ledgeGrab', slot: this.slot, x: ledge.x, y: ledge.y,
    });
  }

  tickLedgeHang() {
    if (this.stateFrame < LEDGE_ACTION_DELAY) return true;
    const inp = this.input;
    const towardStage = this.facing;
    const pressedToward = (towardStage > 0 && inp.pressed.right) || (towardStage < 0 && inp.pressed.left);
    const pressedAway = (towardStage > 0 && inp.pressed.left) || (towardStage < 0 && inp.pressed.right);
    if (inp.pressed.jump || inp.pressed.up || pressedToward) return this.startLedgeOption('ledge_climb');
    if (inp.pressed.attack || inp.pressed.smash) return this.startLedgeOption('ledge_attack');
    if (inp.pressed.shield) return this.startLedgeOption('ledge_roll');
    if (inp.pressed.down || pressedAway || this.stateFrame >= LEDGE_MAX_HANG) {
      this.dropFromLedge();
      return false;
    }
    return true;
  }

  /**
   * LEDGE TRUMP: `by` acaba de agarrar el borde del que este colgaba. Sale
   * expulsado hacia arriba y hacia fuera (vx = -by.facing·3.2, vy = -4.5),
   * pierde lo que le quedara de intangibilidad y pasa 14 frames sin poder
   * actuar: la ventana en la que `by` le castiga. No puede re-agarrar al
   * instante (el mismo cooldown que al soltarse): si pudiera, los dos se
   * robarían el borde en bucle, frame a frame.
   */
  getTrumped(by) {
    this.ledge = null;
    this.intangibleFrames = 0;
    this.vx = -by.facing * LEDGE_TRUMP_VX;
    this.vy = LEDGE_TRUMP_VY;
    this.kbx = 0;
    this.kby = 0;
    this.grounded = false;
    this.surfaceId = null;
    this.fastFalling = false;
    this.ledgeCooldown = LEDGE_REGRAB_COOLDOWN;
    this.setState(S.TRUMPED);
  }

  // Sin control y sin rozamiento: el impulso del robo se conserva entero.
  tickTrumped() {
    if (this.stateFrame >= LEDGE_TRUMP_FRAMES) this.setState(S.AIR);
  }

  dropFromLedge() {
    this.vx = -this.facing;
    this.vy = 0;
    this.ledge = null;
    this.ledgeCooldown = LEDGE_REGRAB_COOLDOWN;
    this.setState(S.AIR);
    this.world.emit({ type: 'ledgeDrop', slot: this.slot, x: this.x, y: this.y });
  }

  startLedgeOption(id) {
    const ledge = this.ledge;
    if (!ledge || !this.startMove(id)) return true;
    const path = this.move.ledgePath;
    this.ledgePathFrom = { x: this.x, y: this.y };
    this.ledgePathTo = {
      x: ledge.x - ledge.side * (this.halfWidth + path.dx),
      y: ledge.y,
      surfaceId: ledge.surface,
    };
    this.ledge = null;
    return true;
  }

  // Sube en la primera mitad y avanza en la segunda: así el cuerpo no
  // atraviesa la esquina de la losa en diagonal.
  stepLedgePath(path) {
    const t = Math.min(1, this.moveFrame / path.frames);
    const ty = Math.min(1, t * 2);
    const tx = Math.max(0, t * 2 - 1);
    const from = this.ledgePathFrom;
    const to = this.ledgePathTo;
    this.y = from.y + (to.y - from.y) * ty;
    this.x = from.x + (to.x - from.x) * tx;
    if (t < 1) return false;
    this.x = to.x;
    this.y = to.y;
    this.grounded = true;
    this.surfaceId = to.surfaceId;
    this.vx = 0;
    this.vy = 0;
    this.ledgePathFrom = null;
    this.ledgePathTo = null;
    return true;
  }

  // --- Escudo ----------------------------------------------------------------

  tickShield() {
    const inp = this.input;
    applyFriction(this, true);
    if (!this.grounded) {
      this.setState(S.AIR);
      return;
    }
    // Opciones fuera de escudo: salto, agarre, esquivas y los "up" de suelo.
    if (inp.buffered('jump')) {
      this.startJumpSquat();
      return;
    }
    for (const [button, move, needsUp] of [['grab', 'grab', false], ['special', 'uspecial', true], ['smash', 'usmash', true]]) {
      if (inp.buffered(button) && (!needsUp || inp.held.up) && this.startMove(move)) {
        inp.consume(button);
        return;
      }
    }
    if (inp.pressed.down && this.startMove('spotdodge')) return;
    if ((inp.pressed.left || inp.pressed.right) && inp.horizontal !== 0 && this.startRoll(inp.horizontal)) return;
    if (!inp.held.shield) {
      this.setState(S.SHIELD_DROP);
      return;
    }
    this.shieldHp -= SHIELD_DEPLETE;
    if (this.shieldHp <= 0) this.breakShield();
  }

  tickShieldstun() {
    applyFriction(this, true);
    if (this.stateFrame >= this.lagFrames) {
      this.setState(this.input.held.shield ? S.SHIELD : S.SHIELD_DROP);
    }
  }

  breakShield() {
    this.shieldHp = 0;
    this.grounded = false;
    this.surfaceId = null;
    this.vy = SHIELD_BREAK_POP;
    this.vx = 0;
    this.setState(S.SHIELD_BREAK);
    this.world.emit({
      type: 'shieldBreak', slot: this.slot, x: this.x, y: this.y - this.height / 2,
    });
  }

  // --- Recibir golpes ------------------------------------------------------------

  /**
   * Resuelve un golpe contra este luchador, en este orden (el orden importa):
   *   1. contraataque (Pausa del Cigarro) — anula el golpe entero
   *   2. escudo — daño al escudo, shieldstun, empuje
   *   3. armadura pesada — el % entra, el retroceso no
   *   4. golpe limpio — %, knockback, hitstun/tumble, entierro
   *
   * @returns {{ type: string, [k: string]: any }}
   */
  receiveHit(attacker, hb, damage) {
    const away = this.x >= attacker.x ? 1 : -1;

    if (this.counterActive() && !hb.grab) {
      const counter = this.move.counter;
      this.counterDamage = damage * (counter.multiplier ?? 1);
      this.facing = -away;
      // PARRY: aparece a la ESPALDA del atacante (si es un luchador; contra un
      // proyectil contraataca en el sitio), de cara a él.
      const teleport = !!counter.teleport && attacker.halfWidth != null;
      if (teleport) {
        this.x = attacker.x - attacker.facing * (attacker.halfWidth + this.halfWidth + 6);
        this.y = attacker.y;
        this.facing = attacker.facing;
        this.grounded = attacker.grounded;
        this.surfaceId = attacker.surfaceId;
        this.vx = 0;
        this.vy = 0;
      }
      this.startMove(counter.move);
      return {
        type: 'counter', damage: 0, freeze: counter.freeze ?? null, teleport,
      };
    }

    if (this.isShielding() && !hb.unblockable) {
      this.shieldHp -= damage;
      this.vx = away * Math.min(4.5, 0.8 + damage * 0.14);
      this.lagFrames = shieldstunFrames(damage);
      this.setState(S.SHIELDSTUN);
      if (this.shieldHp <= 0) {
        this.breakShield();
        return { type: 'shieldBreak', damage: 0 };
      }
      return { type: 'shield', damage: 0 };
    }

    if (this.armorActive(damage)) {
      this.percent = Math.min(999, this.percent + damage);
      this.armorFlash = 10;
      this.hitFlash = 4;
      return { type: 'armor', damage };
    }

    const percentBefore = this.percent;
    this.percent = Math.min(999, this.percent + damage);
    const direction = launchDirection(hb, attacker.x, attacker.facing, this.x);
    const wasGrounded = this.grounded && this.state !== S.BURIED;
    const launch = computeLaunch({
      hb, damage, percent: percentBefore, weight: this.stats.weight, direction, grounded: wasGrounded,
    });
    if (launch.bury) {
      this.enterBuried(buryFrames(this.percent));
      return { type: 'bury', damage, ...launch };
    }
    this.applyLaunch(launch);
    return { type: 'hit', damage, ...launch };
  }

  /** Aplica un lanzamiento ya calculado (golpe, lanzamiento de agarre, Final Smash). */
  applyLaunch({
    kbx, kby, hitstun, tumble,
  }) {
    this.releaseHolds();
    this.move = null;
    this.moveId = null;
    this.charging = false;
    this.kbx = kbx;
    this.kby = kby;
    this.vx = 0;
    this.vy = 0;
    this.fastFalling = false;
    this.helpless = false;
    this.hitstun = hitstun;
    this.tumble = tumble;
    this.hitFlash = 8;
    this.ledge = null;
    // El DI se lee al acabar el hitlag (ver update). Quién lanzó y con cuánto
    // lo pone la simulación: aquí solo se limpia lo del golpe anterior.
    this.pendingDI = kbx !== 0 || kby !== 0;
    this.launchKb = 0;
    this.launchBy = null;
    if (kby < 0 && this.grounded) {
      this.grounded = false;
      this.surfaceId = null;
    }
    this.setState(S.HITSTUN);
  }

  /**
   * DIRECTIONAL INFLUENCE: la dirección mantenida en el primer frame tras el
   * hitlag gira la trayectoria hasta ±18° (ver combat.applyDI). Solo la
   * perpendicular cuenta: es lo que separa sobrevivir al 150% de morir al 100%.
   */
  applyPendingDI() {
    this.pendingDI = false;
    if (this.state !== S.HITSTUN) return;
    const inp = this.input;
    const stickX = inp.horizontal;
    const stickY = (inp.held.up ? 1 : 0) - (inp.held.down ? 1 : 0);
    if (stickX === 0 && stickY === 0) return;
    const di = applyDI(this.kbx, this.kby, stickX, stickY);
    this.kbx = di.kbx;
    this.kby = di.kby;
  }

  enterBuried(frames) {
    this.releaseHolds();
    this.move = null;
    this.moveId = null;
    this.vx = 0;
    this.vy = 0;
    this.kbx = 0;
    this.kby = 0;
    this.buryTimer = frames;
    this.hitFlash = 8;
    this.setState(S.BURIED);
  }

  tickBuried() {
    // Machacar botones acorta el entierro, como en Smash.
    const inp = this.input;
    if (inp.pressed.attack || inp.pressed.special || inp.pressed.jump || inp.pressed.shield) this.buryTimer -= 2;
    this.buryTimer -= 1;
    if (this.buryTimer > 0) return true;
    this.grounded = false;
    this.surfaceId = null;
    this.vy = -7;
    this.setState(S.AIR);
    this.world.emit({ type: 'unbury', slot: this.slot, x: this.x, y: this.y });
    return false;
  }

  tickHitstun() {
    this.hitstun -= 1;
    if (this.grounded) applyFriction(this, true);
    if (this.hitstun > 0) return;
    if (!this.grounded) {
      this.setState(this.tumble ? S.TUMBLE : S.AIR);
    } else {
      this.tumble = false;
      this.setState(S.IDLE);
    }
  }

  tickKnockdown() {
    applyFriction(this, true);
    if (this.stateFrame < KNOCKDOWN_MIN) return;
    const inp = this.input;
    if (inp.pressed.attack || inp.pressed.smash) {
      this.startMove('getup_attack');
    } else if (inp.pressed.left || inp.pressed.right) {
      this.startGetupRoll(inp.horizontal);
    } else if (inp.pressed.jump || inp.pressed.up || inp.pressed.shield || this.stateFrame >= KNOCKDOWN_MAX) {
      this.startMove('getup');
    }
  }

  startGetupRoll(dir) {
    if (dir === 0 || !this.startMove('getup_roll')) return;
    this.driftSign = dir === this.facing ? 1 : -1;
  }

  // --- Agarres ---------------------------------------------------------------

  /** Llamado por la simulación cuando la caja de agarre atrapa a `victim`. */
  grabVictim(victim) {
    this.holding = victim;
    this.move = null;
    this.moveId = null;
    this.vx = 0;
    this.grabTimer = Math.min(200, GRAB_BASE_FRAMES + Math.floor(victim.percent * 0.4));
    this.setState(S.GRABBING);
    victim.releaseHolds();
    victim.move = null;
    victim.moveId = null;
    victim.charging = false;
    victim.heldBy = this;
    victim.vx = 0;
    victim.vy = 0;
    victim.kbx = 0;
    victim.kby = 0;
    victim.setState(S.GRABBED);
    this.positionHeld();
  }

  /**
   * AGARRE DE COMANDO (`commandGrab` en la caja): la simulación ha atrapado a
   * `victim`. Empieza el movimiento del picado (`moveId`, con `slam`),
   * llevándoselo agarrado: suben un poco y caen juntos hasta que Samuel
   * toca suelo.
   */
  startSlam(victim, moveId) {
    if (!this.startMove(moveId)) return;
    const slam = this.move.slam;
    this.holding = victim;
    // Sigue el salto tal cual iba (la subida es la del Up-B); si lo ha
    // enganchado sin despegar aún, despega ahora con el impulso del salto.
    if (this.grounded) {
      this.vy = slam.launchVy;
      this.grounded = false;
      this.surfaceId = null;
    }
    this.slamPhase = this.vy < 0 ? 'rise' : 'hang';
    this.slamHang = 0;
    this.vx = 0;
    this.kbx = 0;
    this.kby = 0;
    this.fastFalling = false;
    victim.releaseHolds();
    victim.move = null;
    victim.moveId = null;
    victim.charging = false;
    victim.heldBy = this;
    victim.vx = 0;
    victim.vy = 0;
    victim.kbx = 0;
    victim.kby = 0;
    victim.setState(S.GRABBED);
    this.positionHeld();
  }

  /** Toca suelo en el picado: ESTAMPA al rival (onda a los dos lados) y paga su lag. */
  landSlam(m) {
    this.applyThrow(m.slam);
    this.world.emit({
      type: 'fx', fx: 'slamWave', slot: this.slot, x: this.x, y: this.y, facing: this.facing,
    });
    this.move = null;
    this.moveId = null;
    this.enterLanding(m.landingLag ?? DEFAULT_AERIAL_LANDING_LAG);
  }

  positionHeld() {
    const victim = this.holding;
    if (!victim) return;
    // En el Abrazo Aéreo, mientras sube y en el parón lo lleva EN BRAZOS, en
    // alto por delante; al voltearse, cae delante de él, a su altura.
    const aloft = this.state === S.ACTION && this.move?.slam && this.slamPhase !== 'dive';
    victim.x = this.x + this.facing * (aloft ? 22 : this.halfWidth + victim.halfWidth - 6);
    victim.y = aloft ? this.y - 58 : this.y;
    victim.grounded = this.grounded;
    victim.surfaceId = this.surfaceId;
    victim.facing = -this.facing;
  }

  tickGrabbing() {
    const victim = this.holding;
    applyFriction(this, true);
    if (!victim || victim.state !== S.GRABBED) {
      this.holding = null;
      this.toNeutral();
      return;
    }
    this.positionHeld();
    this.grabTimer -= 1;
    const inp = this.input;
    if (inp.pressed.attack) {
      this.startMove('pummel');
      return;
    }
    const pressedDir = ['left', 'right', 'up', 'down'].find((d) => inp.pressed[d]);
    if (pressedDir) {
      const rel = relativeDirection(pressedDir, this.facing);
      const throwId = { forward: 'fthrow', back: 'bthrow', up: 'uthrow', down: 'dthrow' }[rel];
      this.startMove(throwId);
      return;
    }
    if (this.grabTimer <= 0) this.grabRelease();
  }

  tickGrabbed() {
    const holder = this.heldBy;
    if (!holder || holder.holding !== this) {
      this.heldBy = null;
      this.setState(S.AIR);
      return false;
    }
    const inp = this.input;
    const mashed = ['attack', 'smash', 'special', 'grab', 'shield', 'jump', 'left', 'right', 'up', 'down']
      .filter((k) => inp.pressed[k]).length;
    holder.grabTimer -= mashed * GRAB_MASH;
    return true;
  }

  grabRelease() {
    const victim = this.holding;
    this.holding = null;
    this.toNeutral();
    this.vx = -this.facing * 2;
    if (!victim) return;
    victim.heldBy = null;
    victim.grounded = false;
    victim.surfaceId = null;
    victim.vy = -5;
    victim.vx = this.facing * 3;
    victim.setState(S.AIR);
    this.world.emit({
      type: 'grabRelease', slot: this.slot, x: victim.x, y: victim.y,
    });
  }

  applyPummel({ damage }) {
    const victim = this.holding;
    if (!victim) return;
    victim.percent = Math.min(999, victim.percent + damage);
    victim.hitFlash = 4;
    this.matchStats.damageDealt += damage;
    this.world.onPummel(this, victim, damage);
  }

  applyThrow(spec) {
    const victim = this.holding;
    if (!victim) return;
    const direction = spec.reverse ? -this.facing : this.facing;
    // El lanzamiento hacia atrás se lleva al rival al otro lado ANTES de
    // soltarlo: si se lanzara desde delante, atravesaría a Samuel.
    if (spec.reverse) {
      victim.x = this.x - this.facing * (this.halfWidth + victim.halfWidth);
    }
    this.holding = null;
    victim.heldBy = null;
    const percentBefore = victim.percent;
    victim.percent = Math.min(999, victim.percent + spec.damage);
    const kb = calculateKnockback(percentBefore, spec.damage, victim.stats.weight, spec.bkb, spec.kbg);
    const { kbx, kby } = knockbackVelocity(kb, spec.angle, direction);
    victim.grounded = false;
    victim.surfaceId = null;
    victim.applyLaunch({
      kbx, kby: Math.min(kby, -0.5), hitstun: hitstunFrames(kb), tumble: isTumble(kb),
    });
    this.matchStats.damageDealt += spec.damage;
    this.world.onThrow(this, victim, spec, kb);
  }

  /** Suelta cualquier agarre en curso, en los dos sentidos. */
  releaseHolds() {
    if (this.holding) {
      const victim = this.holding;
      this.holding = null;
      victim.heldBy = null;
      if (victim.state === S.GRABBED) {
        victim.grounded = false;
        victim.surfaceId = null;
        victim.setState(S.AIR);
      }
    }
    if (this.heldBy) {
      const holder = this.heldBy;
      this.heldBy = null;
      if (holder.holding === this) holder.holding = null;
    }
  }

  // --- Física --------------------------------------------------------------------

  gravitySuspended() {
    if (this.state === S.ACTION && this.moveId === 'airdodge' && this.airDodgeDir
      && this.moveFrame <= AIR_DODGE_TRAVEL) return true;
    // El picado fija su velocidad: la gravedad la recortaría a la terminal.
    const dive = this.state === S.ACTION ? this.move?.dive : null;
    if (dive && this.moveFrame >= dive.from && this.moveFrame <= dive.to) return true;
    // El parón y el picado fijan su velocidad; la subida lleva gravedad.
    if (this.state === S.ACTION && this.move?.slam && this.slamPhase !== 'rise') return true;
    return false;
  }

  passesPlatforms() {
    if (this.dropThroughFrames > 0) return true;
    // Mantener abajo al caer atraviesa las semisólidas (como en Smash). No
    // durante el hitstun: un lanzado no elige dónde cae.
    if (!this.input.held.down || this.vy + this.kby <= 0) return false;
    return this.state === S.AIR || this.state === S.TUMBLE || this.state === S.HELPLESS
      || (this.state === S.ACTION && this.move?.landingLag != null);
  }

  physicsStep() {
    if (!this.grounded && !this.gravitySuspended()) {
      applyGravity(this, {
        gravity: this.stats.gravity,
        maxFallSpeed: this.stats.maxFallSpeed,
        fastFallSpeed: this.fastFallSpeed(),
        fastFalling: this.fastFalling,
      });
    }
    decayKnockback(this);
    const wasGrounded = this.grounded;
    const result = moveBody(this, this.world.geometry, { passPlatforms: this.passesPlatforms() });
    if (this.holding) this.positionHeld();

    if (result.landed) this.onLand(result);
    if (result.wall !== 0) this.onWall(result.wall);
    if (result.ceiling) this.onCeiling();
    if (wasGrounded && result.leftSurface && !this.grounded) this.onLeaveGround();
  }

  isTumbling() {
    return this.state === S.TUMBLE || (this.state === S.HITSTUN && this.tumble);
  }

  onLand(result) {
    const landSpeed = result.landSpeed;
    const tumbling = this.isTumbling();
    this.vy = 0;
    this.kby = 0;
    this.jumpsLeft = this.stats.airJumps;
    this.airDodgeUsed = false;
    this.fastFalling = false;
    const helplessLanding = this.state === S.HELPLESS;
    this.helpless = false;

    if (tumbling) {
      this.landTumbling();
      return;
    }
    switch (this.state) {
      case S.HITSTUN:
        // Hitstun sin tumble: sigue aturdido en el suelo, deslizando.
        break;
      case S.SHIELD_BREAK:
        this.setState(S.DIZZY);
        break;
      case S.ACTION: {
        const m = this.move;
        if (m.continueOnLand || m.ledgePath) break;
        if (m.slam) {
          this.landSlam(m);
          break;
        }
        // AUTOCANCEL: si los frames activos del aéreo ya han pasado, el
        // aterrizaje solo cuesta el lag pasivo. Si toca suelo en mitad del
        // golpe, paga el landing lag del movimiento (6-8 en los aéreos).
        const lastActive = Math.max(0, ...(m.hitboxes || []).map((hb) => hb.to));
        const autocancel = m.landingLag != null && lastActive > 0 && this.moveFrame > lastActive;
        const lag = autocancel ? AUTOCANCEL_LANDING_LAG : (m.landingLag ?? DEFAULT_AERIAL_LANDING_LAG);
        this.move = null;
        this.moveId = null;
        this.charging = false;
        this.enterLanding(lag);
        break;
      }
      case S.GRABBING:
      case S.GRABBED:
      case S.CHARGE:
        break;
      default:
        this.enterLanding(helplessLanding ? HELPLESS_LANDING_LAG : LANDING_LAG);
    }
    this.world.emit({
      type: 'land', slot: this.slot, x: this.x, y: this.y, speed: landSpeed,
    });
  }

  enterLanding(frames) {
    this.lagFrames = frames;
    this.setState(S.LANDING);
    // Lo pulsado justo antes de tocar suelo sobrevive al lag entero y sale en
    // el primer frame libre.
    this.input.extendBuffers(frames);
  }

  // Aterrizar dando tumbos: TECH si se pulsó escudo en los 10 frames previos
  // (con dirección = rodada tech), y si no, MISSED TECH: tumbado en el suelo
  // para el okizeme.
  landTumbling() {
    this.tumble = false;
    this.hitstun = 0;
    if (this.canTech()) {
      this.kbx = 0;
      this.vx = 0;
      this.techPressFrame = -Infinity;
      const dir = this.input.horizontal;
      if (dir !== 0) {
        this.startMove('tech_roll');
        this.driftSign = dir === this.facing ? 1 : -1;
      } else {
        this.startMove('tech');
      }
      this.world.emit({
        type: 'tech', slot: this.slot, x: this.x, y: this.y,
      });
      return;
    }
    this.kbx *= 0.5;
    this.setState(S.KNOCKDOWN);
    this.world.emit({
      type: 'missedTech', slot: this.slot, x: this.x, y: this.y,
    });
  }

  onWall(side) {
    if (!this.isTumbling()) return;
    if (this.canTech()) {
      this.techPressFrame = -Infinity;
      this.kbx = 0;
      this.kby = 0;
      this.vx = 0;
      this.vy = 0;
      this.intangibleFrames = 12;
      this.tumble = false;
      this.hitstun = 0;
      this.setState(S.AIR);
      this.world.emit({
        type: 'tech', slot: this.slot, x: this.x + side * this.halfWidth, y: this.y - this.height / 2, wall: true,
      });
      return;
    }
    this.kbx = -this.kbx * 0.6;
    this.world.emit({
      type: 'wallBounce', slot: this.slot, x: this.x + side * this.halfWidth, y: this.y - this.height / 2,
    });
  }

  onCeiling() {
    this.vy = Math.max(0, this.vy);
    if (!this.isTumbling()) {
      this.kby = Math.max(0, this.kby);
      return;
    }
    if (this.canTech()) {
      this.techPressFrame = -Infinity;
      this.kbx = 0;
      this.kby = 0;
      this.intangibleFrames = 12;
      this.tumble = false;
      this.hitstun = 0;
      this.setState(S.AIR);
      this.world.emit({
        type: 'tech', slot: this.slot, x: this.x, y: this.y - this.height, wall: true,
      });
      return;
    }
    this.kby = -this.kby * 0.6;
  }

  onLeaveGround() {
    // Salirse andando (o deslizando) del borde de una superficie.
    if (GROUND_NEUTRAL.has(this.state) || this.state === S.LANDING || this.state === S.SHIELD
      || this.state === S.SHIELD_DROP || this.state === S.SHIELDSTUN || this.state === S.DIZZY
      || this.state === S.CHARGE) {
      if (this.state === S.CHARGE) this.storedChargeFrames = this.chargeFrames;
      this.setState(S.AIR);
    } else if (this.state === S.KNOCKDOWN) {
      this.tumble = true;
      this.setState(S.TUMBLE);
    }
    // ACTION y HITSTUN siguen su curso en el aire.
  }

  // --- Muerte y respawn ------------------------------------------------------

  die() {
    this.releaseHolds();
    this.clearCombatState();
    this.vx = 0;
    this.vy = 0;
    this.kbx = 0;
    this.kby = 0;
    this.grounded = false;
    this.surfaceId = null;
    this.respawnTimer = RESPAWN_DELAY_FRAMES;
    this.setState(this.stocks > 0 ? S.DEAD : S.ELIMINATED);
  }

  tickDead() {
    this.respawnTimer -= 1;
    if (this.respawnTimer <= 0) this.world.respawn(this);
    return true;
  }

  /** Aparece sobre la plataforma de reaparición, al 0%, mirando a `facing`. */
  respawnAt(point, facing) {
    this.clearCombatState();
    this.x = point.x;
    this.y = point.y;
    this.vx = 0;
    this.vy = 0;
    this.kbx = 0;
    this.kby = 0;
    this.grounded = false;
    this.surfaceId = null;
    this.percent = 0;
    this.shieldHp = this.stats.shieldMax;
    this.facing = facing;
    this.respawnFrames = 0;
    this.setState(S.RESPAWN);
  }

  // 120 frames de invulnerabilidad sobre la plataforma, o hasta el primer
  // input (sección 2.A): lo que llegue antes.
  tickRespawn() {
    this.respawnFrames += 1;
    const inp = this.input;
    const anyInput = Object.values(inp.pressed).some(Boolean) || inp.horizontal !== 0;
    if (this.respawnFrames < RESPAWN_INVULN_FRAMES && !anyInput) return true;
    this.setState(S.AIR);
    this.world.emit({ type: 'respawnLeave', slot: this.slot, x: this.x, y: this.y });
    return false;
  }

  // --- Modo Despertar (prototipo) ---------------------------------------------

  /** Despierta durante `frames` frames de mundo (la simulación lo llama al
   *  acabar la cinemática de corte): aspecto, stats y tabla despertados. La
   *  transformación le devuelve todos los saltos. */
  awaken(frames) {
    this.awakenFrames = frames;
    this.jumpsLeft = this.stats.airJumps;
    this.freeFinalUsed = false;
  }

  get awakened() {
    return this.awakenFrames > 0;
  }

  // --- Vista (lo que se dibuja y lo que viaja por red) ------------------------

  animation() {
    switch (this.state) {
      case S.ACTION: {
        // Fase canónica del golpe (engine/movePhase.js): el impacto de la
        // pose cae siempre sobre los frames activos de ESTE movimiento.
        const m = this.move;
        // Abrazo Aéreo: sube y se para con el rival EN ALTO (`risePose`).
        if (m.slam?.risePose && this.slamPhase !== 'dive') return { name: m.slam.risePose, progress: 0.45 };
        const frame = this.charging ? m.charge.frame : this.moveFrame;
        return { name: m.pose, progress: movePhase(m, frame) };
      }
      case S.CHARGE: {
        // Cargando el especial neutro: la pose del movimiento, avanzada por
        // lo cargado que está (Samuel se hincha).
        const nspecial = this.moves.nspecial;
        const max = nspecial.chargeShot?.maxFrames ?? 1;
        return { name: nspecial.pose, progress: Math.min(1, this.chargeFrames / max) };
      }
      case S.WALK: return { name: 'walk-fwd', progress: -1 };
      case S.DASH:
      case S.RUN: return { name: 'walk-fwd', progress: -1, fast: true };
      case S.CROUCH:
      case S.JUMPSQUAT:
      case S.LANDING: return { name: 'crouch', progress: -1 };
      case S.AIR: return { name: this.vy < 0 ? 'jump_rise' : 'jump_fall', progress: -1 };
      case S.HELPLESS: return { name: 'jump_fall', progress: -1 };
      case S.SHIELD:
      case S.SHIELDSTUN:
      case S.SHIELD_DROP:
      case S.GRABBING: return { name: 'block', progress: -1 };
      case S.HITSTUN:
        if (this.grounded && !this.tumble) {
          return { name: 'hitstun', progress: Math.min(1, this.stateFrame / Math.max(1, this.stateFrame + this.hitstun)) };
        }
        return { name: 'air_hurt', progress: -1 };
      case S.TUMBLE:
      case S.TRUMPED:
      case S.SHIELD_BREAK: return { name: 'air_hurt', progress: -1 };
      case S.KNOCKDOWN: return { name: 'knockdown', progress: -1 };
      case S.DIZZY: return { name: 'stagger', progress: -1 };
      case S.LEDGE_HANG: return { name: 'jump_rise', progress: -1 };
      case S.GRABBED:
      case S.BURIED: return { name: 'hitstun', progress: 0.5 };
      case S.CINEMATIC: return { name: this.cinePose || 'idle', progress: this.cineProgress };
      default: return { name: 'idle', progress: -1 };
    }
  }

  /**
   * Todo lo que necesitan el renderer, el HUD y la cámara, en un objeto plano.
   * El host lo construye cada tick y lo MANDA TAL CUAL en el snapshot: el
   * cliente remoto dibuja exactamente lo mismo sin conocer la máquina de
   * estados (ver main.js).
   */
  view() {
    const anim = this.animation();
    const m = this.state === S.ACTION ? this.move : null;
    const first = m?.hitboxes?.[0];
    const frames = m?.frames ?? 1;
    const tumbling = this.isTumbling();
    return {
      slot: this.slot,
      id: this.id,
      name: this.name,
      color: this.color,
      art: this.art,
      x: this.x,
      y: this.y,
      facing: this.facing,
      grounded: this.grounded,
      vx: this.vx + this.kbx,
      vy: this.vy + this.kby,
      state: this.state,
      stateFrame: this.stateFrame,
      anim: anim.name,
      progress: anim.progress,
      fast: !!anim.fast,
      flip: !!m?.flipSprite,
      moveTag: m ? `${this.moveId}#${this.moveInstance}` : null,
      actFrom: first ? first.from / frames : 0,
      actTo: first ? first.to / frames : 0,
      // Tumble: gira. Agarrado en el picado del abrazo aéreo: cabeza abajo.
      spin: tumbling ? this.stateFrame * 0.32 * (this.kbx >= 0 ? 1 : -1)
        : (this.state === S.GRABBED && this.heldBy?.move?.slam && this.heldBy.slamPhase === 'dive' ? Math.PI : 0),
      percent: this.percent,
      stocks: this.stocks,
      meter: this.meter,
      // Despertar: el render cambia al sprite de rapero y dibuja el aura.
      awakened: this.awakened,
      awakenLeft: this.awakenFrames,
      // Dentro de la nube del puro: se mueve un 40% más lento.
      slowed: this.slowFactor < 1,
      meterMax: this.stats.finalMeterMax,
      shield: this.isShielding() ? this.shieldHp / this.stats.shieldMax : -1,
      intangible: this.isIntangible() && this.state !== S.CINEMATIC,
      hitFlash: this.hitFlash,
      armorFlash: this.armorFlash,
      charge: this.charging ? Math.min(1, this.chargeFrames / this.move.charge.max) : 0,
      chargeShot: this.state === S.CHARGE ? this.chargeLevel(this.chargeFrames) : 0,
      storedCharge: this.storedChargeFrames > 0 ? this.chargeLevel(this.storedChargeFrames) : 0,
      helpless: this.state === S.HELPLESS,
      counter: this.counterActive(),
      buried: this.state === S.BURIED,
      visible: this.isAlive,
      respawning: this.state === S.RESPAWN,
      dizzy: this.state === S.DIZZY,
      // Estela de lanzamiento (presentación): 1 = humo denso (KB > 38), 2 =
      // además teñida del color de quien golpeó (KB > 60). Solo mientras dura
      // el vuelo sin control: hitstun o tumble.
      trail: (this.state === S.HITSTUN || this.state === S.TUMBLE) && this.launchKb > TRAIL_KB
        ? (this.launchKb > TRAIL_TINT_KB ? 2 : 1) : 0,
      trailBy: this.launchBy,
      width: FIGHTER_WIDTH,
      height: FIGHTER_HEIGHT,
      bodyHeight: this.height,
      stats: { ...this.matchStats },
    };
  }
}

