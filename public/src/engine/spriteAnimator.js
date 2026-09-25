// Reproductor de animaciones basado en spritesheet: genérico a propósito,
// no sabe nada de Character ni de fighting games. `image` puede ser
// cualquier CanvasImageSource — hoy es el atlas procedural horneado por
// spriteAtlasBuilder.js, pero el día que haya hojas de sprites reales en
// public/assets/ (un HTMLImageElement cargado con `new Image()`), esta
// misma clase las reproduce sin cambios: solo cambia quién construye
// `frames`/`animations`.
// --- Tintado de SILUETA --------------------------------------------------
//
// BUG QUE ESTO ARREGLA. El tinte se pintaba con `source-atop` directamente
// sobre el canvas principal, confiando en que eso lo recortaría a la silueta
// del sprite. No es lo que hace: `source-atop` recorta contra el DESTINO, y
// el destino es el canvas del juego, que lleva el escenario detrás y es
// OPACO en toda la pantalla. Resultado: el fillRect pasaba entero y lo que
// se veía al recibir un golpe era un CUADRADO rojo del tamaño de la celda
// del atlas. Medido sobre el render real: 32.000 píxeles teñidos, que son
// exactamente los 160x200 de la celda, en vez de los ~4.000 de la silueta.
//
// La única forma de recortar contra el SPRITE es componer donde el sprite es
// lo único que hay: un canvas offscreen transparente. Ahí sí, `source-in`
// deja el color solo donde el sprite tiene píxeles, y el resultado se blitea
// encima con un `drawImage`.
//
// El canvas se crea UNA vez y se reutiliza (solo crece si aparece un frame
// más grande), así que no hay ni una asignación por frame ni fuga posible.
let tintCanvas = null;
let tintCtx = null;

// CACHÉ DE SILUETAS PARA EL DELINEADO.
//
// El contorno se estampa cuatro veces por luchador y por frame. Componer la
// silueta (drawImage + source-in + fillRect) cada una de esas veces serían 8
// composiciones por frame y por luchador para dibujar SIEMPRE lo mismo: la
// silueta solo depende del frame del atlas y del color.
//
// Se cachea por `índiceDeFrame|color` en un Map acotado. El tope existe
// porque sin él la caché crecería con cada frame distinto que se reproduzca
// —los tres atlas juntos pasan de 250 frames, y con dos colores de contorno
// son 500 canvas— y eso es una fuga de memoria con forma de optimización.
// Con 24 entradas caben de sobra las animaciones simultáneas de dos
// luchadores, y la expulsión es FIFO sobre el orden de inserción del Map.
const MAX_SILUETAS = 24;
const siluetas = new Map();

function getSilhouette(image, frame, color) {
  const clave = (frame.id ?? (frame.sx + ',' + frame.sy)) + '|' + color;
  const cacheada = siluetas.get(clave);
  if (cacheada) {
    // LRU de verdad: al acertar, la entrada se reinserta para que pase a ser
    // la más reciente. Con expulsión FIFO pura, un conjunto de trabajo del
    // tamaño del tope se machaca a sí mismo y la caché no acierta nunca.
    siluetas.delete(clave);
    siluetas.set(clave, cacheada);
    return cacheada;
  }

  // POOL: al expulsar no se tira el canvas, se REUTILIZA. Sin esto cada fallo
  // de caché asigna uno nuevo, y con muchas animaciones distintas eso es una
  // asignación por frame — medido antes de arreglarlo: 300 frames creaban 296
  // canvas. Ahora el número total de canvas vivos no puede pasar del tope,
  // pase lo que pase.
  let canvas = null;
  if (siluetas.size >= MAX_SILUETAS) {
    const masVieja = siluetas.keys().next().value;
    canvas = siluetas.get(masVieja);
    siluetas.delete(masVieja);
  } else {
    canvas = document.createElement('canvas');
  }

  // Asignar width/height limpia el canvas, que es justo lo que hace falta al
  // reutilizarlo; solo se toca si cambia de tamaño, para no pagar el borrado
  // cuando el frame mide lo mismo.
  if (canvas.width !== frame.sw || canvas.height !== frame.sh) {
    canvas.width = frame.sw;
    canvas.height = frame.sh;
  } else {
    canvas.getContext('2d').clearRect(0, 0, frame.sw, frame.sh);
  }

  const c = canvas.getContext('2d');
  c.imageSmoothingEnabled = false;
  c.drawImage(image, frame.sx, frame.sy, frame.sw, frame.sh, 0, 0, frame.sw, frame.sh);
  // `source-in` recorta contra el propio sprite. Funciona aquí y NO sobre el
  // canvas del juego porque este lienzo es transparente: en el del juego el
  // destino es el escenario opaco y saldría un rectángulo (ver la nota del
  // hit flash en la guía).
  c.globalCompositeOperation = 'source-in';
  c.fillStyle = color;
  c.fillRect(0, 0, frame.sw, frame.sh);
  c.globalCompositeOperation = 'source-over';

  siluetas.set(clave, canvas);
  return canvas;
}

function getTintSurface(w, h) {
  if (!tintCanvas) {
    tintCanvas = document.createElement('canvas');
    tintCanvas.width = w;
    tintCanvas.height = h;
    tintCtx = tintCanvas.getContext('2d');
    tintCtx.imageSmoothingEnabled = false;
  } else if (tintCanvas.width < w || tintCanvas.height < h) {
    // Solo crece, nunca encoge: así el tamaño se estabiliza en el frame más
    // grande del atlas y a partir de ahí no se vuelve a tocar.
    tintCanvas.width = Math.max(tintCanvas.width, w);
    tintCanvas.height = Math.max(tintCanvas.height, h);
    tintCtx = tintCanvas.getContext('2d');
    tintCtx.imageSmoothingEnabled = false;
  }
  return tintCtx;
}

// Dibuja el frame `frame` de `image` teñido de `color`, respetando al 100%
// su transparencia exterior. `opacity` controla cuánto pesa el tinte sobre
// el sprite ya dibujado debajo.
function drawSilhouetteTint(ctx, image, frame, dx, dy, color, opacity) {
  if (opacity <= 0) return;
  const g = getTintSurface(frame.sw, frame.sh);

  // 1) el sprite solo, sobre transparencia
  g.clearRect(0, 0, frame.sw, frame.sh);
  g.globalCompositeOperation = 'source-over';
  g.drawImage(image, frame.sx, frame.sy, frame.sw, frame.sh, 0, 0, frame.sw, frame.sh);
  // 2) el color, recortado a lo que ese sprite ocupa
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, frame.sw, frame.sh);
  g.globalCompositeOperation = 'source-over';

  // 3) encima del sprite del canvas principal, con su opacidad
  const previo = ctx.globalAlpha;
  ctx.globalAlpha = previo * Math.min(1, opacity);
  ctx.drawImage(tintCanvas, 0, 0, frame.sw, frame.sh, dx, dy, frame.sw, frame.sh);
  ctx.globalAlpha = previo;
}

export class SpriteAnimator {
  constructor({ image, frames, animations, pivot }) {
    this.image = image;
    this.frames = frames; // [{ sx, sy, sw, sh, pivotX?, pivotY? }, ...]
    this.animations = animations; // { nombre: { frameIndices, frameDurationMs, loop, progressDriven } }
    this.pivot = pivot; // pivote por defecto si el frame no trae el suyo propio

    this.currentAnim = null;
    this.frameTimer = 0;
    this.frameCursor = 0;
  }

  // Cambiar de animación reinicia el frame — evita el típico bug de "se
  // queda a medio golpe anterior" al entrar en un estado nuevo.
  play(name) {
    if (this.currentAnim === name) return;
    this.currentAnim = name;
    this.frameTimer = 0;
    this.frameCursor = 0;
  }

  // Igual que play(), pero el frame lo elige el PROGRESO del movimiento
  // (0..1) en vez de un reloj propio. Es lo que sincroniza la animación con
  // el frame data real: con un reloj independiente, la anticipación de un
  // heavy podía seguir en pantalla cuando la hitbox ya estaba activa, o el
  // frame de impacto llegar durante el recovery. Aquí, por construcción, la
  // anticipación ocupa los startupFrames y el impacto los activeFrames.
  playAtProgress(name, progress) {
    const anim = this.animations[name];
    if (!anim) return;
    if (this.currentAnim !== name) {
      this.currentAnim = name;
      this.frameTimer = 0;
    }
    const count = anim.frameIndices.length;
    const t = Math.max(0, Math.min(0.9999, progress));
    // El épsilon es el mismo problema que en Character.stateExpired: el
    // progreso se calcula dividiendo milisegundos que se restan en pasos de
    // 1000/60, así que justo en la frontera entre startup y frames activos
    // sale 1.9999999999999991 en vez de 2 y el frame de impacto llegaba un
    // frame tarde. Sin esto, la sincronía con el frame data se pierde
    // precisamente donde más importa.
    this.frameCursor = Math.min(count - 1, Math.floor(t * count + 1e-6));
  }

  update(dt) {
    const anim = this.animations[this.currentAnim];
    if (!anim || anim.progressDriven || anim.frameIndices.length <= 1) return;

    this.frameTimer += dt * 1000;
    while (this.frameTimer >= anim.frameDurationMs) {
      this.frameTimer -= anim.frameDurationMs;
      this.frameCursor += 1;
      if (this.frameCursor >= anim.frameIndices.length) {
        this.frameCursor = anim.loop ? 0 : anim.frameIndices.length - 1;
      }
    }
  }

  // Estado mínimo para redibujar este mismo frame más tarde: lo usan las
  // estelas fantasma (after-image) de engine/vfx.js, que necesitan congelar
  // "qué se veía" sin quedarse con una referencia viva al animador.
  snapshot() {
    return { anim: this.currentAnim, cursor: this.frameCursor };
  }

  // x,y: posición EN MUNDO del punto de anclaje (pivote) del frame — la
  // planta de los pies sobre el suelo — para que cambiar de postura o de
  // frame nunca haga vibrar o desplazar al sprite.
  //
  // `alpha` < 1 dibuja la silueta translúcida y `tint` la repinta de un color
  // plano respetando la forma. Ninguno de los dos se hornea en el atlas: son
  // estados momentáneos (parpadeo de invulnerabilidad, flash de golpe,
  // estela del dash), no poses.
  drawSnapshot(ctx, snap, x, y, facing = 1, {
    flashing = false, alpha = 1, tint = null,
    flashColor = '#ffffff', flashAlpha = 1,
    outline = null, outlineWidth = 1, outlineAlpha = 1,
    squashX = 1, squashY = 1, aura = null,
  } = {}) {
    const anim = this.animations[snap.anim];
    if (!anim) return;
    const index = anim.frameIndices[Math.min(snap.cursor, anim.frameIndices.length - 1)];
    const frame = this.frames[index];
    if (!frame) return;
    // Atlas perezoso: cada frame trae su propio lienzo (ver buildFighterAtlas).
    const image = frame.image ?? this.image;

    const pivotX = frame.pivotX ?? this.pivot.x;
    const pivotY = frame.pivotY ?? this.pivot.y;

    ctx.save();
    if (alpha < 1) ctx.globalAlpha = alpha;
    // El origen queda en el PIVOTE, que es la planta de los pies: por eso la
    // deformación se ancla sola al suelo y un personaje achatado no flota ni
    // se hunde. Es también el motivo de que no haga falta tocar `y`.
    ctx.translate(x, y);
    ctx.scale(facing, 1);
    if (squashX !== 1 || squashY !== 1) ctx.scale(squashX, squashY);

    // DELINEADO DINÁMICO: la silueta sólida estampada en las cuatro
    // direcciones ortogonales y el sprite a color encima. Va DENTRO de la
    // transformación para que el contorno se deforme con el cuerpo — pintado
    // fuera, un personaje estirado luciría un contorno que no le cabe.
    // AURA (Modo Despertar): la silueta en el color del aura estampada a su
    // alrededor en 8 direcciones y a `spread` px, por DETRÁS del sprite. Es
    // la misma técnica que el delineado, más ancha y translúcida.
    if (aura) {
      const sil = getSilhouette(image, frame, aura.color);
      const d = aura.spread;
      const alfaPrevio = ctx.globalAlpha;
      ctx.globalAlpha = alfaPrevio * aura.alpha;
      for (const [ax, ay] of [[d, 0], [-d, 0], [0, d], [0, -d], [d * 0.7, d * 0.7], [-d * 0.7, d * 0.7], [d * 0.7, -d * 0.7], [-d * 0.7, -d * 0.7]]) {
        ctx.drawImage(sil, Math.round(-pivotX + ax), Math.round(-pivotY + ay));
      }
      ctx.globalAlpha = alfaPrevio;
    }

    if (outline) {
      const sil = getSilhouette(image, frame, outline);
      const d = outlineWidth;
      const alfaPrevio = ctx.globalAlpha;
      if (outlineAlpha < 1) ctx.globalAlpha = alfaPrevio * outlineAlpha;
      ctx.drawImage(sil, -pivotX + d, -pivotY);
      ctx.drawImage(sil, -pivotX - d, -pivotY);
      ctx.drawImage(sil, -pivotX, -pivotY + d);
      ctx.drawImage(sil, -pivotX, -pivotY - d);
      ctx.globalAlpha = alfaPrevio;
    }

    ctx.drawImage(
      image,
      frame.sx, frame.sy, frame.sw, frame.sh,
      -pivotX, -pivotY, frame.sw, frame.sh,
    );

    // Estela fantasma del dash: la copia se repinta de un color plano.
    if (tint) drawSilhouetteTint(ctx, image, frame, -pivotX, -pivotY, tint, 1);

    // Flash de impacto: la SILUETA EXACTA del frame activo, teñida de rojo.
    // No es una caja sobre la hurtbox ni un rectángulo semitransparente — se
    // recorta contra el propio sprite, así que coincide píxel a píxel con la
    // pose que el luchador tiene en ese frame, sea un jab, un juggle aéreo o
    // un golpe de la cinemática.
    if (flashing) {
      drawSilhouetteTint(ctx, image, frame, -pivotX, -pivotY, flashColor, flashAlpha);
    }

    ctx.restore();
  }

  draw(ctx, x, y, facing = 1, options = {}) {
    this.drawSnapshot(ctx, this.snapshot(), x, y, facing, options);
  }
}
