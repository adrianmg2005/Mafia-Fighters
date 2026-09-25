// Utilidad de dirección de arte: vuelca a PNG el SPRITE de un luchador para
// MIRARLO (y para sacarlo del juego con fondo transparente).
//
//   node tests/renderSprite.mjs [salida.png]
//
// Escribe dos archivos:
//   - <salida>.png          muestrario de poses ampliado x4, sobre el tono del
//                           hormigón de la losa (donde se juega) y sobre el
//                           cielo del fondo, para juzgar el contorno.
//   - <salida>-idle.png     el idle a x4 con fondo TRANSPARENTE, listo para
//                           usar fuera del juego (avatar, cartel...).
//
// Es el mismo rasterizador que hornea el atlas (drawPixelFighter), con las
// mismas poses: lo que se ve aquí es lo que sale en partida.

import { createCanvas, installDom, writePng } from './fakeCanvas.mjs';

installDom();

const { drawPixelFighter } = await import('../public/src/engine/pixelFighterArt.js');
const { computePoseForKind } = await import('../public/src/engine/poseLibrary.js');
const { FIGHTER_WIDTH: W, FIGHTER_HEIGHT: H } = await import('../public/src/characters/fighter.js');
const { samuelConfig } = await import('../public/src/characters/samuel.js');

const out = process.argv[2] || 'tests/_sprite.png';
const base = out.replace(/\.png$/i, '');
const SCALE = 4;
const PAD = 16;
const art = samuelConfig.art;

const POSES = [
  ['idle', { t: 0 }], ['idle', { t: 0.6 }], ['walk-fwd', { t: 0.3 }], ['jump', { rising: true }],
  ['jab', { progress: 0.5 }], ['crankswing', { progress: 0.6 }], ['crouch', {}], ['hitstun', { progress: 0.5 }],
];

// Un frame del luchador en su propio canvas (fondo transparente), pies en y=H.
function frame(kind, opts) {
  const c = createCanvas(W + PAD * 2, H + PAD * 2);
  const ctx = c.getContext('2d');
  ctx.translate(PAD, PAD);
  drawPixelFighter(ctx, { w: W, h: H, art, pose: computePoseForKind(kind, { h: H, kit: art, ...opts }) });
  return c;
}

const cellW = (W + PAD * 2) * SCALE;
const cellH = (H + PAD * 2) * SCALE;
const sheet = createCanvas(cellW * POSES.length, cellH * 2);
const sctx = sheet.getContext('2d');
sctx.imageSmoothingEnabled = false;
// Fila de arriba: hormigón de la losa. Fila de abajo: cielo claro del fondo.
sctx.fillStyle = '#8a8478';
sctx.fillRect(0, 0, sheet.width, cellH);
sctx.fillStyle = '#b9c7d6';
sctx.fillRect(0, cellH, sheet.width, cellH);
POSES.forEach(([kind, opts], i) => {
  const f = frame(kind, opts);
  for (const row of [0, 1]) sctx.drawImage(f, i * cellW, row * cellH, cellW, cellH);
});
writePng(`${base}.png`, sheet);

const idle = createCanvas(cellW, cellH);
const ictx = idle.getContext('2d');
ictx.imageSmoothingEnabled = false;
ictx.drawImage(frame('idle', { t: 0 }), 0, 0, cellW, cellH);
writePng(`${base}-idle.png`, idle);
console.log(`escrito ${base}.png (${POSES.length} poses) y ${base}-idle.png (transparente)`);
