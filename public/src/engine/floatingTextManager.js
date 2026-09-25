// Carteles cómicos que saltan del punto de impacto: "¡ACEITAZO!", "¡TÓXICO!",
// "¡CHAPA DURA!". Es el comentario del juego sobre lo que acaba de pasar, y
// su trabajo real es que un golpe con propiedad especial se distinga de un
// golpe normal SIN tener que mirar la barra de vida.
//
// DOS DECISIONES QUE SE APARTAN DE LO OBVIO:
//
// 1. NO usa `fillText`/`strokeText`. A 480×270 una tipografía vectorial se
//    rasteriza con antialias y queda borrosa justo al lado de un sprite
//    nítido — es la misma razón por la que todo el HUD va con la fuente de
//    mapa de bits 5×7 (ver la guía, sección 11). El contorno negro de 2px
//    que pide un `strokeText` se consigue aquí dibujando el texto cuatro
//    veces desplazado en negro y una encima en color, que además cae en la
//    caché de textos rasterizados de `pixelFont` y sale gratis.
// 2. POOL FIJO. Veinte ranuras reservadas al cargar el módulo. Un combo de
//    ocho golpes con sus carteles no puede provocar una recolección justo en
//    el frame del remate.

import { drawPixelText, measurePixelText } from './pixelFont.js';

const POOL_SIZE = 20;
const LIFE_FRAMES = 45;
const FADE_FRAMES = 20;
const RISE_SPEED = -2.4 * 60;   // -2.4 px/f
const GRAVITY = 3.4 * 60;       // frena la subida: el cartel rebota y cae
// CONTORNO DE 1px, NO DE 2, y ESCALA ENTERA. Medido mirando el render: con
// la escala 1.4 del diseño los trazos de la fuente 5x7 miden ~1px, así que un
// contorno de 2px en cuatro direcciones se come la letra entera — dos de los
// tres carteles salían como barras negras con unos píxeles de color dentro.
// A escala 2 el trazo mide 2px y el contorno de 1 se lee como contorno. La
// escala fraccionaria además rompe la regla de siempre: una fuente de mapa
// de bits escalada a 1.4 reparte mal las celdas y queda irregular.
const OUTLINE = 1;
const DEFAULT_SCALE = 2;

/**
 * Ranura de texto flotante. Siempre existe; `active` dice si está en uso.
 * @typedef {Object} FloatingText
 * @property {boolean} active
 * @property {string}  text
 * @property {number}  x
 * @property {number}  y
 * @property {number}  vx
 * @property {number}  vy
 * @property {number}  life     frames restantes
 * @property {number}  scale
 * @property {string}  color
 */

/** @type {FloatingText[]} */
const pool = [];
for (let i = 0; i < POOL_SIZE; i += 1) {
  pool.push({
    active: false, text: '', x: 0, y: 0, vx: 0, vy: 0, life: 0, scale: DEFAULT_SCALE, color: '#ffffff',
  });
}
let cursor = 0;

// Estilos por tipo de suceso. Viven aquí y no en el sitio que los dispara
// porque son PRESENTACIÓN: quien golpea no tiene por qué saber de colores.
export const TEXT_STYLES = {
  wallBounce: { text: 'CONTRA EL MURO', color: '#ffe600', scale: DEFAULT_SCALE },
  gas: { text: 'TOXICO', color: '#39ff14', scale: DEFAULT_SCALE },
  burp: { text: 'GAS PURO', color: '#39ff14', scale: DEFAULT_SCALE },
  armor: { text: 'CHAPA DURA', color: '#33ccff', scale: DEFAULT_SCALE },
  oil: { text: 'ACEITAZO', color: '#d1d5db', scale: DEFAULT_SCALE },
  shieldBreak: { text: 'ESCUDO ROTO', color: '#ff5a4a', scale: DEFAULT_SCALE },
  counter: { text: 'PAUSA DEL CIGARRO', color: '#e6e3dc', scale: DEFAULT_SCALE },
  tech: { text: 'TECH', color: '#8fd2ff', scale: DEFAULT_SCALE },
  bury: { text: 'ENTERRADO', color: '#c08a4f', scale: DEFAULT_SCALE },
  meteor: { text: 'METEORO', color: '#39ff14', scale: DEFAULT_SCALE },
  trump: { text: 'BORDE ROBADO', color: '#ffd24a', scale: DEFAULT_SCALE },
  // Modo Despertado: las rimas del Rap Battle Dash y el parry.
  pa: { text: 'PA!', color: '#ffd24a', scale: DEFAULT_SCALE + 1 },
  toma: { text: 'TOMA!', color: '#ff2d8f', scale: DEFAULT_SCALE + 1 },
  parry: { text: 'VACILE', color: '#ffffff', scale: DEFAULT_SCALE },
};

/**
 * Lanza un cartel. Si el pool está lleno recicla el más antiguo: un tope que
 * se salta a sí mismo no es un tope.
 * @param {string} text
 * @param {number} x
 * @param {number} y
 * @param {{color?: string, scale?: number, vx?: number}} [style]
 */
export function spawnFloatingText(text, x, y, style = {}) {
  let slot = null;
  for (let n = 0; n < POOL_SIZE; n += 1) {
    const s = pool[cursor];
    cursor = (cursor + 1) % POOL_SIZE;
    if (!s.active) { slot = s; break; }
  }
  if (!slot) {
    slot = pool[cursor];
    cursor = (cursor + 1) % POOL_SIZE;
  }
  slot.active = true;
  slot.text = String(text).toUpperCase();
  slot.x = x;
  slot.y = y;
  // Deriva lateral pequeña y aleatoria: dos carteles seguidos en el mismo
  // sitio se solaparían exactamente y se leerían como uno solo en negrita.
  slot.vx = style.vx ?? (Math.random() - 0.5) * 30;
  slot.vy = RISE_SPEED;
  slot.life = LIFE_FRAMES;
  slot.scale = style.scale ?? DEFAULT_SCALE;
  slot.color = style.color ?? '#ffffff';
  return slot;
}

/** Atajo con estilo predefinido. @param {keyof TEXT_STYLES} tipo */
export function spawnStyledText(tipo, x, y) {
  const st = TEXT_STYLES[tipo];
  if (!st) return null;
  return spawnFloatingText(st.text, x, y, st);
}

/** @param {number} dt segundos */
export function updateFloatingTexts(dt) {
  for (const s of pool) {
    if (!s.active) continue;
    s.vy += GRAVITY * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.life -= dt * 60;
    if (s.life <= 0) s.active = false;
  }
}

export function clearFloatingTexts() {
  for (const s of pool) s.active = false;
}

/** Cuántos carteles hay en pantalla. Solo para debug y tests. */
export function activeTextCount() {
  let n = 0;
  for (const s of pool) if (s.active) n += 1;
  return n;
}

export const FLOATING_TEXT_POOL_SIZE = POOL_SIZE;

/**
 * Dibuja los carteles. Va DENTRO de la transformación de cámara: un cartel
 * pegado al punto de impacto tiene que moverse con el mundo, o se despega
 * del golpe en cuanto la cámara hace zoom.
 */
export function drawFloatingTexts(ctx) {
  for (const s of pool) {
    if (!s.active) continue;
    const alpha = s.life < FADE_FRAMES ? Math.max(0, s.life / FADE_FRAMES) : 1;
    const x = Math.round(s.x);
    const y = Math.round(s.y);
    // Contorno: cuatro copias negras desplazadas. Sale de la caché de la
    // fuente igual que el relleno, así que las cinco pasadas son cinco
    // `drawImage` y ni un solo `fillRect`.
    for (const [dx, dy] of [[-OUTLINE, 0], [OUTLINE, 0], [0, -OUTLINE], [0, OUTLINE]]) {
      drawPixelText(ctx, s.text, x + dx, y + dy, {
        scale: s.scale, color: '#000000', shadow: false, align: 'center', alpha,
      });
    }
    drawPixelText(ctx, s.text, x, y, {
      scale: s.scale, color: s.color, shadow: false, align: 'center', alpha,
    });
  }
}

/** Ancho en px que ocuparía un cartel. Lo usan los tests de encaje. */
export function measureFloatingText(text, scale = DEFAULT_SCALE) {
  return measurePixelText(String(text).toUpperCase(), scale) + OUTLINE * 2;
}
