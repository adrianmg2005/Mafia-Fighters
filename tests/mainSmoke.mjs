// Humo de extremo a extremo: carga el main.js REAL con DOM, socket y reloj
// falsos, toma el rol de host y juega una partida entera (lobby, cuenta atrás,
// combate, tres K.O., resultados, revancha y un Final Smash) dibujando por el
// camino. Caza excepciones en render/HUD/red que los tests de la simulación
// no ven. Uso: npm run smoke (deja tests/_main.png y tests/_main_cine.png).
import {
  createCanvas, installDom, writePng, luminanceAt,
} from './fakeCanvas.mjs';


installDom();
const gameCanvas = createCanvas(1, 1);
gameCanvas.style = {};
{ const c = gameCanvas.getContext('2d'); c.fillText = () => {}; c.font = ''; }
globalThis.document.getElementById = () => gameCanvas;
globalThis.document.addEventListener = () => {};
globalThis.document.hasFocus = () => true;
const listeners = {};
globalThis.window = {
  location: { search: '?netlog=0' },
  innerWidth: 1280,
  innerHeight: 720,
  addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
};
Object.defineProperty(globalThis, "navigator", { value: { getGamepads: () => [] }, configurable: true });
let now = 0;
Object.defineProperty(globalThis, "performance", { value: { now: () => now }, configurable: true });
let rafCb = null;
globalThis.requestAnimationFrame = (cb) => { rafCb = cb; };
let tick = null;
globalThis.setInterval = (fn) => { tick = fn; return 1; };
const socketHandlers = {};
const sent = { state: 0 };
globalThis.io = () => ({
  on: (ev, fn) => { socketHandlers[ev] = fn; },
  emit: (ev) => { if (ev === 'state') sent.state += 1; },
  connected: true,
});
const key = (code, down) => (listeners[down ? 'keydown' : 'keyup'] || []).forEach((fn) => fn({ code, preventDefault() {}, repeat: false }));

await import('../public/src/main.js');
socketHandlers.role_assigned({ role: 'p1', roomId: 'x' });
const frames = (n, onEach) => {
  for (let i = 0; i < n; i += 1) {
    now += 1000 / 60;
    tick();
    onEach?.(i);
  }
};
const render = () => { now += 1; rafCb(now); };
const mafia = globalThis.window.__mafia;

frames(30);
render();
key('Enter', true); frames(2); key('Enter', false);
frames(200); // cuenta atrás
console.log('fase tras ENTER + 200 frames:', mafia.sim.phase);
render();
// Machaque de P1 contra el muñeco, y le forzamos K.O.s
const keys = ['KeyD', 'KeyU', 'KeyI', 'KeyO', 'KeyJ', 'KeyW', 'KeyS', 'Space', 'KeyA'];
frames(600, (i) => {
  if (i % 5 === 0) key(keys[Math.floor(i / 5) % keys.length], true);
  if (i % 5 === 3) key(keys[Math.floor(i / 5) % keys.length], false);
  if (i % 50 === 0) render();
});
for (let k = 0; k < 900 && mafia.sim.phase === 'fight'; k += 1) {
  const p2 = mafia.sim.p2;
  if (p2.state !== 'dead' && p2.state !== 'eliminated' && p2.state !== 'respawn') p2.x = 1500;
  frames(1, () => { if (k % 20 === 0) render(); });
}
console.log('fase:', mafia.sim.phase, 'ganador:', mafia.sim.winner, 'stocks p2:', mafia.sim.p2.stocks);
frames(200, (i) => { if (i % 20 === 0) render(); });
console.log('fase final:', mafia.sim.phase, 'snapshots enviados:', sent.state);
// Final Smash y debug abierto
key('Enter', true); frames(2); key('Enter', false); frames(200);
mafia.sim.p1.meter = 100;
mafia.sim.p1.x = 600; mafia.sim.p2.x = 700;
key('KeyP', true); frames(2); key('KeyP', false);
listeners.keydown.forEach((fn) => fn({ code: 'F1', preventDefault() {}, repeat: false }));
frames(150, (i) => { if (i % 10 === 0) render(); if (i === 60) writePng('tests/_main_cine.png', gameCanvas); });
render();
writePng('tests/_main.png', gameCanvas);
// Se cierra el panel de debug: el lienzo falso no rasteriza su texto
// (fillText) y en las capturas quedaba como una banda gris vacía en y 520-600.
listeners.keydown.forEach((fn) => fn({ code: 'F1', preventDefault() {}, repeat: false }));

// Pausa: ESC congela la simulación, la guía se navega y ESC reanuda.
const frameBefore = mafia.sim.frame;
key('Escape', true); frames(2); key('Escape', false);
frames(10);
render();
writePng('tests/_pause_controls.png', gameCanvas);
if (!mafia.snap.paused || mafia.sim.frame !== frameBefore) throw new Error(`la pausa no congela: ${mafia.sim.frame} vs ${frameBefore}`);
key('KeyD', true); frames(1); key('KeyD', false); frames(1);
render();
writePng('tests/_pause_moves.png', gameCanvas);
for (let i = 0; i < 12; i += 1) { key('KeyS', true); frames(1); key('KeyS', false); frames(1); }
render();
writePng('tests/_pause_moves_scrolled.png', gameCanvas);
key('Escape', true); frames(2); key('Escape', false); frames(5);
if (mafia.snap.paused) throw new Error('ESC no reanuda');
console.log('pausa OK: congelada en el frame', frameBefore);

// MODO DESPERTAR: la Ñ (aquí por su carácter, `e.key`, con un código que no
// está mapeado) lanza la cinemática de corte; al acabar, Samuel despierta.
// Tono de fuego en pantalla (las llamas y las estelas del Despertar): rojo o
// dorado saturado. `box` limita la cuenta a un rectángulo de pantalla.
const fireRed = (canvas, box = [0, 0, canvas.width, canvas.height]) => {
  let n = 0;
  const [x0, y0, x1, y1] = box.map(Math.round);
  for (let y = Math.max(0, y0); y < Math.min(canvas.height, y1); y += 1) {
    for (let x = Math.max(0, x0); x < Math.min(canvas.width, x1); x += 1) {
      const i = (y * canvas.width + x) * 4;
      const [r, g, b] = [canvas.data[i], canvas.data[i + 1], canvas.data[i + 2]];
      if (r > 200 && r - b > 110 && g < 200) n += 1;
    }
  }
  return n;
};
// Lo que queda DETRÁS de p1 (a su izquierda, más allá de sus llamas).
const behindP1 = () => {
  const p1 = mafia.snap.fighters.find((f) => f.slot === 'p1');
  const [sx, sy] = [0, 1].map((k) => {
    const pt = mafia.camera.worldToScreen(p1.x, p1.y - 54);
    return Array.isArray(pt) ? pt[k] : [pt.x, pt.y][k];
  });
  const z = mafia.camera.zoom;
  // Tinte rojo o dorado: el rojo domina claramente al azul (la pared de
  // detrás es azul y crema; una estela al 50% sobre el azul no llega a rojo
  // puro, pero sí lo vuelve cálido).
  const [x0, y0, x1, y1] = [sx - 130 * z, sy - 50 * z, sx - 50 * z, sy + 50 * z].map(Math.round);
  let n = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * gameCanvas.width + x) * 4;
      if (gameCanvas.data[i] - gameCanvas.data[i + 2] > 60) n += 1;
    }
  }
  return n;
};
render();
const redBefore = fireRed(gameCanvas);
const enye = (down) => (listeners[down ? 'keydown' : 'keyup'] || []).forEach((fn) => fn({
  code: 'IntlBackslash', key: 'ñ', preventDefault() {}, repeat: false,
}));
enye(true); frames(2); enye(false);
frames(28);
render();
writePng('tests/_cutin_live.png', gameCanvas);
if (!mafia.snap.cutin) throw new Error('la Ñ no lanza la cinemática del Despertar');
if (luminanceAt(gameCanvas, 60, 360) > 5) throw new Error('la franja del corte no se dibuja');
frames(100);
render();
writePng('tests/_awakened_live.png', gameCanvas);
const awake = mafia.snap.fighters.find((f) => f.slot === 'p1');
if (!awake.awakened || mafia.snap.cutin) throw new Error('tras la cinemática, Samuel no está despertado');
// (Pasado el estallido dorado del despertar, que lo tapa todo.)
frames(40);
render();
writePng('tests/_awakened_idle.png', gameCanvas);
const redAwake = fireRed(gameCanvas);
const behindIdle = behindP1();
if (redAwake < redBefore + 1000) throw new Error(`despertado no arde: ${redBefore} -> ${redAwake} px rojos`);
// Corriendo deja estelas fantasma rojas y doradas detrás (las estelas son
// de la PRESENTACIÓN: se dibuja cada frame, como en el navegador).
key('KeyD', true); frames(1); key('KeyD', false); frames(1); key('KeyD', true);
frames(12, () => render());
writePng('tests/_awakened_run.png', gameCanvas);
key('KeyD', false);
const behindRun = behindP1();
if (behindRun < behindIdle + 500) throw new Error(`corriendo despertado no deja estela: ${behindIdle} -> ${behindRun} px detrás`);
console.log('despertar OK: cinemática y', awake.awakenLeft, 'frames de Despertar; fuego', redBefore, '->', redAwake, 'px; detrás', behindIdle, '-> corriendo', behindRun);

const placeAt = (f, x, facing) => {
  f.x = x; f.y = 520; f.vx = 0; f.vy = 0; f.kbx = 0; f.kby = 0;
  f.grounded = true; f.surfaceId = 'main'; f.facing = facing; f.setState('idle');
};

// IMPACT FRAMES del microfonazo despertado, en el render real: 3 frames de
// pantalla en blanco y negro (el del medio invertido) con la estrella roja.
placeAt(mafia.sim.p1, 560, 1);
placeAt(mafia.sim.p2, 610, -1);
mafia.sim.p2.percent = 20;
mafia.sim.p1.startMove('fsmash');
let impactHit = false;
for (let i = 0; i < 40 && !impactHit; i += 1) {
  frames(1);
  impactHit = mafia.snap.hitlag > 0;
}
if (!impactHit) throw new Error('el microfonazo despertado no conecta');
// El atlas del rapero hornea SUS poses (las de la tabla despertada).
for (const pose of ['micslam', 'micjab', 'habano', 'parry', 'capthrow', 'battlestance']) {
  if (!mafia.animators.p1.animations[pose]) throw new Error(`el atlas despertado no tiene la pose ${pose}`);
}
// El mundo, sin el HUD (la franja de controles, el mensaje de estado y los
// paneles de abajo siguen encima del impact frame).
const mono = () => {
  let white = 0; let black = 0; let red = 0; let other = 0;
  for (let y = 160; y < 600; y += 4) {
    for (let x = 0; x < 1280; x += 4) {
      const [r, g, b] = gameCanvas.pixel(x, y);
      if (r > 245 && g > 245 && b > 245) white += 1;
      else if (r < 10 && g < 10 && b < 10) black += 1;
      else if (r > 180 && g < 60 && b < 70) red += 1; // la estrella y el carmesí de las chispas
      else other += 1;
    }
  }
  return { white, black, red, other };
};
render();
writePng('tests/_impact_1.png', gameCanvas);
const imp1 = mono();
frames(1); render();
writePng('tests/_impact_2.png', gameCanvas);
const imp2 = mono();
frames(2); render();
const imp4 = mono();
// (Casi nada fuera del blanco, el negro y el rojo: solo las estelas
// translúcidas del golpe, que teñidas quedan en gris; < 100 de ~35.000.)
if (!(imp1.other < 100 && imp1.white > imp1.black && imp1.red > 50)) throw new Error(`impact frame 1: ${JSON.stringify(imp1)}`);
if (!(imp2.other < 100 && imp2.black > imp2.white)) throw new Error(`impact frame 2 no está invertido: ${JSON.stringify(imp2)}`);
if (imp4.other < 1000) throw new Error(`el impact frame no se acaba: ${JSON.stringify(imp4)}`);
console.log('impact frames OK:', JSON.stringify(imp1), '->', JSON.stringify(imp2));
drainHitlagSmoke();
function drainHitlagSmoke() { for (let i = 0; i < 400 && (mafia.sim.p2.state !== 'idle' || mafia.sim.hitlag > 0); i += 1) frames(1); }

// Y fuera del Despertar: el F-Smash de siempre.
mafia.sim.p1.awakenFrames = 0;

// El COJÍN DONUT lanzado se dibuja en el render real (rosa, con su chorretón).
placeAt(mafia.sim.p1, 420, 1);
mafia.sim.p1.startMove('sspecial_throw');
frames(9);
if (!mafia.snap.projectiles.find((p) => p.kind === 'donutCushion')) throw new Error('no sale el donut');
// Gira: el glaseado solo se ve de cara, así que se mira una vuelta entera.
let pink = 0;
for (let k = 0; k < 12; k += 1) {
  frames(1);
  render();
  let n = 0;
  for (let i = 0; i < gameCanvas.data.length; i += 4) {
    if (gameCanvas.data[i] > 250 && Math.abs(gameCanvas.data[i + 1] - 143) < 4 && Math.abs(gameCanvas.data[i + 2] - 200) < 4) n += 1;
  }
  if (n > pink) {
    pink = n;
    writePng('tests/_donut.png', gameCanvas);
  }
}
if (pink < 100) throw new Error(`el donut no se dibuja: ${pink} px rosas`);
frames(120);

// Golpe LETAL: F-Smash desde el borde a un Samuel al 130%. Special Zoom
// (destello rojo, negro, rayos), estela del vuelo y detonación en la blast zone.
placeAt(mafia.sim.p1, 880, 1);
placeAt(mafia.sim.p2, 930, -1);
mafia.sim.p2.percent = 130;
mafia.sim.p1.startMove('fsmash');
let lethalAt = -1;
for (let i = 0; i < 60 && lethalAt < 0; i += 1) {
  frames(1);
  if (mafia.camera.special) lethalAt = i;
}
if (lethalAt < 0) throw new Error('el F-Smash al 130% desde el borde no dispara el Special Zoom');
// Medias del mundo (sin la franja de controles ni los paneles de abajo).
const worldStats = () => {
  let r = 0; let g = 0; let lum = 0; let n = 0;
  for (let y = 40; y < 600; y += 8) {
    for (let x = 0; x < 1280; x += 8) {
      const px = gameCanvas.pixel(x, y);
      r += px[0]; g += px[1]; lum += luminanceAt(gameCanvas, x, y); n += 1;
    }
  }
  return { r: r / n, g: g / n, lum: lum / n };
};
render();
const redFrame = worldStats();
writePng('tests/_lethal_red.png', gameCanvas);
frames(1); render();
const blackFrame = worldStats();
writePng('tests/_lethal_black.png', gameCanvas);
frames(1); render();
const thirdFrame = worldStats();
frames(3); render();
const boltsFrame = worldStats();
writePng('tests/_lethal_bolts.png', gameCanvas);
if (!(redFrame.r > redFrame.g * 1.5)) throw new Error(`el primer frame del Special Zoom no es rojo: ${JSON.stringify(redFrame)}`);
if (!(blackFrame.lum < boltsFrame.lum * 0.5)) throw new Error(`el segundo frame no es negro: ${blackFrame.lum} vs ${boltsFrame.lum}`);
// Dos frames exactos: en el tercero ya no queda ni rojo ni negro.
if (!(thirdFrame.r < thirdFrame.g * 1.3 && thirdFrame.lum > blackFrame.lum * 1.6)) {
  throw new Error(`el destello no se apaga tras 2 frames: ${JSON.stringify(thirdFrame)}`);
}
let koSide = null;
for (let i = 0; i < 200 && !koSide; i += 1) {
  frames(1);
  if (mafia.snap.fighters[1].trail && i % 3 === 0) render();
  if (mafia.snap.fighters[1].trail === 2 && i === 30) writePng('tests/_trail.png', gameCanvas);
  if (mafia.sim.p2.state === 'dead') koSide = 'ko';
}
if (!koSide) throw new Error('el golpe letal no mató');
frames(3); render();
writePng('tests/_ko_blast.png', gameCanvas);
// La detonación ilumina el borde por el que salió (derecha), no el otro.
const brightIn = (x0, x1) => {
  let n = 0;
  for (let y = 40; y < 600; y += 4) for (let x = x0; x < x1; x += 4) if (luminanceAt(gameCanvas, x, y) > 235) n += 1;
  return n;
};
const koRight = brightIn(1080, 1280);
const koLeft = brightIn(0, 200);
if (!(koRight > koLeft * 4 + 300)) throw new Error(`la detonación no se ve en el borde derecho: ${koRight} vs ${koLeft}`);
console.log('golpe letal OK: Special Zoom en el frame', lethalAt, 'del F-Smash');

// ABRAZO AÉREO con W+O de verdad, junto al muñeco (que está de pie): lo agarra.
frames(150);
mafia.sim.p1.awakenFrames = 0;
placeAt(mafia.sim.p1, 600, 1);
placeAt(mafia.sim.p2, 650, -1);
key('KeyW', true); key('KeyO', true); frames(2); key('KeyO', false); key('KeyW', false);
let dummyGrabbed = false;
for (let i = 0; i < 40 && !dummyGrabbed; i += 1) {
  frames(1);
  dummyGrabbed = mafia.sim.p2.state === 'grabbed';
}
if (!dummyGrabbed) throw new Error('W+O junto al muñeco no lo agarra');
frames(80);
console.log('abrazo aéreo OK: agarra al muñeco con W+O');

// FINAL SMASH DESPERTADO con la P real y sin medidor: la gorra atrapa y la
// Batalla de Gallos se dibuja a pantalla completa (el foco sobre el rival, el
// impact frame monocromo) y, con el rival por encima del 30%, K.O. seguro.
frames(150); // que p2 reaparezca
mafia.sim.p1.awaken(600);
mafia.sim.p1.meter = 0;
placeAt(mafia.sim.p1, 440, 1);
placeAt(mafia.sim.p2, 640, -1);
mafia.sim.p2.percent = 40;
key('KeyP', true); frames(2); key('KeyP', false);
for (let i = 0; i < 120 && !mafia.snap.cine; i += 1) frames(1);
if (mafia.snap.cine?.kind !== 'battle') throw new Error('la gorra no arranca la Batalla de Gallos definitiva');
while (mafia.snap.cine && mafia.snap.cine.frame < 44) frames(1);
render();
writePng('tests/_battle_live.png', gameCanvas);
// El foco: bajo él (el rival, x 470 de pantalla) hay mucha más luz que en la
// esquina de la calle.
const lumAt = (x0, y0, x1, y1) => {
  let s = 0; let n = 0;
  for (let y = y0; y < y1; y += 4) for (let x = x0; x < x1; x += 4) { s += luminanceAt(gameCanvas, x, y); n += 1; }
  return s / n;
};
const spot = lumAt(420, 120, 520, 560);
const corner = lumAt(1100, 120, 1260, 560);
if (!(spot > corner + 20)) throw new Error(`no hay foco sobre el rival: ${spot} vs ${corner}`);
while (mafia.snap.cine && mafia.snap.cine.frame < 228) frames(1);
render();
writePng('tests/_battle_impact.png', gameCanvas);
const bImp = mono();
if (!(bImp.other < 100 && bImp.white > bImp.black && bImp.black > 1000 && bImp.red > 20)) throw new Error(`el impact frame de la batalla no es monocromo: ${JSON.stringify(bImp)}`);
let battleKo = false;
for (let i = 0; i < 400 && !battleKo; i += 1) {
  frames(1);
  battleKo = mafia.sim.p2.state === 'dead';
}
if (!battleKo) throw new Error('la Batalla de Gallos al 40% no mata');
console.log('batalla OK: foco', spot.toFixed(0), 'vs', corner.toFixed(0), '; impact', JSON.stringify(bImp), '; K.O.');
console.log('OK: sin excepciones. p2%', mafia.sim.p2.percent.toFixed(1));
