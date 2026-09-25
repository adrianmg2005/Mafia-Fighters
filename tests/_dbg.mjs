import { createCanvas, installDom } from './fakeCanvas.mjs';
installDom();
const { drawPixelFighter } = await import('../public/src/engine/pixelFighterArt.js');
const { computePoseForKind } = await import('../public/src/engine/poseLibrary.js');
const c = createCanvas(80, 120);
drawPixelFighter(c.getContext('2d'), { w: 80, h: 120, art: 'mecanico', pose: computePoseForKind('idle', { h: 120, kit: 'mecanico', t: 0 }) });
const hex = (i) => '#' + [0, 1, 2].map((k) => Math.round(c.data[i + k]).toString(16).padStart(2, '0')).join('');
for (let y = 24; y < 44; y += 1) { let row = ''; for (let x = 44; x < 70; x += 1) { const i = (y * 80 + x) * 4; row += c.data[i + 3] < 0.5 ? ' .     ' : hex(i).slice(1) + ' '; } console.log(y, row); }
