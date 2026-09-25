// Utilidad de dirección de arte: vuelca la CINEMÁTICA DE CORTE del Modo
// Despertar (tecla Ñ) en sus momentos clave, encima de un frame real de la
// arena, para MIRARLA.
//
//   node tests/renderCutin.mjs [salida.png]
//
// Momentos: el tajo de entrada (1, 2) y su fogonazo (4), la fase 1 (30), la
// micro-congelación cromática (58, 59), el golpe de zoom con el estallido de
// la estrella (61, 64, 68), la fase 2 (100) y la salida (la franja
// abriéndose hacia los lados).

import { createCanvas, installDom, writePng } from './fakeCanvas.mjs';

installDom();

const { drawAwakenCutin } = await import('../public/src/engine/awakenCutin.js');

const out = process.argv[2] || 'tests/_cutin.png';
const W = 1280;
const H = 720;
const SHOTS = [{ frame: 1 }, { frame: 2 }, { frame: 4 }, { frame: 30 }, { frame: 58 }, { frame: 59 }, { frame: 61 }, { frame: 64 }, { frame: 68 }, { frame: 100 }, { frame: 120, exit: 5 }, { frame: 120, exit: 9 }];
const COLS = 4;
const S = 0.5;
const sheet = createCanvas(W * S * COLS, H * S * Math.ceil(SHOTS.length / COLS));
const sctx = sheet.getContext('2d');
SHOTS.forEach((shot, i) => {
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  // Fondo de "juego": cielo, fachada y losa, para juzgar el oscurecido.
  ctx.fillStyle = '#b9c7d6';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#5a7fbf';
  ctx.fillRect(280, 250, 990, 200);
  ctx.fillStyle = '#8a8478';
  ctx.fillRect(300, 430, 690, 40);
  drawAwakenCutin(ctx, { frame: shot.frame, exit: shot.exit ?? null, viewport: { w: W, h: H } });
  sctx.drawImage(c, (i % COLS) * W * S, Math.floor(i / COLS) * H * S, W * S, H * S);
});
writePng(out, sheet);
console.log(`escrito ${out}`);
