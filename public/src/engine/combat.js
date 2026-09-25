// DAÑO PORCENTUAL Y KNOCKBACK (sección 2 del diseño).
//
// Matemática pura del combate: fórmula de retroceso, vectorización, hitstun,
// tumble y geometría de cajas. Nada de aquí toca el estado de un luchador:
// `resolveHit` DECIDE qué ha pasado y se lo entrega a `Fighter.receiveHit`,
// que es quien cambia de estado. El mismo reparto que tenía HitboxManager en
// el motor anterior: la geometría decide, el personaje obedece.

/**
 * Fórmula de retroceso de Smash, tal cual la fija el diseño.
 *
 * @param {number} percent  % acumulado de la víctima ANTES de sumar este golpe
 * @param {number} damage   daño del golpe que acaba de conectar
 * @param {number} weight   peso de la víctima (Samuel = 116)
 * @param {number} bkb      Base Knockback
 * @param {number} kbg      Knockback Growth
 * @returns {number} TotalKnockback, en UNIDADES DE KNOCKBACK (no px/f)
 */
export function calculateKnockback(percent, damage, weight, bkb, kbg) {
  const pTerm = (percent / 10) + ((percent * damage) / 20);
  const wTerm = 200 / (weight + 100);
  return ((((pTerm * wTerm * 1.4) + 18) * (kbg / 100)) + bkb);
}

// --- De unidades de knockback a velocidad -----------------------------------
//
// El diseño convierte la magnitud a velocidad con
// `targetVx = cos(rad) * TotalKnockback * facing`, es decir, 1 unidad de
// knockback = 1 px/f. Con la fórmula de arriba eso no es jugable: un F-Tilt
// sobre Samuel al 0% ya da KB 50, o sea 50 px/f — cruzaría el escenario entero
// (600 px) en 12 frames y moriría al 0%. En Smash la magnitud tampoco es una
// velocidad: se multiplica por 0.03 unidades/frame y decae 0.051 por frame.
//
// Aquí se hace lo mismo con dos constantes calibradas contra LAS BLAST ZONES
// DE ESTE ESCENARIO (no contra las de Smash, que están proporcionalmente el
// doble de lejos). Medido con una simulación de vuelo sobre Samuel (peso 115),
// sin DI y contando solo el vuelo del golpe:
//
//   | golpe                 | K.O. desde el centro | desde el borde |
//   |-----------------------|----------------------|----------------|
//   | F-Smash sin cargar    | ~88%                 | ~63%           |
//   | U-Smash               | ~146%                |                |
//   | Final Smash           | ~22%                 |                |
//
// que es el rango de un peso pesado en Smash. Con 0.14/0.2 el F-Smash mataba
// al 58% en el centro; con 0.08 el U-Smash no mataba nunca por arriba (la
// gravedad de 0.58 se come el vuelo vertical).
export const KB_TO_SPEED = 0.1; // px/f por unidad de knockback
export const KB_DECAY = 0.17; // px/f² que pierde la velocidad de retroceso

// Umbral de TUMBLE, en unidades de knockback, tal cual el diseño.
export const TUMBLE_THRESHOLD = 32;

// --- Hitstun: DESACOPLADO de la velocidad de salida -------------------------
//
// El retroceso (la velocidad) y el hitstun (los frames sin poder tocar un
// botón) son dos cosas distintas. Con el hitstun de Smash, floor(KB·0.4), un
// F-Smash al 50% daba 51 frames de bloqueo de un vuelo de 77: la víctima caía
// al vacío mirando, a un porcentaje en el que el golpe no debería matar.
//
// Regla: FUERA DEL ESCENARIO NO SE ESTÁ CONGELADO; LA INMOVILIDAD SOLO EXISTE
// CUANDO EL GOLPE MATA.
//   - Sin tumble (KB ≤ 32) no cambia nada: floor(KB·0.4), como siempre. Es lo
//     que calibra la ráfaga del jab (setKb 14 → 5 frames = su bucle) y los
//     golpes de enganche.
//   - Con tumble, el mismo floor(KB·0.4), CAPADO en 22 frames (se alcanza en
//     KB 55). Pasado eso, la víctima sigue volando con toda la pegada, pero ya
//     en TUMBLE y con el control.
//   - El hitstun LARGO de siempre (lethalHitstunFrames) solo lo recibe un golpe
//     que el predictor declara K.O. SEGURO con ese hitstun y con cualquier DI
//     (Simulation.resolveLethal). Es el mismo criterio del Special Zoom, así
//     que zoom, bloqueo largo y K.O. van juntos por construcción.
export const HITSTUN_CAP = 22;

/** Frames de hitstun de un golpe que NO mata: min(22, floor(KB·0.4)). */
export function hitstunFrames(totalKnockback) {
  return Math.min(HITSTUN_CAP, Math.floor(totalKnockback * 0.4));
}

/**
 * Hitstun de un golpe LETAL: floor(KB·0.4), el de Smash. Solo se aplica si con
 * él la víctima cruza la blast zone sin remedio: el bloqueo largo nunca deja
 * a nadie congelado en un vuelo del que habría podido volver.
 */
export function lethalHitstunFrames(totalKnockback) {
  return Math.floor(totalKnockback * 0.4);
}

// Salir del tumble (tras el hitstun) con la esquiva aérea o el Up Special
// CORTA el retroceso que queda a la mitad y anula su parte hacia abajo. No lo
// anula entero: con el hitstun corto la víctima recupera el control volando
// aún a 8-10 px/f, y un freno en seco borraría la pegada del golpe.
export const LAUNCH_CANCEL_KEEP = 0.5;

/** El retroceso que queda al cancelar el tumble (ver LAUNCH_CANCEL_KEEP). */
export function cancelLaunch(body) {
  body.kbx *= LAUNCH_CANCEL_KEEP;
  body.kby = Math.min(0, body.kby) * LAUNCH_CANCEL_KEEP;
}

// Parte del retroceso HACIA ARRIBA que conserva el doble salto (ver
// jumpOutOfLaunch). Calibrada contra el U-Smash (peso 100, mejor DI): saltando
// en cuanto puede muere desde el 99%, sin saltar desde el 117-118%. Con 0.35
// moría al 94%; con 0.5, al 84%; con 1 (todo), al 57%.
export const JUMP_KEEP_UPWARD = 0.3;

/**
 * El DOBLE SALTO en un lanzamiento (el "jump momentum" de Smash): la parte
 * horizontal del retroceso se corta a la mitad y la vertical se suma al salto,
 * pero de la parte HACIA ARRIBA solo queda JUMP_KEEP_UPWARD (la de hacia abajo
 * se conserva entera). Saltar mientras un
 * golpe te sube sigue siendo un error que acorta la vida, sin ser un suicidio:
 * conservándola entera, un U-Smash mataba al 57% en vez de al 117% (durante el
 * vuelo la gravedad satura la caída propia en +11 px/f y el salto la pone a
 * −11: un vuelco de 22 px/f que se sumaba a todo el impulso del golpe).
 */
export function jumpOutOfLaunch(body) {
  body.kbx *= LAUNCH_CANCEL_KEEP;
  if (body.kby < 0) body.kby *= JUMP_KEEP_UPWARD;
}

// --- Ángulo Sakurai (361) ------------------------------------------------------
//
// El "ángulo 361" de Smash no es un ángulo: depende de la víctima.
//   - En el AIRE sale a 38°.
//   - En el SUELO, con poco retroceso, sale a ras (0°: se desliza) y a partir
//     de KB 60 el ángulo sube en línea hasta los 38° en KB 88. Es lo que hace
//     que un smash a bajo % empuje por el suelo y a alto % levante.
export const SAKURAI_ANGLE = 361;
export const SAKURAI_AIR_ANGLE = 38;
export const SAKURAI_GROUND_KB_MIN = 60;
export const SAKURAI_GROUND_KB_MAX = 88;

/** Ángulo real de un golpe (resuelve el 361 según la víctima). */
export function launchAngle(angle, totalKnockback, grounded) {
  if (angle !== SAKURAI_ANGLE) return angle;
  if (!grounded) return SAKURAI_AIR_ANGLE;
  const t = (totalKnockback - SAKURAI_GROUND_KB_MIN) / (SAKURAI_GROUND_KB_MAX - SAKURAI_GROUND_KB_MIN);
  return SAKURAI_AIR_ANGLE * Math.max(0, Math.min(1, t));
}

/** ¿Este golpe manda a TUMBLE? */
export function isTumble(totalKnockback) {
  return totalKnockback > TUMBLE_THRESHOLD;
}

/**
 * Vectoriza la magnitud con el ángulo del golpe (0° = adelante, 90° = arriba,
 * 270° = abajo / spike). `direction` es +1/-1: el lado hacia el que "adelante"
 * apunta (el facing del atacante, o el contrario en un golpe hacia atrás).
 * Devuelve la velocidad en px/f ya convertida con KB_TO_SPEED.
 */
export function knockbackVelocity(totalKnockback, angleDeg, direction) {
  const rad = angleDeg * (Math.PI / 180);
  const speed = totalKnockback * KB_TO_SPEED;
  // Redondeo a 1e-9: cos(90°) no da 0 exacto en coma flotante, y un 6e-17 de
  // vx convertiría un lanzamiento vertical puro en uno "hacia la derecha"
  // según quién lo mire. Es cosmético en la física, pero no en los tests.
  const clean = (v) => (Math.abs(v) < 1e-9 ? 0 : v);
  return {
    kbx: clean(Math.cos(rad) * speed * direction),
    kby: clean(-Math.sin(rad) * speed),
  };
}

/** Un tick de decaimiento de la velocidad de retroceso, a lo largo de su dirección. */
export function decayKnockback(body) {
  const mag = Math.hypot(body.kbx, body.kby);
  if (mag <= KB_DECAY) {
    body.kbx = 0;
    body.kby = 0;
    return;
  }
  const k = (mag - KB_DECAY) / mag;
  body.kbx *= k;
  body.kby *= k;
}

/**
 * Hitlag (congelación de impacto) en frames. Crece con el daño y se acota:
 * un Final Smash no puede congelar el juego medio segundo.
 */
export function hitlagFrames(damage) {
  return Math.min(18, Math.floor(damage * 0.45 + 4));
}

/**
 * Frames de SHIELDSTUN al parar un golpe: floor(daño·0.8 + 3). Empiezan a
 * contar cuando acaba el hitlag (que congela a los dos), y en ellos el
 * defensor no puede soltar el escudo, saltar ni contraatacar. Si el atacante
 * tarda más en recuperarse que esto, el golpe es CASTIGABLE en escudo.
 */
export function shieldstunFrames(damage) {
  return Math.floor(damage * 0.8 + 3);
}

// --- Directional Influence (DI) ---------------------------------------------
//
// La víctima inclina su trayectoria con la dirección que mantiene al acabar el
// hitlag (el momento en que sale disparada). Solo cuenta la componente
// PERPENDICULAR a la trayectoria: el giro es sin(ángulo entre la trayectoria
// y el stick) · 18°, así que apuntar en perpendicular da los 18° enteros y
// apuntar a favor o en contra del golpe no gira nada. Gira la dirección, no
// cambia la velocidad: sobrevivir es cuestión de APUNTAR, no de frenar.

export const DI_MAX_DEGREES = 18;

/**
 * Ángulo de la trayectoria tras aplicar el DI.
 * @param {number} trajectoryDeg  ángulo del lanzamiento en el MUNDO (0° =
 *                                derecha, 90° = arriba)
 * @param {number} stickX  -1..1 (derecha +)
 * @param {number} stickY  -1..1 (ARRIBA +)
 */
export function diAngle(trajectoryDeg, stickX, stickY) {
  const stick = Math.hypot(stickX, stickY);
  if (stick === 0) return trajectoryDeg;
  const rad = trajectoryDeg * (Math.PI / 180);
  // Producto vectorial trayectoria x stick (unitarios) = seno del ángulo que
  // forman: positivo si el stick queda a la izquierda de la trayectoria.
  const cross = (Math.cos(rad) * stickY - Math.sin(rad) * stickX) / stick;
  return trajectoryDeg + cross * DI_MAX_DEGREES;
}

/**
 * Aplica el DI a una velocidad de retroceso ya vectorizada (y hacia abajo,
 * como en el resto del motor). Conserva la magnitud.
 */
export function applyDI(kbx, kby, stickX, stickY) {
  const speed = Math.hypot(kbx, kby);
  if (speed === 0) return { kbx, kby };
  const trajectory = Math.atan2(-kby, kbx) * (180 / Math.PI);
  const rad = diAngle(trajectory, stickX, stickY) * (Math.PI / 180);
  const clean = (v) => (Math.abs(v) < 1e-9 ? 0 : v);
  return {
    kbx: clean(Math.cos(rad) * speed),
    kby: clean(-Math.sin(rad) * speed),
  };
}

// --- Geometría --------------------------------------------------------------

export function boxesOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Dirección "adelante" de un hitbox concreto. Por defecto el facing del
 * atacante; `reverse` la invierte (la coz del Bair lanza hacia atrás) y
 * `launchAway` la decide por el lado en que está la víctima (golpes que
 * barren a los dos lados: Nair, D-Smash, el eructo cargado).
 */
export function launchDirection(hb, attackerX, attackerFacing, victimX) {
  if (hb.launchAway) return victimX >= attackerX ? 1 : -1;
  return hb.reverse ? -attackerFacing : attackerFacing;
}

/**
 * Qué hace un golpe al conectar contra un luchador. Pura: no cambia nada,
 * devuelve el resultado para que lo aplique el receptor.
 *
 * @param {object} args
 * @param {object} args.hb        hitbox (damage/bkb/kbg/angle/setKb...)
 * @param {number} args.damage    daño final (ya con carga de smash aplicada)
 * @param {number} args.percent   % de la víctima ANTES del golpe
 * @param {number} args.weight
 * @param {number} args.direction +1/-1 (ver launchDirection)
 * @param {boolean} args.grounded ¿la víctima estaba en el suelo?
 */
export function computeLaunch({ hb, damage, percent, weight, direction, grounded }) {
  // Knockback fijo (setKb): los golpes de enganche de un multi-hit (los tres
  // primeros del Nair, la ráfaga del jab) no pueden crecer con el %, o al 150%
  // el primer golpe del Nair ya mandaría lejos al rival y los demás fallarían.
  const totalKnockback = hb.setKb ?? calculateKnockback(percent, damage, weight, hb.bkb, hb.kbg);
  let { kbx, kby } = knockbackVelocity(totalKnockback, launchAngle(hb.angle, totalKnockback, grounded), direction);
  const tumble = isTumble(totalKnockback);
  let bury = false;
  let bounced = false;

  // Golpes HACIA ABAJO contra un rival que pisa suelo firme.
  if (grounded && kby > 0) {
    if (hb.bury) {
      bury = true;
      kbx = 0;
      kby = 0;
    } else if (tumble) {
      // Rebote contra el suelo: el meteoro no puede meter a nadie dentro de
      // la losa, así que la componente vertical se refleja (con pérdida).
      kby = -kby * 0.8;
      bounced = true;
    } else {
      // Poco retroceso: se queda en el suelo deslizándose, no despega.
      kby = 0;
    }
  }
  return {
    totalKnockback,
    kbx,
    kby,
    hitstun: hitstunFrames(totalKnockback),
    // El hitstun si el golpe resulta ser letal: lo decide la simulación, que
    // es la que ve el escenario (ver Simulation.resolveLethal).
    lethalHitstun: lethalHitstunFrames(totalKnockback),
    tumble,
    bury,
    bounced,
  };
}

/**
 * Frames que se queda ENTERRADO un rival alcanzado por un golpe `bury`. El
 * diseño pide que sea "proporcional al %": 20 frames de base más uno por
 * cada 2%, con tope de 2 s para que el entierro no sea un K.O. gratis.
 */
export function buryFrames(percentAfterHit) {
  return Math.min(120, Math.floor(20 + percentAfterHit * 0.5));
}
