// CÁMARA DINÁMICA DE PLATAFORMAS (sección 5 del diseño).
//
// Encuadra la caja envolvente (AABB) de todos los luchadores activos —los que
// no están muertos esperando reaparecer—, con 140 px de margen por cada lado,
// y elige el zoom con la fórmula del diseño, recortado a [0.65, 1.15]. Posición
// y zoom se SUAVIZAN (lerp) hacia su objetivo: cuando alguien sale disparado
// hacia una blast zone la cámara lo acompaña sin dar un tirón.
//
// Es puramente de presentación: solo lee posiciones de las vistas (que en el
// cliente remoto llegan por red), así que cada pantalla encuadra por su
// cuenta y no hace falta sincronizar nada.

export const VIEWPORT_W = 1280;
export const VIEWPORT_H = 720;
export const CAMERA_PADDING = 140;
export const MIN_ZOOM = 0.65;
export const MAX_ZOOM = 1.15;

// Fracción del camino al objetivo que se recorre por frame.
const FOLLOW_LERP = 0.1;
const ZOOM_LERP = 0.06;
// En la cinemática del Final Smash se encuadra a la pareja muy de cerca.
const CINEMATIC_ZOOM = 1.9;
// SPECIAL ZOOM de un golpe letal: la cámara SALTA (sin lerp) al punto de
// contacto a este zoom y se queda clavada mientras dure la congelación. Al
// soltarse, el lerp normal la devuelve al encuadre de los dos.
export const SPECIAL_ZOOM = 1.35;

/**
 * Zoom objetivo para una caja de `boxWidth` x `boxHeight`, literal del diseño.
 */
export function targetZoomFor(boxWidth, boxHeight) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(
    VIEWPORT_W / (boxWidth + CAMERA_PADDING * 2),
    VIEWPORT_H / (boxHeight + CAMERA_PADDING * 2),
  )));
}

/**
 * Caja envolvente de los luchadores que cuentan. `x` es el centro del cuerpo e
 * `y` los pies, así que se toman los pies Y la coronilla: con solo los pies,
 * un salto sacaría la cabeza por arriba del encuadre.
 * @returns {{minX:number,maxX:number,minY:number,maxY:number}|null}
 */
export function fighterBounds(views) {
  const active = views.filter((v) => v.visible);
  if (active.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const v of active) {
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y - v.bodyHeight);
    maxY = Math.max(maxY, v.y);
  }
  return {
    minX, maxX, minY, maxY,
  };
}

export class CameraManager {
  constructor({ blastZones }) {
    this.blastZones = blastZones;
    this.reset();
  }

  reset() {
    this.x = VIEWPORT_W / 2;
    this.y = 420;
    this.zoom = 1;
    this.shakeTime = 0;
    this.shakePower = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.punch = 0;
    this.special = null;
  }

  /** Micro-zoom instantáneo al punto de contacto de un golpe letal. */
  specialZoom(x, y, frames) {
    this.special = { x, y, frames };
    this.x = x;
    this.y = y;
    this.zoom = SPECIAL_ZOOM;
    this.punch = 0;
  }

  /** Centro permitido: la vista no se sale de las blast zones si cabe dentro. */
  clampCenter(x, y, zoom) {
    const bz = this.blastZones;
    const halfW = VIEWPORT_W / zoom / 2;
    const halfH = VIEWPORT_H / zoom / 2;
    const cx = bz.right - bz.left <= halfW * 2
      ? (bz.left + bz.right) / 2
      : Math.max(bz.left + halfW, Math.min(bz.right - halfW, x));
    const cy = bz.bottom - bz.top <= halfH * 2
      ? (bz.top + bz.bottom) / 2
      : Math.max(bz.top + halfH, Math.min(bz.bottom - halfH, y));
    return { x: cx, y: cy };
  }

  /**
   * Un frame de seguimiento.
   * @param {Array} views     vistas de los luchadores
   * @param {object|null} focus  { views } para encuadrar solo a esos (cinemática)
   */
  update(views, focus = null) {
    if (this.special) {
      this.x = this.special.x;
      this.y = this.special.y;
      this.zoom = SPECIAL_ZOOM;
      this.special.frames -= 1;
      if (this.special.frames <= 0) this.special = null;
      this.updateShake();
      return;
    }
    const targetViews = focus ? focus.views : views;
    const box = fighterBounds(targetViews);
    if (box) {
      const boxWidth = box.maxX - box.minX;
      const boxHeight = box.maxY - box.minY;
      let zoom = focus ? CINEMATIC_ZOOM : targetZoomFor(boxWidth, boxHeight);
      zoom *= 1 + this.punch * 0.12;
      const center = focus
        ? { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }
        : this.clampCenter((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, zoom);
      const k = focus ? 0.25 : FOLLOW_LERP;
      this.x += (center.x - this.x) * k;
      this.y += (center.y - this.y) * k;
      this.zoom += (zoom - this.zoom) * (focus ? 0.2 : ZOOM_LERP);
    }
    if (this.punch > 0) this.punch = Math.max(0, this.punch - 1 / 12);
    this.updateShake();
  }

  shake(power, frames = 14) {
    if (power >= this.shakePower || this.shakeTime <= 0) {
      this.shakePower = power;
      this.shakeTime = frames;
    }
  }

  punchIn() {
    this.punch = 1;
  }

  // Dos oscilaciones de frecuencias distintas, redondeadas a píxel entero: un
  // desplazamiento fraccionario haría vibrar los bordes del pixel art.
  updateShake() {
    if (this.shakeTime <= 0) {
      this.shakeX = 0;
      this.shakeY = 0;
      return;
    }
    this.shakeTime -= 1;
    const t = this.shakeTime;
    const amp = this.shakePower * Math.min(1, t / 8);
    this.shakeX = Math.round(Math.sin(t * 2.3) * amp);
    this.shakeY = Math.round(Math.cos(t * 3.1) * amp * 0.7);
    if (this.shakeTime <= 0) this.shakePower = 0;
  }

  /** Aplica la transformación mundo -> pantalla. */
  apply(ctx) {
    ctx.translate(VIEWPORT_W / 2 + this.shakeX, VIEWPORT_H / 2 + this.shakeY);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
  }

  worldToScreen(x, y) {
    return {
      x: (x - this.x) * this.zoom + VIEWPORT_W / 2,
      y: (y - this.y) * this.zoom + VIEWPORT_H / 2,
    };
  }

  /** Rectángulo de mundo visible ahora mismo. */
  viewRect() {
    const w = VIEWPORT_W / this.zoom;
    const h = VIEWPORT_H / this.zoom;
    return {
      x: this.x - w / 2, y: this.y - h / 2, w, h,
    };
  }
}
