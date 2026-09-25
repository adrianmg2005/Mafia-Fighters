// Iluminación aditiva puntual sobre la arena. Sin shaders: un gradiente
// radial compuesto en modo `lighter`, que es la forma barata y correcta de
// hacer que una luz SUME en vez de tapar.
//
// Para qué sirve de verdad: el callejón está atenuado a propósito (ver la
// guía, 3.6), así que un fogonazo que solo pinte partículas se pierde. Una
// luz aditiva ilumina el suelo, la pared Y a los luchadores que estén dentro
// del radio, y eso es lo que hace que un eructo se sienta como un suceso del
// escenario y no como un dibujo encima.
//
// POOL FIJO de 12 luces: son efectos cortos (3-6 frames) y nunca hay muchas
// a la vez, pero el tope garantiza que un combo largo no asigne por frame.

const POOL_SIZE = 12;

/**
 * @typedef {Object} LightSlot
 * @property {boolean} active
 * @property {number} x
 * @property {number} y
 * @property {number} radius
 * @property {number} life     frames restantes
 * @property {number} maxLife
 * @property {number} intensity
 * @property {[number,number,number]} rgb
 */

/** @type {LightSlot[]} */
const pool = [];
for (let i = 0; i < POOL_SIZE; i += 1) {
  pool.push({
    active: false, x: 0, y: 0, radius: 0, life: 0, maxLife: 1, intensity: 1, rgb: [255, 255, 255],
  });
}
let cursor = 0;

function take() {
  for (let n = 0; n < POOL_SIZE; n += 1) {
    const s = pool[cursor];
    cursor = (cursor + 1) % POOL_SIZE;
    if (!s.active) return s;
  }
  const s = pool[cursor];
  cursor = (cursor + 1) % POOL_SIZE;
  return s;
}

/**
 * Enciende una luz puntual durante unos frames.
 * @param {number} x
 * @param {number} y
 * @param {number} radius   px
 * @param {[number,number,number]} rgb
 * @param {number} intensity 0..1
 * @param {number} frames
 */
export function spawnLight(x, y, radius, rgb, intensity, frames) {
  const s = take();
  s.active = true;
  s.x = x;
  s.y = y;
  s.radius = radius;
  s.rgb = rgb;
  s.intensity = intensity;
  s.life = frames;
  s.maxLife = frames;
  return s;
}

// --- Disparadores con nombre --------------------------------------------
// Las cifras viven aquí y no en quien golpea: un movimiento declara QUÉ pasa
// (`vfx: 'gas'`), no de qué color es la luz.

/** Fogonazo verde ácido del eructo y de las explosiones de gas. */
export function spawnAcidFlash(x, y) {
  return spawnLight(x, y, 90, [57, 255, 20], 0.45, 6);
}

/** @param {number} dt segundos */
export function updateLights(dt) {
  for (const s of pool) {
    if (!s.active) continue;
    s.life -= dt * 60;
    if (s.life <= 0) s.active = false;
  }
}

export function clearLights() {
  for (const s of pool) s.active = false;
}

/** Cuántas luces hay encendidas. Debug y tests. */
export function activeLightCount() {
  let n = 0;
  for (const s of pool) if (s.active) n += 1;
  return n;
}

export const LIGHT_POOL_SIZE = POOL_SIZE;

/**
 * Dibuja una luz suelta. Expuesto además del gestor porque el escenario
 * puede querer una fija (el farol) sin pasar por el pool.
 */
export function drawLightSource(ctx, x, y, radius, rgb, intensity) {
  if (radius <= 0 || intensity <= 0) return;
  ctx.save();
  // `lighter` SUMA canales: una luz nunca puede oscurecer lo que hay debajo,
  // que es justo la diferencia entre iluminar y pintar una mancha encima.
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  const [r, gg, b] = rgb;
  g.addColorStop(0, `rgba(${r}, ${gg}, ${b}, ${intensity.toFixed(3)})`);
  g.addColorStop(0.55, `rgba(${r}, ${gg}, ${b}, ${(intensity * 0.35).toFixed(3)})`);
  g.addColorStop(1, `rgba(${r}, ${gg}, ${b}, 0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Pasada de luces. Va DESPUÉS de los luchadores y antes del HUD: tiene que
 * iluminarlos a ellos, no quedarse debajo.
 */
export function drawLights(ctx) {
  for (const s of pool) {
    if (!s.active) continue;
    // Se apaga con el tiempo, no de golpe: un corte seco se lee como un
    // parpadeo de pantalla en vez de como una luz.
    const k = Math.max(0, s.life / s.maxLife);
    drawLightSource(ctx, s.x, s.y, s.radius * (0.7 + 0.3 * k), s.rgb, s.intensity * k);
  }
}
