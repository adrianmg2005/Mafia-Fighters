// Fuente de mapa de bits 5x7, el formato clásico de máquina recreativa.
//
// Se dibuja píxel a píxel en vez de usar `ctx.fillText` con una tipografía
// del sistema: a la resolución lógica del juego (480x270) una fuente vectorial
// se rasteriza con antialias y queda borrosa justo al lado de un sprite pixel
// art nítido. Aquí cada glifo son celdas alineadas a la rejilla, así que
// escala en múltiplos enteros sin perder un solo borde.
//
// Codificación: 5 columnas por glifo, un byte cada una; el bit 0 es la fila
// superior y el bit 6 la inferior. Es el formato estándar de las tablas
// "font5x7", así que añadir glifos nuevos es copiar una columna más.
const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;

const GLYPHS = {
  ' ': [0x00, 0x00, 0x00, 0x00, 0x00],
  '!': [0x00, 0x00, 0x5f, 0x00, 0x00],
  '-': [0x08, 0x08, 0x08, 0x08, 0x08],
  '.': [0x00, 0x00, 0x60, 0x00, 0x00],
  ':': [0x00, 0x00, 0x14, 0x00, 0x00],
  '/': [0x20, 0x10, 0x08, 0x04, 0x02],
  '%': [0x23, 0x13, 0x08, 0x64, 0x62],
  '(': [0x00, 0x1c, 0x22, 0x41, 0x00],
  ')': [0x00, 0x41, 0x22, 0x1c, 0x00],
  ',': [0x00, 0x50, 0x30, 0x00, 0x00],
  '+': [0x08, 0x08, 0x3e, 0x08, 0x08],
  '?': [0x02, 0x01, 0x51, 0x09, 0x06],
  '*': [0x14, 0x08, 0x3e, 0x08, 0x14],
  '=': [0x14, 0x14, 0x14, 0x14, 0x14],
  '>': [0x41, 0x22, 0x14, 0x08, 0x00],
  '<': [0x08, 0x14, 0x22, 0x41, 0x00],
  // La barra vertical la usa la franja de controles como separador desde el
  // principio; no tenía glifo, así que se dibujaba como un hueco (un carácter
  // desconocido no da error, simplemente no pinta nada).
  '|': [0x00, 0x00, 0x7f, 0x00, 0x00],

  // --- Botones frontales del mando ---------------------------------------
  // La lista de movimientos muestra el botón REAL, no un código tipo "LP", y
  // para eso hacen falta los cuatro símbolos de la cruceta frontal. Se
  // añaden como glifos de UN carácter (no como "[]" de dos) por una razón
  // práctica: así una secuencia de mando ocupa exactamente lo mismo que su
  // equivalente de teclado y las dos columnas quedan alineadas píxel a píxel.
  // Van dibujados en contorno, que es como se ven serigrafiados en el mando.
  '□': [0x3e, 0x22, 0x22, 0x22, 0x3e], // cuadrado (X en Xbox)
  '△': [0x30, 0x2c, 0x22, 0x2c, 0x30], // triángulo (Y)
  '✕': [0x22, 0x14, 0x08, 0x14, 0x22], // cruz (A)
  '○': [0x1c, 0x22, 0x22, 0x22, 0x1c], // círculo (B)
  '0': [0x3e, 0x51, 0x49, 0x45, 0x3e],
  1: [0x00, 0x42, 0x7f, 0x40, 0x00],
  2: [0x42, 0x61, 0x51, 0x49, 0x46],
  3: [0x21, 0x41, 0x45, 0x4b, 0x31],
  4: [0x18, 0x14, 0x12, 0x7f, 0x10],
  5: [0x27, 0x45, 0x45, 0x45, 0x39],
  6: [0x3c, 0x4a, 0x49, 0x49, 0x30],
  7: [0x01, 0x71, 0x09, 0x05, 0x03],
  8: [0x36, 0x49, 0x49, 0x49, 0x36],
  9: [0x06, 0x49, 0x49, 0x29, 0x1e],
  A: [0x7e, 0x11, 0x11, 0x11, 0x7e],
  B: [0x7f, 0x49, 0x49, 0x49, 0x36],
  C: [0x3e, 0x41, 0x41, 0x41, 0x22],
  D: [0x7f, 0x41, 0x41, 0x22, 0x1c],
  E: [0x7f, 0x49, 0x49, 0x49, 0x41],
  F: [0x7f, 0x09, 0x09, 0x09, 0x01],
  G: [0x3e, 0x41, 0x49, 0x49, 0x7a],
  H: [0x7f, 0x08, 0x08, 0x08, 0x7f],
  I: [0x00, 0x41, 0x7f, 0x41, 0x00],
  J: [0x20, 0x40, 0x41, 0x3f, 0x01],
  K: [0x7f, 0x08, 0x14, 0x22, 0x41],
  L: [0x7f, 0x40, 0x40, 0x40, 0x40],
  M: [0x7f, 0x02, 0x0c, 0x02, 0x7f],
  N: [0x7f, 0x04, 0x08, 0x10, 0x7f],
  O: [0x3e, 0x41, 0x41, 0x41, 0x3e],
  P: [0x7f, 0x09, 0x09, 0x09, 0x06],
  Q: [0x3e, 0x41, 0x51, 0x21, 0x5e],
  R: [0x7f, 0x09, 0x19, 0x29, 0x46],
  S: [0x46, 0x49, 0x49, 0x49, 0x31],
  T: [0x01, 0x01, 0x7f, 0x01, 0x01],
  U: [0x3f, 0x40, 0x40, 0x40, 0x3f],
  V: [0x1f, 0x20, 0x40, 0x20, 0x1f],
  W: [0x7f, 0x20, 0x18, 0x20, 0x7f],
  X: [0x63, 0x14, 0x08, 0x14, 0x63],
  Y: [0x07, 0x08, 0x70, 0x08, 0x07],
  Z: [0x61, 0x51, 0x49, 0x45, 0x43],
};

const LETTER_SPACING = 1; // columnas en blanco entre glifos (en píxeles de fuente)

// Ancho que ocupará un texto, en px de pantalla, con la escala dada. Lo
// necesita cualquiera que quiera centrarlo o alinearlo a la derecha.
export function measurePixelText(text, scale = 1) {
  const chars = String(text).toUpperCase();
  if (chars.length === 0) return 0;
  return chars.length * (GLYPH_WIDTH + LETTER_SPACING) * scale - LETTER_SPACING * scale;
}

export const PIXEL_FONT_HEIGHT = GLYPH_HEIGHT;

/**
 * Caracteres de `text` que la fuente NO sabe dibujar. Un carácter sin glifo
 * no da error: sale como un hueco. Los tests pasan por aquí todo el texto
 * fijo del juego (HUD, guía de la pausa) para que un acento no se cuele.
 */
export function missingGlyphs(text) {
  const missing = new Set();
  for (const char of String(text).toUpperCase()) {
    if (!GLYPHS[char]) missing.add(char);
  }
  return [...missing];
}

// Caché de textos ya rasterizados.
//
// Dibujar un glifo celda a celda cuesta hasta 35 `fillRect`, y con la sombra
// se duplica: una línea de estado de 29 caracteres son ~2000 fillRect POR
// FRAME. Medido en el render headless, era el 98% de todas las llamadas de
// dibujo del juego. Como el texto del HUD cambia rarísimamente, se rasteriza
// una vez a un canvas offscreen y a partir de ahí cada línea es un solo
// `drawImage`. El resultado en pantalla es idéntico (todo cae en posiciones
// enteras); lo único que cambia es el coste.
const textCache = new Map();
// 64 se quedaba corto desde que existe la lista de movimientos: hornear su
// panel rasteriza ~40 cadenas distintas de golpe y expulsaba del caché los
// textos del HUD (nombres, reloj, franja de controles), que SÍ se dibujan en
// cada frame — o sea que abrir el menú una vez encarecía el HUD para siempre.
// Con 192 caben el HUD, el selector y el panel entero a la vez.
const MAX_CACHED_TEXTS = 192;

function rasterizeText(chars, scale, color, shadow) {
  const width = measurePixelText(chars, scale);
  const offset = shadow ? scale : 0;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width + offset);
  canvas.height = Math.max(1, GLYPH_HEIGHT * scale + offset);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const passes = shadow
    ? [{ dx: offset, dy: offset, fill: 'rgba(0, 0, 0, 0.85)' }, { dx: 0, dy: 0, fill: color }]
    : [{ dx: 0, dy: 0, fill: color }];

  for (const pass of passes) {
    ctx.fillStyle = pass.fill;
    let penX = pass.dx;
    for (const char of chars) {
      const glyph = GLYPHS[char];
      if (glyph) {
        for (let col = 0; col < GLYPH_WIDTH; col += 1) {
          const bits = glyph[col];
          for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
            if (!(bits & (1 << row))) continue;
            ctx.fillRect(penX + col * scale, pass.dy + row * scale, scale, scale);
          }
        }
      }
      penX += (GLYPH_WIDTH + LETTER_SPACING) * scale;
    }
  }
  return canvas;
}

function getTextCanvas(chars, scale, color, shadow) {
  const key = `${chars}|${scale}|${color}|${shadow ? 1 : 0}`;
  const cached = textCache.get(key);
  if (cached) return cached;

  const canvas = rasterizeText(chars, scale, color, shadow);
  // Map conserva el orden de inserción, así que la primera clave es la más
  // antigua: basta con descartarla para acotar la caché.
  if (textCache.size >= MAX_CACHED_TEXTS) textCache.delete(textCache.keys().next().value);
  textCache.set(key, canvas);
  return canvas;
}

// Dibuja `text` con la esquina superior izquierda en (x, y). `scale` debe ser
// entero para que la rejilla siga cuadrando. `shadow` pinta una copia negra
// desplazada 1 píxel de fuente, que es lo que despega el texto del fondo en
// un HUD superpuesto al escenario.
export function drawPixelText(ctx, text, x, y, {
  scale = 1, color = '#ffffff', shadow = true, align = 'left', alpha = 1,
} = {}) {
  const chars = String(text).toUpperCase();
  if (chars.length === 0) return 0;
  const width = measurePixelText(chars, scale);

  let originX = Math.round(x);
  if (align === 'center') originX = Math.round(x - width / 2);
  else if (align === 'right') originX = Math.round(x - width);

  ctx.save();
  if (alpha < 1) ctx.globalAlpha = alpha;
  ctx.drawImage(getTextCanvas(chars, scale, color, shadow), originX, Math.round(y));
  ctx.restore();
  return width;
}
