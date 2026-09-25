// Utilidad de dirección de arte: vuelca los EFECTOS (chispas de impacto,
// humo, gas, ondas, aceite, polvo) fotograma a fotograma para MIRARLOS.
//
//   node tests/renderVfx.mjs [salida.png]
//
// Cada fila es un efecto tal y como lo lanza main.js al presentar un evento, y
// cada columna un instante tras lanzarlo (en frames de 60 Hz), sobre el tono
// del hormigón de la losa. Mismas funciones y mismo dibujado que en partida.

import { createCanvas, installDom, writePng } from './fakeCanvas.mjs';

installDom();

const P = await import('../public/src/engine/particles.js');
const V = await import('../public/src/engine/vfxManager.js');

const out = process.argv[2] || 'tests/_vfx.png';
const TIMES = [1, 3, 6, 10, 16, 24, 36];
const CELL = 140;
const SCALE = 3;
const X = 70;
const Y = 80;

const ROWS = [
  ['golpe normal', () => P.spawnHitEffect(X, Y, 'normal')],
  ['golpe fuerte', () => P.spawnHitEffect(X, Y, 'heavy')],
  ['golpe de llave (metal)', () => P.spawnHitEffect(X, Y, 'metal')],
  ['escudo', () => P.spawnHitEffect(X, Y, 'guard')],
  ['humo del cigarro', () => V.spawnCigarPuff(X - 30, Y, 1)],
  ['gas del Up-B (hacia abajo)', () => { V.spawnToxicJetDown(X, Y - 40); P.spawnGasCloud(X, Y - 24, 14); }],
  ['eructo nuclear', () => { P.spawnSonicRing(X - 20, Y, { amount: 24, speed: 280 }); V.spawnToxicBlast(X - 40, Y + 10, 1); P.spawnGasCloud(X, Y, 18); }],
  ['aceite del bidón', () => P.spawnHitEffect(X, Y, 'oil')],
  ['polvo del pisotón', () => { P.spawnDust(X, Y + 30, 0, 9); P.spawnDebris(X, Y + 30, 8); }],
  ['chispas del cigüeñal', () => P.spawnSwingSparks(X - 40, Y, 1, 10)],
];

const sheet = createCanvas(TIMES.length * CELL * SCALE, ROWS.length * CELL * SCALE);
const sctx = sheet.getContext('2d');
sctx.imageSmoothingEnabled = false;

ROWS.forEach(([, spawn], row) => {
  P.clearParticles();
  V.clearVfx();
  spawn();
  let t = 0;
  for (const [col, frame] of TIMES.entries()) {
    while (t < frame) {
      P.updateParticles(1 / 60);
      V.updateVfx(1 / 60);
      t += 1;
    }
    const cell = createCanvas(CELL, CELL);
    const ctx = cell.getContext('2d');
    ctx.fillStyle = (row + col) % 2 ? '#8a8478' : '#837d71';
    ctx.fillRect(0, 0, CELL, CELL);
    ctx.fillStyle = '#6d675d';
    ctx.fillRect(0, Y + 30, CELL, 1); // "suelo" de referencia
    V.drawGroundLayer(ctx);
    P.drawParticles(ctx);
    V.drawAirLayer(ctx);
    sctx.drawImage(cell, col * CELL * SCALE, row * CELL * SCALE, CELL * SCALE, CELL * SCALE);
  }
});

writePng(out, sheet);
console.log(`escrito ${out}: ${ROWS.map((r) => r[0]).join(', ')}`);
