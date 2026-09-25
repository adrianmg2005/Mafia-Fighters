// Suite del motor de platform fighter: física de plataformas, knockback,
// stocks, borde, techs, especiales de Samuel, controles, cámara y red.
//
// Regla de la casa (ver CLAUDE.md): los números del DISEÑO se escriben
// LITERALES aquí. Derivarlos de las constantes que se quieren proteger haría
// que mutar la constante mutase también la expectativa.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { installDom } from './fakeCanvas.mjs';

installDom();

const { Simulation, PHASES } = await import('../public/src/engine/simulation.js');
const combat = await import('../public/src/engine/combat.js');
const physics = await import('../public/src/engine/physics.js');
const { resolveAttack, InputTracker } = await import('../public/src/engine/inputManager.js');
const { targetZoomFor, CameraManager } = await import('../public/src/engine/cameraManager.js');
const { GEOMETRY } = await import('../public/src/stages/patioFlotante.js');
const { samuelConfig } = await import('../public/src/characters/samuel.js');
const fighterModule = await import('../public/src/characters/fighter.js');
const { STATES } = fighterModule;

const require = createRequire(import.meta.url);
const server = require('../server.js');

// --- utilidades -------------------------------------------------------------

function makeSim({ phase = PHASES.LOBBY } = {}) {
  const sim = new Simulation({ geometry: GEOMETRY, p1: samuelConfig, p2: samuelConfig });
  sim.setOpponentPresent(true);
  if (phase !== PHASES.LOBBY) {
    sim.phase = phase;
    sim.phaseFrame = 100;
  }
  return sim;
}

function run(sim, n, p1 = {}, p2 = {}) {
  for (let i = 0; i < n; i += 1) sim.step({ p1, p2 });
}

// Deja que el hitlag global se consuma sin avanzar a nadie.
function drainHitlag(sim) {
  let guard = 0;
  while (sim.hitlag > 0 && guard < 100) {
    sim.step({});
    guard += 1;
  }
}

function place(f, {
  x, y = 520, surfaceId = 'main', facing = 1,
}) {
  f.x = x;
  f.y = y;
  f.facing = facing;
  f.vx = 0;
  f.vy = 0;
  f.kbx = 0;
  f.kby = 0;
  f.grounded = surfaceId !== null;
  f.surfaceId = surfaceId;
  f.setState(surfaceId ? STATES.IDLE : STATES.AIR);
}

/** Lanza `move` de p1 contra p2 pegados, y devuelve el primer evento de golpe. */
function hitWith(sim, move, { gap = 50, p2Percent = 0 } = {}) {
  place(sim.p1, { x: 600, facing: 1 });
  place(sim.p2, { x: 600 + gap, facing: -1 });
  sim.p2.percent = p2Percent;
  sim.drainEvents();
  sim.p1.startMove(move);
  for (let i = 0; i < 80; i += 1) {
    sim.step({});
    const hit = sim.events.find((e) => e.type === 'hit');
    if (hit) return hit;
  }
  return null;
}

// ============================================================================
// 2.B — FÓRMULA DE KNOCKBACK
// ============================================================================

test('calculateKnockback es la fórmula del diseño, literal', () => {
  // F-Smash sin cargar (18%, BKB 45, KBG 102) contra Samuel (115) al 50%:
  // pTerm = 5 + 45 = 50; wTerm = 200/215; ((50*0.9302*1.4)+18)*1.02 + 45
  assert.ok(Math.abs(combat.calculateKnockback(50, 18, 115, 45, 102) - 129.7786) < 1e-3);
  // Jab 1 al 0%: solo queda (18 * 0.2) + 15.
  assert.ok(Math.abs(combat.calculateKnockback(0, 3, 115, 15, 20) - 18.6) < 1e-9);
  // El peso importa: un peso 60 sale mucho más lejos que Samuel.
  assert.ok(combat.calculateKnockback(100, 12, 60, 30, 90) > combat.calculateKnockback(100, 12, 115, 30, 90));
});

test('vectorización: 0° adelante, 90° arriba, 270° spike; KB->velocidad a 0.1 px/f', () => {
  const flat = combat.knockbackVelocity(100, 0, -1);
  assert.equal(flat.kby, 0);
  assert.ok(Math.abs(flat.kbx - -10) < 1e-9, 'KB 100 a 0° mirando a la izquierda = -10 px/f');
  const up = combat.knockbackVelocity(100, 90, 1);
  assert.equal(up.kbx, 0);
  assert.ok(Math.abs(up.kby - -10) < 1e-9);
  const spike = combat.knockbackVelocity(50, 270, 1);
  assert.ok(spike.kby > 4.99 && Math.abs(spike.kbx) < 1e-9, 'el 270° va recto hacia abajo');
});

test('hitstun: min(22, floor(KB*0.4)) si no mata; floor(KB*0.4) entero solo si mata', () => {
  // La ráfaga del jab (setKb 14) da 5 = su bucle.
  assert.equal(combat.hitstunFrames(14), 5);
  assert.equal(combat.hitstunFrames(32), 12);
  assert.equal(combat.hitstunFrames(50.3), 20);
  assert.equal(combat.hitstunFrames(55), 22);
  // Tope: ningún golpe que no mate bloquea más de 22 frames.
  assert.equal(combat.hitstunFrames(56), 22);
  assert.equal(combat.hitstunFrames(100), 22);
  assert.equal(combat.hitstunFrames(263), 22);
  // El hitstun largo (el de Smash) queda para los golpes letales.
  assert.equal(combat.lethalHitstunFrames(100), 40);
  assert.equal(combat.lethalHitstunFrames(50.3), 20);
  assert.equal(combat.isTumble(32), false);
  assert.equal(combat.isTumble(32.01), true);
});

test('un golpe real aplica %, knockback de la fórmula, hitstun y tumble', () => {
  const sim = makeSim();
  const hit = hitWith(sim, 'ftilt');
  assert.ok(hit, 'el F-Tilt conecta a 50 px');
  assert.equal(sim.p2.percent, 11);
  // 0% -> KB = 18*0.85 + 35 = 50.3: tumble y floor(50.3*0.4) = 20 de hitstun.
  assert.ok(Math.abs(hit.kb - 50.3) < 1e-9);
  assert.equal(sim.p2.state, STATES.HITSTUN);
  assert.equal(sim.p2.tumble, true);
  assert.equal(sim.p2.hitstun, 20);
  // Hacia delante del atacante (derecha) y hacia arriba (35°).
  assert.ok(sim.p2.kbx > 0 && sim.p2.kby < 0);
});

test('el % previo es el que cuenta: el mismo golpe lanza más lejos al 100% que al 0%', () => {
  const a = hitWith(makeSim(), 'fsmash', { p2Percent: 0 });
  const b = hitWith(makeSim(), 'fsmash', { p2Percent: 100 });
  assert.ok(b.kb > a.kb * 1.5, `${a.kb} -> ${b.kb}`);
});

// ============================================================================
// 1.A/B — FÍSICA DE PLATAFORMAS
// ============================================================================

function apexOf(sim, input) {
  place(sim.p1, { x: 640 });
  let min = 520;
  for (let i = 0; i < 90; i += 1) {
    sim.step({ p1: input(i) });
    min = Math.min(min, sim.p1.y);
  }
  return 520 - min;
}

test('salto completo -12.5 y salto corto al soltar antes del frame 4', () => {
  const full = apexOf(makeSim(), () => ({ jump: true, up: true }));
  const short = apexOf(makeSim(), (i) => (i === 0 ? { jump: true } : {}));
  // Ápice teórico: 12.5²/(2·0.58) = 134.7 px (el paso discreto se come unos 6).
  assert.ok(full > 120 && full < 140, `salto completo: ${full}`);
  assert.ok(short > 40 && short < 60, `salto corto: ${short}`);
});

test('jump squat de 3 frames antes de despegar (estándar Ultimate)', () => {
  const sim = makeSim();
  place(sim.p1, { x: 640 });
  // El frame de la pulsación es el 1º del squat; se despega en el 4º.
  sim.step({ p1: { jump: true, up: true } });
  for (let i = 0; i < 3; i += 1) {
    assert.equal(sim.p1.state, STATES.JUMPSQUAT, `frame ${i + 1}`);
    assert.equal(sim.p1.grounded, true);
    sim.step({ p1: { jump: true, up: true } });
  }
  assert.equal(sim.p1.grounded, false, 'despega al acabar los 3 frames de squat');
});

test('un solo doble salto (-11), que se recupera al tocar suelo', () => {
  const sim = makeSim();
  place(sim.p1, { x: 640, y: 300, surfaceId: null });
  sim.step({ p1: { jump: true } });
  assert.ok(Math.abs(sim.p1.vy - (-11 + 0.58)) < 1e-9, `vy tras el doble salto: ${sim.p1.vy}`);
  run(sim, 2);
  const vy = sim.p1.vy;
  sim.step({ p1: { jump: true } });
  assert.ok(sim.p1.vy > vy, 'el segundo doble salto no existe');
  run(sim, 120);
  assert.equal(sim.p1.grounded, true);
  assert.equal(sim.p1.jumpsLeft, 1);
});

test('caída rápida INMEDIATA a 17.6 px/f (1.6x la terminal) tras el ápice; sin ella, tope en 11', () => {
  const sim = makeSim();
  place(sim.p1, { x: 640, y: 100, surfaceId: null });
  sim.p1.vy = 0.5;
  sim.step({ p1: { down: true } });
  // Exactamente un 60% más que la caída terminal natural (11), como en Ultimate.
  assert.ok(Math.abs(sim.p1.vy - 17.6) < 1e-9, `desde el primer frame, sin rampa: ${sim.p1.vy}`);
  assert.equal(sim.p1.fastFalling, true);

  // Subiendo no hay caída rápida...
  const rising = makeSim();
  place(rising.p1, { x: 640, y: 300, surfaceId: null });
  rising.p1.vy = -10;
  rising.step({ p1: { down: true } });
  assert.equal(rising.p1.fastFalling, false);
  // ...pero la pulsación queda en el buffer: si el ápice llega en menos de
  // 6 frames, se aplica justo en él.
  const nearApex = makeSim();
  place(nearApex.p1, { x: 640, y: 300, surfaceId: null });
  nearApex.p1.vy = -2;
  nearApex.step({ p1: { down: true } });
  run(nearApex, 4);
  assert.equal(nearApex.p1.fastFalling, true);
  assert.ok(Math.abs(nearApex.p1.vy - 17.6) < 1e-9);

  const slow = makeSim();
  place(slow.p1, { x: 640, y: 0, surfaceId: null });
  run(slow, 40);
  assert.equal(slow.p1.vy, 11);
  // La proporción es la regla, no el número: un personaje que cae a 10 cae
  // rápido a 16.
  const light = makeSim();
  light.p1.stats.maxFallSpeed = 10;
  place(light.p1, { x: 640, y: 100, surfaceId: null });
  light.p1.vy = 0.5;
  light.step({ p1: { down: true } });
  assert.ok(Math.abs(light.p1.vy - 16) < 1e-9, `${light.p1.vy}`);
});

test('fricción: 0.82 px/f en el suelo y 0.06 en el aire', () => {
  const sim = makeSim();
  place(sim.p1, { x: 640 });
  sim.p1.vx = 3;
  sim.step({});
  assert.ok(Math.abs(sim.p1.vx - 2.18) < 1e-9);
  place(sim.p1, { x: 640, y: 100, surfaceId: null });
  sim.p1.vx = 3;
  sim.step({});
  assert.ok(Math.abs(sim.p1.vx - 2.94) < 1e-9);
});

test('semisólida: se atraviesa desde abajo y se aterriza encima', () => {
  const sim = makeSim();
  place(sim.p1, { x: 490 });
  let wentThrough = false;
  for (let i = 0; i < 90; i += 1) {
    sim.step({ p1: { jump: true, up: true } });
    if (sim.p1.y < 410) wentThrough = true;
    if (sim.p1.grounded && i > 10) break;
  }
  assert.ok(wentThrough, 'el cuerpo pasó por encima de y=410 subiendo');
  assert.equal(sim.p1.surfaceId, 'left');
  assert.equal(sim.p1.y, 410);
});

test('semisólida: S + salto baja a través; mantener abajo al caer no aterriza', () => {
  const sim = makeSim();
  place(sim.p1, { x: 490, y: 410, surfaceId: 'left' });
  sim.step({ p1: { down: true } });
  sim.step({ p1: { down: true, jump: true, up: true } });
  run(sim, 40);
  assert.equal(sim.p1.surfaceId, 'main', 'cayó hasta la losa');

  const fall = makeSim();
  place(fall.p1, { x: 490, y: 330, surfaceId: null });
  fall.p1.vy = 1;
  run(fall, 40, { down: true });
  assert.equal(fall.p1.surfaceId, 'main', 'con abajo mantenido atraviesa el tablón');
});

test('la losa es sólida por los lados y por debajo', () => {
  const sim = makeSim();
  // Por el lado: pegado al canto, por debajo de la tapa, empujando hacia dentro.
  place(sim.p1, { x: 300, y: 555, surfaceId: null });
  sim.p1.vx = 6;
  sim.p1.vy = -0.58;
  sim.step({});
  assert.ok(sim.p1.x <= 340 - 26 + 1e-9, `no se mete en la losa: x=${sim.p1.x}`);
  // Por debajo: subiendo contra la roca, choca en vez de atravesar.
  const up = makeSim();
  place(up.p1, { x: 640, y: 820, surfaceId: null });
  up.p1.vy = -20;
  run(up, 3);
  assert.ok(up.p1.y - 108 >= 684 - 1e-9, `la cabeza se queda bajo la roca: ${up.p1.y - 108}`);
});

test('andando se cae por el borde de la losa (no hay suelo infinito)', () => {
  const sim = makeSim();
  place(sim.p1, { x: 900 });
  run(sim, 40, { right: true });
  assert.equal(sim.p1.grounded, false);
  assert.ok(sim.p1.x > 940);
});

// ============================================================================
// 1.C — AGARRE DE BORDE
// ============================================================================

function fallOntoLedge(sim) {
  place(sim.p1, { x: 314, y: 560, surfaceId: null });
  sim.p1.vy = 1;
  for (let i = 0; i < 30; i += 1) {
    sim.step({});
    if (sim.p1.state === STATES.LEDGE_HANG) return i;
  }
  return -1;
}

test('cayendo junto al borde se ancla: vx=vy=0, 30 frames intangible, salto devuelto', () => {
  const sim = makeSim();
  sim.p1.jumpsLeft = 0;
  assert.ok(fallOntoLedge(sim) >= 0, 'agarra el borde');
  const f = sim.p1;
  assert.equal(f.x, 314);
  assert.equal(f.y, 520 + 108 - 12, 'manos en el punto del borde');
  assert.equal(f.vx, 0);
  assert.equal(f.vy, 0);
  assert.equal(f.facing, 1, 'mira hacia el escenario');
  assert.equal(f.jumpsLeft, 1);
  assert.equal(f.canBeHit(), false);
  run(sim, 29);
  assert.equal(f.canBeHit(), false, 'sigue intangible en el frame 29');
  run(sim, 2);
  assert.equal(f.canBeHit(), true, 'la intangibilidad dura 30 frames');
});

test('subiendo junto al borde NO se agarra', () => {
  const sim = makeSim();
  place(sim.p1, { x: 314, y: 660, surfaceId: null });
  sim.p1.vy = -8;
  run(sim, 6);
  assert.notEqual(sim.p1.state, STATES.LEDGE_HANG);
});

test('opciones de borde: W sube a la losa, S suelta y no re-agarra al instante', () => {
  const sim = makeSim();
  fallOntoLedge(sim);
  run(sim, 5);
  sim.step({ p1: { jump: true, up: true } });
  run(sim, 30);
  assert.equal(sim.p1.grounded, true);
  assert.equal(sim.p1.surfaceId, 'main');
  assert.ok(sim.p1.x > 340, 'está encima de la losa');

  const drop = makeSim();
  fallOntoLedge(drop);
  run(drop, 5);
  drop.step({ p1: { down: true } });
  assert.equal(drop.p1.state, STATES.AIR);
  run(drop, 10);
  assert.notEqual(drop.p1.state, STATES.LEDGE_HANG);
});

test('ataque de borde: sube barriendo la losa con hitbox', () => {
  const sim = makeSim();
  fallOntoLedge(sim);
  place(sim.p2, { x: 400, facing: -1 });
  run(sim, 5);
  sim.drainEvents();
  sim.step({ p1: { attack: true } });
  let hit = null;
  for (let i = 0; i < 40 && !hit; i += 1) {
    sim.step({});
    hit = sim.events.find((e) => e.type === 'hit');
  }
  assert.ok(hit, 'el ataque de borde conecta');
  assert.equal(hit.damage, 8);
});

// ============================================================================
// 2.A — STOCKS, BLAST ZONES Y RESPAWN
// ============================================================================

test('cruzar una blast zone resta un stock y reaparece a los 90 frames en (640, 280)', () => {
  const sim = makeSim({ phase: PHASES.FIGHT });
  sim.p2.percent = 80;
  place(sim.p2, { x: 1395, y: 300, surfaceId: null });
  sim.p2.vx = 20;
  sim.step({});
  assert.equal(sim.p2.stocks, 2);
  assert.equal(sim.p2.state, STATES.DEAD);
  const ko = sim.events.find((e) => e.type === 'ko');
  assert.equal(ko.side, 'right');
  run(sim, 89);
  assert.equal(sim.p2.state, STATES.DEAD);
  sim.step({});
  assert.equal(sim.p2.state, STATES.RESPAWN);
  assert.equal(sim.p2.x, 640);
  assert.equal(sim.p2.y, 280);
  assert.equal(sim.p2.percent, 0);
  assert.equal(sim.p2.canBeHit(), false);
});

test('las cuatro blast zones son las del diseño', () => {
  const cases = [
    ['left', -121, 300], ['right', 1401, 300], ['top', 640, -181 + 54], ['bottom', 640, 781 + 54],
  ];
  for (const [side, x, y] of cases) {
    const sim = makeSim({ phase: PHASES.FIGHT });
    place(sim.p2, { x, y, surfaceId: null });
    sim.p2.vx = side === 'left' ? -1 : (side === 'right' ? 1 : 0);
    sim.checkBlastZones();
    assert.equal(sim.p2.stocks, 2, side);
    const inside = makeSim({ phase: PHASES.FIGHT });
    place(inside.p2, {
      x: side === 'left' ? -119 : side === 'right' ? 1399 : 640,
      y: side === 'top' ? -179 + 54 : side === 'bottom' ? 779 + 54 : 300,
      surfaceId: null,
    });
    inside.checkBlastZones();
    assert.equal(inside.p2.stocks, 3, `${side}: justo dentro no muere`);
  }
});

test('la plataforma de reaparición: 120 frames invulnerable o hasta el primer input', () => {
  const sim = makeSim({ phase: PHASES.FIGHT });
  sim.respawn(sim.p2);
  run(sim, 119);
  assert.equal(sim.p2.state, STATES.RESPAWN);
  sim.step({});
  assert.equal(sim.p2.state, STATES.AIR);
  assert.equal(sim.p2.canBeHit(), true);

  const early = makeSim({ phase: PHASES.FIGHT });
  early.respawn(early.p2);
  run(early, 10);
  early.step({}, {});
  early.step({ p1: {}, p2: { attack: true } });
  assert.notEqual(early.p2.state, STATES.RESPAWN, 'un input la abandona antes');
});

test('3 stocks: al perder el último la partida termina con ganador', () => {
  const sim = makeSim({ phase: PHASES.FIGHT });
  for (let i = 0; i < 3; i += 1) {
    place(sim.p2, { x: 1500, y: 300, surfaceId: null });
    sim.checkBlastZones();
    run(sim, 100);
  }
  assert.equal(sim.p2.state, STATES.ELIMINATED);
  assert.equal(sim.phase, PHASES.GAME);
  assert.equal(sim.winner, 'p1');
  assert.equal(sim.p1.matchStats.kos, 3);
});

test('en el calentamiento morir no cuesta stocks', () => {
  const sim = makeSim();
  place(sim.p2, { x: 1500, y: 300, surfaceId: null });
  sim.checkBlastZones();
  assert.equal(sim.p2.stocks, 3);
});

// ============================================================================
// 1.B / 2.C — HELPLESS, TUMBLE Y TECH
// ============================================================================

test('Up Special (Abrazo Aéreo): -16.5 px/f y, si no atrapa a nadie, HELPLESS en el ápice', () => {
  const sim = makeSim();
  place(sim.p1, { x: 640, y: 300, surfaceId: null });
  sim.p1.startMove('uspecial');
  run(sim, 5);
  sim.step({});
  // Frame 6: impulso -16.5 y luego la gravedad del propio tick.
  assert.ok(Math.abs(sim.p1.vy - (-16.5 + 0.58)) < 1e-9, `vy ${sim.p1.vy}`);
  run(sim, 40);
  assert.equal(sim.p1.state, STATES.HELPLESS);
  // Indefenso: ni ataca ni salta.
  sim.step({ p1: { attack: true } });
  sim.step({ p1: { jump: true } });
  assert.equal(sim.p1.state, STATES.HELPLESS);
  run(sim, 200);
  assert.ok(sim.p1.grounded, 'aterriza');
  run(sim, 20);
  assert.equal(sim.p1.state, STATES.IDLE, 'tocar suelo quita el helpless');
});

// El Abrazo Aéreo contra un rival quieto en el aire en (x, y): cuántos frames
// hasta el agarre y qué pasa después.
function flyingSlam({
  x1 = 640, y1 = 520, surfaceId = 'main', x2 = 660, y2 = 340, phase = PHASES.LOBBY, frames = 200,
} = {}) {
  const sim = makeSim({ phase });
  place(sim.p1, { x: x1, y: y1, surfaceId });
  place(sim.p2, { x: x2, y: y2, surfaceId: null, facing: -1 });
  sim.p1.startMove('uspecial');
  const out = { events: [], held: [] };
  for (let i = 0; i < frames; i += 1) {
    if (!out.grab) {
      sim.p2.vy = 0;
      sim.p2.y = y2;
    }
    sim.step({});
    for (const e of sim.drainEvents()) {
      out.events.push(e);
      if (e.type === 'grab') out.grab = { ...e, frame: i };
      if (e.type === 'hit' && e.victim === 'p2' && !out.slam) out.slam = { ...e, p1y: sim.p1.y, p1state: sim.p1.state };
    }
    if (sim.p2.state === STATES.GRABBED) {
      out.held.push({
        p1vy: sim.p1.vy, p1y: sim.p1.y, p2y: sim.p2.y, spin: sim.p2.view().spin, anim: sim.p1.view().anim,
      });
    }
  }
  out.sim = sim;
  return out;
}

test('ABRAZO AÉREO: atrapa a un rival EN EL AIRE, caen juntos en picado a 18 px/f y lo ESTAMPA contra la losa', () => {
  const r = flyingSlam();
  assert.ok(r.grab, 'lo atrapa');
  assert.equal(r.grab.command, true);
  // 1) Sigue SUBIENDO con él hasta lo más alto de SU salto: el mismo ápice
  // que el Up-B sin atrapar a nadie.
  assert.ok(r.held.some((h) => h.p1vy < 0), 'sigue subiendo con él');
  const whiff = makeSim();
  place(whiff.p1, { x: 640 });
  whiff.p1.startMove('uspecial');
  let whiffTop = 520;
  for (let i = 0; i < 60; i += 1) {
    whiff.step({});
    whiffTop = Math.min(whiffTop, whiff.p1.y);
  }
  const top = Math.min(...r.held.map((h) => h.p1y));
  assert.ok(Math.abs(top - whiffTop) < 1, `ápice ${top.toFixed(1)} frente a ${whiffTop.toFixed(1)}`);
  // 2) Parón de 3 frames en lo alto, 3) se voltean y picado a 18 px/f.
  assert.equal(r.held.filter((h) => h.p1vy === 0).length, 3, 'micro-parón en el ápice');
  const dive = r.held.slice(r.held.findIndex((h) => h.p1vy === 18));
  assert.ok(dive.length > 3 && dive.every((h) => h.p1vy === 18), `picado: ${[...new Set(dive.map((h) => h.p1vy))]}`);
  assert.ok(dive.every((h) => h.spin === Math.PI), 'volteado: el agarrado cae cabeza abajo');
  const rising = r.held.filter((h) => h.p1vy < 0);
  assert.ok(rising.every((h) => h.spin === 0 && h.p2y < h.p1y - 40), 'subiendo lo lleva derecho y EN ALTO, en brazos');
  assert.ok(rising.every((h) => h.anim === 'flyingslam') && dive.every((h) => h.anim === 'slamdive'), 'la pose de cada fase');
  assert.ok(r.events.some((e) => e.type === 'fx' && e.fx === 'slamApex'), 'el parón en lo alto se anuncia');
  // El estampado: al tocar la losa, 14% y fuera en diagonal hacia donde mira.
  assert.equal(r.slam.damage, 14);
  assert.equal(r.slam.p1y, 520, 'contra la losa');
  assert.ok(r.events.some((e) => e.type === 'fx' && e.fx === 'slamWave'), 'la onda de choque');
  // Lanza a 40° hacia donde mira Samuel y él paga 22 frames de aterrizaje.
  const sim = r.sim;
  const slamAt = r.events.findIndex((e) => e.type === 'hit' && e.victim === 'p2');
  assert.ok(slamAt >= 0);
  const again = flyingSlam({ frames: 0 });
  let landing = 0;
  let angle = null;
  for (let i = 0; i < 120; i += 1) {
    if (!again.grab) {
      again.sim.p2.vy = 0;
    }
    again.sim.step({});
    const hit = again.sim.drainEvents().find((e) => e.type === 'hit');
    if (hit && angle === null) {
      drainHitlag(again.sim);
      angle = Math.atan2(-again.sim.p2.kby, again.sim.p2.kbx) * (180 / Math.PI);
    }
    if (angle !== null && again.sim.p1.state === STATES.LANDING) landing += 1;
  }
  assert.ok(Math.abs(angle - 40) < 0.5, `ángulo ${angle}`);
  assert.equal(landing, 22, 'frames de aterrizaje');
  assert.ok(sim);
  // Enganchado sin haber despegado aún: primero lo LEVANTA (14 frames
  // subiendo) y después lo estampa en el mismo suelo.
  const grounded = makeSim();
  place(grounded.p1, { x: 640 });
  place(grounded.p2, { x: 670, facing: -1 });
  grounded.p1.startMove('uspecial');
  grounded.p1.startSlam(grounded.p2, 'uspecial_slam');
  grounded.step({});
  assert.equal(grounded.p1.grounded, false, 'despega con él');
  let groundSlam = false;
  for (let i = 0; i < 60 && !groundSlam; i += 1) {
    grounded.step({});
    groundSlam = grounded.drainEvents().some((e) => e.type === 'hit' && e.victim === 'p2');
  }
  assert.ok(groundSlam, 'y lo estampa');
  assert.equal(grounded.p1.y, 520);
});

test('ABRAZO AÉREO: desde el suelo agarra a un rival EN EL SUELO (el muñeco), lo sube y lo estampa; recuperando, al de la losa no', () => {
  // Desde el suelo, contra un rival quieto a su lado: agarre de comando,
  // suben juntos y lo estampa donde estaba.
  const ground = makeSim();
  place(ground.p1, { x: 640 });
  place(ground.p2, { x: 690, facing: -1 });
  ground.step({ p1: { up: true, special: true } });
  let grabbed = false;
  let grabFrame = -1;
  let top = 520;
  let slam = null;
  for (let i = 0; i < 90 && !slam; i += 1) {
    ground.step({});
    for (const e of ground.drainEvents()) {
      if (e.type === 'grab') {
        grabbed = true;
        grabFrame = i;
      }
      if (e.type === 'hit' && e.victim === 'p2') slam = e;
    }
    if (grabbed) top = Math.min(top, ground.p1.y);
  }
  assert.ok(grabbed, 'atrapa al muñeco que está de pie');
  // En el frame 4 del Up-B (el primero con caja): la W+O entra en el tick 0
  // del bucle de arriba, así que el agarre llega en el 3.
  assert.equal(grabFrame, 3, 'desde el frame 4, antes de despegar');
  assert.ok(Math.abs(top - 293.5) < 3, `lo lleva hasta lo más alto del salto: ${top.toFixed(1)}`);
  // Los brazos barren el frente del cuerpo, no solo lo de encima de la cabeza:
  // llega a un rival de pie a 100 px.
  const reach = makeSim();
  place(reach.p1, { x: 600 });
  place(reach.p2, { x: 700, facing: -1 });
  reach.p1.startMove('uspecial');
  let far = false;
  for (let i = 0; i < 40 && !far; i += 1) {
    reach.step({});
    far = reach.drainEvents().some((e) => e.type === 'grab');
  }
  assert.ok(far, 'agarra a 100 px');
  assert.equal(slam?.damage, 14, 'y lo estampa');
  // Recuperando desde debajo del borde, al rival DE PIE en la losa no lo agarra.
  const edge = makeSim();
  place(edge.p1, { x: 960, y: 600, surfaceId: null, facing: -1 });
  place(edge.p2, { x: 915, facing: 1 });
  edge.p1.startMove('uspecial');
  let edgeGrab = false;
  for (let i = 0; i < 40; i += 1) {
    edge.step({});
    edgeGrab = edgeGrab || edge.drainEvents().some((e) => e.type === 'grab');
  }
  assert.equal(edgeGrab, false, 'recuperando no se lleva al que hace edge-guard');
  const plat = GEOMETRY.platforms[0];
  const r = flyingSlam({
    x1: 490, y1: 520, x2: 500, y2: 250,
  });
  assert.ok(r.slam, 'lo estampa');
  assert.equal(r.slam.p1y, plat.y, 'en el tablón, no en la losa');
});

test('ABRAZO AÉREO: fuera de la losa no hay suelo — se lleva al rival al abismo y caen LOS DOS', () => {
  const r = flyingSlam({
    x1: 180, y1: 620, surfaceId: null, x2: 190, y2: 520, phase: PHASES.FIGHT, frames: 150,
  });
  assert.ok(r.grab, 'lo atrapa fuera de la losa');
  const kos = r.events.filter((e) => e.type === 'ko').map((e) => e.slot).sort();
  assert.deepEqual(kos, ['p1', 'p2'], 'suicidio táctico');
  assert.equal(r.sim.p1.stocks, 2);
  assert.equal(r.sim.p2.stocks, 2);
});

test('helpless puede agarrar el borde, y agarrarlo le quita el helpless', () => {
  const sim = makeSim();
  place(sim.p1, { x: 314, y: 560, surfaceId: null });
  sim.p1.enterHelpless();
  sim.p1.vy = 1;
  run(sim, 20);
  assert.equal(sim.p1.state, STATES.LEDGE_HANG);
  assert.equal(sim.p1.helpless, false);
});

function tumbleOntoStage({ shieldAtFramesBefore = null }) {
  const sim = makeSim();
  place(sim.p2, { x: 640, y: 440, surfaceId: null });
  sim.p2.applyLaunch({
    kbx: 0, kby: 4, hitstun: 60, tumble: true,
  });
  // Con kby 4 + gravedad cae ~80 px en ~9 frames.
  const frames = [];
  for (let i = 0; i < 40; i += 1) {
    const prevY = sim.p2.y;
    frames.push(prevY);
    sim.step({});
    if (sim.p2.grounded) return { sim, landedAt: i };
  }
  return { sim, landedAt: -1, frames };
}

test('tumble contra el suelo: con escudo en los 10 frames previos TECH, sin él MISSED TECH', () => {
  const miss = tumbleOntoStage({});
  assert.ok(miss.landedAt > 0);
  assert.equal(miss.sim.p2.state, STATES.KNOCKDOWN);

  // Se repite el mismo lanzamiento pulsando escudo 6 frames antes de tocar.
  const land = miss.landedAt;
  const sim = makeSim();
  place(sim.p2, { x: 640, y: 440, surfaceId: null });
  sim.p2.applyLaunch({
    kbx: 0, kby: 4, hitstun: 60, tumble: true,
  });
  for (let i = 0; i <= land; i += 1) sim.step({ p2: i === land - 6 ? { shield: true } : {} });
  assert.equal(sim.p2.state, STATES.ACTION);
  assert.equal(sim.p2.moveId, 'tech');
  assert.equal(sim.p2.canBeHit(), false, 'el tech es intangible');

  // Pulsado 14 frames antes: fuera de ventana.
  const late = makeSim();
  place(late.p2, { x: 640, y: 440, surfaceId: null });
  late.p2.applyLaunch({
    kbx: 0, kby: 4, hitstun: 60, tumble: true,
  });
  for (let i = 0; i <= land; i += 1) late.step({ p2: i === land - 14 ? { shield: true } : {} });
  if (land >= 14) assert.equal(late.p2.state, STATES.KNOCKDOWN);
});

test('machacar el escudo no da techs garantizados (bloqueo de 40 frames)', () => {
  const sim = makeSim();
  place(sim.p2, { x: 640, y: 440, surfaceId: null });
  sim.p2.applyLaunch({
    kbx: 0, kby: 4, hitstun: 60, tumble: true,
  });
  sim.p2.lastShieldPress = sim.frame - 5; // venía machacando
  let pressed = false;
  for (let i = 0; i < 40 && !sim.p2.grounded; i += 1) {
    sim.step({ p2: pressed ? {} : { shield: true } });
    pressed = !pressed;
  }
  assert.equal(sim.p2.state, STATES.KNOCKDOWN);
});

// ============================================================================
// 4 — KIT DE SAMUEL
// ============================================================================

test('ficha técnica de Samuel, literal', () => {
  const s = samuelConfig.stats;
  assert.equal(s.weight, 116);
  assert.equal(s.walkSpeed, 2.4);
  assert.equal(s.dashSpeed, 5.2);
  assert.equal(s.initialDashSpeed, 6.0);
  assert.equal(s.initialDashFrames, 4);
  assert.equal(s.maxAirSpeed, 3.6);
  assert.equal(s.airAcceleration, 0.55);
  assert.equal(s.jumpSquatFrames, 3);
  assert.equal(s.gravity, 0.58);
  assert.equal(s.maxFallSpeed, 11.0);
  // Sin velocidad de caída rápida propia: es 1.6x la terminal para todos.
  assert.equal(s.fastFallSpeed, undefined);
});

test('un personaje sin stats propios hereda la física global del diseño', () => {
  const { Fighter } = fighterModule;
  const bare = new Fighter({ slot: 'p1', config: { ...samuelConfig, stats: {} } });
  const s = bare.stats;
  assert.deepEqual(
    [s.gravity, s.maxFallSpeed, s.groundJumpVelocity, s.doubleJumpVelocity, s.jumpSquatFrames],
    [0.58, 11, -12.5, -11.0, 3],
  );
  assert.deepEqual([s.initialDashSpeed, s.initialDashFrames, s.airAcceleration], [6.0, 4, 0.55]);
});

test('números del diseño en los golpes (daño, BKB, KBG, ángulo)', () => {
  const m = samuelConfig.moveTable;
  const hb = (id, i = 0) => m[id].hitboxes[i];
  const expect = (id, dmg, bkb, kbg, angle, i = 0) => {
    const h = hb(id, i);
    assert.deepEqual([h.damage, h.bkb, h.kbg, h.angle], [dmg, bkb, kbg, angle], id);
  };
  expect('jab', 3, 15, 20, 80);
  expect('jab2', 4, 20, 25, 75);
  expect('jab_finisher', 5, 45, 70, 45);
  expect('ftilt', 11, 35, 85, 35);
  expect('utilt', 9, 40, 65, 85);
  expect('dtilt', 8, 30, 45, 280);
  expect('dashattack', 10, 50, 55, 60);
  expect('nair', 4, 35, 60, 55, 3);
  expect('fair', 13, 30, 88, 45);
  expect('bair', 14, 42, 95, 40);
  expect('uair', 11, 45, 90, 90);
  expect('dair', 12, 35, 82, 270);
  // Smashes recalibrados contra los umbrales de K.O. de un super pesado (ver
  // CLAUDE.md, sección 6): el daño y el ángulo son los de la spec; BKB/KBG son
  // los que dan sus umbrales medidos.
  expect('fsmash', 19, 6, 112, 361);
  expect('usmash', 17, 50, 116, 88);
  expect('dsmash', 15, 18, 80, 28);
  expect('dsmash', 15, 18, 80, 28, 1);
  expect('nspecial_l1', 5, 25, 30, 45);
  expect('nspecial_l2', 12, 40, 65, 42);
  expect('nspecial_l3', 22, 55, 105, 40);
  assert.equal(hb('jab_rapid').damage, 1);
  assert.deepEqual(m.nair.hitboxes.slice(0, 3).map((h) => h.damage), [2, 2, 2]);
  expect('dspecial', 18, 55, 88, 60);
  expect('dspecial', 9, 40, 60, 45, 1);
  const slam = m.uspecial_slam.slam;
  assert.deepEqual([slam.damage, slam.bkb, slam.kbg, slam.angle, slam.vy, slam.hang, slam.launchVy], [14, 70, 60, 40, 18, 3, -16.5]);
  const fs = m.final.finalSmash;
  assert.deepEqual([fs.damage, fs.pulses, fs.pulseDamage, fs.bkb, fs.kbg, fs.angle, fs.cinematicFrames],
    [42, 3, 4, 4, 148, 38, 90]);
});

test('jab: 1 -> 2 -> ráfaga de 1% -> empujón de panza al soltar', () => {
  const sim = makeSim();
  place(sim.p1, { x: 600, facing: 1 });
  place(sim.p2, { x: 650, facing: -1 });
  sim.p2.lastShieldPress = -1e9;
  const damages = [];
  for (let i = 0; i < 120; i += 1) {
    sim.step({ p1: { attack: i % 2 === 0 && i < 70 } });
    for (const e of sim.drainEvents()) if (e.type === 'hit') damages.push(e.damage);
  }
  // El TOPE: machacando U sin parar, el remate sale SOLO (en el frame 81, con
  // los hitlags de los 8 golpes). Sin tope, la ráfaga seguiría dando
  // manotazos al aire hasta las 24 vueltas.
  const mash = makeSim();
  place(mash.p1, { x: 600, facing: 1 });
  place(mash.p2, { x: 650, facing: -1 });
  let finisherAt = -1;
  for (let i = 0; i < 200 && finisherAt < 0; i += 1) {
    mash.step({ p1: { attack: i % 2 === 0 } });
    if (mash.p1.moveId === 'jab_finisher') finisherAt = i;
  }
  assert.equal(finisherAt, 81, 'el remate, a la sexta vuelta');
  assert.deepEqual(damages.slice(0, 2), [3, 4]);
  const rapid = damages.slice(2, -1);
  // Machacando U 70 frames (daría para 14 vueltas): la ráfaga se corta en 6.
  assert.equal(rapid.length, 6, `ráfaga: ${rapid}`);
  assert.ok(rapid.every((d) => d === 1));
  assert.equal(damages[damages.length - 1], 5);
});

test('jab: la ráfaga se corta al SOLTAR U tras el mínimo de 3 y sale el remate solo', () => {
  const sim = makeSim();
  place(sim.p1, { x: 600, facing: 1 });
  place(sim.p2, { x: 650, facing: -1 });
  const damages = [];
  let rapidStarted = -1;
  for (let i = 0; i < 160; i += 1) {
    const inRapid = sim.p1.moveId === 'jab_rapid';
    if (inRapid && rapidStarted < 0) rapidStarted = i;
    // U machacada hasta entrar en la ráfaga; después, suelta.
    sim.step({ p1: { attack: rapidStarted < 0 && i % 2 === 0 } });
    for (const e of sim.drainEvents()) if (e.type === 'hit') damages.push(e.damage);
  }
  assert.deepEqual(damages, [3, 4, 1, 1, 1, 5], 'el mínimo de 3 y el remate');
});

test('carga de smash: 60 frames manteniendo I = 1.4x de daño (19 -> 26.6)', () => {
  const plain = hitWith(makeSim(), 'fsmash');
  assert.equal(plain.damage, 19);

  const sim = makeSim();
  place(sim.p1, { x: 600, facing: 1 });
  place(sim.p2, { x: 650, facing: -1 });
  sim.step({ p1: { smash: true } });
  let hit = null;
  for (let i = 0; i < 200 && !hit; i += 1) {
    sim.step({ p1: { smash: i < 120 } });
    hit = sim.events.find((e) => e.type === 'hit');
  }
  assert.ok(hit);
  assert.ok(Math.abs(hit.damage - 26.6) < 1e-9, `daño cargado ${hit.damage}`);
});

test('D-Tilt entierra a un rival en el suelo, más tiempo cuanto más %', () => {
  const low = makeSim();
  hitWith(low, 'dtilt');
  assert.equal(low.p2.state, STATES.BURIED);
  const lowFrames = low.p2.buryTimer;
  const high = makeSim();
  hitWith(high, 'dtilt', { p2Percent: 120 });
  assert.equal(high.p2.state, STATES.BURIED);
  assert.ok(high.p2.buryTimer > lowFrames);
  // Golpearle enterrado le saca del suelo.
  drainHitlag(high);
  high.p1.startMove('ftilt');
  run(high, 20);
  assert.notEqual(high.p2.state, STATES.BURIED);
});

test('Dair es un meteoro: contra un rival en el aire lo manda hacia abajo', () => {
  const sim = makeSim();
  place(sim.p1, { x: 640, y: 300, surfaceId: null });
  place(sim.p2, { x: 640, y: 380, surfaceId: null });
  sim.p1.startMove('dair');
  let hit = null;
  for (let i = 0; i < 30 && !hit; i += 1) {
    sim.p2.vy = 0;
    sim.p2.y = sim.p1.y + 40;
    sim.step({});
    hit = sim.events.find((e) => e.type === 'hit');
  }
  assert.ok(hit, 'conecta');
  drainHitlag(sim);
  assert.ok(sim.p2.kby > 0 && Math.abs(sim.p2.kbx) < 1e-9);
});

test('Bair lanza hacia la ESPALDA de Samuel', () => {
  const sim = makeSim();
  place(sim.p1, { x: 640, y: 300, surfaceId: null, facing: 1 });
  place(sim.p2, { x: 596, y: 300, surfaceId: null });
  sim.p1.startMove('bair');
  let hit = null;
  for (let i = 0; i < 20 && !hit; i += 1) {
    sim.p2.vy = 0;
    sim.p1.vy = 0;
    sim.step({});
    hit = sim.events.find((e) => e.type === 'hit');
  }
  assert.ok(hit);
  drainHitlag(sim);
  assert.ok(sim.p2.kbx < 0, 'sale hacia la izquierda (detrás)');
});

test('PEDO ATÓMICO: nube enorme bajo el cuerpo y a los lados; pegado pega fuerte (18%), en el borde flojo (9%); lo catapulta arriba', () => {
  const waftAt = (dx) => {
    const sim = makeSim();
    place(sim.p1, { x: 600, facing: 1 });
    place(sim.p2, { x: 600 + dx, facing: -1 });
    sim.p1.startMove('dspecial');
    let hit = null;
    let lift = null;
    for (let i = 0; i < 30 && !hit; i += 1) {
      sim.step({});
      hit = sim.drainEvents().find((e) => e.type === 'hit');
      if (sim.p1.moveFrame === 12) lift = { vy: sim.p1.vy, grounded: sim.p1.grounded };
    }
    if (hit) drainHitlag(sim);
    return { hit, lift, kbx: sim.p2.kbx, kby: sim.p2.kby };
  };
  const close = waftAt(40);
  assert.equal(close.hit.damage, 18);
  assert.ok(close.kbx > 0 && close.kby < 0, 'hacia fuera y arriba');
  const behind = waftAt(-40);
  assert.equal(behind.hit.damage, 18, 'también por detrás');
  assert.ok(behind.kbx < 0, 'lanza hacia su lado');
  assert.equal(waftAt(70).hit.damage, 18, 'la parte fuerte llega hasta 60 px del centro (+ medio cuerpo)');
  const edge = waftAt(100);
  assert.equal(edge.hit.damage, 9, 'el borde de la nube');
  assert.equal(waftAt(150).hit ?? null, null, 'fuera, nada');
  assert.equal(close.lift.grounded, false, 'la detonación lo despega');
  assert.ok(Math.abs(close.lift.vy - (-17.5 + 0.58)) < 1e-9, `catapultado: ${close.lift.vy}`);
});

test('Cojín Donut: la embestida lleva Heavy Armor hasta 12% sin hitstun; 13%+ la rompe', () => {
  const sim = makeSim();
  place(sim.p1, { x: 600, facing: 1 });
  place(sim.p2, { x: 700, facing: -1 });
  sim.p1.startMove('sspecial');
  run(sim, 4);
  const armored = sim.p1.receiveHit(sim.p2, { damage: 12, bkb: 50, kbg: 50, angle: 40 }, 12);
  assert.equal(armored.type, 'armor');
  assert.equal(sim.p1.state, STATES.ACTION);
  assert.equal(sim.p1.percent, 12);
  const broken = sim.p1.receiveHit(sim.p2, { damage: 13, bkb: 50, kbg: 50, angle: 40 }, 13);
  assert.equal(broken.type, 'hit');
  assert.equal(sim.p1.state, STATES.HITSTUN);
});

test('Cojín Donut: O otra vez lanza el donut, que REBOTA dos veces (55%) y al tercer contacto se deshace', () => {
  const sim = makeSim();
  place(sim.p1, { x: 400, facing: 1 });
  place(sim.p2, { x: 1300, y: 200, surfaceId: null, facing: -1 }); // fuera del camino
  sim.p1.startMove('sspecial');
  run(sim, 12);
  sim.step({ p1: { special: true } });
  const events = [];
  let donut = null;
  const bounces = [];
  for (let i = 0; i < 150; i += 1) {
    sim.p2.vy = 0;
    sim.p2.y = 200;
    const before = sim.projectiles.list.find((p) => p.kind === 'donutCushion');
    const vyBefore = before ? before.vy + 0.45 : null;
    sim.step({});
    for (const e of sim.drainEvents()) {
      events.push(e);
      if (e.type === 'projectileBounce') bounces.push({ vyBefore, vyAfter: sim.projectiles.list.find((p) => p.kind === 'donutCushion').vy });
    }
    donut = donut || before;
  }
  assert.ok(donut, 'hay donut en vuelo');
  assert.equal(bounces.length, 2, 'dos botes');
  for (const b of bounces) assert.ok(Math.abs(b.vyAfter + b.vyBefore * 0.55) < 1e-9, `bote: ${b.vyBefore} -> ${b.vyAfter}`);
  assert.equal(events.filter((e) => e.type === 'projectileBreak').length, 1, 'y al tercero se deshace');
  // También rebota en los tablones (el tablón mide 180 px: se suelta encima,
  // lento, para que caiga en él).
  const plat = GEOMETRY.platforms[0];
  const onPlank = makeSim();
  place(onPlank.p2, { x: 1300, y: 200, surfaceId: null, facing: -1 });
  onPlank.spawnProjectile({ slot: 'p1', x: 450, y: 300, facing: 1 }, { projectile: 'donutCushion' });
  onPlank.projectiles.list[0].vx = 1;
  let plankBounce = null;
  for (let i = 0; i < 80 && !plankBounce; i += 1) {
    onPlank.p2.vy = 0;
    onPlank.p2.y = 200;
    onPlank.step({});
    plankBounce = onPlank.drainEvents().find((e) => e.type === 'projectileBounce');
  }
  assert.equal(plankBounce?.y, plat.y, 'bota en el tablón');
  // Golpea con 14%.
  const hitSim = makeSim();
  place(hitSim.p1, { x: 500, facing: 1 });
  place(hitSim.p2, { x: 640, facing: -1 });
  hitSim.p1.startMove('sspecial_throw');
  let hit = null;
  for (let i = 0; i < 60 && !hit; i += 1) {
    hitSim.step({});
    hit = hitSim.drainEvents().find((e) => e.type === 'hit');
  }
  assert.equal(hit.damage, 14);
});

test('Eructo cargable: 3 niveles, el escudo guarda la carga', () => {
  const sim = makeSim();
  place(sim.p1, { x: 600, facing: 1 });
  place(sim.p2, { x: 1000, facing: -1 });
  sim.step({ p1: { special: true } });
  run(sim, 40);
  sim.step({ p1: { shield: true } });
  assert.equal(sim.p1.chargeLevel(sim.p1.storedChargeFrames), 2);
  run(sim, 20);
  sim.step({ p1: { special: true } });
  assert.equal(sim.p1.state, STATES.CHARGE, 'retoma la carga guardada');
  run(sim, 60);
  assert.equal(sim.p1.moveId, 'nspecial_l3', 'a los 90 frames suelta el Eructo Nuclear');
});

test('agarre y lanzamientos: J atrapa, D lanza hacia delante con 9%', () => {
  const sim = makeSim();
  place(sim.p1, { x: 600, facing: 1 });
  place(sim.p2, { x: 650, facing: -1 });
  sim.step({ p1: { grab: true } });
  run(sim, 10);
  assert.equal(sim.p1.state, STATES.GRABBING);
  assert.equal(sim.p2.state, STATES.GRABBED);
  sim.step({ p1: { right: true } });
  run(sim, 20);
  assert.equal(sim.p2.percent, 9);
  assert.ok(sim.p2.kbx > 0);
});

test('el agarre gana al escudo', () => {
  const sim = makeSim();
  place(sim.p1, { x: 600, facing: 1 });
  place(sim.p2, { x: 650, facing: -1 });
  sim.p2.setState(STATES.SHIELD);
  sim.step({ p1: { grab: true }, p2: { shield: true } });
  run(sim, 10, {}, { shield: true });
  assert.equal(sim.p2.state, STATES.GRABBED);
});

test('escudo: se gasta al mantenerlo, un golpe no hace %, y al romperse aturde', () => {
  const sim = makeSim();
  place(sim.p1, { x: 600, facing: 1 });
  place(sim.p2, { x: 650, facing: -1 });
  sim.step({ p2: { shield: true } });
  const hp0 = sim.p2.shieldHp;
  run(sim, 10, {}, { shield: true });
  assert.ok(sim.p2.shieldHp < hp0);
  sim.p1.startMove('ftilt');
  run(sim, 20, {}, { shield: true });
  assert.equal(sim.p2.percent, 0);
  sim.p2.shieldHp = 5;
  sim.p1.startMove('fsmash');
  run(sim, 30, {}, { shield: true });
  assert.ok(sim.p2.state === STATES.SHIELD_BREAK || sim.p2.state === STATES.DIZZY);
  run(sim, 60);
  assert.equal(sim.p2.state, STATES.DIZZY);
});

test('esquiva aérea: una por salto, intangible, y se recupera al aterrizar', () => {
  const sim = makeSim();
  place(sim.p1, { x: 640, y: 200, surfaceId: null });
  sim.step({ p1: { shield: true, right: true } });
  assert.equal(sim.p1.moveId, 'airdodge');
  run(sim, 3);
  assert.equal(sim.p1.canBeHit(), false);
  run(sim, 40);
  sim.step({ p1: { shield: true } });
  assert.notEqual(sim.p1.moveId, 'airdodge', 'no hay segunda esquiva');
  run(sim, 200);
  assert.equal(sim.p1.airDodgeUsed, false);
});

test('Final Smash: solo con el medidor lleno; la onda captura y la cinemática dura 90 frames', () => {
  const sim = makeSim();
  place(sim.p1, { x: 500, facing: 1 });
  place(sim.p2, { x: 700, facing: -1 });
  sim.step({ p1: { ultra: true } });
  assert.notEqual(sim.p1.moveId, 'final', 'sin medidor no sale');
  sim.p1.meter = 100;
  run(sim, 2);
  sim.step({ p1: { ultra: true } });
  assert.equal(sim.p1.moveId, 'final');
  assert.equal(sim.p1.meter, 0);
  let started = -1;
  for (let i = 0; i < 80 && started < 0; i += 1) {
    sim.step({});
    if (sim.cine) started = sim.frame;
  }
  assert.ok(started > 0, 'la onda atrapa a P2');
  let boom = null;
  for (let i = 0; i < 200 && !boom; i += 1) {
    sim.step({});
    boom = sim.events.find((e) => e.type === 'finalBoom');
  }
  assert.ok(boom);
  // 3 compases de 4% durante el rapeo + 30% de la detonación = 42%.
  assert.equal(sim.p2.percent, 42);
  assert.equal(sim.p2.state, STATES.HITSTUN);
  assert.ok(sim.p2.kbx > 0, 'hacia la blast zone lateral');
});

// ============================================================================
// 3 — CONTROLES
// ============================================================================

test('Botón + Dirección -> movimiento, tabla de la sección 3', () => {
  const g = { grounded: true, facing: 1 };
  const a = { grounded: false, facing: 1 };
  const r = (button, ctx, dir) => resolveAttack(button, ctx, dir)?.move;
  assert.equal(r('attack', g, null), 'jab');
  assert.equal(r('attack', g, 'right'), 'ftilt');
  assert.equal(r('attack', g, 'up'), 'utilt');
  assert.equal(r('attack', g, 'down'), 'dtilt');
  assert.equal(r('attack', { ...g, running: true }, null), 'dashattack');
  assert.equal(r('attack', a, null), 'nair');
  assert.equal(r('attack', a, 'right'), 'fair');
  assert.equal(r('attack', a, 'left'), 'bair');
  assert.equal(r('attack', { grounded: false, facing: -1 }, 'right'), 'bair', 'atrás es relativo al facing');
  assert.equal(r('attack', a, 'up'), 'uair');
  assert.equal(r('attack', a, 'down'), 'dair');
  assert.equal(r('smash', g, 'right'), 'fsmash');
  assert.equal(r('smash', g, 'up'), 'usmash');
  assert.equal(r('smash', g, 'down'), 'dsmash');
  assert.equal(r('special', g, null), 'nspecial');
  assert.equal(r('special', g, 'left'), 'sspecial');
  assert.equal(r('special', a, 'up'), 'uspecial');
  assert.equal(r('special', g, 'down'), 'dspecial');
  assert.equal(r('grab', g, null), 'grab');
  assert.equal(r('ultra', g, null), 'final');
  assert.equal(resolveAttack('attack', g, 'left').turn, true, 'F-Tilt hacia atrás se da la vuelta');
});

test('W + U en el suelo es U-Tilt, no un salto', () => {
  const sim = makeSim();
  place(sim.p1, { x: 640 });
  sim.step({ p1: { jump: true, up: true, attack: true } });
  assert.equal(sim.p1.moveId, 'utilt');
  const late = makeSim();
  place(late.p1, { x: 640 });
  late.step({ p1: { jump: true, up: true } });
  late.step({ p1: { jump: true, up: true, attack: true } });
  assert.equal(late.p1.moveId, 'utilt', 'también dentro del jump squat');
  assert.equal(late.p1.grounded, true);
});

test('dash por doble toque: 6.0 px/f los 4 primeros frames y luego carrera a 5.2', () => {
  const tracker = new InputTracker();
  const seq = [{ right: true }, {}, {}, { right: true }];
  seq.forEach((st, i) => tracker.update(st, i));
  assert.equal(tracker.doubleTapped('right'), true);
  const sim = makeSim();
  place(sim.p1, { x: 400 });
  sim.step({ p1: { right: true } });
  assert.equal(sim.p1.state, STATES.WALK, 'un solo toque anda');
  sim.step({});
  sim.step({ p1: { right: true } });
  assert.equal(sim.p1.state, STATES.DASH);
  assert.equal(sim.p1.vx, 6);
  run(sim, 3, { right: true });
  assert.equal(sim.p1.state, STATES.DASH, 'sigue en dash inicial en el frame 4');
  assert.equal(sim.p1.vx, 6);
  run(sim, 1, { right: true });
  assert.equal(sim.p1.state, STATES.RUN);
  run(sim, 10, { right: true });
  assert.ok(Math.abs(sim.p1.vx - 5.2) < 1e-9, `carrera ${sim.p1.vx}`);
});

test('dash dance: invertir en el dash inicial da la vuelta al instante y a velocidad plena', () => {
  const sim = makeSim();
  place(sim.p1, { x: 640 });
  sim.step({ p1: { right: true } });
  sim.step({});
  sim.step({ p1: { right: true } });
  run(sim, 3, { right: true });
  // Pulsar A sin haber soltado D del todo: gana la última pulsada.
  sim.step({ p1: { right: true, left: true } });
  assert.equal(sim.p1.state, STATES.DASH);
  assert.equal(sim.p1.facing, -1);
  assert.equal(sim.p1.vx, -6, 'sin frenada: -6 en el mismo frame');
});

test('dash dance en teclado: tras un dash, UN toque basta para volver a dashear', () => {
  const sim = makeSim();
  place(sim.p1, { x: 400 });
  sim.step({ p1: { right: true } });
  sim.step({});
  run(sim, 20, { right: true }); // doble toque y a correr
  assert.equal(sim.p1.state, STATES.RUN);
  run(sim, 3); // suelta: frena
  // El doble toque ya caducó (la última pulsación de D fue hace 23 frames):
  // lo que da el dash aquí es haber estado dasheando hace menos de 8.
  sim.step({ p1: { right: true } });
  assert.equal(sim.p1.state, STATES.DASH);
  assert.equal(sim.p1.vx, 6);
  // Pasada la ventana, un toque suelto vuelve a ser andar.
  run(sim, 30);
  sim.step({ p1: { left: true } });
  assert.equal(sim.p1.state, STATES.WALK);
});

test('movilidad aérea: 0.55 px/f² de corrección en el aire', () => {
  const sim = makeSim();
  place(sim.p1, { x: 640, y: 200, surfaceId: null });
  sim.step({ p1: { right: true } });
  assert.ok(Math.abs(sim.p1.vx - 0.55) < 1e-9, `vx ${sim.p1.vx}`);
});

test('landing lag de aéreos breve (<= 8) y AUTOCANCEL de 4 tras los activos', () => {
  const lags = ['nair', 'fair', 'bair', 'uair'].map((id) => samuelConfig.moveTable[id].landingLag);
  assert.deepEqual(lags, [7, 8, 7, 6]);
  // Toca suelo EN MITAD del Fair (activos 14-18): paga su lag de 8.
  const mid = makeSim();
  place(mid.p1, { x: 640, y: 300, surfaceId: null });
  mid.p1.startMove('fair');
  for (let i = 0; i < 15; i += 1) {
    mid.p1.vy = 0;
    mid.step({});
  }
  mid.p1.vy = 5;
  mid.p1.y = 516;
  mid.step({});
  assert.equal(mid.p1.state, STATES.LANDING);
  assert.equal(mid.p1.lagFrames, 8);
  // Toca suelo DESPUÉS de los activos: autocancel, 4 frames.
  const late = makeSim();
  place(late.p1, { x: 640, y: 300, surfaceId: null });
  late.p1.startMove('fair');
  for (let i = 0; i < 20; i += 1) {
    late.p1.vy = 0;
    late.step({});
  }
  late.p1.y = 516;
  late.p1.vy = 5;
  late.step({});
  assert.equal(late.p1.state, STATES.LANDING);
  assert.equal(late.p1.lagFrames, 4);
  run(late, 4);
  assert.equal(late.p1.state, STATES.IDLE, 'actúa en el 5º frame');
});

test('BUFFER de 6 frames: lo pulsado durante el recovery sale en el primer frame libre', () => {
  // F-Tilt dura 28 frames. Se pulsa U en el frame N antes del final.
  const within = (framesBeforeEnd) => {
    const sim = makeSim();
    place(sim.p1, { x: 500 });
    place(sim.p2, { x: 900 });
    sim.p1.startMove('ftilt');
    const pressAt = 28 - framesBeforeEnd;
    let startedAt = null;
    for (let f = 1; f <= 40; f += 1) {
      sim.step({ p1: f === pressAt ? { attack: true } : {} });
      if (startedAt === null && sim.p1.moveId === 'jab') startedAt = f;
    }
    return startedAt;
  };
  // El F-Tilt acaba en el tick 28: el primer frame libre es el 29.
  assert.equal(within(5), 29, 'pulsado 5 frames antes: sale en el primer frame libre');
  assert.equal(within(0), 29);
  assert.equal(within(8), null, 'pulsado 8 frames antes: se pierde');
});

test('BUFFER: salto pulsado justo antes de tocar suelo sobrevive al lag de aterrizaje', () => {
  // El Fair aterriza con 8 de lag. Pulsado 5 frames antes de tocar suelo, la
  // ventana de 6 frames sola caducaría en mitad del lag: tiene que sobrevivir.
  const fall = (pressAt) => {
    const sim = makeSim();
    place(sim.p1, { x: 640, y: 380, surfaceId: null });
    sim.p1.jumpsLeft = 0; // sin doble salto: la pulsación no puede gastarse en el aire
    sim.p1.startMove('fair');
    let landed = null;
    let jumped = null;
    for (let f = 1; f <= 60; f += 1) {
      if (landed === null) sim.p1.moveFrame = Math.min(sim.p1.moveFrame, 15); // aterriza en activos
      sim.step({ p1: f === pressAt ? { jump: true } : {} });
      if (landed === null && sim.p1.grounded) landed = f;
      if (jumped === null && landed !== null && sim.p1.state === STATES.JUMPSQUAT) jumped = f;
    }
    return { landed, jumped };
  };
  const { landed } = fall(-1);
  assert.ok(landed > 6, `aterriza en ${landed}`);
  const { jumped } = fall(landed - 5);
  assert.equal(jumped, landed + 8 + 1, 'squat en el primer frame tras los 8 de lag');
});

test('BUFFER: lo pulsado durante el hitlag no se pierde', () => {
  const sim = makeSim();
  const hit = hitWith(sim, 'ftilt');
  assert.ok(hit && sim.hitlag > 2);
  // P1 pulsa y suelta U dentro de la congelación; su F-Tilt aún no ha
  // acabado, así que el jab tiene que salir al terminar el recovery.
  sim.p1.moveFrame = 26;
  sim.step({ p1: { attack: true } });
  sim.step({});
  drainHitlag(sim);
  run(sim, 3);
  assert.equal(sim.p1.moveId, 'jab');
});

test('BUFFER: cada pulsación se ejecuta UNA vez, aunque el golpe dure menos que el buffer', () => {
  // Un jab de 3 frames acaba DENTRO de la ventana de 6 de su propia pulsación:
  // si el buffer no la consumiera, saldría un segundo jab solo.
  const fast = {
    ...samuelConfig,
    moveTable: { ...samuelConfig.moveTable, jab: { ...samuelConfig.moveTable.jab, frames: 3, next: undefined } },
  };
  const sim = new Simulation({ geometry: GEOMETRY, p1: fast, p2: samuelConfig });
  sim.setOpponentPresent(true);
  place(sim.p1, { x: 640 });
  place(sim.p2, { x: 1000 });
  sim.step({ p1: { attack: true } });
  const first = sim.p1.moveInstance;
  run(sim, 12);
  assert.equal(sim.p1.moveInstance, first, 'no sale un segundo jab');
});

test('calibración: F-Tilt sale en el 7 con 18 de recovery; Nair sale en el 6 y es ancho', () => {
  const ftilt = samuelConfig.moveTable.ftilt;
  assert.equal(ftilt.hitboxes[0].from, 7);
  assert.equal(ftilt.frames - ftilt.hitboxes[0].to, 18);
  const nair = samuelConfig.moveTable.nair;
  assert.equal(Math.min(...nair.hitboxes.map((h) => h.from)), 6);
  assert.ok(nair.hitboxes.every((h) => h.w >= 120), 'radio amplio: casi dos cuerpos');
  assert.equal(samuelConfig.moveTable.jab.hitboxes[0].from, 4);
  // Y la tabla manda de verdad: el F-Tilt conecta en el 7º frame.
  const sim = makeSim();
  place(sim.p1, { x: 600, facing: 1 });
  place(sim.p2, { x: 650, facing: -1 });
  sim.p1.startMove('ftilt');
  let at = null;
  for (let f = 1; f <= 20 && at === null; f += 1) {
    sim.step({});
    if (sim.events.some((e) => e.type === 'hit')) at = f;
  }
  assert.equal(at, 7);
});

test('Up Special angulable y con deriva en la caída indefensa', () => {
  const sim = makeSim();
  place(sim.p1, { x: 100, y: 650, surfaceId: null }); // lejos de la losa
  sim.p1.startMove('uspecial');
  run(sim, 6, { right: true });
  assert.ok(Math.abs(sim.p1.vx - 2.6) < 0.6, `sale angulado: vx ${sim.p1.vx}`);
  run(sim, 40, { right: true });
  assert.equal(sim.p1.state, STATES.HELPLESS);
  run(sim, 20, { right: true });
  assert.equal(sim.p1.state, STATES.HELPLESS);
  // 85% de la movilidad aérea (3.06 px/f) frente al 50% genérico (1.8).
  assert.ok(sim.p1.vx > 2.9, `deriva en helpless: ${sim.p1.vx}`);
});

// ============================================================================
// 5 — CÁMARA
// ============================================================================

test('zoom de la cámara: fórmula del diseño recortada a [0.65, 1.15]', () => {
  assert.equal(targetZoomFor(0, 0), 1.15);
  assert.equal(targetZoomFor(5000, 0), 0.65);
  // 1280 / (720 + 280) = 1.28 -> 1.15; 720 / (440 + 280) = 1.0
  assert.equal(targetZoomFor(720, 440), 1);
});

// ============================================================================
// DETERMINISMO E INVARIANTES
// ============================================================================

function scriptedInputs(seed, frames) {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const keys = ['left', 'right', 'up', 'jump', 'down', 'attack', 'smash', 'special', 'grab', 'shield'];
  const out = [];
  let p1 = {};
  let p2 = {};
  for (let i = 0; i < frames; i += 1) {
    if (i % 7 === 0) {
      p1 = {};
      p2 = {};
      for (const k of keys) {
        if (rnd() < 0.18) p1[k] = true;
        if (rnd() < 0.18) p2[k] = true;
      }
    }
    out.push({ p1, p2 });
  }
  return out;
}

test('DETERMINISMO: la misma secuencia de inputs da la misma partida, frame a frame', () => {
  const inputs = scriptedInputs(1234, 3000);
  const a = makeSim({ phase: PHASES.FIGHT });
  const b = makeSim({ phase: PHASES.FIGHT });
  for (let i = 0; i < inputs.length; i += 1) {
    a.step(inputs[i]);
    b.step(inputs[i]);
    const sa = JSON.stringify(a.serialize());
    const sb = JSON.stringify(b.serialize());
    if (sa !== sb) assert.fail(`divergen en el frame ${i}`);
  }
  // Y la partida no es trivial: pasaron cosas.
  assert.ok(a.p1.matchStats.damageDealt + a.p2.matchStats.damageDealt > 20);
});

test('INVARIANTE: machacar botones 20000 frames no rompe nada ni deja a nadie sin control', () => {
  const sim = makeSim({ phase: PHASES.FIGHT });
  const inputs = scriptedInputs(99, 20000);
  let stuck = 0;
  let lastState = null;
  for (let i = 0; i < inputs.length; i += 1) {
    sim.step(inputs[i]);
    if (sim.phase !== PHASES.FIGHT) {
      sim.phase = PHASES.FIGHT;
      for (const f of sim.fighters) {
        if (f.state === STATES.ELIMINATED) f.resetForMatch(GEOMETRY.spawns[f.slot]);
      }
    }
    for (const f of sim.fighters) {
      for (const k of ['x', 'y', 'vx', 'vy', 'kbx', 'kby', 'percent', 'meter', 'shieldHp']) {
        if (!Number.isFinite(f[k])) assert.fail(`${f.slot}.${k} no es finito en el frame ${i}: ${f[k]}`);
      }
    }
    const key = sim.fighters.map((f) => `${f.state}:${f.moveId}`).join('|');
    stuck = key === lastState ? stuck + 1 : 0;
    lastState = key;
    // Ningún estado con input puede durar más de 10 s (el colgado máximo del
    // borde son 5 s y el mareo 4 s).
    assert.ok(stuck < 600, `atascado en ${key}`);
  }
  assert.ok(sim.projectiles.list.length < 32);
});

// ============================================================================
// RED
// ============================================================================

test('servidor: acepta un snapshot real y descarta los malformados', () => {
  const sim = makeSim({ phase: PHASES.FIGHT });
  run(sim, 30);
  const good = { ...sim.serialize(), events: [] };
  assert.equal(server.isSaneSnapshot(JSON.parse(JSON.stringify(good))), true);
  const bad = (mutate) => {
    const s = JSON.parse(JSON.stringify(good));
    mutate(s);
    return server.isSaneSnapshot(s);
  };
  assert.equal(bad((s) => { s.fighters[0].percent = -1; }), false);
  assert.equal(bad((s) => { s.fighters[0].percent = null; }), false);
  assert.equal(bad((s) => { s.fighters[1].stocks = 4; }), false);
  assert.equal(bad((s) => { s.fighters[1].x = 99999; }), false);
  assert.equal(bad((s) => { s.fighters[0].meter = 101; }), false);
  assert.equal(bad((s) => { s.phase = 'hack'; }), false);
  assert.equal(bad((s) => { s.cine = { frame: 5, total: 90, attacker: 'p1', victim: 'p1' }; }), false);
  assert.equal(bad((s) => { s.fighters.pop(); }), false);
});

// ============================================================================
// ARTE: los cuerpos apoyan en los pies
// ============================================================================

test('ninguna pose de CUERPO se hunde por debajo de los pies (se mide el ráster)', async () => {
  const { buildFighterAtlas, animationsForMoveTable } = await import('../public/src/engine/spriteAtlasBuilder.js');
  const { rosterVictimPoses } = await import('../public/src/characters/roster.js');
  const atlas = buildFighterAtlas({
    art: samuelConfig.art,
    color: samuelConfig.color,
    animations: animationsForMoveTable(samuelConfig.moveTable, rosterVictimPoses()),
  });
  // Poses cuyo arte baja de los pies A PROPÓSITO: es el efecto del golpe
  // (polvo del pisotón, barrido, llave, gas), no el cuerpo. `buttslam` es el
  // culazo del Dair y `rocket` el Up-B: el gas sale hacia ABAJO (la caja del
  // Dair, la detonación que lo catapulta).
  // `waft` es el Pedo Atómico: su nube sale bajo los pies.
  const effects = new Set(['stomp', 'lowswing', 'lowsweep', 'gasblast', 'uppercut', 'air_hurt', 'buttslam', 'rocket', 'waft']);
  const img = atlas.image;
  for (const [name, anim] of Object.entries(atlas.animations)) {
    if (effects.has(name)) continue;
    for (const fi of anim.frameIndices) {
      const f = atlas.frames[fi];
      let lowest = -1;
      for (let y = f.sh - 1; y >= 0 && lowest < 0; y -= 1) {
        for (let x = 0; x < f.sw; x += 1) {
          if (img.data[((f.sy + y) * img.width + f.sx + x) * 4 + 3] > 0) {
            lowest = y;
            break;
          }
        }
      }
      const below = lowest - f.pivotY;
      assert.ok(below <= 1, `${name}: el cuerpo baja ${below}px de los pies`);
    }
  }
});

test('REPOSO: postura de combate en 3/4, brazos desacoplados; la guardia alta solo en el aire, agachado y retrocediendo', async () => {
  const { createCanvas } = await import('./fakeCanvas.mjs');
  const { drawPixelFighter } = await import('../public/src/engine/pixelFighterArt.js');
  const { computePoseForKind } = await import('../public/src/engine/poseLibrary.js');
  // Píxeles de PIEL (rojo claramente por encima del azul: descarta el mono,
  // la barba y el fondo transparente) en una caja del sprite de 80x120.
  const skinIn = (pose, x0, y0, x1, y1) => {
    const c = createCanvas(80, 120);
    drawPixelFighter(c.getContext('2d'), { w: 80, h: 120, art: 'mecanico', pose });
    let n = 0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const i = (y * 80 + x) * 4;
        if (c.data[i + 3] > 0.5 && c.data[i] > 120 && c.data[i] - c.data[i + 2] > 50) n += 1;
      }
    }
    return n;
  };
  // POSTURA DE COMBATE EN 3/4, en todo el ciclo del reposo. Los dos brazos
  // iguales colgando (o cruzados) eran un maniquí de frente. Ahora:
  // - hombros en perspectiva: el de delante a 13 px del eje, junto al cuello
  //   y con su caída (a 15 y más alto era una joroba); el de atrás, escorzado
  //   DETRÁS de la cabeza, a 6;
  // - brazo de DELANTE relajado: cuelga (el brazo mide 17 + 16) con el codo
  //   hacia ATRÁS, flexionado 35-80°, y el antebrazo y el puño por delante de
  //   la barriga;
  // - brazo de ATRÁS en guardia: el puño junto a la mandíbula, asomando por
  //   delante de la cara, con el codo por debajo;
  // - y los dos, a alturas bien distintas: nada de simetría.
  const { armElbow, armHangs, mecanicoArms, ARM_UPPER, ARM_FORE } = await import('../public/src/engine/pixelFighterArt.js');
  assert.equal(ARM_UPPER + ARM_FORE, 33);
  const flexOf = (shoulder, elbow, fist) => {
    const a = Math.atan2(elbow.y - shoulder.y, elbow.x - shoulder.x);
    const b = Math.atan2(fist.y - elbow.y, fist.x - elbow.x);
    let d = Math.abs(a - b) * 180 / Math.PI;
    if (d > 180) d = 360 - d;
    return d;
  };
  for (const t of [0, 0.7, 1.4, 2.1, 2.8, 3.5]) {
    const idle = computePoseForKind('idle', { h: 120, kit: 'mecanico', t });
    assert.equal(idle.guard, 0, `t=${t}`);
    const arms = mecanicoArms({ w: 80, pose: idle });
    assert.equal(arms.shoulderFront.x - arms.cx, 13, `t=${t}: hombro de delante`);
    assert.equal(arms.cx - arms.shoulderBack.x, 6, `t=${t}: hombro de atrás, escorzado detrás de la cabeza`);
    const drop = arms.shoulderFront.y - (31 + idle.torsoOffY);
    assert.ok(drop >= 7 && drop <= 9, `t=${t}: el hombro cae desde el cuello (${drop.toFixed(1)})`);
    const F = arms.handFront;
    const B = arms.handBack;
    assert.ok(armHangs(arms.shoulderFront, F), `t=${t}: el brazo de delante cuelga`);
    assert.ok(F.x >= 55 && F.x <= 64 && F.y >= 62 && F.y <= 72, `t=${t}: puño de delante, delante de la barriga (${F.x.toFixed(1)}, ${F.y.toFixed(1)})`);
    assert.ok(arms.elbowFront.x < arms.shoulderFront.x, `t=${t}: codo de delante hacia atrás (${arms.elbowFront.x.toFixed(1)})`);
    const flex = flexOf(arms.shoulderFront, arms.elbowFront, F);
    assert.ok(flex >= 35 && flex <= 80, `t=${t}: codo de delante un poco doblado (${flex.toFixed(0)}°)`);
    assert.ok(B.y >= 26 && B.y <= 36 && B.x >= 58, `t=${t}: puño de atrás junto a la mandíbula (${B.x.toFixed(1)}, ${B.y.toFixed(1)})`);
    assert.ok(arms.elbowBack.y > B.y + 6, `t=${t}: el codo de atrás, por debajo de su puño`);
    assert.ok(F.y - B.y >= 25, `t=${t}: brazos desacoplados, no simétricos`);
  }
  // La regla del codo: con la mano delante a la altura del hombro (guardia,
  // golpe), el codo va ABAJO; con la mano plegada bajo el hombro, hacia el
  // eje del cuerpo, nunca hacia fuera.
  const guardElbow = armElbow({ x: 55, y: 38 }, { x: 70, y: 40 }, 40);
  assert.ok(guardElbow.y > 42, `guardia: el codo abajo (${guardElbow.y.toFixed(1)})`);
  // Colgando pero con la mano ADELANTADA (el péndulo al andar), el codo
  // sigue yendo hacia atrás, no hacia delante.
  const swung = armElbow({ x: 53, y: 39 }, { x: 58, y: 71 }, 40);
  assert.ok(swung.x < 55.5, `balanceo: el codo atrás (${swung.x.toFixed(1)})`);
  const folded = armElbow({ x: 25, y: 38 }, { x: 25, y: 54 }, 40);
  assert.ok(folded.x > 25, `plegado: hacia el torso, no hacia fuera (${folded.x.toFixed(1)})`);
  // Y el kit DIBUJA con esa regla: el codo del brazo de atrás no asoma por
  // fuera de la silueta ni colgando ni al recoger el puño del jab (con la
  // cadena doblando siempre al mismo lado, llegaba a x 6: el ala).
  const leftEdge = (pose) => {
    const c = createCanvas(80, 120);
    drawPixelFighter(c.getContext('2d'), { w: 80, h: 120, art: 'mecanico', pose });
    let m = 99;
    for (let y = 40; y < 66; y += 1) for (let x = 0; x < 80; x += 1) if (c.data[(y * 80 + x) * 4 + 3] > 0.5) { m = Math.min(m, x); break; }
    return m;
  };
  assert.ok(leftEdge(computePoseForKind('idle', { h: 120, kit: 'mecanico', t: 0 })) >= 10, 'reposo: sin ala');
  assert.ok(leftEdge(computePoseForKind('jab', { h: 120, kit: 'mecanico', progress: 0.2 })) >= 10, 'jab recogido: sin ala');
  // Los golpes salen del reposo (y vuelven a él): el puño de delante abajo,
  // delante de la barriga, y el de atrás en la mandíbula.
  for (const kind of ['jab', 'bootkick', 'walk-fwd']) {
    const pose = computePoseForKind(kind, { h: 120, kit: 'mecanico', progress: 0, t: 0.3 });
    assert.ok(62 + pose.armFrontOffY >= 62 && 61 + pose.armBackOffY <= 36, `${kind}: sale del reposo`);
  }
  // En el JAB el brazo de delante se estira en horizontal y el de atrás se
  // queda protegiendo la barbilla.
  for (const progress of [0.3, 0.4, 0.5]) {
    const a = mecanicoArms({ w: 80, pose: computePoseForKind('jab', { h: 120, kit: 'mecanico', progress }) });
    assert.ok(a.handFront.x - a.shoulderFront.x >= 25 && Math.abs(a.handFront.y - a.shoulderFront.y) <= 8, `jab ${progress}: brazo de delante estirado`);
    assert.ok(a.handBack.y <= 36 && a.handBack.x >= 58, `jab ${progress}: el de atrás, en la barbilla (${a.handBack.x}, ${a.handBack.y})`);
  }
  // Andando hacia delante, la postura del reposo con un PÉNDULO suave a
  // contrapié: cuando un puño va hacia delante, el otro va hacia atrás.
  const walkAt = (t) => computePoseForKind('walk-fwd', { h: 120, kit: 'mecanico', t });
  const fx = [], bx = [];
  for (let i = 0; i < 24; i += 1) {
    const w = walkAt(i * 0.13);
    fx.push(w.armFrontOffX);
    bx.push(w.armBackOffX);
    assert.ok(62 + w.armFrontOffY >= 60 && 61 + w.armBackOffY <= 38, `andando: la postura del reposo (${i})`);
  }
  const span = (v) => Math.max(...v) - Math.min(...v);
  assert.ok(span(fx) >= 3.5 && span(fx) <= 6.5, `péndulo del brazo de delante: ±${(span(fx) / 2).toFixed(1)} px`);
  assert.ok(span(bx) >= 3.5 && span(bx) <= 6.5, `péndulo del brazo de atrás: ±${(span(bx) / 2).toFixed(1)} px`);
  const mf = fx.reduce((a, b) => a + b) / fx.length, mb = bx.reduce((a, b) => a + b) / bx.length;
  const corr = fx.reduce((a, v, i) => a + (v - mf) * (bx[i] - mb), 0);
  assert.ok(corr < 0, 'los brazos balancean a contrapié');
  // Y el kit lee la guardia: con ella, el puño de DELANTE (el iluminado)
  // sube a la barbilla; en reposo allí solo asoma el de atrás, en sombra.
  const chin = [60, 30, 72, 42];
  const lit = (pose, x0, y0, x1, y1) => {
    const c = createCanvas(80, 120);
    drawPixelFighter(c.getContext('2d'), { w: 80, h: 120, art: 'mecanico', pose });
    let n = 0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const i = (y * 80 + x) * 4;
        if (c.data[i + 3] > 0.5 && c.data[i] >= 190) n += 1; // piel con luz: #c98a5c y más clara
      }
    }
    return n;
  };
  const idle = computePoseForKind('idle', { h: 120, kit: 'mecanico', t: 0 });
  assert.ok(lit(idle, ...chin) < 10, `en reposo el puño de delante no está en la barbilla (${lit(idle, ...chin)})`);
  const raised = { ...idle, guard: 1, armFrontOffX: 0, armFrontOffY: 0 };
  assert.ok(lit(raised, ...chin) > 30, `con guardia, el puño de delante sube a la barbilla (${lit(raised, ...chin)})`);
  // ESCUDO: guardia de boxeo, encorvado hacia delante.
  const block = computePoseForKind('block', { h: 120, kit: 'mecanico', t: 0 });
  assert.equal(block.guard, 1);
  assert.ok((block.lean || 0) > 0, 'escudo: encorvado hacia delante');
  assert.ok(skinIn(block, ...chin) > 30, 'escudo: puños a la mandíbula');
  // Y la MISMA guardia de boxeo en todo lo que la lleva (escudo, salto,
  // agachado, retroceder). Nada de brazos cruzados sobre el pecho (se leía
  // como una momia): los DOS puños a la altura de la cara, el de delante por
  // delante del de atrás y cada uno por delante de su hombro; los codos
  // cerrados contra las costillas apuntando al suelo, sin cruzar el pecho
  // (con el puño justo encima del hombro, el codo de delante se iba de lado
  // hasta el hombro contrario, o se abría hacia fuera a la altura del hombro).
  for (const [kind, o] of [['block', { t: 0 }], ['block', { t: 1.2 }], ['jump', { rising: true }], ['jump', { rising: false }], ['crouch', {}], ['walk-back', { t: 0.2 }], ['walk-back', { t: 1.1 }]]) {
    const pose = computePoseForKind(kind, { h: 120, kit: 'mecanico', ...o });
    const a = mecanicoArms({ w: 80, pose });
    const tag = `${kind} ${JSON.stringify(o)}`;
    const neck = 31 + pose.torsoOffY;
    for (const [f, name] of [[a.handFront, 'delante'], [a.handBack, 'atrás']]) {
      assert.ok(f.y >= neck - 16 && f.y <= neck + 6, `${tag}: puño de ${name} a la altura de la cara (y=${f.y.toFixed(1)}, cuello ${neck})`);
    }
    assert.ok(a.handFront.x > a.handBack.x + 4, `${tag}: puños escalonados, no cruzados`);
    assert.ok(a.handFront.x >= a.shoulderFront.x + 5, `${tag}: el puño de delante, por delante de su hombro`);
    assert.ok(a.handBack.x >= a.shoulderBack.x + 5, `${tag}: el de atrás, por delante del suyo`);
    for (const [e, sh, f, max, name] of [
      [a.elbowFront, a.shoulderFront, a.handFront, a.shoulderFront.x + 22, 'delante'],
      [a.elbowBack, a.shoulderBack, a.handBack, a.shoulderFront.x, 'atrás'],
    ]) {
      // (El de atrás va detrás del torso: basta con que quede bajo su puño.)
      const floor = name === 'delante' ? Math.max(sh.y, f.y) + 3 : f.y + 6;
      assert.ok(e.y > floor, `${tag}: el codo de ${name} abajo (${e.y.toFixed(1)})`);
      assert.ok(e.x >= sh.x - 2 && e.x <= max, `${tag}: el codo de ${name} cerrado, sin cruzar (${e.x.toFixed(1)})`);
    }
  }
  assert.equal(computePoseForKind('walk-fwd', { h: 120, kit: 'mecanico' }).guard, 0);
  for (const kind of ['walk-back', 'jump', 'crouch']) {
    assert.equal(computePoseForKind(kind, { h: 120, kit: 'mecanico' }).guard, 1, kind);
  }
  // Los golpes no llevan guardia: sus manos van en coordenadas absolutas.
  for (const kind of ['jab', 'crankswing', 'uppercut', 'chairslam']) {
    assert.equal(computePoseForKind(kind, { h: 120, kit: 'mecanico', progress: 0.5 }).guard, 0, kind);
  }
});

test('BRAZOS: una extremidad de hombro a puño, sin jorobas, sin bíceps hinchados y nunca en X', async () => {
  const { createCanvas } = await import('./fakeCanvas.mjs');
  const { drawPixelFighter, mecanicoArms, armElbow, armHangs } = await import('../public/src/engine/pixelFighterArt.js');
  const { computePoseForKind } = await import('../public/src/engine/poseLibrary.js');
  const draw = (pose) => {
    const c = createCanvas(80, 120);
    drawPixelFighter(c.getContext('2d'), { w: 80, h: 120, art: 'mecanico', pose });
    return c;
  };
  const idle = computePoseForKind('idle', { h: 120, kit: 'mecanico', t: 0 });
  const c = draw(idle);
  // Silueta: por detrás, en las filas de los hombros (y 34-39), el contorno
  // no pasa de x 19; por delante, a lo largo del brazo de arriba (y 37-45,
  // bajo el puño de atrás, que asoma en la mandíbula), no pasa de 60. Con el
  // hombro de delante abierto y alto (la joroba) o el bíceps de 7 px de
  // radio, la silueta se abría hasta el 61 y más.
  const edge = (y) => {
    let l = 99, r = -1;
    for (let x = 0; x < 80; x += 1) if (c.data[(y * 80 + x) * 4 + 3] > 0.5) { l = Math.min(l, x); r = Math.max(r, x); }
    return [l, r];
  };
  for (let y = 34; y < 40; y += 1) assert.ok(edge(y)[0] >= 19, `fila ${y}: sin joroba por detrás (${edge(y)[0]})`);
  for (let y = 37; y < 46; y += 1) assert.ok(edge(y)[1] <= 60, `fila ${y}: sin joroba ni bíceps hinchado por delante (${edge(y)[1]})`);
  // Hombro y brazo, UNA pieza del mismo tono: alrededor del hombro no hay un
  // aro de sombra (el deltoides pintado como masa propia, con su sombra
  // alrededor, era una pieza de plástico suelta: 70 px de sombra frente a 30).
  const arms = mecanicoArms({ w: 80, pose: idle });
  for (const s of [arms.shoulderBack, arms.shoulderFront]) {
    let n = 0;
    for (let y = Math.round(s.y) - 7; y <= s.y + 7; y += 1) {
      for (let x = Math.round(s.x) - 7; x <= s.x + 7; x += 1) {
        const i = (y * 80 + x) * 4;
        if (c.data[i + 3] > 0.5 && Math.abs(c.data[i] - 0x6d) < 3 && Math.abs(c.data[i + 1] - 0x42) < 3 && Math.abs(c.data[i + 2] - 0x25) < 3) n += 1;
      }
    }
    assert.ok(n <= 45, `hombro en (${s.x}, ${s.y.toFixed(1)}): sin aro de sombra (${n})`);
  }
  // Nunca en X: en ninguna reacción ni pose de suelo el brazo PLEGADO
  // vuelve cruzado. Si la mano está a un lado del hombro, el codo no se va
  // más de 3 px al lado contrario (brazos en X, pinzas de cangrejo: la mano
  // fuera y el codo hacia dentro). Colgando, el codo va atrás siempre: es la
  // flexión natural (la mide el test del reposo).
  const kinds = [
    ['idle', { t: 0 }], ['walk-fwd', { t: 0.4 }], ['hitstun', { progress: 0.1 }], ['hitstun', { progress: 0.6 }],
    ['air_hurt', { t: 0.2 }], ['air_hurt', { t: 0.7 }], ['stagger', { t: 0.3 }], ['stagger', { t: 1 }],
    ['knockdown', {}], ['wakeup', { progress: 0.3 }], ['wakeup', { progress: 0.6 }], ['dizzy', { t: 0.2 }],
  ];
  for (const [kind, o] of kinds) {
    const a = mecanicoArms({ w: 80, pose: computePoseForKind(kind, { h: 120, kit: 'mecanico', ...o }) });
    for (const [e, sh, f, name] of [[a.elbowFront, a.shoulderFront, a.handFront, 'delante'], [a.elbowBack, a.shoulderBack, a.handBack, 'atrás']]) {
      const hand = f.x - sh.x;
      const elbow = e.x - sh.x;
      if (!armHangs(sh, f) && Math.abs(hand) > 3) {
        assert.ok(elbow * Math.sign(hand) >= -3, `${kind} ${JSON.stringify(o)}: brazo de ${name} en X (mano ${hand.toFixed(1)}, codo ${elbow.toFixed(1)})`);
      }
    }
  }
  // Las reacciones (golpe, juggle, tambaleo) cuelgan los brazos desde la
  // base del reposo; desde el puño del kit viejo, por fuera de la cadera, el
  // brazo quedaba plegado: pinzas o alas según la regla del codo.
  for (const [kind, o] of [['hitstun', { progress: 0.1 }], ['hitstun', { progress: 0.6 }], ['air_hurt', { t: 0.2 }], ['air_hurt', { t: 0.7 }], ['stagger', { t: 0.3 }], ['stagger', { t: 1 }]]) {
    const a = mecanicoArms({ w: 80, pose: computePoseForKind(kind, { h: 120, kit: 'mecanico', ...o }) });
    assert.ok(armHangs(a.shoulderFront, a.handFront) && armHangs(a.shoulderBack, a.handBack), `${kind} ${JSON.stringify(o)}: los brazos cuelgan`);
  }
  // La regla, sola: plegado con la mano abajo y hacia fuera, el codo va con
  // la mano (no hacia el eje); con la mano algo más abajo que el hombro sin
  // colgar, tampoco manda "el codo más bajo" si eso lo cruza.
  const out = armElbow({ x: 53, y: 70 }, { x: 62, y: 84 }, 40);
  assert.ok(out.x > 53, `plegado hacia fuera: el codo con la mano (${out.x.toFixed(1)})`);
  const low = armElbow({ x: 53, y: 51.5 }, { x: 58, y: 70.6 }, 40);
  assert.ok(low.x > 50, `mano baja: el codo no cruza (${low.x.toFixed(1)})`);
});

test('CAPAS DE PROFUNDIDAD: brazo de atrás -> cuerpo -> brazo de delante, el de atrás en sombra', async () => {
  const { createCanvas } = await import('./fakeCanvas.mjs');
  const { drawPixelFighter } = await import('../public/src/engine/pixelFighterArt.js');
  const { computePoseForKind } = await import('../public/src/engine/poseLibrary.js');
  const draw = (pose, outfit = 'normal') => {
    const c = createCanvas(80, 120);
    drawPixelFighter(c.getContext('2d'), { w: 80, h: 120, art: 'mecanico', outfit, pose });
    return c;
  };
  const diffIn = (a, b, x0, y0, x1, y1) => {
    let n = 0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const i = (y * 80 + x) * 4;
        if ([0, 1, 2, 3].some((k) => Math.abs(a.data[i + k] - b.data[i + k]) > 1e-6)) n += 1;
      }
    }
    return n;
  };
  const idle = computePoseForKind('idle', { h: 120, kit: 'mecanico', t: 0 });
  // Los dos puños, llevados al CENTRO DEL PECHO (40, 50). El de atrás queda
  // detrás del torso: el pecho no cambia ni un píxel. El de delante lo tapa.
  const chest = [32, 44, 48, 56];
  const backIn = { ...idle, armBackOffX: 40 - 20, armBackOffY: 50 - 61 };
  const frontIn = { ...idle, armFrontOffX: 40 - 61, armFrontOffY: 50 - 62 };
  const base = draw(idle);
  assert.equal(diffIn(base, draw(backIn), ...chest), 0, 'el brazo de atrás va DETRÁS del torso');
  assert.ok(diffIn(base, draw(frontIn), ...chest) > 60, 'el brazo de delante va POR ENCIMA del torso');
  // El de atrás, en SOMBRA: su puño asoma junto a la mandíbula sin un solo
  // píxel de la piel con luz (#c98a5c, #e6b487) y con los tonos oscuros; el
  // de delante sí lleva la piel con luz.
  const count = (c, box, colors) => {
    const rgb = colors.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
    let n = 0;
    for (let y = box[1]; y < box[3]; y += 1) {
      for (let x = box[0]; x < box[2]; x += 1) {
        const i = (y * 80 + x) * 4;
        if (c.data[i + 3] > 0.5 && rgb.some((q) => q.every((v, k) => Math.abs(c.data[i + k] - v) < 3))) n += 1;
      }
    }
    return n;
  };
  const backFist = [58, 25, 68, 36];
  const frontFist = [54, 63, 65, 75];
  assert.equal(count(base, backFist, ['#c98a5c', '#e6b487']), 0, 'puño de atrás sin luz');
  assert.ok(count(base, backFist, ['#96603a', '#6d4225']) > 25, `puño de atrás en sombra: ${count(base, backFist, ['#96603a', '#6d4225'])}`);
  assert.ok(count(base, frontFist, ['#c98a5c', '#e6b487']) > 20, `puño de delante con luz: ${count(base, frontFist, ['#c98a5c', '#e6b487'])}`);
  // Y la tinta del torso lo separa: entre el puño de atrás y el pecho hay
  // contorno (el torso se perfila por encima del brazo que pasa por detrás).
  const ink = (c, box) => {
    let n = 0;
    for (let y = box[1]; y < box[3]; y += 1) {
      for (let x = box[0]; x < box[2]; x += 1) {
        const i = (y * 80 + x) * 4;
        if (c.data[i + 3] > 0.5 && c.data[i] + c.data[i + 1] + c.data[i + 2] < 90) n += 1;
      }
    }
    return n;
  };
  assert.ok(ink(base, [52, 30, 66, 42]) >= 8, `contorno entre el brazo de atrás y el cuerpo: ${ink(base, [52, 30, 66, 42])}`);
  // Despertado: la manga de la camiseta tapa el bíceps del brazo de delante.
  const { mecanicoArms } = await import('../public/src/engine/pixelFighterArt.js');
  const a = mecanicoArms({ w: 80, pose: idle, awake: true });
  const aw = draw(idle, 'awakened');
  const mid = { x: Math.round(a.shoulderFront.x + (a.elbowFront.x - a.shoulderFront.x) * 0.3), y: Math.round(a.shoulderFront.y + (a.elbowFront.y - a.shoulderFront.y) * 0.3) };
  const i = (mid.y * 80 + mid.x) * 4;
  assert.ok(aw.data[i] > 150 && aw.data[i + 1] > 150 && aw.data[i + 2] > 150, `manga sobre el bíceps en (${mid.x}, ${mid.y})`);
});

// ============================================================================
// PAUSA
// ============================================================================

test('PAUSA: ESC congela la simulación entera y solo quien pausó la reanuda', () => {
  const sim = makeSim({ phase: PHASES.FIGHT });
  place(sim.p1, { x: 600, y: 300, surfaceId: null });
  run(sim, 3);
  const before = JSON.stringify(sim.fighters.map((f) => f.view()));
  const frame = sim.frame;
  sim.step({ p1: { pause: true } });
  assert.equal(sim.paused, true);
  assert.equal(sim.pausedBy, 'p1');
  run(sim, 60, { right: true, attack: true }, { pause: true, attack: true });
  assert.equal(sim.frame, frame, 'no avanza ni un frame');
  assert.equal(JSON.stringify(sim.fighters.map((f) => f.view())), before);
  assert.equal(sim.paused, true, 'P2 no puede quitar la pausa de P1');
  sim.step({ p1: { pause: true } });
  assert.equal(sim.paused, false);
  assert.equal(sim.serialize().paused, false);
});

test('PAUSA: las teclas de la guía no salen como acciones al reanudar', () => {
  const sim = makeSim({ phase: PHASES.FIGHT });
  place(sim.p1, { x: 640 });
  sim.step({ p1: { pause: true } });
  run(sim, 10, { jump: true, up: true, attack: true, right: true });
  // Reanuda manteniendo aún las teclas con las que navegaba.
  sim.step({ p1: { pause: true, jump: true, up: true, attack: true, right: true } });
  sim.step({ p1: { jump: true, up: true, attack: true, right: true } });
  assert.notEqual(sim.p1.state, STATES.JUMPSQUAT);
  assert.notEqual(sim.p1.state, STATES.ACTION);
});

test('PAUSA: pausar no cambia la partida (mismo resultado con y sin pausas)', () => {
  const inputs = scriptedInputs(777, 1500);
  const clean = makeSim({ phase: PHASES.FIGHT });
  for (const inp of inputs) clean.step(inp);
  const paused = makeSim({ phase: PHASES.FIGHT });
  inputs.forEach((inp, i) => {
    if (i === 400) {
      // Una pausa de 120 frames a mitad, navegando la guía, y reanudar con
      // las mismas teclas mantenidas que antes de pausar (si al reanudar se
      // mantiene OTRA cosa, es otra partida, y está bien que lo sea).
      const before = inputs[399];
      paused.step({ p1: { ...before.p1, pause: true }, p2: before.p2 });
      for (let k = 0; k < 120; k += 1) paused.step({ p1: k % 3 ? { down: true } : { right: true } });
      paused.step({ p1: { ...before.p1, pause: true }, p2: before.p2 });
    }
    paused.step(inp);
  });
  const strip = (snap) => JSON.stringify({ ...snap, paused: null, pausedBy: null });
  assert.equal(strip(paused.serialize()), strip(clean.serialize()));
});

test('PAUSA: no se puede pausar en la cuenta atrás ni en los resultados', () => {
  const sim = makeSim();
  sim.enterPhase(PHASES.COUNTDOWN);
  sim.step({ p1: { pause: true } });
  assert.equal(sim.paused, false);
  sim.enterPhase(PHASES.RESULTS);
  sim.step({ p1: {} });
  sim.step({ p1: { pause: true } });
  assert.equal(sim.paused, false);
});

test('servidor: `paused` tiene que ser booleano y con quién pausó', () => {
  const sim = makeSim({ phase: PHASES.FIGHT });
  sim.step({ p1: { pause: true } });
  const good = JSON.parse(JSON.stringify({ ...sim.serialize(), events: [] }));
  assert.equal(server.isSaneSnapshot(good), true);
  assert.equal(server.isSaneSnapshot({ ...good, paused: 'yes' }), false);
  assert.equal(server.isSaneSnapshot({ ...good, pausedBy: 'p9' }), false);
});

// ============================================================================
// GUÍA DE LA PAUSA
// ============================================================================

test('la guía toma los números de la moveTable, no de un texto', async () => {
  const { buildGuide } = await import('../public/src/engine/moveGuide.js');
  const rows = buildGuide(samuelConfig).flatMap((s) => s.rows);
  const row = (name) => rows.find((r) => r.moves[0] === name);
  assert.equal(row('ftilt').startup, 'F7');
  assert.equal(row('ftilt').damage, '11%');
  assert.equal(row('nair').damage, '10%', 'multi-hit: 2+2+2+4');
  assert.equal(row('fair').damage, '13%', 'sweetspot y mango son el mismo golpe: el mejor, no la suma');
  assert.equal(row('nspecial_l1').damage, '5-22%');
  assert.equal(row('fsmash').charge, 'CARGA X1.4');
  assert.equal(row('dspecial').damage, '18%', 'el centro de la nube (el borde es la parte floja)');
  assert.equal(row('uspecial').damage, '14%', 'el daño es el del estampado');
  // Retocar la tabla cambia la guía sola.
  const tweaked = JSON.parse(JSON.stringify(samuelConfig));
  tweaked.moveTable.ftilt.hitboxes[0].from = 9;
  const tweakedRow = buildGuide(tweaked).flatMap((s) => s.rows).find((r) => r.moves[0] === 'ftilt');
  assert.equal(tweakedRow.startup, 'F9');
});

test('todo el texto de la pausa cabe en su columna y tiene glifo en la fuente', async () => {
  const {
    tabLines, TABS, MOVE_COLS, PANEL,
  } = await import('../public/src/engine/pauseMenu.js');
  const { missingGlyphs, measurePixelText } = await import('../public/src/engine/pixelFont.js');
  const inner = PANEL.w - 44;
  for (let tab = 0; tab < TABS.length; tab += 1) {
    for (const line of tabLines(tab, samuelConfig)) {
      const xs = line.map((seg) => seg.x).sort((a, b) => a - b);
      for (const seg of line) {
        assert.deepEqual(missingGlyphs(seg.text), [], `sin glifo en "${seg.text}"`);
        const next = xs.find((x) => x > seg.x) ?? inner;
        const width = measurePixelText(seg.text, 2);
        assert.ok(seg.x + width <= next - 4, `"${seg.text}" (${width}px) no cabe antes de x=${next}`);
      }
    }
  }
  assert.ok(MOVE_COLS.charge + measurePixelText('CARGA X1.4', 2) <= inner);
});

test('la guía no miente: el F-Smash mata cerca del borde entre el 90% y el 94%', () => {
  // Contra el rival de referencia (peso 100) con el MEJOR DI de los 9 posibles
  // y que reacciona (doble salto y Up-B hacia dentro). Ver koThreshold.
  const at = koThreshold({ move: 'fsmash', x1: 880, x2: 930 }, 80, 110);
  assert.ok(at >= 90 && at <= 94, `mata desde el ${at}%`);
});

// ============================================================================
// CAPA COMPETITIVA — BORDES, DI, ESCUDO, SPECIAL ZOOM
// ============================================================================

// Fija el retroceso para que el PRÓXIMO paso de física desplace (dx, dy)
// exactos: el decaimiento (0.17 px/f²) se come parte de la magnitud y la
// gravedad (0.58) se suma a la velocidad propia, que parte de 0.
function aimKnockback(f, dx, dy) {
  const kx = dx;
  const ky = dy - 0.58;
  const m = Math.hypot(kx, ky);
  const k = (m + 0.17) / m;
  f.kbx = kx * k;
  f.kby = ky * k;
}

// Deja caer a `f` sobre el borde izquierdo (o el derecho) hasta que se cuelga.
function hangFrom(sim, f, side = -1) {
  place(f, { x: side < 0 ? 314 : 966, y: 560, surfaceId: null });
  f.vy = 1;
  for (let i = 0; i < 30; i += 1) {
    sim.step({});
    if (f.state === STATES.LEDGE_HANG) return i;
  }
  return -1;
}

test('borde: se barre el RECORRIDO de las manos, y a gran velocidad engancha igual', () => {
  // Lanzado en diagonal a 20 px/f por cada eje: las manos pasan de (338, 502),
  // encima de la caja del borde (330..350 x 508..532), a (318, 522), fuera por
  // la izquierda. Ningún extremo está dentro, pero el tramo la atraviesa.
  for (const side of [-1, 1]) {
    const sim = makeSim();
    const f = sim.p1;
    place(f, { x: side < 0 ? 312 : 968, y: 598, surfaceId: null });
    f.setState(STATES.TUMBLE);
    aimKnockback(f, side * 20, 20);
    sim.step({});
    assert.equal(f.state, STATES.LEDGE_HANG, `engancha el borde ${side < 0 ? 'izquierdo' : 'derecho'}`);
    // Anclaje exacto: manos en el punto del borde y cero inercia.
    assert.equal(f.x, side < 0 ? 314 : 966);
    assert.equal(f.y, 616);
    assert.deepEqual([f.vx, f.vy, f.kbx, f.kby], [0, 0, 0, 0]);
  }
});

test('borde: radio de captura de 16 px, literal', () => {
  // Segmento horizontal que pasa justo a 16 px por debajo del punto: entra.
  assert.equal(physics.segmentEntersCircle(300, 536, 380, 536, 340, 520, physics.LEDGE_GRAB_RADIUS), 0.5);
  // A 16.5 px, no.
  assert.equal(physics.segmentEntersCircle(300, 536.5, 380, 536.5, 340, 520, physics.LEDGE_GRAB_RADIUS), null);
  // Un tramo que acaba antes de llegar al círculo no lo toca (se barre el
  // recorrido del frame, no la recta entera).
  assert.equal(physics.segmentEntersCircle(280, 520, 320, 520, 340, 520, physics.LEDGE_GRAB_RADIUS), null);
});

test('borde: una diagonal que pasa a 12 px del borde se ancla; a 17 px, no', () => {
  // Las manos van de (325, 500) a (329, 532): pasan a 12.4 px del borde
  // (340, 520) sin llegar nunca a x=330 —la caja de 20x24 de antes no las
  // cogía—. Desplazadas 5 px hacia fuera pasan a 17.4 px: fuera del radio.
  for (const side of [-1, 1]) {
    for (const [offset, grabs] of [[0, true], [5, false]]) {
      const sim = makeSim();
      const f = sim.p1;
      // Manos del lado del escenario: x + 26 en el borde izquierdo, x - 26 en el derecho.
      const handX = 325 - offset;
      place(f, { x: side < 0 ? handX - 26 : 1280 - handX + 26, y: 596, surfaceId: null });
      f.setState(STATES.TUMBLE);
      aimKnockback(f, -side * 4, 32);
      sim.step({});
      const label = `${side < 0 ? 'izquierdo' : 'derecho'} a ${offset ? 17 : 12} px`;
      assert.equal(f.state === STATES.LEDGE_HANG, grabs, label);
      if (grabs) {
        assert.deepEqual([f.vx, f.vy, f.kbx, f.kby], [0, 0, 0, 0], label);
        assert.equal(f.x, side < 0 ? 314 : 966);
        assert.equal(f.y, 616);
      }
    }
  }
});

test('LEDGE TRUMP: agarrar un borde ocupado lo roba; el que colgaba sale despedido (3.2, -4.5) y vulnerable', () => {
  for (const side of [-1, 1]) {
    const sim = makeSim();
    assert.ok(hangFrom(sim, sim.p1, side) >= 0);
    run(sim, 10); // aún le quedan 20 frames de la intangibilidad del agarre
    sim.drainEvents();
    assert.ok(hangFrom(sim, sim.p2, side) >= 0, 'p2 agarra el borde OCUPADO: no hay bloqueo exclusivo');
    assert.equal(sim.p2.x, side < 0 ? 314 : 966);
    assert.equal(sim.p1.state, STATES.TRUMPED);
    assert.equal(sim.p1.vx, side * 3.2, 'expulsado hacia FUERA del escenario');
    assert.equal(sim.p1.vy, -4.5, 'y hacia arriba');
    assert.equal(sim.p1.canBeHit(), true, 'pierde la intangibilidad que le quedaba');
    const ev = sim.events.find((e) => e.type === 'ledgeTrump');
    assert.equal(ev.slot, 'p2');
    assert.equal(ev.victim, 'p1');
  }
});

test('LEDGE TRUMP: el expulsado pasa 14 frames sin poder actuar', () => {
  const sim = makeSim();
  hangFrom(sim, sim.p1);
  run(sim, 10);
  hangFrom(sim, sim.p2);
  assert.equal(sim.p1.state, STATES.TRUMPED);
  // Machaca el salto: la pulsación del frame 13 queda en el buffer y sale en
  // el primer frame libre, que tiene que ser el 15.
  for (let i = 1; i <= 14; i += 1) {
    sim.step({ p1: { jump: i % 2 === 1 } });
    assert.equal(sim.p1.jumpsLeft, 1, `frame ${i}: todavía no puede saltar`);
  }
  sim.step({});
  assert.equal(sim.p1.jumpsLeft, 0, 'frame 15: el doble salto guardado sale');
});

test('LEDGE TRUMP: no hay robo en bucle — el expulsado no re-agarra hasta pasados 30 frames', () => {
  const sim = makeSim();
  hangFrom(sim, sim.p1);
  run(sim, 10);
  hangFrom(sim, sim.p2);
  run(sim, 15);
  // Con las manos DENTRO de la caja del borde y cayendo: sin el cooldown
  // robaría el borde en el acto, y los dos se lo quitarían frame a frame.
  place(sim.p1, { x: 314, y: 610, surfaceId: null });
  sim.p1.vy = 1;
  sim.step({});
  assert.equal(sim.p1.state, STATES.AIR);
  assert.equal(sim.p2.state, STATES.LEDGE_HANG);
  run(sim, 15);
  place(sim.p1, { x: 314, y: 610, surfaceId: null });
  sim.p1.vy = 1;
  sim.step({});
  assert.equal(sim.p1.state, STATES.LEDGE_HANG, 'pasado el cooldown lo roba de vuelta');
  assert.equal(sim.p2.state, STATES.TRUMPED);
});

test('LEDGE TRUMP: la ventana de castigo es real — soltarse + Bair conecta antes de que el expulsado actúe', () => {
  const sim = makeSim({ phase: PHASES.FIGHT });
  hangFrom(sim, sim.p1);
  run(sim, 10);
  hangFrom(sim, sim.p2);
  sim.drainEvents();
  // p2 mira al escenario (derecha): "atrás" es la izquierda. 4 frames
  // colgado antes de aceptar input, suelta con atrás y saca el Bair.
  const plan = [{}, {}, {}, { left: true }, { left: true, attack: true }];
  let at = -1;
  for (let i = 1; i <= 30 && at < 0; i += 1) {
    sim.step({ p2: plan[i - 1] ?? {} });
    if (sim.events.some((e) => e.type === 'hit' && e.slot === 'p2')) at = i;
    sim.drainEvents();
  }
  assert.ok(at > 0 && at <= 14, `el Bair de castigo conecta en el frame ${at} (el expulsado actúa en el 15)`);
});

test('LEDGE TRUMP: si los dos agarran en el MISMO frame, se lo queda el que llegó después', () => {
  const setup = (early, late) => {
    const sim = makeSim();
    const a = sim.fighter(early);
    const b = sim.fighter(late);
    // Manos de `a` de y=507 a 519: entran en la caja (508) al 8% del frame.
    place(a, { x: 314, y: 603, surfaceId: null });
    aimKnockback(a, 0, 12);
    // Manos de `b` de y=490 a 510: entran al 90% del frame.
    place(b, { x: 314, y: 586, surfaceId: null });
    aimKnockback(b, 0, 20);
    sim.step({});
    return [b.state, a.state];
  };
  assert.deepEqual(setup('p1', 'p2'), [STATES.LEDGE_HANG, STATES.TRUMPED]);
  assert.deepEqual(setup('p2', 'p1'), [STATES.LEDGE_HANG, STATES.TRUMPED]);
});

test('DI: gira la trayectoria hasta 18°, solo con la componente PERPENDICULAR', () => {
  assert.ok(Math.abs(combat.diAngle(0, 0, 1) - 18) < 1e-9, 'arriba contra un lanzamiento horizontal: los 18° enteros');
  assert.ok(Math.abs(combat.diAngle(0, 0, -1) + 18) < 1e-9);
  assert.ok(Math.abs(combat.diAngle(0, 1, 0)) < 1e-9, 'a favor del golpe no gira');
  assert.ok(Math.abs(combat.diAngle(0, -1, 0)) < 1e-9, 'en contra tampoco');
  assert.ok(Math.abs(combat.diAngle(45, -1, 1) - 63) < 1e-9, 'perpendicular a un lanzamiento de 45°');
  assert.ok(Math.abs(combat.diAngle(45, 1, -1) - 27) < 1e-9);
  assert.ok(Math.abs(combat.diAngle(0, 1, 1) - 12.7279) < 1e-4, 'en diagonal cuenta solo su parte perpendicular');
  const di = combat.applyDI(10, 0, 0, 1);
  assert.ok(Math.abs(Math.hypot(di.kbx, di.kby) - 10) < 1e-9, 'gira, no frena');
  assert.ok(Math.abs(Math.atan2(-di.kby, di.kbx) * (180 / Math.PI) - 18) < 1e-9);
});

test('DI: se lee al ACABAR el hitlag, con la dirección de ese frame', () => {
  // F-Smash (38°) a p2 al 50%. Arriba: 38 + 18·cos(38°) = 52.18°.
  const launchAngle = (duringHitlag, atRelease) => {
    const sim = makeSim();
    const hit = hitWith(sim, 'fsmash', { gap: 60, p2Percent: 50 });
    assert.ok(hit);
    while (sim.hitlag > 0) sim.step({ p2: duringHitlag });
    sim.step({ p2: atRelease });
    return Math.atan2(-sim.p2.kby, sim.p2.kbx) * (180 / Math.PI);
  };
  assert.ok(Math.abs(launchAngle({}, {}) - 38) < 0.01, 'sin DI, 38°');
  assert.ok(Math.abs(launchAngle({}, { up: true }) - 52.18) < 0.01, `con arriba al soltarse: ${launchAngle({}, { up: true })}`);
  assert.ok(Math.abs(launchAngle({ up: true }, {}) - 38) < 0.01, 'soltado antes del final del hitlag no cuenta');
  assert.ok(Math.abs(launchAngle({}, { down: true }) - 23.82) < 0.01, 'abajo lo aplana');
});

test('DI: apuntar al escenario salva a porcentajes altos; el mal DI mata antes', () => {
  // F-Smash desde el borde derecho; la víctima mantiene la dirección desde
  // que la golpean. Solo cuenta el K.O. LATERAL.
  const firstKill = (di) => {
    for (let p = 40; p <= 160; p += 2) {
      const sim = makeSim({ phase: PHASES.FIGHT });
      place(sim.p1, { x: 880, facing: 1 });
      place(sim.p2, { x: 930, facing: -1 });
      sim.p2.percent = p;
      sim.p1.startMove('fsmash');
      let hit = false;
      let side = null;
      for (let i = 0; i < 400 && !side; i += 1) {
        sim.step({ p2: hit ? di : {} });
        for (const e of sim.drainEvents()) {
          if (e.type === 'hit') hit = true;
          if (e.type === 'ko') side = e.side;
        }
      }
      if (side === 'right') return p;
    }
    return null;
  };
  const none = firstKill({});
  const survival = firstKill({ up: true, left: true });
  const bad = firstKill({ down: true, right: true });
  assert.ok(none >= 74 && none <= 86, `sin DI mata desde el ${none}%`);
  assert.ok(survival >= none + 16, `DI arriba-dentro aguanta hasta el ${survival}%`);
  assert.ok(bad <= none - 2, `mal DI muere antes: ${bad}%`);
});

test('SHIELDSTUN = floor(daño·0.8 + 3), literal', () => {
  assert.equal(combat.shieldstunFrames(3), 5);
  assert.equal(combat.shieldstunFrames(11), 11);
  assert.equal(combat.shieldstunFrames(18), 17);
});

test('SHIELDSTUN: el defensor no puede soltar el escudo, saltar ni contraatacar', () => {
  const sim = makeSim();
  place(sim.p1, { x: 600, facing: 1 });
  place(sim.p2, { x: 670, facing: -1 });
  sim.step({ p2: { shield: true } });
  sim.p1.startMove('ftilt'); // 11%: 11 frames de shieldstun
  let blocked = false;
  for (let i = 0; i < 20 && !blocked; i += 1) {
    sim.step({ p2: { shield: true } });
    blocked = sim.events.some((e) => e.type === 'hit' && e.outcome === 'shield');
  }
  assert.ok(blocked);
  assert.ok(sim.hitlag > 0, 'el hitlag de escudo congela también al atacante');
  while (sim.hitlag > 0) sim.step({});
  // Suelta el escudo y machaca salto, contraataque (O + S) y agarre.
  for (let i = 1; i <= 10; i += 1) {
    const mash = i % 2 === 1;
    sim.step({ p2: { jump: mash, special: mash, down: true, grab: mash } });
    assert.equal(sim.p2.state, STATES.SHIELDSTUN, `frame ${i} de 11: sigue bloqueado`);
  }
  sim.step({});
  assert.notEqual(sim.p2.state, STATES.SHIELDSTUN, 'en el 11 se acaba');
});

test('escudo: a bocajarro se castiga con agarre; espaciado o con poco recovery, no', () => {
  // El defensor agarra en cuanto sale del shieldstun (pulsado en el buffer);
  // el atacante reacciona (`react`) en su primer frame libre.
  const punished = (move, gap, react) => {
    const sim = makeSim();
    place(sim.p1, { x: 600, facing: 1 });
    place(sim.p2, { x: 600 + gap, facing: -1 });
    sim.step({ p2: { shield: true } });
    sim.p1.startMove(move);
    let shielded = false;
    let grabbed = false;
    let pressed = false;
    let reacted = false;
    for (let i = 0; i < 90; i += 1) {
      const p2 = { shield: true };
      if (shielded && !pressed && sim.p2.state === STATES.SHIELDSTUN && sim.p2.stateFrame >= sim.p2.lagFrames - 2) {
        p2.grab = true;
        pressed = true;
      }
      let p1 = {};
      if (shielded && !reacted && sim.hitlag === 0 && sim.p1.state !== STATES.ACTION) {
        p1 = react;
        reacted = true;
      }
      sim.step({ p1, p2 });
      for (const e of sim.drainEvents()) {
        if (e.type === 'hit' && e.outcome === 'shield') shielded = true;
        if (e.type === 'grab' && e.slot === 'p2') grabbed = true;
      }
    }
    assert.ok(shielded, `${move} a ${gap} px conecta en el escudo`);
    return grabbed;
  };
  const spotdodge = { shield: true, down: true };
  assert.equal(punished('ftilt', 50, spotdodge), true, 'F-Tilt a bocajarro: castigado');
  assert.equal(punished('ftilt', 90, spotdodge), false, 'F-Tilt espaciado: a salvo');
  assert.equal(punished('fsmash', 60, spotdodge), true, 'F-Smash a bocajarro: castigado');
  assert.equal(punished('fsmash', 110, spotdodge), false, 'F-Smash en la punta: a salvo');
  assert.equal(punished('jab', 50, spotdodge), false, 'Jab (13 frames): a salvo aun a bocajarro');
  assert.equal(punished('jab', 50, { jump: true }), false, 'también saltando');
});

test('SPECIAL ZOOM: un golpe que mata SIN REMEDIO alarga el hitlag 10 frames', () => {
  const edgeFsmash = (percent, di = {}, escape = false) => {
    const sim = makeSim({ phase: PHASES.FIGHT });
    place(sim.p1, { x: 880, facing: 1 });
    place(sim.p2, { x: 930, facing: -1 });
    sim.p2.percent = percent;
    sim.p1.startMove('fsmash');
    let hit = null;
    let hitlag = 0;
    for (let i = 0; i < 400; i += 1) {
      let p2 = {};
      if (hit) {
        p2 = { ...di };
        // Escapatoria: doble salto (corta el retroceso) en cuanto acaba el hitstun.
        if (escape && sim.p2.state === STATES.TUMBLE) p2.jump = true;
      }
      sim.step({ p2 });
      for (const e of sim.drainEvents()) {
        if (e.type === 'hit' && !hit) {
          hit = e;
          hitlag = sim.hitlag;
        }
        if (e.type === 'ko') return { hit, hitlag, ko: e.side };
      }
    }
    return { hit, hitlag, ko: null };
  };
  // Al 130% desde el borde: letal con cualquier DI y cualquier escapatoria.
  const dirs = [{}, { up: true }, { down: true }, { left: true }, { right: true },
    { up: true, left: true }, { up: true, right: true }, { down: true, left: true }, { down: true, right: true }];
  for (const di of dirs) {
    const r = edgeFsmash(130, di, true);
    assert.equal(r.hit.lethal, true);
    assert.equal(r.hit.freeze, 22, 'hitlag 12 del F-Smash + 10');
    assert.equal(r.hitlag, 22);
    assert.equal(r.ko, 'right', `muere con DI ${JSON.stringify(di)}`);
  }
  // Al 80% un muñeco muere, pero con DI arriba-dentro y doble salto al acabar
  // el hitstun se salva del lateral: no hay zoom, ni hitlag extra.
  const dummy = edgeFsmash(80);
  assert.equal(dummy.ko, 'right');
  assert.equal(dummy.hit.lethal, false);
  assert.equal(dummy.hitlag, 12);
  const escaped = edgeFsmash(80, { up: true, left: true }, true);
  assert.notEqual(escaped.ko, 'right', 'con DI y doble salto se salva del lateral');
});

test('SPECIAL ZOOM: nunca anuncia un K.O. que luego no llega', () => {
  let flagged = 0;
  for (const [move, x1, x2] of [['fsmash', 880, 930], ['usmash', 640, 690], ['fsmash', 600, 650]]) {
    for (let p = 0; p <= 240; p += 12) {
      for (const di of [{}, { up: true, left: true }, { down: true }, { left: true }]) {
        const sim = makeSim({ phase: PHASES.FIGHT });
        place(sim.p1, { x: x1, facing: 1 });
        place(sim.p2, { x: x2, facing: -1 });
        sim.p2.percent = p;
        sim.p1.startMove(move);
        let lethal = false;
        let ko = null;
        let hit = false;
        for (let i = 0; i < 400 && !ko; i += 1) {
          sim.step({ p2: hit ? di : {} });
          for (const e of sim.drainEvents()) {
            if (e.type === 'hit' && !hit) {
              hit = true;
              lethal = e.lethal;
            }
            if (e.type === 'ko') ko = e.side;
          }
        }
        if (lethal) {
          flagged += 1;
          assert.ok(ko, `${move} al ${p}% con DI ${JSON.stringify(di)} anunció un K.O. que no llegó`);
        }
      }
    }
  }
  assert.ok(flagged >= 20, `el barrido tiene que incluir golpes letales (hay ${flagged})`);
});

test('SPECIAL ZOOM: chocar con una pared durante el vuelo NO es K.O. seguro (hay tech de pared)', async () => {
  const { predictCertainKO } = await import('../public/src/engine/killPredictor.js');
  // Spike en diagonal hacia la pared de la losa (x=340), junto a ella.
  const victim = {
    x: 300, y: 600, kbx: 14, kby: 12, hitstun: 60, grounded: false, surfaceId: null,
    halfWidth: 26, height: 108, stats: { gravity: 0.58, maxFallSpeed: 11 },
  };
  assert.equal(predictCertainKO(victim, GEOMETRY), false, 'contra la pared puede hacer tech');
  // El mismo vuelo lejos de la losa, sin nada contra lo que chocar: sí.
  assert.equal(predictCertainKO({ ...victim, x: 150 }, GEOMETRY), true);
  // Y si el hitstun acaba antes de cruzar, tampoco: el doble salto lo frena.
  assert.equal(predictCertainKO({ ...victim, x: 150, hitstun: 8 }, GEOMETRY), false);
});

test('K.O.: la detonación nace en el punto EXACTO de cruce, no donde acaba el frame', () => {
  const sim = makeSim({ phase: PHASES.FIGHT });
  place(sim.p2, { x: 1395, y: 300, surfaceId: null });
  sim.p2.setState(STATES.TUMBLE);
  // Centro del cuerpo de (1395, 246) a (1415, 226): cruza x=1400 a un cuarto
  // del recorrido, en y=241. La posición final sería y=226.
  aimKnockback(sim.p2, 20, -20);
  sim.step({});
  const ko = sim.events.find((e) => e.type === 'ko');
  assert.equal(ko.side, 'right');
  assert.equal(ko.x, 1400);
  assert.ok(Math.abs(ko.y - 241) < 1e-6, `y de cruce ${ko.y}`);
});

test('estela: la vista marca el vuelo tras un golpe de KB > 38, teñida por quien golpea si KB > 60', () => {
  const trailAfter = (move, opts) => {
    const sim = makeSim();
    assert.ok(hitWith(sim, move, opts));
    drainHitlag(sim);
    sim.step({});
    return { view: sim.p2.view(), sim };
  };
  const jab = trailAfter('jab', { gap: 50 }).view; // KB 18.6
  assert.equal(jab.trail, 0);
  const ftilt = trailAfter('ftilt', { gap: 50 }); // KB 50.3
  assert.equal(ftilt.view.trail, 1);
  const fsmash = trailAfter('fsmash', { gap: 60, p2Percent: 50 }).view; // KB 129.8
  assert.equal(fsmash.trail, 2);
  assert.equal(fsmash.trailBy, 'p1');
  assert.ok(Math.abs(fsmash.vx) > 5, 'la vista lleva la velocidad total para trazar el vector');
  // Se apaga cuando acaba el vuelo sin control.
  const { sim } = ftilt;
  for (let i = 0; i < 200 && (sim.p2.state === STATES.HITSTUN || sim.p2.state === STATES.TUMBLE); i += 1) sim.step({});
  assert.equal(sim.p2.view().trail, 0);
});

test('cámara: el Special Zoom SALTA a 1.35 sobre el contacto y se queda clavado lo que dure la congelación', () => {
  const cam = new CameraManager({ blastZones: GEOMETRY.blastZones });
  const views = [{ x: 500, y: 520, bodyHeight: 108, visible: true }, { x: 800, y: 520, bodyHeight: 108, visible: true }];
  for (let i = 0; i < 200; i += 1) cam.update(views);
  assert.ok(cam.zoom < 1.2);
  cam.specialZoom(700, 460, 22);
  assert.equal(cam.zoom, 1.35, 'instantáneo, sin lerp');
  assert.equal(cam.x, 700);
  assert.equal(cam.y, 460);
  for (let i = 0; i < 22; i += 1) cam.update(views);
  assert.equal(cam.zoom, 1.35, 'clavado los 22 frames');
  assert.equal(cam.x, 700);
  cam.update(views);
  assert.ok(cam.zoom < 1.35 && cam.x < 700, 'al soltarse vuelve con el lerp de siempre');
});

// ============================================================================
// DESACOPLE DE RETROCESO Y HITSTUN, Y LA ESQUINA DE LA LOSA
// ============================================================================

// F-Smash de p1 contra p2 pegado; p2 hace lo que diga `control(sim, hit)` en
// cada frame. Devuelve el evento del golpe, el hitstun que le quedó a p2, el
// K.O. (lado) si lo hubo y los frames entre el fin del hitlag y el primer
// frame en que p2 puede actuar.
function fsmashOn(percent, { x1 = 600, control = () => ({}) } = {}) {
  const sim = makeSim({ phase: PHASES.FIGHT });
  place(sim.p1, { x: x1, facing: 1 });
  place(sim.p2, { x: x1 + 50, facing: -1 });
  sim.p2.percent = percent;
  sim.p1.startMove('fsmash');
  let hit = null;
  let hitstun = null;
  let lagLeft = 0;
  let stunned = 0;
  let freeAt = null;
  for (let i = 0; i < 500; i += 1) {
    sim.step({ p2: hit ? control(sim, hit) : {} });
    for (const e of sim.drainEvents()) {
      if (e.type === 'hit' && !hit) {
        hit = e;
        hitstun = sim.p2.hitstun;
        lagLeft = sim.hitlag;
      }
      if (e.type === 'ko' && e.slot === 'p2') return { hit, hitstun, ko: e.side, freeAt };
    }
    if (hit && lagLeft > 0) {
      lagLeft = sim.hitlag;
    } else if (hit && freeAt === null) {
      stunned += 1;
      if (sim.p2.state !== STATES.HITSTUN) freeAt = stunned;
    }
  }
  return { hit, hitstun, ko: null, freeAt };
}

// Un jugador que reacciona: DI y deriva hacia el escenario, doble salto en su
// primer frame libre en que el golpe ya no le sube (el salto CONSERVA la
// inercia vertical: saltar antes sería morir por arriba), y Up-B hacia el
// escenario cuando vuelve a caer.
function recovering() {
  let jumped = false;
  let upb = false;
  return (sim) => {
    const f = sim.p2;
    const toward = f.x > 640 ? { left: true } : { right: true };
    const free = f.state === STATES.TUMBLE || f.state === STATES.AIR;
    if (free && !jumped && f.kby >= -2) {
      jumped = true;
      return { ...toward, jump: true };
    }
    if (free && jumped && !upb && f.jumpsLeft === 0 && f.vy + f.kby > 0) {
      upb = true;
      return { ...toward, up: true, special: true };
    }
    return toward;
  };
}

test('DESACOPLE: al 45% el F-Smash lanza a más de 6 px/f pero bloquea como mucho 22 frames', () => {
  const r = fsmashOn(45);
  // 45% sobre Samuel (116): pTerm = 4.5 + 42.75 = 47.25; wTerm = 200/216;
  // ((47.25*0.9259*1.4)+18)*1.12 + 6 = 94.76. Ángulo Sakurai en el suelo con
  // KB 94.76 (> 88): 38°. 9.48 px/f -> 7.47 en horizontal.
  assert.ok(Math.abs(r.hit.kb - 94.76) < 0.01, `KB ${r.hit.kb}`);
  assert.equal(r.hit.lethal, false);
  assert.equal(r.hitstun, 22);
  const sim = makeSim({ phase: PHASES.FIGHT });
  place(sim.p1, { x: 600, facing: 1 });
  place(sim.p2, { x: 650, facing: -1 });
  sim.p2.percent = 45;
  sim.p1.startMove('fsmash');
  while (!sim.drainEvents().some((e) => e.type === 'hit')) sim.step({});
  assert.ok(sim.p2.kbx > 6, `sale a ${sim.p2.kbx} px/f en horizontal`);
  assert.ok(Math.abs(sim.p2.kbx - 9.476 * Math.cos(38 * Math.PI / 180)) < 0.01);
  // Fuera del escenario (desde el borde), a los 22 frames de acabar el
  // hitlag ya puede actuar. (Desde el centro vuelve a caer sobre la losa
  // antes: el tumble acaba al tocar suelo.)
  assert.equal(fsmashOn(45, { x1: 880 }).freeAt, 22);
});

test('DESACOPLE: la inmovilidad larga SOLO existe en un golpe que mata', () => {
  // Barrido de % desde el centro y desde el borde, con la víctima quieta: o el
  // hitstun es corto (≤ 22), o el golpe es letal, lleva el hitstun de Smash
  // floor(KB*0.4) y la víctima muere.
  let long = 0;
  for (const x1 of [600, 880]) {
    for (let p = 0; p <= 200; p += 8) {
      const r = fsmashOn(p, { x1 });
      if (r.hitstun <= 22 && !r.hit.lethal) continue;
      long += 1;
      assert.equal(r.hit.lethal, true, `al ${p}% desde x=${x1}: hitstun ${r.hitstun} sin ser letal`);
      assert.equal(r.hitstun, Math.floor(r.hit.kb * 0.4));
      assert.ok(r.ko, `al ${p}% desde x=${x1}: bloqueo largo sin K.O.`);
    }
  }
  assert.ok(long >= 10, `el barrido tiene que incluir golpes letales (hay ${long})`);
});

test('DESACOPLE: junto al borde, al 60% se vuelve reaccionando; al 110% no', () => {
  // Antes (hitstun floor(KB*0.4) siempre) este F-Smash mataba a un jugador que
  // reaccionaba desde el 54%: 57 frames de bloqueo al 60%.
  const r60 = fsmashOn(60, { x1: 880, control: recovering() });
  assert.equal(r60.hit.lethal, false);
  assert.ok(r60.hitstun <= 22);
  assert.equal(r60.ko, null, 'al 60% vuelve al escenario');
  const r110 = fsmashOn(110, { x1: 880, control: recovering() });
  assert.equal(r110.hit.lethal, true);
  assert.equal(r110.ko, 'right', 'al 110% es K.O. seguro');
});

test('TUMBLE: Up-B en el frame 23 tras un golpe al 50% sale y corta el retroceso a la mitad', () => {
  // Desde el borde derecho: la víctima sale del escenario (desde el centro, al
  // 50% vuelve a tocar la losa justo en el frame 23).
  const setup = () => {
    const sim = makeSim({ phase: PHASES.FIGHT });
    place(sim.p1, { x: 880, facing: 1 });
    place(sim.p2, { x: 930, facing: -1 });
    sim.p2.percent = 50;
    sim.p1.startMove('fsmash');
    while (!sim.drainEvents().some((e) => e.type === 'hit')) sim.step({});
    drainHitlag(sim);
    run(sim, 22);
    return sim;
  };
  // Control: sin tocar nada, en el frame 23 el retroceso solo decae.
  const idle = setup();
  assert.equal(idle.p2.state, STATES.TUMBLE, 'a los 22 frames ya no está en hitstun');
  const kbx = idle.p2.kbx;
  const kby = idle.p2.kby;
  idle.step({});
  const decay = Math.hypot(idle.p2.kbx, idle.p2.kby) / Math.hypot(kbx, kby);
  assert.ok(decay > 0.95, 'sin cancelar, el vuelo sigue');

  const sim = setup();
  assert.ok(sim.p2.kbx > 5, 'sigue volando rápido cuando recupera el control');
  sim.step({ p2: { up: true, special: true } });
  assert.equal(sim.p2.state, STATES.ACTION);
  assert.equal(sim.p2.moveId, 'uspecial');
  // Mitad del retroceso, y luego el decaimiento de un frame (0.17 px/f).
  const half = Math.hypot(kbx * 0.5, Math.min(0, kby) * 0.5);
  const now = Math.hypot(sim.p2.kbx, sim.p2.kby);
  assert.ok(Math.abs(now - (half - 0.17)) < 1e-6, `retroceso ${now}, esperado ${half - 0.17}`);
});

test('TUMBLE: la esquiva corta el retroceso a la mitad; el doble salto, la horizontal y el 70% de la subida; un aéreo, nada', () => {
  const launched = (kby) => {
    const sim = makeSim();
    place(sim.p2, { x: 640, y: 300, surfaceId: null });
    sim.p2.setState(STATES.TUMBLE);
    sim.p2.tumble = true;
    sim.p2.kbx = 8;
    sim.p2.kby = kby;
    return sim;
  };
  const after = (input, kby) => {
    const sim = launched(kby);
    sim.step({ p2: input });
    return sim.p2;
  };
  // Decaimiento de un frame: el vector pierde 0.17 px/f de módulo.
  const decayed = (x, y) => {
    const m = Math.hypot(x, y);
    const k = (m - 0.17) / m;
    return [x * k, y * k];
  };
  const near = (got, want, label) => assert.ok(
    Math.abs(got[0] - want[0]) < 1e-9 && Math.abs(got[1] - want[1]) < 1e-9,
    `${label}: ${got} (esperado ${want})`,
  );
  // Esquiva: mitad, y la parte hacia abajo fuera.
  let f = after({ shield: true }, 4);
  near([f.kbx, f.kby], decayed(4, 0), 'esquiva, lanzado hacia abajo');
  // Doble salto: la horizontal a la mitad; de la vertical hacia arriba queda
  // el 30% (-6 -> -1.8) y la de hacia abajo se conserva entera.
  f = after({ jump: true }, -6);
  near([f.kbx, f.kby], decayed(4, -1.8), 'salto, lanzado hacia arriba');
  // El salto propio (-11, más la gravedad de ese frame) se suma a esa inercia.
  assert.ok(Math.abs(f.vy - -10.42) < 1e-9, `vy ${f.vy}`);
  f = after({ jump: true }, 4);
  near([f.kbx, f.kby], decayed(4, 4), 'salto, lanzado hacia abajo');
  // Un aéreo no toca el retroceso.
  f = after({ attack: true }, 4);
  near([f.kbx, f.kby], decayed(8, 4), 'aéreo');
});

test('TUMBLE: saltar mientras un golpe te sube acorta la vida (U-Smash: 95-105% en vez de 114-118%)', () => {
  // Rival de referencia (peso 100, mejor DI). Sin saltar hasta que el golpe
  // deja de subirle aguanta hasta el 114-118%; saltando en su primer frame
  // libre, el salto suma el 30% del impulso hacia arriba y muere antes, pero
  // no a cualquier %: nunca por debajo del 95.
  const jumping = koThreshold({ move: 'usmash', x1: 640, x2: 690, upJump: true }, 80, 112);
  assert.ok(jumping >= 95 && jumping <= 105, `saltando muere desde el ${jumping}%`);
  const patient = koThreshold({ move: 'usmash', x1: 640, x2: 690 }, 108, 124);
  assert.ok(patient >= jumping + 10, `sin saltar aguanta hasta el ${patient}%`);
});

test('ESQUINA: medio píxel fuera de la losa no se posa ni vibra; resbala por la esquina', () => {
  for (const side of [-1, 1]) {
    const sim = makeSim();
    const f = sim.p1;
    place(f, { x: side < 0 ? 339.5 : 940.5, surfaceId: null });
    let prevY = f.y;
    let prevOut = 0;
    for (let i = 0; i < 30; i += 1) {
      sim.step({});
      if (f.state === STATES.LEDGE_HANG) break;
      assert.equal(f.grounded, false, `frame ${i}: nunca se posa`);
      assert.notEqual(f.state, STATES.LANDING, `frame ${i}`);
      assert.ok(f.y > prevY, `frame ${i}: cae siempre (y ${prevY} -> ${f.y})`);
      // Se aleja de la losa (o se queda pegado a la pared), nunca vuelve.
      const out = side < 0 ? 340 - f.x : f.x - 940;
      assert.ok(out >= prevOut, `frame ${i}: se separa de la losa`);
      prevY = f.y;
      prevOut = out;
    }
    // El rombo del pie resbala a 45°: en el primer frame (0.58 px de caída)
    // solo se separa 0.58, no los 26 de media anchura de golpe.
    const sim2 = makeSim();
    place(sim2.p1, { x: side < 0 ? 339.5 : 940.5, surfaceId: null });
    sim2.step({});
    assert.ok(Math.abs(sim2.p1.x - (side < 0 ? 339.42 : 940.58)) < 1e-9, `${sim2.p1.x}`);
  }
});

test('ESQUINA: salirse andando no genera aterrizajes; el centro sobre la losa sí pisa', () => {
  const sim = makeSim();
  place(sim.p1, { x: 360, facing: -1 });
  let lands = 0;
  for (let i = 0; i < 40; i += 1) {
    sim.step({ p1: { left: true } });
    lands += sim.drainEvents().filter((e) => e.type === 'land' && e.slot === 'p1').length;
  }
  assert.equal(lands, 0, 'ni un aterrizaje al caer por el borde');
  assert.equal(sim.p1.grounded, false);
  // Y al revés: con el centro medio píxel DENTRO, cayendo sobre la esquina, se pisa.
  const sim2 = makeSim();
  place(sim2.p1, { x: 340.5, y: 510, surfaceId: null });
  sim2.p1.vy = 2;
  run(sim2, 10);
  assert.equal(sim2.p1.grounded, true);
  assert.equal(sim2.p1.y, 520);
});

test('DESACOPLE: el Final Smash sigue la misma regla — bloqueo largo solo si mata', () => {
  const finalSmashOn = (percent) => {
    const sim = makeSim({ phase: PHASES.FIGHT });
    place(sim.p1, { x: 500, facing: 1 });
    place(sim.p2, { x: 700, facing: -1 });
    sim.p2.percent = percent;
    sim.p1.meter = 100;
    run(sim, 2);
    sim.step({ p1: { ultra: true } });
    let boom = null;
    for (let i = 0; i < 300 && !boom; i += 1) {
      sim.step({});
      boom = sim.drainEvents().find((e) => e.type === 'finalBoom');
    }
    let ko = null;
    const hitstun = sim.p2.hitstun;
    for (let i = 0; i < 300 && !ko; i += 1) {
      sim.step({});
      ko = sim.drainEvents().find((e) => e.type === 'ko' && e.slot === 'p2');
    }
    return { kb: boom.kb, hitstun, ko };
  };
  // Al 0%: los tres compases dejan a la víctima al 12% y la detonación (30%,
  // BKB 4, KBG 148) da KB 67.48: lanza lejos pero no mata sin remedio -> 22.
  const low = finalSmashOn(0);
  assert.ok(Math.abs(low.kb - 67.48) < 0.01, `KB ${low.kb}`);
  assert.equal(low.hitstun, 22);
  // Al 60%: K.O. seguro -> el hitstun de Smash, floor(KB*0.4), y muere.
  const high = finalSmashOn(60);
  // Al 60% (72% tras los compases): KB 251.6 -> 100 frames, sin tope.
  assert.ok(Math.abs(high.kb - 251.6) < 0.1, `KB ${high.kb}`);
  assert.equal(high.hitstun, 100);
  assert.ok(high.ko, 'al 60% el Final Smash mata');
});


// ============================================================================
// SUPER PESADO: UMBRALES DE K.O. CONTRA EL RIVAL DE REFERENCIA
// ============================================================================
//
// Los umbrales de K.O. se miden como en la spec: contra un rival de PESO 100
// que usa el mejor DI de los 9 posibles (neutro y las 8 direcciones) y que
// reacciona: en su primer frame libre hace doble salto hacia el escenario
// —salvo que el golpe aún le suba, que saltar ahí es morir por arriba— y al
// volver a caer, Up-B hacia el escenario. El umbral es el primer % en que
// muere con TODOS los DI.

function referenceDIs() {
  return [{}, { up: true }, { down: true }, { left: true }, { right: true },
    { up: true, left: true }, { up: true, right: true }, { down: true, left: true }, { down: true, right: true }];
}

function survivesWithDI(c, percent, di) {
  const victim = { ...samuelConfig, stats: { ...samuelConfig.stats, weight: 100 } };
  const sim = new Simulation({ geometry: GEOMETRY, p1: samuelConfig, p2: victim });
  sim.setOpponentPresent(true);
  sim.phase = PHASES.FIGHT;
  sim.phaseFrame = 100;
  const facing = c.x2 > c.x1 ? 1 : -1;
  place(sim.p1, { x: c.x1, facing });
  place(sim.p2, { x: c.x2, facing: -facing });
  sim.p2.percent = percent;
  if (c.awaken) sim.p1.awaken(600);
  if (c.move === 'final') {
    sim.p1.meter = 100;
    run(sim, 2);
    sim.step({ p1: { ultra: true } });
  } else {
    sim.p1.startMove(c.move);
  }
  const v = sim.p2;
  let hit = false;
  let jumped = false;
  let upb = false;
  for (let i = 0; i < 700; i += 1) {
    let p2 = {};
    if (hit && v.state === STATES.HITSTUN) {
      p2 = di;
    } else if (hit) {
      p2 = v.x > 640 ? { left: true } : { right: true };
      const free = v.state === STATES.TUMBLE || v.state === STATES.AIR;
      if (free && !jumped && (c.upJump || v.kby >= -2)) {
        p2.jump = true;
        jumped = true;
      } else if (free && jumped && !upb && v.jumpsLeft === 0 && v.vy + v.kby > 0) {
        p2.up = true;
        p2.special = true;
        upb = true;
      }
    }
    sim.step({ p2 });
    for (const e of sim.drainEvents()) {
      if ((e.type === 'hit' && e.victim === 'p2') || e.type === 'finalBoom') hit = true;
      if (e.type === 'ko' && e.slot === 'p2') return false;
    }
  }
  return true;
}

function diesWithEveryDI(c, percent) {
  return referenceDIs().every((di) => !survivesWithDI(c, percent, di));
}

function koThreshold(c, from, to) {
  for (let p = from; p <= to; p += 1) if (diesWithEveryDI(c, p)) return p;
  return null;
}

test('SUPER PESADO: el Final Smash confirma el K.O. desde el 48% en el centro del escenario', () => {
  const center = { move: 'final', x1: 440, x2: 640 };
  assert.equal(diesWithEveryDI(center, 48), true, 'al 48% muere con cualquier DI');
  assert.equal(diesWithEveryDI(center, 44), false, 'al 44% todavía se salva');
});

test('SUPER PESADO: D-Smash desde el borde mata al 112% y el U-Smash hacia arriba al 114-118%', () => {
  assert.equal(koThreshold({ move: 'dsmash', x1: 880, x2: 930 }, 104, 116), 112);
  const up = koThreshold({ move: 'usmash', x1: 640, x2: 690 }, 108, 124);
  assert.ok(up >= 114 && up <= 118, `U-Smash mata desde el ${up}%`);
});

test('ÁNGULO SAKURAI (361): a ras de suelo con poco KB, 38° en el aire o con KB alto', () => {
  assert.equal(combat.launchAngle(361, 40, true), 0);
  assert.equal(combat.launchAngle(361, 60, true), 0);
  assert.ok(Math.abs(combat.launchAngle(361, 74, true) - 19) < 1e-9, 'a medio camino entre KB 60 y 88');
  assert.equal(combat.launchAngle(361, 88, true), 38);
  assert.equal(combat.launchAngle(361, 200, true), 38);
  assert.equal(combat.launchAngle(361, 40, false), 38);
  assert.equal(combat.launchAngle(45, 40, true), 45, 'un ángulo normal no cambia');
  // En juego: F-Smash al 10% (KB < 60) empuja por el suelo; al 60%, levanta.
  const low = makeSim({ phase: PHASES.FIGHT });
  place(low.p1, { x: 600, facing: 1 });
  place(low.p2, { x: 650, facing: -1 });
  low.p2.percent = 10;
  low.p1.startMove('fsmash');
  while (!low.drainEvents().some((e) => e.type === 'hit')) low.step({});
  assert.equal(low.p2.kby, 0);
  assert.ok(low.p2.kbx > 0);
  assert.equal(low.p2.grounded, true, 'se desliza, no despega');
  const high = makeSim({ phase: PHASES.FIGHT });
  place(high.p1, { x: 600, facing: 1 });
  place(high.p2, { x: 650, facing: -1 });
  high.p2.percent = 60;
  high.p1.startMove('fsmash');
  while (!high.drainEvents().some((e) => e.type === 'hit')) high.step({});
  const angle = Math.atan2(-high.p2.kby, high.p2.kbx) * (180 / Math.PI);
  assert.ok(Math.abs(angle - 38) < 1e-6, `sale a ${angle}°`);
});

test('DESACOPLE: ningún golpe que no mata bloquea más de 22 frames (todos los golpes, 0-200%)', () => {
  // Cada golpe de suelo que lanza, contra un rival quieto en el centro y
  // junto al borde: o su hitstun es ≤ 22, o es letal y la víctima muere.
  const moves = [['jab_finisher', 50], ['ftilt', 50], ['utilt', 40], ['dashattack', 50],
    ['fsmash', 50], ['usmash', 50], ['dsmash', 50], ['dspecial', 40]];
  let lethal = 0;
  let checked = 0;
  for (const [move, gap] of moves) {
    for (const x1 of [600, 880]) {
      for (let p = 0; p <= 200; p += 25) {
        const sim = makeSim({ phase: PHASES.FIGHT });
        place(sim.p1, { x: x1, facing: 1 });
        place(sim.p2, { x: x1 + gap, facing: -1 });
        sim.p2.percent = p;
        sim.p1.startMove(move);
        let hit = null;
        let ko = null;
        for (let i = 0; i < 500 && !ko; i += 1) {
          sim.step({});
          for (const e of sim.drainEvents()) {
            if (e.type === 'hit' && !hit) {
              hit = { ...e, hitstun: sim.p2.hitstun };
              checked += 1;
            }
            if (e.type === 'ko' && e.slot === 'p2') ko = e;
          }
        }
        if (!hit) continue;
        if (hit.hitstun <= 22 && !hit.lethal) continue;
        lethal += 1;
        assert.equal(hit.lethal, true, `${move} al ${p}% (x=${x1}): ${hit.hitstun} frames sin ser letal`);
        assert.ok(ko, `${move} al ${p}% (x=${x1}): bloqueo largo sin K.O.`);
      }
    }
  }
  assert.ok(checked >= 80, `golpes comprobados: ${checked}`);
  assert.ok(lethal >= 10, `el barrido tiene que incluir golpes letales (hay ${lethal})`);
});

test('ROMBO: en todo el radio de 16 px el cuelgue es limpio — ancla exacta y sin tirones', () => {
  // Cayendo en vertical junto al borde con las manos a 0..15.5 px por
  // fuera del punto del borde: siempre se ancla, en la posición exacta, y
  // colgado no se mueve ni un píxel en 30 frames.
  for (const side of [-1, 1]) {
    for (const d of [0, 2, 4, 6, 8, 10, 12, 14, 15.5]) {
      const sim = makeSim();
      const f = sim.p1;
      const ledgeX = side < 0 ? 340 : 940;
      const handX = ledgeX + side * d;
      place(f, { x: handX + side * 26, y: 560, surfaceId: null });
      f.vy = 1;
      let hung = false;
      for (let i = 0; i < 40 && !hung; i += 1) {
        sim.step({});
        hung = f.state === STATES.LEDGE_HANG;
        assert.notEqual(f.state, STATES.LANDING, `d=${d}: nunca se posa en la esquina`);
      }
      assert.ok(hung, `lado ${side}, manos a ${d} px: se cuelga`);
      const at = [f.x, f.y];
      assert.deepEqual(at, [side < 0 ? 314 : 966, 616], `d=${d}: ancla exacta`);
      for (let i = 0; i < 30; i += 1) {
        sim.step({});
        assert.deepEqual([f.x, f.y, f.state], [...at, STATES.LEDGE_HANG], `d=${d}, frame ${i}: quieto`);
      }
    }
  }
});

// ============================================================================
// ANIMACIÓN SINCRONIZADA CON LAS CAJAS, Y SWEETSPOTS
// ============================================================================

test('FASE CANÓNICA: los frames activos de TODO movimiento caen en [0.3, 0.5)', async () => {
  const { movePhase, activeWindow } = await import('../public/src/engine/movePhase.js');
  const all = [...Object.entries(samuelConfig.moveTable), ...Object.entries(samuelConfig.awakened.moveTable)];
  for (const [id, m] of all) {
    const win = activeWindow(m);
    if (!win || !m.frames) continue;
    assert.equal(movePhase(m, 0), 0, `${id}: empieza en 0`);
    assert.ok(Math.abs(movePhase(m, win[0]) - 0.3) < 1e-9, `${id}: el primer activo es 0.3`);
    for (let f = win[0]; f <= win[1]; f += 1) {
      const t = movePhase(m, f);
      assert.ok(t >= 0.3 && t < 0.5, `${id}: frame activo ${f} en fase ${t}`);
    }
    if (win[1] + 1 < m.frames) assert.ok(Math.abs(movePhase(m, win[1] + 1) - 0.5) < 1e-9, `${id}: la recuperación empieza en 0.5`);
    assert.equal(movePhase(m, m.frames), 1, `${id}: acaba en 1`);
  }
});

test('SINCRONÍA: en cada frame activo, el miembro o el arma dibujados están DENTRO de su caja', async () => {
  // Se dibuja el frame que elegiría el juego (atlas + fase canónica) y se
  // cuentan los píxeles del sprite dentro de la hitbox y FUERA del cuerpo:
  // el brazo, la pierna o la herramienta extendidos. Antes de la fase
  // canónica, el F-Tilt, el codazo, el Bair, el Fair, el D-Smash y el eructo
  // pegaban con la caja activa y el golpe dibujado llegaba en la recuperación.
  const { createCanvas } = await import('./fakeCanvas.mjs');
  const { buildFighterAtlas, animationsForMoveTable } = await import('../public/src/engine/spriteAtlasBuilder.js');
  const { SpriteAnimator } = await import('../public/src/engine/spriteAnimator.js');
  const { rosterVictimPoses } = await import('../public/src/characters/roster.js');
  const { movePhase } = await import('../public/src/engine/movePhase.js');
  const table = samuelConfig.moveTable;
  const animator = new SpriteAnimator(buildFighterAtlas({
    art: samuelConfig.art, animations: animationsForMoveTable(table, rosterVictimPoses()),
  }));
  // Cajas que cubre el EFECTO del evento, no el sprite: la nube de gas del
  // Dair (gasBurst), la onda del eructo (burpSmall/Medium/Nuclear), el polvo
  // detrás de la silla (chairDust), la nube del Pedo Atómico (waftBlast) y el
  // lado de atrás del barrido de levantarse (una sola pierna barre hacia
  // delante).
  const effectBoxes = new Set(['dair#0', 'dair#1', 'nspecial_l1#0', 'nspecial_l2#0', 'nspecial_l3#0', 'dsmash#1', 'getup_attack#1',
    'dspecial#0', 'dspecial#1']);
  const FX = 200;
  const FY = 200;
  let checked = 0;
  for (const [id, m] of Object.entries(table)) {
    (m.hitboxes || []).forEach((hb, k) => {
      if (hb.grab || effectBoxes.has(`${id}#${k}`)) return;
      for (let f = hb.from; f <= hb.to; f += 1) {
        const c = createCanvas(400, 300);
        animator.playAtProgress(m.pose, movePhase(m, f));
        animator.draw(c.getContext('2d'), FX, FY, 1);
        let n = 0;
        const x0 = Math.round(FX + hb.x - hb.w / 2);
        const y0 = Math.round(FY + hb.y - hb.h / 2);
        for (let y = Math.max(0, y0); y < Math.min(300, y0 + hb.h); y += 1) {
          for (let x = Math.max(0, x0); x < Math.min(400, x0 + hb.w); x += 1) {
            if (x >= FX - 26 && x < FX + 26 && y >= FY - 108 && y < FY) continue; // el cuerpo
            if (c.data[(y * 400 + x) * 4 + 3] > 0.5) n += 1;
          }
        }
        assert.ok(n >= 150, `${id} (caja ${k}), frame ${f}: solo ${n} px dibujados dentro de la caja`);
        checked += 1;
      }
    });
  }
  assert.ok(checked >= 60, `frames activos comprobados: ${checked}`);
});

test('SWEETSPOT: la punta del cigüeñal da el golpe limpio; pegado al cuerpo, la parte floja', () => {
  const hitAt = (gap) => {
    const sim = makeSim();
    place(sim.p1, { x: 600, facing: 1 });
    place(sim.p2, { x: 600 + gap, facing: -1 });
    sim.p1.startMove('fsmash');
    for (let i = 0; i < 60; i += 1) {
      sim.step({});
      const hit = sim.drainEvents().find((e) => e.type === 'hit');
      if (hit) return hit;
    }
    return null;
  };
  assert.equal(hitAt(80).damage, 19, 'con la punta: 19%');
  assert.equal(hitAt(50).damage, 19, 'a la distancia de las tablas de K.O., también la punta');
  assert.equal(hitAt(28).damage, 15, 'pegado al cuerpo: el mango, 15%');
});

test('SWEETSPOT: la base del Dair es el meteoro; el borde de la nube empuja de lado', () => {
  const dairOn = (dx) => {
    const sim = makeSim();
    place(sim.p1, { x: 640, y: 300, surfaceId: null });
    place(sim.p2, { x: 640 + dx, y: 380, surfaceId: null });
    sim.p1.startMove('dair');
    for (let i = 0; i < 30; i += 1) {
      sim.p2.vy = 0;
      sim.p2.y = sim.p1.y + 40;
      sim.step({});
      const hit = sim.drainEvents().find((e) => e.type === 'hit');
      if (hit) {
        drainHitlag(sim);
        return { hit, kbx: sim.p2.kbx, kby: sim.p2.kby };
      }
    }
    return null;
  };
  const base = dairOn(0);
  assert.equal(base.hit.damage, 12);
  assert.ok(base.kby > 0 && Math.abs(base.kbx) < 1e-9, 'la base hunde recto');
  const edge = dairOn(44);
  assert.equal(edge.hit.damage, 8);
  assert.ok(edge.kbx > 0 && edge.kby < 0, 'el borde lanza hacia fuera y arriba');
});

test('FASE CANÓNICA: la VISTA del luchador la usa (el remoto dibuja con ella)', () => {
  const sim = makeSim();
  place(sim.p1, { x: 600, facing: 1 });
  sim.p1.startMove('ftilt'); // activos 7-10 de 28
  const seen = [];
  for (let i = 0; i < 12; i += 1) {
    sim.step({});
    seen.push([sim.p1.moveFrame, sim.p1.view().progress]);
  }
  const at = (f) => seen.find(([mf]) => mf === f)[1];
  assert.ok(Math.abs(at(7) - 0.3) < 1e-9, `primer activo: ${at(7)}`);
  assert.ok(Math.abs(at(10) - 0.45) < 1e-9, `último activo (0.3 + 0.2·3/4): ${at(10)}`);
  assert.ok(Math.abs(at(11) - 0.5) < 1e-9, `primer frame de recuperación: ${at(11)}`);
});

test('POSES CLAVE: la llave gira por el camino corto (U-Tilt: de abajo-atrás a arriba-atrás, por detrás)', async () => {
  const { computePoseForKind } = await import('../public/src/engine/poseLibrary.js');
  for (const progress of [0.18, 0.22, 0.26]) {
    const pose = computePoseForKind('wrencharc', { h: 120, kit: 'mecanico', progress });
    assert.ok(Math.cos(pose.toolAngle) < -0.6, `fase ${progress}: la llave apunta hacia atrás (${pose.toolAngle.toFixed(2)} rad)`);
  }
});

test('VFX: el golpe es una estrella de choque RELLENA con rayos que salen disparados', async () => {
  const { createCanvas } = await import('./fakeCanvas.mjs');
  const P = await import('../public/src/engine/particles.js');
  const snapshot = (frames) => {
    const c = createCanvas(200, 200);
    const ctx = c.getContext('2d');
    for (let i = 0; i < frames; i += 1) P.updateParticles(1 / 60);
    P.drawParticles(ctx);
    return c;
  };
  const whiteNear = (c, r0, r1) => {
    let n = 0;
    for (let y = 0; y < 200; y += 1) {
      for (let x = 0; x < 200; x += 1) {
        const d = Math.hypot(x - 100, y - 100);
        const i = (y * 200 + x) * 4;
        if (d >= r0 && d < r1 && c.data[i + 3] > 0.5 && c.data[i] > 240 && c.data[i + 1] > 240 && c.data[i + 2] > 240) n += 1;
      }
    }
    return n;
  };
  P.clearParticles();
  P.spawnHitEffect(100, 100, 'heavy');
  const first = snapshot(1);
  // Estrella RELLENA: píxeles opacos en el anillo de 4 a 9 px FUERA de los
  // ejes y las diagonales. Una estrella de líneas (la de antes) solo pinta
  // sobre ejes y diagonales: ~13 px ahí; la rellena, ~40.
  let offAxis = 0;
  for (let y = 0; y < 200; y += 1) {
    for (let x = 0; x < 200; x += 1) {
      const dx = x - 100;
      const dy = y - 100;
      const d = Math.hypot(dx, dy);
      const axis = Math.abs(dx) <= 2 || Math.abs(dy) <= 2 || Math.abs(Math.abs(dx) - Math.abs(dy)) <= 2;
      if (d >= 4 && d < 9 && !axis && first.data[(y * 200 + x) * 4 + 3] > 0.5) offAxis += 1;
    }
  }
  assert.ok(offAxis > 28, `relleno fuera de los ejes: ${offAxis}`);
  // Al segundo frame los rayos ya han salido lejos del punto de impacto.
  P.clearParticles();
  P.spawnHitEffect(100, 100, 'heavy');
  const second = snapshot(3);
  assert.ok(whiteNear(second, 36, 60) > 20, `rayos a 36-60 px: ${whiteNear(second, 36, 60)}`);
  P.clearParticles();
});

test('VFX: el humo se desvanece por ESCALONES y el gas del Up-B sale hacia abajo', async () => {
  const { createCanvas } = await import('./fakeCanvas.mjs');
  const V = await import('../public/src/engine/vfxManager.js');
  // Humo: sobre transparente, el alfa de cada píxel es un múltiplo de 1/4
  // (o suma de escalones de capas), nunca un degradado continuo.
  V.clearVfx();
  V.spawnCigarPuff(60, 100, 1);
  for (let i = 0; i < 20; i += 1) V.updateVfx(1 / 60);
  const c = createCanvas(200, 200);
  V.drawAirLayer(c.getContext('2d'));
  const alphas = new Set();
  for (let i = 3; i < c.data.length; i += 4) if (c.data[i] > 0) alphas.add(Math.round(c.data[i] * 1000) / 1000);
  assert.ok(alphas.size > 0, 'hay humo');
  assert.ok(alphas.size <= 12, `alfas distintas: ${[...alphas].join(', ')}`);
  // Gas del Up-B: tras 10 frames, el centro de masa del verde está POR DEBAJO
  // del punto de la detonación.
  V.clearVfx();
  V.spawnToxicJetDown(100, 60);
  for (let i = 0; i < 10; i += 1) V.updateVfx(1 / 60);
  const g = createCanvas(200, 200);
  V.drawAirLayer(g.getContext('2d'));
  let sy = 0;
  let n = 0;
  for (let y = 0; y < 200; y += 1) {
    for (let x = 0; x < 200; x += 1) {
      const i = (y * 200 + x) * 4;
      if (g.data[i + 3] > 0 && g.data[i + 1] > g.data[i] && g.data[i + 1] > g.data[i + 2]) {
        sy += y;
        n += 1;
      }
    }
  }
  assert.ok(n > 200, `hay gas: ${n} px`);
  assert.ok(sy / n > 75, `el gas baja: centro a y=${(sy / n).toFixed(1)} (detonación en 60)`);
  V.clearVfx();
});

// ============================================================================
// ANATOMÍA: conexión, efectores anclados a su caja, brazo del jab, botas
// ============================================================================

// Pose tal y como se VE en el frame `f` de un movimiento: la fase canónica
// muestreada como el atlas (10 frames por golpe, cada uno en el centro de su
// tramo), no la pose continua.
async function displayedPose(move, f) {
  const { computePoseForKind } = await import('../public/src/engine/poseLibrary.js');
  const { KEYED_FRAME_COUNT } = await import('../public/src/engine/keyedPoses.js');
  const { movePhase } = await import('../public/src/engine/movePhase.js');
  const n = KEYED_FRAME_COUNT[move.pose] ?? 10;
  const i = Math.min(n - 1, Math.floor(movePhase(move, f) * n + 1e-6));
  return computePoseForKind(move.pose, { h: 120, kit: 'mecanico', progress: (i + 0.5) / n });
}

test('ANATOMÍA: en TODOS los frames de TODAS las animaciones el cuerpo es una sola pieza', async () => {
  // Se dibuja cada frame que hornea el atlas SOLO con el cuerpo (sin llave,
  // bidón, gas, estelas, cadenas...) y la silueta tiene que ser UNA pieza
  // conectada. Una cabeza que no baja con el torso (el barrido agachaba el
  // torso 10 px y dejaba el cuello vacío), un brazo o una pierna despegados:
  // cualquiera parte la silueta en dos.
  const { createCanvas } = await import('./fakeCanvas.mjs');
  const { animationPoses, animationsForMoveTable } = await import('../public/src/engine/spriteAtlasBuilder.js');
  const { drawPixelFighter } = await import('../public/src/engine/pixelFighterArt.js');
  const { rosterVictimPoses } = await import('../public/src/characters/roster.js');
  const bodyOnly = {
    tool: 0, gas: 0, shock: 0, smokePuff: 0, trails: null, barrel: 0, mic: 0, notes: 0, earBlood: 0,
    sparks: 0, cigHand: 0, arc: 0, smear: 0, superGlow: 0, armorGlow: 0, smoke: 0, rapper: 0,
  };
  const W = 240;
  const H = 220;
  const pieces = (pose) => {
    const c = createCanvas(W, H);
    const ctx = c.getContext('2d');
    ctx.translate(80, 60);
    drawPixelFighter(ctx, { w: 80, h: 120, art: 'mecanico', pose: { ...pose, ...bodyOnly } });
    const seen = new Uint8Array(W * H);
    let count = 0;
    for (let i = 0; i < W * H; i += 1) {
      if (seen[i] || !(c.data[i * 4 + 3] > 0.5)) continue;
      count += 1;
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const k = stack.pop();
        const x = k % W;
        const y = (k - x) / W;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            const j = yy * W + xx;
            if (!seen[j] && c.data[j * 4 + 3] > 0.5) {
              seen[j] = 1;
              stack.push(j);
            }
          }
        }
      }
    }
    return count;
  };
  const names = animationsForMoveTable(samuelConfig.moveTable, rosterVictimPoses());
  let frames = 0;
  for (const name of names) {
    animationPoses(name, 'mecanico').forEach((pose, i) => {
      assert.equal(pieces(pose), 1, `${name}, frame ${i}: el cuerpo está partido`);
      frames += 1;
    });
  }
  assert.ok(frames >= 250, `frames revisados: ${frames}`);
});

test('ANCLAJE: en cada frame activo, el puño, la bota o la punta de la llave que golpea están DENTRO de su caja', async () => {
  const { KEYED_POSES, effectorPoint } = await import('../public/src/engine/keyedPoses.js');
  let checked = 0;
  for (const [id, m] of Object.entries(samuelConfig.moveTable)) {
    const def = KEYED_POSES[m.pose];
    if (!def?.effector || !m.hitboxes) continue;
    const first = Math.min(...m.hitboxes.map((hb) => hb.from));
    const last = Math.max(...m.hitboxes.map((hb) => hb.to));
    for (let f = first; f <= last; f += 1) {
      const boxes = m.hitboxes.filter((hb) => f >= hb.from && f <= hb.to);
      if (!boxes.length) continue; // hueco entre golpes de un multi-hit
      const [x, y] = effectorPoint(await displayedPose(m, f), def.effector);
      const inside = boxes.some((hb) => {
        const x0 = 40 + hb.x - hb.w / 2;
        const y0 = 120 + hb.y - hb.h / 2;
        return x >= x0 - 1 && x <= x0 + hb.w + 1 && y >= y0 - 1 && y <= y0 + hb.h + 1;
      });
      assert.ok(inside, `${id}, frame ${f}: el ${def.effector} está en (${x.toFixed(0)}, ${y.toFixed(0)}), fuera de su caja`);
      checked += 1;
    }
  }
  assert.ok(checked >= 60, `frames activos comprobados: ${checked}`);
});

test('JAB: el brazo llega COMPLETAMENTE extendido y horizontal, a la altura del hombro', async () => {
  const jab = samuelConfig.moveTable.jab;
  for (const f of [4, 5]) {
    const pose = await displayedPose(jab, f);
    // Hombro delantero en el kit: centro del torso + 15 + inclinación, y la
    // línea de hombros a 37 px de la coronilla del cuerpo.
    const shoulder = [40 + pose.torsoOffX + 15 + pose.lean, 37 + pose.torsoOffY];
    const fist = [61 + pose.armFrontOffX, 62 + pose.armFrontOffY];
    // Brazo y antebrazo miden 12.5 + 12.5: a 25 px o más el codo va recto.
    assert.ok(Math.hypot(fist[0] - shoulder[0], fist[1] - shoulder[1]) >= 25, `frame ${f}: brazo estirado`);
    assert.ok(Math.abs(fist[1] - shoulder[1]) <= 6, `frame ${f}: puño a ${fist[1] - shoulder[1]} px de la altura del hombro`);
  }
});

test('BOTAS: en la patada la suela mira al rival; un pie plantado va plano', async () => {
  const { createCanvas } = await import('./fakeCanvas.mjs');
  const { drawPixelFighter } = await import('../public/src/engine/pixelFighterArt.js');
  const { computePoseForKind } = await import('../public/src/engine/poseLibrary.js');
  // La SUELA es de goma (#262427), un material que solo lleva ella: su caja
  // envolvente dice hacia dónde mira.
  const soleBox = (pose, x0, x1) => {
    const c = createCanvas(160, 160);
    const ctx = c.getContext('2d');
    ctx.translate(40, 20);
    drawPixelFighter(ctx, { w: 80, h: 120, art: 'mecanico', pose: { ...pose, trails: null } });
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let y = 0; y < 160; y += 1) {
      for (let x = x0 + 40; x < x1 + 40; x += 1) {
        const i = (y * 160 + x) * 4;
        if (c.data[i + 3] > 0.5 && Math.abs(c.data[i] - 0x26) < 3 && Math.abs(c.data[i + 1] - 0x24) < 3 && Math.abs(c.data[i + 2] - 0x27) < 3) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }
    return { w: maxX - minX + 1, h: maxY - minY + 1, x: maxX - 40 };
  };
  // F-Tilt en su frame activo: bota delantera a la altura de la cadera.
  const kick = soleBox(await displayedPose(samuelConfig.moveTable.ftilt, 8), 80, 120);
  assert.ok(kick.h > kick.w * 2, `la suela de la patada es vertical (${kick.w}x${kick.h})`);
  assert.ok(kick.x > 95, 'y está en el extremo de la pierna, mirando al rival');
  // De pie: la suela de la bota delantera es horizontal, en el suelo.
  const idle = soleBox(computePoseForKind('idle', { h: 120, kit: 'mecanico', t: 0 }), 44, 80);
  assert.ok(idle.w > idle.h * 4, `de pie la suela es horizontal (${idle.w}x${idle.h})`);
  // El pie de apoyo del F-Tilt (espinilla en diagonal) sigue plano.
  const support = soleBox(await displayedPose(samuelConfig.moveTable.ftilt, 8), 10, 44);
  assert.ok(support.w > support.h * 4, `el pie de apoyo va plano (${support.w}x${support.h})`);
});


// ============================================================================
// MODO DESPERTAR (prototipo, tecla Ñ)
// ============================================================================

// Pulsa Ñ con p1 y devuelve los eventos del Despertar con el tick (contando
// el de la pulsación como 1) en que salieron.
function pressAwaken(sim, extraTicks = 0) {
  const events = [];
  let tick = 0;
  const step = (p1 = {}) => {
    tick += 1;
    sim.step({ p1 });
    for (const e of sim.drainEvents()) if (e.type.startsWith('awaken')) events.push([e.type, tick]);
  };
  step({ awaken: true });
  for (let i = 0; i < extraTicks; i += 1) step();
  return { events, step };
}

test('DESPERTAR: Ñ congela el combate 120 frames, corta en el 60 y despierta 600 frames', () => {
  const sim = makeSim({ phase: PHASES.FIGHT });
  place(sim.p1, { x: 500, facing: 1 });
  place(sim.p2, { x: 800, facing: -1 });
  sim.p2.vx = 3; // algo que se movería si el mundo avanzara
  sim.p2.setState(STATES.WALK);
  const snapshotOf = () => JSON.stringify(sim.fighters.map((f) => [f.x, f.y, f.state, f.stateFrame]));
  const before = snapshotOf();
  const { events, step } = pressAwaken(sim, 119);
  // Durante los 120 frames de la cinemática el mundo no se ha movido.
  assert.equal(snapshotOf(), before);
  assert.deepEqual(events, [['awakenStart', 1], ['awakenCut', 60], ['awakenReady', 120]]);
  assert.equal(sim.cutin, null);
  assert.equal(sim.p1.view().awakened, true);
  assert.equal(sim.p1.view().awakenLeft, 600);
  assert.equal(sim.p2.view().awakened, false);
  // 600 frames de mundo exactos.
  for (let i = 0; i < 599; i += 1) step();
  assert.equal(sim.p1.awakened, true, 'sigue despertado en el frame 599');
  step();
  assert.equal(sim.p1.awakened, false, 'vuelve a la normalidad en el 600');
  assert.deepEqual(events.at(-1), ['awakenEnd', 720]);
});

test('DESPERTAR: la cinemática es estado de la simulación (snapshot, servidor, pausa)', () => {
  const sim = makeSim({ phase: PHASES.FIGHT });
  pressAwaken(sim, 29);
  const snap = sim.serialize();
  assert.deepEqual(snap.cutin, { slot: 'p1', frame: 30, total: 120 });
  // El servidor acepta el snapshot real y descarta un corte malformado.
  const good = JSON.parse(JSON.stringify({ ...snap, events: [] }));
  assert.equal(server.isSaneSnapshot(good), true);
  for (const cutin of [{ slot: 'p3', frame: 1, total: 120 }, { slot: 'p1', frame: 130, total: 120 }, { slot: 'p1', frame: 1.5, total: 120 }]) {
    assert.equal(server.isSaneSnapshot({ ...good, cutin }), false, JSON.stringify(cutin));
  }
  const fighters = good.fighters.map((f, i) => (i === 0 ? { ...f, awakened: 'yes' } : f));
  assert.equal(server.isSaneSnapshot({ ...good, fighters }), false);
  // La pausa congela también la cinemática.
  sim.step({ p1: { pause: true } });
  sim.step({});
  sim.step({});
  assert.equal(sim.cutin.frame, 30);
});

test('DESPERTAR: no se re-dispara despertado, ni fuera de combate, y morir lo quita', () => {
  const sim = makeSim({ phase: PHASES.FIGHT });
  const { step } = pressAwaken(sim, 130);
  assert.equal(sim.p1.awakened, true);
  step({ awaken: true });
  assert.equal(sim.cutin, null, 'despertado, la Ñ no hace nada');
  sim.p1.die();
  assert.equal(sim.p1.awakened, false, 'morir quita el Despertar');
  const countdown = makeSim();
  countdown.phase = PHASES.COUNTDOWN;
  countdown.step({ p1: { awaken: true } });
  assert.equal(countdown.cutin, null, 'en la cuenta atrás no');
});

test('DESPERTAR: la tecla Ñ es un input que viaja por red', async () => {
  const { sanitizeInput, INPUT_KEYS } = await import('../public/src/engine/inputManager.js');
  assert.ok(INPUT_KEYS.includes('awaken'));
  assert.equal(sanitizeInput({ awaken: true }).awaken, true);
  assert.equal(sanitizeInput({ awaken: 'x' }).awaken, false);
});

// Cinemática del Despertar rasterizada sobre un "juego" blanco de 1280x720.
async function cutinBench() {
  const { createCanvas } = await import('./fakeCanvas.mjs');
  const cutin = await import('../public/src/engine/awakenCutin.js');
  const shot = (frame, exit = null) => {
    const c = createCanvas(1280, 720);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 1280, 720);
    cutin.drawAwakenCutin(ctx, { frame, exit, viewport: { w: 1280, h: 720 } });
    return c;
  };
  const px = (c, x, y) => [0, 1, 2].map((k) => Math.round(c.data[(y * c.width + x) * 4 + k]));
  const near = (hex, tol = 3) => {
    const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return (p) => p.every((v, k) => Math.abs(v - rgb[k]) < tol);
  };
  const count = (c, t, x0 = 0, y0 = 0, x1 = c.width, y1 = c.height) => {
    let n = 0;
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) if (t(px(c, x, y))) n += 1;
    return n;
  };
  return { ...cutin, shot, px, near, count, createCanvas };
}

test('CUT-IN: zoom lento, micro-congelación en 58-60, golpe a 1.34 en el 61 que se asienta en 1.25; la estrella parpadea', async () => {
  const { cutinZoom, eyeGlintOn } = await import('../public/src/engine/awakenCutin.js');
  assert.equal(cutinZoom(0), 1);
  assert.ok(Math.abs(cutinZoom(57) - (1 + (0.08 * 57) / 60)) < 1e-12, 'fase 1: 1.0 -> 1.08');
  for (const f of [58, 59, 60]) assert.equal(cutinZoom(f), cutinZoom(57), `congelado en el ${f}`);
  assert.ok(Math.abs(cutinZoom(61) - 1.34) < 1e-12, 'el GOLPE de zoom');
  assert.ok(Math.abs(cutinZoom(64) - (1.25 + (0.08 * 3) / 59)) < 1e-12, 'asentado en 1.25 a los 3 frames');
  assert.ok(cutinZoom(119) > 1.32 && cutinZoom(119) < 1.34, 'y sigue acercándose despacio');
  assert.equal(eyeGlintOn(30), false, 'la estrella solo existe despertado');
  assert.equal(eyeGlintOn(60), false, 'ni durante el fogonazo del corte');
  assert.deepEqual([61, 64, 68, 69, 72, 73].map(eyeGlintOn), [true, true, true, false, false, true]);
});

test('CUT-IN: entrada con TAJO diagonal que destapa la franja de izquierda a derecha en 4 frames', async () => {
  const { shot, px } = await cutinBench();
  const shots = [0, 1, 2, 3].map((f) => shot(f));
  // A la izquierda la franja ya está desde el frame 0; a la derecha llega en
  // el 3. Mientras no llega, se ve el juego con el oscurecido creciendo.
  assert.deepEqual(shots.map((c) => px(c, 100, 360)[0]), [0, 0, 0, 0]);
  assert.deepEqual(shots.map((c) => px(c, 1180, 360)[0]), [217, 179, 140, 0]);
  assert.deepEqual(shots.map((c) => px(c, 100, 40)[0]), [217, 179, 140, 102]);
  // El propio tajo: una raya blanca sobre el centro en el frame 1.
  let white = 0;
  for (let x = 600; x < 700; x += 1) if (px(shots[1], x, 360).every((v) => v === 255)) white += 1;
  assert.ok(white >= 2, `raya del tajo: ${white} px`);
  assert.equal(px(shots[3], 640, 360).every((v) => v === 255), false, 'y en el 3 ya ha pasado');
  // Y es DIAGONAL: arriba ha llegado más lejos que abajo (inclinado como un
  // corte de espada, no una cortina vertical).
  const frontier = (y) => {
    for (let x = 300; x < 1000; x += 1) if (px(shots[1], x, y).every((v) => v === 179)) return x;
    return -1;
  };
  assert.ok(frontier(250) - frontier(470) > 80, `frontera arriba ${frontier(250)}, abajo ${frontier(470)}`);
});

test('CUT-IN: fogonazos blancos de 2 frames en la entrada (4-5) y en el corte (60-61)', async () => {
  const { shot, px } = await cutinBench();
  assert.deepEqual([3, 4, 5, 6].map((f) => px(shot(f), 100, 360)[0]), [0, 230, 115, 0]);
  assert.deepEqual([59, 60, 61, 62].map((f) => px(shot(f), 100, 360)[0]), [0, 230, 115, 0]);
});

test('CUT-IN: micro-congelación con ABERRACIÓN CROMÁTICA en 58-59 (rojo a la izquierda, cian a la derecha)', async () => {
  const { shot, px } = await cutinBench();
  const split = (f) => {
    const c = shot(f);
    const red = [];
    const cyan = [];
    for (let y = 238; y < 482; y += 1) {
      for (let x = 300; x < 980; x += 1) {
        const p = px(c, x, y);
        if (Math.abs(p[0] - 217) < 4 && Math.abs(p[1] - 27) < 4 && Math.abs(p[2] - 54) < 4) red.push(x);
        if (Math.abs(p[0] - 27) < 4 && Math.abs(p[1] - 197) < 4 && Math.abs(p[2] - 217) < 4) cyan.push(x);
      }
    }
    const mean = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
    return { red: red.length, cyan: cyan.length, redX: mean(red), cyanX: mean(cyan) };
  };
  for (const f of [58, 59]) {
    const s = split(f);
    assert.ok(s.red > 500 && s.cyan > 500, `frame ${f}: ${JSON.stringify(s)}`);
    assert.ok(s.redX < s.cyanX - 40, `el rojo se va a la izquierda y el cian a la derecha: ${JSON.stringify(s)}`);
  }
  assert.ok(split(59).red > split(58).red, 'la separación crece en el segundo frame');
  for (const f of [57, 60, 62]) {
    const s = split(f);
    assert.equal(s.red + s.cyan, 0, `frame ${f}: ${JSON.stringify(s)}`);
  }
});

test('CUT-IN: TEMBLOR de 4-6 px durante 8 frames desde el 61, y la franja tiembla de verdad', async () => {
  const { cutinShake, shot, px, near } = await cutinBench();
  assert.deepEqual(cutinShake(60), [0, 0]);
  assert.deepEqual(cutinShake(69), [0, 0]);
  for (let f = 61; f <= 68; f += 1) {
    const [dx, dy] = cutinShake(f);
    assert.ok(Math.hypot(dx, dy) >= 4, `frame ${f}: ${dx},${dy}`);
    assert.ok(Math.abs(dx) <= 6 && Math.abs(dy) <= 6, `frame ${f}: ${dx},${dy}`);
  }
  // Vertical: el perfil de filas del reborde dorado se desplaza exactamente dy.
  const goldRows = (c) => {
    const rows = new Array(720).fill(0);
    for (let y = 150; y < 580; y += 1) for (let x = 0; x < 1280; x += 2) if (near('#ffcf3a')(px(c, x, y))) rows[y] += 1;
    return rows;
  };
  const still = goldRows(shot(57));
  const bestShift = (rows) => {
    let best = null;
    for (let s = -8; s <= 8; s += 1) {
      let err = 0;
      for (let y = 160; y < 570; y += 1) err += Math.abs(rows[y] - still[y - s]);
      if (!best || err < best.err) best = { s, err };
    }
    return best.s;
  };
  const shifts = [62, 64, 66].map((f) => [bestShift(goldRows(shot(f))), cutinShake(f)[1]]);
  for (const [got, want] of shifts) assert.equal(got, want, JSON.stringify(shifts));
  assert.ok(shifts.some(([, dy]) => dy !== 0), 'algún frame se mueve en vertical');
  // Horizontal: la franja se corre dx y por el borde que deja asoma el juego.
  for (const f of [62, 63]) {
    const [dx] = cutinShake(f);
    const c = shot(f);
    const y = 360 + cutinShake(f)[1];
    const edge = dx > 0 ? dx : 1280 + dx;
    const [uncovered, covered] = dx > 0 ? [edge - 1, edge] : [edge, edge - 1];
    assert.equal(px(c, uncovered, y)[0], 102, `frame ${f} dx ${dx}: asoma el juego`);
    assert.notEqual(px(c, covered, y)[0], 102, `frame ${f} dx ${dx}: y justo al lado ya hay franja`);
  }
});

test('CUT-IN: la estrella del ojo ESTALLA en el 61: líneas de choque y partículas rojas hasta los lados de la franja', async () => {
  const { shot, count, near } = await cutinBench();
  const burst = (c, x0, x1) => count(c, (p) => near('#ff2a3a')(p) || near('#ff5566')(p), x0, 238, x1, 482);
  const s64 = shot(64);
  assert.ok(burst(s64, 0, 300) > 30, `hacia la izquierda: ${burst(s64, 0, 300)}`);
  assert.ok(burst(s64, 980, 1280) > 30, `hacia la derecha: ${burst(s64, 980, 1280)}`);
  // Sale YA en el 61, bajo el fogonazo de 0.45: el rojo #ff2a3a aclarado a (255, 138, 147).
  const s61 = shot(61);
  assert.ok(count(s61, near('#ff8a93'), 0, 238, 1280, 482) > 500, 'estalla en el mismo frame del golpe');
  assert.equal(burst(shot(57), 0, 1280), 0, 'antes del corte no hay estallido');
  assert.equal(burst(shot(76), 0, 1280), 0, 'y a los 15 frames se ha disipado');
});

test('CUT-IN: franja negra de bordes DESGARRADOS (picos de tres tamaños) con trazo rojo y reborde dorado', async () => {
  const { tornEdge, shot, px, near } = await cutinBench();
  for (const seed of [11, 29]) {
    const heights = tornEdge(1280, seed).filter((_, i) => i % 2 === 1).map(([, hgt]) => hgt);
    const big = heights.filter((hgt) => hgt >= 24).length;
    const medium = heights.filter((hgt) => hgt >= 12 && hgt <= 20).length;
    const small = heights.filter((hgt) => hgt <= 9).length;
    assert.ok(big >= 5 && medium >= 5 && small >= 5, `semilla ${seed}: ${big}/${medium}/${small}`);
  }
  const c = shot(30);
  // Fuera de la franja, el juego al 40%; dentro, negro.
  assert.deepEqual(px(c, 100, 40), [102, 102, 102]);
  assert.deepEqual(px(c, 60, 360), [0, 0, 0]);
  // El borde de arriba no es una recta ni una sierra regular: la primera fila
  // roja por columna sube y baja más de 30 px y con muchas alturas distintas.
  const tops = [];
  for (let x = 0; x < 1280; x += 4) {
    let y = 120;
    while (y < 360 && !near('#e8141e')(px(c, x, y))) y += 1;
    tops.push(y);
  }
  assert.ok(Math.max(...tops) - Math.min(...tops) > 30, `rango ${Math.min(...tops)}-${Math.max(...tops)}`);
  assert.ok(new Set(tops).size > 20, `alturas distintas: ${new Set(tops).size}`);
  // Reborde dorado por FUERA del rojo.
  let gold = 0;
  for (let x = 0; x < 1280; x += 1) for (let y = 120; y < 240; y += 1) if (near('#ffcf3a')(px(c, x, y))) gold += 1;
  assert.ok(gold > 2000, `reborde dorado: ${gold} px`);
  // Salida: al final la franja se ha ido y ya no oscurece.
  const gone = shot(120, 12);
  assert.deepEqual(px(gone, 640, 360), [255, 255, 255]);
  assert.deepEqual(px(gone, 100, 60), [255, 255, 255]);
});

test('CUT-IN: el retrato cambia en el corte (barba -> gorra con tira fucsia) y la estrella roja parpadea en el ojo', async () => {
  const { shot, count, near } = await cutinBench();
  const center = (c, hex) => count(c, near(hex), 440, 238, 840, 482);
  const early = shot(30);
  assert.ok(center(early, '#2e1b0d') > 1000, 'barba');
  assert.equal(center(early, '#2f5fc4'), 0, 'sin gorra');
  const late = shot(64);
  assert.equal(center(late, '#2e1b0d'), 0, 'afeitado');
  assert.ok(center(late, '#2f5fc4') > 1000, 'gorra');
  assert.ok(center(late, '#ff2d8f') > 200, 'tira fucsia');
  // La estrella, sobre el ojo izquierdo de la imagen (~593, 338).
  const star = (c) => count(c, near('#ff2233'), 548, 293, 638, 383);
  assert.ok(star(late) > 50, `encendida: ${star(late)}`);
  assert.equal(star(shot(69)), 0, 'y apagada');
});

test('RETRATOS: la MISMA cara en los dos (ojos verdes, nariz, mandíbula, aro); cambian barba, gorra, gafas y camiseta', async () => {
  const { drawPortrait, px, near, count } = await cutinBench();
  const normal = drawPortrait(false);
  const awake = drawPortrait(true);
  const at = (c, x, y) => [0, 1, 2, 3].map((k) => Math.round(c.data[(y * c.width + x) * 4 + k])).join();
  const n0 = (c, hex) => count(c, near(hex));
  // Cejas, ojos y nariz: iguales salvo donde el despertado lleva las gafas
  // (la montura cruza el arranque de la nariz).
  const glasses = (p) => near('#d9c27a')(p) || near('#8a7433')(p) || p.every((v) => v === 255);
  const unexplained = [];
  const compare = (x, y) => {
    if (at(normal, x, y) !== at(awake, x, y) && !glasses(px(awake, x, y))) unexplained.push(`${x},${y}`);
  };
  // (Desde la fila 21: por encima, el ala de la gorra tapa el borde de las
  // cejas y los rizos salen por el hueco de ajuste.)
  for (let y = 21; y < 31; y += 1) for (let x = 20; x < 44; x += 1) compare(x, y); // (44: patilla)
  for (let y = 31; y < 35; y += 1) for (let x = 26; x < 38; x += 1) compare(x, y); // punta y aletas
  for (let x = 29; x < 35; x += 1) compare(x, 35);
  assert.deepEqual(unexplained, [], 'la cara solo cambia por las gafas');
  // Ojos VERDE CLARO en los mismos píxeles, con la fila de abajo más oscura
  // (3 por ojo) para que el iris no se funda con el blanco.
  const irisAt = (c, hex) => {
    const s = [];
    for (let y = 0; y < 64; y += 1) for (let x = 0; x < 64; x += 1) if (near(hex)(px(c, x, y))) s.push(`${x},${y}`);
    return s.join(' ');
  };
  assert.equal(irisAt(normal, '#7fb347').split(' ').length, 8);
  assert.equal(irisAt(normal, '#557f2c').split(' ').length, 6);
  for (const hex of ['#7fb347', '#557f2c']) assert.equal(irisAt(normal, hex), irisAt(awake, hex));
  assert.equal(n0(normal, '#4a2c1a') + n0(awake, '#4a2c1a'), 0, 'ya no son marrones');
  // El ARO negro en la oreja izquierda de la imagen, en los dos.
  for (const [x, y] of [[15, 34], [16, 34], [14, 35], [14, 36], [14, 37], [15, 38], [16, 38]]) {
    assert.deepEqual(px(normal, x, y), [20, 16, 14], `aro ${x},${y}`);
    assert.deepEqual(px(awake, x, y), [20, 16, 14], `aro ${x},${y}`);
  }
  // Mandíbula igual de ancha (la barba no la ensancha).
  const extent = (c, y) => {
    let l = -1;
    let r = -1;
    for (let x = 0; x < 64; x += 1) if (c.data[(y * 64 + x) * 4 + 3] > 0.5) { if (l < 0) l = x; r = x; }
    return `${l}-${r}`;
  };
  // (Hasta la fila 42: por debajo, la papada de la barba sí asoma del mentón.)
  for (const y of [36, 38, 40, 42]) assert.equal(extent(normal, y), extent(awake, y), `fila ${y}`);
  // Lo que cambia.
  const n = (c, hex) => count(c, near(hex));
  assert.ok(n(normal, '#2e1b0d') > 150, 'barba poblada');
  assert.equal(n(awake, '#2e1b0d'), 0, 'afeitado');
  for (const [hex, min, what] of [['#ff2d8f', 8, 'tira fucsia'], ['#d9c27a', 60, 'gafas redondas de alambre'],
    ['#16161a', 30, 'emblema negro'], ['#2f5fc4', 100, 'paneles azules de la gorra']]) {
    assert.ok(n(awake, hex) > min, `${what}: ${n(awake, hex)}`);
    assert.equal(n(normal, hex), 0, `${what} solo despertado`);
  }
  // Los dos cristales, iguales: la montura izquierda desplazada 16 px es la
  // derecha (sin la fila 25, la del puente y las patillas).
  const lens = (x0, x1, dx) => {
    const s = [];
    for (let y = 16; y < 36; y += 1) {
      if (y === 25) continue;
      for (let x = x0; x < x1; x += 1) if (near('#d9c27a')(px(awake, x, y))) s.push(`${x + dx},${y}`);
    }
    return s.join(' ');
  };
  assert.ok(lens(16, 32, 16).split(' ').length > 20);
  assert.equal(lens(16, 32, 16), lens(32, 50, 0), 'cristales simétricos');
  // La gorra RECOGE el pelo: ni un rizo por encima de su borde (fila 20), y
  // los que asoman por debajo caen a los DOS lados, sobre las orejas.
  const hair = (p) => near('#3a2213')(p) || near('#6a4428')(p);
  assert.equal(count(awake, hair, 0, 0, 64, 20), 0, 'nada de pelo sobre la gorra');
  assert.ok(count(awake, hair, 0, 20, 21, 30) >= 10, `rizos a la izquierda: ${count(awake, hair, 0, 20, 21, 30)}`);
  assert.ok(count(awake, hair, 43, 20, 64, 30) >= 10, `rizos a la derecha: ${count(awake, hair, 43, 20, 64, 30)}`);
  // La tira fucsia cruza el hueco de ajuste LIMPIA (fucsia, su brillo y la
  // hebilla, nada más) y por encima de ella, en el hueco, se ve la frente.
  const strap = (p) => near('#ff2d8f')(p) || near('#ff7ac0')(p) || near('#9aa4b2')(p);
  assert.equal(count(awake, strap, 25, 17, 39, 19), 28, 'tira entera');
  assert.equal(count(awake, near('#96603a'), 28, 14, 37, 17), 27, 'la frente en el hueco');
});

test('DESPERTADO: el sprite es el rapero (camiseta, bermudas, gorra, sin barba) y el atlas es perezoso', async () => {
  const { createCanvas } = await import('./fakeCanvas.mjs');
  const { drawPixelFighter } = await import('../public/src/engine/pixelFighterArt.js');
  const { computePoseForKind } = await import('../public/src/engine/poseLibrary.js');
  const { buildFighterAtlas } = await import('../public/src/engine/spriteAtlasBuilder.js');
  const countColor = (outfit, hex) => {
    const c = createCanvas(80, 120);
    drawPixelFighter(c.getContext('2d'), {
      w: 80, h: 120, art: 'mecanico', outfit, pose: computePoseForKind('idle', { h: 120, kit: 'mecanico', t: 0 }),
    });
    const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    let n = 0;
    for (let i = 0; i < c.data.length; i += 4) {
      if (c.data[i + 3] > 0.5 && [0, 1, 2].every((k) => Math.abs(c.data[i + k] - rgb[k]) < 3)) n += 1;
    }
    return n;
  };
  assert.ok(countColor('normal', '#2e1b0d') > 50, 'el mecánico lleva barba');
  assert.equal(countColor('normal', '#e9f2ee'), 0);
  assert.equal(countColor('awakened', '#2e1b0d'), 0, 'el despertado va afeitado');
  assert.ok(countColor('awakened', '#e9f2ee') > 300, 'camiseta blanca');
  assert.ok(countColor('awakened', '#8a8f96') > 100, 'bermudas grises');
  assert.ok(countColor('awakened', '#2f5fc4') > 15, 'banda azul de la gorra');
  assert.ok(countColor('awakened', '#ff2d8f') > 2, 'tira fucsia');
  assert.ok(countColor('awakened', '#d9c27a') > 30, 'gafas redondas de alambre');
  assert.ok(countColor('awakened', '#16161a') > 20, 'emblema negro, visible con los brazos cruzados');
  assert.ok(countColor('awakened', '#d8343c') > 40, 'cinturilla del calzoncillo: bermudas caídas');
  for (const hex of ['#d9c27a', '#16161a', '#d8343c']) assert.equal(countColor('normal', hex), 0, hex);
  for (const outfit of ['normal', 'awakened']) {
    assert.ok(countColor(outfit, '#7fb347') > 3, `ojos verdes (${outfit})`);
    assert.equal(countColor(outfit, '#4a2c1a'), 0, `ya no marrones (${outfit})`);
  }
  assert.equal(countColor('awakened', '#243558'), 0, 'sin el mono');
  // Atlas perezoso: no rasteriza nada hasta que se pide un frame, y lo que
  // rasteriza es lo mismo que hornea el atlas normal.
  const eager = buildFighterAtlas({ art: 'mecanico', animations: ['idle'] });
  const lazy = buildFighterAtlas({ art: 'mecanico', animations: ['idle'], lazy: true });
  assert.equal(lazy.image, null);
  const fe = eager.frames[eager.animations.idle.frameIndices[0]];
  const fl = lazy.frames[lazy.animations.idle.frameIndices[0]];
  const img = fl.image;
  let diff = 0;
  for (let y = 0; y < fe.sh; y += 1) {
    for (let x = 0; x < fe.sw; x += 1) {
      const a = ((fe.sy + y) * eager.image.width + fe.sx + x) * 4 + 3;
      const b = (y * img.width + x) * 4 + 3;
      if (Math.abs(eager.image.data[a] - img.data[b]) > 1e-6) diff += 1;
    }
  }
  assert.equal(diff, 0, 'el frame perezoso es idéntico al horneado');
  assert.equal(fl.image, img, 'y se rasteriza una sola vez');
});

test('DESPERTADO: la gorra RECOGE el pelo (rizos solo por debajo, en la nuca y los lados) y la tira fucsia se ve limpia', async () => {
  const { createCanvas } = await import('./fakeCanvas.mjs');
  const { drawPixelFighter } = await import('../public/src/engine/pixelFighterArt.js');
  const { computePoseForKind } = await import('../public/src/engine/poseLibrary.js');
  for (const [kind, opts] of [['idle', { t: 0 }], ['run', { t: 0.3 }], ['jump', { rising: true }], ['crouch', {}], ['hitstun', { progress: 0.5 }]]) {
    const c = createCanvas(120, 140);
    const ctx = c.getContext('2d');
    ctx.translate(20, 10);
    drawPixelFighter(ctx, {
      w: 80, h: 120, art: 'mecanico', outfit: 'awakened', pose: computePoseForKind(kind, { h: 120, kit: 'mecanico', ...opts }),
    });
    const cells = (hex) => {
      const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      const out = [];
      for (let y = 0; y < 140; y += 1) {
        for (let x = 0; x < 120; x += 1) {
          const i = (y * 120 + x) * 4;
          if (c.data[i + 3] > 0.5 && [0, 1, 2].every((k) => Math.abs(c.data[i + k] - rgb[k]) < 3)) out.push({ x, y });
        }
      }
      return out;
    };
    // La franja azul de la base de la cúpula (sin el botón de arriba).
    const blue = cells('#2f5fc4');
    const bandY = Math.max(...blue.map((q) => q.y));
    const band = blue.filter((q) => q.y >= bandY - 1);
    const bandL = Math.min(...band.map((q) => q.x));
    const bandR = Math.max(...band.map((q) => q.x));
    const hair = [...cells('#3a2213'), ...cells('#6a4428')];
    assert.ok(hair.length >= 15, `${kind}: rizos bajo la gorra: ${hair.length}`);
    const above = hair.filter((q) => q.y < bandY + 2);
    assert.deepEqual(above, [], `${kind}: nada de pelo por encima del borde de la gorra`);
    assert.ok(hair.some((q) => q.x < bandL), `${kind}: rizos en la nuca`);
    assert.ok(hair.some((q) => q.x > bandR), `${kind}: y un mechón en el lado lejano`);
    // La tira: dos filas de 10 menos la hebilla, enteras, justo encima del
    // borde de la gorra y sin que la montura de las gafas la corte.
    const strap = cells('#ff2d8f');
    const light = cells('#ff7ac0');
    assert.equal(strap.length, 8, `${kind}: tira`);
    assert.equal(light.length, 8, `${kind}: su brillo`);
    assert.ok(strap.every((q) => q.y === light[0].y + 1 && q.y < bandY), `${kind}: la tira en la frente, sobre el borde`);
  }
});

test('DESPERTADO: aura dorada parpadeante alrededor de la silueta, solo despertado', async () => {
  const { createCanvas } = await import('./fakeCanvas.mjs');
  const { buildFighterAtlas } = await import('../public/src/engine/spriteAtlasBuilder.js');
  const { SpriteAnimator } = await import('../public/src/engine/spriteAnimator.js');
  const { awakenAura } = await import('../public/src/engine/renderer.js');
  assert.equal(awakenAura({ awakened: false }, 0), null);
  const alphas = new Set([0, 3, 6, 9, 12].map((f) => awakenAura({ awakened: true }, f).alpha.toFixed(2)));
  assert.ok(alphas.size > 2, 'la opacidad late');
  const animator = new SpriteAnimator(buildFighterAtlas({
    art: 'mecanico', animations: ['idle'], outfit: 'awakened', lazy: true,
  }));
  animator.play('idle');
  const gold = (aura) => {
    const c = createCanvas(300, 260);
    animator.draw(c.getContext('2d'), 150, 220, 1, { aura });
    let n = 0;
    for (let i = 0; i < c.data.length; i += 4) {
      if (c.data[i + 3] > 0.1 && c.data[i] > 200 && c.data[i + 1] > 150 && c.data[i + 2] < 120) n += 1;
    }
    return n;
  };
  assert.equal(gold(null), 0);
  // Frame 5: el tono dorado (en el 0 salta a blanco dorado, el parpadeo).
  assert.ok(gold(awakenAura({ awakened: true }, 5)) > 150, 'contorno dorado alrededor');
});

test('DESPERTADO: actitud DESAFIANTE en reposo (pecho fuera, barbilla alta), sin brazos cruzados, solo despertado', async () => {
  const { createCanvas } = await import('./fakeCanvas.mjs');
  const { drawPixelFighter } = await import('../public/src/engine/pixelFighterArt.js');
  const { computePoseForKind } = await import('../public/src/engine/poseLibrary.js');
  const draw = (outfit, stance) => {
    const c = createCanvas(80, 120);
    const pose = computePoseForKind('idle', { h: 120, kit: 'mecanico', t: 0 });
    assert.equal(pose.stance, 'idle', 'el reposo del mecánico se marca como tal');
    if (!stance) delete pose.stance;
    drawPixelFighter(c.getContext('2d'), { w: 80, h: 120, art: 'mecanico', outfit, pose });
    return c;
  };
  // PIEL (los antebrazos y los puños) en una caja del sprite; el verde
  // descarta la cinturilla roja del calzoncillo, que asoma por la cadera.
  const skin = (c, x0, y0, x1, y1) => {
    let n = 0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const i = (y * 80 + x) * 4;
        if (c.data[i + 3] > 0.5 && c.data[i] > 120 && c.data[i] - c.data[i + 2] > 50 && c.data[i + 1] > 70) n += 1;
      }
    }
    return n;
  };
  // Los brazos cruzados sobre el pecho (un bloque blanco inflado con dos
  // muñones) se fueron: con la actitud el pecho sigue siendo camiseta y el
  // puño de delante está donde en el reposo, delante de la barriga.
  const proud = draw('awakened', true);
  const plain = draw('awakened', false);
  const chest = [28, 38, 56, 54];
  const fist = [50, 60, 66, 76];
  assert.ok(skin(proud, ...chest) < 10, `sin brazos cruzados: el pecho es camiseta (${skin(proud, ...chest)})`);
  assert.ok(skin(proud, ...fist) > 25, `el puño de delante, delante de la barriga (${skin(proud, ...fist)})`);
  assert.ok(Math.abs(skin(proud, ...fist) - skin(plain, ...fist)) <= 12, 'los brazos no cambian con la actitud');
  // La actitud: la barbilla un pixel más ALTA (la cabeza entera sube).
  const topRow = (c) => {
    for (let y = 0; y < 120; y += 1) for (let x = 0; x < 80; x += 1) if (c.data[(y * 80 + x) * 4 + 3] > 0.5) return y;
    return 120;
  };
  assert.equal(topRow(plain) - topRow(proud), 1, 'barbilla alta');
  // El mecánico no cambia de actitud: la marca no le afecta.
  const a = draw('normal', true);
  const b = draw('normal', false);
  let diff = 0;
  for (let i = 0; i < a.data.length; i += 1) if (Math.abs(a.data[i] - b.data[i]) > 1e-6) diff += 1;
  assert.equal(diff, 0);
});

test('DESPERTADO: llamas rojas y doradas que SUBEN por el cuerpo y ondulan, solo despertado', async () => {
  const { createCanvas } = await import('./fakeCanvas.mjs');
  const { drawAwakenFlames } = await import('../public/src/engine/renderer.js');
  const view = {
    awakened: true, visible: true, x: 150, y: 220, bodyHeight: 108,
  };
  const flames = (v, frame, layer = 'back') => {
    const c = createCanvas(300, 260);
    drawAwakenFlames(c.getContext('2d'), v, frame, layer);
    const cells = [];
    for (let y = 0; y < 260; y += 1) {
      for (let x = 0; x < 300; x += 1) {
        const i = (y * 300 + x) * 4;
        if (c.data[i + 3] > 0.05) cells.push({ x, y, r: c.data[i], g: c.data[i + 1], a: c.data[i + 3] });
      }
    }
    return cells;
  };
  assert.equal(flames({ ...view, awakened: false }, 10).length, 0, 'sin despertar no hay fuego');
  const back = flames(view, 10);
  assert.ok(back.length > 1500, `llamas detrás: ${back.length}`);
  // Envuelven el cuerpo: a los dos lados y hasta más de media altura.
  assert.ok(back.some((p) => p.x < 125) && back.some((p) => p.x > 175), 'a los dos lados');
  assert.ok(Math.min(...back.map((p) => p.y)) < 220 - 54, 'suben más allá de media altura');
  // Rojo en la base y dorado en la punta.
  const meanY = (list) => list.reduce((s, p) => s + p.y, 0) / list.length;
  const red = back.filter((p) => p.r > 200 && p.g < 60);
  const gold = back.filter((p) => p.r > 240 && p.g > 180);
  assert.ok(red.length > 100 && gold.length > 100, `${red.length} rojos, ${gold.length} dorados`);
  assert.ok(meanY(gold) < meanY(red) - 15, 'el dorado está arriba');
  // ONDULAN: por encima de donde nacen todas las lenguas (y < 220 - 32), sin
  // ondulación el borde izquierdo del fuego solo podría ir hacia dentro al
  // subir (las lenguas se estrechan y se acaban); con ella, va y vuelve.
  const leftAt = (list, y) => Math.min(...list.filter((p) => p.y === y).map((p) => p.x));
  let wiggles = 0;
  for (let y = 220 - 34; y > 120; y -= 2) if (leftAt(back, y - 2) < leftAt(back, y) - 1) wiggles += 1;
  assert.ok(wiggles >= 2, `el borde del fuego ondula: ${wiggles}`);
  // Se mueven: frames distintos, llamas distintas.
  const key = (list) => list.map((p) => `${p.x},${p.y}`).join(' ');
  assert.notEqual(key(flames(view, 10)), key(flames(view, 14)));
  // Y unas pocas lenguas translúcidas por DELANTE del sprite.
  const front = flames(view, 10, 'front');
  assert.ok(front.length > 150 && front.length < back.length / 2, `delante: ${front.length}`);
  assert.ok(front.every((p) => p.a <= 0.5), 'translúcidas');
});

test('DESPERTADO: estelas FANTASMA rojas y doradas detrás al correr; ni en reposo ni sin despertar', async () => {
  const { createCanvas } = await import('./fakeCanvas.mjs');
  const { buildFighterAtlas } = await import('../public/src/engine/spriteAtlasBuilder.js');
  const { SpriteAnimator } = await import('../public/src/engine/spriteAnimator.js');
  const { drawAwakenGhosts } = await import('../public/src/engine/renderer.js');
  const animator = new SpriteAnimator(buildFighterAtlas({
    art: 'mecanico', animations: ['idle'], outfit: 'awakened', lazy: true,
  }));
  animator.play('idle');
  // Corre 16 frames hacia la derecha a 6 px/f y cuenta lo que queda detrás.
  const run = (slot, extra) => {
    let c = null;
    for (let f = 0; f <= 16; f += 1) {
      c = createCanvas(400, 220);
      drawAwakenGhosts(c.getContext('2d'), {
        slot, awakened: true, state: 'run', x: 200 + f * 6, y: 200, facing: 1, flip: false, ...extra,
      }, animator, 1000 + f);
    }
    let red = 0;
    let gold = 0;
    let sumX = 0;
    let n = 0;
    const colAlpha = new Array(400).fill(0);
    for (let y = 0; y < 220; y += 1) {
      for (let x = 0; x < 400; x += 1) {
        const i = (y * 400 + x) * 4;
        if (c.data[i + 3] < 0.05) continue;
        sumX += x;
        n += 1;
        colAlpha[x] = Math.max(colAlpha[x], c.data[i + 3]);
        if (c.data[i] > 200 && c.data[i + 1] < 90) red += 1;
        if (c.data[i] > 200 && c.data[i + 1] > 160 && c.data[i + 2] < 90) gold += 1;
      }
    }
    // Las copias se solapan (12 px entre ellas): solo las columnas de los
    // extremos son de UNA copia, la más vieja a la izquierda y la más nueva a
    // la derecha. En medio el alfa se acumula y no dice nada.
    const cols = colAlpha.map((a, x) => (a > 0.05 ? x : -1)).filter((x) => x >= 0);
    const edge = (list) => Math.max(...list.map((x) => colAlpha[x]));
    return {
      red, gold, meanX: n ? sumX / n : null,
      oldAlpha: cols.length ? edge(cols.slice(0, 3)) : 0,
      newAlpha: cols.length ? edge(cols.slice(-3)) : 0,
    };
  };
  const g = run('ghost-run', {});
  assert.ok(g.red > 300 && g.gold > 300, JSON.stringify(g));
  assert.ok(g.meanX < 296 - 10, `se quedan DETRÁS (el luchador está en x 296): ${JSON.stringify(g)}`);
  assert.ok(g.oldAlpha > 0 && g.oldAlpha < g.newAlpha, `se apagan con la edad: ${JSON.stringify(g)}`);
  assert.equal(run('ghost-idle', { state: 'idle' }).red, 0, 'quieto no deja estela');
  const off = run('ghost-off', { awakened: false });
  assert.equal(off.red + off.gold, 0, 'sin despertar tampoco');
  // Y si el Despertar se acaba a media carrera, las que quedaban se van YA.
  const end = createCanvas(400, 220);
  drawAwakenGhosts(end.getContext('2d'), {
    slot: 'ghost-run', awakened: false, state: 'run', x: 302, y: 200, facing: 1, flip: false,
  }, animator, 1017);
  assert.equal(end.data.filter((v, i) => i % 4 === 3 && v > 0.05).length, 0, 'al acabarse el Despertar');
});

// ============================================================================
// MODO DESPERTADO: EL MOVESET DEL RAPERO (combate)
// ============================================================================

// p1 despertado en `x1` frente a p2 en `x2`, pegados al suelo de la losa.
function awakenedDuel({ x1 = 600, x2 = 650, phase = PHASES.LOBBY } = {}) {
  const sim = makeSim({ phase });
  place(sim.p1, { x: x1, facing: x2 >= x1 ? 1 : -1 });
  place(sim.p2, { x: x2, facing: x2 >= x1 ? -1 : 1 });
  sim.p1.awaken(600);
  sim.drainEvents();
  return sim;
}

// Avanza hasta el primer evento `type` (o `n` frames) y lo devuelve.
function stepUntil(sim, type, n = 120, input = {}) {
  for (let i = 0; i < n; i += 1) {
    sim.step(input);
    const e = sim.drainEvents().find((ev) => ev.type === type);
    if (e) return e;
  }
  return null;
}

test('DESPERTADO: tabla y stats despertados SOLO mientras dura (carrera 6.5, aire 4.32, 3 saltos aéreos)', () => {
  const runSpeed = (awake) => {
    const sim = makeSim();
    place(sim.p1, { x: 420 });
    if (awake) sim.p1.awaken(600);
    run(sim, 1, { right: true, dash: true });
    run(sim, 30, { right: true });
    assert.equal(sim.p1.state, STATES.RUN);
    return sim.p1.vx;
  };
  assert.ok(Math.abs(runSpeed(false) - 5.2) < 1e-9, 'carrera normal');
  assert.ok(Math.abs(runSpeed(true) - 6.5) < 1e-9, 'carrera x1.25');
  const airSpeed = (awake) => {
    const sim = makeSim();
    place(sim.p1, { x: 400, y: 200, surfaceId: null });
    if (awake) sim.p1.awaken(600);
    run(sim, 20, { right: true });
    return sim.p1.vx;
  };
  assert.ok(Math.abs(airSpeed(false) - 3.6) < 1e-9);
  assert.ok(Math.abs(airSpeed(true) - 4.32) < 1e-9, 'aire x1.2');
  // TRES saltos aéreos (el cuarto no sale).
  const sim = makeSim();
  place(sim.p1, { x: 640, y: 300, surfaceId: null });
  sim.p1.awaken(600);
  let jumps = 0;
  for (let i = 0; i < 4; i += 1) {
    sim.step({ p1: { jump: true } });
    jumps += sim.drainEvents().filter((e) => e.type === 'doubleJump').length;
    run(sim, 8);
    sim.drainEvents();
  }
  assert.equal(jumps, 3);
  // La tabla despertada SUSTITUYE a la normal, y al acabar vuelve todo.
  assert.equal(sim.p1.moves.jab.pose, 'micjab');
  run(sim, 600);
  assert.equal(sim.p1.awakened, false);
  assert.equal(sim.p1.moves.jab.pose, 'jab');
  assert.equal(sim.p1.stats.dashSpeed, 5.2);
});

test('DESPERTADO: Heavy Armor PASIVA — un golpe de menos de 8% no lanza ni aturde (el % entra); 8% sí', () => {
  const hb = { damage: 7.9, bkb: 60, kbg: 100, angle: 45 };
  const sim = awakenedDuel();
  const armored = sim.applyHit(sim.p2, sim.p1, hb, 7.9);
  assert.equal(armored.type, 'armor');
  assert.ok(Math.abs(sim.p1.percent - 7.9) < 1e-9);
  assert.equal(sim.p1.state, STATES.IDLE);
  assert.equal(sim.p1.kbx, 0);
  assert.equal(sim.applyHit(sim.p2, sim.p1, { ...hb, damage: 8 }, 8).type, 'hit', 'con 8% ya lanza');
  const plain = makeSim();
  place(plain.p1, { x: 600 });
  place(plain.p2, { x: 650, facing: -1 });
  assert.equal(plain.applyHit(plain.p2, plain.p1, hb, 7.9).type, 'hit', 'sin despertar no hay armadura');
});

test('DESPERTADO JAB: una pulsación, 6 golpes de 2% que RETIENEN y el remate de 6% a ras de suelo (18%)', () => {
  const sim = awakenedDuel();
  sim.step({ p1: { attack: true } });
  const damages = [];
  let held = true;
  let launch = null;
  for (let i = 0; i < 160 && damages.length < 7; i += 1) {
    sim.step({});
    for (const e of sim.drainEvents()) {
      if (e.type !== 'hit' || e.victim !== 'p2') continue;
      damages.push(e.damage);
      if (damages.length === 7) {
        drainHitlag(sim);
        launch = { kbx: sim.p2.kbx, kby: sim.p2.kby };
      }
    }
    // Entre el primer golpe y el remate el rival no recupera el control.
    if (damages.length > 0 && damages.length < 7 && sim.p2.state !== STATES.HITSTUN) held = false;
  }
  assert.deepEqual(damages, [2, 2, 2, 2, 2, 2, 6]);
  assert.equal(sim.p2.percent, 18);
  assert.ok(held, 'la ráfaga retiene hasta el remate');
  assert.equal(launch.kby, 0, 'el remate manda a ras de suelo');
  assert.ok(launch.kbx > 0);
});

test('DESPERTADO F-SMASH: sweetspot en la cabeza del micro con IMPACT FRAMES; mata desde el centro al 65%', () => {
  const sweet = awakenedDuel({ x2: 650 });
  sweet.p1.startMove('fsmash');
  const hit = stepUntil(sweet, 'hit');
  assert.equal(hit.damage, 22);
  assert.equal(hit.impact, 'invert');
  // El brazo (la parte floja): un rival en el aire a la altura del pecho.
  const sour = awakenedDuel({ x2: 640 });
  place(sour.p2, { x: 640, y: 450, surfaceId: null, facing: -1 });
  sour.p1.startMove('fsmash');
  let arm = null;
  for (let i = 0; i < 40 && !arm; i += 1) {
    sour.p2.vy = 0;
    sour.p2.y = 450;
    sour.step({});
    arm = sour.drainEvents().find((e) => e.type === 'hit');
  }
  assert.equal(arm.damage, 16);
  assert.equal(arm.impact, null, 'sin impact frames');
  assert.equal(koThreshold({ move: 'fsmash', x1: 640, x2: 690, awaken: true }, 58, 72), 65);
});

test('DESPERTADO U-SMASH: el cono llega a un rival sobre el tablón de encima (el normal no) y mata al 70%', () => {
  const plat = GEOMETRY.platforms[0];
  const onPlank = (awake) => {
    const sim = makeSim();
    place(sim.p1, { x: 470 });
    place(sim.p2, { x: 570, y: plat.y, surfaceId: plat.id, facing: -1 });
    if (awake) sim.p1.awaken(600);
    sim.p1.startMove('usmash');
    return stepUntil(sim, 'hit', 60);
  };
  assert.equal(onPlank(false), null, 'el pistón normal no llega');
  assert.equal(onPlank(true)?.damage, 18, 'el subwoofer sí');
  assert.equal(koThreshold({ move: 'usmash', x1: 640, x2: 690, awaken: true }, 62, 78), 70);
});

test('DESPERTADO D-SMASH: golpea a los DOS lados y lanza en diagonal baja (25°) hacia fuera', () => {
  for (const side of [1, -1]) {
    const sim = awakenedDuel({ x2: 640 + side * 60, x1: 640 });
    sim.p1.facing = 1;
    sim.p1.startMove('dsmash');
    const hit = stepUntil(sim, 'hit');
    assert.equal(hit.damage, 16);
    drainHitlag(sim);
    const angle = Math.atan2(-sim.p2.kby, Math.abs(sim.p2.kbx)) * (180 / Math.PI);
    assert.ok(Math.sign(sim.p2.kbx) === side, `lado ${side}: hacia fuera`);
    assert.ok(Math.abs(angle - 25) < 0.5, `lado ${side}: ${angle.toFixed(1)}°`);
  }
});

test('DESPERTADO F-AIR (dropkick): 4 frames más de hitstop y Samuel sale rebotado hacia atrás', () => {
  const sim = awakenedDuel();
  place(sim.p1, { x: 600, y: 380, surfaceId: null });
  place(sim.p2, { x: 650, y: 380, surfaceId: null, facing: -1 });
  sim.p1.startMove('fair');
  let hit = null;
  for (let i = 0; i < 30 && !hit; i += 1) {
    sim.p2.vy = 0;
    sim.p2.y = sim.p1.y;
    sim.step({});
    hit = sim.drainEvents().find((e) => e.type === 'hit');
  }
  assert.equal(hit.damage, 15);
  // floor(15·0.45 + 4) = 10 de hitlag normal, +4.
  assert.equal(sim.hitlag, 14);
  assert.equal(sim.p1.vx, -5.5);
  assert.equal(sim.p1.vy, -5);
});

test('DESPERTADO D-AIR: picado a 22 px/f con el meteoro activo todo el descenso; después, caída normal', () => {
  // Fuera de la losa (x 100): nada donde aterrizar a media caída.
  const sim = makeSim();
  place(sim.p1, { x: 100, y: -40, surfaceId: null });
  sim.p1.awaken(600);
  sim.p1.startMove('dair');
  const dy = [];
  for (let i = 0; i < 44; i += 1) {
    const y = sim.p1.y;
    sim.step({});
    if (sim.p1.moveFrame >= 6 && sim.p1.moveFrame <= 35) dy.push(sim.p1.y - y);
  }
  assert.equal(dy.length, 30);
  assert.ok(dy.every((d) => Math.abs(d - 22) < 1e-9), `desplazamiento por frame: ${[...new Set(dy)].join(', ')}`);
  assert.equal(sim.p1.state, STATES.AIR, 'sin caída indefensa');
  // Meteoro a lo largo de TODO el descenso: pilla a un rival a 100 y a 380 px por debajo.
  for (const below of [100, 380]) {
    const s2 = makeSim();
    place(s2.p1, { x: 640, y: 60, surfaceId: null });
    place(s2.p2, { x: 640, y: 60 + below, surfaceId: null });
    s2.p1.awaken(600);
    s2.p1.startMove('dair');
    let hit = null;
    for (let i = 0; i < 40 && !hit; i += 1) {
      s2.p2.vy = 0;
      s2.p2.y = 60 + below;
      s2.step({});
      hit = s2.drainEvents().find((e) => e.type === 'hit');
    }
    assert.equal(hit?.damage, 14, `rival ${below} px por debajo`);
    drainHitlag(s2);
    assert.ok(s2.p2.kby > 0 && Math.abs(s2.p2.kbx) < 1e-9, 'lo hunde recto');
  }
});

test('DESPERTADO O neutro: la nube del puro (200 px, 4 s) quita 2% por segundo y ralentiza un 40%, sin aturdir', () => {
  const sim = awakenedDuel({ x2: 620 });
  place(sim.p1, { x: 500 });
  sim.step({ p1: { special: true } }); // O neutro, como un jugador
  const spawn = stepUntil(sim, 'projectileSpawn', 60);
  assert.equal(spawn.kind, 'cigarCloud');
  assert.equal(spawn.x, 620, '120 px por delante');
  run(sim, 59);
  assert.equal(sim.p2.percent, 2, 'un segundo dentro: 2%');
  assert.equal(sim.p2.state, STATES.IDLE, 'no aturde');
  // Dentro, la carrera va al 60%: 5.2 -> 3.12.
  run(sim, 1, {}, { right: true, dash: true });
  run(sim, 20, {}, { right: true });
  assert.ok(Math.abs(sim.p2.vx - 3.12) < 1e-9, `carrera dentro de la nube: ${sim.p2.vx}`);
  assert.equal(sim.p2.view().slowed, true);
  // A los 240 frames de vida se disipa.
  run(sim, 240 - 80);
  assert.equal(sim.projectiles.list.length, 0);
  assert.equal(sim.p2.slowFactor, 1);
});

test('DESPERTADO LATERAL + O: atraviesa el escudo, frena en seco al conectar y manda al rival hacia arriba', () => {
  const sim = awakenedDuel({ x1: 420, x2: 700 });
  run(sim, 2, {}, { shield: true });
  assert.equal(sim.p2.state, STATES.SHIELD);
  sim.p1.startMove('sspecial');
  let hit = null;
  for (let i = 0; i < 40 && !hit; i += 1) {
    sim.step({ p2: { shield: true } });
    hit = sim.drainEvents().find((e) => e.type === 'hit');
  }
  assert.equal(hit.outcome, 'hit', 'el escudo no lo para');
  assert.equal(sim.p1.vx, 0, 'frena en seco');
  drainHitlag(sim);
  const angle = Math.atan2(-sim.p2.kby, sim.p2.kbx) * (180 / Math.PI);
  assert.ok(Math.abs(angle - 88) < 0.5, `hacia arriba: ${angle.toFixed(1)}°`);
  run(sim, 5);
  assert.equal(sim.p1.vx, 0, 'y no sigue deslizando');
  // Sin nadie delante, cruza la losa: 15 px/f durante 29 frames.
  const solo = makeSim();
  place(solo.p1, { x: 360 });
  place(solo.p2, { x: 900, facing: -1 }); // fuera del recorrido
  solo.p1.awaken(600);
  solo.p1.startMove('sspecial');
  run(solo, 34);
  assert.ok(Math.abs(solo.p1.x - (360 + 15 * 29)) < 1e-9, `recorrido: ${solo.p1.x - 360}`);
});

test('DESPERTADO ARRIBA + O: sube el DOBLE que el Up-B normal, sin matarse desde un tablón, y la detonación es un meteoro', () => {
  const rise = (awake, { x = 640, y = 520, surfaceId = 'main' } = {}) => {
    const sim = makeSim();
    place(sim.p1, { x, y, surfaceId });
    if (awake) sim.p1.awaken(600);
    sim.p1.startMove('uspecial');
    let top = sim.p1.y;
    let ko = false;
    for (let i = 0; i < 200; i += 1) {
      sim.step({});
      top = Math.min(top, sim.p1.y);
      if (sim.drainEvents().some((e) => e.type === 'ko')) ko = true;
    }
    return { rise: y - top, ko };
  };
  const ratio = rise(true).rise / rise(false).rise;
  assert.ok(ratio > 1.97 && ratio < 2.03, `x${ratio.toFixed(3)}`);
  const plat = GEOMETRY.platforms[0];
  assert.equal(rise(true, { x: 490, y: plat.y, surfaceId: plat.id }).ko, false, 'desde el tablón no se mata');
  const sim = awakenedDuel();
  place(sim.p1, { x: 640, y: 300, surfaceId: null });
  place(sim.p2, { x: 640, y: 400, surfaceId: null });
  sim.p1.startMove('uspecial');
  let hit = null;
  for (let i = 0; i < 20 && !hit; i += 1) {
    sim.p2.vy = 0;
    sim.p2.y = 400;
    sim.step({});
    hit = sim.drainEvents().find((e) => e.type === 'hit');
  }
  assert.equal(hit.damage, 16);
  drainHitlag(sim);
  assert.ok(sim.p2.kby > 0, 'meteoro: hacia abajo');
});

test('DESPERTADO ABAJO + O (parry): en los frames 2-18 congela 20, aparece a la ESPALDA del rival y le pega con impact frames', () => {
  const parryAt = (startDelay) => {
    const sim = awakenedDuel({ x1: 600, x2: 660 });
    sim.p1.startMove('dspecial');
    run(sim, startDelay);
    sim.drainEvents();
    sim.p2.startMove('ftilt'); // activo en su frame 7
    const events = [];
    let lagAtCounter = null;
    for (let i = 0; i < 80; i += 1) {
      sim.step({});
      for (const e of sim.drainEvents()) {
        events.push(e);
        if (e.type === 'counter') lagAtCounter = { hitlag: sim.hitlag, x: sim.p1.x, facing: sim.p1.facing };
      }
    }
    return { sim, events, lagAtCounter };
  };
  const ok = parryAt(3); // el golpe llega en el frame 10 del parry
  const counter = ok.events.find((e) => e.type === 'counter');
  assert.equal(counter.parry, true);
  assert.equal(ok.lagAtCounter.hitlag, 20, 'el tiempo se congela 20 frames');
  assert.equal(ok.lagAtCounter.x, 660 + 58, 'a la espalda del rival (que mira a la izquierda)');
  assert.equal(ok.lagAtCounter.facing, -1, 'de cara a su espalda');
  assert.equal(ok.sim.p1.percent, 0, 'el golpe no entra');
  const punch = ok.events.find((e) => e.type === 'hit' && e.victim === 'p2');
  assert.equal(punch.damage, 15);
  assert.equal(punch.impact, 'redwhite');
  // Fuera de la ventana (el golpe llega en el frame 19), entra.
  const late = parryAt(12);
  assert.equal(late.events.some((e) => e.type === 'counter'), false);
  assert.equal(late.sim.p1.percent, 11);
});

test('DESPERTADO FINAL SMASH: sin medidor UNA vez por Despertar; gorra -> batalla de 240 frames, 3 rimas de 10% y 20% final', () => {
  const battle = (percent, { x1 = 440, x2 = 640, di = {}, meter = 0 } = {}) => {
    const sim = awakenedDuel({ x1, x2, phase: PHASES.FIGHT });
    sim.p2.percent = percent;
    sim.p1.meter = meter;
    run(sim, 2);
    sim.drainEvents();
    sim.step({ p1: { ultra: true } });
    const out = { words: [], started: false };
    for (let i = 0; i < 700 && !out.ko; i += 1) {
      const kind = sim.cine?.kind;
      sim.step(out.boom ? { p2: di } : {});
      for (const e of sim.drainEvents()) {
        if (e.type === 'moveStart' && e.move === 'final') out.started = true;
        if (e.type === 'finalCapture') out.kind = sim.cine?.kind ?? kind;
        if (e.type === 'battleWord') out.words.push([sim.cine.frame, e.damage]);
        if (e.type === 'finalBoom') out.boom = e;
        if (e.type === 'ko' && e.slot === 'p2') out.ko = e;
      }
    }
    out.sim = sim;
    return out;
  };
  const low = battle(20);
  assert.equal(low.started, true, 'sin medidor, despertado');
  assert.equal(low.kind, 'battle');
  assert.deepEqual(low.words, [[120, 10], [145, 10], [170, 10]]);
  assert.equal(low.boom.damage, 50);
  assert.equal(low.boom.auto, false);
  // Al 20% no hay K.O. automático: la detonación es la fórmula (20% de 50 a 70).
  assert.ok(Math.abs(low.boom.kb - combat.calculateKnockback(50, 20, 116, 4, 148)) < 1e-9);
  assert.equal(low.sim.p2.percent >= 70, true);
  // Ya usado en este Despertar: la segunda vez no sale.
  low.sim.step({ p1: { ultra: true } });
  run(low.sim, 5);
  assert.equal(low.sim.drainEvents().some((e) => e.type === 'moveStart' && e.move === 'final'), false);
  // Con MÁS del 30% al empezar: K.O. automático desde cualquier sitio y con cualquier DI.
  for (const x2 of [360, 640, 920]) {
    for (const di of referenceDIs()) {
      const r = battle(31, { x1: x2 < 640 ? x2 + 200 : x2 - 200, x2, di });
      assert.equal(r.boom.auto, true);
      assert.ok(r.ko, `al 31% en x=${x2} con DI ${JSON.stringify(di)}: K.O.`);
    }
  }
  assert.equal(battle(30).boom.auto, false, 'al 30% justo, no');
  // Sin despertar y sin medidor no hay Final Smash.
  const sim = makeSim();
  place(sim.p1, { x: 440 });
  place(sim.p2, { x: 640, facing: -1 });
  sim.step({ p1: { ultra: true } });
  run(sim, 5);
  assert.equal(sim.drainEvents().some((e) => e.type === 'moveStart' && e.move === 'final'), false);
});

test('servidor: la cinemática lleva su tipo (gallos o batalla) y no se acepta otro', () => {
  const sim = awakenedDuel({ x1: 440, x2: 640, phase: PHASES.FIGHT });
  run(sim, 2);
  sim.step({ p1: { ultra: true } });
  for (let i = 0; i < 60 && !sim.cine; i += 1) sim.step({});
  const snap = sim.serialize();
  assert.equal(snap.cine.kind, 'battle');
  assert.equal(server.isSaneSnapshot(snap), true);
  assert.equal(server.isSaneSnapshot({ ...snap, cine: { ...snap.cine, kind: 'otra' } }), false);
});

test('DESACOPLE: tampoco despertado bloquea más de 22 frames un golpe que no mata', () => {
  const moves = [['jab_finisher', 50], ['fsmash', 50], ['usmash', 50], ['dsmash', 56], ['sspecial', 50]];
  let lethal = 0;
  let checked = 0;
  for (const [move, gap] of moves) {
    for (const x1 of [600, 860]) {
      for (let p = 0; p <= 150; p += 30) {
        const sim = awakenedDuel({ x1, x2: x1 + gap, phase: PHASES.FIGHT });
        sim.p2.percent = p;
        sim.p1.startMove(move);
        let hit = null;
        let ko = null;
        for (let i = 0; i < 500 && !ko; i += 1) {
          sim.step({});
          for (const e of sim.drainEvents()) {
            if (e.type === 'hit' && !hit) {
              hit = { ...e, hitstun: sim.p2.hitstun };
              checked += 1;
            }
            if (e.type === 'ko' && e.slot === 'p2') ko = e;
          }
        }
        if (!hit || (hit.hitstun <= 22 && !hit.lethal)) continue;
        lethal += 1;
        assert.equal(hit.lethal, true, `${move} al ${p}%: ${hit.hitstun} frames sin ser letal`);
        assert.ok(ko, `${move} al ${p}%: bloqueo largo sin K.O.`);
      }
    }
  }
  assert.ok(checked >= 50, `golpes comprobados: ${checked}`);
  assert.ok(lethal >= 8, `golpes letales en el barrido: ${lethal}`);
});

// --- el rapero dibujado ------------------------------------------------------

const AWAKENED_POSES = ['micjab', 'micslam', 'burpsky', 'windmill', 'dropkick', 'divebomb', 'habano', 'rapdash',
  'parry', 'parrypunch', 'capthrow', 'battlestance'];

test('DESPERTADO POSES: todas horneadas; cada frame del rapero es UNA pieza y no se hunde bajo los pies', async () => {
  const { createCanvas } = await import('./fakeCanvas.mjs');
  const { animationPoses, animationsForMoveTable, buildFighterAtlas } = await import('../public/src/engine/spriteAtlasBuilder.js');
  const { drawPixelFighter } = await import('../public/src/engine/pixelFighterArt.js');
  const { rosterVictimPoses } = await import('../public/src/characters/roster.js');
  const baked = animationsForMoveTable(samuelConfig.awakened.moveTable, rosterVictimPoses());
  for (const name of AWAKENED_POSES.filter((n) => n !== 'battlestance')) assert.ok(baked.includes(name), `${name} se hornea`);
  const bodyOnly = {
    tool: 0, gas: 0, shock: 0, smokePuff: 0, trails: null, barrel: 0, mic: 0, notes: 0, sparks: 0, cigHand: 0,
  };
  const W = 240;
  const H = 220;
  const pieces = (pose) => {
    const c = createCanvas(W, H);
    const ctx = c.getContext('2d');
    ctx.translate(80, 60);
    drawPixelFighter(ctx, {
      w: 80, h: 120, art: 'mecanico', outfit: 'awakened', pose: { ...pose, ...bodyOnly },
    });
    const seen = new Uint8Array(W * H);
    let count = 0;
    for (let i = 0; i < W * H; i += 1) {
      if (seen[i] || !(c.data[i * 4 + 3] > 0.5)) continue;
      count += 1;
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const k = stack.pop();
        const x = k % W;
        const y = (k - x) / W;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            const j = yy * W + xx;
            if (!seen[j] && c.data[j * 4 + 3] > 0.5) {
              seen[j] = 1;
              stack.push(j);
            }
          }
        }
      }
    }
    return count;
  };
  let frames = 0;
  for (const name of AWAKENED_POSES) {
    animationPoses(name, 'mecanico').forEach((pose, i) => {
      assert.equal(pieces(pose), 1, `${name}, frame ${i}: el cuerpo está partido`);
      frames += 1;
    });
  }
  assert.ok(frames >= 110, `frames revisados: ${frames}`);
  // Nada del cuerpo por debajo de los pies (el gas del picado es efecto).
  const atlas = buildFighterAtlas({
    art: samuelConfig.art, animations: AWAKENED_POSES.filter((n) => n !== 'divebomb'), outfit: 'awakened',
  });
  for (const [name, anim] of Object.entries(atlas.animations)) {
    if (!AWAKENED_POSES.includes(name)) continue;
    for (const fi of anim.frameIndices) {
      const f = atlas.frames[fi];
      let lowest = -1;
      for (let y = f.sh - 1; y >= 0 && lowest < 0; y -= 1) {
        for (let x = 0; x < f.sw; x += 1) {
          if (atlas.image.data[((f.sy + y) * atlas.image.width + f.sx + x) * 4 + 3] > 0) {
            lowest = y;
            break;
          }
        }
      }
      assert.ok(lowest - f.pivotY <= 1, `${name}: el cuerpo baja ${lowest - f.pivotY}px de los pies`);
    }
  }
});

test('DESPERTADO SINCRONÍA: en cada frame activo el micro, el puño o las piernas están DENTRO de su caja', async () => {
  const { createCanvas } = await import('./fakeCanvas.mjs');
  const { buildFighterAtlas, animationsForMoveTable } = await import('../public/src/engine/spriteAtlasBuilder.js');
  const { SpriteAnimator } = await import('../public/src/engine/spriteAnimator.js');
  const { rosterVictimPoses } = await import('../public/src/characters/roster.js');
  const { movePhase } = await import('../public/src/engine/movePhase.js');
  const { KEYED_POSES, effectorPoint } = await import('../public/src/engine/keyedPoses.js');
  const table = samuelConfig.awakened.moveTable;
  const own = Object.entries(table).filter(([id, m]) => m !== samuelConfig.moveTable[id]);
  const animator = new SpriteAnimator(buildFighterAtlas({
    art: samuelConfig.art, animations: animationsForMoveTable(table, rosterVictimPoses()), outfit: 'awakened', lazy: true,
  }));
  // Cajas que cubre el EFECTO y no el sprite: el cono del subwoofer (las
  // cuatro del U-Smash) y el gas del picado bajo el culo.
  const effectBoxes = new Set(['usmash#0', 'usmash#1', 'usmash#2', 'usmash#3', 'dair#0']);
  let drawn = 0;
  let anchored = 0;
  for (const [id, m] of own) {
    (m.hitboxes || []).forEach((hb, k) => {
      if (effectBoxes.has(`${id}#${k}`)) return;
      for (let f = hb.from; f <= hb.to; f += 1) {
        const c = createCanvas(400, 300);
        animator.playAtProgress(m.pose, movePhase(m, f));
        animator.draw(c.getContext('2d'), 200, 200, 1);
        let n = 0;
        const x0 = Math.round(200 + hb.x - hb.w / 2);
        const y0 = Math.round(200 + hb.y - hb.h / 2);
        for (let y = Math.max(0, y0); y < Math.min(300, y0 + hb.h); y += 1) {
          for (let x = Math.max(0, x0); x < Math.min(400, x0 + hb.w); x += 1) {
            if (x >= 174 && x < 226 && y >= 92 && y < 200) continue; // el cuerpo
            if (c.data[(y * 400 + x) * 4 + 3] > 0.5) n += 1;
          }
        }
        assert.ok(n >= 150, `${id} (caja ${k}), frame ${f}: solo ${n} px dibujados dentro de la caja`);
        drawn += 1;
      }
    });
    // ANCLAJE: el efector de la pose (micro, puño, tobillo) en una caja activa.
    const def = KEYED_POSES[m.pose];
    if (!def?.effector || !m.hitboxes) continue;
    for (let f = Math.min(...m.hitboxes.map((hb) => hb.from)); f <= Math.max(...m.hitboxes.map((hb) => hb.to)); f += 1) {
      const boxes = m.hitboxes.filter((hb) => f >= hb.from && f <= hb.to);
      if (!boxes.length) continue;
      const [x, y] = effectorPoint(await displayedPose(m, f), def.effector);
      const inside = boxes.some((hb) => {
        const bx = 40 + hb.x - hb.w / 2;
        const by = 120 + hb.y - hb.h / 2;
        return x >= bx - 1 && x <= bx + hb.w + 1 && y >= by - 1 && y <= by + hb.h + 1;
      });
      assert.ok(inside, `${id}, frame ${f}: el ${def.effector} está en (${x.toFixed(0)}, ${y.toFixed(0)}), fuera de su caja`);
      anchored += 1;
    }
  }
  assert.ok(drawn >= 55, `frames activos dibujados: ${drawn}`);
  assert.ok(anchored >= 50, `frames anclados: ${anchored}`);
});

test('DESPERTADO: el micro DORADO en la mano, la brasa del puro en la calada y el pelo al aire al lanzar la gorra', async () => {
  const { createCanvas } = await import('./fakeCanvas.mjs');
  const { drawPixelFighter } = await import('../public/src/engine/pixelFighterArt.js');
  const { computePoseForKind } = await import('../public/src/engine/poseLibrary.js');
  const count = (kind, progress, hexes) => {
    const c = createCanvas(160, 160);
    const ctx = c.getContext('2d');
    ctx.translate(40, 20);
    drawPixelFighter(ctx, {
      w: 80, h: 120, art: 'mecanico', outfit: 'awakened', pose: computePoseForKind(kind, { h: 120, kit: 'mecanico', progress }),
    });
    const rgbs = hexes.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
    let n = 0;
    for (let i = 0; i < c.data.length; i += 4) {
      if (c.data[i + 3] > 0.5 && rgbs.some((rgb) => [0, 1, 2].every((k) => Math.abs(c.data[i + k] - rgb[k]) < 3))) n += 1;
    }
    return n;
  };
  const gold = ['#ffc743', '#a67617'];
  assert.ok(count('micjab', 0.4, gold) > 60, `micro dorado en la ráfaga: ${count('micjab', 0.4, gold)}`);
  assert.ok(count('micslam', 0.4, gold) > 60, 'y en el microfonazo');
  assert.equal(count('rapdash', 0.4, gold), 0, 'sin micro donde no toca');
  // El puro: tabaco y anilla; la brasa, encendida en la calada (0.26) y
  // apagada al sacarlo (0.05).
  assert.ok(count('habano', 0.4, ['#6b3a1e', '#94562d']) > 40, 'el puro');
  assert.ok(count('habano', 0.26, ['#ff6b2b']) > 10, 'brasa al rojo en la calada');
  assert.equal(count('habano', 0.05, ['#ff6b2b']), 0, 'antes de la calada, apagada');
  // La gorra lanzada: sin su azul y con la mata de rizos.
  assert.ok(count('capthrow', 0.1, ['#2f5fc4']) > 15, 'con gorra antes de lanzarla');
  assert.equal(count('capthrow', 0.4, ['#2f5fc4']), 0, 'lanzada');
  assert.ok(count('capthrow', 0.4, ['#3a2213']) > count('capthrow', 0.1, ['#3a2213']) + 60, 'el pelo al aire');
});

// --- impact frames, la batalla y los proyectiles, rasterizados ---------------

async function awakenedAnimators() {
  const { buildFighterAtlas, animationsForMoveTable } = await import('../public/src/engine/spriteAtlasBuilder.js');
  const { SpriteAnimator } = await import('../public/src/engine/spriteAnimator.js');
  const { rosterVictimPoses } = await import('../public/src/characters/roster.js');
  return {
    rapper: new SpriteAnimator(buildFighterAtlas({
      art: 'mecanico', animations: animationsForMoveTable(samuelConfig.awakened.moveTable, rosterVictimPoses()), outfit: 'awakened', lazy: true,
    })),
    victim: new SpriteAnimator(buildFighterAtlas({ art: 'mecanico', animations: ['idle', 'stagger', 'hitstun'], lazy: true })),
  };
}

const rgbAt = (c, x, y) => [0, 1, 2].map((k) => Math.round(c.data[(y * c.width + x) * 4 + k]));

test('IMPACT FRAMES: invert = 3 frames (blanco/negro, invertido, blanco/negro) con la estrella roja; redwhite = 2; después, nada', async () => {
  const { createCanvas } = await import('./fakeCanvas.mjs');
  const { drawImpactFrame } = await import('../public/src/engine/impactFrames.js');
  const { rapper } = await awakenedAnimators();
  rapper.play('idle');
  const camera = { apply() {}, worldToScreen: (x, y) => ({ x, y }) };
  const view = {
    x: 400, y: 500, facing: 1, visible: true, slot: 'p1',
  };
  const shot = (style, age) => {
    const c = createCanvas(1280, 720);
    const drawn = drawImpactFrame(c.getContext('2d'), {
      style, age, views: [view], animatorFor: () => rapper, camera, geometry: GEOMETRY, point: { x: 900, y: 300 }, viewport: { w: 1280, h: 720 },
    });
    return { c, drawn };
  };
  const expect = [['invert', [[255, 255, 255], [0, 0, 0]], [[0, 0, 0], [255, 255, 255]], [[255, 255, 255], [0, 0, 0]]],
    ['redwhite', [[255, 255, 255], [216, 20, 30]], [[216, 20, 30], [255, 255, 255]]]];
  for (const [style, ...frames] of expect) {
    frames.forEach(([bg, sil], age) => {
      const { c, drawn } = shot(style, age);
      assert.equal(drawn, true);
      assert.deepEqual(rgbAt(c, 20, 700), bg, `${style} ${age}: fondo`);
      assert.deepEqual(rgbAt(c, 400, 450), sil, `${style} ${age}: el luchador, en silueta plana`);
      assert.deepEqual(rgbAt(c, 640, 540), sil, `${style} ${age}: la losa, en silueta`);
      assert.deepEqual(rgbAt(c, 900, 300), [255, 255, 255], 'el núcleo de la estrella');
      assert.deepEqual(rgbAt(c, 900 + 40, 300), [255, 26, 42], 'la estrella roja');
    });
    const after = shot(style, frames.length);
    assert.equal(after.drawn, false, `${style}: acaba a los ${frames.length} frames`);
    assert.equal(after.c.data.some((v, i) => i % 4 === 3 && v > 0), false);
  }
});

test('BATALLA DE GALLOS (dibujo): tajo en negro, foco sobre el rival, entrada de Samuel, rimas que golpean e impact frame monocromo', async () => {
  const { createCanvas, luminanceAt } = await import('./fakeCanvas.mjs');
  const { drawBattleFinale, wordAt } = await import('../public/src/engine/battleFinale.js');
  const { rapper, victim } = await awakenedAnimators();
  const spec = samuelConfig.awakened.moveTable.final.finalSmash;
  const shot = (frame) => {
    const c = createCanvas(1280, 720);
    drawBattleFinale(c.getContext('2d'), {
      frame, spec, attacker: rapper, victim, viewport: { w: 1280, h: 720 },
    });
    return c;
  };
  const count = (c, test, x0 = 0, y0 = 0, x1 = 1280, y1 = 720) => {
    let n = 0;
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) if (test(rgbAt(c, x, y))) n += 1;
    return n;
  };
  const crimson = (p) => p[0] > 180 && p[1] < 60 && p[2] < 70;
  // 0-11: negro con el tajo rojo.
  const slash = shot(4);
  assert.deepEqual(rgbAt(slash, 20, 700), [0, 0, 0]);
  assert.ok(count(slash, crimson) > 500, `tajo: ${count(slash, crimson)}`);
  // El foco ya ha caído: bajo él, mucha más luz que en la esquina. Se mide
  // SIN el rival (el sprite y el grafiti también dan luz): solo el ladrillo.
  const bare = createCanvas(1280, 720);
  drawBattleFinale(bare.getContext('2d'), {
    frame: 44, spec, attacker: rapper, victim: null, viewport: { w: 1280, h: 720 },
  });
  const brick = (x0, x1) => {
    let s = 0;
    let n = 0;
    for (let y = 320; y < 580; y += 8) for (let x = x0; x < x1; x += 8) { s += luminanceAt(bare, x, y); n += 1; }
    return s / n;
  };
  assert.ok(brick(440, 500) > brick(1100, 1260) * 2 + 10, `foco ${brick(440, 500).toFixed(1)} vs esquina ${brick(1100, 1260).toFixed(1)}`);
  const spot = shot(44);
  const lum = (c, x0, x1) => {
    let s = 0;
    let n = 0;
    for (let y = 120; y < 560; y += 8) for (let x = x0; x < x1; x += 8) { s += luminanceAt(c, x, y); n += 1; }
    return s / n;
  };
  assert.ok(lum(spot, 420, 520) > lum(spot, 1100, 1260) + 20, 'el foco');
  // Samuel no está hasta su entrada; luego, a la derecha (la camiseta blanca).
  const tee = (p) => p[0] > 225 && p[1] > 235 && p[2] > 230;
  assert.ok(count(shot(50), tee, 700, 250, 1280, 600) < 20, 'antes de entrar no está');
  assert.ok(count(shot(100), tee, 700, 250, 1280, 600) > 400, 'entra por la derecha');
  // Las tres rimas: en vuelo antes de su frame, golpean EN él (fogonazo) y
  // después se apagan.
  spec.pulseFrames.forEach((hitAt, i) => {
    assert.equal(wordAt(hitAt - 7, spec).hit, false);
    assert.equal(wordAt(hitAt, spec).hit, true);
    assert.equal(wordAt(hitAt, spec).word, ['PUNCHLINE!', 'FLOW!', 'TOMA!'][i]);
  });
  const gold = (p) => p[0] > 245 && p[1] > 200 && p[1] < 225 && p[2] < 90;
  assert.ok(count(shot(spec.pulseFrames[0] - 5), gold) > 100, 'la rima vuela');
  assert.ok(lum(shot(spec.pulseFrames[1]), 0, 1280) > lum(shot(spec.pulseFrames[1] + 3), 0, 1280) + 20, 'fogonazo al golpear');
  // IMPACT FRAME: 3 frames en blanco y negro (el del medio invertido) con
  // las chispas carmesí; después, la detonación en color.
  const mono = (c) => count(c, (p) => !((p[0] > 245 && p[1] > 245 && p[2] > 245) || (p[0] < 10 && p[1] < 10 && p[2] < 10) || crimson(p)));
  const [a, b, c2, d] = [0, 1, 2, 3].map((k) => shot(spec.impactFrame + k));
  assert.equal(mono(a), 0);
  assert.equal(mono(b), 0);
  assert.equal(mono(c2), 0);
  assert.ok(mono(d) > 1000, 'la detonación ya no es monocroma');
  assert.deepEqual(rgbAt(a, 20, 20), [255, 255, 255]);
  assert.deepEqual(rgbAt(b, 20, 20), [0, 0, 0], 'el del medio, invertido');
  assert.ok(count(a, crimson) > 100, 'chispas carmesí');
  assert.ok(count(a, (p) => p[0] < 10 && p[1] < 10 && p[2] < 10, 300, 200, 800, 620) > 2000, 'las dos siluetas');
});

test('DESPERTADO (proyectiles): la nube del puro llena su caja y se disipa; la gorra lleva su azul y su tira; el nitro es verde', async () => {
  const { createCanvas } = await import('./fakeCanvas.mjs');
  const { PROJECTILE_KINDS } = await import('../public/src/engine/projectiles.js');
  const { drawCigarCloud, drawCapThrow, drawNitroBlast } = await import('../public/src/engine/projectileArt.js');
  const opaque = (c, x0, y0, x1, y1) => {
    let n = 0;
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) if (c.data[(y * c.width + x) * 4 + 3] > 0) n += 1;
    return n;
  };
  const cloudAt = (age) => {
    const c = createCanvas(400, 300);
    drawCigarCloud(c.getContext('2d'), {
      id: 3, x: 200, y: 150, age, dir: 1,
    }, PROJECTILE_KINDS.cigarCloud);
    return c;
  };
  const mid = cloudAt(100);
  const inBox = opaque(mid, 100, 75, 300, 225);
  assert.ok(inBox > 200 * 150 * 0.5, `la nube cubre su caja: ${inBox}`);
  assert.ok(opaque(mid, 0, 0, 400, 300) - inBox < inBox * 0.2, 'y apenas se sale');
  const alphaMax = (c) => Math.max(...c.data.filter((_, i) => i % 4 === 3));
  assert.ok(alphaMax(cloudAt(235)) < alphaMax(mid), 'al final de su vida se disipa');
  const cap = createCanvas(200, 120);
  drawCapThrow(cap.getContext('2d'), {
    x: 100, y: 60, age: 0, dir: 1,
  });
  const has = (c, hex) => {
    const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return c.data.some((_, i) => i % 4 === 0 && c.data[i + 3] > 0.9 && [0, 1, 2].every((k) => Math.abs(c.data[i + k] - rgb[k]) < 3));
  };
  assert.ok(has(cap, '#2f5fc4') && has(cap, '#ff2d8f') && has(cap, '#f4f4f0'), 'blanca, azul y fucsia');
  const nitro = createCanvas(200, 200);
  drawNitroBlast(nitro.getContext('2d'), {
    x: 100, y: 100, age: 2, dir: 1,
  }, PROJECTILE_KINDS.nitroBlast);
  let green = 0;
  for (let i = 0; i < nitro.data.length; i += 4) if (nitro.data[i + 3] > 0 && nitro.data[i + 1] > nitro.data[i] + 40) green += 1;
  assert.ok(green > 2000, `verde: ${green}`);
});

test('GUÍA: la sección del Modo Despertado toma sus números de la tabla DESPERTADA', async () => {
  const { buildGuide } = await import('../public/src/engine/moveGuide.js');
  const rows = buildGuide(samuelConfig).find((s) => s.title.startsWith('MODO DESPERTADO')).rows;
  const row = (name) => rows.find((r) => r.name === name);
  assert.deepEqual([row('DROP THE MIC').damage, row('DROP THE MIC').startup], ['22%', 'F18']);
  assert.equal(row('PUNCHLINE METRALLETA').damage, '2-6%');
  assert.equal(row('NITRO GAS').damage, '16%');
  assert.equal(row('PARRY / VACILE').damage, '15%');
  assert.equal(row('BATALLA DEFINITIVA').damage, '50%');
  // Retocar la tabla despertada cambia la guía sola.
  const table = samuelConfig.awakened.moveTable;
  const tweaked = {
    ...samuelConfig,
    awakened: { ...samuelConfig.awakened, moveTable: { ...table, fsmash: { ...table.fsmash, hitboxes: [{ ...table.fsmash.hitboxes[0], damage: 30 }] } } },
  };
  const again = buildGuide(tweaked).find((s) => s.title.startsWith('MODO DESPERTADO')).rows;
  assert.equal(again.find((r) => r.name === 'DROP THE MIC').damage, '30%');
});

test('DESPERTADO (bordes): 3 saltos al aterrizar, 1 al acabarse; picado VERTICAL; nube de 200 px; gorra a toda pantalla; parry desde el frame 2; sin impact frames contra escudo', () => {
  // Aterrizar devuelve los 3 saltos; acabarse el Despertar en el aire los recorta a 1.
  const sim = makeSim();
  place(sim.p1, { x: 640, y: 400, surfaceId: null });
  sim.p1.awaken(600);
  sim.p1.jumpsLeft = 0;
  run(sim, 40);
  assert.equal(sim.p1.grounded, true);
  assert.equal(sim.p1.jumpsLeft, 3);
  place(sim.p1, { x: 640, y: 100, surfaceId: null });
  sim.p1.awakenFrames = 2;
  run(sim, 3);
  assert.equal(sim.p1.jumpsLeft, 1, 'sin Despertar, un solo salto');
  // Picado vertical aunque entre con inercia.
  const dive = makeSim();
  place(dive.p1, { x: 100, y: -40, surfaceId: null });
  dive.p1.awaken(600);
  dive.p1.vx = 4;
  dive.p1.startMove('dair');
  run(dive, 6);
  const x0 = dive.p1.x;
  run(dive, 20);
  assert.equal(dive.p1.x, x0, 'sin deriva durante el picado');
  // La nube mide 200 px: un rival que la roza por fuera ya no se ralentiza.
  const edge = (x2) => {
    const s = awakenedDuel({ x1: 500, x2 });
    s.p1.startMove('nspecial');
    stepUntil(s, 'projectileSpawn', 60);
    run(s, 2);
    return s.p2.slowFactor;
  };
  assert.equal(edge(740), 0.6, 'dentro por el borde (720)');
  assert.equal(edge(750), 1, 'fuera');
  // La gorra cruza la pantalla: atrapa a un rival a 1000 px.
  const far = awakenedDuel({ x1: 360, x2: 1300, phase: PHASES.FIGHT });
  place(far.p2, { x: 1300, y: 420, surfaceId: null, facing: -1 });
  far.p1.meter = 0;
  far.step({ p1: { ultra: true } });
  let captured = false;
  for (let i = 0; i < 100 && !captured; i += 1) {
    far.p2.vy = 0;
    far.p2.y = 420;
    far.step({});
    captured = far.drainEvents().some((e) => e.type === 'finalCapture');
  }
  assert.ok(captured, 'la gorra llega a 1000 px');
  // Parry justo en su frame 2.
  const early = awakenedDuel({ x1: 600, x2: 660 });
  early.p2.startMove('ftilt'); // activo en su frame 7
  run(early, 5);
  early.p1.startMove('dspecial');
  assert.ok(stepUntil(early, 'counter', 10), 'el golpe llega en el frame 2 del parry: contraataca');
  // Contra el escudo el microfonazo no lleva impact frames.
  const guard = awakenedDuel();
  run(guard, 2, {}, { shield: true });
  guard.p1.startMove('fsmash');
  let blocked = null;
  for (let i = 0; i < 40 && !blocked; i += 1) {
    guard.step({ p2: { shield: true } });
    blocked = guard.drainEvents().find((e) => e.type === 'hit');
  }
  assert.equal(blocked.outcome, 'shield');
  assert.equal(blocked.impact, null);
});

test('DESPERTADO: la bola dorada del micro se dibuja donde dice su efector (el sweetspot)', async () => {
  const { createCanvas } = await import('./fakeCanvas.mjs');
  const { drawPixelFighter } = await import('../public/src/engine/pixelFighterArt.js');
  const { computePoseForKind } = await import('../public/src/engine/poseLibrary.js');
  const { effectorPoint } = await import('../public/src/engine/keyedPoses.js');
  for (const [kind, t] of [['micslam', 0.4], ['micjab', 0.4], ['battlestance', 0.5]]) {
    const pose = computePoseForKind(kind, { h: 120, kit: 'mecanico', progress: t });
    const c = createCanvas(200, 200);
    const ctx = c.getContext('2d');
    ctx.translate(60, 40);
    drawPixelFighter(ctx, {
      w: 80, h: 120, art: 'mecanico', outfit: 'awakened', pose,
    });
    const [ex, ey] = effectorPoint(pose, 'mic');
    let gold = 0;
    for (let y = Math.round(ey) - 6; y <= Math.round(ey) + 6; y += 1) {
      for (let x = Math.round(ex) - 6; x <= Math.round(ex) + 6; x += 1) {
        const i = ((y + 40) * 200 + x + 60) * 4;
        if (c.data[i + 3] > 0.5 && c.data[i] > 160 && c.data[i + 1] > 100 && c.data[i + 2] < 70) gold += 1;
      }
    }
    assert.ok(gold > 80, `${kind}: ${gold} px dorados alrededor del efector`);
  }
});

test('SILLA GAMER y COJÍN DONUT: la silla en alto al cargar y el respaldo contra el suelo al estampar; el donut rosa con su chorretón', async () => {
  const { createCanvas } = await import('./fakeCanvas.mjs');
  const { drawPixelFighter } = await import('../public/src/engine/pixelFighterArt.js');
  const { computePoseForKind } = await import('../public/src/engine/poseLibrary.js');
  const { drawDonutProjectile } = await import('../public/src/engine/projectileArt.js');
  const cells = (kind, progress, hexes) => {
    const c = createCanvas(240, 260);
    const ctx = c.getContext('2d');
    ctx.translate(80, 100);
    drawPixelFighter(ctx, { w: 80, h: 120, art: 'mecanico', pose: computePoseForKind(kind, { h: 120, kit: 'mecanico', progress }) });
    const rgbs = hexes.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
    const out = [];
    for (let y = 0; y < 260; y += 1) {
      for (let x = 0; x < 240; x += 1) {
        const i = (y * 240 + x) * 4;
        if (c.data[i + 3] > 0.5 && rgbs.some((rgb) => [0, 1, 2].every((k) => Math.abs(c.data[i + k] - rgb[k]) < 3))) out.push({ x: x - 80, y: y - 100 });
      }
    }
    return out;
  };
  const { effectorPoint } = await import('../public/src/engine/keyedPoses.js');
  const chair = ['#1c1c21', '#39ff14'];
  // Cargando (la carga se congela en la fase 0.16): la silla ENTERA por encima de la cabeza (y < 10).
  const held = cells('chairslam', 0.16, chair);
  assert.ok(held.length > 400, `silla en alto: ${held.length}`);
  assert.ok(held.filter((q) => q.y < 10).length > held.length * 0.8, 'por encima de la cabeza');
  assert.ok(cells('chairslam', 0.16, ['#39ff14']).length > 200, 'con sus paneles y costuras verdes');
  // Al estampar: delante y abajo, con la punta del respaldo en el suelo (y 100-120).
  // (0.475: el segundo golpe; entre los dos, la silla rebota y sube.)
  const slam = cells('chairslam', 0.475, [...chair, '#0b0b0e']); // con el cabecero
  const bounce = cells('chairslam', 0.38, [...chair, '#0b0b0e']);
  assert.ok(Math.max(...bounce.map((q) => q.y)) < Math.max(...slam.map((q) => q.y)) - 10, 'en dos tiempos: rebota entre golpe y golpe');
  // Y el atlas los enseña: en los frames activos horneados, abajo-arriba-abajo.
  const { animationPoses } = await import('../public/src/engine/spriteAtlasBuilder.js');
  const baked = animationPoses('chairslam', 'mecanico');
  const beats = baked.map((pose, i) => [(i + 0.5) / baked.length, effectorPoint(pose, 'chair')[1]]).filter(([t]) => t >= 0.3 && t < 0.5).map(([, y]) => y);
  const top = Math.min(...beats);
  const at = beats.indexOf(top);
  assert.ok(at > 0 && at < beats.length - 1 && beats[0] > top + 10 && beats[beats.length - 1] > top + 10, `golpe, rebote y golpe: ${beats.map(Math.round)}`);
  assert.ok(slam.filter((q) => q.x > 80 && q.y > 100 && q.y <= 120).length > 40, 'el respaldo contra el suelo, delante');
  assert.equal(slam.filter((q) => q.y > 121).length, 0, 'sin hundirse en él');
  // El donut en la embestida: glaseado rosa, chorretón blanco y la masa.
  assert.ok(cells('special', 0.4, ['#ff8fc8']).length > 400, 'glaseado');
  assert.ok(cells('special', 0.4, ['#fff4e4']).length > 600, 'mucha crema blanca espesa (goterones, churretes y gotas)');
  assert.ok(cells('special', 0.4, ['#e3a560', '#b0733a']).length > 200, 'la masa');
  // La punta del respaldo se dibuja donde dice su efector (la caja del golpe).
  const tip = effectorPoint(computePoseForKind('chairslam', { h: 120, kit: 'mecanico', progress: 0.475 }), 'chair');
  assert.ok(slam.filter((q) => Math.hypot(q.x - tip[0], q.y - tip[1]) < 10).length > 40, `silla en la punta (${tip.map(Math.round)})`);
  // El abrazo aéreo sube con los dos puños por ENCIMA de la cabeza.
  const skin = cells('flyingslam', 0.4, ['#c98a5c', '#e6b487', '#96603a']);
  assert.ok(skin.filter((q) => q.y < 8 && q.x > 55).length > 20 && skin.filter((q) => q.y < 8 && q.x < 25).length > 20, 'los dos brazos arriba y abiertos');
  // Lanzado: gira (cara, canto, panza) sin rotate().
  const spin = [0, 3, 6].map((age) => {
    const c = createCanvas(100, 100);
    drawDonutProjectile(c.getContext('2d'), {
      x: 50, y: 50, age, dir: 1,
    });
    let pink = 0;
    let rows = 0;
    let cream = 0;
    for (let y = 0; y < 100; y += 1) {
      let any = false;
      for (let x = 0; x < 100; x += 1) {
        const i = (y * 100 + x) * 4;
        if (c.data[i + 3] > 0.5) any = true;
        if (c.data[i + 3] > 0.5 && c.data[i] > 250 && Math.abs(c.data[i + 1] - 143) < 3) pink += 1;
        if (c.data[i + 3] > 0.5 && c.data[i] > 250 && Math.abs(c.data[i + 1] - 244) < 3 && Math.abs(c.data[i + 2] - 228) < 3) cream += 1;
      }
      if (any) rows += 1;
    }
    return { pink, rows, cream };
  });
  assert.ok(spin[0].pink > 300, 'de cara: el glaseado');
  assert.ok(spin[0].cream > 450, `y mucha crema: ${spin[0].cream}`);
  assert.ok(spin[1].rows < spin[0].rows * 0.7, 'de canto: aplastado');
  assert.equal(spin[2].pink, 0, 'de espaldas: la panza, sin glaseado');
});
