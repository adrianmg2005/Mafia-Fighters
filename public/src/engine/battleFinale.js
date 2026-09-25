// "LA BATALLA DE GALLOS DEFINITIVA": la cinemática del Final Smash del Modo
// Despertado, en espacio de pantalla y por encima de todo.
//
// Es presentación pura, función del frame de la cinemática (`sim.cine.frame`)
// y de la spec del Final Smash (los frames de las rimas y del impacto salen de
// la moveTable, no de aquí): las dos pantallas ven lo mismo. La aleatoriedad
// (chispas, ladrillos) sale de un RNG sembrado. El daño y el K.O. los decide
// la simulación (Simulation#tickBattle); aquí solo se cuenta.
//
// Línea de tiempo (240 frames):
//   0-11     NEGRO con un TAJO ROJO diagonal que cruza la pantalla.
//   12-59    PLANO 1: la calle de noche (muro de ladrillo, grafiti, asfalto,
//            el público en sombra) y un FOCO que cae desde arriba sobre el
//            rival aturdido, en el centro de la batalla.
//   60-109   PLANO 2: Samuel entra por la derecha con la pose de la foto
//            (piernas abiertas, el micro dorado a la boca, señalando).
//   110-189  PLANO 3: tres RIMAS gigantes (PUNCHLINE, FLOW, TOMA) salen del
//            micro y golpean al rival en `pulseFrames` (fogonazo y sacudida).
//   190-227  PLANO FINAL: salta al aire y cae con el microfonazo...
//   228-230  ...IMPACT FRAME: fondo blanco, las dos siluetas en negro (el
//            del medio, invertido) y chispas carmesí.
//   231-240  la detonación: anillos dorados y el fogonazo que se apaga.

import { drawPixelText, measurePixelText } from './pixelFont.js';
import { makeRng } from './pixelGrid.js';

export const BATTLE_WORDS = ['PUNCHLINE!', 'FLOW!', 'TOMA!'];
export const BATTLE_SLASH_FRAMES = 12;
export const BATTLE_ENTRANCE = 60;
export const BATTLE_FINALE = 190;
const WORD_FLIGHT = 14; // frames que vuela cada rima hasta el rival
const SCALE = 3; // los luchadores, a x3
const GROUND = 604; // línea del asfalto
const VICTIM_X = 470;
const SAMUEL_X = 860;
const CRIMSON = '#c8102e';
const GOLD = '#ffd24a';

const clamp01 = (t) => Math.max(0, Math.min(1, t));
const easeOut = (t) => 1 - (1 - t) * (1 - t);

// --- escenario de la batalla -------------------------------------------------

function drawStreet(ctx, w, h) {
  const r = makeRng(7);
  // Cielo de noche.
  ctx.fillStyle = '#0b0a18';
  ctx.fillRect(0, 0, w, h);
  // Muro de ladrillo, fila a fila con el aparejo desplazado.
  const wallTop = 150;
  for (let y = wallTop, row = 0; y < GROUND; y += 20, row += 1) {
    for (let x = -((row % 2) * 30); x < w; x += 60) {
      ctx.fillStyle = r() < 0.5 ? '#3b1d1d' : '#331818';
      ctx.fillRect(x + 2, y + 2, 56, 16);
    }
  }
  ctx.fillStyle = '#241010';
  ctx.fillRect(0, wallTop - 8, w, 8); // albardilla del muro
  // Grafiti: la palabra de la batalla, en fucsia con sombra azul.
  drawPixelText(ctx, 'GALLOS', w / 2 + 6, 214 + 6, { scale: 12, color: '#2f5fc4', shadow: false, align: 'center' });
  drawPixelText(ctx, 'GALLOS', w / 2, 214, { scale: 12, color: '#ff2d8f', shadow: false, align: 'center' });
  // Asfalto con su línea amarilla.
  ctx.fillStyle = '#1b1b22';
  ctx.fillRect(0, GROUND, w, h - GROUND);
  ctx.fillStyle = '#6b5a1a';
  for (let x = 0; x < w; x += 80) ctx.fillRect(x, GROUND + 50, 44, 6);
  // El público en sombra, delante: cabezas y hombros.
  ctx.fillStyle = '#050508';
  for (let x = -20; x < w + 40; x += 46) {
    const bob = Math.round(r() * 14);
    ctx.fillRect(x, h - 58 + bob, 40, 60);
    ctx.fillRect(x + 8, h - 82 + bob, 24, 26);
  }
}

// Foco que CAE desde arriba sobre el rival: el cono crece hacia abajo del
// frame 12 al 40; fuera de él, la calle en penumbra.
function drawSpotlight(ctx, f, w, h) {
  const grow = easeOut(clamp01((f - BATTLE_SLASH_FRAMES) / 28));
  const bottom = GROUND * grow;
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';
  const halfTop = 40;
  const halfBottom = 40 + 130 * grow;
  for (const [alpha, widen] of [[0.16, 1], [0.12, 0.7]]) {
    ctx.fillStyle = `rgba(255, 236, 190, ${alpha})`;
    ctx.beginPath();
    ctx.moveTo(VICTIM_X - halfTop * widen, 0);
    ctx.lineTo(VICTIM_X + halfTop * widen, 0);
    ctx.lineTo(VICTIM_X + halfBottom * widen, bottom);
    ctx.lineTo(VICTIM_X - halfBottom * widen, bottom);
    ctx.closePath();
    ctx.fill();
  }
  if (grow >= 1) {
    // La mancha de luz en el suelo.
    ctx.fillStyle = 'rgba(255, 236, 190, 0.22)';
    ctx.fillRect(VICTIM_X - 170, GROUND - 6, 340, 16);
  }
  ctx.restore();
}

// --- luchadores ----------------------------------------------------------------

function drawAt(ctx, animator, anim, progress, x, y, facing, tint = null) {
  if (!animator) return;
  if (progress >= 0) animator.playAtProgress(anim, progress);
  else animator.play(anim);
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(SCALE, SCALE);
  animator.draw(ctx, 0, 0, facing, tint ? { tint } : {});
  ctx.restore();
}

// Dónde está Samuel (x, y de los pies) y con qué pose en el frame `f`.
function samuelAt(f, spec) {
  const enter = easeOut(clamp01((f - BATTLE_ENTRANCE) / 30));
  let x = 1280 + 160 + (SAMUEL_X - 1280 - 160) * enter;
  let y = GROUND;
  let anim = 'battlestance';
  let progress = (f % 24) / 24;
  if (f >= BATTLE_FINALE) {
    // Salta hacia el rival y cae con el microfonazo justo en el impacto.
    const land = spec.impactFrame;
    const t = clamp01((f - BATTLE_FINALE) / (land - BATTLE_FINALE));
    x = SAMUEL_X + (VICTIM_X + 150 - SAMUEL_X) * t;
    y = GROUND - Math.sin(Math.PI * t) * 260;
    anim = 'micslam';
    progress = t < 0.8 ? 0.2 : 0.4;
    if (f >= land) {
      // Recién pasado el golpe (0.52): la pose del microfonazo SIN su estela
      // translúcida, que en las siluetas del impact frame quedaría gris.
      x = VICTIM_X + 150;
      y = GROUND;
      progress = 0.52;
    }
  }
  return { x, y, anim, progress };
}

// --- rimas ------------------------------------------------------------------------

function drawWord(ctx, word, x, y, scale, alpha = 1) {
  const width = measurePixelText(word, scale);
  const left = Math.round(x - width / 2);
  const off = Math.max(2, Math.round(scale / 2));
  drawPixelText(ctx, word, left + off, Math.round(y) + off, {
    scale, color: CRIMSON, shadow: false, alpha,
  });
  drawPixelText(ctx, word, left, Math.round(y), {
    scale, color: GOLD, shadow: false, alpha,
  });
}

/** Qué rima está en pantalla en el frame `f` y dónde: { word, x, y, scale, hit }. */
export function wordAt(f, spec) {
  for (let i = spec.pulseFrames.length - 1; i >= 0; i -= 1) {
    const hitAt = spec.pulseFrames[i];
    const start = hitAt - WORD_FLIGHT;
    if (f < start || f > hitAt + 10) continue;
    const mouth = { x: SAMUEL_X - 40, y: GROUND - 330 };
    const target = { x: VICTIM_X, y: GROUND - 250 };
    if (f < hitAt) {
      const t = (f - start) / WORD_FLIGHT;
      return {
        word: BATTLE_WORDS[i], x: mouth.x + (target.x - mouth.x) * t, y: mouth.y + (target.y - mouth.y) * t - Math.sin(Math.PI * t) * 60, scale: 6 + Math.round(3 * t), hit: false,
      };
    }
    return {
      word: BATTLE_WORDS[i], x: target.x, y: target.y - (f - hitAt) * 3, scale: 9 + Math.floor((f - hitAt) / 3), hit: true, age: f - hitAt,
    };
  }
  return null;
}

// --- impacto final ------------------------------------------------------------------

// Chispas carmesí sembradas: salen del rival en abanico, más lejos cada frame.
function drawCrimsonSparks(ctx, cx, cy, k, amount = 70) {
  const r = makeRng(41);
  ctx.fillStyle = CRIMSON;
  for (let i = 0; i < amount; i += 1) {
    const a = r() * Math.PI * 2;
    const d = 40 + r() * 140 + k * 90;
    const size = r() < 0.3 ? 10 : 6;
    ctx.fillRect(Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d * 0.7), size, size);
  }
}

/**
 * Dibuja la cinemática en su frame.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} o
 * @param {number} o.frame      frame de la cinemática (0..cinematicFrames)
 * @param {object} o.spec       finalSmash de la moveTable (pulseFrames, impactFrame)
 * @param {object} o.attacker   animador de Samuel (atlas del rapero)
 * @param {object} o.victim     animador del rival
 * @param {string} [o.victimAnim]  pose del rival (la de su vista)
 * @param {{w: number, h: number}} o.viewport
 */
export function drawBattleFinale(ctx, {
  frame, spec, attacker, victim, victimAnim = 'stagger', viewport,
}) {
  const { w, h } = viewport;
  const f = frame;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;

  // 0-11: negro y el tajo rojo en diagonal.
  if (f < BATTLE_SLASH_FRAMES) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
    const t = (f + 1) / BATTLE_SLASH_FRAMES;
    const x0 = w * 0.78;
    const x1 = w * 0.22;
    for (const [color, half] of [[CRIMSON, 26], ['#ff5566', 12], ['#ffffff', 4]]) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x0 - half, 0);
      ctx.lineTo(x0 + half, 0);
      ctx.lineTo(x0 + (x1 - x0) * t + half, h * t);
      ctx.lineTo(x0 + (x1 - x0) * t - half, h * t);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  const impact = spec.impactFrame;
  const mono = f >= impact && f < impact + 3;
  const s = samuelAt(f, spec);
  if (mono) {
    // IMPACT FRAME: blanco con las siluetas en negro (el del medio invertido).
    const inverted = f === impact + 1;
    ctx.fillStyle = inverted ? '#000000' : '#ffffff';
    ctx.fillRect(0, 0, w, h);
    const sil = inverted ? '#ffffff' : '#000000';
    drawAt(ctx, victim, 'hitstun', 0.5, VICTIM_X, GROUND, 1, sil);
    drawAt(ctx, attacker, s.anim, s.progress, s.x, s.y, -1, sil);
    drawCrimsonSparks(ctx, VICTIM_X, GROUND - 170, f - impact);
    ctx.restore();
    return;
  }

  drawStreet(ctx, w, h);
  drawSpotlight(ctx, f, w, h);

  // El rival, aturdido bajo el foco; tiembla y encaja cada rima.
  const word = wordAt(f, spec);
  const struck = word?.hit && word.age < 6;
  const shake = struck ? (word.age % 2 === 0 ? 8 : -8) : 0;
  drawAt(ctx, victim, struck || f > impact ? 'hitstun' : victimAnim, struck || f > impact ? 0.5 : -1, VICTIM_X + shake, GROUND, 1);

  if (f >= BATTLE_ENTRANCE) drawAt(ctx, attacker, s.anim, s.progress, s.x, s.y, -1);

  if (word) {
    drawWord(ctx, word.word, word.x, word.y, word.scale, word.hit ? Math.max(0, 1 - word.age / 11) : 1);
    if (word.hit && word.age < 2) {
      ctx.fillStyle = `rgba(255, 255, 255, ${word.age === 0 ? 0.5 : 0.25})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  // Título del plano 1.
  if (f < BATTLE_ENTRANCE) {
    drawWord(ctx, 'BATALLA DE GALLOS', w / 2, 40, 5);
    drawWord(ctx, 'DEFINITIVA', w / 2, 92, 4);
  }

  // Detonación: anillos dorados y el fogonazo que se apaga.
  if (f >= impact + 3) {
    const k = f - impact - 3;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let ring = 0; ring < 3; ring += 1) {
      const rad = 40 + (k + ring * 3) * 34;
      ctx.fillStyle = ring === 0 ? '#ffffff' : GOLD;
      for (let a = 0; a < Math.PI * 2; a += 0.08) {
        ctx.fillRect(Math.round(VICTIM_X + Math.cos(a) * rad), Math.round(GROUND - 170 + Math.sin(a) * rad * 0.6), 8, 8);
      }
    }
    ctx.restore();
    drawCrimsonSparks(ctx, VICTIM_X, GROUND - 170, 3 + k);
    ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0, 0.6 - k * 0.07)})`;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}
