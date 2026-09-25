// IMPACT FRAMES del Modo Despertado (estilo Guilty Gear): durante 2-3 frames
// el mundo desaparece y queda un cartel de alto contraste — fondo plano,
// luchadores y escenario como SILUETAS planas del color contrario — con una
// estrella roja y líneas de choque en el punto de impacto.
//
// Es presentación pura: lo dispara el evento `hit` con `impact` (la simulación
// lo pone con el campo `impact` de la hitbox) y se dibuja en función de su
// EDAD en frames de simulación, así que las dos pantallas lo ven igual. Sin
// rotate(): todo son rectángulos y polígonos, que el banco de pruebas mide.
//
//   invert    3 frames: blanco/negro, invertido (negro/blanco) y otra vez
//             blanco/negro. El microfonazo (F-Smash) del rapero.
//   redwhite  2 frames: blanco con siluetas ROJAS y rojo con siluetas
//             blancas. El puñetazo del parry.

export const IMPACT_STYLES = {
  invert: { frames: 3, palette: [['#ffffff', '#000000'], ['#000000', '#ffffff'], ['#ffffff', '#000000']] },
  redwhite: { frames: 2, palette: [['#ffffff', '#d8141e'], ['#d8141e', '#ffffff']] },
};

const STAR_RED = '#ff1a2a';
const SHOCK_LINES = 20;

/** Colores [fondo, silueta] del impacto `style` en su frame `age`, o null si ya acabó. */
export function impactColors(style, age) {
  const spec = IMPACT_STYLES[style];
  if (!spec || age < 0 || age >= spec.frames) return null;
  return spec.palette[age];
}

// Estrella roja de 8 puntas en rejilla de píxeles, con el núcleo blanco.
function drawImpactStar(ctx, x, y, size) {
  const t = Math.max(2, Math.round(size / 6));
  const long = Math.round(size);
  const short = Math.round(size * 0.55);
  ctx.fillStyle = STAR_RED;
  ctx.fillRect(Math.round(x - long), Math.round(y - t), long * 2, t * 2);
  ctx.fillRect(Math.round(x - t), Math.round(y - long), t * 2, long * 2);
  for (let d = t; d <= short; d += t) {
    for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      ctx.fillRect(Math.round(x + sx * d - t), Math.round(y + sy * d - t), t * 2, t * 2);
    }
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(Math.round(x - t * 1.5), Math.round(y - t * 1.5), t * 3, t * 3);
}

/**
 * Dibuja el impact frame en espacio de PANTALLA, tapando el mundo.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} o
 * @param {string} o.style      'invert' | 'redwhite'
 * @param {number} o.age        frames de simulación desde el golpe (0 = el del golpe)
 * @param {object[]} o.views    vistas de los luchadores
 * @param {(v: object) => object} o.animatorFor  animador de cada vista
 * @param {object} o.camera     cámara (apply, worldToScreen)
 * @param {object} o.geometry   sólidos y plataformas: el escenario en silueta
 * @param {{x: number, y: number}} o.point  punto de impacto, en mundo
 * @param {{w: number, h: number}} o.viewport
 * @returns {boolean} si ha dibujado algo
 */
export function drawImpactFrame(ctx, {
  style, age, views, animatorFor, camera, geometry, point, viewport,
}) {
  const colors = impactColors(style, age);
  if (!colors) return false;
  const [bg, sil] = colors;
  const { w, h } = viewport;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Líneas de choque: cuñas finas desde el impacto hasta fuera de la pantalla.
  const p = camera.worldToScreen(point.x, point.y);
  ctx.fillStyle = sil;
  const reach = Math.hypot(w, h);
  for (let i = 0; i < SHOCK_LINES; i += 1) {
    const a = (i / SHOCK_LINES) * Math.PI * 2 + (i % 2) * 0.07;
    const half = 0.012 + (i % 3) * 0.006;
    const r0 = 60 + (i % 4) * 18;
    ctx.beginPath();
    ctx.moveTo(p.x + Math.cos(a) * r0, p.y + Math.sin(a) * r0);
    ctx.lineTo(p.x + Math.cos(a - half) * reach, p.y + Math.sin(a - half) * reach);
    ctx.lineTo(p.x + Math.cos(a + half) * reach, p.y + Math.sin(a + half) * reach);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // El escenario y los luchadores, planos, en el mundo.
  ctx.save();
  camera.apply(ctx);
  ctx.fillStyle = sil;
  for (const s of [...(geometry?.solids || []), ...(geometry?.platforms || [])]) {
    const top = s.top ?? s.y; // las semisólidas solo tienen su `y`
    ctx.fillRect(s.left, top, s.right - s.left, (s.bottom ?? top + 10) - top);
  }
  for (const v of views) {
    if (!v.visible) continue;
    const animator = animatorFor(v);
    if (!animator) continue;
    animator.draw(ctx, v.x, v.y, v.flip ? -v.facing : v.facing, { tint: sil });
  }
  ctx.restore();

  // La estrella roja encima de todo, en el punto exacto del golpe.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawImpactStar(ctx, p.x, p.y, 46 + age * 8);
  ctx.restore();
  return true;
}
