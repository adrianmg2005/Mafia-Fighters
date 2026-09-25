// PREDICCIÓN DE GOLPE LETAL (Special Zoom).
//
// En el frame del impacto, ¿va a cruzar la víctima una blast zone SIN
// POSIBILIDAD FÍSICA DE FRENAR? Solo entonces se dispara el Special Zoom: un
// zoom que anuncia un K.O. que luego no llega es peor que no tener zoom.
//
// "Sin posibilidad de frenar" tiene una definición exacta en este motor:
//   - Durante el HITSTUN la víctima no puede hacer nada. Lo único que controla
//     es el DI, que se lee al acabar el hitlag (después de este cálculo), así
//     que el vuelo se prueba con TODO el abanico de DI posible (±18°, cada 3°)
//     y el golpe es letal solo si mata con todos.
//   - En cuanto acaba el hitstun, el doble salto, la esquiva aérea y el Up
//     Special CORTAN el retroceso a la mitad (combat.cancelLaunch), así que un
//     vuelo que no ha cruzado la blast zone antes de ese frame no es un K.O.
//     seguro, por lejos que vaya.
//
// El hitstun con el que se prueba es el LARGO (combat.lethalHitstunFrames):
// la simulación pregunta "¿con el bloqueo de Smash, esto mata sin remedio?" y
// solo si la respuesta es sí se lo pone a la víctima (Simulation.resolveLethal).
// Si no, la víctima se queda con el hitstun corto y vuelve a tener el control.
// Aterrizar, chocar con una pared o con un techo también cortan la
// predicción: ahí hay tech, rebote o suelo, no blast zone.
//
// Es la MISMA física que el Fighter en hitstun (gravedad, decaimiento del
// retroceso, moveBody contra la geometría), sobre una copia: no toca a nadie
// y es determinista.

import { moveBody, applyGravity } from './physics.js';
import { decayKnockback, DI_MAX_DEGREES } from './combat.js';

// Paso del barrido del DI, en grados. El giro real es continuo; cada 3° el
// vuelo cambia unos pocos píxeles.
const DI_SAMPLE_STEP = 3;

/** Lado de la blast zone que ha cruzado el CENTRO del cuerpo, o null. */
export function blastSide(bz, cx, cy) {
  if (cx < bz.left) return 'left';
  if (cx > bz.right) return 'right';
  if (cy < bz.top) return 'top';
  if (cy > bz.bottom) return 'bottom';
  return null;
}

function rotated(kbx, kby, deg) {
  if (deg === 0) return { kbx, kby };
  const rad = deg * (Math.PI / 180);
  // Giro en coordenadas de mundo con y hacia ARRIBA (kby va hacia abajo).
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const ux = kbx;
  const uy = -kby;
  return { kbx: ux * c - uy * s, kby: -(ux * s + uy * c) };
}

/**
 * Vuela `victim` sin control durante su hitstun con el retroceso girado
 * `diDeg` grados. Devuelve el lado de la blast zone que cruza, o null.
 *
 * @param {object} victim  x, y, kbx, kby, hitstun, grounded, surfaceId,
 *                         halfWidth, height, stats.{gravity, maxFallSpeed}
 */
export function uncontrolledFlight(victim, geometry, diDeg = 0, hitstun = victim.hitstun) {
  const kb = rotated(victim.kbx, victim.kby, diDeg);
  const body = {
    x: victim.x,
    y: victim.y,
    vx: 0,
    vy: 0,
    kbx: kb.kbx,
    kby: kb.kby,
    halfWidth: victim.halfWidth,
    height: victim.height,
    grounded: victim.grounded,
    surfaceId: victim.surfaceId,
  };
  const bz = geometry.blastZones;
  for (let frame = 0; frame < hitstun; frame += 1) {
    if (!body.grounded) {
      applyGravity(body, { gravity: victim.stats.gravity, maxFallSpeed: victim.stats.maxFallSpeed });
    }
    decayKnockback(body);
    const result = moveBody(body, geometry);
    if (result.landed || result.wall !== 0 || result.ceiling) return null;
    const side = blastSide(bz, body.x, body.y - body.height / 2);
    if (side) return side;
  }
  return null;
}

/**
 * ¿K.O. seguro? Solo si el vuelo sin control cruza una blast zone con
 * CUALQUIER DI. No dice por qué lado: el DI puede cambiarlo (un F-Smash al
 * 190% que sin DI sale por la derecha, con DI hacia arriba sale por arriba),
 * y anunciar un lado sería anunciar algo que la víctima todavía decide.
 */
export function predictCertainKO(victim, geometry, hitstun = victim.hitstun) {
  if (!(hitstun > 0) || (victim.kbx === 0 && victim.kby === 0)) return false;
  for (let deg = -DI_MAX_DEGREES; deg <= DI_MAX_DEGREES; deg += DI_SAMPLE_STEP) {
    if (!uncontrolledFlight(victim, geometry, deg, hitstun)) return false;
  }
  return true;
}
