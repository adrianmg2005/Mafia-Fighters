// Utilidad de dirección de arte: vuelca la cinemática del FINAL SMASH
// DESPERTADO ("La Batalla de Gallos definitiva") en sus momentos clave, con
// los sprites reales (el rapero y el rival), para MIRARLA.
//
//   node tests/renderBattle.mjs [salida.png]
//
// Momentos: el tajo (4), el foco cayendo (20, 44), la entrada de Samuel (75,
// 100), una rima en vuelo y su golpe (112, 120), la última (170), el salto
// (205), el impact frame (228, 229) y la detonación (234).

import { createCanvas, installDom, writePng } from './fakeCanvas.mjs';

installDom();

const { drawBattleFinale } = await import('../public/src/engine/battleFinale.js');
const { buildFighterAtlas, animationsForMoveTable } = await import('../public/src/engine/spriteAtlasBuilder.js');
const { SpriteAnimator } = await import('../public/src/engine/spriteAnimator.js');
const { samuelConfig } = await import('../public/src/characters/samuel.js');
const { rosterVictimPoses } = await import('../public/src/characters/roster.js');

const out = process.argv[2] || 'tests/_battle.png';
const spec = samuelConfig.awakened.moveTable.final.finalSmash;
const attacker = new SpriteAnimator(buildFighterAtlas({
  art: samuelConfig.art, animations: animationsForMoveTable(samuelConfig.awakened.moveTable, rosterVictimPoses()), outfit: 'awakened', lazy: true,
}));
const victim = new SpriteAnimator(buildFighterAtlas({
  art: samuelConfig.art, animations: ['stagger', 'hitstun', 'idle'], lazy: true,
}));
const W = 1280;
const H = 720;
const FRAMES = [4, 20, 44, 75, 100, 112, 120, 170, 205, 228, 229, 234];
const COLS = 4;
const S = 0.5;
const sheet = createCanvas(W * S * COLS, H * S * Math.ceil(FRAMES.length / COLS));
const sctx = sheet.getContext('2d');
FRAMES.forEach((frame, i) => {
  const c = createCanvas(W, H);
  drawBattleFinale(c.getContext('2d'), {
    frame, spec, attacker, victim, viewport: { w: W, h: H },
  });
  sctx.drawImage(c, (i % COLS) * W * S, Math.floor(i / COLS) * H * S, W * S, H * S);
});
writePng(out, sheet);
console.log(`escrito ${out}`);
