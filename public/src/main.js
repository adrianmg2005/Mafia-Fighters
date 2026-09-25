// MAFIA FIGHTERS — platform fighter LAN, 60 Hz, host-autoritativo.
//
// Este archivo ORQUESTA; no decide nada del combate:
//   - la simulación entera vive en engine/simulation.js (determinista, sin
//     canvas ni red) y solo la ejecuta el HOST (rol 'p1');
//   - el host manda cada tick su `serialize()` + los eventos del tick; el
//     cliente remoto (p2 o espectador) nunca simula: aplica el snapshot y
//     reproduce los mismos eventos, así que las dos pantallas ven lo mismo;
//   - aquí se convierten los eventos en chispas, sonido, sacudidas y
//     carteles, y se dibuja.
//
// Dos bucles independientes (ver engine/clock.js): la SIMULACIÓN corre en un
// reloj de Web Worker que no se estrangula en segundo plano, y el DIBUJADO en
// requestAnimationFrame, que sí se para con la pestaña oculta — nadie mira.

import {
  pollLocalInput, isInputFocused, createEmptyInputState, sanitizeInput,
} from './engine/inputManager.js';
import { Simulation, PHASES } from './engine/simulation.js';
import { CameraManager, VIEWPORT_W, VIEWPORT_H } from './engine/cameraManager.js';
import {
  getGeometry, drawStage, drawBackdrop, drawRespawnPlatform, getStageSafetyColor,
} from './engine/stage.js';
import { surfaceBelow } from './engine/physics.js';
import {
  drawFighter, drawShadow, drawScreenFlash, SLOT_COLORS,
} from './engine/renderer.js';
import {
  drawPercentPanels, drawOffscreenBubbles, drawFlowOverlay, drawCinematicFrame,
} from './engine/platformHud.js';
import {
  initDebugToggle, drawDebugOverlay, drawStatusMessage, drawControlsBar,
} from './engine/hud.js';
import {
  updateParticles, drawParticles, spawnHitEffect, spawnDust, spawnSuperAura, clearParticles,
  spawnSonicRing, spawnMusicNotes, spawnEarBleed, spawnGasCloud, spawnTrailSparks, spawnKoCone,
  spawnDebris, spawnSwingSparks, spawnAuraMotes,
} from './engine/particles.js';
import {
  updateVfx, drawGroundLayer, drawAirLayer, clearVfx, spawnToxicBlast, spawnOilBurst,
  spawnCigarPuff, spawnTrailSmoke, spawnToxicJetDown,
} from './engine/vfxManager.js';
import {
  updateLights, drawLights, clearLights, spawnAcidFlash, spawnLight,
} from './engine/lightingManager.js';
import {
  spawnStyledText, updateFloatingTexts, drawFloatingTexts, clearFloatingTexts,
} from './engine/floatingTextManager.js';
import { buildFighterAtlas, animationsForMoveTable } from './engine/spriteAtlasBuilder.js';
import { drawAwakenCutin, CUTIN_EXIT_FRAMES } from './engine/awakenCutin.js';
import { drawImpactFrame } from './engine/impactFrames.js';
import { drawBattleFinale } from './engine/battleFinale.js';
import {
  drawCigarCloud, drawCapThrow, drawNitroBlast, drawDonutProjectile,
} from './engine/projectileArt.js';
import { SpriteAnimator } from './engine/spriteAnimator.js';
import { initResponsiveCanvas } from './engine/viewport.js';
import { createSimulationClock } from './engine/clock.js';
import { initAudio, playSfx, isAudioMuted } from './engine/audio.js';
import { NetworkClient } from './engine/network.js';
import { ROSTER, rosterConfigById, rosterVictimPoses } from './characters/roster.js';
import { PROJECTILE_KINDS } from './engine/projectiles.js';
import { PauseMenu } from './engine/pauseMenu.js';

const FIXED_DT = 1 / 60;
const VIEWPORT = { w: VIEWPORT_W, h: VIEWPORT_H };

const canvas = document.getElementById('game-canvas');
canvas.width = VIEWPORT_W;
canvas.height = VIEWPORT_H;
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;
initResponsiveCanvas(canvas, VIEWPORT_W, VIEWPORT_H);
initAudio();
initDebugToggle();

// --- Mundo -------------------------------------------------------------------

const geometry = getGeometry();
const sim = new Simulation({ geometry, p1: ROSTER[0], p2: ROSTER[0] });
const camera = new CameraManager({ blastZones: geometry.blastZones });

// Atlas: uno por personaje y ROPA, compartido (datos inmutables). El del Modo
// Despertar ('awakened', el rapero) es PEREZOSO: cada frame se rasteriza la
// primera vez que se enseña (un atlas completo mide ~95 MB y el Despertar
// dura 10 s). Animador: uno por RANURA, porque guarda el cursor de frame — en
// un espejo Samuel-vs-Samuel los dos irían siempre por el mismo frame si lo
// compartieran.
const atlasCache = new Map();
function atlasFor(config, outfit = 'normal') {
  const key = `${config.id}|${outfit}`;
  if (!atlasCache.has(key)) {
    // Despertado, con las poses de SU tabla (el micro, el puro, el parry...).
    const table = outfit === 'awakened' && config.awakened ? config.awakened.moveTable : config.moveTable;
    atlasCache.set(key, buildFighterAtlas({
      art: config.art,
      color: config.color,
      animations: animationsForMoveTable(table, rosterVictimPoses()),
      outfit,
      lazy: outfit !== 'normal',
    }));
  }
  return atlasCache.get(key);
}
const animators = {};
const animatorIds = {};
function animatorFor(view) {
  const outfit = view.awakened ? 'awakened' : 'normal';
  const key = `${view.id}|${outfit}`;
  if (animatorIds[view.slot] !== key) {
    animators[view.slot] = new SpriteAnimator(atlasFor(rosterConfigById(view.id), outfit));
    animatorIds[view.slot] = key;
  }
  return animators[view.slot];
}

// Salida de la cinemática del Despertar: la franja se abre hacia los lados
// durante CUTIN_EXIT_FRAMES cuando la simulación la cierra (presentación).
let cutinWasOn = false;
let cutinExit = null;

// Lo que se dibuja: el último snapshot (propio en el host, recibido en el
// remoto). Render y HUD leen SOLO esto.
let snap = sim.serialize();
let presentationFrame = 0;
let screenFlash = 0;
let pureFlash = 0;
const koBlasts = [];
// Special Zoom en curso (golpe letal): punto de contacto, rayos y cuándo
// suena el estallido del lanzamiento.
let lethalFx = null;
// IMPACT FRAMES en curso (golpe del Despertado con `impact`): estilo, punto y
// el frame de SIMULACIÓN del golpe (su edad se cuenta en frames de
// simulación: las dos pantallas lo ven igual).
let impactFx = null;

// Spec del Final Smash `kind` de un personaje (la de su tabla despertada o la
// normal): la cinemática de la batalla lee de ahí sus frames.
function finalSpecOf(config, kind) {
  for (const table of [config?.awakened?.moveTable, config?.moveTable]) {
    const spec = table?.final?.finalSmash;
    if (spec && (spec.kind ?? 'gallos') === kind) return spec;
  }
  return null;
}

// Menú de pausa: la PAUSA es de la simulación (viaja en el snapshot); lo que
// cada jugador mira dentro de la guía —pestaña y scroll— es local.
const pauseMenu = new PauseMenu();
let lastLocalInput = createEmptyInputState();
function myConfig() {
  const slot = myRole === 'p2' ? 'p2' : 'p1';
  return rosterConfigById(snap.fighters.find((f) => f.slot === slot)?.id);
}
window.addEventListener('wheel', (e) => {
  if (snap.paused) pauseMenu.scrollBy(Math.sign(e.deltaY) * 2, myConfig());
}, { passive: true });

// --- Red -----------------------------------------------------------------------

let myRole = null;
let peerInputP2 = createEmptyInputState();
let snapshotSeq = 0;
let lastAppliedSeq = -1;
let lastSnapshotAt = 0;
const HOST_STALE_MS = 1500;

const NET_LOG = new URLSearchParams(window.location.search).get('netlog') !== '0';
const netLog = (...args) => { if (NET_LOG) console.log(...args); };
const describeInput = (s) => Object.entries(s || {}).filter(([, v]) => v).map(([k]) => k).join(', ') || '(neutro)';
let lastLocalLabel = null;
let lastPeerLabel = null;

let statusMessage = 'CONECTANDO AL SERVIDOR LAN...';
let statusTimer = null;
function setStatus(message, autoClearMs) {
  statusMessage = message;
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = autoClearMs ? setTimeout(() => { statusMessage = ''; }, autoClearMs) : null;
}

const isHost = () => myRole === 'p1';

const network = new NetworkClient({
  onRoleAssigned: ({ role }) => {
    myRole = role;
    if (role === 'spectator') setStatus('MODO ESPECTADOR');
    else setStatus(`ERES ${role === 'p1' ? 'JUGADOR 1 (HOST)' : 'JUGADOR 2'} - ESPERANDO RIVAL`, 5000);
  },
  onMatchStart: () => {
    setStatus('RIVAL CONECTADO - ENTER CUANDO ESTES LISTO', 3000);
    sim.setOpponentPresent(true);
  },
  onPeerInput: ({ role, inputState }) => {
    if (role !== 'p2') return;
    peerInputP2 = sanitizeInput(inputState);
    const label = describeInput(peerInputP2);
    if (label !== lastPeerLabel) {
      lastPeerLabel = label;
      netLog(`[Net] Input recibido de P2: ${label}`);
    }
  },
  onStateSync: (incoming) => applySnapshot(incoming),
  onOpponentLeft: ({ role }) => {
    if (role === 'spectator') return;
    if (role === 'p2') peerInputP2 = createEmptyInputState();
    setStatus('EL RIVAL SE DESCONECTO');
    if (isHost()) sim.setOpponentPresent(false);
  },
});

window.addEventListener('gamepadconnected', (e) => setStatus(`MANDO CONECTADO: ${e.gamepad.id}`, 2500));

function readAndSendLocalInput() {
  const input = pollLocalInput();
  const label = describeInput(input);
  if (label !== lastLocalLabel) {
    lastLocalLabel = label;
    netLog(`[${myRole ? myRole.toUpperCase() : '??'} Local] Input: ${label}${isInputFocused() ? '' : ' (sin foco)'}`);
  }
  // p2 manda su input en CADA tick, tenga o no el foco (sin foco sale
  // neutro): así el input que guarda el host nunca se queda pegado.
  network.sendInput(input);
  lastLocalInput = input;
  return input;
}

function applySnapshot(incoming) {
  if (Number.isFinite(incoming.seq)) {
    if (incoming.seq <= lastAppliedSeq) return;
    lastAppliedSeq = incoming.seq;
  }
  lastSnapshotAt = performance.now();
  snap = incoming;
  // Mismos efectos que en la pantalla del host, con el mismo payload.
  for (const event of incoming.events || []) presentEvent(event);
}

// --- Eventos -> presentación ----------------------------------------------------
// Una sola función para host y remoto: el host la llama al drenar la
// simulación y el remoto al recibir el snapshot, con los mismos objetos.

const HIT_SFX = {
  guard: 'guard', armor: 'armor', metal: 'wrench', oil: 'barrel_slam', gas: 'gas_blast', smoke: 'smoke_kick', sonic: 'burp',
};

function hitKind(e) {
  if (e.outcome === 'shield' || e.outcome === 'shieldBreak') return 'guard';
  if (e.outcome === 'armor') return 'armor';
  if (e.outcome === 'counter') return 'smoke';
  if (e.vfx) return e.vfx;
  return e.kb > 90 ? 'heavy' : 'normal';
}

function viewOf(slot) {
  return snap.fighters.find((f) => f.slot === slot);
}

// SPECIAL ZOOM: la simulación ha predicho un K.O. sin remedio y ha alargado
// el hitlag (`e.freeze` frames). Aquí: zoom instantáneo a 1.35 sobre el punto
// de contacto, destello rojo y negro de 2 frames, rayos de cómic desde el
// impacto, y el sonido cae en seco hasta que se suelta la congelación.
const BOLTS = 9;
function makeBolts() {
  const bolts = [];
  for (let i = 0; i < BOLTS; i += 1) {
    const angle = (i / BOLTS) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
    const length = 70 + Math.random() * 60;
    const points = [];
    for (let k = 0; k <= 5; k += 1) {
      const d = 12 + (length - 12) * (k / 5);
      const jitter = k === 0 ? 0 : (Math.random() - 0.5) * 20;
      points.push({
        x: Math.cos(angle) * d - Math.sin(angle) * jitter,
        y: Math.sin(angle) * d + Math.cos(angle) * jitter,
      });
    }
    bolts.push(points);
  }
  return bolts;
}

function startLethalFx(e) {
  camera.specialZoom(e.x, e.y, e.freeze);
  lethalFx = {
    x: e.x,
    y: e.y,
    start: presentationFrame + 1,
    total: e.freeze,
    // +2: suena en el primer tick en que el mundo vuelve a moverse.
    release: e.freeze + 2,
    bolts: makeBolts(),
  };
  playSfx('special_zoom');
}

function presentHit(e) {
  const kind = hitKind(e);
  if (e.lethal) startLethalFx(e);
  if (e.impact) {
    impactFx = {
      style: e.impact, x: e.x, y: e.y, start: snap.frame,
    };
    camera.shake(10, 14);
    playSfx('ko_blast');
  }
  spawnHitEffect(e.x, e.y, kind);
  if (kind === 'gas') {
    spawnToxicBlast(e.x, e.y, e.dir);
    spawnAcidFlash(e.x, e.y);
  } else if (kind === 'oil') {
    spawnOilBurst(e.x, e.y, 10);
    spawnStyledText('oil', e.x, e.y - 40);
  } else if (kind === 'metal') {
    spawnOilBurst(e.x, e.y, 3);
  } else if (kind === 'smoke') {
    spawnCigarPuff(e.x, e.y, e.dir);
  }
  if (e.outcome === 'armor') spawnStyledText('armor', e.x, e.y - 40);
  if (e.outcome === 'bury') spawnStyledText('bury', e.x, e.y - 40);
  // Un meteoro que conecta (ángulo hacia abajo en el aire) se anuncia: es el
  // golpe que mata por abajo, y tiene que leerse como tal.
  if (e.vfx === 'gas' && e.kb > 40 && e.outcome === 'hit' && e.tumble) spawnStyledText('meteor', e.x, e.y - 56);
  // La sacudida y el sonido crecen con el knockback: un golpe que mata se
  // tiene que OÍR antes de ver al rival salir volando.
  const shake = e.outcome === 'shield' ? 2 : Math.min(14, 2 + e.kb * 0.05);
  camera.shake(shake, 10 + Math.min(20, e.kb * 0.08));
  if (e.kb > 150 && e.outcome === 'hit' && !e.lethal) {
    camera.punchIn();
    screenFlash = Math.max(screenFlash, 0.25);
  }
  const sfx = (e.outcome === 'shield' && 'guard') || (e.outcome === 'armor' && 'armor') || e.sfx
    || HIT_SFX[kind] || (e.kb > 90 ? 'hit_heavy' : (e.damage <= 4 ? 'hit_light' : 'hit_normal'));
  // Un golpe letal no suena a golpe: suena a silencio (special_zoom) y
  // estalla al soltarse la congelación.
  if (e.lethal) return;
  playSfx(sfx);
  if (e.kb > 150 && e.outcome === 'hit' && sfx !== 'hit_heavy') playSfx('hit_heavy');
}

function presentFx(e) {
  const v = viewOf(e.slot);
  const face = e.facing ?? v?.facing ?? 1;
  const mouthX = e.x + face * 18;
  const mouthY = e.y - 90;
  switch (e.fx) {
    case 'burpCone':
      spawnSonicRing(e.x, e.y - 150, { amount: 12, speed: 160 });
      break;
    case 'gasBurst':
      spawnToxicBlast(e.x, e.y, face);
      spawnGasCloud(e.x, e.y, 10);
      spawnAcidFlash(e.x, e.y);
      playSfx('gas_blast');
      break;
    case 'chairDust':
      // D-Smash: la silla contra el suelo levanta escombros y polvo a los dos lados.
      for (const side of [1, -1]) {
        spawnDebris(e.x + side * 60, e.y, 7);
        spawnDust(e.x + side * 56, e.y, side, 9);
      }
      spawnHitEffect(e.x + face * 70, e.y - 8, 'heavy');
      camera.shake(6, 12);
      break;
    case 'slamJump':
      // Up-B: el salto del abrazo aéreo, con su polvo.
      spawnDust(e.x, e.y, 0, 8);
      playSfx('jump');
      break;
    case 'slamApex':
      // Lo alto del Abrazo Aéreo: el parón antes del picado.
      spawnHitEffect(e.x + e.facing * 20, e.y - 90, 'guard');
      camera.shake(3, 6);
      playSfx('dodge');
      break;
    case 'slamWave':
      // Up-B (agarrado): el ESTAMPADO — onda de choque a los dos lados.
      for (const side of [1, -1]) {
        spawnDust(e.x + side * 40, e.y, side, 12);
        spawnDebris(e.x + side * 50, e.y, 6);
      }
      spawnSonicRing(e.x, e.y - 10, { amount: 22, speed: 260, kind: 'guard' });
      spawnLight(e.x, e.y - 20, 160, [255, 230, 180], 0.6, 12);
      camera.shake(12, 18);
      playSfx('stomp');
      playSfx('hit_heavy');
      break;
    case 'waftBlast':
      // Down-B: el PEDO ATÓMICO — nube enorme bajo el cuerpo y a los lados.
      spawnToxicJetDown(e.x, e.y);
      spawnToxicBlast(e.x + 40, e.y - 20, 1);
      spawnToxicBlast(e.x - 40, e.y - 20, -1);
      spawnGasCloud(e.x, e.y - 10, 26);
      spawnAcidFlash(e.x, e.y - 20);
      camera.shake(10, 16);
      spawnStyledText('gas', e.x, e.y - 150);
      playSfx('gas_blast');
      playSfx('burp');
      break;
    case 'stompDust':
      // D-Tilt: el pisotón contra el suelo levanta polvo y escombros.
      spawnDust(e.x + face * 34, e.y, 0, 9);
      spawnDebris(e.x + face * 34, e.y, 8);
      camera.shake(3, 8);
      break;
    case 'crankSparks':
      // F-Smash: chispas de fricción del bateo, desde la punta del cigüeñal.
      spawnSwingSparks(e.x + face * 80, e.y - 60, face, 10);
      break;
    case 'gasTrail':
      spawnGasCloud(e.x, e.y + 10, 5);
      break;
    case 'burpSmall':
      spawnSonicRing(mouthX + face * 30, mouthY + 20, { amount: 8, speed: 120 });
      break;
    case 'burpMedium':
      spawnSonicRing(mouthX + face * 40, mouthY + 20, { amount: 14, speed: 180 });
      spawnGasCloud(mouthX + face * 50, mouthY + 20, 8);
      break;
    // --- Modo Despertado ---
    case 'rhymeBars':
      // Jab: el micro escupe rimas: notas y barras de distorsión.
      spawnMusicNotes(mouthX, mouthY, 2);
      spawnSonicRing(mouthX + face * 20, mouthY + 10, { amount: 6, speed: 110, kind: 'gold' });
      break;
    case 'micCrater':
      // Microfonazo: cráter de energía dorada delante, escombros y polvo.
      spawnSonicRing(e.x + face * 70, e.y, { amount: 22, speed: 260, kind: 'gold' });
      spawnDebris(e.x + face * 70, e.y, 10);
      spawnDust(e.x + face * 70, e.y, face, 8);
      spawnDust(e.x + face * 70, e.y, -face, 8);
      spawnLight(e.x + face * 70, e.y - 20, 150, [255, 210, 90], 0.8, 14);
      camera.shake(7, 12);
      playSfx('mic_drop');
      break;
    case 'subwoofer':
      // U-Smash: cañón de ondas doradas CONCÉNTRICAS, abriéndose hacia arriba.
      for (let k = 0; k < 5; k += 1) {
        spawnSonicRing(e.x, e.y - 110 - k * 70, { amount: 8 + k * 4, speed: 110 + k * 45, kind: 'gold' });
      }
      spawnLight(e.x, e.y - 220, 200, [255, 210, 90], 0.7, 16);
      camera.shake(8, 16);
      playSfx('burp');
      break;
    case 'breakDust':
      // D-Smash: dos ondas de humo y polvo barriendo el suelo a los lados.
      for (const side of [1, -1]) {
        spawnDust(e.x + side * 56, e.y, side, 12);
        spawnGasCloud(e.x + side * 64, e.y - 12, 6, 'smoke');
      }
      camera.shake(5, 10);
      break;
    case 'gasColumn':
      // D-Air: la columna de humo verde que deja el picado.
      spawnGasCloud(e.x, e.y - 30, 5);
      break;
    case 'rhymePA':
      spawnStyledText('pa', e.x + face * 40, e.y - 130);
      playSfx('rap_beat');
      break;
    case 'rhymeTOMA':
      spawnStyledText('toma', e.x + face * 40, e.y - 130);
      playSfx('rap_beat');
      break;
    case 'nitroJet':
      // Up-B: detonación MASIVA bajo los pies.
      spawnToxicJetDown(e.x, e.y);
      spawnToxicJetDown(e.x, e.y + 10);
      spawnGasCloud(e.x, e.y + 16, 24);
      spawnAcidFlash(e.x, e.y + 10);
      spawnLight(e.x, e.y + 10, 180, [150, 255, 110], 0.8, 14);
      camera.shake(9, 14);
      playSfx('gas_blast');
      break;
    case 'burpNuclear':
      spawnSonicRing(mouthX + face * 60, mouthY + 20, { amount: 24, speed: 280 });
      spawnToxicBlast(mouthX + face * 30, mouthY + 30, face);
      spawnGasCloud(mouthX + face * 80, mouthY + 20, 18);
      spawnAcidFlash(mouthX + face * 60, mouthY + 20);
      camera.shake(10, 24);
      spawnStyledText('burp', mouthX + face * 60, mouthY - 20);
      break;
    default:
      break;
  }
}

function presentEvent(e) {
  switch (e.type) {
    case 'hit': presentHit(e); break;
    case 'fx': presentFx(e); break;
    case 'jump':
      spawnDust(e.x, e.y, 0, e.full ? 6 : 3);
      playSfx('jump');
      break;
    case 'doubleJump':
      spawnDust(e.x, e.y, 0, 4);
      playSfx('jump');
      break;
    case 'land':
      if (e.speed > 4) spawnDust(e.x, e.y, 0, e.speed > 10 ? 8 : 4);
      playSfx('land');
      break;
    case 'dash':
      spawnDust(e.x, e.y, -e.dir, 3);
      break;
    case 'dodge': playSfx('dodge'); break;
    case 'ledgeGrab':
      spawnHitEffect(e.x, e.y, 'guard');
      playSfx('ledge');
      break;
    case 'ledgeTrump':
      spawnHitEffect(e.x + e.dir * 20, e.y, 'heavy');
      spawnDust(e.x + e.dir * 20, e.y, e.dir, 6);
      spawnStyledText('trump', e.x, e.y - 70);
      camera.shake(3, 8);
      playSfx('ledge_trump');
      break;
    case 'tech':
      spawnHitEffect(e.x, e.y - 20, 'guard');
      spawnStyledText('tech', e.x, e.y - 90);
      playSfx('guard');
      break;
    case 'missedTech':
      spawnDust(e.x, e.y, 0, 9);
      playSfx('stomp');
      break;
    case 'wallBounce':
      spawnHitEffect(e.x, e.y, 'heavy');
      spawnStyledText('wallBounce', e.x, e.y - 30);
      playSfx('hit_heavy');
      break;
    case 'shieldBreak':
      spawnHitEffect(e.x, e.y, 'guard');
      spawnSonicRing(e.x, e.y, { amount: 16, speed: 200, kind: 'guard' });
      spawnStyledText('shieldBreak', e.x, e.y - 60);
      camera.shake(8, 20);
      playSfx('shield_break');
      break;
    case 'counter':
      if (e.parry) {
        // PARRY: el tiempo se congela con un fogonazo blanco y aparece a la
        // espalda del rival.
        pureFlash = 1;
        spawnStyledText('parry', e.x, e.y - 40);
        spawnSuperAura(e.x, e.y, 'gold');
        playSfx('special_zoom');
        break;
      }
      spawnCigarPuff(e.x + e.dir * 20, e.y, e.dir);
      spawnStyledText('counter', e.x, e.y - 40);
      camera.punchIn();
      playSfx('smoke_kick');
      break;
    case 'chip':
      // La nube del puro: una bocanada sobre el que se la está tragando.
      spawnGasCloud(e.x, e.y, 2, 'smoke');
      break;
    case 'battleWord':
      playSfx('rap_beat');
      playSfx('hit_heavy');
      break;
    case 'battleImpact':
      playSfx('ko_blast');
      playSfx('hit_heavy');
      break;
    case 'grab':
      playSfx('menu_move');
      // El abrazo aéreo: lo engancha en el aire.
      if (e.air) spawnHitEffect(e.x, e.y, 'heavy');
      break;
    case 'unbury': spawnDust(e.x, e.y, 0, 8); break;
    case 'chargeStart': playSfx('menu_confirm'); break;
    case 'chargeStored': spawnGasCloud(e.x, e.y - 90, 4); break;
    case 'projectileSpawn':
      if (e.kind === 'sonicWave') {
        spawnSonicRing(e.x, e.y, { amount: 20, speed: 240 });
        playSfx('mic_shout');
      } else if (e.kind === 'donutCushion') {
        playSfx('dodge');
      } else if (e.kind === 'cigarCloud') {
        spawnCigarPuff(e.x, e.y, e.dir);
        playSfx('smoke_kick');
      } else if (e.kind === 'capThrow') {
        playSfx('mic_shout');
      }
      break;
    case 'projectileBounce':
      // El donut rebota: polvo y el golpe blando del cojín.
      spawnDust(e.x, e.y, 0, 4);
      playSfx('land');
      break;
    case 'projectileBreak':
      spawnDust(e.x, e.y, 0, 6);
      spawnDebris(e.x, e.y, 6);
      playSfx('headbutt');
      break;
    case 'moveStart':
      if (e.move === 'final') {
        spawnSuperAura(e.x, e.y - 60, 'gold');
        screenFlash = 0.8;
        playSfx('ultra');
      }
      break;
    case 'finalCapture':
      // La batalla empieza en NEGRO (con su tajo): nada de fogonazo blanco.
      if (e.kind !== 'battle') pureFlash = 1;
      playSfx('ultra_catch');
      playSfx('mic_feedback', { delay: 0.1 });
      break;
    case 'cineTransform':
      spawnMusicNotes(e.x, e.y, 5);
      playSfx('mic_feedback');
      screenFlash = 0.45;
      break;
    case 'cineBeat':
      spawnMusicNotes(e.x + 46, e.y, 3);
      spawnEarBleed(e.x, e.y - 30);
      spawnSonicRing(e.x, e.y, { amount: 8, speed: 140 });
      camera.shake(3, 8);
      playSfx('rap_beat');
      break;
    case 'micDrop': playSfx('mic_drop'); break;
    case 'finalBoom':
      pureFlash = 0.9;
      spawnGasCloud(e.x, e.y + 16, 16, 'gas');
      spawnSonicRing(e.x, e.y, { amount: 26, speed: 320 });
      spawnLight(e.x, e.y, 220, [255, 240, 180], 0.9, 20);
      camera.shake(16, 30);
      playSfx('gas_blast');
      playSfx('hit_heavy');
      break;
    case 'ko': presentKo(e); break;
    case 'respawn': playSfx('menu_confirm'); break;
    case 'ready': playSfx(e.ready ? 'menu_confirm' : 'menu_cancel'); break;
    case 'pause': playSfx(e.paused ? 'menu_confirm' : 'menu_cancel'); break;
    // --- Modo Despertar (prototipo, tecla Ñ) ---
    case 'awakenStart':
      // El atlas del rapero se prepara ya (perezoso: no cuesta nada ahora, y
      // los primeros frames se rasterizan dentro de la congelación de 2 s).
      atlasFor(rosterConfigById(viewOf(e.slot)?.id), 'awakened');
      playSfx('special_zoom');
      break;
    case 'awakenCut':
      playSfx('hit_heavy');
      camera.shake(6, 12);
      break;
    case 'awakenReady':
      spawnSuperAura(e.x, e.y, 'gold');
      spawnSonicRing(e.x, e.y, { amount: 20, speed: 260, kind: 'gold' });
      spawnLight(e.x, e.y, 200, [255, 210, 90], 0.8, 18);
      camera.shake(8, 14);
      playSfx('ko_blast');
      break;
    case 'awakenEnd':
      spawnGasCloud(e.x, e.y, 10, 'smoke');
      playSfx('menu_cancel');
      break;
    case 'countdown': playSfx('countdown'); break;
    case 'phase':
      if (e.phase === PHASES.FIGHT) playSfx('fight');
      else if (e.phase === PHASES.GAME) {
        playSfx('ko');
        screenFlash = 0.8;
      } else if (e.phase === PHASES.RESULTS) playSfx('victory');
      else if (e.phase === PHASES.COUNTDOWN || e.phase === PHASES.LOBBY) resetFx();
      break;
    default:
      break;
  }
}

// DETONACIÓN DE K.O. en la coordenada exacta de cruce (la calcula la
// simulación): un cono de rayos y chispas hacia DENTRO de la pantalla, un
// pilar de luz del color del caído y un anillo de choque, con una sacudida
// corta y amortiguada (8 px, 10 frames). El punto de cruce suele quedar en el
// borde o fuera del encuadre, así que la parte de luz se dibuja en espacio de
// pantalla, pegada al borde, y las chispas nacen en el punto visible más
// cercano.
// Normal hacia el INTERIOR de la arena por cada lado de las blast zones.
const KO_INWARD = {
  left: { x: 1, y: 0 }, right: { x: -1, y: 0 }, top: { x: 0, y: 1 }, bottom: { x: 0, y: -1 },
};
const KO_BLAST_FRAMES = 42;
function presentKo(e) {
  koBlasts.push({
    x: e.x, y: e.y, side: e.side, slot: e.slot, life: 0, max: KO_BLAST_FRAMES,
  });
  camera.shake(8, 10);
  screenFlash = Math.max(screenFlash, 0.35);
  playSfx('ko_blast');
  const r = camera.viewRect();
  const px = Math.max(r.x + 4, Math.min(r.x + r.w - 4, e.x));
  const py = Math.max(r.y + 4, Math.min(r.y + r.h - 4, e.y));
  const n = KO_INWARD[e.side];
  spawnKoCone(px, py, n.x, n.y, e.slot);
  spawnHitEffect(px, py, 'heavy');
}

function resetFx() {
  clearParticles();
  clearVfx();
  clearLights();
  clearFloatingTexts();
  koBlasts.length = 0;
  lethalFx = null;
  impactFx = null;
  camera.reset();
}

// --- Ticks ---------------------------------------------------------------------

function hostTick() {
  const localInput = readAndSendLocalInput();
  sim.step({ p1: localInput, p2: peerInputP2 });
  const events = sim.drainEvents();
  snap = sim.serialize();
  for (const e of events) presentEvent(e);
  snapshotSeq += 1;
  network.sendState({ ...snap, seq: snapshotSeq, events });
}

function remoteTick() {
  if (myRole === 'p2') readAndSendLocalInput();
}

// Solo PRESENTACIÓN: partículas, cámara, animadores. Corre igual en las dos
// pantallas y no toca la simulación.
// Una mota del aura del Despertar cada tantos frames de presentación.
const AURA_EVERY = 3;
function presentationTick() {
  presentationFrame += 1;
  if (myRole === 'spectator' || !myRole) lastLocalInput = pollLocalInput();
  if (pauseMenu.update(snap.paused, lastLocalInput, myConfig())) playSfx('menu_move');
  // En pausa se congela TAMBIÉN lo que no es simulación: una chispa o una
  // nube que siguiera moviéndose delataría que el mundo no está parado.
  if (snap.paused) return;
  updateParticles(FIXED_DT);
  updateVfx(FIXED_DT);
  updateLights(FIXED_DT);
  updateFloatingTexts(FIXED_DT);
  for (const v of snap.fighters) {
    const animator = animatorFor(v);
    animator.update(FIXED_DT * (v.fast ? 2 : 1));
    // AURA del Despertar: motas doradas que suben alrededor del cuerpo. (El
    // humo del "pitillo" en reposo desapareció con el cigarro de las poses de
    // reposo: ahora solo fuma en la Pausa del Cigarro.)
    if (v.awakened && v.visible && presentationFrame % AURA_EVERY === 0) {
      spawnAuraMotes(v.x, v.y, v.bodyHeight);
    }
    // Ralentizado dentro de la nube del puro: humo pegado al cuerpo.
    if (v.slowed && v.visible && presentationFrame % 6 === 0) {
      spawnGasCloud(v.x, v.y - v.bodyHeight * 0.6, 1, 'smoke');
    }
  }
  // La cinemática se cierra en la simulación; la salida (la franja abriéndose)
  // es de la presentación.
  if (cutinWasOn && !snap.cutin) cutinExit = 0;
  cutinWasOn = !!snap.cutin;
  if (cutinExit !== null && !snap.cutin) {
    cutinExit += 1;
    if (cutinExit > CUTIN_EXIT_FRAMES) cutinExit = null;
  }
  const focus = snap.cine
    ? { views: snap.fighters.filter((f) => f.slot === snap.cine.attacker || f.slot === snap.cine.victim) }
    : null;
  camera.update(snap.fighters, focus);
  spawnLaunchTrails();
  if (lethalFx) {
    lethalFx.release -= 1;
    if (lethalFx.release === 0) {
      playSfx('hit_heavy');
      playSfx('ko_blast');
      screenFlash = Math.max(screenFlash, 0.3);
      lethalFx = null;
    }
  }
  for (let i = koBlasts.length - 1; i >= 0; i -= 1) {
    koBlasts[i].life += 1;
    if (koBlasts[i].life >= koBlasts[i].max) koBlasts.splice(i, 1);
  }
  screenFlash = Math.max(0, screenFlash - 0.05);
  pureFlash = Math.max(0, pureFlash - 0.06);
}

// ESTELA DE LANZAMIENTO: humo denso y chispas a lo largo del tramo que ha
// recorrido el cuerpo en el frame, mientras la vista diga que vuela sin
// control tras un golpe de KB > 38. Con KB > 60, teñida del color del que
// golpeó. En el hitlag no: el cuerpo está quieto y el humo se amontonaría.
const TRAIL_MIN_SPEED = 1.5;
const SLOT_RGB = Object.fromEntries(Object.entries(SLOT_COLORS).map(([slot, hex]) => [slot,
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))]));
function spawnLaunchTrails() {
  if (snap.hitlag > 0) return;
  for (const v of snap.fighters) {
    if (!v.visible || !v.trail) continue;
    const vx = v.vx ?? 0;
    const vy = v.vy ?? 0;
    if (Math.hypot(vx, vy) < TRAIL_MIN_SPEED) continue;
    const cy = v.y - v.bodyHeight / 2;
    const tinted = v.trail === 2 && SLOT_RGB[v.trailBy];
    spawnTrailSmoke(v.x - vx, cy - vy, v.x, cy, tinted ? SLOT_RGB[v.trailBy] : null);
    spawnTrailSparks(v.x, cy, vx, vy, tinted ? v.trailBy : 'heavy', tinted ? 3 : 2);
  }
}

let lastSimTime = performance.now();
let accumulator = 0;

function simulationTick() {
  const now = performance.now();
  // El tope de 0.25s acota el "catch-up" tras un estrangulamiento del reloj.
  accumulator += Math.min(0.25, (now - lastSimTime) / 1000);
  lastSimTime = now;
  while (accumulator >= FIXED_DT) {
    if (isHost()) hostTick();
    else if (myRole) remoteTick();
    presentationTick();
    accumulator -= FIXED_DT;
  }
}

const clock = createSimulationClock({ intervalMs: 1000 / 60, onTick: simulationTick });
if (!clock.backgroundSafe) netLog('[Net] AVISO: sin Web Worker; la simulación se estrangulará en segundo plano.');

// --- Dibujado ------------------------------------------------------------------

function currentStatus() {
  const stale = !isHost() && myRole && lastAppliedSeq >= 0 && performance.now() - lastSnapshotAt > HOST_STALE_MS;
  if (stale) return 'SIN DATOS DEL HOST - LA PESTANA DE P1 PUEDE ESTAR PARADA';
  return statusMessage;
}

// Todo en polígonos y rectángulos alineados con la normal: sin rotate(), que
// el banco de pruebas no rasteriza (y así la detonación se puede MEDIR).
const KO_RAYS = 11;
const KO_CONE = 35 * (Math.PI / 180);
const KO_RING_CELLS = 64;
const easeOut = (t) => 1 - (1 - t) * (1 - t);

function fillBand(g, x, y, n, len, width) {
  if (n.x !== 0) g.fillRect(n.x > 0 ? x : x - len, y - width / 2, len, width);
  else g.fillRect(x - width / 2, n.y > 0 ? y : y - len, width, len);
}

function drawKoBlasts() {
  for (const b of koBlasts) {
    const t = b.life / b.max;
    const k = 1 - t;
    const p = camera.worldToScreen(b.x, b.y);
    const x = Math.max(0, Math.min(VIEWPORT_W, p.x));
    const y = Math.max(0, Math.min(VIEWPORT_H, p.y));
    const n = KO_INWARD[b.side];
    const color = SLOT_COLORS[b.slot] || '#ffffff';
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // Pilar de luz: se dispara hacia dentro y se estrecha al apagarse.
    const along = n.x !== 0 ? VIEWPORT_W : VIEWPORT_H;
    const len = along * (0.3 + 0.45 * Math.min(1, t * 5));
    ctx.globalAlpha = 0.75 * k;
    ctx.fillStyle = color;
    fillBand(ctx, x, y, n, len, 130 * k);
    ctx.fillStyle = '#ffffff';
    fillBand(ctx, x, y, n, len * 0.85, 40 * k);
    // Cono: rayos triangulares desde el punto de cruce, ±35° de la normal.
    const base = Math.atan2(n.y, n.x);
    const half = 8 * k + 1;
    ctx.globalAlpha = 0.9 * k;
    for (let i = 0; i < KO_RAYS; i += 1) {
      const a = base + ((i / (KO_RAYS - 1)) * 2 - 1) * KO_CONE;
      const reach = (150 + 330 * easeOut(t)) * (i % 2 ? 0.65 : 1);
      const px = -Math.sin(a) * half;
      const py = Math.cos(a) * half;
      ctx.fillStyle = i % 2 ? color : '#fff4c2';
      ctx.beginPath();
      ctx.moveTo(x + px, y + py);
      ctx.lineTo(x + Math.cos(a) * reach, y + Math.sin(a) * reach);
      ctx.lineTo(x - px, y - py);
      ctx.closePath();
      ctx.fill();
    }
    // Anillo de choque: celdas de pixel art sobre una circunferencia que se
    // expande (solo la mitad que queda hacia dentro de la pantalla).
    const radius = 30 + 460 * easeOut(t);
    const cell = Math.max(2, Math.round(10 * k));
    ctx.fillStyle = t < 0.4 ? '#ffffff' : color;
    for (let i = 0; i < KO_RING_CELLS; i += 1) {
      const a = (i / KO_RING_CELLS) * Math.PI * 2;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      if (dx * n.x + dy * n.y < -0.05) continue;
      ctx.fillRect(Math.round(x + dx * radius - cell / 2), Math.round(y + dy * radius - cell / 2), cell, cell);
    }
    ctx.restore();
  }
}

// Destello del Special Zoom: el primer frame ROJO, el segundo NEGRO (encima de
// todo el mundo, debajo del HUD), y los rayos de cómic encima del destello.
function drawLethalFx() {
  if (!lethalFx) return;
  const age = presentationFrame - lethalFx.start;
  if (age === 0 || age === 1) {
    ctx.save();
    ctx.fillStyle = age === 0 ? 'rgba(210, 18, 28, 0.6)' : 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(0, 0, VIEWPORT_W, VIEWPORT_H);
    ctx.restore();
  }
  if (age < 0 || age >= lethalFx.total) return;
  // Destellos: a partir del quinto frame, uno de cada cuatro no se pinta.
  if (age > 4 && age % 4 === 3) return;
  const grow = Math.min(1, (age + 1) / 3);
  ctx.save();
  camera.apply(ctx);
  for (const bolt of lethalFx.bolts) {
    const last = Math.max(1, Math.round((bolt.length - 1) * grow));
    for (const [width, color] of [[8, '#ffe14a'], [3, '#ffffff']]) {
      ctx.fillStyle = color;
      for (let i = 0; i < last; i += 1) {
        const a = bolt[i];
        const b2 = bolt[i + 1];
        const len = Math.hypot(b2.x - a.x, b2.y - a.y) || 1;
        const nx = (-(b2.y - a.y) / len) * (width / 2);
        const ny = ((b2.x - a.x) / len) * (width / 2);
        ctx.beginPath();
        ctx.moveTo(lethalFx.x + a.x + nx, lethalFx.y + a.y + ny);
        ctx.lineTo(lethalFx.x + b2.x + nx, lethalFx.y + b2.y + ny);
        ctx.lineTo(lethalFx.x + b2.x - nx, lethalFx.y + b2.y - ny);
        ctx.lineTo(lethalFx.x + a.x - nx, lethalFx.y + a.y - ny);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

function render(fps) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = getStageSafetyColor();
  ctx.fillRect(0, 0, VIEWPORT_W, VIEWPORT_H);
  ctx.restore();

  drawBackdrop(ctx, camera, VIEWPORT);

  const views = snap.fighters;
  ctx.save();
  camera.apply(ctx);
  drawStage(ctx);
  for (const v of views) {
    if (v.respawning) drawRespawnPlatform(ctx, v.x, v.y, presentationFrame);
  }
  drawGroundLayer(ctx);
  for (const v of views) {
    const floor = v.grounded ? { y: v.y } : surfaceBelow(geometry, v.x, v.y);
    drawShadow(ctx, v, floor?.y);
  }
  for (const v of views) drawFighter(ctx, v, animatorFor(v), presentationFrame);
  drawProjectiles(ctx);
  drawAirLayer(ctx);
  drawParticles(ctx);
  drawLights(ctx);
  drawFloatingTexts(ctx);
  ctx.restore();

  // IMPACT FRAMES: tapan el mundo (siluetas planas) durante su tramo.
  if (impactFx) {
    const drawn = drawImpactFrame(ctx, {
      style: impactFx.style,
      age: snap.frame - impactFx.start,
      views,
      animatorFor,
      camera,
      geometry,
      point: impactFx,
      viewport: VIEWPORT,
    });
    if (!drawn && snap.frame - impactFx.start > 0) impactFx = null;
  }
  drawLethalFx();
  drawKoBlasts();
  drawOffscreenBubbles(ctx, views, animators, camera, VIEWPORT);
  if (snap.cine) {
    if (snap.cine.kind !== 'battle') drawCinematicFrame(ctx, snap.cine, VIEWPORT);
  } else {
    drawPercentPanels(ctx, views, animators, presentationFrame);
    drawControlsBar(ctx, VIEWPORT_W, { role: myRole, focused: isInputFocused(), muted: isAudioMuted() });
  }
  drawFlowOverlay(ctx, snap, VIEWPORT, { mySlot: myRole });
  // LA BATALLA DE GALLOS DEFINITIVA (Final Smash despertado): a pantalla
  // completa, por encima de todo.
  if (snap.cine?.kind === 'battle') {
    const attackerView = viewOf(snap.cine.attacker);
    const victimView = viewOf(snap.cine.victim);
    const spec = finalSpecOf(rosterConfigById(attackerView?.id), 'battle');
    if (spec && attackerView && victimView) {
      drawBattleFinale(ctx, {
        frame: snap.cine.frame,
        spec,
        attacker: animatorFor(attackerView),
        victim: animatorFor(victimView),
        victimAnim: victimView.anim,
        viewport: VIEWPORT,
      });
    }
  }
  // Cinemática de corte del Despertar (y su salida), por encima del HUD.
  if (snap.cutin) drawAwakenCutin(ctx, { frame: snap.cutin.frame, viewport: VIEWPORT });
  else if (cutinExit !== null) drawAwakenCutin(ctx, { frame: 120, exit: cutinExit, viewport: VIEWPORT });
  if (snap.paused) {
    pauseMenu.draw(ctx, {
      viewport: VIEWPORT, config: myConfig(), pausedBy: snap.pausedBy, mySlot: myRole, frame: presentationFrame,
    });
  }
  if (!snap.cine && !snap.paused && !snap.cutin && cutinExit === null) drawStatusMessage(ctx, VIEWPORT_W, currentStatus());
  drawScreenFlash(ctx, VIEWPORT_W, VIEWPORT_H, screenFlash);
  drawScreenFlash(ctx, VIEWPORT_W, VIEWPORT_H, pureFlash, { pure: true });
  drawDebugOverlay(ctx, VIEWPORT_W, VIEWPORT_H, { views, fps, snap });
}

// Proyectiles: dibujados aquí porque son pocos y simples. El bloque de motor
// es un bloque gris con su filo; la nube de gas y la onda son anillos
// translúcidos que laten.
function drawProjectiles(g) {
  for (const p of snap.projectiles) {
    const kind = PROJECTILE_KINDS[p.kind];
    const x = Math.round(p.x - kind.w / 2);
    const y = Math.round(p.y - kind.h / 2);
    g.save();
    if (p.kind === 'donutCushion') {
      drawDonutProjectile(g, p);
    } else if (p.kind === 'cigarCloud') {
      drawCigarCloud(g, p, kind);
    } else if (p.kind === 'capThrow') {
      drawCapThrow(g, p);
    } else if (p.kind === 'nitroBlast') {
      drawNitroBlast(g, p, kind);
    } else if (p.kind === 'sonicWave') {
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 3; i += 1) {
        g.fillStyle = i === 0 ? 'rgba(216, 255, 143, 0.55)' : 'rgba(126, 217, 87, 0.3)';
        const off = ((p.age * 4 + i * 14) % 42) * p.dir;
        g.fillRect(Math.round(p.x - off - 4), y + i * 6, 8, kind.h - i * 12);
      }
    }
    g.restore();
  }
}

let lastFrameTime = performance.now();
let fpsSmoothed = 60;
function renderLoop(now) {
  const frameTime = Math.max(1e-4, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  fpsSmoothed += (1 / frameTime - fpsSmoothed) * 0.1;
  render(fpsSmoothed);
  requestAnimationFrame(renderLoop);
}
requestAnimationFrame(renderLoop);

// Referencia para depurar desde la consola del navegador.
window.__mafia = {
  sim, camera, animators, get snap() { return snap; },
};
