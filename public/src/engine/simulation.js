// SIMULACIÓN DETERMINISTA DEL COMBATE, a 60 Hz.
//
// Es TODO lo que decide qué pasa en la partida, y nada más: sin canvas, sin
// audio, sin red, sin reloj real. `step(inputs)` avanza exactamente un frame,
// así que la misma secuencia de inputs produce siempre la misma partida (hay
// un test que lo exige comparando dos simulaciones frame a frame). Por eso se
// puede probar entera en Node, y por eso el modelo host-autoritativo funciona:
// solo el host la ejecuta, y el resto recibe `serialize()` por la red.
//
// Reparto de responsabilidades, el mismo de siempre en este proyecto:
//   - characters/fighter.js  cada luchador decide con su input y obedece
//                            cuando le golpean (receiveHit);
//   - engine/combat.js       la matemática del knockback, pura;
//   - aquí                   lo que necesita ver a LOS DOS a la vez: golpes
//                            simultáneos, agarres, proyectiles, blast zones,
//                            stocks, el Final Smash y el flujo de partida.
// La simulación DECIDE y EMITE eventos (`events`); main.js es quien los
// convierte en chispas, sonido, sacudidas y paquetes de red.

import {
  Fighter, STATES, STARTING_STOCKS,
} from '../characters/fighter.js';
import { ProjectileSystem, PROJECTILE_KINDS } from './projectiles.js';
import {
  boxesOverlap, hitlagFrames, calculateKnockback, knockbackVelocity, hitstunFrames, lethalHitstunFrames, isTumble,
} from './combat.js';
import { createEmptyInputState, sanitizeInput } from './inputManager.js';
import { predictCertainKO, blastSide } from './killPredictor.js';

export const PHASES = Object.freeze({
  LOBBY: 'lobby', // juego libre de calentamiento: se muere y se reaparece sin perder stocks
  COUNTDOWN: 'countdown', // 3, 2, 1...
  FIGHT: 'fight', // partida a stocks
  GAME: 'game', // ¡GAME! a cámara lenta
  RESULTS: 'results', // ganador y revancha
});

export const COUNTDOWN_FRAMES = 180;
export const GAME_SET_FRAMES = 150;
// Cámara lenta del ¡GAME!: el mundo avanza un frame de cada tres.
const GAME_SLOWMO_EVERY = 3;
const GAME_SLOWMO_FRAMES = 90;

// Medidor de Final Smash: el atacante carga el daño que hace; la víctima, la
// mitad del que recibe (el que va perdiendo también llega a tenerlo).
const METER_ON_HIT = 1.0;
const METER_ON_DAMAGE = 0.5;
// Hitlag extra al atacante cuyo golpe ha sido contraatacado: es el castigo
// visible de haber pegado a un Samuel fumando.
const COUNTER_HITLAG = 12;
// SPECIAL ZOOM: un golpe que va a matar SIN REMEDIO (ver killPredictor.js)
// alarga el hitlag estos frames. Es estado de la simulación —las dos
// pantallas se congelan el mismo tiempo— y no cambia el resultado del golpe:
// el DI se sigue leyendo al acabar la congelación.
export const SPECIAL_ZOOM_FRAMES = 10;

// MODO DESPERTAR (prototipo, tecla Ñ). La cinemática de corte congela el
// combate 2 s; en el frame 60 hay un corte seco al retrato transformado; al
// acabar, el luchador queda DESPERTADO 10 s. Sin medidor ni condiciones: por
// ahora solo se prueba la cinemática y la transformación.
export const AWAKEN_CUTIN_FRAMES = 120;
export const AWAKEN_CUT_FRAME = 60;
export const AWAKEN_FRAMES = 600;
// Batalla de Gallos DEFINITIVA: si el rival tenía más del `autoKoAbove` de la
// spec al empezar la cinemática, el K.O. es automático: la detonación lanza
// con AL MENOS este knockback (40 px/f), que cruza una blast zone desde
// cualquier punto de la arena y con cualquier DI.
export const AUTO_KO_KNOCKBACK = 400;
const NEUTRAL = createEmptyInputState();

/**
 * Punto EXACTO en que el centro del cuerpo cruzó la línea de la blast zone
 * `side` en este tick (interpolando el recorrido prev -> actual). La
 * detonación del K.O. nace ahí, no en la posición del frame siguiente, que a
 * 15 px/f puede estar ya bastante más allá.
 */
export function crossingPoint(bz, side, px, py, cx, cy) {
  const limit = bz[side];
  const horizontal = side === 'left' || side === 'right';
  const from = horizontal ? px : py;
  const to = horizontal ? cx : cy;
  const t = to === from ? 1 : Math.max(0, Math.min(1, (limit - from) / (to - from)));
  const x = px + (cx - px) * t;
  const y = py + (cy - py) * t;
  return {
    x: horizontal ? limit : Math.max(bz.left, Math.min(bz.right, x)),
    y: horizontal ? Math.max(bz.top, Math.min(bz.bottom, y)) : limit,
  };
}

export class Simulation {
  /**
   * @param {object} opts
   * @param {object} opts.geometry        geometría del escenario (stages/*.js)
   * @param {object} opts.p1, opts.p2     configs del roster
   */
  constructor({ geometry, p1, p2 }) {
    this.geometry = geometry;
    this.fighters = [
      new Fighter({ slot: 'p1', config: p1 }),
      new Fighter({ slot: 'p2', config: p2 }),
    ];
    this.projectiles = new ProjectileSystem();
    this.frame = 0;
    this.hitlag = 0;
    this.cine = null;
    this.events = [];
    this.opponentPresent = false;
    this.phase = PHASES.LOBBY;
    this.phaseFrame = 0;
    this.ready = { p1: false, p2: false };
    this.winner = null;
    this.paused = false;
    this.pausedBy = null;
    // Cinemática de corte del Despertar en curso: { slot, frame, total }.
    this.cutin = null;
    this.menuPrev = { p1: createEmptyInputState(), p2: createEmptyInputState() };
    this.placeAtSpawns();
  }

  get p1() {
    return this.fighters[0];
  }

  get p2() {
    return this.fighters[1];
  }

  fighter(slot) {
    return slot === 'p1' ? this.fighters[0] : this.fighters[1];
  }

  opponentOf(f) {
    return f === this.fighters[0] ? this.fighters[1] : this.fighters[0];
  }

  // --- API que usa Fighter ----------------------------------------------------

  get controlsEnabled() {
    return this.phase === PHASES.LOBBY || this.phase === PHASES.FIGHT;
  }

  emit(event) {
    this.events.push(event);
  }

  spawnProjectile(owner, spec) {
    const p = this.projectiles.spawn(owner, spec);
    if (p) {
      this.emit({
        type: 'projectileSpawn', kind: p.kind, slot: owner.slot, x: p.x, y: p.y, dir: p.dir,
      });
    }
  }

  respawn(f) {
    if (f.stocks <= 0) {
      f.setState(STATES.ELIMINATED);
      return;
    }
    const point = this.geometry.respawn;
    f.respawnAt(point, f.slot === 'p1' ? 1 : -1);
    this.emit({
      type: 'respawn', slot: f.slot, x: point.x, y: point.y,
    });
  }

  onPummel(attacker, victim, damage) {
    this.gainMeter(attacker, victim, damage);
    this.hitlag = Math.max(this.hitlag, 3);
    this.emit({
      type: 'hit',
      slot: attacker.slot,
      victim: victim.slot,
      x: victim.x,
      y: victim.y - victim.height * 0.6,
      damage,
      kb: 0,
      outcome: 'hit',
      sfx: 'hit_light',
      vfx: null,
      dir: attacker.facing,
    });
  }

  onThrow(attacker, victim, spec, kb) {
    this.gainMeter(attacker, victim, spec.damage);
    this.markLaunch(victim, attacker, kb);
    const lethal = this.resolveLethal(victim, kb);
    const lag = hitlagFrames(spec.damage) + (lethal ? SPECIAL_ZOOM_FRAMES : 0);
    this.hitlag = Math.max(this.hitlag, lag);
    this.emit({
      type: 'hit',
      slot: attacker.slot,
      victim: victim.slot,
      x: victim.x,
      y: victim.y - victim.height * 0.5,
      damage: spec.damage,
      kb,
      outcome: 'hit',
      sfx: 'hit_heavy',
      vfx: null,
      dir: spec.reverse ? -attacker.facing : attacker.facing,
      lethal,
      freeze: lag,
    });
  }

  /** Quién lanzó y con cuánto: lo lee la estela de la vista. */
  markLaunch(victim, source, kb) {
    victim.launchKb = kb;
    victim.launchBy = source.slot;
  }

  /**
   * ¿Este lanzamiento mata sin remedio? Se prueba con el hitstun LARGO
   * (floor(KB·0.4)) y todo el abanico de DI. Si mata, la víctima se queda con
   * ese hitstun —el K.O. está garantizado y no hay ventana que darle— y el
   * golpe lleva Special Zoom. Si no, se queda con el hitstun corto que le puso
   * el golpe (combat.hitstunFrames) y recupera el control en ≤ 22 frames.
   *
   * Es LA regla del desacople: la inmovilidad larga solo existe en un golpe
   * que mata. Fuera del ¡GAME! a cámara lenta (ahí no se anuncia nada más),
   * es igual en partida y en el calentamiento.
   */
  resolveLethal(victim, totalKnockback) {
    if (this.phase !== PHASES.FIGHT && this.phase !== PHASES.LOBBY) return false;
    const hitstun = Math.max(victim.hitstun, lethalHitstunFrames(totalKnockback));
    if (!predictCertainKO(victim, this.geometry, hitstun)) return false;
    victim.hitstun = hitstun;
    return true;
  }

  gainMeter(attacker, victim, damage) {
    if (this.phase !== PHASES.FIGHT && this.phase !== PHASES.LOBBY) return;
    attacker.meter = Math.min(attacker.stats.finalMeterMax, attacker.meter + damage * METER_ON_HIT);
    victim.meter = Math.min(victim.stats.finalMeterMax, victim.meter + damage * METER_ON_DAMAGE);
  }

  // --- Colocación y reinicios ---------------------------------------------------

  placeAtSpawns() {
    for (const f of this.fighters) f.resetForMatch(this.geometry.spawns[f.slot]);
    this.projectiles.clear();
    this.cine = null;
    this.cutin = null;
    this.hitlag = 0;
  }

  setOpponentPresent(present) {
    if (this.opponentPresent === present) return;
    this.opponentPresent = present;
    // Si el rival se va a mitad de partida, no se sigue contra un muñeco que
    // no controla nadie: vuelta al calentamiento.
    if (!present && this.phase !== PHASES.LOBBY) this.enterPhase(PHASES.LOBBY);
    // Una pausa del que se ha ido no puede dejar la partida congelada.
    if (!present && this.pausedBy === 'p2') this.setPaused(false, 'p2');
  }

  setPaused(paused, slot) {
    this.paused = paused;
    this.pausedBy = paused ? slot : null;
    this.emit({ type: 'pause', paused, slot });
  }

  enterPhase(phase) {
    this.phase = phase;
    this.phaseFrame = 0;
    if (this.paused) this.setPaused(false, this.pausedBy);
    if (phase === PHASES.LOBBY || phase === PHASES.COUNTDOWN) {
      this.ready = { p1: false, p2: false };
      this.winner = null;
      this.placeAtSpawns();
    }
    this.emit({ type: 'phase', phase });
  }

  // --- Tick ---------------------------------------------------------------------

  /**
   * Avanza UN frame.
   * @param {{ p1: object, p2: object }} inputs  input crudo de cada ranura
   */
  step(inputs = {}) {
    const input = {
      p1: sanitizeInput(inputs.p1),
      p2: this.opponentPresent ? sanitizeInput(inputs.p2) : NEUTRAL,
    };
    const edge = (key) => ({
      p1: this.pressedMenu('p1', input.p1, key),
      p2: this.pressedMenu('p2', input.p2, key),
    });
    const startPressed = edge('start');
    const pausePressed = edge('pause');
    const awakenPressed = edge('awaken');
    this.menuPrev = { p1: { ...input.p1 }, p2: { ...input.p2 } };

    // PAUSA. Es estado de la SIMULACIÓN, no un menú local: congela a los dos
    // luchadores en el mismo frame y viaja en el snapshot, así que las dos
    // pantallas se paran a la vez y el host sigue mandando snapshots (no hay
    // hueco que el cliente remoto pueda tomar por un host caído). Mientras
    // dura, NADA avanza — ni `frame`, ni la fase, ni el hitlag —, así que
    // pausar no cambia la partida: la misma secuencia de inputs jugados da el
    // mismo resultado con o sin pausas (hay un test que lo exige).
    //
    // Pausa quien quiera; reanuda SOLO quien pausó (como en Smash): si no, el
    // rival podría quitarle la guía de las manos en cuanto la abre.
    // El tick en que se pulsa ESC se CONSUME en los dos sentidos (al pausar
    // y al reanudar): si el de reanudar avanzara la partida, cada pausa
    // costaría un frame de juego y pausar dejaría de ser invisible.
    const toggled = this.updatePause(pausePressed);
    if (this.paused || toggled) {
      // Las teclas con las que se navega la guía no pueden salir como saltos
      // o ataques al reanudar: se absorbe el estado mantenido sin flancos.
      for (const f of this.fighters) f.input.absorb(input[f.slot]);
      return;
    }

    // DESPERTAR. La cinemática de corte es estado de la simulación (viaja en
    // el snapshot): las dos pantallas congelan y cortan en el mismo frame.
    // Mientras dura, el mundo no avanza (ni la fase), pero el input sigue
    // entrando en el buffer, como en el hitlag.
    if (!this.cutin) this.startAwakening(awakenPressed);
    if (this.cutin) {
      this.frame += 1;
      this.tickCutin(input);
      return;
    }

    this.frame += 1;
    this.phaseFrame += 1;
    this.updateFlow(startPressed);

    if (this.hitlag > 0) {
      this.hitlag -= 1;
      // El hitlag congela a los luchadores, NO su input: lo pulsado durante
      // la congelación entra en el buffer (y la ventana del buffer se congela
      // con el mundo), así que sale en el primer frame libre. Antes, una
      // pulsación hecha y soltada dentro de un hitlag de 18 frames se perdía,
      // y con ella también el escudo del tech.
      for (const f of this.fighters) {
        f.input.update(this.controlsEnabled ? input[f.slot] : NEUTRAL, this.frame);
        f.input.extendBuffers(1);
        f.recordTechPress(this.frame);
      }
      return;
    }
    if (this.cine) {
      this.tickCinematic();
      return;
    }
    if (this.phase === PHASES.GAME && this.phaseFrame < GAME_SLOWMO_FRAMES
      && this.phaseFrame % GAME_SLOWMO_EVERY !== 0) return;

    for (const f of this.fighters) f.update(input[f.slot], this);
    this.resolveLedgeTrumps();
    for (const e of this.projectiles.update(this.geometry, this.geometry.blastZones)) this.emit(e);
    this.applyFields();
    this.resolveHits();
    this.checkBlastZones();
  }

  // --- Modo Despertar (prototipo) --------------------------------------------

  /** ¿Puede `f` despertar ahora? Vivo, en combate o calentamiento, y sin nada
   *  que ya congele o controle el mundo (otra cinemática). */
  canAwaken(f) {
    if (this.phase !== PHASES.FIGHT && this.phase !== PHASES.LOBBY) return false;
    if (this.cine || f.awakened) return false;
    return !['dead', 'eliminated', 'cinematic'].includes(f.state);
  }

  startAwakening(awakenPressed) {
    const slots = this.opponentPresent ? ['p1', 'p2'] : ['p1'];
    for (const slot of slots) {
      const f = this.fighter(slot);
      if (!awakenPressed[slot] || !this.canAwaken(f)) continue;
      this.cutin = { slot, frame: 0, total: AWAKEN_CUTIN_FRAMES };
      this.emit({ type: 'awakenStart', slot, x: f.x, y: f.y - f.height / 2 });
      return;
    }
  }

  tickCutin(input) {
    const cutin = this.cutin;
    cutin.frame += 1;
    for (const f of this.fighters) {
      f.input.update(this.controlsEnabled ? input[f.slot] : NEUTRAL, this.frame);
      f.input.extendBuffers(1);
    }
    if (cutin.frame === AWAKEN_CUT_FRAME) this.emit({ type: 'awakenCut', slot: cutin.slot });
    if (cutin.frame < cutin.total) return;
    const f = this.fighter(cutin.slot);
    this.cutin = null;
    f.awaken(AWAKEN_FRAMES);
    this.emit({ type: 'awakenReady', slot: f.slot, x: f.x, y: f.y - f.height / 2 });
  }

  // --- Flujo de partida -------------------------------------------------------

  pressedMenu(slot, input, key) {
    const was = this.menuPrev[slot][key];
    return input[key] && !was;
  }

  // Solo se pausa donde hay algo que congelar: el calentamiento y el combate.
  // En la cuenta atrás, el ¡GAME! o los resultados la pausa no significa nada.
  updatePause(pausePressed) {
    const slots = this.opponentPresent ? ['p1', 'p2'] : ['p1'];
    for (const slot of slots) {
      if (!pausePressed[slot]) continue;
      if (!this.paused && (this.phase === PHASES.FIGHT || this.phase === PHASES.LOBBY)) {
        this.setPaused(true, slot);
        return true;
      }
      if (this.paused && this.pausedBy === slot) {
        this.setPaused(false, slot);
        return true;
      }
      return false;
    }
    return false;
  }

  updateFlow(startPressed) {
    const present = this.opponentPresent ? ['p1', 'p2'] : ['p1'];

    switch (this.phase) {
      case PHASES.LOBBY:
      case PHASES.RESULTS:
        // Listo / revancha: ENTER. En solitario basta con P1 (el rival es un
        // muñeco de prácticas), igual que en el selector de antes.
        for (const slot of present) {
          if (startPressed[slot]) {
            this.ready[slot] = !this.ready[slot];
            this.emit({ type: 'ready', slot, ready: this.ready[slot] });
          }
        }
        if (present.every((slot) => this.ready[slot])) this.enterPhase(PHASES.COUNTDOWN);
        break;
      case PHASES.COUNTDOWN:
        if (this.phaseFrame % 60 === 1) {
          this.emit({ type: 'countdown', n: 3 - Math.floor(this.phaseFrame / 60) });
        }
        if (this.phaseFrame >= COUNTDOWN_FRAMES) this.enterPhase(PHASES.FIGHT);
        break;
      case PHASES.FIGHT: {
        const out = this.fighters.filter((f) => f.state === STATES.ELIMINATED);
        if (out.length > 0) {
          this.winner = out.length === 2 ? null : this.opponentOf(out[0]).slot;
          this.enterPhase(PHASES.GAME);
        }
        break;
      }
      case PHASES.GAME:
        if (this.phaseFrame >= GAME_SET_FRAMES) this.enterPhase(PHASES.RESULTS);
        break;
      default:
        break;
    }
  }

  // --- Borde -------------------------------------------------------------------

  /**
   * LEDGE TRUMPING. No hay bloqueo exclusivo del borde: agarrar uno en el que
   * ya cuelga el rival se lo ROBA (Fighter.getTrumped). Se resuelve cuando los
   * DOS se han movido, no dentro del update del que agarra: si no, un robo a
   * p2 le dejaría moverse un frame más que un robo a p1, y el orden de la
   * lista decidiría el resultado.
   *
   * Quién es el recién llegado: el que lleva MENOS frames colgado. Si los dos
   * han agarrado en este mismo frame, el que llegó más tarde dentro del frame
   * (`ledgeGrabT`): el último en agarrar es el que se queda el borde, que es la
   * regla del robo llevada al sub-frame. En un empate exacto, p2 (arbitrario,
   * pero determinista).
   */
  resolveLedgeTrumps() {
    const [a, b] = this.fighters;
    if (a.state !== STATES.LEDGE_HANG || b.state !== STATES.LEDGE_HANG) return;
    if (!a.ledge || !b.ledge || a.ledge.id !== b.ledge.id) return;
    let newcomer;
    if (a.stateFrame !== b.stateFrame) newcomer = a.stateFrame < b.stateFrame ? a : b;
    else newcomer = a.ledgeGrabT > b.ledgeGrabT ? a : b;
    const trumped = this.opponentOf(newcomer);
    trumped.getTrumped(newcomer);
    this.emit({
      type: 'ledgeTrump',
      slot: newcomer.slot,
      victim: trumped.slot,
      x: newcomer.ledge.x,
      y: newcomer.ledge.y,
      dir: -newcomer.facing,
    });
  }

  // --- Golpes -------------------------------------------------------------------

  resolveHits() {
    // Se RECOGEN todos los impactos del frame antes de aplicar ninguno: si A
    // y B se golpean en el mismo frame, los dos golpes entran (un "trade").
    // Aplicándolos según se encuentran, el que se comprobara primero
    // cancelaría el movimiento del otro y el orden de la lista decidiría el
    // resultado.
    const pending = [];
    for (const attacker of this.fighters) {
      const victim = this.opponentOf(attacker);
      if (!victim.canBeHit()) continue;
      const hurt = victim.hurtbox();
      for (const { hb, group, box } of attacker.activeHitboxes()) {
        if (hb.grab) {
          // Un agarre normal solo atrapa en el suelo. El de COMANDO
          // (`commandGrab`, el abrazo del Up-B) atrapa en el aire, y en el
          // suelo solo si el movimiento salió desde el suelo.
          const reachable = hb.commandGrab
            ? !victim.grounded || attacker.moveStartedGrounded
            : victim.grounded;
          if (reachable && boxesOverlap(box, hurt) && victim.state !== STATES.BURIED) {
            pending.push({
              kind: 'grab', attacker, victim, hb, group,
            });
            break;
          }
          continue;
        }
        if (!boxesOverlap(box, hurt)) continue;
        pending.push({
          kind: 'hit', attacker, victim, hb, group, box,
        });
        break; // una caja por atacante y frame: la primera que toca (sweetspot primero)
      }
    }
    for (const p of this.projectiles.list) {
      const owner = this.fighter(p.owner);
      const victim = this.opponentOf(owner);
      if (p.dead || !victim.canBeHit() || PROJECTILE_KINDS[p.kind].field) continue;
      if (!boxesOverlap(this.projectiles.box(p), victim.hurtbox())) continue;
      pending.push({
        kind: 'projectile', attacker: owner, victim, projectile: p,
      });
    }

    for (const hit of pending) {
      if (hit.kind === 'grab') {
        // Un agarre no entra si el que agarra acaba de recibir un golpe en
        // este mismo frame (ya no está en el movimiento de esa caja).
        if (hit.attacker.state !== STATES.ACTION || !hit.attacker.move?.hitboxes?.includes(hit.hb)) continue;
        hit.attacker.hitGroups.add(hit.group);
        if (hit.hb.commandGrab) hit.attacker.startSlam(hit.victim, hit.hb.commandGrab);
        else hit.attacker.grabVictim(hit.victim);
        this.emit({
          type: 'grab', slot: hit.attacker.slot, x: hit.victim.x, y: hit.victim.y - hit.victim.height * 0.6, command: !!hit.hb.commandGrab,
        });
      } else if (hit.kind === 'projectile') {
        this.applyProjectileHit(hit.attacker, hit.victim, hit.projectile);
      } else {
        const damage = hit.attacker.hitboxDamage(hit.hb);
        hit.attacker.hitGroups.add(hit.group);
        this.applyHit(hit.attacker, hit.victim, hit.hb, damage);
      }
    }
  }

  applyProjectileHit(owner, victim, p) {
    const kind = PROJECTILE_KINDS[p.kind];
    p.dead = true;
    this.projectiles.list = this.projectiles.list.filter((q) => !q.dead);
    if (kind.capture) {
      this.startFinalCinematic(owner, victim, kind.cine ?? 'gallos');
      return;
    }
    // Un proyectil golpea "desde sí mismo": el lanzamiento va en su dirección
    // de VUELO, no hacia donde mire ahora quien lo lanzó (que puede haberse
    // dado la vuelta mientras el bloque volaba).
    const from = { x: p.x - p.dir * 8, facing: p.dir };
    this.applyHit(from, victim, kind.hitbox, kind.hitbox.damage, owner, { x: p.x, y: p.y });
  }

  /**
   * Aplica un golpe y emite su evento. `source` es quien se lleva el mérito
   * (medidor, estadísticas) cuando el golpe viene de un proyectil.
   */
  applyHit(attacker, victim, hb, damage, source = attacker, at = null) {
    const result = victim.receiveHit(attacker, hb, damage);
    const x = at?.x ?? (victim.x + attacker.x) / 2 + (victim.x >= attacker.x ? 12 : -12);
    const y = at?.y ?? victim.y - victim.height * 0.55;
    let lag = hitlagFrames(damage);
    if (result.type === 'counter') {
      // El parry congela más (`freeze` de su ventana) y lleva fogonazo blanco.
      lag = result.freeze ?? COUNTER_HITLAG;
      this.emit({
        type: 'counter', slot: victim.slot, x: victim.x, y: victim.y - victim.height * 0.7, dir: victim.facing, parry: result.teleport,
      });
    } else if (result.type === 'shield' || result.type === 'shieldBreak') {
      lag = Math.max(3, Math.floor(lag * 0.7));
      source.meter = Math.min(source.stats.finalMeterMax, source.meter + damage * 0.3);
    } else {
      this.gainMeter(source, victim, damage);
      source.matchStats.damageDealt += damage;
    }
    let lethal = false;
    if (result.type === 'hit') {
      this.markLaunch(victim, source, result.totalKnockback);
      lethal = this.resolveLethal(victim, result.totalKnockback);
      if (lethal) lag += SPECIAL_ZOOM_FRAMES;
      // Hitstop EXTRA del golpe (el dropkick congela 4 frames más).
      lag += hb.extraHitlag ?? 0;
    }
    if (result.type !== 'counter') {
      // Rebote del que golpea (dropkick) y frenazo en seco (Rap Battle Dash):
      // solo si el golpe CONECTA, contra lo que sea menos un contraataque.
      if (hb.recoil) {
        attacker.vx = hb.recoil.vx * attacker.facing;
        attacker.vy = hb.recoil.vy;
        attacker.fastFalling = false;
      }
      if (hb.stopOnHit) {
        attacker.driftStopped = true;
        attacker.vx = 0;
      }
    }
    this.hitlag = Math.max(this.hitlag, lag);
    this.emit({
      type: 'hit',
      slot: source.slot,
      victim: victim.slot,
      x,
      y,
      damage,
      kb: result.totalKnockback ?? 0,
      tumble: !!result.tumble,
      outcome: result.type,
      sfx: hb.sfx ?? null,
      vfx: hb.vfx ?? null,
      dir: victim.x >= attacker.x ? 1 : -1,
      charge: source.move?.charge ? source.chargeMultiplier() : 1,
      // Special Zoom: el cliente hace zoom, destello y rayos mientras dure
      // `freeze` (el hitlag de este golpe, ya alargado).
      lethal,
      freeze: lag,
      // IMPACT FRAMES ('invert', 'redwhite') del golpe limpio: presentación.
      impact: result.type === 'hit' || result.type === 'bury' ? (hb.impact ?? null) : null,
    });
    return result;
  }

  /**
   * CAMPOS (nube del Puro Habanero): proyectiles que no golpean. Al rival que
   * está dentro le ralentizan este frame y, cada `chipEvery` frames de vida
   * del campo, le quitan `chipDamage` (sin aturdir ni lanzar). Se aplica
   * después de moverse, así que la ralentización cuenta desde el tick
   * siguiente.
   */
  applyFields() {
    for (const f of this.fighters) f.slowFactor = 1;
    for (const p of this.projectiles.list) {
      const { field } = PROJECTILE_KINDS[p.kind];
      if (!field) continue;
      const owner = this.fighter(p.owner);
      const victim = this.opponentOf(owner);
      if (!victim.canBeHit() || !boxesOverlap(this.projectiles.box(p), victim.hurtbox())) continue;
      victim.slowFactor = Math.min(victim.slowFactor, 1 - field.slow);
      if (p.age % field.chipEvery !== 0) continue;
      victim.percent = Math.min(999, victim.percent + field.chipDamage);
      owner.matchStats.damageDealt += field.chipDamage;
      this.emit({
        type: 'chip', slot: owner.slot, victim: victim.slot, x: victim.x, y: victim.y - victim.height * 0.7, damage: field.chipDamage,
      });
    }
  }

  // --- Blast zones y stocks -------------------------------------------------

  checkBlastZones() {
    const bz = this.geometry.blastZones;
    for (const f of this.fighters) {
      if (!f.isAlive || f.state === STATES.RESPAWN || f.state === STATES.CINEMATIC) continue;
      const cx = f.x;
      const cy = f.y - f.height / 2;
      const side = blastSide(bz, cx, cy);
      if (!side) continue;
      this.koFighter(f, side, crossingPoint(bz, side, f.prevX ?? cx, (f.prevY ?? f.y) - f.height / 2, cx, cy));
    }
  }

  koFighter(f, side, at) {
    const counts = this.phase === PHASES.FIGHT;
    if (counts) {
      f.stocks = Math.max(0, f.stocks - 1);
      f.matchStats.falls += 1;
      const other = this.opponentOf(f);
      other.matchStats.kos += 1;
    }
    this.emit({
      type: 'ko', slot: f.slot, side, x: at.x, y: at.y, stocks: f.stocks, color: f.color,
    });
    if (!counts) f.stocks = STARTING_STOCKS; // calentamiento: no se pierde nada
    f.die();
  }

  // --- Final Smash: "Batalla de Gallos" ------------------------------------

  startFinalCinematic(attacker, victim, kind = 'gallos') {
    const spec = attacker.finalSmashSpec(kind);
    if (!spec || this.cine) return;
    this.projectiles.clear();
    for (const f of [attacker, victim]) {
      f.releaseHolds();
      f.vx = 0;
      f.vy = 0;
      f.kbx = 0;
      f.kby = 0;
      f.setState(STATES.CINEMATIC);
    }
    attacker.facing = victim.x >= attacker.x ? 1 : -1;
    attacker.cinePose = spec.transformPose ?? spec.attackerPose;
    attacker.cineProgress = kind === 'gallos' ? 0 : -1;
    victim.cinePose = spec.victimPose;
    victim.cineProgress = -1;
    this.cine = {
      attacker: attacker.slot,
      victim: victim.slot,
      frame: 0,
      total: spec.cinematicFrames,
      pulses: 0,
      kind,
      // % del rival al EMPEZAR: decide el K.O. automático de la batalla.
      startPercent: victim.percent,
    };
    this.hitlag = 8;
    this.emit({
      type: 'finalCapture', slot: attacker.slot, x: victim.x, y: victim.y - victim.height / 2, kind,
    });
  }

  tickCinematic() {
    const cine = this.cine;
    const attacker = this.fighter(cine.attacker);
    const victim = this.fighter(cine.victim);
    const spec = attacker.finalSmashSpec(cine.kind);
    if (cine.kind === 'battle') {
      this.tickBattle(cine, attacker, victim, spec);
      return;
    }
    cine.frame += 1;
    const f = cine.frame;
    // Primer tercio: la transformación (gorra, gafas y cadenas pieza a pieza,
    // guiada por progreso). Después, el rapeo en bucle.
    const transformFrames = Math.floor(cine.total / 3);
    if (f <= transformFrames) {
      attacker.cinePose = spec.transformPose;
      attacker.cineProgress = f / transformFrames;
    } else {
      attacker.cinePose = spec.attackerPose;
      attacker.cineProgress = -1;
    }
    attacker.stateFrame += 1;
    victim.stateFrame += 1;
    if (f === transformFrames) {
      this.emit({
        type: 'cineTransform', slot: attacker.slot, x: attacker.x, y: attacker.y - attacker.height,
      });
    }
    if (f > transformFrames && (f - transformFrames) % 12 === 0 && f < cine.total - 20) {
      // Cada compás es un PULSO de daño (el % sube durante el rapeo; la
      // detonación lanza con el resto del total).
      if (cine.pulses < (spec.pulses ?? 0)) {
        cine.pulses += 1;
        victim.percent = Math.min(999, victim.percent + spec.pulseDamage);
        attacker.matchStats.damageDealt += spec.pulseDamage;
      }
      this.emit({
        type: 'cineBeat', slot: attacker.slot, x: victim.x, y: victim.y - victim.height * 0.6, n: f,
      });
    }
    if (f === cine.total - 20) {
      this.emit({
        type: 'micDrop', slot: attacker.slot, x: attacker.x + attacker.facing * 20, y: attacker.y - 60,
      });
    }
    if (f < cine.total) return;

    // DETONACIÓN: 45% y el retroceso más bestia del juego, hacia el lado al
    // que mira Samuel (la blast zone lateral).
    this.cine = null;
    const blast = spec.damage - (spec.pulses ?? 0) * (spec.pulseDamage ?? 0);
    const percentBefore = victim.percent;
    victim.percent = Math.min(999, victim.percent + blast);
    const kb = calculateKnockback(percentBefore, blast, victim.stats.weight, spec.bkb, spec.kbg);
    const { kbx, kby } = knockbackVelocity(kb, spec.angle, attacker.facing);
    victim.grounded = false;
    victim.surfaceId = null;
    victim.applyLaunch({
      kbx, kby, hitstun: hitstunFrames(kb), tumble: isTumble(kb),
    });
    this.markLaunch(victim, attacker, kb);
    this.resolveLethal(victim, kb);
    attacker.matchStats.damageDealt += blast;
    attacker.cinePose = null;
    attacker.cineProgress = -1;
    victim.cinePose = null;
    attacker.toNeutral();
    this.hitlag = 14;
    this.emit({
      type: 'finalBoom',
      slot: attacker.slot,
      victim: victim.slot,
      x: victim.x,
      y: victim.y - victim.height / 2,
      kb,
      damage: spec.damage,
      dir: attacker.facing,
    });
  }

  // --- Final Smash despertado: "La Batalla de Gallos DEFINITIVA" -----------

  /**
   * La cinemática de la batalla: los dos congelados; tres rimas que golpean
   * (`pulseFrames`, `pulseDamage` cada una) y, al acabar, la detonación con
   * el resto del daño. Si el rival tenía más de `autoKoAbove` al empezar, el
   * K.O. es AUTOMÁTICO: la detonación lanza con al menos AUTO_KO_KNOCKBACK.
   * Planos, foco, rimas gigantes e impact frame: presentación
   * (engine/battleFinale.js), en función del frame.
   */
  tickBattle(cine, attacker, victim, spec) {
    cine.frame += 1;
    const f = cine.frame;
    attacker.stateFrame += 1;
    victim.stateFrame += 1;
    const word = spec.pulseFrames.indexOf(f);
    if (word >= 0 && cine.pulses < spec.pulses) {
      cine.pulses += 1;
      victim.percent = Math.min(999, victim.percent + spec.pulseDamage);
      attacker.matchStats.damageDealt += spec.pulseDamage;
      this.emit({
        type: 'battleWord', slot: attacker.slot, n: word, damage: spec.pulseDamage,
      });
    }
    if (f === spec.impactFrame) this.emit({ type: 'battleImpact', slot: attacker.slot });
    if (f < cine.total) return;

    this.cine = null;
    const blast = spec.damage - spec.pulses * spec.pulseDamage;
    const percentBefore = victim.percent;
    victim.percent = Math.min(999, victim.percent + blast);
    const auto = cine.startPercent > spec.autoKoAbove;
    let kb = calculateKnockback(percentBefore, blast, victim.stats.weight, spec.bkb, spec.kbg);
    if (auto) kb = Math.max(kb, AUTO_KO_KNOCKBACK);
    const { kbx, kby } = knockbackVelocity(kb, spec.angle, attacker.facing);
    victim.grounded = false;
    victim.surfaceId = null;
    victim.applyLaunch({
      kbx, kby, hitstun: hitstunFrames(kb), tumble: isTumble(kb),
    });
    this.markLaunch(victim, attacker, kb);
    this.resolveLethal(victim, kb);
    attacker.matchStats.damageDealt += blast;
    attacker.cinePose = null;
    attacker.cineProgress = -1;
    victim.cinePose = null;
    attacker.toNeutral();
    this.hitlag = 14;
    this.emit({
      type: 'finalBoom',
      slot: attacker.slot,
      victim: victim.slot,
      x: victim.x,
      y: victim.y - victim.height / 2,
      kb,
      damage: spec.damage,
      dir: attacker.facing,
      auto,
      kind: 'battle',
    });
  }

  // --- Snapshot -------------------------------------------------------------

  /** Estado completo para dibujar y para la red. Datos planos, sin referencias. */
  serialize() {
    return {
      frame: this.frame,
      phase: this.phase,
      phaseFrame: this.phaseFrame,
      ready: { ...this.ready },
      winner: this.winner,
      paused: this.paused,
      pausedBy: this.pausedBy,
      opponentPresent: this.opponentPresent,
      hitlag: this.hitlag,
      fighters: this.fighters.map((f) => f.view()),
      projectiles: this.projectiles.serialize(),
      cine: this.cine ? { ...this.cine } : null,
      cutin: this.cutin ? { ...this.cutin } : null,
    };
  }

  /** Vacía y devuelve los eventos acumulados desde la última llamada. */
  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }
}
