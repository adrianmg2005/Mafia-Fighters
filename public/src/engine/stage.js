// MOTOR DEL ESCENARIO DE COMBATE (sección 1.A del diseño).
//
// Sirve la geometría del escenario activo a la física (sólidos, semisólidas,
// bordes, blast zones, reaparición) y lo dibuja: hornea su arte UNA vez en un
// canvas offscreen y lo blitea cada frame en coordenadas de mundo. El arte y
// los datos viven en `stages/*.js` (hoy `patioFlotante.js`), igual que un
// personaje vive en su archivo de datos y no en el motor.
//
// Detrás, en espacio de pantalla, va el fondo lejano (engine/backdrop.js): el
// patio del instituto pintado a 480x270 y escalado x3.

import { patioFlotante } from '../stages/patioFlotante.js';
import { makeRng, makePix } from './pixelGrid.js';
import { drawStageBackground } from './backdrop.js';

let activeStage = patioFlotante;
let baked = null;

export function getGeometry() {
  return activeStage.geometry;
}

export function getStageSafetyColor() {
  return activeStage.safetyColor;
}

/** Cambia de escenario y tira la caché del horneado. */
export function setActiveStage(stage) {
  activeStage = stage;
  baked = null;
}

function bake() {
  const b = activeStage.bakeBounds;
  const canvas = document.createElement('canvas');
  canvas.width = b.right - b.left;
  canvas.height = b.bottom - b.top;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.translate(-b.left, -b.top);
  activeStage.paint(ctx, makePix(ctx), makeRng(activeStage.seed));
  return { canvas, left: b.left, top: b.top };
}

export function getStageCanvas() {
  if (!baked) baked = bake();
  return baked;
}

/** El escenario, en coordenadas de mundo (bajo la transformación de cámara). */
export function drawStage(ctx) {
  const { canvas, left, top } = getStageCanvas();
  ctx.drawImage(canvas, left, top);
}

// --- Fondo lejano --------------------------------------------------------------
//
// El patio se pinta en espacio de PANTALLA a escala entera (x3: sus píxeles de
// 2 px pasan a bloques de 6, que es lo que lo lee como lejano) y con un
// parallax muy suave respecto al centro del escenario. Se ancla el horizonte
// del patio (la base del polideportivo, y=195 en su marco) a 60 px POR DEBAJO
// del borde inferior: se ve la fachada entera detrás de la losa y nunca su
// pista, que es lo que vende que la losa flota a la altura de la primera
// planta en vez de estar apoyada en el suelo.
const BACKDROP_SCALE = 3;
const BACKDROP_ANCHOR = { courtX: 240, courtY: 195, screenX: 640, screenY: 780 };
const BACKDROP_PARALLAX = { x: 0.12, y: 0.08 };
const STAGE_CENTER = { x: 640, y: 400 };

export function drawBackdrop(ctx, camera, viewport) {
  const dx = camera.x - STAGE_CENTER.x;
  const dy = camera.y - STAGE_CENTER.y;
  const tx = BACKDROP_ANCHOR.screenX - BACKDROP_ANCHOR.courtX * BACKDROP_SCALE - dx * BACKDROP_PARALLAX.x;
  const ty = BACKDROP_ANCHOR.screenY - BACKDROP_ANCHOR.courtY * BACKDROP_SCALE - dy * BACKDROP_PARALLAX.y;
  ctx.save();
  ctx.setTransform(BACKDROP_SCALE, 0, 0, BACKDROP_SCALE, Math.round(tx), Math.round(ty));
  // El propio fondo tiene tres capas con su parallax interno; se le pasa una
  // "cámara" en su marco de 480 que se mueve poco con la del combate.
  drawStageBackground(ctx, BACKDROP_ANCHOR.courtX + dx * 0.05);
  ctx.restore();
  const haze = activeStage.backdropHaze;
  if (haze) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = `rgba(${haze.color}, ${haze.alpha})`;
    ctx.fillRect(0, 0, viewport.w, viewport.h);
    ctx.restore();
  }
}

// --- Plataforma de reaparición ------------------------------------------------
// No se hornea: aparece y desaparece con el luchador que reaparece, y late.
export function drawRespawnPlatform(ctx, x, y, frame) {
  const half = activeStage.geometry.respawn.halfWidth;
  const pulse = (Math.floor(frame / 6) % 2) === 0;
  ctx.save();
  ctx.fillStyle = '#1d4f9e';
  ctx.fillRect(Math.round(x - half), Math.round(y), half * 2, 8);
  ctx.fillStyle = pulse ? '#bfe9ff' : '#8fd2ff';
  ctx.fillRect(Math.round(x - half + 2), Math.round(y), half * 2 - 4, 2);
  ctx.fillStyle = '#4aa8ff';
  ctx.fillRect(Math.round(x - half + 2), Math.round(y + 2), half * 2 - 4, 4);
  // Haz de luz hacia abajo, en bandas: el "ascensor" del que se baja.
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 5; i += 1) {
    const w = half * 2 - 12 - i * 12;
    if (w <= 0) break;
    ctx.fillStyle = `rgba(74, 168, 255, ${0.16 - i * 0.025})`;
    ctx.fillRect(Math.round(x - w / 2), Math.round(y + 8 + i * 8), Math.round(w), 8);
  }
  ctx.restore();
}
