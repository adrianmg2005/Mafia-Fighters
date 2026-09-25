// Utilidad de dirección de arte: vuelca la ARENA a PNG para MIRARLA.
//
//   node tests/renderStage.mjs [salida.png] [escena]
//
// escena: 'neutral' (por defecto), 'shield', 'ledge', 'tumble', 'respawn'
//
// Todos los bugs de arte de este proyecto se encontraron rasterizando y
// contando píxeles, no razonando sobre el código. Esto monta una simulación
// real, la avanza con un guion de inputs y dibuja el frame con el mismo
// renderer que el juego (fondo lejano, losa, luchadores, HUD).

import { createCanvas, installDom, writePng } from './fakeCanvas.mjs';

installDom();

const { Simulation } = await import('../public/src/engine/simulation.js');
const { CameraManager, VIEWPORT_W, VIEWPORT_H } = await import('../public/src/engine/cameraManager.js');
const {
  getGeometry, drawStage, drawBackdrop, drawRespawnPlatform,
} = await import('../public/src/engine/stage.js');
const { drawFighter, drawShadow } = await import('../public/src/engine/renderer.js');
const { drawPercentPanels } = await import('../public/src/engine/platformHud.js');
const { surfaceBelow } = await import('../public/src/engine/physics.js');
const { buildFighterAtlas, animationsForMoveTable } = await import('../public/src/engine/spriteAtlasBuilder.js');
const { SpriteAnimator } = await import('../public/src/engine/spriteAnimator.js');
const { samuelConfig } = await import('../public/src/characters/samuel.js');
const { rosterVictimPoses } = await import('../public/src/characters/roster.js');

const out = process.argv[2] || 'tests/_stage.png';
const scene = process.argv[3] || 'neutral';

const geometry = getGeometry();
const sim = new Simulation({ geometry, p1: samuelConfig, p2: samuelConfig });
sim.setOpponentPresent(true);
const step = (n, p1 = {}, p2 = {}) => { for (let i = 0; i < n; i += 1) sim.step({ p1, p2 }); };

step(10);
if (scene === 'shield') step(20, {}, { shield: true });
if (scene === 'ledge') {
  // Cae pegado al canto derecho: agarra el borde de (940, 520).
  const f = sim.p2;
  f.x = 966;
  f.y = 560;
  f.vx = 0;
  f.vy = 1;
  f.grounded = false;
  f.surfaceId = null;
  f.setState('air');
  step(20);
}
if (scene === 'tumble') {
  sim.p2.percent = 120;
  step(1, { smash: true });
  step(30);
}
if (scene === 'respawn') {
  sim.p2.x = 1500;
  step(95);
}

const snap = sim.serialize();
const atlas = buildFighterAtlas({
  art: samuelConfig.art,
  color: samuelConfig.color,
  animations: animationsForMoveTable(samuelConfig.moveTable, rosterVictimPoses()),
});
const animators = { p1: new SpriteAnimator(atlas), p2: new SpriteAnimator(atlas) };
const camera = new CameraManager({ blastZones: geometry.blastZones });
for (let i = 0; i < 120; i += 1) camera.update(snap.fighters);

const canvas = createCanvas(VIEWPORT_W, VIEWPORT_H);
const ctx = canvas.getContext('2d');
drawBackdrop(ctx, camera, { w: VIEWPORT_W, h: VIEWPORT_H });
ctx.save();
camera.apply(ctx);
drawStage(ctx);
for (const v of snap.fighters) {
  if (v.respawning) drawRespawnPlatform(ctx, v.x, v.y, 0);
  const floor = v.grounded ? { y: v.y } : surfaceBelow(geometry, v.x, v.y);
  drawShadow(ctx, v, floor?.y);
  drawFighter(ctx, v, animators[v.slot], 0);
}
ctx.restore();
drawPercentPanels(ctx, snap.fighters, animators, 0);

writePng(out, canvas);
console.log(`escrito ${out} (escena ${scene}, zoom ${camera.zoom.toFixed(2)})`);
