// Banco de pruebas grafico: un canvas 2D headless que RASTERIZA de verdad.
//
// No es un espia de llamadas. La leccion que dejo el hit flash (ver la guia,
// seccion 10) es que un doble que solo apunta las llamadas deja pasar los
// bugs que importan: alli `globalCompositeOperation` se guardaba pero no se
// respetaba, y un cuadrado rojo de 32.000 pixeles paso los tests. Aqui se
// escribe en un buffer RGBA real, asi que un test puede CONTAR pixeles y
// medir luminancias, que es como se han encontrado todos los bugs de arte de
// este proyecto.
//
// Cubre lo que usa el escenario: fillRect/clearRect, degradados lineales y
// radiales, rutas (moveTo/lineTo/arc/fill), drawImage entre canvas, alpha,
// save/restore, translate/scale y los modos de composicion reales.

import zlib from 'node:zlib';
import fs from 'node:fs';

const clamp255 = (v) => (v < 0 ? 0 : (v > 255 ? 255 : v));

function parseColor(css) {
  if (typeof css !== 'string') return [0, 0, 0, 0];
  const s = css.trim();
  if (s[0] === '#') {
    if (s.length === 4) {
      return [parseInt(s[1] + s[1], 16), parseInt(s[2] + s[2], 16), parseInt(s[3] + s[3], 16), 1];
    }
    return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), 1];
  }
  const m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(',').map((v) => parseFloat(v));
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  return [0, 0, 0, 1];
}

function mix(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t,
  ];
}

class Gradient {
  constructor(kind, coords) {
    this.kind = kind;
    this.coords = coords;
    this.stops = [];
  }

  addColorStop(offset, color) {
    this.stops.push({ offset, color: parseColor(color) });
    this.stops.sort((a, b) => a.offset - b.offset);
  }

  // Muestrea en coordenadas de USUARIO (el llamador deshace la transformacion).
  sample(ux, uy) {
    if (!this.stops.length) return [0, 0, 0, 0];
    let t;
    if (this.kind === 'linear') {
      const [x0, y0, x1, y1] = this.coords;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len2 = dx * dx + dy * dy;
      t = len2 === 0 ? 0 : ((ux - x0) * dx + (uy - y0) * dy) / len2;
    } else {
      const [, , r0, x1, y1, r1] = this.coords;
      const d = Math.hypot(ux - x1, uy - y1);
      t = r1 === r0 ? 0 : (d - r0) / (r1 - r0);
    }
    if (t <= this.stops[0].offset) return this.stops[0].color;
    const last = this.stops[this.stops.length - 1];
    if (t >= last.offset) return last.color;
    for (let i = 1; i < this.stops.length; i += 1) {
      const a = this.stops[i - 1];
      const b = this.stops[i];
      if (t <= b.offset) {
        const span = b.offset - a.offset;
        return mix(a.color, b.color, span === 0 ? 0 : (t - a.offset) / span);
      }
    }
    return last.color;
  }
}

class FakeCanvas {
  constructor(width, height) {
    this._w = width;
    this._h = height;
    this.data = new Float32Array(width * height * 4); // RGBA recta (no premultiplicada)
    this._ctx = new FakeContext(this);
  }

  // Asignar width/height reinicia el buffer y la transformacion, igual que en
  // un canvas real. El motor crea el canvas y LUEGO lo dimensiona, asi que sin
  // esto el escenario se horneaba sobre un buffer de 1x1 y salia en blanco.
  get width() { return this._w; }

  set width(v) { this._w = v; this._resize(); }

  get height() { return this._h; }

  set height(v) { this._h = v; this._resize(); }

  _resize() {
    this.data = new Float32Array(Math.max(0, this._w * this._h * 4));
    if (this._ctx) this._ctx.reset();
  }

  getContext() { return this._ctx; }

  pixel(x, y) {
    const i = (y * this.width + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }
}

class FakeContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.fillStyle = '#000000';
    this.strokeStyle = '#000000';
    this.lineWidth = 1;
    this.globalAlpha = 1;
    this.globalCompositeOperation = 'source-over';
    this.imageSmoothingEnabled = false;
    // Transformacion afin sin rotacion: escala + traslacion. Es todo lo que
    // usan el escenario y la camara.
    this.t = { sx: 1, sy: 1, tx: 0, ty: 0 };
    this.stack = [];
    this.path = [];
    this.drawCalls = { fillRect: 0, drawImage: 0, fill: 0 };
    // Recorte en coordenadas de DISPOSITIVO (ver clip()): la UNIÓN de uno o
    // varios rectángulos (`clipRegion`) y su caja envolvente (`clipRect`).
    this.clipRect = null;
    this.clipRegion = null;
    // Un recorte que no es una unión de rectángulos (un círculo, un
    // polígono) se aproxima por su caja. Se cuenta, igual que las rotaciones.
    this.approximatedClips = 0;
    // La transformación no admite rotación. En vez de ignorarla en silencio
    // (y dejar que un test pase contra un dibujo que no es el real), se
    // cuenta: un test que dibuje algo girado puede exigir que sea 0.
    this.unsupportedRotations = 0;
  }

  reset() {
    this.t = { sx: 1, sy: 1, tx: 0, ty: 0 };
    this.stack = [];
    this.globalAlpha = 1;
    this.globalCompositeOperation = 'source-over';
  }

  save() {
    this.stack.push({
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      globalAlpha: this.globalAlpha,
      globalCompositeOperation: this.globalCompositeOperation,
      t: { ...this.t },
      clipRect: this.clipRect,
      clipRegion: this.clipRegion,
    });
  }

  restore() {
    const s = this.stack.pop();
    if (!s) return;
    this.fillStyle = s.fillStyle;
    this.strokeStyle = s.strokeStyle;
    this.globalAlpha = s.globalAlpha;
    this.globalCompositeOperation = s.globalCompositeOperation;
    this.t = s.t;
    this.clipRect = s.clipRect;
    this.clipRegion = s.clipRegion;
  }

  translate(x, y) { this.t.tx += x * this.t.sx; this.t.ty += y * this.t.sy; }

  scale(x, y) { this.t.sx *= x; this.t.sy *= y; }

  setTransform(a, b, c, d, e, f) { this.t = { sx: a, sy: d, tx: e, ty: f }; }

  rotate(angle) { if (angle % (Math.PI * 2) !== 0) this.unsupportedRotations += 1; }

  createLinearGradient(x0, y0, x1, y1) { return new Gradient('linear', [x0, y0, x1, y1]); }

  createRadialGradient(x0, y0, r0, x1, y1, r1) {
    return new Gradient('radial', [x0, y0, r0, x1, y1, r1]);
  }

  // --- composicion real ---------------------------------------------------
  _blend(x, y, src) {
    const { canvas } = this;
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
    const c = this.clipRect;
    if (c && (x < c[0] || x >= c[2] || y < c[1] || y >= c[3])) return;
    const region = this.clipRegion;
    if (region && region.length > 1 && !region.some((r) => x >= r[0] && x < r[2] && y >= r[1] && y < r[3])) return;
    const i = (y * canvas.width + x) * 4;
    const d = canvas.data;
    const sa = src[3];
    const op = this.globalCompositeOperation;
    if (op === 'copy') {
      d[i] = src[0]; d[i + 1] = src[1]; d[i + 2] = src[2]; d[i + 3] = sa;
      return;
    }
    if (op === 'destination-out') {
      d[i + 3] *= (1 - sa);
      return;
    }
    const da = d[i + 3];
    if (op === 'source-in') {
      // El origen solo sobrevive donde el destino ya tenia pixel.
      d[i] = src[0]; d[i + 1] = src[1]; d[i + 2] = src[2]; d[i + 3] = sa * da;
      return;
    }
    if (op === 'source-atop') {
      if (da <= 0) return;
      d[i] = src[0] * sa + d[i] * (1 - sa);
      d[i + 1] = src[1] * sa + d[i + 1] * (1 - sa);
      d[i + 2] = src[2] * sa + d[i + 2] * (1 - sa);
      return;
    }
    if (op === 'lighter') {
      const outA = Math.min(1, da + sa);
      const r = clamp255(d[i] * da + src[0] * sa);
      const g = clamp255(d[i + 1] * da + src[1] * sa);
      const b = clamp255(d[i + 2] * da + src[2] * sa);
      d[i + 3] = outA;
      if (outA > 0) { d[i] = r / outA; d[i + 1] = g / outA; d[i + 2] = b / outA; }
      return;
    }
    // source-over
    const outA = sa + da * (1 - sa);
    if (outA <= 0) { d[i + 3] = 0; return; }
    d[i] = (src[0] * sa + d[i] * da * (1 - sa)) / outA;
    d[i + 1] = (src[1] * sa + d[i + 1] * da * (1 - sa)) / outA;
    d[i + 2] = (src[2] * sa + d[i + 2] * da * (1 - sa)) / outA;
    d[i + 3] = outA;
  }

  _deviceRect(x, y, w, h) {
    const { sx, sy, tx, ty } = this.t;
    const x0 = x * sx + tx;
    const y0 = y * sy + ty;
    return [x0, y0, x0 + w * sx, y0 + h * sy];
  }

  _paintRect(x, y, w, h, style) {
    const [dx0, dy0, dx1, dy1] = this._deviceRect(x, y, w, h);
    const ix0 = Math.round(Math.min(dx0, dx1));
    const ix1 = Math.round(Math.max(dx0, dx1));
    const iy0 = Math.round(Math.min(dy0, dy1));
    const iy1 = Math.round(Math.max(dy0, dy1));
    const grad = style instanceof Gradient ? style : null;
    const flat = grad ? null : parseColor(style);
    const { sx, sy, tx, ty } = this.t;
    for (let py = iy0; py < iy1; py += 1) {
      for (let px = ix0; px < ix1; px += 1) {
        let c = flat;
        if (grad) c = grad.sample((px + 0.5 - tx) / sx, (py + 0.5 - ty) / sy);
        const a = c[3] * this.globalAlpha;
        if (a <= 0) continue;
        this._blend(px, py, [c[0], c[1], c[2], a]);
      }
    }
  }

  fillRect(x, y, w, h) {
    this.drawCalls.fillRect += 1;
    this._paintRect(x, y, w, h, this.fillStyle);
  }

  clearRect(x, y, w, h) {
    const [dx0, dy0, dx1, dy1] = this._deviceRect(x, y, w, h);
    const d = this.canvas.data;
    for (let py = Math.round(dy0); py < Math.round(dy1); py += 1) {
      for (let px = Math.round(dx0); px < Math.round(dx1); px += 1) {
        if (px < 0 || py < 0 || px >= this.canvas.width || py >= this.canvas.height) continue;
        const i = (py * this.canvas.width + px) * 4;
        d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = 0;
      }
    }
  }

  // --- rutas --------------------------------------------------------------
  beginPath() { this.path = []; }

  moveTo(x, y) { this.path.push({ op: 'move', x, y }); }

  lineTo(x, y) { this.path.push({ op: 'line', x, y }); }

  closePath() { this.path.push({ op: 'close' }); }

  arc(cx, cy, r, a0, a1) { this.path.push({ op: 'arc', cx, cy, r, a0, a1 }); }

  ellipse(cx, cy, rx, ry) { this.path.push({ op: 'ellipse', cx, cy, rx, ry }); }

  rect(x, y, w, h) {
    this.path.push({ op: 'move', x, y });
    this.path.push({ op: 'line', x: x + w, y });
    this.path.push({ op: 'line', x: x + w, y: y + h });
    this.path.push({ op: 'line', x, y: y + h });
    this.path.push({ op: 'close' });
  }

  // Recorte: la UNIÓN de los rectángulos de la ruta actual (en dispositivo),
  // intersecada con el recorte que ya hubiera. Es lo que usa el motor (rect +
  // clip, también varias tiras en una ruta: el tajo de entrada del Despertar).
  // Un polígono que no es un rectángulo alineado se aproxima por su caja y se
  // cuenta en `approximatedClips`: ningún test puede pasar sin saberlo contra
  // un recorte que no es el real.
  clip() {
    const polys = this._flatten();
    if (!polys.length) return;
    const { sx, sy, tx, ty } = this.t;
    const rects = [];
    for (const poly of polys) {
      const pts = poly.map(([x, y]) => [x * sx + tx, y * sy + ty]);
      const xs = pts.map((q) => q[0]);
      const ys = pts.map((q) => q[1]);
      const box = [Math.round(Math.min(...xs)), Math.round(Math.min(...ys)), Math.round(Math.max(...xs)), Math.round(Math.max(...ys))];
      const axisAligned = pts.every(([x, y]) => (Math.abs(x - box[0]) < 0.5 || Math.abs(x - box[2]) < 0.5)
        && (Math.abs(y - box[1]) < 0.5 || Math.abs(y - box[3]) < 0.5));
      if (!axisAligned) this.approximatedClips += 1;
      rects.push(box);
    }
    const prev = this.clipRegion || (this.clipRect ? [this.clipRect] : null);
    let region = rects;
    if (prev) {
      region = [];
      for (const a of prev) {
        for (const b of rects) {
          const r = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
          if (r[2] > r[0] && r[3] > r[1]) region.push(r);
        }
      }
    }
    this.clipRegion = region;
    this.clipRect = region.length
      ? [Math.min(...region.map((r) => r[0])), Math.min(...region.map((r) => r[1])), Math.max(...region.map((r) => r[2])), Math.max(...region.map((r) => r[3]))]
      : [0, 0, 0, 0];
  }

  _flatten() {
    // Devuelve poligonos en coordenadas de usuario.
    const polys = [];
    let cur = [];
    for (const seg of this.path) {
      if (seg.op === 'move') {
        if (cur.length > 2) polys.push(cur);
        cur = [[seg.x, seg.y]];
      } else if (seg.op === 'line') {
        cur.push([seg.x, seg.y]);
      } else if (seg.op === 'close') {
        if (cur.length > 2) polys.push(cur);
        cur = [];
      } else {
        const rx = seg.op === 'arc' ? seg.r : seg.rx;
        const ry = seg.op === 'arc' ? seg.r : seg.ry;
        const a0 = seg.op === 'arc' ? seg.a0 : 0;
        const a1 = seg.op === 'arc' ? seg.a1 : Math.PI * 2;
        const poly = [];
        const steps = 64;
        for (let i = 0; i <= steps; i += 1) {
          const a = a0 + (a1 - a0) * (i / steps);
          poly.push([seg.cx + Math.cos(a) * rx, seg.cy + Math.sin(a) * ry]);
        }
        polys.push(poly);
      }
    }
    if (cur.length > 2) polys.push(cur);
    return polys;
  }

  fill() {
    this.drawCalls.fill += 1;
    const polys = this._flatten();
    if (!polys.length) return;
    const { sx, sy, tx, ty } = this.t;
    const grad = this.fillStyle instanceof Gradient ? this.fillStyle : null;
    const flat = grad ? null : parseColor(this.fillStyle);
    let minY = Infinity;
    let maxY = -Infinity;
    const dev = polys.map((p) => p.map(([x, y]) => {
      const px = x * sx + tx;
      const py = y * sy + ty;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      return [px, py];
    }));
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(this.canvas.height - 1, Math.ceil(maxY));
    for (let py = y0; py <= y1; py += 1) {
      const yc = py + 0.5;
      const xs = [];
      for (const poly of dev) {
        for (let i = 0; i < poly.length; i += 1) {
          const [ax, ay] = poly[i];
          const [bx, by] = poly[(i + 1) % poly.length];
          if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) {
            xs.push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
          }
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const from = Math.max(0, Math.round(xs[k]));
        const to = Math.min(this.canvas.width, Math.round(xs[k + 1]));
        for (let px = from; px < to; px += 1) {
          let c = flat;
          if (grad) c = grad.sample((px + 0.5 - tx) / sx, (yc - ty) / sy);
          const a = c[3] * this.globalAlpha;
          if (a > 0) this._blend(px, py, [c[0], c[1], c[2], a]);
        }
      }
    }
  }

  stroke() { /* el escenario no traza: todo es relleno snapeado a la rejilla */ }

  drawImage(src, ...args) {
    this.drawCalls.drawImage += 1;
    let sx0 = 0;
    let sy0 = 0;
    let sw = src.width;
    let sh = src.height;
    let dx;
    let dy;
    let dw;
    let dh;
    if (args.length === 2) {
      [dx, dy] = args; dw = sw; dh = sh;
    } else if (args.length === 4) {
      [dx, dy, dw, dh] = args;
    } else {
      [sx0, sy0, sw, sh, dx, dy, dw, dh] = args;
    }
    const [px0, py0, px1, py1] = this._deviceRect(dx, dy, dw, dh);
    // Una escala NEGATIVA (un sprite espejado con scale(-1, 1)) da un
    // rectángulo con el extremo antes que el origen. Antes eso producía un
    // ancho negativo y el bucle no pintaba nada: todo luchador mirando a la
    // izquierda era invisible en las capturas. Ahora se recorre el
    // rectángulo real y se muestrea la fuente al revés.
    const flipX = px1 < px0;
    const flipY = py1 < py0;
    const ix0 = Math.round(Math.min(px0, px1));
    const iy0 = Math.round(Math.min(py0, py1));
    const spanX = Math.round(Math.max(px0, px1)) - ix0;
    const spanY = Math.round(Math.max(py0, py1)) - iy0;
    for (let y = 0; y < spanY; y += 1) {
      for (let x = 0; x < spanX; x += 1) {
        const fx = flipX ? spanX - 1 - x : x;
        const fy = flipY ? spanY - 1 - y : y;
        const u = Math.min(sx0 + sw - 1, Math.floor(sx0 + (fx / spanX) * sw));
        const v = Math.min(sy0 + sh - 1, Math.floor(sy0 + (fy / spanY) * sh));
        if (u < 0 || v < 0 || u >= src.width || v >= src.height) continue;
        const i = (v * src.width + u) * 4;
        const a = src.data[i + 3] * this.globalAlpha;
        if (a <= 0) continue;
        this._blend(ix0 + x, iy0 + y, [src.data[i], src.data[i + 1], src.data[i + 2], a]);
      }
    }
  }
}

export function createCanvas(width, height) { return new FakeCanvas(width, height); }

/** Instala el minimo de DOM que necesita el motor para hornear en Node. */
export function installDom() {
  if (!globalThis.document) {
    globalThis.document = {
      createElement(tag) {
        if (tag !== 'canvas') throw new Error(`createElement(${tag}) no soportado`);
        return new FakeCanvas(1, 1);
      },
    };
  }
}

/** Luminancia Rec.601 del pixel (sobre negro si hay transparencia). */
export function luminanceAt(canvas, x, y) {
  const [r, g, b, a] = canvas.pixel(x, y);
  return (0.299 * r + 0.587 * g + 0.114 * b) * a;
}

export function luminanceOf(hex) {
  const [r, g, b] = parseColor(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = (c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1);
      crcTable[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

/** Vuelca el canvas a PNG para poder MIRAR el resultado, no solo medirlo. */
export function writePng(filePath, canvas) {
  const { width, height, data } = canvas;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let p = 0;
  for (let y = 0; y < height; y += 1) {
    raw[p] = 0; p += 1;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      raw[p] = clamp255(Math.round(data[i])); p += 1;
      raw[p] = clamp255(Math.round(data[i + 1])); p += 1;
      raw[p] = clamp255(Math.round(data[i + 2])); p += 1;
      raw[p] = clamp255(Math.round(data[i + 3] * 255)); p += 1;
    }
  }
  const chunk = (type, body) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const t = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, body])) >>> 0);
    return Buffer.concat([len, t, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(filePath, png);
}
