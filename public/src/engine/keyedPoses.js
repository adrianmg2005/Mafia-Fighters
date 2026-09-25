// POSES DE ATAQUE DE SAMUEL POR FOTOGRAMAS CLAVE, sobre la fase canónica.
//
// Cada golpe es una lista de claves [t, campos] con `t` en la FASE CANÓNICA
// del movimiento (engine/movePhase.js):
//
//   0 .......... 0.3 ======== 0.5 .......................... 1
//   anticipación     IMPACTO        follow-through -> guardia
//
// El impacto va SIEMPRE en [0.3, 0.5): ahí están las cajas activas, sea cual
// sea la frame data del movimiento. Y las MANOS se escriben en coordenadas
// ABSOLUTAS del sprite (80x120, pies en y=120, mirando a la derecha), no como
// desplazamientos: es lo que permite poner el puño o la cabeza de la llave
// exactamente sobre su hitbox leyendo el volcado de tests/renderMoves.mjs.
//
// Campos de una clave (lo que falta vale lo de reposo):
//   F, B        [x, y] del puño delantero / trasero
//   tx, ty      desplazamiento del torso (ty > 0 = agacharse)
//   hx, hy      desplazamiento de la cabeza RESPECTO AL TORSO: la cabeza baja
//               y se mueve con el torso en bloque. Escritos como absolutos,
//               un golpe que agachaba el torso (barrido: ty 10, culazo: 12)
//               dejaba la cabeza arriba y el cuello vacío: decapitado.
//   lean        inclinación: hombros y cabeza respecto a la cadera (+ = hacia
//               delante, - = echarse atrás)
//   inflate     0..1, se hincha (barriga y mofletes): el eructo
//   ff, fb      [dx, dy] del tobillo delantero / trasero
//   y los extras que ya leía el kit: tool, toolAngle, toolKind ('mic' y
//   'cigar' en el Despertado), ember (brasa del puro), capOff, stance, fist,
//   smokePuff, gas*, chair / chairAngle (la silla gamer), shock*, mouthOpen...
// Los campos numéricos se interpolan con suavizado entre claves; las cadenas
// (toolKind) toman el valor de la clave anterior.
//
// Las ESTELAS (`trails`) son arcos o trazos semitransparentes que marcan la
// trayectoria del arma o del miembro durante el impacto. Las dibuja el kit
// (ver drawTrails en pixelFighterArt.js).

// Reposo de las manos en el kit (sin guardia) y guardia de combate. Las
// claves escriben posiciones absolutas y aquí se pasan a los offsets de la
// pose, que el kit suma a su reposo.
const REST_F = [61, 62];
const REST_B = [20, 61];
export const GUARD_F = [65, 35];
export const GUARD_B = [58, 29];
// Reposo en el suelo: brazos CAÍDOS a los lados, con el codo un poco
// flexionado (la mano no llega a estirar el brazo) y el puño cerrado junto a
// la cadera, por fuera del cuerpo. Es de donde salen y adonde vuelven los
// golpes de suelo, igual que el idle.
export const HANG_F = [59, 68];
export const HANG_B = [61, 30];

const G = { F: HANG_F, B: HANG_B };
// En el aire, la guardia: los puños arriba (igual que la pose de salto).
const AIR = { F: GUARD_F, B: GUARD_B, ff: [3, -8], fb: [-3, -8] };

const NUMERIC_DEFAULTS = {
  hx: 0, hy: 0, tx: 0, ty: 0, lean: 0, inflate: 0,
  tool: 0, toolAngle: -0.4, fist: 0, smokePuff: 0,
  gas: 0, gasX: 0.34, gasY: 0.62, gasAngle: Math.PI * 0.85,
  chair: 0, chairAngle: -Math.PI / 2,
  shock: 0, shockAngle: 0, shockX: 0.7, shockY: 0.16,
  mouthOpen: 0, guard: 0, ember: 0, capOff: 0,
};

// --- las poses ------------------------------------------------------------

export const KEYED_POSES = {
  // JAB 1 — directo rápido: el puño se recoge al pecho con el codo abajo,
  // pegado al costado, y dispara: el HOMBRO se adelanta, el codo se proyecta
  // y el brazo llega COMPLETAMENTE extendido y horizontal (hombro, bíceps,
  // antebrazo y puño en línea) a la altura del hombro; el otro puño se
  // recoge a la cadera (la "recámara").
  jab: {
    effector: 'F',
    keys: [
      [0, G],
      [0.18, { F: [62, 48], B: [62, 32], lean: -1, ty: 1 }],
      [0.3, { F: [88, 44], B: [64, 33], tx: 3, ty: 2, lean: 4, hx: 1, fist: 1 }],
      [0.5, { F: [88, 44], B: [64, 33], tx: 3, ty: 2, lean: 4, hx: 1, fist: 1 }],
      [0.72, { F: [70, 48], B: [62, 32], tx: 1, lean: 1 }],
      [1, G],
    ],
    trails: [{ from: 0.26, to: 0.52, type: 'streak', x0: 64, y0: 44, x1: 86, y1: 44, w: 5 }],
  },
  // JAB 2 — codazo pesado: el torso gira hacia dentro y el codo lidera.
  elbow: {
    effector: 'F',
    keys: [
      [0, G],
      [0.2, { F: [58, 33], B: [46, 49], tx: -2, lean: -3 }],
      [0.3, { F: [82, 40], B: [40, 53], tx: 5, lean: 5, hx: 3 }],
      [0.5, { F: [82, 40], B: [40, 53], tx: 5, lean: 5, hx: 3 }],
      [0.75, { F: [70, 38], B: [44, 48], tx: 2, lean: 2 }],
      [1, G],
    ],
    trails: [{ from: 0.26, to: 0.54, type: 'arc', cx: 60, cy: 56, r: 24, a0: -1.9, a1: -0.15, w: 6 }],
  },
  // RÁFAGA — puñetazos alternos con balanceo del torso. Es un bucle: el puño
  // de delante pega en el impacto y el de atrás ya viene en la recuperación.
  rapidjab: {
    effector: 'F',
    keys: [
      [0, { F: [70, 48], B: [66, 54], tx: 2, ty: 2, lean: 2 }],
      [0.3, { F: [94, 46], B: [52, 54], tx: 4, ty: 2, lean: 5, hx: 1, fist: 1 }],
      [0.5, { F: [94, 48], B: [54, 54], tx: 4, ty: 2, lean: 5, hx: 1, fist: 1 }],
      [0.75, { F: [66, 52], B: [84, 50], tx: 1, ty: 2, lean: 1 }],
      [1, { F: [70, 48], B: [66, 54], tx: 2, ty: 2, lean: 2 }],
    ],
    trails: [
      { from: 0.26, to: 0.5, type: 'streak', x0: 68, y0: 46, x1: 94, y1: 46, w: 6 },
      { from: 0.62, to: 0.9, type: 'streak', x0: 58, y0: 52, x1: 84, y1: 50, w: 5 },
    ],
  },
  // REMATE — empujón de panza: echa los hombros atrás y la barriga adelante.
  bellybump: {
    effector: 'belly',
    keys: [
      [0, G],
      [0.22, { F: [54, 34], B: [34, 42], tx: -4, lean: -2, inflate: 0.4, hy: 1 }],
      [0.3, { F: [46, 44], B: [22, 48], tx: 9, lean: -5, inflate: 1, hx: 3 }],
      [0.5, { F: [46, 44], B: [22, 48], tx: 9, lean: -5, inflate: 1, hx: 3 }],
      [0.75, { F: [60, 40], B: [40, 46], tx: 3, inflate: 0.3 }],
      [1, G],
    ],
    trails: [{ from: 0.28, to: 0.55, type: 'arc', cx: 74, cy: 62, r: 16, a0: -1.1, a1: 1.1, w: 5 }],
  },
  // F-TILT — patada de bota: se echa atrás, recoge la rodilla y ESTOCADA
  // horizontal con la puntera por delante.
  bootkick: {
    effector: 'ff',
    keys: [
      [0, G],
      [0.2, { F: [58, 32], B: [40, 40], tx: -3, lean: -5, ff: [-2, -24], hy: 1 }],
      [0.3, { F: [54, 30], B: [34, 44], tx: -4, ty: 2, lean: -7, ff: [44, -36], hy: 2 }],
      [0.5, { F: [54, 30], B: [34, 44], tx: -4, ty: 2, lean: -7, ff: [44, -36], hy: 2 }],
      [0.72, { F: [60, 34], B: [40, 44], tx: -1, lean: -2, ff: [14, -10] }],
      [1, G],
    ],
    trails: [{ from: 0.26, to: 0.52, type: 'streak', x0: 58, y0: 86, x1: 108, y1: 76, w: 7 }],
  },
  // BAIR — coz hacia atrás con giro de cadera: el cuerpo se va adelante y la
  // pierna de atrás sale recta hacia la espalda.
  backkick: {
    effector: 'fb',
    keys: [
      [0, AIR],
      [0.2, { F: [60, 34], B: [48, 42], lean: 3, tx: 2, fb: [12, -24], ff: [4, -8] }],
      [0.3, { F: [68, 32], B: [58, 40], lean: 6, tx: 5, hx: 3, fb: [-38, -40], ff: [6, -10] }],
      [0.5, { F: [68, 32], B: [58, 40], lean: 6, tx: 5, hx: 3, fb: [-38, -40], ff: [6, -10] }],
      [0.72, { F: [62, 34], B: [48, 44], lean: 2, fb: [-10, -20], ff: [4, -8] }],
      [1, AIR],
    ],
    trails: [{ from: 0.26, to: 0.52, type: 'streak', x0: 24, y0: 82, x1: -12, y1: 68, w: 7 }],
  },
  // U-TILT — la llave grifa en ARCO de 180° por encima de la cabeza, de la
  // espalda al frente. La caja es ese arco entero (-22..102, sobre la cabeza).
  wrencharc: {
    effector: 'tool',
    keys: [
      [0, { ...G, tool: 0 }],
      [0.15, { F: [34, 56], B: [36, 58], lean: -2, ty: 3, tool: 1, toolAngle: 2.6 }],
      // Agarre corto (tool 0.55: 55 px de llave) para que la punta barra el
      // arco de la caja sin salirse por arriba.
      [0.3, { F: [42, 16], B: [40, 22], lean: -3, ty: -1, tool: 0.55, toolAngle: -2.9 }],
      [0.4, { F: [48, 8], B: [44, 16], lean: 0, ty: -3, hy: -2, tool: 0.55, toolAngle: -1.57 }],
      [0.5, { F: [58, 14], B: [50, 22], lean: 3, ty: -1, tool: 0.55, toolAngle: -0.25 }],
      [0.7, { F: [70, 46], B: [54, 48], lean: 3, tool: 1, toolAngle: 0.9 }],
      [0.9, { F: [64, 40], B: [46, 48], tool: 0.6, toolAngle: 1.3 }],
      [1, { ...G, tool: 0 }],
    ],
    trails: [{ from: 0.28, to: 0.62, type: 'arc', cx: 46, cy: 22, r: 58, a0: Math.PI, a1: Math.PI * 2, w: 12 }],
  },
  // D-TILT — pisotón seco: sube la rodilla y clava la bota delante.
  stomp: {
    effector: 'ff',
    keys: [
      [0, G],
      [0.2, { F: [60, 32], B: [40, 42], ty: -1, lean: -2, ff: [10, -26] }],
      [0.3, { F: [66, 46], B: [42, 54], ty: 4, lean: 3, hy: 2, ff: [22, 0] }],
      [0.5, { F: [66, 46], B: [42, 54], ty: 4, lean: 3, hy: 2, ff: [22, 0] }],
      [0.72, { F: [64, 40], B: [44, 50], ty: 2, lean: 1, ff: [14, 0] }],
      [1, G],
    ],
    trails: [{ from: 0.24, to: 0.46, type: 'streak', x0: 76, y0: 80, x1: 78, y1: 112, w: 6 }],
  },
  // DASH ATTACK / ataques de borde — barrido bajo con la pierna.
  lowsweep: {
    effector: 'ff',
    keys: [
      [0, G],
      [0.2, { F: [62, 44], B: [30, 40], ty: 6, lean: 2, ff: [-6, -6] }],
      [0.3, { F: [70, 60], B: [20, 44], ty: 10, lean: 4, hx: 2, ff: [36, -8], fb: [-4, 0] }],
      [0.5, { F: [70, 60], B: [20, 44], ty: 10, lean: 4, hx: 2, ff: [36, -8], fb: [-4, 0] }],
      [0.75, { F: [66, 48], B: [36, 46], ty: 4, lean: 2, ff: [12, -2] }],
      [1, G],
    ],
    trails: [{ from: 0.26, to: 0.52, type: 'arc', cx: 50, cy: 88, r: 44, a0: 0.9, a1: -0.15, w: 8 }],
  },
  // NAIR — giro de 360° con los brazos ABIERTOS: el anillo de la estela es
  // la caja que rodea el cuerpo.
  spin360: {
    effector: 'F',
    keys: [
      [0, AIR],
      [0.2, { F: [58, 50], B: [32, 50], ty: 2, inflate: 0.2, ff: [4, -12], fb: [-4, -12] }],
      [0.3, { F: [100, 44], B: [-20, 44], hx: 2, ff: [6, -14], fb: [-6, -14] }],
      [0.4, { F: [98, 58], B: [-18, 32], hx: -2, lean: -1, ff: [4, -14], fb: [-4, -14] }],
      [0.5, { F: [100, 40], B: [-20, 50], hx: 2, lean: 1, ff: [6, -14], fb: [-6, -14] }],
      [0.75, { F: [76, 46], B: [8, 48], ff: [4, -10], fb: [-4, -10] }],
      [1, AIR],
    ],
    trails: [{ from: 0.26, to: 0.56, type: 'ring', cx: 40, cy: 58, rx: 60, ry: 30, w: 6 }],
  },
  // FAIR — MAZAZO: la llave sube por detrás y cae en arco por delante. El
  // sweetspot es la cabeza de la llave; el mango es la parte floja.
  hammer: {
    effector: 'tool',
    keys: [
      [0, { ...AIR, tool: 0.3, toolAngle: -1.2 }],
      [0.2, { F: [46, 10], B: [40, 18], lean: -3, ty: -2, tool: 0.3, toolAngle: -2.3, ff: [2, -12], fb: [-4, -10] }],
      [0.3, { F: [66, 44], B: [56, 48], lean: 4, hx: 3, tool: 0.3, toolAngle: 0.75, ff: [4, -10], fb: [-2, -8] }],
      [0.5, { F: [66, 46], B: [56, 50], lean: 4, hx: 3, tool: 0.3, toolAngle: 0.95, ff: [4, -10], fb: [-2, -8] }],
      [0.72, { F: [58, 58], B: [46, 56], lean: 2, tool: 0.3, toolAngle: 1.9, ff: [3, -8], fb: [-3, -8] }],
      [1, { ...AIR, tool: 0.3, toolAngle: -1.2 }],
    ],
    trails: [{ from: 0.26, to: 0.56, type: 'arc', cx: 58, cy: 40, r: 48, a0: -2.2, a1: 1.0, w: 10 }],
  },
  // UAIR — eructo sónico HACIA ARRIBA: se arquea, levanta la barbilla y la
  // onda sale por encima de la cabeza.
  burpup: {
    keys: [
      [0, AIR],
      [0.2, { F: [60, 52], B: [30, 52], inflate: 0.9, hy: 1, lean: 1, ff: [4, -10], fb: [-4, -10] }],
      [0.3, { F: [70, 62], B: [18, 60], inflate: 0.2, hy: -3, lean: -3, mouthOpen: 1, shock: 0.5, shockAngle: -Math.PI / 2, shockX: 0.55, shockY: 0.02, ff: [6, -12], fb: [-6, -12] }],
      [0.5, { F: [70, 62], B: [18, 60], hy: -3, lean: -3, mouthOpen: 1, shock: 1, shockAngle: -Math.PI / 2, shockX: 0.55, shockY: 0.02, ff: [6, -12], fb: [-6, -12] }],
      [0.75, { F: [66, 48], B: [34, 50], hy: -1, mouthOpen: 0.3, ff: [4, -9], fb: [-4, -9] }],
      [1, AIR],
    ],
    trails: [],
  },
  // DAIR — CULAZO: se encoge (rodillas al pecho) y cae de culo hacia abajo,
  // con el pedo de gas debajo. La caja está bajo los pies.
  buttslam: {
    keys: [
      [0, AIR],
      [0.15, { F: [58, 26], B: [30, 26], ty: -6, inflate: 0.3, ff: [6, -26], fb: [-6, -26] }],
      [0.28, { F: [62, 22], B: [26, 22], ty: -8, inflate: 0.5, ff: [8, -30], fb: [-8, -30] }],
      [0.3, { F: [70, 40], B: [16, 40], ty: 12, ff: [18, -16], fb: [10, -14], gas: 0.6, gasX: 0.5, gasY: 0.86, gasAngle: Math.PI / 2 }],
      [0.5, { F: [70, 40], B: [16, 40], ty: 12, ff: [18, -16], fb: [10, -14], gas: 1, gasX: 0.5, gasY: 0.86, gasAngle: Math.PI / 2 }],
      [0.75, { F: [64, 44], B: [30, 46], ty: 4, ff: [8, -10], fb: [0, -10], gas: 0.5, gasX: 0.5, gasY: 0.86, gasAngle: Math.PI / 2 }],
      [1, AIR],
    ],
    trails: [{ from: 0.28, to: 0.5, type: 'streak', x0: 40, y0: 70, x1: 40, y1: 116, w: 10 }],
  },
  // F-SMASH — CIGÜEÑAL: el metal al hombro echando el cuerpo atrás (la carga
  // se congela aquí), y bateo horizontal demoledor.
  crankswing: {
    effector: 'tool',
    keys: [
      [0, { ...G, tool: 0 }],
      [0.07, { F: [46, 32], B: [42, 38], tool: 1, toolAngle: -2.6, lean: -3 }],
      [0.18, { F: [36, 30], B: [32, 36], tx: -4, ty: 2, lean: -8, hx: -2, tool: 1, toolAngle: 2.9, fb: [-4, 0] }],
      [0.27, { F: [40, 36], B: [34, 40], tx: -3, ty: 2, lean: -7, hx: -2, tool: 1, toolAngle: 2.7, fb: [-4, 0] }],
      [0.3, { F: [72, 58], B: [62, 58], tx: 5, lean: 6, hx: 3, tool: 1, toolAngle: 0, ff: [8, 0] }],
      [0.5, { F: [74, 58], B: [64, 58], tx: 5, lean: 6, hx: 3, tool: 1, toolAngle: 0.08, ff: [8, 0] }],
      [0.68, { F: [66, 36], B: [58, 44], tx: 4, lean: 4, tool: 1, toolAngle: -1.3, ff: [8, 0] }],
      [0.88, { F: [64, 40], B: [46, 46], tx: 1, tool: 0.6, toolAngle: -0.8, ff: [4, 0] }],
      [1, { ...G, tool: 0 }],
    ],
    trails: [{ from: 0.26, to: 0.58, type: 'arc', cx: 54, cy: 60, r: 72, a0: -2.5, a1: 0.25, w: 14 }],
  },
  // U-SMASH — PISTÓN: planta las piernas, se agacha y dispara la llave recta
  // hacia arriba; el retroceso del disparo lo hunde después.
  uppercut: {
    effector: 'tool',
    keys: [
      [0, { ...G, tool: 0 }],
      [0.15, { F: [52, 70], B: [36, 66], ty: 6, lean: -1, tool: 0.4, toolAngle: -1.57, ff: [4, 0], fb: [-4, 0] }],
      [0.3, { F: [48, 8], B: [34, 30], ty: -3, hy: -2, tool: 1, toolAngle: -1.57, ff: [4, 0], fb: [-4, 0] }],
      [0.42, { F: [48, 8], B: [34, 30], ty: -3, hy: -2, tool: 1, toolAngle: -1.57, ff: [4, 0], fb: [-4, 0] }],
      [0.56, { F: [48, 14], B: [36, 38], ty: 5, hy: 2, tool: 1, toolAngle: -1.57, ff: [4, 0], fb: [-4, 0] }],
      [0.8, { F: [58, 40], B: [44, 46], ty: 1, tool: 0.6, toolAngle: -1.2 }],
      [1, { ...G, tool: 0 }],
    ],
    trails: [{ from: 0.26, to: 0.5, type: 'streak', x0: 48, y0: 40, x1: 48, y1: -58, w: 12 }],
  },
  // D-SMASH — EL SILLAZO GAMER: coge la silla, la ALZA sobre la cabeza
  // agarrada por la base de las ruedas (la carga se congela aquí), la echa
  // atrás por encima del hombro como un hacha y la estampa hacia delante en
  // DOS TIEMPOS: golpe, rebote corto y golpe, con el respaldo contra el suelo.
  chairslam: {
    effector: 'chair',
    keys: [
      [0, { ...G, chair: 0 }],
      [0.07, { F: [60, 40], B: [36, 40], chair: 1, chairAngle: -1.57, ty: 3 }],
      [0.15, { F: [48, 2], B: [38, 4], chair: 1, chairAngle: -1.7, ty: -3, lean: -3, hy: -1, ff: [2, 0], fb: [-4, 0] }],
      [0.27, { F: [42, 0], B: [34, 2], chair: 1, chairAngle: -2.25, ty: -4, lean: -6, hy: -2, ff: [4, 0], fb: [-6, 0] }],
      [0.3, { F: [66, 50], B: [54, 52], chair: 1, chairAngle: 1.15, ty: 8, lean: 9, hx: 3, ff: [12, 0], fb: [-8, 0] }],
      [0.38, { F: [66, 42], B: [54, 44], chair: 1, chairAngle: 0.9, ty: 6, lean: 7, hx: 2, ff: [12, 0], fb: [-8, 0] }],
      [0.45, { F: [66, 50], B: [54, 52], chair: 1, chairAngle: 1.15, ty: 8, lean: 9, hx: 3, ff: [12, 0], fb: [-8, 0] }],
      [0.5, { F: [66, 50], B: [54, 52], chair: 1, chairAngle: 1.15, ty: 8, lean: 9, hx: 3, ff: [12, 0], fb: [-8, 0] }],
      [0.72, { F: [64, 52], B: [52, 54], chair: 1, chairAngle: 1.15, ty: 5, lean: 5, ff: [8, 0], fb: [-6, 0] }],
      [0.86, { F: [58, 56], B: [36, 58], chair: 1, chairAngle: 0.5, ty: 2 }],
      [0.9, { ...G, chair: 0, ty: 2 }],
      [1, { ...G, chair: 0 }],
    ],
    trails: [{ from: 0.26, to: 0.5, type: 'arc', cx: 50, cy: 58, r: 60, a0: -2.4, a1: 1.1, w: 12 }],
  },
  // O (carga) — INHALAR: se hincha visiblemente según carga. Aquí `t` es la
  // carga (0..1), no la fase de un golpe.
  inhale: {
    keys: [
      [0, { F: [62, 50], B: [30, 52], ty: 2 }],
      [0.5, { F: [70, 54], B: [18, 56], ty: 1, hy: -1, lean: -2, inflate: 0.6 }],
      [1, { F: [74, 56], B: [12, 58], hy: -2, lean: -3, inflate: 1 }],
    ],
    trails: [],
  },
  // O (suelta) — EL ERUCTO: se deshincha de golpe hacia delante, boca abierta.
  burp: {
    keys: [
      [0, { F: [72, 56], B: [14, 58], inflate: 1, lean: -3, hy: -2 }],
      [0.3, { F: [58, 60], B: [22, 60], inflate: 0.2, lean: 4, hx: 4, mouthOpen: 1, shock: 0.4 }],
      [0.5, { F: [58, 60], B: [22, 60], lean: 4, hx: 4, mouthOpen: 1, shock: 1 }],
      [0.75, { F: [60, 48], B: [34, 50], lean: 1, hx: 1, mouthOpen: 0.4, smokePuff: 0.35 }],
      [1, G],
    ],
    trails: [],
  },
  // UP-B — PROPULSIÓN: se contrae en una bola y la detonación de gas lo
  // catapulta, estirado y con los brazos arriba.
  rocket: {
    keys: [
      [0, { ...G }],
      [0.25, { F: [58, 58], B: [28, 58], ty: 8, inflate: 0.5, ff: [4, -14], fb: [-4, -14] }],
      [0.3, { F: [58, 6], B: [34, 8], ty: -4, hy: -2, ff: [-3, 0], fb: [3, 0], gas: 1, gasX: 0.5, gasY: 0.98, gasAngle: Math.PI / 2 }],
      [0.5, { F: [58, 6], B: [34, 8], ty: -4, hy: -2, ff: [-3, 0], fb: [3, 0], gas: 1, gasX: 0.5, gasY: 0.98, gasAngle: Math.PI / 2 }],
      [0.8, { F: [60, 14], B: [32, 16], ty: -3, hy: -1, ff: [-2, -2], fb: [2, -2], gas: 0.3, gasX: 0.5, gasY: 0.98, gasAngle: Math.PI / 2 }],
      [1, { F: [62, 20], B: [30, 22], ty: -2, ff: [0, -4], fb: [0, -4] }],
    ],
    trails: [{ from: 0.28, to: 0.6, type: 'streak', x0: 40, y0: 118, x1: 40, y1: 40, w: 14 }],
  },
  // DOWN-B — EL PEDO ATÓMICO: se agacha flexionando las piernas y la
  // detonación de gas bajo el cuerpo lo catapulta hacia arriba, estirado.
  waft: {
    keys: [
      [0, G],
      [0.22, { F: [60, 70], B: [26, 70], ty: 14, lean: 3, inflate: 0.7, hy: 1, ff: [8, 0], fb: [-8, 0] }],
      [0.28, { F: [58, 74], B: [28, 74], ty: 16, lean: 4, inflate: 1, hy: 2, ff: [10, 0], fb: [-10, 0] }],
      [0.3, { F: [72, 4], B: [12, 6], ty: -4, hy: -2, mouthOpen: 0.6, gas: 1, gasX: 0.5, gasY: 0.96, gasAngle: Math.PI / 2, ff: [4, -4], fb: [-4, -4] }],
      [0.5, { F: [72, 4], B: [12, 6], ty: -4, hy: -2, mouthOpen: 0.6, gas: 1, gasX: 0.5, gasY: 0.96, gasAngle: Math.PI / 2, ff: [4, -4], fb: [-4, -4] }],
      [0.75, { F: [62, 34], B: [26, 36], ty: -2, gas: 0.3, gasX: 0.5, gasY: 0.96, gasAngle: Math.PI / 2, ff: [3, -6], fb: [-3, -6] }],
      [1, AIR],
    ],
    trails: [],
  },
  // UP-B — EL ABRAZO AÉREO: salta con los brazos abiertos hacia arriba,
  // buscando a quien atrapar.
  flyingslam: {
    keys: [
      [0, G],
      [0.22, { F: [58, 60], B: [26, 60], ty: 10, lean: 2, ff: [6, 0], fb: [-6, 0] }],
      [0.3, { F: [74, 6], B: [10, 8], ty: -4, hy: -3, ff: [2, -4], fb: [-2, -4] }],
      [0.5, { F: [72, 4], B: [12, 6], ty: -4, hy: -3, ff: [2, -6], fb: [-2, -6] }],
      [0.8, { F: [68, 14], B: [16, 16], ty: -2, hy: -1, ff: [2, -8], fb: [-2, -8] }],
      [1, AIR],
    ],
    trails: [{ from: 0.28, to: 0.6, type: 'streak', x0: 40, y0: 116, x1: 40, y1: 40, w: 12 }],
  },
  // UP-B (agarrado) — EL PICADO: volteado encima del rival, los brazos
  // abajo sujetándolo y las piernas arriba.
  slamdive: {
    keys: [
      [0, { F: [72, 88], B: [60, 90], lean: 8, ty: 4, hx: 3, ff: [-6, -26], fb: [-14, -30] }],
      [1, { F: [72, 88], B: [60, 90], lean: 8, ty: 4, hx: 3, ff: [-6, -26], fb: [-14, -30] }],
    ],
    trails: [{ from: 0, to: 1, type: 'streak', x0: 40, y0: -20, x1: 40, y1: 40, w: 16 }],
  },
  // SIDE-B — EMBESTIDA: carrera pesada agachado, el cojín donut por delante
  // del pecho.
  special: {
    keys: [
      [0, G],
      [0.2, { F: [58, 50], B: [44, 52], ty: 3, lean: 2, tool: 1, toolKind: 'donut' }],
      [0.3, { F: [66, 58], B: [54, 58], ty: 6, lean: 6, hx: 3, tool: 1, toolKind: 'donut', smokePuff: 0.3, ff: [10, -4], fb: [-10, 0] }],
      [0.4, { F: [66, 60], B: [54, 60], ty: 5, lean: 6, hx: 3, tool: 1, toolKind: 'donut', smokePuff: 0.6, ff: [-6, 0], fb: [8, -4] }],
      [0.5, { F: [66, 58], B: [54, 58], ty: 6, lean: 6, hx: 3, tool: 1, toolKind: 'donut', smokePuff: 0.3, ff: [10, -4], fb: [-10, 0] }],
      [0.7, { F: [62, 52], B: [48, 54], ty: 3, lean: 2, tool: 1, toolKind: 'donut' }],
      [1, { ...G, tool: 0, toolKind: 'donut' }],
    ],
    trails: [],
  },
};

// --- MODO DESPERTADO: el rapero (solo su tabla las usa) ---------------------
// El micro dorado va en la mano DELANTERA (`toolKind: 'mic'`, orientado con
// `toolAngle`: su cabeza es el efector 'mic').
const MIC_AT_MOUTH = { F: [56, 40], tool: 1, toolKind: 'mic', toolAngle: -2.2 };

Object.assign(KEYED_POSES, {
  // JAB — PUNCHLINE METRALLETA: el micro pegado a la boca (escupe rimas) y la
  // otra mano dispara puñetazos al aire. Es UN golpe del bucle de 6: cada
  // vuelta es un puñetazo.
  micjab: {
    effector: 'B',
    keys: [
      [0, { ...MIC_AT_MOUTH, B: [44, 54], lean: 2, mouthOpen: 0.5 }],
      [0.3, { ...MIC_AT_MOUTH, B: [90, 50], tx: 3, lean: 5, hx: 1, mouthOpen: 1 }],
      [0.5, { ...MIC_AT_MOUTH, B: [90, 50], tx: 3, lean: 5, hx: 1, mouthOpen: 1 }],
      [1, { ...MIC_AT_MOUTH, B: [48, 54], lean: 2, mouthOpen: 0.5 }],
    ],
    trails: [{ from: 0.26, to: 0.6, type: 'streak', x0: 56, y0: 50, x1: 92, y1: 50, w: 6 }],
  },
  // F-SMASH y remate del jab — DROP THE MIC: el brazo atrás con el micro en
  // alto (pose de hip-hop: la carga se congela aquí) y lo estrella contra el
  // suelo delante, agachado sobre el golpe. La cabeza del micro, en el
  // suelo, es el sweetspot.
  micslam: {
    effector: 'mic',
    keys: [
      [0, { ...G, tool: 1, toolKind: 'mic', toolAngle: -1.6 }],
      [0.12, { F: [40, 26], B: [58, 52], lean: -5, ty: 1, hy: -1, tool: 1, toolKind: 'mic', toolAngle: -2.4, ff: [4, 0] }],
      [0.27, { F: [34, 20], B: [60, 54], lean: -7, ty: 2, hy: -2, tool: 1, toolKind: 'mic', toolAngle: -2.6, ff: [6, 0], fb: [-4, 0] }],
      [0.3, { F: [80, 88], B: [48, 64], lean: 11, ty: 14, hx: 3, tool: 1, toolKind: 'mic', toolAngle: 1.2, ff: [12, 0], fb: [-8, 0] }],
      [0.5, { F: [80, 88], B: [48, 64], lean: 11, ty: 14, hx: 3, tool: 1, toolKind: 'mic', toolAngle: 1.2, ff: [12, 0], fb: [-8, 0] }],
      [0.75, { F: [70, 66], B: [44, 60], lean: 5, ty: 7, tool: 1, toolKind: 'mic', toolAngle: 0.6, ff: [8, 0] }],
      [1, { ...G, tool: 1, toolKind: 'mic', toolAngle: -1.6 }],
    ],
    trails: [{ from: 0.26, to: 0.5, type: 'arc', cx: 58, cy: 60, r: 50, a0: -2.4, a1: 1.1, w: 10 }],
  },
  // U-SMASH — SUBWOOFER: echado atrás, las manos en la barriga, se hincha y
  // eructa en VERTICAL. El cono de ondas es un efecto (fx 'subwoofer').
  burpsky: {
    keys: [
      [0, G],
      [0.2, { F: [60, 66], B: [36, 66], inflate: 1, lean: -2, hy: 1 }],
      [0.3, { F: [60, 70], B: [36, 70], inflate: 0.2, lean: -7, hy: -4, mouthOpen: 1, shock: 0.6, shockAngle: -Math.PI / 2, shockX: 0.5, shockY: 0.02, ff: [4, 0], fb: [-4, 0] }],
      [0.5, { F: [60, 70], B: [36, 70], lean: -7, hy: -4, mouthOpen: 1, shock: 1, shockAngle: -Math.PI / 2, shockX: 0.5, shockY: 0.02, ff: [4, 0], fb: [-4, 0] }],
      [0.75, { F: [60, 62], B: [38, 62], lean: -3, hy: -1, mouthOpen: 0.3 }],
      [1, G],
    ],
    trails: [],
  },
  // D-SMASH — BREAKDANCE: se tira al suelo apoyado en las manos, las piernas
  // ABIERTAS barren a los dos lados (molino: se cruzan y vuelven a abrir) y
  // remata de culo contra el suelo.
  windmill: {
    effector: 'ff',
    keys: [
      [0, G],
      [0.18, { F: [66, 96], B: [18, 96], ty: 10, lean: 2, ff: [6, -6], fb: [-6, -6] }],
      [0.3, { F: [62, 104], B: [20, 104], ty: 12, ff: [38, -12], fb: [-38, -12] }],
      [0.4, { F: [62, 104], B: [20, 104], ty: 12, ff: [-4, -26], fb: [4, -26] }],
      [0.45, { F: [62, 104], B: [20, 104], ty: 12, ff: [38, -12], fb: [-38, -12] }],
      [0.5, { F: [62, 104], B: [20, 104], ty: 12, ff: [38, -12], fb: [-38, -12] }],
      [0.7, { F: [62, 100], B: [22, 100], ty: 12, ff: [14, -4], fb: [-14, -4] }],
      [1, G],
    ],
    trails: [
      // A ras de suelo, sin bajar de los pies (y 120).
      { from: 0.28, to: 0.52, type: 'arc', cx: 40, cy: 96, r: 40, a0: -0.6, a1: 0.3, w: 8 },
      { from: 0.28, to: 0.52, type: 'arc', cx: 40, cy: 96, r: 40, a0: 2.84, a1: 3.74, w: 8 },
    ],
  },
  // F-AIR — DROPKICK: las dos piernas por delante, el cuerpo echado atrás.
  dropkick: {
    effector: 'ff',
    keys: [
      [0, AIR],
      [0.2, { F: [52, 36], B: [30, 40], lean: -3, ff: [8, -30], fb: [2, -26] }],
      [0.3, { F: [40, 42], B: [18, 48], lean: -9, hy: 1, ff: [44, -42], fb: [38, -34] }],
      [0.5, { F: [40, 42], B: [18, 48], lean: -9, hy: 1, ff: [44, -42], fb: [38, -34] }],
      [0.75, { F: [50, 40], B: [28, 46], lean: -4, ff: [18, -20], fb: [12, -16] }],
      [1, AIR],
    ],
    trails: [{ from: 0.26, to: 0.52, type: 'streak', x0: 60, y0: 74, x1: 98, y1: 70, w: 10 }],
  },
  // D-AIR — BOMBA FÉTIDA: rodillas al pecho y el culo por delante, en
  // picado, con el gas saliendo por debajo todo el descenso.
  divebomb: {
    keys: [
      [0, AIR],
      [0.15, { F: [58, 26], B: [30, 26], ty: -6, inflate: 0.4, ff: [6, -26], fb: [-6, -26] }],
      [0.3, { F: [66, 36], B: [18, 36], ty: 12, inflate: 0.3, ff: [16, -18], fb: [8, -16], gas: 1, gasX: 0.5, gasY: 0.92, gasAngle: Math.PI / 2 }],
      [0.5, { F: [66, 36], B: [18, 36], ty: 12, inflate: 0.3, ff: [16, -18], fb: [8, -16], gas: 1, gasX: 0.5, gasY: 0.92, gasAngle: Math.PI / 2 }],
      [0.75, { F: [62, 42], B: [28, 44], ty: 4, ff: [8, -10], fb: [0, -10], gas: 0.4, gasX: 0.5, gasY: 0.9, gasAngle: Math.PI / 2 }],
      [1, AIR],
    ],
    trails: [{ from: 0.28, to: 0.5, type: 'streak', x0: 40, y0: 40, x1: 40, y1: 116, w: 12 }],
  },
  // O NEUTRO — PURO HABANERO: se lleva el puro a la boca, CALADA (la brasa al
  // rojo y se hincha) y exhala la nube hacia delante.
  habano: {
    keys: [
      [0, { ...G, tool: 0, toolKind: 'cigar', toolAngle: -0.3 }],
      [0.12, { F: [52, 34], B: [34, 54], tool: 1, toolKind: 'cigar', toolAngle: -0.2, lean: -1 }],
      [0.26, { F: [48, 28], B: [34, 54], tool: 1, toolKind: 'cigar', toolAngle: 0, ember: 1, inflate: 0.7, hy: -1, lean: -3 }],
      [0.3, { F: [64, 50], B: [30, 56], tool: 1, toolKind: 'cigar', toolAngle: 0.3, ember: 0.5, mouthOpen: 0.8, smokePuff: 1, lean: 3, hx: 2 }],
      [0.5, { F: [64, 50], B: [30, 56], tool: 1, toolKind: 'cigar', toolAngle: 0.3, ember: 0.5, mouthOpen: 0.8, smokePuff: 1, lean: 3, hx: 2 }],
      [0.8, { F: [60, 54], B: [26, 58], tool: 1, toolKind: 'cigar', toolAngle: 0.1, smokePuff: 0.4 }],
      [1, { ...G, tool: 0, toolKind: 'cigar', toolAngle: -0.3 }],
    ],
    trails: [],
  },
  // LATERAL + O — RAP BATTLE DASH: deslizamiento agachado, el puño por
  // delante, como quien entra en la batalla.
  rapdash: {
    effector: 'F',
    keys: [
      [0, G],
      [0.2, { F: [60, 60], B: [30, 58], ty: 8, lean: 4, ff: [6, -2], fb: [-8, 0] }],
      [0.3, { F: [76, 72], B: [16, 62], ty: 12, lean: 8, hx: 3, ff: [16, -6], fb: [-20, 0] }],
      [0.5, { F: [76, 72], B: [16, 62], ty: 12, lean: 8, hx: 3, ff: [16, -6], fb: [-20, 0] }],
      [0.75, { F: [66, 62], B: [26, 60], ty: 6, lean: 3, ff: [8, -2], fb: [-8, 0] }],
      [1, G],
    ],
    trails: [{ from: 0.26, to: 0.52, type: 'streak', x0: 4, y0: 96, x1: 44, y1: 96, w: 14 }],
  },
  // ABAJO + O — PARRY: brazos cruzados y sonrisa sobrada (la actitud del
  // reposo despertado, `stance: 'idle'`), barbilla arriba.
  parry: {
    keys: [
      [0, { stance: 'idle' }],
      [0.3, { stance: 'idle', lean: -2, hy: -1 }],
      [0.5, { stance: 'idle', lean: -2, hy: -1 }],
      [1, { stance: 'idle' }],
    ],
    trails: [],
  },
  // El golpe del parry: puñetazo cargado, recto y con todo el cuerpo detrás.
  parrypunch: {
    effector: 'F',
    keys: [
      [0, { F: [46, 50], B: [34, 48], lean: -4, tx: -2 }],
      [0.2, { F: [40, 50], B: [30, 46], lean: -6, tx: -4, fist: 1 }],
      [0.3, { F: [94, 54], B: [26, 58], lean: 7, tx: 6, hx: 3, fist: 1, ff: [8, 0], fb: [-8, 0] }],
      [0.5, { F: [94, 54], B: [26, 58], lean: 7, tx: 6, hx: 3, fist: 1, ff: [8, 0], fb: [-8, 0] }],
      [0.75, { F: [70, 50], B: [30, 54], lean: 2, tx: 2 }],
      [1, G],
    ],
    trails: [{ from: 0.26, to: 0.54, type: 'streak', x0: 50, y0: 54, x1: 96, y1: 54, w: 8 }],
  },
  // FINAL SMASH DESPERTADO — lanza la GORRA a toda pantalla: desde el
  // lanzamiento ya no la lleva puesta (`capOff`).
  capthrow: {
    effector: 'F',
    keys: [
      [0, G],
      [0.2, { F: [42, 18], B: [30, 52], lean: -5, hy: -1 }],
      [0.3, { F: [92, 42], B: [26, 58], lean: 6, tx: 4, hx: 2, capOff: 1, ff: [8, 0] }],
      [0.5, { F: [92, 42], B: [26, 58], lean: 6, tx: 4, hx: 2, capOff: 1, ff: [8, 0] }],
      [0.75, { F: [70, 48], B: [28, 56], lean: 2, capOff: 1 }],
      [1, { ...G, capOff: 1 }],
    ],
    trails: [{ from: 0.26, to: 0.5, type: 'arc', cx: 50, cy: 40, r: 42, a0: -2.2, a1: 0.1, w: 8 }],
  },
  // Pose de la cinemática de la Batalla: la de la foto — piernas abiertas,
  // el micro dorado a la boca y el otro brazo señalando al rival. Rebota al
  // ritmo (la recorre el director de 0 a 1 en bucle).
  battlestance: {
    keys: [
      [0, { ...MIC_AT_MOUTH, B: [70, 48], ff: [10, 0], fb: [-12, 0], lean: -2, mouthOpen: 0.6 }],
      [0.5, { ...MIC_AT_MOUTH, B: [72, 44], ff: [10, 0], fb: [-12, 0], lean: -3, ty: 2, hy: -1, mouthOpen: 1 }],
      [1, { ...MIC_AT_MOUTH, B: [70, 48], ff: [10, 0], fb: [-12, 0], lean: -2, mouthOpen: 0.6 }],
    ],
    trails: [],
  },
});

// Cuántos frames hornea el atlas de cada una. 10 por defecto: con la fase
// canónica, los frames 3 y 4 caen EXACTOS en [0.3, 0.5), los activos. Los
// golpes con ventana activa larga (el giro del Nair, la embestida) llevan 20
// para que el impacto tenga 4 dibujos y no 2.
export const KEYED_FRAME_COUNT = {
  spin360: 20, special: 20, rapidjab: 10, chairslam: 20, // la silla: golpe, rebote y golpe
};

// --- muestreo -------------------------------------------------------------

const smooth = (t) => t * t * (3 - 2 * t);

// Valor de un campo en una clave. Lo que la clave NO dice vale lo de reposo:
// así `fist: 1` en la clave de impacto sube de 0 a 1 al acercarse a ella en
// vez de valer 1 desde el primer frame.
function fieldOf(key, field) {
  const v = key[1][field];
  if (v !== undefined) return v;
  if (field === 'F') return REST_F;
  if (field === 'B') return REST_B;
  if (field === 'ff' || field === 'fb') return [0, 0];
  return NUMERIC_DEFAULTS[field];
}

function valueAt(keys, t, field) {
  // Cadenas (toolKind): la última clave que lo dice, o la primera si aún no.
  if (typeof keys.find((k) => k[1][field] !== undefined)[1][field] === 'string') {
    let v;
    for (const key of keys) if (key[1][field] !== undefined && (key[0] <= t || v === undefined)) v = key[1][field];
    return v;
  }
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1][0] <= t) i += 1;
  const prev = keys[i];
  const next = keys[Math.min(i + 1, keys.length - 1)];
  const a = fieldOf(prev, field);
  let b = fieldOf(next, field);
  // Los ángulos giran por el camino CORTO: de 2.5 a -2.9 rad la llave pasa
  // por detrás (+0.9), no da la vuelta entera apuntando al frente (-5.4).
  if (field === 'toolAngle' || field === 'chairAngle') {
    while (b - a > Math.PI) b -= Math.PI * 2;
    while (a - b > Math.PI) b += Math.PI * 2;
  }
  if (next === prev || next[0] <= prev[0]) return a;
  const k = smooth(Math.max(0, Math.min(1, (t - prev[0]) / (next[0] - prev[0]))));
  if (Array.isArray(a)) return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  return a + (b - a) * k;
}

/**
 * Rellena `pose` con la pose clave `def` en la fase `t` (0..1). Devuelve la
 * misma pose. Los campos que la definición no toca se quedan como vengan.
 */
export function applyKeyedPose(pose, def, t) {
  const fields = new Set();
  for (const [, key] of def.keys) for (const f of Object.keys(key)) fields.add(f);
  for (const field of fields) {
    const v = valueAt(def.keys, t, field);
    switch (field) {
      case 'F':
        pose.armFrontOffX = v[0] - REST_F[0];
        pose.armFrontOffY = v[1] - REST_F[1];
        break;
      case 'B':
        pose.armBackOffX = v[0] - REST_B[0];
        pose.armBackOffY = v[1] - REST_B[1];
        break;
      case 'ff':
        pose.legFrontOffX = v[0];
        pose.legFrontOffY = v[1];
        break;
      case 'fb':
        pose.legBackOffX = v[0];
        pose.legBackOffY = v[1];
        break;
      // La cabeza se escribe relativa al torso (ver la cabecera): se suma
      // abajo, cuando ya se sabe cuánto se ha movido el torso.
      case 'hx': pose.headOffX = v; break;
      case 'hy': pose.headOffY = v; break;
      case 'tx': pose.torsoOffX = v; break;
      case 'ty': pose.torsoOffY = v; break;
      default: pose[field] = v;
    }
  }
  if (!fields.has('hx')) pose.headOffX = 0;
  if (!fields.has('hy')) pose.headOffY = 0;
  pose.headOffX += pose.torsoOffX || 0;
  pose.headOffY += pose.torsoOffY || 0;
  // Estelas activas en esta fase, con su intensidad: entra rápido, se apaga
  // despacio (triángulo asimétrico dentro de su tramo).
  pose.trails = [];
  for (const tr of def.trails || []) {
    if (t < tr.from || t > tr.to) continue;
    const u = (t - tr.from) / (tr.to - tr.from);
    const alpha = u < 0.25 ? u / 0.25 : 1 - (u - 0.25) / 0.75;
    pose.trails.push({ ...tr, alpha: Math.max(0, alpha) });
  }
  return pose;
}

/**
 * Dónde está, en coordenadas del sprite, la parte del cuerpo o del arma que
 * GOLPEA en una pose clave (`def.effector`). Replica la geometría del kit
 * (reposo de manos y tobillos, largo de la llave) y es lo que usa el test que
 * exige que cada hitbox activa envuelva a su efector: la caja va anclada a la
 * extremidad o al arma, no flotando delante de un codo doblado.
 *   F / B   puño delantero / trasero
 *   ff / fb tobillo delantero / trasero (la bota lo rodea)
 *   tool    punta de la llave
 *   belly   el frente de la barriga
 *   mic     la cabeza del micro dorado (Modo Despertado)
 *   chair   el cabecero de la silla gamer (D-Smash)
 */
export function effectorPoint(pose, effector, w = 80, h = 120) {
  const handF = [w / 2 + 21 + pose.armFrontOffX, 62 + pose.armFrontOffY];
  switch (effector) {
    case 'F': return handF;
    case 'B': return [w / 2 - 20 + pose.armBackOffX, 61 + pose.armBackOffY];
    case 'ff': return [w / 2 + 13 + pose.legFrontOffX, h - 12 + pose.legFrontOffY];
    case 'fb': return [w / 2 - 12 + pose.legBackOffX, h - 12 + pose.legBackOffY];
    case 'tool': {
      const len = 64 * (0.65 + (pose.tool || 0) * 0.35);
      return [handF[0] + Math.cos(pose.toolAngle) * len, handF[1] + 2 + Math.sin(pose.toolAngle) * len];
    }
    case 'belly': return [w / 2 + (pose.torsoOffX || 0) + 23 + (pose.inflate || 0) * 7, 62 + (pose.torsoOffY || 0)];
    // El cabecero de la silla gamer: a CHAIR_LENGTH (72) por su eje y 14 px
    // hacia atrás del asiento, que es donde va el respaldo (pixelFighterArt.js).
    case 'chair': {
      const a = pose.chairAngle;
      return [handF[0] + Math.cos(a) * 72 + Math.sin(a) * 14, handF[1] + 2 + Math.sin(a) * 72 - Math.cos(a) * 14];
    }
    // Cabeza del micro dorado (MIC_LENGTH = 22 en pixelFighterArt.js).
    case 'mic': return [handF[0] + Math.cos(pose.toolAngle) * 22, handF[1] + 2 + Math.sin(pose.toolAngle) * 22];
    default: return null;
  }
}
