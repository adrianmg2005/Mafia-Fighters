// Arte de los PROYECTILES en pixel art sobre rejilla y con alfa escalonado
// (como el humo de vfxManager): el cojín donut de la embestida y, del Modo
// Despertado, la nube del Puro Habanero, la gorra lanzada del Final Smash y
// la detonación del Nitro Gas. Presentación pura: todo sale del proyectil
// serializado (id, edad, dirección), así que las dos pantallas los dibujan
// igual. La onda del Final Smash sigue en main.js.

import { makeRng } from './pixelGrid.js';

const stepAlpha = (a) => Math.max(0, Math.min(1, Math.ceil(a * 4) / 4));
const SMOKE_TONES = ['#e6e3dc', '#c9c5bd', '#a39f97', '#7d7973'];
const CELL = 4;

// Un disco de humo en celdas de 4 px.
function smokeDisc(g, cx, cy, r, color) {
  g.fillStyle = color;
  for (let y = -r; y <= r; y += CELL) {
    const half = Math.sqrt(Math.max(0, r * r - y * y));
    const x0 = Math.round((cx - half) / CELL) * CELL;
    const x1 = Math.round((cx + half) / CELL) * CELL;
    if (x1 > x0) g.fillRect(x0, Math.round((cy + y) / CELL) * CELL, x1 - x0, CELL);
  }
}

/**
 * NUBE DEL PURO: masa de humo blanco y gris que ocupa su caja (w x h), con
 * bocanadas que ondulan despacio. Entra en 10 frames y se disipa en los 40
 * últimos de su vida.
 */
export function drawCigarCloud(g, p, kind) {
  const r = makeRng(1000 + p.id * 37);
  const fadeIn = Math.min(1, (p.age + 1) / 10);
  const fadeOut = Math.min(1, (kind.life - p.age) / 40);
  const alpha = stepAlpha(0.8 * Math.min(fadeIn, fadeOut));
  if (alpha <= 0) return;
  g.save();
  g.globalAlpha = alpha;
  const blobs = [];
  for (let i = 0; i < 26; i += 1) {
    blobs.push({
      x: p.x + (r() - 0.5) * kind.w * 0.8,
      y: p.y + (r() - 0.5) * kind.h * 0.7,
      rad: 22 + r() * 22,
      tone: Math.floor(r() * 3),
      phase: r() * Math.PI * 2,
    });
  }
  // De la sombra a la luz: primero los tonos oscuros (el fondo de la nube).
  for (const tone of [2, 1, 0]) {
    for (const b of blobs) {
      if (b.tone !== tone) continue;
      const sway = Math.sin(p.age * 0.05 + b.phase) * 6;
      smokeDisc(g, b.x + sway, b.y - Math.cos(p.age * 0.04 + b.phase) * 4, b.rad * Math.min(1, fadeIn + 0.3), SMOKE_TONES[tone]);
    }
  }
  g.restore();
}

/**
 * GORRA LANZADA: la del rapero (blanca, banda azul y la tira fucsia) girando
 * en el aire. Sin rotate(): alterna tres dibujos (de frente, de canto y del
 * revés) cada 3 frames.
 */
export function drawCapThrow(g, p) {
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  const view = Math.floor(p.age / 3) % 3;
  g.save();
  if (view === 1) {
    // De canto: una tira fina con la visera.
    g.fillStyle = '#c9c5b8';
    g.fillRect(x - 30, y - 4, 60, 8);
    g.fillStyle = '#2f5fc4';
    g.fillRect(x - 30, y - 1, 60, 3);
    g.fillStyle = '#ff2d8f';
    g.fillRect(x - 8, y - 4, 16, 3);
  } else {
    const flip = view === 2 ? -1 : 1;
    g.fillStyle = '#14100e';
    g.fillRect(x - 26, y - 20, 52, 26); // contorno de la cúpula
    g.fillStyle = '#f4f4f0';
    g.fillRect(x - 24, y - 18, 48, 22);
    g.fillStyle = '#2f5fc4';
    g.fillRect(x - 24, y - 2, 48, 6); // la banda
    g.fillRect(x - 3, y - 22, 6, 4); // el botón
    g.fillStyle = '#f4f4f0';
    g.fillRect(x + flip * 18 - (flip < 0 ? 26 : 0), y + 2, 26, 6); // visera
    g.fillStyle = '#ff2d8f';
    g.fillRect(x - flip * 20 - 7, y - 6, 14, 5); // la tira
  }
  // Estela de velocidad detrás.
  g.fillStyle = 'rgba(255, 210, 74, 0.5)';
  for (let i = 1; i <= 3; i += 1) g.fillRect(x - p.dir * (30 + i * 16) - 6, y - 8 + i * 4, 12, 4);
  g.restore();
}

/** DETONACIÓN NITRO: un fogonazo verde que se abre bajo los pies y se apaga. */
export function drawNitroBlast(g, p, kind) {
  const t = p.age / kind.life;
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = stepAlpha(1 - t);
  const rx = (kind.w / 2) * (0.6 + t * 0.6);
  const ry = (kind.h / 2) * (0.6 + t * 0.6);
  for (const [scale, color] of [[1, '#3f8c2e'], [0.7, '#7ed957'], [0.35, '#e8ffd0']]) {
    g.fillStyle = color;
    for (let y = -ry * scale; y <= ry * scale; y += CELL) {
      const half = rx * scale * Math.sqrt(Math.max(0, 1 - (y / (ry * scale)) ** 2));
      g.fillRect(Math.round(p.x - half), Math.round(p.y + y), Math.round(half * 2), CELL);
    }
  }
  g.restore();
}

// Elipse rellena en filas de 2 px.
function ellipseRows(g, cx, cy, rx, ry, color) {
  if (rx <= 0 || ry <= 0) return;
  g.fillStyle = color;
  for (let y = -ry; y < ry; y += 2) {
    const half = rx * Math.sqrt(Math.max(0, 1 - ((y + 1) / ry) ** 2));
    if (half >= 1) g.fillRect(Math.round(cx - half), Math.round(cy + y), Math.round(half * 2), 2);
  }
}

/**
 * COJÍN DONUT lanzado: gira hacia delante. Sin rotate(): el giro se lee
 * alternando la cara (glaseado rosa con el chorretón blanco y el agujero),
 * el canto (una rosquilla aplastada) y la panza (la masa), cada 3 frames.
 */
export function drawDonutProjectile(g, p) {
  const x = p.x;
  const y = p.y;
  const view = Math.floor(p.age / 3) % 4;
  g.save();
  if (view === 1 || view === 3) {
    // De canto: rosquilla aplastada, con el filo del glaseado.
    ellipseRows(g, x, y, 26, 11, '#14100e');
    ellipseRows(g, x, y, 25, 10, '#e3a560');
    ellipseRows(g, x, y - 3, 23, 5, view === 1 ? '#ff8fc8' : '#b0733a');
  } else {
    ellipseRows(g, x, y, 25, 21, '#14100e');
    ellipseRows(g, x, y, 24, 20, '#e3a560');
    if (view === 0) {
      ellipseRows(g, x, y - 1, 21, 16, '#ff8fc8'); // glaseado
      ellipseRows(g, x - 9, y - 10, 7, 3, '#ffc6e3'); // brillo
      // La crema blanca espesa: churretes que caen hasta la masa y goterones.
      g.fillStyle = '#fff4e4';
      for (const [dx, len] of [[-16, 12], [-7, 16], [4, 10], [12, 17]]) {
        g.fillRect(Math.round(x + dx), Math.round(y - 4), 4, len);
        g.fillRect(Math.round(x + dx - 1), Math.round(y - 4 + len), 6, 3);
      }
      for (const [dx, dy, rx, ry] of [[-9, -8, 8, 5], [6, -9, 9, 5], [14, -3, 6, 4]]) {
        ellipseRows(g, x + dx, y + dy + 1, rx, ry, '#e3d4c0');
        ellipseRows(g, x + dx, y + dy, rx, ry, '#fff4e4');
      }
    } else {
      ellipseRows(g, x, y + 2, 21, 14, '#b0733a'); // la panza de masa
    }
    ellipseRows(g, x, y - 1, 7, 5, '#14100e'); // el agujero
    ellipseRows(g, x, y - 1, 6, 4, '#6a3f1c');
  }
  g.restore();
}
