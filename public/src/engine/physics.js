// FÍSICA DE PLATAFORMAS, POR TICKS.
//
// Todo este módulo habla en la unidad del género: PÍXELES POR FRAME (px/f) y
// px/f² para las aceleraciones, con un tick fijo de 1/60 s. No hay `dt` en
// ninguna función: un paso de simulación es exactamente un frame, así que la
// misma secuencia de inputs produce SIEMPRE la misma secuencia de posiciones,
// en cualquier máquina y a cualquier refresco de monitor. Es la propiedad que
// sostiene el modelo host-autoritativo y los tests de determinismo.
//
// (El motor de lucha anterior integraba en px/s con `dt` y convertía las
// tablas con `perFrame()`. Aquí no hace falta: las tablas y el motor usan la
// misma unidad, y un factor 60 que se cuela ya no tiene dónde esconderse.)
//
// El módulo es PURO: funciones sobre objetos "cuerpo" y sobre la geometría
// del escenario. No sabe qué es un ataque ni un personaje.

// --- Constantes globales (sección 1.B del diseño) ---------------------------
export const GRAVITY = 0.58; // px/f², gravedad estándar
export const AIR_FRICTION = 0.06; // px/f que se pierden por frame en el aire sin input
export const GROUND_FRICTION = 0.82; // px/f que se pierden por frame en el suelo sin input
// Caída rápida = 1.6x la velocidad terminal del personaje, como en Ultimate.
export const FAST_FALL_MULTIPLIER = 1.6;
export const GROUND_JUMP_VELOCITY = -12.5;
export const DOUBLE_JUMP_VELOCITY = -11.0;
// 3 frames: el estándar de Smash Ultimate. Con 4 el despegue se sentía
// pegajoso en un juego de ritmo alto.
export const JUMP_SQUAT_FRAMES = 3;
// El diseño fija el salto completo (-12.5) pero no el corto. -8 da un ápice de
// 55 px: la mitad de un cuerpo, lo justo para meter un aéreo a ras de suelo
// sin llegar a las plataformas (110 px por encima del escenario).
export const SHORT_HOP_VELOCITY = -8.0;

// --- Agarre de borde (sección 1.C) -------------------------------------------
// Radio de captura: las manos enganchan el borde si su recorrido del frame pasa
// a 16 px o menos del punto del borde. Sustituye a la caja de 20x24 del diseño
// original y la contiene entera (su esquina está a 15.6 px del centro): todo
// lo que agarraba sigue agarrando, y un paso rozando el borde en horizontal
// (hasta 16 px en vez de 10) ya no se escapa.
export const LEDGE_GRAB_RADIUS = 16;
export const LEDGE_INVULN_FRAMES = 30;
// Tras soltarse, el borde no vuelve a agarrarse hasta pasados estos frames:
// sin esto, soltarse con S y volver a caer sobre la caja del borde lo
// re-agarraba en el tick siguiente y "soltarse" no hacía nada.
export const LEDGE_REGRAB_COOLDOWN = 30;
// LEDGE TRUMPING (robo de borde, estilo Ultimate): agarrar un borde ocupado
// expulsa al que colgaba hacia arriba y hacia fuera con este impulso, y le
// deja estos frames sin poder actuar ni intangibilidad.
export const LEDGE_TRUMP_VX = 3.2; // px/f, hacia fuera del escenario
export const LEDGE_TRUMP_VY = -4.5; // px/f, hacia arriba
export const LEDGE_TRUMP_FRAMES = 14;
// Altura de las manos respecto a la coronilla: es donde se busca el borde.
export const HAND_OFFSET_FROM_TOP = 12;

// Un paso de física más largo que el grosor de una losa atravesaría el suelo
// sin tocarlo. El escenario más fino (las semisólidas) se comprueba con barrido
// (prevY -> y), así que esto solo acota la velocidad por eje por seguridad.
const MAX_STEP = 64;

const clampStep = (v) => Math.max(-MAX_STEP, Math.min(MAX_STEP, v));

/**
 * Cuerpo físico mínimo que entiende este módulo.
 * @typedef {Object} Body
 * @property {number} x          centro horizontal (px)
 * @property {number} y          PIES (px, y crece hacia abajo)
 * @property {number} vx         velocidad propia (px/f)
 * @property {number} vy
 * @property {number} kbx        velocidad de retroceso, decae aparte (px/f)
 * @property {number} kby
 * @property {number} halfWidth  mitad del ancho del cuerpo (para paredes)
 * @property {number} height     alto del cuerpo (para techos)
 * @property {boolean} grounded
 * @property {string|null} surfaceId  superficie que se pisa ('main', 'left'...)
 */

/**
 * Superficie pisable (tapa de un sólido o una semisólida) en la x dada.
 * @returns {{ id: string, y: number, left: number, right: number, solid: boolean } | null}
 */
export function surfaceById(geometry, id) {
  for (const s of geometry.solids) {
    if (s.id === id) return { id, y: s.top, left: s.left, right: s.right, solid: true };
  }
  for (const p of geometry.platforms) {
    if (p.id === id) return { id, y: p.y, left: p.left, right: p.right, solid: false };
  }
  return null;
}

/**
 * La superficie pisable más alta que haya bajo (x, y) —con y hacia abajo—. La
 * usan las sombras y los charcos del VFX: una gota de aceite tiene que posarse
 * donde de verdad hay suelo, no en una línea fija que ya no existe.
 */
export function surfaceBelow(geometry, x, y) {
  let best = null;
  const consider = (id, top, left, right) => {
    if (x < left || x > right || top < y - 0.5) return;
    if (!best || top < best.y) best = { id, y: top };
  };
  for (const s of geometry.solids) consider(s.id, s.top, s.left, s.right);
  for (const p of geometry.platforms) consider(p.id, p.y, p.left, p.right);
  return best;
}

function overlapsSolidX(x, hw, s) {
  return x + hw > s.left && x - hw < s.right;
}

/**
 * Media anchura del cuerpo a la altura de la TAPA del sólido `s`: el pie es un
 * ROMBO, como la ECB de Smash. Crece a 45° desde un punto en los pies (el
 * centro) hasta la anchura completa `halfWidth` a esa altura por encima de
 * ellos. Por encima, el cuerpo es la caja de siempre.
 *
 * Es lo que resuelve la ESQUINA FANTASMA: con el pie como caja de 52 px, un
 * cuerpo con el centro medio píxel fuera de la losa y los pies 0.58 px por
 * debajo de la tapa (lo que cae en un frame) la tocaba con la esquina del pie.
 * La salida más corta era hacia ARRIBA: la red de seguridad lo posaba en el
 * suelo, el tick siguiente la regla del centro lo soltaba, y así cada frame
 * (landing / air / landing...), pegado a la esquina. Con el rombo, a una
 * profundidad d el pie mide d a cada lado: si el centro está fuera, empujar
 * hacia fuera (d − distancia al borde) siempre es más corto que empujar hacia
 * arriba (d), así que la geometría da LA MISMA respuesta que la regla del
 * centro de moveBody: centro dentro, se pisa; centro fuera, se resbala por la
 * esquina a 45° y cae junto a la pared.
 */
function footHalfWidth(body, s) {
  const depth = body.y - s.top;
  return Math.max(0, Math.min(body.halfWidth, depth));
}

function overlapsSolidY(y, h, s) {
  return y > s.top && y - h < s.bottom;
}

/**
 * Aplica un tick de movimiento a `body` contra la geometría del escenario.
 *
 * Resolución por EJES SEPARADOS (primero X, luego Y): es la forma estándar de
 * que un cuerpo lanzado en diagonal contra la esquina de la losa no se cuele
 * dentro. Devuelve lo que ha tocado para que el llamador decida (aterrizar
 * con lag, tech, rebote contra la pared...): la física no sabe qué es un tech.
 *
 * `opts.passPlatforms` = true hace que el cuerpo atraviese las semisólidas
 * aunque caiga (mantener abajo, o un drop-through en curso).
 *
 * @param {Body} body
 * @returns {{ landed: boolean, landSpeed: number, wall: 0|-1|1, ceiling: boolean,
 *             leftSurface: boolean, surfaceId: string|null }}
 */
export function moveBody(body, geometry, { passPlatforms = false } = {}) {
  const result = {
    landed: false, landSpeed: 0, wall: 0, ceiling: false, leftSurface: false, surfaceId: body.surfaceId,
  };
  const dx = clampStep(body.vx + body.kbx);
  const dy = clampStep(body.vy + body.kby);
  const hw = body.halfWidth;
  const h = body.height;

  // --- En el suelo -----------------------------------------------------------
  if (body.grounded) {
    const surface = surfaceById(geometry, body.surfaceId);
    if (dy < 0 || !surface) {
      // Despegue (salto o lanzamiento hacia arriba): se sigue por la rama
      // aérea con este mismo paso.
      body.grounded = false;
      body.surfaceId = null;
      result.leftSurface = true;
    } else {
      const prevX = body.x;
      body.x += dx;
      // Andar contra un sólido desde una semisólida más baja no existe en este
      // escenario, pero la comprobación es barata y deja el motor honesto.
      for (const s of geometry.solids) {
        if (s.id === surface.id) continue;
        if (overlapsSolidY(body.y, h, s) && overlapsSolidX(body.x, hw, s)) {
          body.x = prevX <= s.left ? s.left - hw : s.right + hw;
          result.wall = prevX <= s.left ? 1 : -1;
        }
      }
      body.y = surface.y;
      // Sin suelo bajo los pies: se sale andando por el borde. El centro del
      // cuerpo es la referencia (un pie colgando no te tira todavía).
      if (body.x < surface.left || body.x > surface.right) {
        body.grounded = false;
        body.surfaceId = null;
        result.leftSurface = true;
        result.surfaceId = null;
      }
      return result;
    }
  }

  // --- En el aire: eje X -----------------------------------------------------
  const prevX = body.x;
  body.x += dx;
  for (const s of geometry.solids) {
    if (!overlapsSolidY(body.y, h, s)) continue;
    const w = footHalfWidth(body, s);
    if (!overlapsSolidX(body.x, w, s)) continue;
    if (prevX + w <= s.left + 0.001) {
      body.x = s.left - w;
      result.wall = 1; // chocó con una pared a su derecha
    } else if (prevX - w >= s.right - 0.001) {
      body.x = s.right + w;
      result.wall = -1;
    } else {
      // Ya estaba solapado en X (entró en diagonal por una esquina): se
      // resuelve en el eje Y, que es el que ha cruzado de verdad.
      continue;
    }
    body.vx = 0;
  }

  // --- En el aire: eje Y -----------------------------------------------------
  const prevY = body.y;
  body.y += dy;

  if (dy >= 0) {
    // Aterrizaje. Se busca la superficie MÁS ALTA cruzada en este paso (con
    // barrido prevY -> y), así que un cuerpo muy rápido no puede saltarse la
    // losa y posarse en un escalón de roca de debajo.
    let landing = null;
    for (const s of geometry.solids) {
      if (prevY <= s.top + 0.001 && body.y >= s.top && body.x >= s.left && body.x <= s.right) {
        if (!landing || s.top < landing.y) landing = { id: s.id, y: s.top };
      }
    }
    if (!passPlatforms) {
      for (const p of geometry.platforms) {
        if (prevY <= p.y + 0.001 && body.y >= p.y && body.x >= p.left && body.x <= p.right) {
          if (!landing || p.y < landing.y) landing = { id: p.id, y: p.y };
        }
      }
    }
    if (landing) {
      result.landed = true;
      result.landSpeed = dy;
      result.surfaceId = landing.id;
      body.y = landing.y;
      body.grounded = true;
      body.surfaceId = landing.id;
      return result;
    }
  } else {
    // Techo: la parte de ABAJO de un sólido, subiendo desde debajo.
    for (const s of geometry.solids) {
      const prevTop = prevY - h;
      const top = body.y - h;
      if (prevTop >= s.bottom - 0.001 && top < s.bottom && overlapsSolidX(body.x, hw, s)) {
        body.y = s.bottom + h;
        result.ceiling = true;
      }
    }
  }

  // Red de seguridad: si tras los dos ejes el cuerpo sigue dentro de un
  // sólido (entró por una esquina en diagonal, o cae rozando la esquina de la
  // losa con el pie), se le saca por el lado más corto. Con el pie en rombo,
  // "arriba" solo es el más corto si el centro está sobre la tapa: nunca posa
  // en el suelo a un cuerpo que la regla del centro soltaría en el tick
  // siguiente (ver footHalfWidth).
  for (const s of geometry.solids) {
    if (!overlapsSolidY(body.y, h, s)) continue;
    const w = footHalfWidth(body, s);
    if (!overlapsSolidX(body.x, w, s)) continue;
    const pushLeft = body.x + w - s.left;
    const pushRight = s.right - (body.x - w);
    const pushUp = body.y - s.top;
    const pushDown = s.bottom - (body.y - h);
    const min = Math.min(pushLeft, pushRight, pushUp, pushDown);
    if (min === pushUp) {
      body.y = s.top;
      body.grounded = true;
      body.surfaceId = s.id;
      result.landed = true;
      result.surfaceId = s.id;
    } else if (min === pushLeft) {
      body.x = s.left - w;
      result.wall = 1;
    } else if (min === pushRight) {
      body.x = s.right + w;
      result.wall = -1;
    } else {
      body.y = s.bottom + h;
      result.ceiling = true;
    }
  }
  return result;
}

/**
 * Gravedad y tope de caída de un tick, sobre la velocidad PROPIA (vy). La
 * velocidad de retroceso (kby) va aparte y decae sola: es lo que hace que un
 * personaje lanzado siga cayendo con su peso mientras el golpe se agota.
 *
 * Caída rápida INMEDIATA: mientras `fastFalling`, vy es la velocidad de caída
 * rápida desde el primer frame (el Fighter la activa a partir del ápice). La
 * versión anterior la multiplicaba por 1.6 cada frame hasta el tope y tardaba
 * ~8 frames en llegar: se sentía como un freno, no como una orden.
 */
export function applyGravity(body, {
  gravity, maxFallSpeed, fastFallSpeed = maxFallSpeed * FAST_FALL_MULTIPLIER, fastFalling = false,
}) {
  if (fastFalling) {
    body.vy = fastFallSpeed;
    return;
  }
  body.vy = Math.min(maxFallSpeed, body.vy + gravity);
}

/** Acerca `v` a `target` como mucho `step` por frame. */
export function approach(v, target, step) {
  if (v < target) return Math.min(target, v + step);
  if (v > target) return Math.max(target, v - step);
  return v;
}

/**
 * Rozamiento de un tick sobre la velocidad propia horizontal.
 * @param {boolean} grounded
 */
export function applyFriction(body, grounded) {
  body.vx = approach(body.vx, 0, grounded ? GROUND_FRICTION : AIR_FRICTION);
}

/**
 * Punto de las manos para buscar el borde en el lado `side` (-1 izquierda,
 * +1 derecha del cuerpo).
 */
export function handPoint(body, side, y = body.y) {
  return { x: body.x + side * body.halfWidth, y: y - body.height + HAND_OFFSET_FROM_TOP };
}

/**
 * Primer instante `t` ∈ [0, 1] en que el segmento a→b entra en el círculo de
 * centro (cx, cy) y radio r (borde incluido), o null si no lo toca.
 */
export function segmentEntersCircle(ax, ay, bx, by, cx, cy, r) {
  const fx = ax - cx;
  const fy = ay - cy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0; // ya empieza dentro
  const dx = bx - ax;
  const dy = by - ay;
  const a = dx * dx + dy * dy;
  if (a === 0) return null;
  const b = 2 * (fx * dx + fy * dy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  // Empezando fuera, las dos raíces tienen el mismo signo: la menor es la
  // entrada, y solo vale si cae dentro de este frame.
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

/**
 * ¿Hay un borde agarrable en este tick? Se comprueba con un BARRIDO del
 * segmento que han recorrido las manos (de su posición del tick anterior a la
 * actual) contra el círculo de captura del borde (LEDGE_GRAB_RADIUS alrededor
 * de su punto).
 *
 * Una versión anterior barría solo en VERTICAL y con la x FINAL de las manos,
 * y fallaba en los dos sentidos a gran velocidad: unas manos que cruzaban la
 * zona en diagonal entre dos frames (lanzado a 10+ px/f) no enganchaban nunca
 * —199 de 11.088 trayectorias de prueba cruzaban la caja sin agarrar— y una
 * caída en diagonal podía engancharse con una x a la que las manos nunca
 * habían llegado a la altura del borde. Mirar solo la posición final contra
 * un radio tendría el primer fallo: por eso se barre.
 *
 * El personaje tiene que acabar en el lado de FUERA del borde (a la izquierda
 * del borde izquierdo...). La orientación no importa: al agarrar se gira solo
 * hacia el escenario, igual que en Smash.
 *
 * Los bordes ya ocupados NO se excluyen: agarrar un borde con alguien colgado
 * le ROBA el borde (ledge trumping, ver Simulation.resolveLedgeTrumps).
 *
 * @param {Body} body
 * @param {number} prevX  x del cuerpo en el tick anterior
 * @param {number} prevY  y de los pies en el tick anterior
 * @param {Array<{id:string,x:number,y:number,side:number}>} ledges
 * @returns {{ ledge: object, t: number } | null}  `t`: en qué punto del
 *          recorrido del frame entraron las manos (0 = al principio)
 */
export function findLedge(body, prevX, prevY, ledges) {
  let best = null;
  for (const ledge of ledges) {
    // side -1 = borde izquierdo del escenario: hay que estar a su izquierda y
    // agarrarlo con las manos del lado derecho del cuerpo.
    if (ledge.side < 0 && body.x > ledge.x) continue;
    if (ledge.side > 0 && body.x < ledge.x) continue;
    const hand = handPoint(body, -ledge.side);
    const prevHandX = prevX - ledge.side * body.halfWidth;
    const prevHandY = prevY - body.height + HAND_OFFSET_FROM_TOP;
    const t = segmentEntersCircle(prevHandX, prevHandY, hand.x, hand.y, ledge.x, ledge.y, LEDGE_GRAB_RADIUS);
    if (t !== null && (!best || t < best.t)) best = { ledge, t };
  }
  return best;
}

/**
 * Posición de los pies colgando de `ledge`: manos en el punto del borde,
 * cuerpo por fuera y por debajo.
 */
export function ledgeHangPosition(body, ledge) {
  return {
    x: ledge.x + ledge.side * body.halfWidth,
    y: ledge.y + body.height - HAND_OFFSET_FROM_TOP,
  };
}
