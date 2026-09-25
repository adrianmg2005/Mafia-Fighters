// CINEMÁTICA DE CORTE DEL MODO DESPERTAR (prototipo, tecla Ñ).
//
// Presentación pura: dibuja en espacio de pantalla lo que dice el estado de
// la simulación (`snap.cutin`: { slot, frame, total }). La simulación congela
// el combate los 120 frames; aquí solo se pinta, y todo es función del frame
// (partículas y temblor incluidos): las dos pantallas ven lo mismo.
//
// Línea de tiempo (frames de la cinemática):
//   0-3     ENTRADA: un tajo diagonal cruza la pantalla y va destapando la
//           franja detrás de él
//   4-5     fogonazo blanco dentro de la franja
//   6-57    fase 1: Samuel mecánico, de frente, serio; zoom lento 1.0 -> 1.08
//   58-59   MICRO-CONGELACIÓN: el zoom se para y la imagen se separa en rojo y
//           cian (aberración cromática)
//   60-61   fogonazo blanco: el corte
//   61      GOLPE DE ZOOM a 1.34 que se asienta en 1.25, con TEMBLOR de 4-6 px
//           durante 8 frames, y el ESTALLIDO de la estrella del ojo: líneas de
//           choque y partículas rojas que salen hacia los lados de la franja
//   61-119  fase 2: Samuel despertado; zoom lento y progresivo; la estrella
//           del ojo parpadea
//   tras 120  la franja se parte y se abre hacia los lados (`exit`)
//
// La franja: negra, con líneas de velocidad en degradado rojo oscuro que
// corren de derecha a izquierda, bordes superior e inferior DESGARRADOS
// (picos grandes, medianos y pequeños, estilo manga: una sierra regular se
// leía como una hoja de sierra), trazo rojo grueso irregular, reborde fino
// dorado y chispas en el filo. Fuera, la pantalla se oscurece (60%).

// Los tiempos son los de la SIMULACIÓN (que es la que congela y corta): un
// solo sitio, o el zoom y el corte del retrato podrían dejar de coincidir con
// la congelación.
import { AWAKEN_CUTIN_FRAMES, AWAKEN_CUT_FRAME } from './simulation.js';

export const CUTIN_FRAMES = AWAKEN_CUTIN_FRAMES;
export const CUTIN_CUT_FRAME = AWAKEN_CUT_FRAME;
export const CUTIN_EXIT_FRAMES = 12; // la salida es solo presentación
export const CUTIN_SLASH_FRAMES = 4;

const BAND_HALF = 122; // media altura de la franja (hasta la base de los picos)
const RED_EDGE = 5; // trazo rojo
const GOLD_EDGE = 2; // reborde dorado por fuera del rojo
const ART = 64; // el retrato se pinta en una rejilla de 64x64
const BASE_SCALE = 5; // ...y se escala x5 (320 px) antes del zoom
const ANCHOR = { x: 32, y: 30 }; // el punto del retrato que va al centro
const FREEZE_FROM = CUTIN_CUT_FRAME - 2; // 58: micro-congelación
const SHAKE_FROM = CUTIN_CUT_FRAME + 1; // 61: golpe de zoom y temblor
const SHAKE_FRAMES = 8;

// RNG sembrado (mulberry32): el desgarro, las líneas y las partículas son
// siempre los mismos. Nada de Math.random en una cinemática que ven dos
// pantallas.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Zoom del retrato en el frame `f` de la cinemática. */
export function cutinZoom(f) {
  if (f < FREEZE_FROM) return 1 + 0.08 * (f / CUTIN_CUT_FRAME);
  if (f < SHAKE_FROM) return 1 + (0.08 * (FREEZE_FROM - 1)) / CUTIN_CUT_FRAME; // congelado
  // Golpe: 1.34 en el 61 que se asienta en 1.25 en 3 frames, y luego el
  // acercamiento lento hasta el final.
  const settle = Math.max(0, 1 - (f - SHAKE_FROM) / 3);
  const slow = 0.08 * ((f - SHAKE_FROM) / (CUTIN_FRAMES - SHAKE_FROM));
  return 1.25 + 0.09 * settle + slow;
}

/** Temblor de la franja en el frame `f`: [dx, dy] de 4-6 px durante 8 frames. */
export function cutinShake(f) {
  const k = f - SHAKE_FROM;
  if (k < 0 || k >= SHAKE_FRAMES) return [0, 0];
  const mag = 6 - (2 * k) / (SHAKE_FRAMES - 1); // 6 -> 4
  const dx = Math.round(Math.sin(k * 2.7 + 0.5) * mag);
  const dy = Math.round(Math.cos(k * 3.3 + 1.1) * mag);
  // Nunca un frame quieto dentro del temblor: si los dos ejes redondean a
  // poco, el horizontal se lleva la magnitud entera.
  if (Math.hypot(dx, dy) < 4) return [Math.round(mag) * (k % 2 === 0 ? 1 : -1), dy];
  return [dx, dy];
}

/** ¿Se ve el destello rojo del ojo en el frame `f`? Parpadea: 8 frames encendido, 4 apagado. */
export function eyeGlintOn(f) {
  if (f <= CUTIN_CUT_FRAME) return false;
  return Math.floor((f - SHAKE_FROM) / 4) % 3 !== 2;
}

// --- Bordes desgarrados ---------------------------------------------------

/**
 * Perfil de un borde desgarrado: lista de puntos [x, altura] a lo ancho, con
 * picos de tres tamaños (grandes 24-34 px, medianos 12-20, pequeños 4-9)
 * mezclados, y el vértice de cada uno descentrado (desgarro, no diente).
 * Sembrado: siempre el mismo.
 */
export function tornEdge(width, seed) {
  const r = rng(seed);
  const pts = [[-40, 0]];
  let x = -40;
  while (x < width + 40) {
    const roll = r();
    let w;
    let hgt;
    if (roll < 0.22) {
      w = 26 + r() * 30;
      hgt = 24 + r() * 10; // grande
    } else if (roll < 0.62) {
      w = 14 + r() * 16;
      hgt = 12 + r() * 8; // mediano
    } else {
      w = 6 + r() * 8;
      hgt = 4 + r() * 5; // pequeño
    }
    const lean = 0.25 + r() * 0.5;
    pts.push([x + w * lean, hgt]);
    x += w;
    pts.push([x, r() < 0.3 ? 2 : 0]);
  }
  return pts;
}

let edges = null;
function getEdges(w) {
  if (!edges || edges.w !== w) edges = { w, top: tornEdge(w, 11), bottom: tornEdge(w, 29) };
  return edges;
}

// Silueta de la franja: picos hacia fuera por arriba y por abajo; `grow`
// ensancha la base y `spike` alarga los picos (para el rojo y el dorado).
function bandPath(ctx, cy, e, grow, spike = 1) {
  ctx.beginPath();
  const top = cy - BAND_HALF - grow;
  const bottom = cy + BAND_HALF + grow;
  const { top: t, bottom: b } = e;
  ctx.moveTo(t[0][0], top - t[0][1] * spike);
  for (const [x, hgt] of t) ctx.lineTo(x, top - hgt * spike);
  for (let i = b.length - 1; i >= 0; i -= 1) ctx.lineTo(b[i][0], bottom + b[i][1] * spike);
  ctx.closePath();
}

// --- Retratos (pixel art frontal, 64x64) -----------------------------------
//
// Los DOS retratos salen de la MISMA base (`drawFaceBase`): misma cabeza de
// mandíbula ancha, misma nariz, mismos ojos verdes y cejas
// pobladas, mismo tono de piel y el aro negro en la oreja izquierda de la
// imagen. Encima, lo que cambia: barba y pelo (el mecánico) o gorra, gafas y
// camiseta (el despertado). Antes cada retrato se dibujaba por separado y el
// despertado acababa con otra barbilla: parecían dos personas.

export const PORTRAIT_COLORS = {
  skin: '#c98a5c', skinDark: '#96603a', skinShadow: '#6d4225', skinLight: '#e6b487',
  hair: '#3a2213', hairDark: '#1f1109', hairLight: '#6a4428',
  beard: '#2e1b0d', beardDense: '#1f1208', beardLight: '#48301a',
  eyeWhite: '#f2e6d8', iris: '#7fb347', irisDark: '#557f2c', pupil: '#14100e', mouth: '#3a1a12',
  denim: '#243558', denimDark: '#162038', metal: '#9aa4b2',
  tee: '#e9f2ee', teeShade: '#bcc9c4', emblem: '#16161a',
  capWhite: '#f4f4f0', capShade: '#c9c5b8', capBlue: '#2f5fc4', strap: '#ff2d8f', strapLight: '#ff7ac0',
  wire: '#d9c27a', wireDark: '#8a7433', outline: '#14100e',
};
const C = PORTRAIT_COLORS;

function makeArt() {
  const canvas = document.createElement('canvas');
  canvas.width = ART;
  canvas.height = ART;
  const g = canvas.getContext('2d');
  const rect = (x, y, w, h, color) => {
    g.fillStyle = color;
    g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };
  const ellipse = (cx, cy, rx, ry, color, { fromY = -Infinity, toY = Infinity } = {}) => {
    g.fillStyle = color;
    for (let y = Math.floor(cy - ry); y < cy + ry; y += 1) {
      if (y < fromY || y >= toY) continue;
      const dy = (y + 0.5 - cy) / ry;
      if (Math.abs(dy) >= 1) continue;
      const half = rx * Math.sqrt(1 - dy * dy);
      const xa = Math.round(cx - half);
      const xb = Math.round(cx + half);
      if (xb > xa) g.fillRect(xa, y, xb - xa, 1);
    }
  };
  // Aro de 1 px (gafas redondas): las celdas cuya distancia al centro cae en
  // el anillo.
  const ring = (cx, cy, r, color) => {
    g.fillStyle = color;
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y += 1) {
      for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x += 1) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d >= r - 0.6 && d <= r + 0.6) g.fillRect(x, y, 1, 1);
      }
    }
  };
  return {
    canvas, rect, ellipse, ring,
  };
}

// Silueta de la cabeza: cráneo y una MANDÍBULA ANCHA casi cuadrada.
function headShape(ellipse, color, grow = 0) {
  ellipse(32, 25, 15 + grow, 16 + grow, color);
  ellipse(32, 35, 14.5 + grow, 11 + grow, color);
}

function drawFaceBase({ rect, ellipse }) {
  // Cuello.
  rect(23, 41, 18, 12, C.skinShadow);
  rect(25, 41, 14, 10, C.skinDark);
  // Orejas y el ARO NEGRO en la oreja de la izquierda de la imagen.
  ellipse(16.5, 30, 3, 4.5, C.skinDark);
  ellipse(47.5, 30, 3, 4.5, C.skinDark);
  ellipse(16.5, 30, 1.5, 2.5, C.skinShadow);
  ellipse(47.5, 30, 1.5, 2.5, C.skinShadow);
  rect(15, 34, 3, 1, C.outline);
  rect(14, 35, 1, 3, C.outline);
  rect(18, 35, 1, 3, C.outline);
  rect(15, 38, 3, 1, C.outline);
  rect(16, 35, 1, 1, '#e2e9f2'); // destello del aro
  // Cabeza: contorno, piel y la luz por la derecha.
  headShape(ellipse, C.outline, 0.6);
  headShape(ellipse, C.skin);
  rect(44, 21, 2, 18, C.skinLight);
  rect(18, 22, 2, 16, C.skinDark);
  // La línea de la MANDÍBULA ancha (la barba la tapa; afeitado se ve).
  rect(20, 43, 24, 1, C.skinDark);
  rect(18, 41, 2, 2, C.skinDark);
  rect(44, 41, 2, 2, C.skinDark);
  // Cejas POBLADAS: tres filas de alto, con el borde de arriba irregular.
  rect(19, 20, 9, 3, C.hairDark);
  rect(20, 19, 3, 1, C.hairDark);
  rect(25, 19, 2, 1, C.hairDark);
  rect(36, 20, 9, 3, C.hairDark);
  rect(37, 19, 2, 1, C.hairDark);
  rect(41, 19, 3, 1, C.hairDark);
  // Ojos VERDE CLARO (avellana brillante), con la fila de abajo más oscura
  // para que el iris no se funda con el blanco.
  for (const ex of [21, 37]) {
    rect(ex, 25, 7, 3, C.eyeWhite);
    rect(ex + 2, 25, 3, 3, C.iris);
    rect(ex + 2, 27, 3, 1, C.irisDark);
    rect(ex + 3, 26, 1, 1, C.pupil);
    rect(ex + 2, 25, 1, 1, C.eyeWhite); // brillo del ojo
    rect(ex, 28, 7, 1, C.skinDark);
    rect(ex, 24, 7, 1, C.skinShadow);
  }
  drawNose(rect, ellipse);
}

// Nariz con VOLUMEN: puente en sombra, la luz por un lado, punta ancha con su
// brillo y las dos aletas. Aparte porque la barba se pinta encima y la nariz
// tiene que volver a quedar DELANTE, idéntica en los dos retratos.
function drawNose(rect, ellipse) {
  rect(30, 26, 2, 7, C.skinDark);
  rect(33, 26, 1, 7, C.skinLight);
  ellipse(32, 33.5, 4, 2.2, C.skin);
  rect(32, 32, 2, 1, C.skinLight);
  rect(27, 34, 3, 2, C.skinShadow);
  rect(34, 34, 3, 2, C.skinShadow);
  rect(29, 35, 6, 1, C.skinShadow);
}

/** Retrato frontal de Samuel. `awakened`: el rapero, afeitado, gorra y gafas. */
export function drawPortrait(awakened) {
  const art = makeArt();
  const {
    canvas, rect, ellipse, ring,
  } = art;

  // Hombros y pecho (abajo del todo): el mono con los tirantes, o la camiseta
  // blanca con el emblema de la ola y la montaña.
  ellipse(32, 67, 32, 17, C.outline);
  if (awakened) {
    ellipse(32, 67, 31, 16, C.tee);
    ellipse(22, 64, 9, 6, C.teeShade);
    ellipse(32, 52, 7.5, 3.2, C.teeShade); // cuello de la camiseta
    ellipse(32, 51.5, 6, 2.5, C.skinDark);
    // EMBLEMA en negro (genérico): la montaña detrás y la ola rompiendo.
    const ex = 36;
    const ey = 58;
    for (let k = 0; k < 5; k += 1) rect(ex - k, ey - 4 + k, 1 + k * 2, 1, C.emblem); // montaña
    rect(ex - 7, ey + 1, 14, 1, C.emblem); // base
    rect(ex - 7, ey - 1, 2, 2, C.emblem); // cresta de la ola
    rect(ex - 6, ey - 3, 3, 2, C.emblem);
    rect(ex - 4, ey - 4, 2, 1, C.emblem);
    rect(ex - 3, ey - 3, 1, 1, C.tee); // el hueco del rizo de la ola
    rect(ex - 5, ey, 1, 1, C.tee);
  } else {
    ellipse(32, 67, 31, 16, C.skin);
    ellipse(22, 63, 8, 5, C.skinDark);
    rect(17, 52, 5, 12, C.denim);
    rect(42, 52, 5, 12, C.denim);
    rect(17, 52, 1, 12, C.denimDark);
    rect(42, 52, 1, 12, C.denimDark);
    rect(18, 60, 3, 2, C.metal);
    rect(43, 60, 3, 2, C.metal);
    for (const [x, y] of [[29, 55], [33, 56], [31, 58], [35, 58], [28, 59]]) rect(x, y, 1, 1, C.skinShadow);
  }

  drawFaceBase(art);

  if (!awakened) {
    // BARBA POBLADA con degradado: fina en las patillas y la parte alta de la
    // mejilla, densa en el mentón y la papada. Cubre la mandíbula ancha de la
    // base sin cambiar su forma.
    ellipse(32, 36, 14.6, 11.2, C.beard, { fromY: 31 });
    ellipse(32, 43, 11, 6.5, C.beardDense);
    rect(17, 21, 3, 12, C.beard);
    rect(44, 21, 3, 12, C.beard);
    for (const [x, y] of [[20, 31], [22, 32], [42, 31], [44, 32], [19, 29], [45, 29], [24, 33], [40, 33]]) rect(x, y, 1, 1, C.beardLight);
    // Mejillas limpias por encima (sin tocar los párpados de la fila 28) y la
    // nariz otra vez delante.
    ellipse(32, 31.5, 11.5, 3.5, C.skin, { fromY: 29 });
    drawNose(rect, ellipse);
    rect(26, 36, 12, 2, C.beard); // bigote
    rect(28, 39, 8, 1, C.mouth); // boca seria
    rect(29, 40, 6, 1, C.beardLight);
    // PELO rizado con volumen.
    ellipse(32, 13, 17.5, 10.5, C.outline, { toY: 18 });
    ellipse(32, 13, 17, 10, C.hair, { toY: 17 });
    for (const [x, y] of [[16, 15], [18, 9], [22, 5], [28, 3], [34, 3], [40, 5], [45, 9], [48, 15], [25, 9], [31, 7], [38, 9]]) {
      ellipse(x, y, 3.4, 3, C.hair);
      rect(x - 1, y - 2, 2, 1, C.hairLight);
      rect(x + 1, y + 1, 2, 1, C.hairDark);
    }
    ellipse(26, 16, 2.5, 2, C.hair);
    ellipse(37, 16.5, 2.5, 2, C.hair);
  } else {
    // AFEITADO: la mandíbula ancha de la base, limpia. Media sonrisa chulesca.
    rect(28, 39, 8, 1, C.mouth);
    rect(36, 38, 1, 1, C.mouth);
    rect(29, 40, 6, 1, C.skinDark);
    // La gorra RECOGE el pelo: los rizos solo asoman por DEBAJO de su borde,
    // cayendo por los lados sobre las orejas y las patillas (antes salían a
    // la altura del ala, por fuera de la tela, y la gorra parecía un parche).
    for (const [x, y] of [[17.5, 21.5], [46.5, 21.5], [16, 24], [48, 24], [18, 25.5], [46, 25.5]]) {
      ellipse(x, y, 2.4, 2.2, C.hair, { fromY: 20 });
      rect(x - 1, Math.max(20, y - 1), 1, 1, C.hairLight);
    }
    // GORRA HACIA ATRÁS, blanca con los paneles azules; en la frente, el hueco
    // de ajuste con la TIRA FUCSIA cruzándolo limpia sobre la piel.
    ellipse(32, 13, 18, 11, C.outline, { toY: 20 });
    ellipse(32, 13, 17, 10, C.capWhite, { toY: 19 });
    ellipse(20, 13, 6, 7, C.capBlue, { toY: 19 });
    ellipse(44, 13, 6, 7, C.capBlue, { toY: 19 });
    ellipse(38, 8, 5, 3, '#ffffff', { toY: 11 }); // brillo de la cúpula
    rect(31, 3, 2, 15, C.capShade); // costura central
    rect(30, 2, 4, 2, C.capBlue); // botón
    rect(15, 18, 34, 2, C.capShade); // borde de la gorra
    ellipse(32, 17, 7, 5, C.capShade, { fromY: 13, toY: 20 }); // costura del hueco
    ellipse(32, 17, 6, 4, C.skinDark, { fromY: 14, toY: 20 }); // la FRENTE en el hueco
    rect(25, 17, 14, 2, C.strap); // la TIRA fucsia
    rect(25, 17, 14, 1, C.strapLight);
    rect(31, 17, 2, 2, C.metal); // hebilla
    // GAFAS de montura REDONDA metálica fina: los ojos verdes se ven detrás.
    ring(24.5, 26.5, 4.6, C.wire);
    ring(40.5, 26.5, 4.6, C.wire);
    rect(29, 25, 7, 1, C.wire); // puente
    rect(15, 25, 5, 1, C.wireDark); // patillas
    rect(45, 25, 4, 1, C.wireDark);
    rect(21, 23, 2, 1, '#ffffff'); // reflejo en el cristal
    rect(37, 23, 2, 1, '#ffffff');
  }
  return canvas;
}

let portraits = null;
function getPortraits() {
  if (!portraits) portraits = { normal: drawPortrait(false), awakened: drawPortrait(true) };
  return portraits;
}

// Ojo izquierdo de la imagen, en la rejilla (el de la estrella).
const GLINT_AT = { x: 24.5, y: 26.5 };

// --- La cinemática --------------------------------------------------------

function drawSpeedLines(ctx, w, cy, f) {
  // Líneas de velocidad horizontales en degradado (rojo -> nada) que corren
  // de DERECHA a IZQUIERDA; en la fase 2, más rojas y más rápidas.
  const phase2 = f > CUTIN_CUT_FRAME;
  const r = rng(71);
  const speed = phase2 ? 64 : 30;
  for (let k = 0; k < 26; k += 1) {
    const y = cy - BAND_HALF + 6 + r() * (BAND_HALF * 2 - 12);
    const len = 120 + r() * 320;
    const thick = r() < 0.3 ? 3 : (r() < 0.6 ? 2 : 1);
    const span = w + len + 200;
    const x = (((r() * span - f * speed * (0.7 + r() * 0.6)) % span) + span) % span - len;
    // El degradado mira hacia la dirección del movimiento: la cabeza de la
    // línea (izquierda) brilla y la cola (derecha) se apaga.
    const g = ctx.createLinearGradient(x, 0, x + len, 0);
    g.addColorStop(0, phase2 ? 'rgba(255, 60, 60, 0.9)' : 'rgba(170, 30, 36, 0.8)');
    g.addColorStop(0.35, phase2 ? 'rgba(170, 16, 28, 0.7)' : 'rgba(96, 12, 20, 0.6)');
    g.addColorStop(1, 'rgba(40, 0, 6, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(len), thick);
  }
}

// Retrato teñido de un solo color (para la aberración cromática).
let tintCanvas = null;
function tinted(art, color) {
  if (!tintCanvas) {
    tintCanvas = document.createElement('canvas');
    tintCanvas.width = ART;
    tintCanvas.height = ART;
  }
  const g = tintCanvas.getContext('2d');
  g.clearRect(0, 0, ART, ART);
  g.globalCompositeOperation = 'source-over';
  g.drawImage(art, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, ART, ART);
  g.globalCompositeOperation = 'source-over';
  return tintCanvas;
}

function drawGlintBurst(ctx, gx, gy, f, w) {
  // ESTALLIDO de la estrella del ojo, en el golpe (61-75): líneas de choque
  // radiales que salen disparadas, sobre todo hacia los LADOS de la franja, y
  // partículas rojas sembradas.
  const k = f - SHAKE_FROM;
  if (k < 0 || k > 14) return;
  const u = k / 14;
  // Salida EXPLOSIVA (ease-out): en 3 frames las líneas ya han cruzado media
  // franja; con un avance lineal se quedaban alrededor de la cara.
  const reach = 1 - (1 - u) ** 2;
  const r = rng(97);
  for (let i = 0; i < 18; i += 1) {
    const side = i % 2 === 0 ? 0 : Math.PI; // abanico aplastado: a los lados
    const ang = side + (r() - 0.5) * 1.1;
    const inner = 30 + reach * (w * 0.5) * (0.6 + r() * 0.4);
    const len = (80 + r() * 180) * (1 - u * 0.5);
    const thick = r() < 0.4 ? 3 : 2;
    ctx.fillStyle = i % 3 === 0 ? '#ffffff' : '#ff2a3a';
    for (let d = 0; d < len; d += 3) {
      ctx.fillRect(Math.round(gx + Math.cos(ang) * (inner + d)), Math.round(gy + Math.sin(ang) * (inner + d) * 0.55), thick, thick);
    }
  }
  for (let i = 0; i < 40; i += 1) {
    const ang = r() * Math.PI * 2;
    const sp = 12 + r() * 30;
    const size = r() < 0.3 ? 5 : 3;
    ctx.fillStyle = r() < 0.25 ? '#ffd24a' : '#ff2233';
    ctx.fillRect(Math.round(gx + Math.cos(ang) * sp * k * 1.6), Math.round(gy + Math.sin(ang) * sp * k * 0.5), size, size);
  }
  // Anillo de choque alrededor del ojo.
  const rad = 18 + u * 110;
  ctx.fillStyle = '#ff5566';
  for (let a = 0; a < Math.PI * 2; a += 0.06) {
    ctx.fillRect(Math.round(gx + Math.cos(a) * rad), Math.round(gy + Math.sin(a) * rad * 0.7), 3, 3);
  }
}

function drawStar(ctx, gx, gy, scale, f) {
  const pulse = 1 + 0.35 * Math.sin((f - SHAKE_FROM) * 0.9);
  const long = Math.round(scale * 4.5 * pulse);
  const short = Math.round(scale * 2 * pulse);
  const t = Math.max(2, Math.round(scale * 0.8));
  ctx.fillStyle = '#ff2233';
  ctx.fillRect(gx - long, gy - t / 2, long * 2, t);
  ctx.fillRect(gx - t / 2, gy - long, t, long * 2);
  for (let d = t; d <= short; d += t) {
    for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) ctx.fillRect(gx + sx * d - t / 2, gy + sy * d - t / 2, t, t);
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(gx - t, gy - t, t * 2, t * 2);
}

/**
 * Dibuja la cinemática. `frame` 0..CUTIN_FRAMES mientras dura; con `exit`
 * (0..CUTIN_EXIT_FRAMES) dibuja la salida: la franja se abre hacia los lados.
 */
export function drawAwakenCutin(ctx, { frame, exit = null, viewport }) {
  const w = viewport.w;
  const h = viewport.h;
  const f = exit === null ? frame : CUTIN_FRAMES;
  const out = exit === null ? 0 : Math.min(1, exit / CUTIN_EXIT_FRAMES);
  const spread = out * out * (w * 0.6);
  const [shx, shy] = exit === null ? cutinShake(f) : [0, 0];
  const cy = Math.round(h / 2) + shy;
  const e = getEdges(w);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // Oscurecido fuera de la franja: crece con el tajo y se apaga en la salida.
  const dim = 0.6 * (1 - out) * Math.min(1, (f + 1) / CUTIN_SLASH_FRAMES);
  ctx.fillStyle = `rgba(0, 0, 0, ${dim.toFixed(3)})`;
  ctx.fillRect(0, 0, w, h);

  // ENTRADA: el tajo diagonal destapa la franja de izquierda a derecha en
  // CUTIN_SLASH_FRAMES frames. `reveal` es la x del tajo a la altura del centro.
  const slashing = exit === null && f < CUTIN_SLASH_FRAMES;
  const reveal = slashing ? ((f + 1) / CUTIN_SLASH_FRAMES) * (w + 400) - 200 : Infinity;
  const skew = 180; // el tajo se inclina 180 px de arriba a abajo
  const slashTop = cy - BAND_HALF - 50;
  const slashBottom = cy + BAND_HALF + 50;

  for (const side of [-1, 1]) {
    ctx.save();
    const halfX = side < 0 ? 0 : w / 2;
    // Primero se desplaza y DESPUÉS se recorta: el recorte viaja con su mitad.
    ctx.translate(side * spread + shx, 0);
    ctx.beginPath();
    ctx.rect(halfX, 0, w / 2, h);
    ctx.clip();
    if (slashing) {
      // Solo lo que el tajo ya ha cruzado (a la izquierda de la diagonal), en
      // tiras horizontales (el banco de pruebas solo recorta rectángulos).
      ctx.beginPath();
      const rows = 12;
      for (let i = 0; i < rows; i += 1) {
        const ya = slashTop + ((slashBottom - slashTop) * i) / rows;
        const xr = reveal + skew * (0.5 - i / rows);
        ctx.rect(-10, ya, Math.max(0, xr + 10), (slashBottom - slashTop) / rows + 1);
      }
      ctx.clip();
    }

    // Reborde dorado, trazo rojo grueso y el negro, cada uno con los picos
    // un poco más largos que el de dentro: el filo es irregular como el corte.
    ctx.fillStyle = '#ffcf3a';
    bandPath(ctx, cy, e, RED_EDGE + GOLD_EDGE, 1.3);
    ctx.fill();
    ctx.fillStyle = '#e8141e';
    bandPath(ctx, cy, e, RED_EDGE, 1.18);
    ctx.fill();
    ctx.fillStyle = '#000000';
    bandPath(ctx, cy, e, 0, 1);
    ctx.fill();

    // Chispas en el filo: celdas doradas y blancas que titilan.
    const sr = rng(53);
    for (let k = 0; k < 40; k += 1) {
      const sx = sr() * w;
      const top = sr() < 0.5;
      const sy = top ? cy - BAND_HALF - RED_EDGE - 2 - sr() * 20 : cy + BAND_HALF + RED_EDGE + 2 + sr() * 20;
      const tone = sr() < 0.5 ? '#fff1a8' : '#ffb000';
      if ((k + Math.floor(f / 2)) % 3 === 0) continue;
      ctx.fillStyle = tone;
      ctx.fillRect(Math.round(sx), Math.round(sy), 2, 2);
    }

    // Interior: líneas de velocidad y el retrato, recortados a la franja.
    ctx.save();
    ctx.beginPath();
    ctx.rect(-200, cy - BAND_HALF, w + 400, BAND_HALF * 2);
    ctx.clip();
    drawSpeedLines(ctx, w, cy, f);
    ctx.imageSmoothingEnabled = false;
    const art = f > CUTIN_CUT_FRAME ? getPortraits().awakened : getPortraits().normal;
    const scale = BASE_SCALE * cutinZoom(Math.min(f, CUTIN_FRAMES - 1));
    const size = Math.round(ART * scale);
    const px0 = Math.round(w / 2 - ANCHOR.x * scale);
    const py0 = Math.round(cy - ANCHOR.y * scale);
    if (f >= CUTIN_SLASH_FRAMES) {
      // MICRO-CONGELACIÓN (58-59): la imagen se separa en rojo y cian.
      if (exit === null && f >= FREEZE_FROM && f < CUTIN_CUT_FRAME) {
        const off = f === FREEZE_FROM ? 6 : 10;
        ctx.globalAlpha = 0.85;
        ctx.drawImage(tinted(art, '#ff2040'), 0, 0, ART, ART, px0 - off, py0, size, size);
        ctx.drawImage(tinted(art, '#20e8ff'), 0, 0, ART, ART, px0 + off, py0, size, size);
        ctx.globalAlpha = 1;
      }
      ctx.drawImage(art, 0, 0, ART, ART, px0, py0, size, size);
    }
    const gx = px0 + GLINT_AT.x * scale;
    const gy = py0 + GLINT_AT.y * scale;
    if (exit === null) drawGlintBurst(ctx, gx, gy, f, w);
    if (exit === null && eyeGlintOn(f)) drawStar(ctx, Math.round(gx), Math.round(gy), scale, f);

    // Fogonazos blancos: el de la entrada (4-5) y el del corte (60-61).
    let flash = 0;
    if (exit === null && (f === CUTIN_SLASH_FRAMES || f === CUTIN_CUT_FRAME)) flash = 0.9;
    if (exit === null && (f === CUTIN_SLASH_FRAMES + 1 || f === CUTIN_CUT_FRAME + 1)) flash = 0.45;
    if (flash > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${flash})`;
      ctx.fillRect(-200, cy - BAND_HALF, w + 400, BAND_HALF * 2);
    }
    ctx.restore();

    // El propio TAJO: una raya blanca diagonal con halo rojo, donde va el
    // corte en ese frame.
    if (slashing) {
      for (const [color, a, b] of [['#ff2a3a', 9, 5], ['#ffffff', 4, 1]]) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(reveal + skew / 2 - a, slashTop);
        ctx.lineTo(reveal + skew / 2 + b, slashTop);
        ctx.lineTo(reveal - skew / 2 + b, slashBottom);
        ctx.lineTo(reveal - skew / 2 - a, slashBottom);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }
  ctx.restore();
}
