// Utilidad de dirección de arte y de frame data: vuelca cada ATAQUE de Samuel
// frame a frame con sus HITBOXES encima, para comprobar que la caja activa
// está donde está el arma o el miembro que golpea.
//
//   node tests/renderMoves.mjs [salida.png] [id1,id2,...] [--despertado]
//
// Con --despertado vuelca la tabla del MODO DESPERTADO con el aspecto del
// rapero (npm run moves:despertado:png).
//
// Cada fila es un movimiento y cada columna un frame de juego elegido: dos de
// arranque, el primer y el último frame ACTIVO, y tres de recuperación. El
// frame del sprite se elige EXACTAMENTE como en partida (atlas horneado +
// SpriteAnimator.playAtProgress con el progreso del movimiento), así que si
// aquí la caja no cae sobre la herramienta, en el juego tampoco.
//   rojo    hitbox activa en ese frame (magenta si es un sweetspot: la
//           primera de su grupo, que es la que gana)
//   azul    hurtbox del cuerpo (52x108)

import { createCanvas, installDom, writePng } from './fakeCanvas.mjs';

installDom();

const { buildFighterAtlas, animationsForMoveTable } = await import('../public/src/engine/spriteAtlasBuilder.js');
const { SpriteAnimator } = await import('../public/src/engine/spriteAnimator.js');
const { samuelConfig } = await import('../public/src/characters/samuel.js');
const { rosterVictimPoses } = await import('../public/src/characters/roster.js');
const { movePhase } = await import('../public/src/engine/movePhase.js');

const awake = process.argv.includes('--despertado');
const args = process.argv.slice(2).filter((a) => a !== '--despertado');
const out = args[0] || (awake ? 'tests/_moves-despertado.png' : 'tests/_moves.png');
const table = awake ? samuelConfig.awakened.moveTable : samuelConfig.moveTable;
const DEFAULT_IDS = awake
  ? ['jab', 'jab_finisher', 'fsmash', 'usmash', 'dsmash', 'fair', 'dair', 'nspecial', 'sspecial', 'uspecial', 'dspecial', 'dspecial_hit', 'final']
  : ['jab', 'jab2', 'jab_rapid', 'jab_finisher', 'ftilt', 'utilt', 'dtilt', 'dashattack',
    'fsmash', 'usmash', 'dsmash', 'nair', 'fair', 'bair', 'uair', 'dair',
    'nspecial_l3', 'sspecial', 'uspecial', 'dspecial', 'dspecial_hit'];
const ids = (args[1] ? args[1].split(',') : DEFAULT_IDS).filter((id) => table[id]);

const atlas = buildFighterAtlas({
  art: samuelConfig.art,
  color: samuelConfig.color,
  animations: animationsForMoveTable(table, rosterVictimPoses()),
  outfit: awake ? 'awakened' : 'normal',
});
const animator = new SpriteAnimator(atlas);

const COLS = 7;
const CELL_W = 220;
const CELL_H = 190;
const SCALE = 2;
const FEET_X = 70; // pies del luchador dentro de la celda (mira a la derecha)
const FEET_Y = 150;

function pickFrames(move) {
  const n = move.frames;
  const boxes = (move.hitboxes || []).filter((hb) => !hb.grab);
  if (!boxes.length) {
    return Array.from({ length: COLS }, (_, i) => Math.round((i / (COLS - 1)) * (n - 1)));
  }
  const first = Math.min(...boxes.map((hb) => hb.from));
  const last = Math.max(...boxes.map((hb) => hb.to));
  const rec = n - last;
  return [
    Math.max(0, Math.round(first * 0.3)), Math.max(0, first - 2), first, last,
    Math.min(n - 1, last + Math.round(rec / 3)), Math.min(n - 1, last + Math.round((rec * 2) / 3)), n - 1,
  ];
}

const sheet = createCanvas(COLS * CELL_W * SCALE, ids.length * CELL_H * SCALE);
const sctx = sheet.getContext('2d');
sctx.imageSmoothingEnabled = false;
sctx.fillStyle = '#8a8478';
sctx.fillRect(0, 0, sheet.width, sheet.height);

ids.forEach((id, row) => {
  const move = table[id];
  pickFrames(move).forEach((f, col) => {
    const cell = createCanvas(CELL_W, CELL_H);
    const ctx = cell.getContext('2d');
    ctx.fillStyle = (row + col) % 2 ? '#8a8478' : '#837d71';
    ctx.fillRect(0, 0, CELL_W, CELL_H);
    // Suelo y hurtbox.
    ctx.fillStyle = '#6d675d';
    ctx.fillRect(0, FEET_Y, CELL_W, 1);
    ctx.fillStyle = 'rgba(80, 150, 255, 0.35)';
    ctx.fillRect(FEET_X - 26, FEET_Y - 108, 52, 1);
    ctx.fillRect(FEET_X - 26, FEET_Y - 108, 1, 108);
    ctx.fillRect(FEET_X + 25, FEET_Y - 108, 1, 108);
    // Sprite, con el frame que elegiría el juego.
    animator.playAtProgress(move.pose, movePhase(move, f));
    animator.draw(ctx, FEET_X, FEET_Y, move.flipSprite ? -1 : 1);
    // Hitboxes activas en este frame de juego.
    const seen = new Set();
    for (const hb of move.hitboxes || []) {
      if (f < hb.from || f > hb.to || hb.grab) continue;
      const group = hb.group ?? 'main';
      const sweet = !seen.has(group) && (move.hitboxes || []).filter((o) => (o.group ?? 'main') === group).length > 1;
      seen.add(group);
      const x = FEET_X + hb.x - hb.w / 2;
      const y = FEET_Y + hb.y - hb.h / 2;
      ctx.fillStyle = sweet ? 'rgba(255, 40, 220, 0.35)' : 'rgba(255, 40, 40, 0.33)';
      ctx.fillRect(x, y, hb.w, hb.h);
      ctx.fillStyle = sweet ? '#ff28dc' : '#ff2828';
      ctx.fillRect(x, y, hb.w, 1);
      ctx.fillRect(x, y + hb.h - 1, hb.w, 1);
      ctx.fillRect(x, y, 1, hb.h);
      ctx.fillRect(x + hb.w - 1, y, 1, hb.h);
    }
    // Rótulo: id y frame (con la fuente del juego no hace falta: una barra de
    // progreso arriba dice en qué punto del movimiento estamos).
    ctx.fillStyle = '#2a2622';
    ctx.fillRect(0, 0, CELL_W, 5);
    ctx.fillStyle = f >= Math.min(...(move.hitboxes || [{ from: Infinity }]).map((hb) => hb.from))
      && f <= Math.max(...(move.hitboxes || [{ to: -1 }]).map((hb) => hb.to)) ? '#ff4040' : '#e8e2d4';
    ctx.fillRect(0, 0, Math.round((CELL_W * f) / move.frames), 5);
    sctx.drawImage(cell, col * CELL_W * SCALE, row * CELL_H * SCALE, CELL_W * SCALE, CELL_H * SCALE);
  });
});

writePng(out, sheet);
console.log(`escrito ${out}: ${ids.join(', ')}`);
