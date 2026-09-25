// MENÚ DE PAUSA Y GUÍA DE COMBATE (ESC / START).
//
// La PAUSA en sí es estado de la simulación (engine/simulation.js): congela a
// los dos jugadores en el mismo frame y viaja en el snapshot, así que las dos
// pantallas la ven a la vez. Este módulo es solo lo LOCAL: qué pestaña y qué
// scroll mira cada jugador. No viaja por red — cada uno lee su guía a su ritmo
// — y no toca la simulación.
//
// Dos pestañas:
//   1. CONTROLES   teclado, mando y técnicas del género (buffer, tech, borde...)
//   2. MOVIMIENTOS la guía del personaje, con números DERIVADOS de su moveTable
//                  (ver engine/moveGuide.js)
//
// El panel se rasteriza a un canvas offscreen y se cachea por
// pestaña|scroll|quién pausó: mientras no se navega, dibujarlo cuesta UN
// drawImage (a 60 fps, ~60 textos por frame serían ~60 drawImage para nada).

import { drawPixelText } from './pixelFont.js';
import { buildGuide } from './moveGuide.js';

export const PANEL = {
  x: 100, y: 46, w: 1080, h: 628,
};
const PAD = 22;
const SCALE = 2;
const CHAR_W = 6 * SCALE; // 5 columnas de glifo + 1 de espacio
const LINE_H = 22;
const HEADER_H = 96; // título + pestañas
const FOOTER_H = 40;
export const VISIBLE_LINES = Math.floor((PANEL.h - HEADER_H - FOOTER_H) / LINE_H);

const BG = 'rgba(10, 10, 16, 0.88)'; // #0a0a10 al 88%
const COLORS = {
  border: '#e6e3dc',
  borderDark: '#000000',
  accent: '#e8a33d',
  heading: '#ffe27a',
  text: '#ffffff',
  dim: '#9aa1ab',
  key: '#8fd2ff',
  data: '#8cff96',
};

export const TABS = ['CONTROLES', 'MOVIMIENTOS'];

// Pestaña 1. [teclado, mando, qué hace]. Mayúsculas y sin acentos (fuente 5x7).
export const CONTROL_ROWS = [
  ['A / D', 'STICK', 'MOVER. DOBLE TOQUE = DASH. INVERTIR EN EL DASH = DASH DANCE'],
  ['W', 'X / Y', 'SALTAR. SOLTAR ANTES DEL DESPEGUE = SALTO CORTO. EN EL AIRE: DOBLE SALTO'],
  ['S', 'ABAJO', 'AGACHARSE. EN EL AIRE TRAS EL APICE: CAIDA RAPIDA. S + W EN UN TABLON: BAJAR'],
  ['U', 'A', 'NORMALES Y AEREOS (SEGUN LA DIRECCION)'],
  ['I', 'R2', 'SMASH. MANTENER = CARGAR HASTA 1 SEGUNDO (X1.4 DE DANO)'],
  ['O', 'B', 'ESPECIALES (SEGUN LA DIRECCION)'],
  ['J', 'L1', 'AGARRE'],
  ['ESPACIO/SHIFT', 'R1 / L2', 'ESCUDO. + DIRECCION = RODAR. + S = ESQUIVA. EN EL AIRE = ESQUIVA AEREA'],
  ['P', 'CLICK STICK', 'FINAL SMASH (CON EL MEDIDOR LLENO)'],
  ['ESC', 'START', 'PAUSA Y ESTA GUIA'],
  ['ENTER', 'SELECT', 'LISTO / REVANCHA'],
  ['M', '-', 'SONIDO ON/OFF'],
];

export const TECH_LINES = [
  'BUFFER: LO QUE PULSES HASTA 6 FRAMES ANTES DE PODER ACTUAR SALE SOLO, SIN PERDER UN FRAME.',
  'AEREOS: SI ATERRIZAS DESPUES DE SUS FRAMES ACTIVOS SOLO HAY 4 FRAMES DE LAG (AUTOCANCEL).',
  'TECH: ESCUDO JUSTO ANTES DE CHOCAR DANDO TUMBOS = TE LEVANTAS AL INSTANTE (CON DIRECCION RUEDAS).',
  'BORDE: W SUBE, U ATACA, ESCUDO RUEDA, S O ATRAS TE SUELTA. 30 FRAMES INVULNERABLE AL AGARRARLO.',
  'BORDE ROBADO: AGARRA UN BORDE OCUPADO Y EXPULSAS AL QUE COLGABA, 14 FRAMES SIN ACTUAR. SUELTATE Y CASTIGA CON UN AEREO.',
  'DI: AL SALIR DISPARADO MANTEN UNA DIRECCION PERPENDICULAR AL GOLPE: GIRA TU VUELO HASTA 18 GRADOS. APUNTA AL ESCENARIO.',
  'ESCUDO: CADA GOLPE PARADO TE BLOQUEA DANO X 0.8 + 3 FRAMES. A BOCAJARRO TE AGARRAN AL SALIR: ESPACIA TUS ATAQUES.',
  'PORCENTAJE: CUANTO MAS ALTO, MAS LEJOS VUELAS. SALIR POR UNA BLAST ZONE CUESTA UN STOCK.',
];

/** Parte `text` en líneas de como mucho `maxChars` caracteres, por palabras. */
export function wrapText(text, maxChars) {
  const words = String(text).split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const INNER_W = PANEL.w - PAD * 2;
// Columnas de la pestaña CONTROLES (en px dentro del panel).
const CTRL_COLS = { key: 0, pad: 190, desc: 360 };
const CTRL_DESC_CHARS = Math.floor((INNER_W - CTRL_COLS.desc) / CHAR_W);
// Columnas de la pestaña MOVIMIENTOS.
export const MOVE_COLS = {
  input: 0, name: 210, damage: 594, startup: 718, charge: 800,
};
const TIP_INDENT = 24;
export const TIP_CHARS = Math.floor((INNER_W - TIP_INDENT) / CHAR_W);

// Cada línea es una lista de segmentos { text, x, color }.
function controlLines() {
  const lines = [[
    { text: 'TECLADO', x: CTRL_COLS.key, color: COLORS.heading },
    { text: 'MANDO', x: CTRL_COLS.pad, color: COLORS.heading },
    { text: 'ACCION', x: CTRL_COLS.desc, color: COLORS.heading },
  ]];
  for (const [key, pad, desc] of CONTROL_ROWS) {
    wrapText(desc, CTRL_DESC_CHARS).forEach((part, i) => {
      lines.push([
        ...(i === 0 ? [
          { text: key, x: CTRL_COLS.key, color: COLORS.key },
          { text: pad, x: CTRL_COLS.pad, color: COLORS.key },
        ] : []),
        { text: part, x: CTRL_COLS.desc, color: COLORS.text },
      ]);
    });
  }
  lines.push([]);
  lines.push([{ text: 'TECNICA', x: 0, color: COLORS.heading }]);
  for (const tip of TECH_LINES) {
    wrapText(tip, TIP_CHARS).forEach((part, i) => {
      lines.push([{ text: part, x: i === 0 ? 0 : TIP_INDENT, color: COLORS.text }]);
    });
  }
  return lines;
}

function moveLines(config) {
  const lines = [];
  for (const section of buildGuide(config)) {
    if (lines.length) lines.push([]);
    lines.push([
      { text: section.title, x: 0, color: COLORS.heading },
      { text: 'DANO', x: MOVE_COLS.damage, color: COLORS.dim },
      { text: 'SALE', x: MOVE_COLS.startup, color: COLORS.dim },
    ]);
    for (const row of section.rows) {
      lines.push([
        { text: row.input, x: MOVE_COLS.input, color: COLORS.key },
        { text: row.name, x: MOVE_COLS.name, color: COLORS.text },
        { text: row.damage, x: MOVE_COLS.damage, color: COLORS.data },
        { text: row.startup, x: MOVE_COLS.startup, color: COLORS.data },
        { text: row.charge, x: MOVE_COLS.charge, color: COLORS.accent },
      ]);
      for (const part of wrapText(row.tip, TIP_CHARS)) {
        lines.push([{ text: part, x: TIP_INDENT, color: COLORS.dim }]);
      }
    }
  }
  return lines;
}

/** Todas las líneas de una pestaña (lo usan el dibujo, el scroll y los tests). */
export function tabLines(tab, config) {
  return tab === 0 ? controlLines() : moveLines(config);
}

export class PauseMenu {
  constructor() {
    this.tab = 0;
    this.scroll = 0;
    this.wasPaused = false;
    this.prev = {};
    this.cacheKey = null;
    this.canvas = null;
  }

  maxScroll(config) {
    return Math.max(0, tabLines(this.tab, config).length - VISIBLE_LINES);
  }

  scrollBy(lines, config) {
    this.scroll = Math.max(0, Math.min(this.maxScroll(config), this.scroll + lines));
  }

  /**
   * Navegación LOCAL con el input de este cliente. `paused` viene del
   * snapshot: el menú se abre y se cierra con la pausa de la simulación.
   * Devuelve true si ha cambiado algo (para el sonido del cursor).
   */
  update(paused, input, config) {
    const edge = (k) => !!input[k] && !this.prev[k];
    let moved = false;
    if (!paused) {
      this.wasPaused = false;
    } else {
      if (!this.wasPaused) {
        // Cada pausa abre en la guía de controles, arriba del todo.
        this.tab = 0;
        this.scroll = 0;
        this.wasPaused = true;
      }
      if (edge('left') || edge('right')) {
        this.tab = (this.tab + 1) % TABS.length;
        this.scroll = 0;
        moved = true;
      }
      if (edge('down')) {
        this.scrollBy(1, config);
        moved = true;
      }
      if (edge('up')) {
        this.scrollBy(-1, config);
        moved = true;
      }
    }
    this.prev = { ...input };
    return moved;
  }

  draw(ctx, {
    viewport, config, pausedBy, mySlot, frame = 0,
  }) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Velo sobre el mundo congelado: lo que hay detrás se ve, pero no compite.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(0, 0, viewport.w, viewport.h);
    const key = `${config.id}|${this.tab}|${this.scroll}|${pausedBy}|${mySlot}`;
    if (key !== this.cacheKey || !this.canvas) {
      this.canvas = this.render(config, pausedBy, mySlot);
      this.cacheKey = key;
    }
    ctx.drawImage(this.canvas, PANEL.x, PANEL.y);
    // El parpadeo del aviso de reanudar va fuera del caché: si fuera dentro,
    // el panel se re-rasterizaría cada pocos frames.
    if (Math.floor(frame / 30) % 2 === 0) {
      const canResume = pausedBy === mySlot;
      drawPixelText(ctx, canResume ? 'ESC / START: REANUDAR' : `SOLO ${String(pausedBy).toUpperCase()} PUEDE REANUDAR`,
        PANEL.x + PANEL.w - PAD, PANEL.y + PANEL.h - 28, {
          scale: SCALE, color: COLORS.accent, align: 'right',
        });
    }
    ctx.restore();
  }

  render(config, pausedBy) {
    const canvas = document.createElement('canvas');
    canvas.width = PANEL.w;
    canvas.height = PANEL.h;
    const g = canvas.getContext('2d');
    g.imageSmoothingEnabled = false;

    // Marco retro nítido: negro, filo claro y un filo de acento por dentro.
    g.fillStyle = COLORS.borderDark;
    g.fillRect(0, 0, PANEL.w, PANEL.h);
    g.fillStyle = COLORS.border;
    g.fillRect(4, 4, PANEL.w - 8, PANEL.h - 8);
    g.fillStyle = COLORS.accent;
    g.fillRect(8, 8, PANEL.w - 16, PANEL.h - 16);
    g.clearRect(10, 10, PANEL.w - 20, PANEL.h - 20);
    g.fillStyle = BG;
    g.fillRect(10, 10, PANEL.w - 20, PANEL.h - 20);

    const name = String(config.name).toUpperCase();
    drawPixelText(g, `PAUSA - GUIA DE COMBATE: ${name}`, PANEL.w / 2, 24, {
      scale: 3, color: COLORS.heading, align: 'center',
    });

    // Pestañas.
    let tx = PAD;
    TABS.forEach((label, i) => {
      const text = `${i + 1} ${label}`;
      const w = text.length * CHAR_W + 28;
      const active = i === this.tab;
      g.fillStyle = active ? COLORS.accent : '#2a2a36';
      g.fillRect(tx, 58, w, 28);
      drawPixelText(g, text, tx + 14, 65, {
        scale: SCALE, color: active ? '#0a0a10' : COLORS.dim, shadow: false,
      });
      tx += w + 12;
    });
    g.fillStyle = COLORS.accent;
    g.fillRect(PAD, 86, PANEL.w - PAD * 2, 2);

    // Contenido con scroll.
    const lines = tabLines(this.tab, config);
    const visible = lines.slice(this.scroll, this.scroll + VISIBLE_LINES);
    visible.forEach((segments, i) => {
      const y = HEADER_H + i * LINE_H;
      for (const seg of segments) {
        if (!seg.text) continue;
        drawPixelText(g, seg.text, PAD + seg.x, y, { scale: SCALE, color: seg.color });
      }
    });

    // Barra de scroll: cuánto queda por debajo y por encima.
    if (lines.length > VISIBLE_LINES) {
      const trackY = HEADER_H;
      const trackH = VISIBLE_LINES * LINE_H;
      const thumbH = Math.max(20, Math.round((trackH * VISIBLE_LINES) / lines.length));
      const maxScroll = lines.length - VISIBLE_LINES;
      const thumbY = trackY + Math.round(((trackH - thumbH) * this.scroll) / maxScroll);
      g.fillStyle = '#2a2a36';
      g.fillRect(PANEL.w - 18, trackY, 6, trackH);
      g.fillStyle = COLORS.accent;
      g.fillRect(PANEL.w - 18, thumbY, 6, thumbH);
    }

    g.fillStyle = COLORS.accent;
    g.fillRect(PAD, PANEL.h - FOOTER_H - 4, PANEL.w - PAD * 2, 2);
    drawPixelText(g, `A/D PESTANA   W/S O RUEDA DESPLAZAR   PAUSADO POR ${String(pausedBy).toUpperCase()}`,
      PAD, PANEL.h - 28, { scale: SCALE, color: COLORS.dim });
    return canvas;
  }
}

