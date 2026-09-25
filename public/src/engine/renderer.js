// Dibujo del luchador a partir de su VISTA (ver Fighter#view): un objeto plano
// que el host construye cada tick y manda tal cual por red. Host y cliente
// remoto pasan por esta misma función con el mismo objeto, así que las dos
// pantallas dibujan exactamente lo mismo sin que el remoto conozca la máquina
// de estados.
//
// El sprite sale del atlas (SpriteAnimator); nada de aquí toca la física: la
// deformación, el giro del tumble y los destellos son transformaciones de
// DIBUJO ancladas a los pies, después de que la simulación haya terminado.

import {
  trackPresentation, computeSquash, outlineColorFor, OUTLINE_WIDTH,
} from './characterRenderer.js';

const PIXEL_UNIT = 2;
const snap = (v) => Math.round(v / PIXEL_UNIT) * PIXEL_UNIT;

// Destello al recibir daño: la SILUETA EXACTA del sprite teñida de rojo (ver
// SpriteAnimator.drawSilhouetteTint para por qué no es una caja).
const HIT_FLASH_COLOR = '#ff2222';
const HIT_FLASH_ALPHA = 0.85;
// Carga de smash: parpadeo amarillo sobre la silueta, el aviso clásico de
// "esto va a doler".
const CHARGE_FLASH_COLOR = '#fff3a0';
// Armadura pesada aguantando un golpe.
const ARMOR_FLASH_COLOR = '#ffc14b';

// Parpadeo de intangibilidad (borde, respawn, esquivas).
const INVULN_ALPHA_LOW = 0.4;
const INVULN_ALPHA_HIGH = 0.78;

// Tinte de cada jugador en la burbuja de escudo y en los indicadores.
export const SLOT_COLORS = { p1: '#ff5a4a', p2: '#4a9dff' };

const FALLBACK_LOOP_FRAMES = 27;

function fighterAlpha(view, frame) {
  if (!view.intangible) return 1;
  return Math.floor(frame / 4) % 2 === 0 ? INVULN_ALPHA_HIGH : INVULN_ALPHA_LOW;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} view       vista del luchador
 * @param {SpriteAnimator} animator
 * @param {number} frame      frame de presentación (parpadeos)
 */
// AURA del Modo Despertar, en tres capas (todas solo mientras la vista diga
// que está despertado):
//   1. LLAMAS procedurales rojas y doradas que suben por el cuerpo con
//      ondulación senoidal: la mayoría DETRÁS del sprite y alguna lengua
//      translúcida DELANTE, para que el fuego lo envuelva.
//   2. El contorno: la silueta en dorado estampada alrededor, parpadeante.
//   3. ESTELAS FANTASMA al correr o atacar: copias planas rojas y doradas de
//      los frames recientes que se quedan atrás y se apagan.
export function awakenAura(view, frame) {
  if (!view.awakened) return null;
  const beat = Math.sin(frame * 0.35);
  return {
    color: Math.floor(frame / 5) % 4 === 0 ? '#fff1a8' : '#ffc233',
    alpha: 0.4 + 0.2 * beat,
    spread: 2,
  };
}

const FLAME_TONGUES = 16;
const FLAME_COLORS = ['#e8231f', '#ff6a1a', '#ffc233', '#fff1a8']; // base -> punta
const stepAlpha = (a) => Math.max(0, Math.min(1, Math.ceil(a * 4) / 4));

/**
 * Llamas del Despertar alrededor del cuerpo. `layer`: 'back' (detrás del
 * sprite) o 'front' (unas pocas lenguas translúcidas por delante). Pixel art:
 * celdas de 2 px, 4 tonos de la base a la punta y alfa escalonado.
 */
export function drawAwakenFlames(ctx, view, frame, layer = 'back') {
  if (!view.awakened || !view.visible) return;
  const bodyH = view.bodyHeight ?? 108;
  ctx.save();
  for (let i = 0; i < FLAME_TONGUES; i += 1) {
    const front = i % 4 === 1;
    if ((layer === 'front') !== front) continue;
    const u = i / (FLAME_TONGUES - 1);
    const off = Math.abs(u - 0.5);
    const bx = view.x + (u - 0.5) * 74;
    const by = view.y - 4 - off * 34 - ((i * 37) % 11);
    // Cada lengua crece y encoge a su ritmo; las del centro, más altas.
    const hgt = bodyH * (0.7 + 0.45 * (0.5 + 0.5 * Math.sin(frame * 0.21 + i * 1.9))) * (1 - off * 0.55);
    const maxW = 13 - off * 7;
    for (let k = 0; k < hgt; k += PIXEL_UNIT) {
      const t = k / hgt;
      const sway = Math.sin(k * 0.09 - frame * 0.32 + i * 1.3) * (1.5 + k * 0.08);
      const width = Math.max(PIXEL_UNIT, maxW * (1 - t) ** 0.75);
      ctx.globalAlpha = stepAlpha((front ? 0.35 : 0.85) * (1 - t * 0.7));
      ctx.fillStyle = FLAME_COLORS[Math.min(3, Math.floor(t * 4))];
      ctx.fillRect(snap(bx + sway - width / 2), snap(by - k), Math.max(PIXEL_UNIT, snap(width)), PIXEL_UNIT);
    }
  }
  ctx.restore();
}

// Estelas fantasma: por ranura, los frames recientes (qué se veía y dónde).
const GHOST_EVERY = 2;
const GHOST_LIFE = 10;
const GHOST_STATES = new Set(['dash', 'run', 'action']);
const ghosts = new Map();

function updateGhosts(view, animator, frame) {
  let list = ghosts.get(view.slot);
  if (!list) {
    list = [];
    ghosts.set(view.slot, list);
  }
  while (list.length && frame - list[0].born > GHOST_LIFE) list.shift();
  if (!view.awakened) {
    list.length = 0;
    return list;
  }
  const last = list[list.length - 1];
  const moved = !last || Math.hypot(last.x - view.x, last.y - view.y) > 3 || last.snap.anim !== animator.currentAnim;
  if (GHOST_STATES.has(view.state) && frame % GHOST_EVERY === 0 && moved) {
    list.push({
      snap: animator.snapshot(), x: view.x, y: view.y, facing: view.flip ? -view.facing : view.facing, born: frame,
    });
  }
  return list;
}

/** Dibuja (detrás del luchador) sus estelas fantasma del Despertar. */
export function drawAwakenGhosts(ctx, view, animator, frame) {
  const list = updateGhosts(view, animator, frame);
  list.forEach((g, i) => {
    const age = frame - g.born;
    if (age <= 0) return; // la de este mismo frame es el propio luchador
    animator.drawSnapshot(ctx, g.snap, g.x, g.y, g.facing, {
      tint: i % 2 === 0 ? '#ff3a2a' : '#ffc233',
      alpha: stepAlpha(0.5 * (1 - age / GHOST_LIFE)),
    });
  });
}

export function drawFighter(ctx, view, animator, frame) {
  if (!animator || !view.visible) return;
  trackPresentation(view);
  drawAwakenFlames(ctx, view, frame, 'back');
  const squash = computeSquash(view);
  const anim = animator.animations[view.anim];

  if (anim?.progressDriven) {
    const progress = view.progress >= 0
      ? view.progress
      : (frame % FALLBACK_LOOP_FRAMES) / FALLBACK_LOOP_FRAMES;
    animator.playAtProgress(view.anim, progress);
  } else {
    animator.play(view.anim);
  }
  drawAwakenGhosts(ctx, view, animator, frame);

  // Enterrado: el sprite se hunde en la losa hasta la cintura. Se recorta
  // contra la superficie para que no asome por debajo del hormigón.
  const sink = view.buried ? view.bodyHeight * 0.55 : 0;

  ctx.save();
  if (view.buried) {
    ctx.beginPath();
    ctx.rect(view.x - 200, view.y - 400, 400, 400);
    ctx.clip();
  }
  // Tumble: el cuerpo GIRA sobre su centro (sección 2.C). Es una rotación de
  // dibujo alrededor del centro del cuerpo, no de los pies.
  if (view.spin) {
    const cy = view.y - view.bodyHeight / 2;
    ctx.translate(view.x, cy);
    ctx.rotate(view.spin);
    ctx.translate(-view.x, -cy);
  }
  const charging = view.charge > 0 && Math.floor(frame / 3) % 2 === 0;
  const armored = view.armorFlash > 0;
  let flashColor = null;
  let flashAlpha = 0;
  if (view.hitFlash > 0) {
    flashColor = HIT_FLASH_COLOR;
    flashAlpha = HIT_FLASH_ALPHA;
  } else if (armored) {
    flashColor = ARMOR_FLASH_COLOR;
    flashAlpha = 0.7;
  } else if (charging) {
    flashColor = CHARGE_FLASH_COLOR;
    flashAlpha = 0.25 + view.charge * 0.45;
  } else if (view.helpless) {
    flashColor = '#1a1a24';
    flashAlpha = 0.35;
  } else if (view.chargeShot >= 3 && Math.floor(frame / 4) % 2 === 0) {
    flashColor = '#c8f57e';
    flashAlpha = 0.45;
  }

  const facing = view.flip ? -view.facing : view.facing;
  animator.draw(ctx, view.x, view.y + sink, facing, {
    flashing: !!flashColor,
    flashColor: flashColor || HIT_FLASH_COLOR,
    flashAlpha,
    alpha: fighterAlpha(view, frame),
    outline: outlineColorFor(view),
    outlineWidth: OUTLINE_WIDTH,
    squashX: squash.x,
    squashY: squash.y,
    aura: awakenAura(view, frame),
  });
  ctx.restore();
  drawAwakenFlames(ctx, view, frame, 'front');

  if (view.shield >= 0) drawShield(ctx, view);
  if (view.dizzy) drawDizzyStars(ctx, view, frame);
}

// Burbuja de escudo: se ENCOGE con la vida que le queda (sección 3). Se
// compone por filas de 2 px como la sombra: un círculo vectorial con el borde
// suavizado canta al lado del pixel art.
function drawShield(ctx, view) {
  const radius = 62 * (0.35 + 0.65 * Math.max(0, view.shield));
  const cx = view.x;
  const cy = view.y - view.bodyHeight * 0.5;
  const color = SLOT_COLORS[view.slot] || '#ffffff';
  ctx.save();
  ctx.globalAlpha = 0.42;
  ctx.fillStyle = color;
  const rows = Math.round((radius * 2) / PIXEL_UNIT);
  for (let i = 0; i < rows; i += 1) {
    const t = (i / (rows - 1)) * 2 - 1;
    const w = radius * Math.sqrt(Math.max(0, 1 - t * t)) * 2;
    ctx.fillRect(snap(cx - w / 2), snap(cy - radius) + i * PIXEL_UNIT, snap(w), PIXEL_UNIT);
  }
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(snap(cx - radius * 0.45), snap(cy - radius * 0.7), snap(radius * 0.3), PIXEL_UNIT * 2);
  ctx.restore();
}

function drawDizzyStars(ctx, view, frame) {
  const cy = view.y - view.bodyHeight - 10;
  ctx.save();
  ctx.fillStyle = '#ffe066';
  for (let i = 0; i < 3; i += 1) {
    const a = frame * 0.12 + (i * Math.PI * 2) / 3;
    ctx.fillRect(snap(view.x + Math.cos(a) * 22), snap(cy + Math.sin(a) * 6), 4, 4);
  }
  ctx.restore();
}

/**
 * Sombra de contacto sobre la superficie que hay DEBAJO del luchador (la losa
 * o una semisólida). Se encoge y se apaga con la distancia; si no hay suelo
 * debajo (fuera del escenario), no hay sombra — que es también un aviso.
 */
export function drawShadow(ctx, view, surfaceY) {
  if (!view.visible || surfaceY == null || view.buried) return;
  const dist = Math.max(0, surfaceY - view.y);
  if (dist > 320) return;
  const k = 1 - dist / 320;
  const halfW = 22 * (0.45 + 0.55 * k);
  const halfH = 5 * (0.5 + 0.5 * k);
  ctx.save();
  ctx.fillStyle = `rgba(0, 0, 0, ${0.4 * k})`;
  const rows = Math.max(1, Math.round((halfH * 2) / PIXEL_UNIT));
  for (let i = 0; i < rows; i += 1) {
    const t = rows === 1 ? 0 : (i / (rows - 1)) * 2 - 1;
    const w = halfW * Math.sqrt(Math.max(0, 1 - t * t)) * 2;
    if (w < PIXEL_UNIT) continue;
    ctx.fillRect(snap(view.x - w / 2), snap(surfaceY - halfH) + i * PIXEL_UNIT, snap(w), PIXEL_UNIT);
  }
  ctx.restore();
}

/**
 * Destello de pantalla completa. `pure` es blanco sin tinte (corte de la
 * cinemática); si no, dos pasadas de color como un fogonazo de recreativa.
 */
export function drawScreenFlash(ctx, width, height, alpha, { pure = false } = {}) {
  const a = Math.min(1, alpha);
  if (a <= 0) return;
  ctx.fillStyle = `rgba(255, 255, 255, ${a})`;
  ctx.fillRect(0, 0, width, height);
  if (!pure && a > 0.45) {
    ctx.fillStyle = `rgba(255, 226, 138, ${(a - 0.45) * 0.8})`;
    ctx.fillRect(0, 0, width, height);
  }
}
