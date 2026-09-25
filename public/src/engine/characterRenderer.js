// Presentación del luchador: deformación procedural (squash & stretch) y
// color del delineado dinámico.
//
// Todo lo de aquí es PURAMENTE VISUAL y se deriva de la vista del luchador
// que ya viaja por red (`state`, `grounded`, `vy`, `progress`, `moveTag`),
// así que el cliente remoto lo reproduce idéntico sin un campo nuevo.
//
// REGLA INNEGOCIABLE: nada de esto toca `x`, `y`, la hurtbox, la hitbox ni la
// pushbox. La deformación se aplica como transformación del contexto de
// Canvas anclada en los PIES, justo antes de pintar el sprite y después de
// que la física haya terminado. Un personaje estirado al saltar sigue
// ocupando exactamente la misma caja de colisión que uno en reposo: si no
// fuera así, la legibilidad se pagaría con combos que fallan sin motivo
// visible, que es peor que no tener deformación.

/**
 * Factores de escala a aplicar al sprite, anclados en la planta de los pies.
 * @typedef {Object} Squash
 * @property {number} x  Escala horizontal (1 = sin deformar).
 * @property {number} y  Escala vertical.
 */

const NEUTRO = Object.freeze({ x: 1, y: 1 });

// --- Cifras de la deformación -------------------------------------------
// Un squash & stretch conserva el VOLUMEN aparente: lo que se ensancha se
// achata en la misma proporción. Por eso cada par multiplica ~1, y no son
// números sueltos: si se ajusta uno hay que ajustar su pareja o el
// personaje parece que cambia de masa.
const JUMPSQUAT = { x: 1.25, y: 0.75 };
const ASCENSO = { x: 0.82, y: 1.22 };
const ATERRIZAJE = { x: 1.20, y: 0.80 };
const ANTICIPACION = { x: 0.90, y: 1.10 };
const IMPACTO = { x: 1.30, y: 0.85 };

const ATERRIZAJE_FRAMES = 3;
// El "snap" del impacto dura lo que el ojo necesita para leerlo y ni un
// frame más: estirado durante todos los frames activos, el golpe deja de
// parecer un latigazo y parece un personaje deformado.
const IMPACTO_FRAMES = 2;

const lerp = (a, b, t) => a + (b - a) * t;
const mezcla = (destino, t) => ({ x: lerp(1, destino.x, t), y: lerp(1, destino.y, t) });

// Memoria de presentación por luchador. Va en un WeakMap y no en el
// `Character` a propósito: es estado de RENDER, no de simulación — no entra
// en el snapshot, no afecta a la física y se recolecta solo si el luchador
// desaparece.
// Va por RANURA ('p1'/'p2') y no por objeto: en el cliente remoto la vista
// es un objeto nuevo en cada snapshot.
const memoria = new Map();

function estadoDe(slot) {
  let m = memoria.get(slot);
  if (!m) {
    m = { estabaEnAire: false, framesDesdeAterrizar: Infinity, ultimoTag: null, frameDeImpacto: -1 };
    memoria.set(slot, m);
  }
  return m;
}

/**
 * Avanza la memoria de presentación un tick. Lo llama el bucle de dibujado
 * una vez por luchador y por frame, ANTES de `computeSquash`. Recibe la VISTA
 * del luchador (ver Fighter#view), que es lo mismo en el host y en el cliente
 * remoto.
 * @param {object} view
 */
export function trackPresentation(view) {
  const m = estadoDe(view.slot);
  const enAire = !view.grounded;

  // Aterrizaje detectado por TRANSICIÓN, no por un evento: así funciona igual
  // en el cliente remoto, que solo conoce `grounded` por el snapshot.
  if (m.estabaEnAire && !enAire) m.framesDesdeAterrizar = 0;
  else if (m.framesDesdeAterrizar < ATERRIZAJE_FRAMES) m.framesDesdeAterrizar += 1;
  m.estabaEnAire = enAire;

  // Frame en que un ataque entra en sus frames activos: el "snap".
  const tag = view.moveTag || null;
  if (tag !== m.ultimoTag) {
    m.ultimoTag = tag;
    m.frameDeImpacto = -1;
  }
  if (tag && view.actTo > 0 && m.frameDeImpacto < 0 && view.progress >= view.actFrom) {
    m.frameDeImpacto = 0;
  } else if (m.frameDeImpacto >= 0) {
    m.frameDeImpacto += 1;
  }
}

/**
 * Deformación que le toca a este luchador AHORA MISMO.
 * @param {object} view
 * @returns {Squash}
 */
export function computeSquash(view) {
  const m = estadoDe(view.slot);

  // --- Ataques: anticipación -> latigazo -> vuelta ----------------------
  if (view.moveTag && view.actTo > 0 && view.progress >= 0) {
    const from = view.actFrom;
    const to = view.actTo;
    const p = view.progress;
    if (p < from) {
      const t = from > 0 ? p / from : 1;
      return mezcla(ANTICIPACION, t);
    }
    if (m.frameDeImpacto >= 0 && m.frameDeImpacto < IMPACTO_FRAMES) return IMPACTO;
    if (p > to) {
      const restante = 1 - to;
      const t = restante > 0 ? Math.min(1, ((p - to) / restante) * 3) : 1;
      return mezcla(IMPACTO, 1 - t);
    }
    return NEUTRO;
  }

  // --- Salto ------------------------------------------------------------
  if (view.state === 'jumpsquat') return JUMPSQUAT;
  if (!view.grounded) {
    if (view.vy < -4) return ASCENSO;
    return NEUTRO;
  }
  if (m.framesDesdeAterrizar < ATERRIZAJE_FRAMES) {
    const t = 1 - (m.framesDesdeAterrizar / ATERRIZAJE_FRAMES);
    return mezcla(ATERRIZAJE, t);
  }
  return NEUTRO;
}

// --- Delineado -----------------------------------------------------------

// Color del contorno, decidido midiendo Y mirando, que dieron respuestas
// distintas y las dos hacían falta.
//
// MEDIDO sobre el render real (luminancia del borde contra el fondo justo
// detrás; por debajo de ~25 una figura se funde):
//   sin nada ................................. 34.6
//   solo atenuando el fondo .................. 21.6   <- EMPEORA
//   atenuando + contorno casi negro .......... 24.6   <- sigue peor que nada
//   atenuando + contorno hueso claro ......... 190.5
//
// O sea que un delineado oscuro sobre un fondo atenuado no separa nada: los
// sprites ya llevan horneado un contorno casi negro, así que oscurecer el
// callejón ACERCA el fondo al borde en vez de alejarlo. Las dos medidas
// empujaban en la misma dirección y se anulaban.
//
// MIRADO: el hueso claro a opacidad plena mide de maravilla y se ve fatal —
// los tres luchadores quedan como calcomanías recortadas, y a Vixen el
// contorno le traza la capa entera como un halo. Este gris azulado da 52 de
// contraste, muy por encima del umbral, y se lee como un FILO de pixel art y
// no como una pegatina. El blanco puro se reserva para los dos frames del
// impacto, que es donde un recorte duro es justo lo que se quiere.
export const OUTLINE_COLOR = '#5a5f70';
// Blanco puro en el primer frame de un impacto pesado: el golpe recorta la
// figura entera contra el fondo durante dos frames, que es el truco de
// legibilidad de las recreativas.
export const OUTLINE_IMPACT_COLOR = '#ffffff';
export const OUTLINE_WIDTH = 1;

/**
 * Color de contorno que le toca a este luchador, o null si no lleva.
 * @param {object} view
 * @returns {string|null}
 */
export function outlineColorFor(view) {
  // Durante el flash de impacto la silueta ya se tiñe de rojo entera; el
  // contorno blanco la recorta contra el fondo y los dos se refuerzan.
  if (view.hitFlash > 0) return OUTLINE_IMPACT_COLOR;
  return OUTLINE_COLOR;
}
