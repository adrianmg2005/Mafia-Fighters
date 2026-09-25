import { drawPixelText, measurePixelText, PIXEL_FONT_HEIGHT } from './pixelFont.js';

// Franja de controles y panel de debug.
//
// Un solo esquema de control para todos los clientes: a qué luchador mueve el
// input lo decide el ROL que asigna el servidor, no las teclas (ver
// engine/inputManager.js). La franja va ARRIBA: abajo están los paneles de
// porcentaje, que son lo que hay que poder leer en mitad de un combate.
//
// Ojo: la fuente solo tiene A-Z, 0-9 y unos pocos símbolos, así que todo el
// texto va en mayúsculas y sin acentos (un carácter sin glifo se dibuja como
// hueco, no da error).
const CONTROLS_LINE_2 = 'U NORMAL/AEREO  I SMASH (MANTENER=CARGA)  O ESPECIAL  J AGARRE  ESPACIO ESCUDO  P FINAL SMASH';

let debugEnabled = false;

// F1 o Tab alternan el panel de debug; se evita el comportamiento por defecto
// (Tab cambia el foco, F1 abre la ayuda del navegador).
export function initDebugToggle() {
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'F1' && e.code !== 'Tab') return;
    e.preventDefault();
    if (e.repeat) return;
    debugEnabled = !debugEnabled;
  });
}

export function isDebugEnabled() {
  return debugEnabled;
}

const ROLE_LABELS = { p1: 'P1', p2: 'P2', spectator: 'ESPECTADOR' };

// `focused` la atenúa cuando la ventana no tiene el foco: es el aviso que
// hace usable probar con dos pestañas en el mismo PC.
export function drawControlsBar(ctx, width, { role, focused = true, muted = false } = {}) {
  const label = role ? ROLE_LABELS[role] || role.toUpperCase() : '---';
  const line1 = `ROL: ${label} | A/D MOVER (2 TOQUES = DASH)  W SALTO  S AGACHAR/BAJAR | ESC PAUSA/GUIA | ENTER LISTO | M SONIDO: ${muted ? 'OFF' : 'ON'}`;
  const alpha = focused ? 0.9 : 0.32;
  drawPixelText(ctx, line1, 10, 8, {
    scale: 1, color: focused ? '#8cff96' : '#ffffff', alpha,
  });
  drawPixelText(ctx, CONTROLS_LINE_2, 10, 8 + PIXEL_FONT_HEIGHT + 4, {
    scale: 1, color: '#ffffff', alpha: focused ? 0.75 : 0.32,
  });
}

export function drawStatusMessage(ctx, width, message, { y = 130 } = {}) {
  if (!message) return;
  const scale = 2;
  const textWidth = measurePixelText(message, scale);
  const h = PIXEL_FONT_HEIGHT * scale;
  ctx.save();
  ctx.fillStyle = 'rgba(5, 4, 10, 0.82)';
  ctx.fillRect(width / 2 - textWidth / 2 - 10, y - 8, textWidth + 20, h + 16);
  ctx.fillStyle = '#6d7484';
  ctx.fillRect(width / 2 - textWidth / 2 - 10, y - 8, textWidth + 20, 2);
  ctx.restore();
  drawPixelText(ctx, message, width / 2, y, { scale, color: '#ffe27a', align: 'center' });
}

// Panel de debug (F1/Tab): estado de la simulación de cada luchador. Es lo
// primero que hay que mirar si dos pantallas discrepan.
export function drawDebugOverlay(ctx, width, height, { views, fps, snap }) {
  if (!debugEnabled) return;
  const lineH = 14;
  const panelH = 24 + views.length * lineH * 2;
  const y0 = height - panelH - 120;
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
  ctx.fillRect(0, y0, width, panelH);
  ctx.font = '12px monospace';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#7cfc7c';
  ctx.fillText(`FPS ${fps.toFixed(0)}  frame ${snap.frame}  fase ${snap.phase}:${snap.phaseFrame}  hitlag ${snap.hitlag}`
    + `  proyectiles ${snap.projectiles.length}${snap.cine ? `  CINE ${snap.cine.frame}/${snap.cine.total}` : ''}`, 8, y0 + 6);
  views.forEach((v, i) => {
    const y = y0 + 24 + i * lineH * 2;
    ctx.fillStyle = v.color;
    ctx.fillText(`${v.slot} ${v.name}  ${v.state}  anim ${v.anim}${v.progress >= 0 ? `@${v.progress.toFixed(2)}` : ''}`
      + `${v.intangible ? '  *INTANGIBLE*' : ''}${v.helpless ? '  HELPLESS' : ''}`, 8, y);
    ctx.fillStyle = '#dddddd';
    ctx.fillText(`x ${v.x.toFixed(1)} y ${v.y.toFixed(1)} vy ${v.vy.toFixed(2)} ${v.grounded ? 'SUELO' : 'AIRE'}`
      + `  ${v.percent.toFixed(1)}%  stocks ${v.stocks}  medidor ${Math.round(v.meter)}`
      + `  escudo ${v.shield >= 0 ? v.shield.toFixed(2) : '-'}  carga ${v.charge.toFixed(2)}`, 8, y + lineH);
  });
  ctx.restore();
}
