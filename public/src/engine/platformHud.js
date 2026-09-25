// HUD DEL PLATFORM FIGHTER: porcentaje, stocks, medidor de Final Smash,
// burbujas de "fuera de pantalla" y carteles del flujo de partida.
//
// Todo en espacio de pantalla (1280x720) y con la fuente de mapa de bits: una
// tipografía vectorial se rasteriza con antialias y queda borrosa al lado del
// pixel art. No guarda estado: lee las vistas y el snapshot, y pinta.

import { drawPixelText, measurePixelText, PIXEL_FONT_HEIGHT } from './pixelFont.js';
import { SLOT_COLORS } from './renderer.js';

const PANEL_W = 300;
const PANEL_H = 104;
const PANEL_Y = 604;
const PANEL_CENTERS = { p1: 440, p2: 840 };

/**
 * Color del porcentaje: blanco -> amarillo -> naranja -> rojo -> granate, como
 * en Smash. Es la lectura más importante del HUD — de un vistazo dice cuánto
 * falta para que un golpe fuerte mate — así que el tono cambia de forma
 * continua y no por escalones.
 */
export function percentColor(percent) {
  const stops = [
    [0, [255, 255, 255]],
    [50, [255, 226, 90]],
    [100, [255, 138, 43]],
    [150, [226, 40, 30]],
    [220, [128, 14, 20]],
  ];
  let a = stops[0];
  let b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i += 1) {
    if (percent >= stops[i][0] && percent <= stops[i + 1][0]) {
      a = stops[i];
      b = stops[i + 1];
      break;
    }
  }
  if (percent > stops[stops.length - 1][0]) a = b;
  const t = b[0] === a[0] ? 0 : (percent - a[0]) / (b[0] - a[0]);
  const c = a[1].map((v, i) => Math.round(v + (b[1][i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function drawPlate(ctx, x, y, w, h, color) {
  ctx.fillStyle = 'rgba(8, 8, 14, 0.78)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, 4);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.fillRect(x, y + 4, w, 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(x, y + h - 2, w, 2);
}

// Icono de stock: la cabeza del propio sprite recortada del atlas (frame 0 del
// idle). Así un personaje nuevo trae su icono gratis y no puede no parecerse.
function drawStockIcon(ctx, animator, x, y, alive) {
  const anim = animator?.animations?.idle;
  if (!anim) return;
  const frame = animator.frames[anim.frameIndices[0]];
  const size = 34;
  const sx = frame.sx + frame.pivotX - size / 2;
  const sy = frame.sy + frame.pivotY - 122;
  ctx.save();
  if (!alive) ctx.globalAlpha = 0.22;
  // El atlas perezoso (Modo Despertar) guarda cada frame en su propio lienzo.
  ctx.drawImage(frame.image ?? animator.image, sx, sy, size, size, x, y, size, size);
  ctx.restore();
}

function drawPanel(ctx, view, animator, frame) {
  const cx = PANEL_CENTERS[view.slot];
  const x = cx - PANEL_W / 2;
  const slotColor = SLOT_COLORS[view.slot];
  drawPlate(ctx, x, PANEL_Y, PANEL_W, PANEL_H, slotColor);

  drawPixelText(ctx, view.slot.toUpperCase(), x + 12, PANEL_Y + 14, { scale: 2, color: slotColor });
  drawPixelText(ctx, view.name, x + 48, PANEL_Y + 14, { scale: 2, color: view.color });

  // Stocks: uno por vida, los perdidos en gris.
  for (let i = 0; i < 3; i += 1) {
    drawStockIcon(ctx, animator, x + 12 + i * 38, PANEL_Y + 34, i < view.stocks);
  }

  // PORCENTAJE: entero grande + décima pequeña, como en Smash. Da un
  // pequeño salto al recibir daño (hitFlash viaja en la vista).
  const shown = view.visible ? view.percent : 0;
  const whole = Math.floor(shown);
  const tenth = Math.floor((shown - whole) * 10);
  const scale = 7;
  const bump = view.hitFlash > 0 ? 3 : 0;
  const color = percentColor(shown);
  const wholeText = String(whole);
  const wholeW = measurePixelText(wholeText, scale);
  const right = x + PANEL_W - 16;
  const tenthText = `.${tenth}%`;
  const tenthW = measurePixelText(tenthText, 3);
  drawPixelText(ctx, wholeText, right - tenthW - 4 - wholeW + (bump ? 2 : 0), PANEL_Y + 22 - bump, { scale, color });
  drawPixelText(ctx, tenthText, right - tenthW, PANEL_Y + 22 + scale * PIXEL_FONT_HEIGHT - 3 * PIXEL_FONT_HEIGHT, {
    scale: 3, color,
  });

  // Medidor de Final Smash.
  const meterW = PANEL_W - 24;
  const ratio = Math.min(1, view.meter / view.meterMax);
  const my = PANEL_Y + PANEL_H - 16;
  ctx.fillStyle = '#1b1b26';
  ctx.fillRect(x + 12, my, meterW, 8);
  const full = ratio >= 1;
  const pulse = Math.floor(frame / 6) % 2 === 0;
  ctx.fillStyle = full ? (pulse ? '#fff6c8' : '#ffc73a') : '#2f8fd8';
  ctx.fillRect(x + 12, my, Math.round(meterW * ratio), 8);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  for (let i = 1; i < 10; i += 1) ctx.fillRect(x + 12 + Math.round((meterW * i) / 10), my, 1, 8);
  if (full) {
    drawPixelText(ctx, 'FINAL SMASH: P', cx, my - 14, {
      scale: 1, color: pulse ? '#fff6c8' : '#ffc73a', align: 'center',
    });
  }
  // Carga guardada del Eructo Sónico (1-3 burbujas verdes).
  for (let i = 0; i < view.storedCharge; i += 1) {
    ctx.fillStyle = '#7ed957';
    ctx.fillRect(x + 132 + i * 12, PANEL_Y + 46, 8, 8);
  }
}

export function drawPercentPanels(ctx, views, animators, frame) {
  for (const v of views) drawPanel(ctx, v, animators[v.slot], frame);
}

// --- Fuera de pantalla -------------------------------------------------------
// Cuando alguien sale del encuadre (lanzado hacia una blast zone) se le pinta
// una burbuja en el borde con su sprite en miniatura, como la lupa de Smash:
// sin ella, el jugador no sabe si está recuperando o si va a morir.
export function drawOffscreenBubbles(ctx, views, animators, camera, viewport) {
  const rect = camera.viewRect();
  for (const v of views) {
    if (!v.visible) continue;
    const cy = v.y - v.bodyHeight / 2;
    const inside = v.x >= rect.x && v.x <= rect.x + rect.w && cy >= rect.y && cy <= rect.y + rect.h;
    if (inside) continue;
    const p = camera.worldToScreen(v.x, cy);
    const r = 40;
    const bx = Math.max(r + 8, Math.min(viewport.w - r - 8, p.x));
    const by = Math.max(r + 8, Math.min(viewport.h - r - 8, p.y));
    ctx.save();
    ctx.fillStyle = 'rgba(10, 10, 16, 0.8)';
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = SLOT_COLORS[v.slot];
    ctx.stroke();
    ctx.clip();
    const animator = animators[v.slot];
    if (animator) {
      ctx.translate(bx, by + 26);
      ctx.scale(0.45, 0.45);
      animator.draw(ctx, 0, 0, v.facing, { alpha: 1 });
    }
    ctx.restore();
    drawPixelText(ctx, `${Math.floor(v.percent)}%`, bx, by + r + 4, {
      scale: 2, color: percentColor(v.percent), align: 'center',
    });
  }
}

// --- Flujo de partida ----------------------------------------------------------

function banner(ctx, text, viewport, {
  scale = 16, color = '#ffffff', y = null, alpha = 1,
} = {}) {
  const h = PIXEL_FONT_HEIGHT * scale;
  drawPixelText(ctx, text, viewport.w / 2, y ?? viewport.h / 2 - h / 2 - 40, {
    scale, color, align: 'center', alpha,
  });
}

export function drawFlowOverlay(ctx, snap, viewport, { mySlot = null } = {}) {
  const { phase, phaseFrame } = snap;
  switch (phase) {
    case 'lobby': {
      const lines = snap.opponentPresent
        ? 'CALENTAMIENTO - ENTER CUANDO ESTES LISTO'
        : 'PRACTICA EN SOLITARIO (P2 ES UN MUNECO) - ENTER PARA EMPEZAR';
      drawPixelText(ctx, lines, viewport.w / 2, 70, { scale: 2, color: '#ffe27a', align: 'center' });
      const ready = ['p1', 'p2']
        .filter((s) => s === 'p1' || snap.opponentPresent)
        .map((s) => `${s.toUpperCase()}: ${snap.ready[s] ? 'LISTO' : '...'}`)
        .join('    ');
      drawPixelText(ctx, ready, viewport.w / 2, 94, { scale: 2, color: '#ffffff', align: 'center' });
      break;
    }
    case 'countdown': {
      const n = Math.max(1, 3 - Math.floor((phaseFrame - 1) / 60));
      const local = ((phaseFrame - 1) % 60) / 60;
      banner(ctx, String(n), viewport, { scale: 22 - Math.round(local * 6), color: '#ffe27a' });
      break;
    }
    case 'fight':
      if (phaseFrame < 50) banner(ctx, 'GO!', viewport, { scale: 18, color: '#8cff96', alpha: 1 - phaseFrame / 60 });
      break;
    case 'game':
      banner(ctx, 'GAME!', viewport, { scale: 18, color: '#ffffff' });
      break;
    case 'results':
      drawResults(ctx, snap, viewport, mySlot);
      break;
    default:
      break;
  }
}

function drawResults(ctx, snap, viewport) {
  ctx.fillStyle = 'rgba(6, 6, 12, 0.72)';
  ctx.fillRect(0, 0, viewport.w, viewport.h);
  const winner = snap.fighters.find((f) => f.slot === snap.winner);
  const title = winner ? `GANA ${winner.slot.toUpperCase()} (${winner.name.toUpperCase()})` : 'EMPATE';
  drawPixelText(ctx, title, viewport.w / 2, 110, {
    scale: 6, color: winner ? SLOT_COLORS[winner.slot] : '#ffffff', align: 'center',
  });
  const columns = { p1: viewport.w / 2 - 220, p2: viewport.w / 2 + 220 };
  for (const f of snap.fighters) {
    const x = columns[f.slot];
    drawPixelText(ctx, f.slot.toUpperCase(), x, 220, { scale: 4, color: SLOT_COLORS[f.slot], align: 'center' });
    drawPixelText(ctx, `K.O.: ${f.stats.kos}`, x, 270, { scale: 3, color: '#ffffff', align: 'center' });
    drawPixelText(ctx, `CAIDAS: ${f.stats.falls}`, x, 300, { scale: 3, color: '#ffffff', align: 'center' });
    drawPixelText(ctx, `DANO: ${Math.round(f.stats.damageDealt)}%`, x, 330, { scale: 3, color: '#ffffff', align: 'center' });
    const ready = snap.ready[f.slot];
    if (f.slot === 'p1' || snap.opponentPresent) {
      drawPixelText(ctx, ready ? 'REVANCHA!' : 'ENTER: REVANCHA', x, 390, {
        scale: 2, color: ready ? '#8cff96' : '#b9c0c9', align: 'center',
      });
    }
  }
}

/** Barras de cine y apagón de la cinemática del Final Smash. */
export function drawCinematicFrame(ctx, cine, viewport) {
  if (!cine) return;
  const t = Math.min(1, cine.frame / 8);
  const bar = Math.round(80 * t);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, viewport.w, bar);
  ctx.fillRect(0, viewport.h - bar, viewport.w, bar);
  if (cine.frame > cine.total / 3) {
    drawPixelText(ctx, 'BATALLA DE GALLOS', viewport.w / 2, viewport.h - 60, {
      scale: 4, color: '#ffc73a', align: 'center',
    });
  }
}
