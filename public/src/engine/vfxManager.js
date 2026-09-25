// Gestor de efectos VOLUMÉTRICOS y de decorados persistentes.
//
// Convive con `engine/particles.js` y no lo sustituye: el reparto es por
// papel, no por tecnología.
//   - particles.js  -> chispas de impacto. Celdas de 2px snapeadas a rejilla,
//                      paletas de 4 tonos, vida corta. Es pixel art.
//   - vfxManager.js -> masas de gas y humo, y charcos que se quedan en el
//                      asfalto. Es volumen y permanencia. Las masas se pintan
//                      como DISCOS en rejilla de 2px, en capas (borde, cuerpo,
//                      casquete de luz), con alfa escalonado en 4 pasos: con
//                      degradados radiales vectoriales se leían como una capa
//                      de otro juego pegada encima del pixel art.
// Mezclarlos en un módulo daría un sistema que no es ni una cosa ni la otra.
//
// TRES REGLAS que sostienen el módulo:
//
// 1. POOL FIJO, CERO ASIGNACIONES EN EL BUCLE. Las 250 ranuras se reservan al
//    cargar el módulo y se reciclan. Un sistema de partículas que hace
//    `new` por impacto produce picos de recolección justo en el frame del
//    golpe, que es el peor momento posible para un tirón.
// 2. DOS PASADAS DE DIBUJADO. Los charcos van DEBAJO de los luchadores
//    (`drawGroundLayer`) y el gas y el humo ENCIMA (`drawAirLayer`). Con una
//    sola pasada, o el aceite flota sobre las botas o el gas queda escondido
//    detrás del cuerpo.
// 3. EL SUELO ES LA SUPERFICIE QUE HAY DEBAJO, no un número suelto. Una gota que aterriza donde
//    no pisan los luchadores delata el efecto al instante.

import { surfaceBelow } from './physics.js';
import { getGeometry } from './stage.js';

/**
 * Ranura del pool. Siempre existe; `active` dice si está en uso.
 * @typedef {Object} VfxSlot
 * @property {boolean} active
 * @property {string}  kind    'core' | 'motes' | 'smoke' | 'oil' | 'puddle' | 'trail'
 * @property {number[]|null} tint  rgb de la estela teñida (solo 'trail')
 * @property {number}  x
 * @property {number}  y
 * @property {number}  vx      px/s
 * @property {number}  vy      px/s (negativo = sube)
 * @property {number}  life    segundos vividos
 * @property {number}  maxLife segundos totales
 * @property {number}  r0      radio inicial
 * @property {number}  r1      radio final
 * @property {number}  seed    fase propia, para que no oscilen al unísono
 * @property {number}  gravity px/s²
 */

const POOL_SIZE = 250;

/** @type {VfxSlot[]} */
const pool = [];
for (let i = 0; i < POOL_SIZE; i += 1) {
  pool.push({
    active: false, kind: 'core', x: 0, y: 0, vx: 0, vy: 0,
    life: 0, maxLife: 1, r0: 0, r1: 0, seed: 0, gravity: 0,
  });
}
let cursor = 0;

// Toma la siguiente ranura libre. Si TODAS están ocupadas reutiliza la más
// antigua en vez de crecer: un tope que se salta a sí mismo no es un tope.
function take() {
  for (let n = 0; n < POOL_SIZE; n += 1) {
    const slot = pool[cursor];
    cursor = (cursor + 1) % POOL_SIZE;
    if (!slot.active) return slot;
  }
  const slot = pool[cursor];
  cursor = (cursor + 1) % POOL_SIZE;
  return slot;
}

function emit(props) {
  const s = take();
  s.active = true;
  s.life = 0;
  s.vx = 0;
  s.vy = 0;
  s.gravity = 0;
  s.r0 = 0;
  s.r1 = 0;
  s.seed = Math.random() * Math.PI * 2;
  s.tint = null;
  Object.assign(s, props);
  return s;
}

// --- Escala ---------------------------------------------------------------
// Las cifras de diseño de una nube (120-180px de diámetro) están escritas en
// px de pantalla de 1280. El mundo ya mide 1280, pero los CUERPOS no crecieron
// (siguen siendo 108 px), y una nube se mide contra el cuerpo al que tiene que
// tapar, no contra el ancho de pantalla. Se conserva la proporción que ya
// estaba calibrada contra un cuerpo de 108: 0.375 (= 480/1280), o sea nubes
// de ~67 px, algo más de medio cuerpo.
const ESCALA = 0.375;
const px = (v) => v * ESCALA;

// ==========================================================================
// A) NUBE TÓXICA VOLUMÉTRICA
// ==========================================================================

const GAS_EXPAND_FRAMES = 20;
const GAS_R0 = px(20);
const GAS_R1 = px(85);

/** @param {number} x @param {number} y @param {number} dir */
export function spawnToxicBlast(x, y, dir = 1) {
  // CUATRO núcleos desfasados, no uno grande: una sola circunferencia se lee
  // como un círculo dibujado, y cuatro solapados como una masa. Se reparten
  // hacia delante porque el gas sale del personaje, no lo envuelve.
  for (let i = 0; i < 4; i += 1) {
    emit({
      kind: 'core',
      x: x + dir * px(14) * i + (Math.random() - 0.5) * px(10),
      y: y - px(6) * i + (Math.random() - 0.5) * px(8),
      vx: dir * (8 + Math.random() * 14),
      vy: -6 - Math.random() * 8,
      maxLife: GAS_EXPAND_FRAMES / 60,
      r0: GAS_R0,
      r1: GAS_R1,
    });
  }
  // Mota pixelada en suspensión: lo que impide que la masa se lea como un
  // degradado vectorial pegado encima del pixel art.
  for (let i = 0; i < 16; i += 1) {
    emit({
      kind: 'motes',
      x: x + dir * Math.random() * px(70) + (Math.random() - 0.5) * px(30),
      y: y + (Math.random() - 0.5) * px(46),
      vy: -48, // -0.8 px/f
      maxLife: 0.7 + Math.random() * 0.5,
      r0: Math.random() < 0.5 ? 3 : 4,
    });
  }
}

// ==========================================================================
// B) HUMO DEL CIGARRO
// ==========================================================================

/** Voluta suelta: la del idle, una cada cuatro frames. */
export function spawnCigarWisp(x, y) {
  emit({
    kind: 'smoke',
    x,
    y,
    vy: -66, // -1.1 px/f
    maxLife: 40 / 60,
    r0: 3,
    r1: 10,
  });
}

/** Bocanada cónica hacia delante: la de los remates con cigarro. */
export function spawnCigarPuff(x, y, dir = 1) {
  for (let i = 0; i < 9; i += 1) {
    const t = i / 8;
    emit({
      kind: 'smoke',
      x: x + dir * px(80) * t * (0.4 + Math.random() * 0.6),
      y: y + (Math.random() - 0.5) * px(26) * t,
      vx: dir * (30 + Math.random() * 40),
      vy: -18 - Math.random() * 20,
      // Flota hacia arriba y se abre: las bocanadas grandes y lentas son las
      // que se leen como humo a esta distancia.
      maxLife: 0.7 + Math.random() * 0.4,
      r0: 4 + t * 4,
      r1: 12 + t * 9,
    });
  }
}

/**
 * CHORRO DE GAS HACIA ABAJO (Up-B): la detonación que catapulta a Samuel.
 * Núcleos densos que salen disparados hacia el suelo, frenan y se abren, en
 * verde y amarillo ácido, y luego caen despacio (el gas pesa).
 */
export function spawnToxicJetDown(x, y) {
  for (let i = 0; i < 7; i += 1) {
    emit({
      kind: 'core',
      x: x + (Math.random() - 0.5) * 18,
      y: y + i * 5,
      vx: (Math.random() - 0.5) * 70,
      vy: 150 + Math.random() * 90 - i * 10,
      gravity: -260, // frena en seco y queda casi quieto
      maxLife: (26 + i * 2) / 60,
      r0: 8,
      r1: 24 + Math.random() * 10,
    });
  }
  for (let i = 0; i < 14; i += 1) {
    emit({
      kind: 'motes',
      x: x + (Math.random() - 0.5) * 40,
      y: y + Math.random() * 30,
      vy: 20 + Math.random() * 30,
      maxLife: 0.6 + Math.random() * 0.4,
      r0: Math.random() < 0.5 ? 2 : 4,
    });
  }
}

// ==========================================================================
// C) ACEITE Y CHARCOS PERSISTENTES
// ==========================================================================

const PUDDLE_LIFE = 240 / 60;   // 4 segundos en el asfalto
const PUDDLE_FADE = 30 / 60;    // se apaga en el último medio segundo
const PUDDLE_RX = px(14);
const PUDDLE_RY = px(3.5);

/** @param {number} x @param {number} y @param {number} cantidad */
export function spawnOilBurst(x, y, cantidad = 11) {
  for (let i = 0; i < cantidad; i += 1) {
    const ang = -Math.PI * (0.18 + Math.random() * 0.64); // hacia ARRIBA
    const sp = 90 + Math.random() * 150;
    emit({
      kind: 'oil',
      x,
      y,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      gravity: 900, // pesado: es un líquido, no una chispa
      maxLife: 2.2,
      r0: 2 + Math.random() * 2,
    });
  }
}

// ==========================================================================
// D) ESTELA DE HUMO DE UN LANZAMIENTO
// ==========================================================================

// Humo DENSO: más opaco y grande que el del cigarro, y casi quieto (se queda
// donde pasó el cuerpo). Con `tint` (rgb) toma el color del jugador que
// golpeó: es la estela de un golpe de más de 60 de knockback.
const TRAIL_SMOKE_LIFE = 0.5;

/**
 * Un puñado de humo a lo largo del tramo recorrido en este frame, para que la
 * estela salga CONTINUA aunque el cuerpo vaya a 15 px/f.
 * @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1
 * @param {number[]|null} tint  [r, g, b] o null (humo gris)
 */
export function spawnTrailSmoke(x0, y0, x1, y1, tint = null) {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const puffs = Math.max(1, Math.ceil(dist / 7));
  for (let i = 0; i < puffs; i += 1) {
    const t = (i + 1) / puffs;
    emit({
      kind: 'trail',
      x: x0 + (x1 - x0) * t + (Math.random() - 0.5) * 6,
      y: y0 + (y1 - y0) * t + (Math.random() - 0.5) * 6,
      vx: (Math.random() - 0.5) * 12,
      vy: -8 - Math.random() * 10,
      maxLife: TRAIL_SMOKE_LIFE * (0.8 + Math.random() * 0.4),
      r0: 7,
      r1: 17,
      tint,
    });
  }
}

// ==========================================================================
// SIMULACIÓN
// ==========================================================================

/** @param {number} dt segundos */
export function updateVfx(dt) {
  for (const s of pool) {
    if (!s.active) continue;
    s.life += dt;

    if (s.kind === 'puddle') {
      if (s.life >= s.maxLife) s.active = false;
      continue; // un charco no se mueve
    }

    if (s.kind === 'motes') {
      // Oscilación sinusoidal en X: el gas no sube recto, serpentea.
      s.x += Math.sin(s.life * 15 + s.seed) * 1.5 * 60 * dt;
      s.y += s.vy * dt;
    } else {
      s.vy += s.gravity * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.kind === 'smoke' || s.kind === 'trail') s.x += Math.sin(s.life * 7 + s.seed) * 14 * dt;
    }

    // CONVERSIÓN A CHARCO. El aceite que toca el asfalto deja de ser una gota
    // y pasa a ser una mancha estática: se para en seco, se aplana y aguanta
    // cuatro segundos. Es lo que convierte un golpe en un rastro en el
    // escenario en vez de en un destello que no deja nada.
    // La gota se posa en la superficie que haya DEBAJO de ella (la losa o una
    // semisólida), no en una línea fija: fuera del escenario cae al vacío.
    const suelo = s.kind === 'oil' ? surfaceBelow(getGeometry(), s.x, s.y - s.vy * dt - 1) : null;
    if (suelo && s.y >= suelo.y) {
      s.kind = 'puddle';
      s.y = suelo.y;
      s.vx = 0;
      s.vy = 0;
      s.gravity = 0;
      s.life = 0;
      s.maxLife = PUDDLE_LIFE;
      continue;
    }

    if (s.life >= s.maxLife) s.active = false;
  }
}

export function clearVfx() {
  for (const s of pool) s.active = false;
}

/** Cuántas ranuras hay en uso. Solo para el panel de debug y los tests. */
export function activeVfxCount() {
  let n = 0;
  for (const s of pool) if (s.active) n += 1;
  return n;
}

export const VFX_POOL_SIZE = POOL_SIZE;

// ==========================================================================
// DIBUJADO, en dos pasadas
// ==========================================================================

/** Charcos: por DEBAJO de los luchadores, o el aceite flotaría sobre las botas. */
export function drawGroundLayer(ctx) {
  for (const s of pool) {
    if (!s.active || s.kind !== 'puddle') continue;
    const restante = s.maxLife - s.life;
    const alpha = restante < PUDDLE_FADE ? restante / PUDDLE_FADE : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, PUDDLE_RX, PUDDLE_RY, 0, 0, Math.PI * 2);
    ctx.fill();
    // Reflejo del farol en el charco: dos celdas claras descentradas. Sin
    // esto la mancha se confunde con una sombra.
    ctx.fillStyle = '#2d2d2d';
    ctx.fillRect(Math.round(s.x - PUDDLE_RX * 0.4), Math.round(s.y - 1), 4, 1);
    ctx.restore();
  }
}

// Alfa en 4 escalones: fundido de pixel art, no degradado continuo.
function stepAlpha(a) {
  return Math.max(0, Math.min(1, Math.ceil(a * 4) / 4));
}

// Disco relleno en rejilla de 2px, fila a fila.
function fillDisc(ctx, cx, cy, r) {
  const u = 2;
  const snap = (v) => Math.round(v / u) * u;
  for (let dy = -r; dy <= r; dy += u) {
    const half = Math.sqrt(Math.max(0, r * r - dy * dy));
    const w = snap(half * 2);
    if (w < u) continue;
    ctx.fillRect(snap(cx - half), snap(cy + dy), w, u);
  }
}

// Masa con volumen: borde oscuro, cuerpo y casquete de luz arriba-izquierda.
function drawMass(ctx, x, y, r, alpha, [edge, body, light]) {
  ctx.globalAlpha = stepAlpha(alpha);
  ctx.fillStyle = edge;
  fillDisc(ctx, x, y, r);
  ctx.fillStyle = body;
  fillDisc(ctx, x - r * 0.08, y - r * 0.1, r * 0.78);
  ctx.globalAlpha = stepAlpha(alpha * 0.9);
  ctx.fillStyle = light;
  fillDisc(ctx, x - r * 0.3, y - r * 0.35, r * 0.38);
  ctx.globalAlpha = 1;
}

/** Gas, humo, brasas y gotas en vuelo: por ENCIMA de los luchadores. */
export function drawAirLayer(ctx) {
  for (const s of pool) {
    if (!s.active) continue;
    const t = Math.min(1, s.life / s.maxLife);

    if (s.kind === 'core') {
      // Gas tóxico: verde ácido con el corazón amarillo, denso al nacer.
      const r = Math.max(2, s.r0 + (s.r1 - s.r0) * (1 - (1 - t) * (1 - t)));
      drawMass(ctx, s.x, s.y, r, 0.95 * (1 - t), ['#2f9e1c', '#57e82a', '#d8ff5a']);
      continue;
    }

    if (s.kind === 'motes') {
      // Cúbicas y snapeadas a la rejilla: son las que atan la masa al pixel
      // art. Sin ellas el gradiente se ve como una capa de otro juego.
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = t < 0.5 ? '#39ff14' : '#76ff03';
      ctx.fillRect(Math.round(s.x), Math.round(s.y), s.r0, s.r0);
      ctx.globalAlpha = 1;
      continue;
    }

    if (s.kind === 'smoke') {
      // Humo de cigarro: gris azulado claro, sube y se abre desvaneciéndose.
      const r = Math.max(2, s.r0 + (s.r1 - s.r0) * t);
      drawMass(ctx, s.x, s.y, r, 0.8 * (1 - t), ['#8f8c86', '#c9c6bf', '#eeebe4']);
      continue;
    }

    if (s.kind === 'trail') {
      // Estela de un lanzamiento: gris, o teñida del color de quien golpeó.
      const r = Math.max(2, s.r0 + (s.r1 - s.r0) * t);
      const core = s.tint ? s.tint : [205, 200, 190];
      const rim = core.map((c) => Math.round(c * 0.5));
      const light = core.map((c) => Math.min(255, Math.round(c * 1.15 + 20)));
      drawMass(ctx, s.x, s.y, r, 0.85 * (1 - t), [`rgb(${rim.join(',')})`, `rgb(${core.join(',')})`, `rgb(${light.join(',')})`]);
      continue;
    }

    if (s.kind === 'ember') {
      ctx.fillStyle = '#ff9900';
      ctx.fillRect(Math.round(s.x) - 3, Math.round(s.y) - 3, 6, 6);
      ctx.fillStyle = '#ff3300';
      ctx.fillRect(Math.round(s.x) - 2, Math.round(s.y) - 2, 4, 4);
      continue;
    }

    if (s.kind === 'oil') {
      ctx.fillStyle = t < 0.5 ? '#2d2d2d' : '#1a1a1a';
      const w = Math.round(s.r0);
      ctx.fillRect(Math.round(s.x), Math.round(s.y), w, w);
    }
  }
}
