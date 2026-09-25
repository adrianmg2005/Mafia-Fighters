import { createCanvas, installDom, writePng } from './fakeCanvas.mjs';
installDom();
const { drawPixelFighter } = await import('../public/src/engine/pixelFighterArt.js');
const { computePoseForKind } = await import('../public/src/engine/poseLibrary.js');
const shots = JSON.parse(process.argv[3]);
const S = 5;
const sheet = createCanvas(110 * S * shots.length, 140 * S);
const sc = sheet.getContext('2d'); sc.imageSmoothingEnabled = false; sc.fillStyle = '#8a8478'; sc.fillRect(0, 0, sheet.width, sheet.height);
shots.forEach(([k, o, outfit], i) => {
  const c = createCanvas(110, 140); const g = c.getContext('2d'); g.translate(15, 10);
  drawPixelFighter(g, { w: 80, h: 120, art: 'mecanico', outfit: outfit || 'normal', pose: computePoseForKind(k, { h: 120, kit: 'mecanico', ...o }) });
  sc.drawImage(c, 0, 0, 110, 140, i * 110 * S, 0, 110 * S, 140 * S);
});
writePng(process.argv[2], sheet);
