// EL PATIO DEL INSTITUTO — primer escenario oficial de Mafia Fighters.
//
// Reconstruccion en pixel art del patio real, compuesta como un plano general
// de recreativa de los 90 (Street Fighter II / CPS2): el polideportivo al
// fondo y la pista de hormigon a sus pies.
//
// Este modulo es SOLO ARTE Y DATOS, igual que un `fighterN.js` es solo datos
// de personaje: no conoce la camara, ni la cache, ni el parallax. Declara su
// horizonte, sus semillas de ruido y tres funciones de pintado (una por capa)
// que reciben el contexto, la rejilla de pixeles y un RNG ya sembrado. El
// motor (`engine/stage.js`) es quien hornea, cachea y desplaza.
//
// ===========================================================================
// LAS TRES REGLAS DE COMPOSICION, Y POR QUE
// ===========================================================================
//
// 1. EL EDIFICIO ES UN BLOQUE, NO UN MURO INFINITO. Es la regla que mas veces
//    se ha roto. Una fachada que cruza la pantalla de punta a punta con las
//    ventanas y el mural repitiendose no se lee como un polideportivo: se lee
//    como un pasillo cerrado, y encima delata el truco — el ojo reconoce el
//    PATRON PERIODICO mucho antes que el edificio. El polideportivo real
//    tiene dos cuerpos y dos esquinas, y a los lados se ve la arboleda y el
//    patio abierto, que es lo que le da profundidad al fondo:
//
//      [ patio ] [ cuerpo bajo ] [ ------- nave alta ------- ] [ patio ]
//      -160..40      40..120       120 ..................... 450   450..640
//
//    El mural va en UNA franja compacta a la derecha de la escalera, no
//    repetido por todo el mapa. Hay un test que exige que las siluetas esten
//    en un unico tramo contiguo y que ese tramo no pase del 40% del ancho
//    horneado — con el mural repetido, la comprobacion salta.
//
// 2. PLANO GENERAL: NI MAQUETA NI MACRO. La escala del fondo tiene dos
//    extremos y los dos se ven mal. Con el pabellon metido en una caja de
//    240px la fachada entera era mas baja que un luchador (maqueta); al
//    corregirlo se fue a figuras de mural de 68px de las que solo cabian
//    cuatro (plano macro de un trozo de pared). Lo que sostiene el plano
//    general son las PROPORCIONES del edificio real —franja azul 34,
//    ventanal 34, pano blanco 90, zocalo 14— y el ENCUADRE ANCHO: el plano
//    que hay que componer es el del zoom out (0.75x), que es donde se ve el
//    escenario entero. Ahi la linea de tejado tiene que caer en el tercio
//    alto de la pantalla: mas abajo y el pabellon vuelve a ser una maqueta,
//    mas arriba y asfixia el encuadre. Hay un test que la mide.
//
//    Con la nave a 172px y un cuerpo a 108, el edificio mide 1.6 luchadores.
//    Parece poco para un polideportivo de dos plantas y es a proposito: a
//    escala real serian ocho metros, o sea 480px, y no habria franja azul que
//    ver. Lo que no puede pasar es lo que pasaba antes del reescalado, con la
//    fachada entera a 125px: Samuel casi tan alto como el pabellon.
//
//    La escala del edificio es DISTINTA de la del personaje (~19px por metro
//    frente a los ~60 de un cuerpo de 108px) y es deliberado: es la
//    convencion de fondo de cualquier arcade 2D. Lo importante es que sea
//    CONSISTENTE — la puerta de la planta alta y las figuras del mural miden
//    lo que tienen que medir ENTRE SI.
//
// 3. EDIFICIO Y SUELO SON UNA SOLA ILUSTRACION, EN LA MISMA CAPA (1.0).
//    El parallax entre ellos era el bug de fondo: al panear, la base del
//    edificio se deslizaba sobre la pista y el luchador dejaba de estar
//    plantado en el suelo que la sostiene. Comparten capa, asi que la camara
//    los mueve y los escala JUNTOS. Tambien las torres de luz, porque estan
//    PLANTADAS EN LA PISTA: lo que decide la capa no es la estetica ni la
//    distancia aparente, es si el elemento toca el suelo que pisan los
//    luchadores. La arboleda del fondo si lleva parallax, porque esta de
//    verdad al otro lado del patio.
//
//    Y entre el edificio y los pies no puede meterse nada horizontal —ni
//    valla, ni bordillo, ni murete—: a cinco pixeles de sus pies eso no se
//    lee como fondo lejano sino como el canto de una plataforma. Lo unico
//    que va ahi es la sombra que el edificio proyecta sobre la pista.
//
// REPARTO POR CAPAS (los factores los fija el motor: 0.15 / 0.45 / 1.0):
//
//   far  (0.15) cielo plomizo, nubes y la grua de obra.
//   mid  (0.45) la arboleda que cierra el patio, visible A LOS LADOS del
//               edificio y por encima del cuerpo bajo.
//   front(1.0)  EL ESCENARIO: el polideportivo entero, las torres de luz del
//               patio y la pista con sus lineas, el sumidero y los dos tramos
//               LATERALES de vallado.

import { STAGE_WIDTH, GROUND_Y } from './courtyardFrame.js';

// Base del edificio: cinco pixeles por encima de donde pisan los luchadores.
// Se DERIVA de GROUND_Y para que el plano donde pisan, sus sombras de
// contacto y los charcos persistentes del VFX sean exactamente el mismo.
export const HORIZON_Y = GROUND_Y - 5;

// Ultima fila de pista que la camara puede llegar a ver (GROUND_ANCHOR_Y en
// camera.js ancla el borde inferior de la vista en 260).
const COURT_NEAR_Y = 268;

// Escala de personaje: el cuerpo de un luchador son 108px.
const BODY_HEIGHT = 108;

// --- Planta del edificio ---------------------------------------------------
// El edificio CABE EN EL ENCUADRE con patio a los dos lados. Es el requisito
// que lo separa de una pared: a la izquierda del cuerpo bajo y a la derecha de
// la nave tiene que verse la arboleda y el espacio abierto, o vuelve a leerse
// como un pasillo cerrado por mucha esquina que se le dibuje. Con la camara en
// reposo se ve 0..480, asi que 40 y 450 dejan 40px de patio a un lado y 30 al
// otro sin sacar la fachada de cuadro.
const ANNEX_LEFT = 40;
const ANNEX_RIGHT = 120;
const ANNEX_ROOF_Y = 98;

const HALL_LEFT = 120;
const HALL_RIGHT = 450;

// Despiece vertical de la nave alta, de abajo arriba. Las franjas SUMAN su
// altura en vez de ser cuatro numeros sueltos que hay que cuadrar a mano:
// cambiar una y que el resto se recoloque solo es lo que impide que dos
// piezas acaben dibujadas una encima de otra. Ya paso — el mural terminaba
// pintado dentro del ventanal y, como se pinta el ultimo, se tragaba ademas
// la puerta.
const PLINTH_H = 14; // zocalo azul corrido a ras de suelo
const WHITE_H = 90; // gran pano blanco, limpio y vertical
const WINDOW_H = 34; // paneles rectangulares con parteluz inclinado
const BLUE_H = 34; // franja azul cobalto del tejado

const PLINTH_Y = HORIZON_Y - PLINTH_H; // 181
const WHITE_Y = PLINTH_Y - WHITE_H; // 91
const WINDOW_Y = WHITE_Y - WINDOW_H; // 57
const HALL_ROOF_Y = WINDOW_Y - BLUE_H; // 23

// Torre-escalera: pilastra azul con la puerta de la planta alta y el tramo
// que sube hasta ella.
const STAIR_X = 146;
const STAIR_W = 22;
// El PIE del tramo se aleja lo mismo que ha subido la puerta: escalar solo
// la altura deja la misma escalera estirada, o sea una rampa de 63 grados
// apoyada en la fachada. Lo que se conserva al reescalar es el ANGULO.
const STAIR_FOOT_X = 108;
const STAIR_DOOR_Y = WHITE_Y + 6;
const STAIR_DOOR_H = 42;

// --- Paleta ----------------------------------------------------------------
//
// Regla de luminancia: NADA llega al blanco puro. La fachada mas clara se
// queda en #eceae3 (lum ~234) a proposito — el lightingManager compone en
// modo `lighter`, asi que un fondo saturado a 255 se comeria el fogonazo del
// gas y la brasa del cigarro y la luz aditiva dejaria de verse. Hay un test
// que mide ese margen.
const PAL = {
  skyTop: '#9fb0bf',
  skyMid: '#b0bcc7',
  skyLow: '#cbd5de',
  skyHorizon: '#dbe3ea',
  cloudLight: '#e6ecf1',
  cloudMid: '#c6d1db',
  cloudDark: '#a7b5c3',

  craneMetal: '#9aa1aa',
  craneDark: '#6d747d',
  craneWarn: '#d0a94e',

  treeLight: '#5f8f62',
  tree: '#4c7a50',
  treeDark: '#38603d',
  trunk: '#4c3d2e',

  wall: '#eceae3',
  wallShade: '#e0ddd4',
  wallDeep: '#cdc8bc',
  wallGrime: '#c0bbae',
  blue: '#1b4d99',
  blueLight: '#2b63b8',
  blueDark: '#143b76',
  glass: '#e8dfae',
  glassDark: '#cbbf86',

  concrete: '#c6c2b8',
  concreteAlt: '#c1bdb3',
  concreteLight: '#cecac0',
  concreteDark: '#aeaa9f',
  grate: '#8f8c84',
  groundShade: 'rgba(92, 90, 84, 0.34)',
  lineWhite: '#e2ded1',
  lineYellow: '#d3c288',

  fencePost: '#9aa0a7',
  fencePostDark: '#70767d',
  fenceMesh: 'rgba(116, 124, 133, 0.62)',
  fenceRail: 'rgba(84, 92, 100, 0.88)',

  lamp: '#b7bcc2',
  lampDark: '#7e848c',
  lampHead: '#d8dce0',
  sign: '#d8b43c',
};

// Escalones de la sombra que el edificio proyecta sobre la pista. Se apaga
// hacia camara; el test del suelo exige que sea monotona y que no termine en
// canto, porque una sombra que no se apaga es un escalon pintado de gris.
const SHADOW_STEPS = [
  'rgba(78, 76, 70, 0.34)',
  'rgba(78, 76, 70, 0.27)',
  'rgba(78, 76, 70, 0.21)',
  'rgba(78, 76, 70, 0.15)',
  'rgba(78, 76, 70, 0.10)',
  'rgba(78, 76, 70, 0.06)',
  'rgba(78, 76, 70, 0.03)',
];

// Fondos pastel de los paneles del mural, alternados como en el muro real.
const MURAL_TINTS = ['#e0c49e', '#b7d4dc', '#ddb9c4', '#c7d8ae', '#d3c8e2', '#ecd9a4'];

// --- El mural --------------------------------------------------------------
//
// OCHO siluetas de 24x36 sobre una rejilla de 12x18 celdas de 2px, en UNA
// franja compacta con los paneles pegados, como en el muro real.
//
// La altura CRECE CON EL EDIFICIO, y esa es toda la regla: el mural es una
// pieza de la fachada, asi que si la nave sube un 38% y el mural no, la
// escala interna del edificio deja de cuadrar y las siluetas vuelven a
// parecer pictogramas en una pared enorme. Con el zocalo debajo, la franja
// pintada arranca 59px por encima de donde pisan los luchadores — o sea que
// a Samuel (108px) le llega por la CADERA, que es donde llega un mural
// pintado sobre el zocalo de un pabellon de verdad.
//
// El limite por arriba no es el encuadre, es la PUERTA de la planta alta: una
// figura pintada mas alta que una puerta real vuelve a ser el "monstruo" del
// reescalado anterior. Con la puerta en 42px, 36 de figura es la proporcion
// que cuadra (0.86), y por eso el mural crece lo que crece y no mas.
//
// La rejilla es 12x18 porque LA RESOLUCION DE UNA FIGURA VA CON SU TAMANO, en
// los dos sentidos: a 13 filas estiradas hasta 36px cada celda se convierte en
// una banda gruesa y la postura se pierde; a 18 filas de 2px el ojo vuelve a
// leer el gesto. La rejilla no es una constante del arte, es funcion del
// tamano al que se va a ver.
const MURAL_CELL = 2;
const ATHLETE_COLS = 12;
const ATHLETE_ROWS = 18;
const ATHLETES = [
  // atletismo: sprint
  ['....XXX.....', '...XXXXX....', '...XXXXX....', '....XXX.....',
   '..XXXXXX....', '.XXXXXXXX...', 'XX.XXXXX.XX.', 'X..XXXX...XX',
   '...XXXX.....', '...XXXX.....', '...XXXXX....', '..XXX..XXX..',
   '..XX....XXX.', '.XXX......XX', '.XX.......XX', 'XXX........X',
   'XX.........X', 'XX.........X'],
  // futbol: golpeo
  ['.....XXX....', '....XXXXX...', '....XXXXX...', '.....XXX....',
   '...XXXXXX...', '..XXXXXXXX..', '.XX.XXXX..XX', 'XX..XXXX...X',
   '....XXXX....', '....XXXX....', '...XXXXXX...', '...XXX.XXX..',
   '..XXX...XXX.', '..XX.....XXX', '.XXX......XX', '.XX.......XX',
   'XXX........X', 'XX.........X'],
  // baloncesto: tiro
  ['........XX..', '.......XXXX.', '..XXX..XXXX.', '.XXXXX..XX..',
   '.XXXXX......', '..XXX...XX..', '..XXXXXXX...', '.XXXXXXX....',
   '...XXXX.....', '...XXXX.....', '...XXXXX....', '..XXX..XX...',
   '..XX....XX..', '.XXX.....XX.', '.XX......XX.', 'XXX......XX.',
   'XX.......XXX', 'XX.......XX.'],
  // ciclismo
  ['............', '........XXX.', '.......XXXXX', '......XXXXX.',
   '....XXXXX...', '..XXXXX.....', '.XXXX..XX...', 'XX....XXX...',
   '.....XXXX...', '....XXXXX...', 'XXXXXXXXXXXX', 'XX.XXXX..XX.',
   'X...XX....X.', 'X..XXXX...X.', 'XX.X..X..XX.', '.XXXXXXXXX..',
   '..XXX..XXX..', '...X....X...'],
  // gimnasia: salto en estrella
  ['.....XXX....', '....XXXXX...', '....XXXXX...', '.....XXX....',
   'X...XXXXX..X', 'XX.XXXXXXX.X', '.XXXXXXXXXX.', '..XXXXXXXX..',
   '....XXXX....', '....XXXX....', '...XXXXXX...', '..XXX..XXX..',
   '.XXX....XXX.', '.XX......XX.', 'XXX......XXX', 'XX........XX',
   'X..........X', 'X..........X'],
  // tenis
  ['..........XX', '.........XXX', '....XXX..XX.', '...XXXXX.X..',
   '...XXXXXX...', '....XXXXX...', '..XXXXXX....', '.XX.XXXX....',
   'XX..XXXX....', '....XXXX....', '...XXXXX....', '...XXX.XX...',
   '..XXX...XX..', '..XX....XXX.', '.XXX.....XX.', '.XX......XXX',
   'XXX........X', 'XX.........X'],
  // balonmano: lanzamiento
  ['....XXX...X.', '...XXXXX.XXX', '...XXXXX.XX.', '....XXX.....',
   '..XXXXXXXX..', '.XXXXXXXX...', 'XX.XXXXX....', 'X..XXXX.....',
   '...XXXX.....', '...XXXX.....', '...XXXXX....', '..XXX..XXX..',
   '.XXX....XXX.', '.XX......XX.', 'XXX......XX.', 'XX.......XX.',
   'XX.......XXX', 'XX........XX'],
  // karate: patada alta
  ['...XXX......', '..XXXXX.....', '..XXXXX.....', '...XXX......',
   '.XXXXXX.....', 'XXXXXXXX....', 'X..XXXX.XXXX', '...XXXX.XXX.',
   '...XXXXXXX..', '...XXXX.....', '..XXXXX.....', '..XXX.XX....',
   '..XX...XX...', '.XXX....XX..', '.XX.....XX..', 'XXX.....XX..',
   'XX......XXX.', 'XX......XX..'],
];

// Se exportan para que un test pueda exigir que las diez posturas sean
// DISTINTAS: un mural con la misma silueta repetida no es una tira de
// deportes, es un patron, y una linea copiada y pegada en esta tabla no daria
// ningun error.
export const ATHLETE_POSES = ATHLETES;

// Alto REAL de una figura pintada, no el de la rejilla: algunos patrones
// dejan filas vacias abajo. Se deriva de los propios patrones para que la
// medida que declara el escenario sea la que se ve en pantalla — hay un test
// que la compara contra el render.
const ATHLETE_INK_ROWS = (() => {
  let min = ATHLETE_ROWS;
  let max = -1;
  for (const fig of ATHLETES) {
    for (let r = 0; r < fig.length; r += 1) {
      if (!fig[r].includes('X')) continue;
      if (r < min) min = r;
      if (r > max) max = r;
    }
  }
  return max - min + 1;
})();

const MURAL_PANEL_W = ATHLETE_COLS * MURAL_CELL + 2;
const MURAL_PANEL_H = ATHLETE_ROWS * MURAL_CELL + 4;
// A la derecha de la escalera, dejando pano blanco a los dos lados dentro
// de la nave: 44px entre la pilastra y el mural y 30 hasta la esquina. Un
// mural que llega a la esquina se lee como un friso de la fachada, no como
// un mural pintado sobre ella.
const MURAL_X0 = 212;
const MURAL_Y0 = PLINTH_Y - MURAL_PANEL_H;
const MURAL_X1 = MURAL_X0 + ATHLETES.length * MURAL_PANEL_W;

// --- Geometria de la pista -------------------------------------------------
//
// La pista se ensancha hacia camara siguiendo una potencia, y todo lo que vive
// sobre el suelo (lineas pintadas y vallado lateral) usa esta misma funcion,
// asi que no hay dos geometrias que puedan discrepar. El ensanchamiento es
// SUAVE a proposito: con una perspectiva marcada, la franja de primer plano se
// lee como una plaza vista desde arriba en vez de como el suelo del patio.
const COURT_CX = STAGE_WIDTH / 2;
const COURT_HALF_FAR = 210;
const COURT_HALF_NEAR = 340;

const clamp01 = (v) => (v < 0 ? 0 : (v > 1 ? 1 : v));

/** Profundidad 0 (pie del edificio) .. 1 (fila mas cercana a camara). */
export function depthAt(y) {
  return clamp01((y - HORIZON_Y) / (COURT_NEAR_Y - HORIZON_Y));
}

/** Medio ancho de la pista a esa profundidad. */
export function courtHalfWidth(t) {
  return COURT_HALF_FAR + (COURT_HALF_NEAR - COURT_HALF_FAR) * (t ** 0.8);
}

function fenceHalfWidth(t) {
  return courtHalfWidth(t) + 18 + 30 * t;
}

function fenceHeight(t) {
  return 12 + 58 * (t ** 0.9);
}

// --- Primitivas de forma ---------------------------------------------------

/** Masa redondeada compuesta por filas: la forma basica de nubes y copas. */
function blob(pix, cx, cy, rx, ry, color, rows = 7) {
  for (let i = 0; i < rows; i += 1) {
    const t = (i + 0.5) / rows;
    const dy = (t - 0.5) * 2; // -1 .. 1
    const w = rx * Math.sqrt(Math.max(0, 1 - dy * dy));
    const y = cy - ry + (2 * ry * i) / rows;
    if (w < 1) continue;
    pix.rect(cx - w, y, w * 2, (2 * ry) / rows + 1, color);
  }
}

function cloudBank(pix, rng, cx, cy, w, h) {
  // Nubosidad de dia gris: masas anchas y planas, con el tono claro arriba
  // (donde pega la luz) y el oscuro por debajo. Tres pasadas bastan.
  blob(pix, cx, cy + h * 0.28, w * 0.52, h * 0.5, PAL.cloudDark, 5);
  blob(pix, cx - w * 0.14, cy, w * 0.46, h * 0.5, PAL.cloudMid, 6);
  blob(pix, cx + w * 0.16, cy - h * 0.14, w * 0.34, h * 0.42, PAL.cloudLight, 6);
  for (let i = 0; i < 5; i += 1) {
    const bx = cx + (rng() - 0.5) * w;
    const by = cy - h * 0.3 + rng() * h * 0.4;
    blob(pix, bx, by, w * (0.1 + rng() * 0.12), h * 0.22, rng() > 0.5 ? PAL.cloudLight : PAL.cloudMid, 4);
  }
}

/** Arbol de la arboleda que cierra el patio. */
function tree(pix, rng, cx, baseY, size) {
  const trunkH = size * 0.34;
  pix.rect(cx - 2, baseY - trunkH, 5, trunkH + 4, PAL.trunk);
  blob(pix, cx, baseY - trunkH - size * 0.36, size * 0.64, size * 0.44, PAL.treeDark, 6);
  blob(pix, cx - size * 0.12, baseY - trunkH - size * 0.44, size * 0.56, size * 0.4, PAL.tree, 6);
  blob(pix, cx + size * 0.16, baseY - trunkH - size * 0.56, size * 0.36, size * 0.26, PAL.treeLight, 5);
  for (let i = 0; i < 4; i += 1) {
    pix.dot(cx + (rng() - 0.5) * size, baseY - trunkH - size * (0.25 + rng() * 0.45), PAL.treeDark, 2);
  }
}

// --- CAPA 0: cielo, nubes, grua --------------------------------------------

export function paintFar(ctx, pix, rng, { left, right, top }) {
  // Cielo encapotado. Llega hasta HORIZON_Y aunque el edificio tape su parte
  // baja: es la garantia de que no puede quedar un pixel sin cubrir por mucho
  // que la camara suba o se aleje.
  const sky = ctx.createLinearGradient(0, top, 0, HORIZON_Y);
  sky.addColorStop(0, PAL.skyTop);
  sky.addColorStop(0.45, PAL.skyMid);
  sky.addColorStop(0.8, PAL.skyLow);
  sky.addColorStop(1, PAL.skyHorizon);
  ctx.fillStyle = sky;
  ctx.fillRect(left, top, right - left, HORIZON_Y - top);

  // EL CIELO UTIL ESTA ENTRE y=-100 Y LA LINEA DE TEJADO. Por encima no llega
  // la camara ni en el zoom out de un salto alto, asi que sembrar nubes fuera
  // de esa banda es pintar para nadie: ya paso una vez, con las nubes
  // horneadas por encima del encuadre y un cielo liso en pantalla que no daba
  // ningun error.
  for (let i = 0; i < 12; i += 1) {
    cloudBank(pix, rng, left + rng() * (right - left), -96 + rng() * 150, 70 + rng() * 120, 14 + rng() * 14);
  }
  for (let i = 0; i < 5; i += 1) {
    cloudBank(pix, rng, left + rng() * (right - left), 56 + rng() * 26, 90 + rng() * 90, 9);
  }

  // Grua de obra asomando por encima del cuerpo bajo, como en la foto: el
  // detalle que ata el escenario al sitio real y no a "un patio cualquiera".
  const mastX = 56;
  const jibY = 28;
  pix.rect(mastX - 4, jibY, 8, ANNEX_ROOF_Y - jibY + 4, PAL.craneMetal);
  for (let y = jibY + 8; y < ANNEX_ROOF_Y; y += 10) {
    pix.rect(mastX - 4, y, 8, 2, PAL.craneDark);
    pix.dot(mastX - 1, y + 5, PAL.craneDark, 2);
  }
  pix.rect(mastX - 34, jibY - 2, 34, 4, PAL.craneMetal); // contrapluma
  pix.rect(mastX + 4, jibY - 2, 92, 4, PAL.craneMetal); // pluma
  for (let x = mastX + 8; x < mastX + 92; x += 8) pix.dot(x, jibY + 2, PAL.craneDark, 2);
  pix.rect(mastX - 32, jibY + 2, 12, 5, PAL.craneDark); // contrapeso
  pix.rect(mastX - 7, jibY - 10, 12, 8, PAL.craneWarn); // cabina
  pix.rect(mastX + 60, jibY + 2, 2, 26, PAL.craneDark); // cable
}

// --- CAPA 1: la arboleda del patio -----------------------------------------

export function paintMid(ctx, pix, rng, { left, right }) {
  // La arboleda cierra el patio por detras y se ve A LOS LADOS del edificio,
  // que es lo que impide que el fondo sea un pasillo. Va con la base POR
  // DEBAJO del horizonte porque la pista (capa frontal) se dibuja despues y la
  // recorta: asi el parallax no puede abrir una rendija entre el arbol y el
  // suelo.
  for (let x = left; x < right + 30; x += 22 + Math.floor(rng() * 16)) {
    tree(pix, rng, x, HORIZON_Y + 3, 34 + rng() * 24);
  }
}

// --- CAPA 2: EL EDIFICIO, LAS TORRES DE LUZ Y LA PISTA ---------------------

function drawMural(pix, rng) {
  for (let i = 0; i < ATHLETES.length; i += 1) {
    const px = MURAL_X0 + i * MURAL_PANEL_W;
    pix.rect(px, MURAL_Y0, MURAL_PANEL_W, MURAL_PANEL_H, MURAL_TINTS[i % MURAL_TINTS.length]);
    for (let k = 0; k < 3; k += 1) {
      pix.dot(px + rng() * MURAL_PANEL_W, MURAL_Y0 + rng() * MURAL_PANEL_H, 'rgba(255,255,255,0.25)', 2);
    }
    const fig = ATHLETES[i];
    for (let row = 0; row < ATHLETE_ROWS; row += 1) {
      for (let col = 0; col < ATHLETE_COLS; col += 1) {
        if (fig[row][col] !== 'X') continue;
        pix.rect(px + 1 + col * MURAL_CELL, MURAL_Y0 + 2 + row * MURAL_CELL, MURAL_CELL, MURAL_CELL, '#15161a');
      }
    }
  }
  // Marco corrido: es lo que hace que los diez paneles se lean como UNA tira y
  // no como diez cuadros sueltos.
  pix.rect(MURAL_X0 - 2, MURAL_Y0 - 2, MURAL_X1 - MURAL_X0 + 4, 2, PAL.wallDeep);
  pix.rect(MURAL_X0 - 2, MURAL_Y0 + MURAL_PANEL_H, MURAL_X1 - MURAL_X0 + 4, 2, PAL.wallDeep);
}

/**
 * Ventanal de la nave: paneles rectangulares amplios de cristal amarillento
 * con el parteluz INCLINADO, que es el rasgo que los identifica en la foto.
 * Nada de tiras estrechas repetidas cada 9px — ese patron periodico era medio
 * efecto "pasillo".
 */
function drawClerestory(pix, x0, x1) {
  const panelW = 64;
  pix.rect(x0, WINDOW_Y, x1 - x0, WINDOW_H, PAL.blue);
  for (let x = x0 + 3; x + panelW < x1; x += panelW + 5) {
    pix.rect(x, WINDOW_Y + 3, panelW, WINDOW_H - 6, PAL.glass);
    // Parteluz inclinado: una escalerilla de bloques de 2px cruzando el panel.
    const steps = Math.floor((WINDOW_H - 6) / 2);
    for (let s = 0; s < steps; s += 1) {
      pix.rect(x + panelW - 10 - s * 2, WINDOW_Y + 3 + s * 2, 3, 2, PAL.blueLight);
    }
    pix.rect(x, WINDOW_Y + WINDOW_H - 8, panelW, 3, PAL.glassDark); // sombra del alfeizar
  }
}

/**
 * Torre-escalera: pilastra azul de toda la altura con la puerta de la planta
 * alta, el tramo que sube hasta ella y su peto. Es el hito que identifica el
 * pabellon de un vistazo, y en la foto esta a la izquierda del mural.
 */
function drawStairTower(pix) {
  // Pilastra, de tejado a suelo.
  pix.rect(STAIR_X, HALL_ROOF_Y - 4, STAIR_W, HORIZON_Y - HALL_ROOF_Y + 4, PAL.blue);
  pix.rect(STAIR_X, HALL_ROOF_Y - 4, 6, HORIZON_Y - HALL_ROOF_Y + 4, PAL.blueLight);
  pix.rect(STAIR_X + STAIR_W - 5, HALL_ROOF_Y - 4, 5, HORIZON_Y - HALL_ROOF_Y + 4, PAL.blueDark);

  // Puerta de la planta alta.
  pix.rect(STAIR_X + 4, STAIR_DOOR_Y, STAIR_W - 9, STAIR_DOOR_H, PAL.blueDark);
  pix.rect(STAIR_X + 6, STAIR_DOOR_Y + 2, STAIR_W - 13, STAIR_DOOR_H - 2, '#26476f');
  pix.rect(STAIR_X + 4, STAIR_DOOR_Y - 3, STAIR_W - 9, 3, PAL.blueLight); // dintel

  // Tramo de escalera subiendo hacia la puerta, con su peto macizo.
  const bottomY = HORIZON_Y - 2;
  const topY = STAIR_DOOR_Y + STAIR_DOOR_H;
  const steps = 10;
  for (let i = 0; i < steps; i += 1) {
    const f = i / steps;
    const sx = STAIR_FOOT_X + (STAIR_X - STAIR_FOOT_X) * f;
    const sy = bottomY + (topY - bottomY) * f;
    pix.rect(sx, sy, 5, bottomY - sy + 2, PAL.wallShade); // alzada
    pix.rect(sx, sy, 5, 2, PAL.wall); // huella
  }
  // Peto azul paralelo al tramo.
  for (let i = 0; i <= steps * 3; i += 1) {
    const f = i / (steps * 3);
    const sx = STAIR_FOOT_X + (STAIR_X - STAIR_FOOT_X) * f;
    const sy = bottomY + (topY - bottomY) * f;
    pix.rect(sx - 4, sy - 12, 4, 13, PAL.blue);
    pix.rect(sx - 4, sy - 12, 4, 3, PAL.blueLight);
  }
  pix.rect(STAIR_FOOT_X - 6, HORIZON_Y - 12, 8, 12, PAL.blue); // arranque
}

function drawAnnex(pix, rng) {
  const w = ANNEX_RIGHT - ANNEX_LEFT;
  pix.rect(ANNEX_LEFT, ANNEX_ROOF_Y, w, HORIZON_Y - ANNEX_ROOF_Y, PAL.wall);
  pix.rect(ANNEX_LEFT, ANNEX_ROOF_Y, w, 4, PAL.wallDeep); // pretil
  pix.rect(ANNEX_LEFT, ANNEX_ROOF_Y - 3, w, 3, PAL.wallShade);
  // LA ESQUINA IZQUIERDA, que es justo lo que convierte el fondo en un
  // edificio en vez de en una pared: un canto vertical limpio contra el patio.
  pix.rect(ANNEX_LEFT, ANNEX_ROOF_Y, 3, HORIZON_Y - ANNEX_ROOF_Y, PAL.wallShade);
  pix.rect(ANNEX_LEFT - 2, ANNEX_ROOF_Y, 2, HORIZON_Y - ANNEX_ROOF_Y, PAL.wallDeep);

  pix.rect(ANNEX_LEFT, PLINTH_Y, w, PLINTH_H, PAL.blue);
  pix.rect(ANNEX_LEFT, PLINTH_Y - 2, w, 2, PAL.blueDark);

  // Puerta de servicio y rejilla de ventilacion.
  pix.rect(ANNEX_LEFT + 10, PLINTH_Y - 34, 22, 34, '#3d4a58');
  pix.rect(ANNEX_LEFT + 10, PLINTH_Y - 37, 22, 3, PAL.wallDeep);
  for (let i = 0; i < 6; i += 1) {
    pix.rect(ANNEX_LEFT + 50, PLINTH_Y - 30 + i * 5, 24, 2, PAL.wallDeep);
  }
  // Manchas de humedad en el pano: una pared blanca lisa de 84px sin nada se
  // lee como un hueco recortado.
  for (let i = 0; i < 26; i += 1) {
    pix.dot(ANNEX_LEFT + rng() * w, PLINTH_Y - 14 + rng() * 14, PAL.wallGrime, 2);
  }
}

function drawHall(pix, rng) {
  const w = HALL_RIGHT - HALL_LEFT;

  pix.rect(HALL_LEFT, HALL_ROOF_Y, w, HORIZON_Y - HALL_ROOF_Y, PAL.wall);

  // Franja azul cobalto del tejado, con el nervio de la chapa apenas
  // insinuado: con nervios anchos y juntos la franja se convierte en una
  // persiana rayada que se come el resto del edificio.
  pix.rect(HALL_LEFT, HALL_ROOF_Y, w, BLUE_H, PAL.blue);
  for (let x = HALL_LEFT; x < HALL_RIGHT; x += 12) pix.rect(x, HALL_ROOF_Y, 2, BLUE_H, PAL.blueLight);
  pix.rect(HALL_LEFT, HALL_ROOF_Y - 4, w, 4, PAL.blueDark); // remate del alero
  pix.rect(HALL_LEFT, WINDOW_Y - 2, w, 2, PAL.blueDark);

  drawClerestory(pix, HALL_LEFT, HALL_RIGHT);

  // Vierteaguas y regueros de lluvia: la marca que ensucia una fachada blanca
  // sin mancharla, y lo que impide que 90px de blanco sean un vacio.
  pix.rect(HALL_LEFT, WHITE_Y, w, 3, PAL.wallDeep);
  for (let i = 0; i < 26; i += 1) {
    pix.rect(HALL_LEFT + rng() * w, WHITE_Y + 3, 2, 5 + rng() * 16, PAL.wallShade);
  }
  for (let i = 0; i < 40; i += 1) {
    pix.dot(HALL_LEFT + rng() * w, PLINTH_Y - 16 + rng() * 16, PAL.wallGrime, 2);
  }

  // Zocalo azul corrido a ras de suelo.
  pix.rect(HALL_LEFT, PLINTH_Y, w, PLINTH_H, PAL.blue);
  pix.rect(HALL_LEFT, PLINTH_Y - 2, w, 2, PAL.blueDark);
  pix.rect(HALL_LEFT, HORIZON_Y - 3, w, 3, PAL.blueDark);

  // ESQUINA DERECHA: el edificio se acaba, y detras sigue el patio.
  pix.rect(HALL_RIGHT - 3, HALL_ROOF_Y, 3, HORIZON_Y - HALL_ROOF_Y, PAL.wallShade);
  pix.rect(HALL_RIGHT, HALL_ROOF_Y - 4, 2, HORIZON_Y - HALL_ROOF_Y + 4, PAL.wallDeep);

  drawStairTower(pix);
  drawMural(pix, rng);

  // Bajante y cartel de aviso, los dos entre la escalera y el mural, que es
  // donde el pano blanco queda mas desnudo.
  pix.rect(180, WINDOW_Y + WINDOW_H, 4, PLINTH_Y - WINDOW_Y - WINDOW_H, PAL.wallDeep);
  pix.rect(192, PLINTH_Y - 34, 16, 22, PAL.sign);
  pix.rect(195, PLINTH_Y - 30, 10, 3, '#2a2620');
  pix.rect(195, PLINTH_Y - 25, 10, 8, '#2a2620');
}

/**
 * Torre de iluminacion del patio. VA EN LA CAPA FRONTAL porque esta PLANTADA
 * EN LA PISTA, no detras del edificio: si llevara parallax, su pie se
 * deslizaria sobre el suelo igual que hacia la base del muro.
 */
function floodlightMast(pix, x, baseY, topY) {
  pix.rect(x - 3, baseY - 6, 8, 7, PAL.concreteDark); // peana
  pix.rect(x - 2, topY, 5, baseY - topY - 4, PAL.lamp);
  pix.rect(x + 1, topY, 2, baseY - topY - 4, PAL.lampDark);
  pix.rect(x - 9, topY - 3, 19, 3, PAL.lampDark);
  pix.rect(x - 9, topY - 8, 8, 5, PAL.lampHead);
  pix.rect(x + 2, topY - 8, 8, 5, PAL.lampHead);
}

// --- la pista --------------------------------------------------------------

const FLOOR_RAMP = [PAL.concreteLight, PAL.concrete, PAL.concreteAlt];

function drawCourtFloor(pix, rng, { left, right }) {
  // FRANJA PLANA Y DE BAJO CONTRASTE. La pista es el suelo del patio, no una
  // plaza vista desde arriba: con bandas marcadas de perspectiva, los 65px que
  // la camara deja ver por debajo de los pies se leian como una plataforma
  // descolgada por delante del escenario.
  //
  // Las franjas se dibujan DE BORDE A BORDE, con los bordes snapeados antes:
  // `pix.rect` redondea por separado el origen y el tamano, asi que una serie
  // de franjas contiguas de alto variable puede abrir una fila sin pintar
  // entre dos. Ya paso dos veces, y ninguna daba error.
  const edges = [];
  let cursor = HORIZON_Y - 1;
  let rowHeight = 6;
  while (cursor < COURT_NEAR_Y + 6) {
    edges.push(pix.snap(cursor));
    cursor += rowHeight;
    rowHeight *= 1.22;
  }
  edges.push(pix.snap(COURT_NEAR_Y + 8));

  for (let band = 0; band + 1 < edges.length; band += 1) {
    const top = edges[band];
    const h = Math.max(pix.unit, edges[band + 1] - top);
    pix.rect(left, top, right - left, h, FLOOR_RAMP[Math.min(band, FLOOR_RAMP.length - 1)]);
    const grain = Math.floor((right - left) / 18);
    for (let i = 0; i < grain; i += 1) {
      pix.dot(left + rng() * (right - left), top + rng() * h,
        rng() > 0.55 ? PAL.concreteLight : PAL.concreteDark, 2);
    }
  }

  // SOMBRA PROYECTADA DEL EDIFICIO. Es la pieza que suelda la fachada al
  // suelo: sin ella los dos planos se tocan pero no se pertenecen. Va
  // degradada, porque con todos los escalones a la misma opacidad sale una
  // franja oscura de canto duro, o sea la lectura de bordillo que costo quitar.
  for (let i = 0; i < SHADOW_STEPS.length; i += 1) {
    pix.rect(left, HORIZON_Y + i * 2, right - left, 2, SHADOW_STEPS[i]);
  }

  for (let i = 0; i < 6; i += 1) {
    let cx = left + rng() * (right - left);
    let cy = HORIZON_Y + 20 + rng() * 44;
    const steps = 6 + Math.floor(rng() * 8);
    for (let s = 0; s < steps; s += 1) {
      pix.dot(cx, cy, PAL.concreteDark, 2);
      cx += (rng() - 0.5) * 8;
      cy += 2 + rng() * 3;
    }
  }
}

/** Linea pintada horizontal con desgaste: se salta pixeles a tramos. */
function paintedRow(pix, rng, y, halfSpan, color, wear = 0.12) {
  for (let x = COURT_CX - halfSpan; x < COURT_CX + halfSpan; x += 2) {
    if (rng() < wear) continue;
    pix.rect(x, y, 2, 2, color);
  }
}

function drawCourtLines(pix, rng) {
  const backY = HORIZON_Y + 16;
  paintedRow(pix, rng, backY, courtHalfWidth(depthAt(backY)) * 0.9, PAL.lineWhite);

  for (let y = backY; y < COURT_NEAR_Y; y += 2) {
    const half = courtHalfWidth(depthAt(y)) * 0.9;
    if (rng() < 0.1) continue;
    pix.rect(COURT_CX - half, y, 3, 2, PAL.lineWhite);
    pix.rect(COURT_CX + half - 3, y, 3, 2, PAL.lineWhite);
  }

  const keyEnd = HORIZON_Y + 44;
  for (let y = backY; y < keyEnd; y += 2) {
    const f = (y - backY) / (keyEnd - backY);
    const half = 58 + 26 * f;
    if (rng() < 0.12) continue;
    pix.rect(COURT_CX - half, y, 2, 2, PAL.lineWhite);
    pix.rect(COURT_CX + half, y, 2, 2, PAL.lineWhite);
  }
  paintedRow(pix, rng, keyEnd, 84, PAL.lineWhite, 0.15);

  const midY = HORIZON_Y + 62;
  paintedRow(pix, rng, midY, courtHalfWidth(depthAt(midY)) * 0.9, PAL.lineYellow, 0.18);
  for (let a = 0; a < Math.PI * 2; a += 0.05) {
    if (rng() < 0.16) continue;
    pix.rect(COURT_CX + Math.cos(a) * 62, midY + Math.sin(a) * 13, 2, 2, PAL.lineYellow);
  }
}

function drawDrain(pix) {
  pix.rect(96, 238, 38, 14, PAL.concreteDark);
  pix.rect(100, 240, 30, 10, PAL.grate);
  for (let i = 0; i < 5; i += 1) pix.rect(104 + i * 6, 242, 2, 6, '#4e4b46');
}

/**
 * Tramo de vallado LATERAL en perspectiva. `side` -1 izquierda, +1 derecha.
 * Arranca bajito al pie del edificio y crece hacia camara: es el tope visual
 * del escenario, contra el que se lee el wall bounce. No hay ningun tramo
 * horizontal — uno cruzando por detras de los pies convertia el escenario en
 * "la calle de enfrente del instituto".
 */
function drawFenceWing(pix, side) {
  let prev = null;
  for (let step = 0; step <= 32; step += 1) {
    const t = (step / 32) ** 1.5;
    const y = HORIZON_Y + (COURT_NEAR_Y - HORIZON_Y) * t;
    const x = COURT_CX + side * fenceHalfWidth(t);
    const h = fenceHeight(t);
    pix.rect(x, y - h, 2, h, PAL.fenceMesh);
    if (prev) {
      const segs = Math.max(2, Math.round(Math.abs(x - prev.x) / 2));
      for (let s = 0; s <= segs; s += 1) {
        const f = s / segs;
        const ix = prev.x + (x - prev.x) * f;
        const iy = prev.y + (y - prev.y) * f;
        const ih = prev.h + (h - prev.h) * f;
        pix.rect(ix, iy - ih, 2, 2, PAL.fenceRail);
        pix.rect(ix, iy - ih * 0.45, 2, 2, PAL.fenceMesh);
        pix.rect(ix, iy - 2, 2, 2, PAL.groundShade);
      }
    }
    if (step % 4 === 0) {
      pix.rect(x - 1, y - h - 2, 4, h + 2, PAL.fencePost);
      pix.rect(x + 1, y - h - 2, 2, h + 2, PAL.fencePostDark);
    }
    prev = { x, y, h };
  }
}

export function paintFront(ctx, pix, rng, bounds) {
  // EL ORDEN IMPORTA: edificio, pista, y encima lo que se apoya en la pista.
  // La sombra proyectada del edificio vive EN el hormigon, asi que la pista
  // tiene que ir despues; y las torres de luz estan plantadas en la pista, asi
  // que van despues de ella.
  drawAnnex(pix, rng);
  drawHall(pix, rng);
  drawCourtFloor(pix, rng, bounds);
  drawCourtLines(pix, rng);
  drawDrain(pix);
  floodlightMast(pix, 476, HORIZON_Y + 2, 24);
  floodlightMast(pix, -64, HORIZON_Y + 4, 38);
  drawFenceWing(pix, -1);
  drawFenceWing(pix, 1);
}

/**
 * Medidas declaradas del escenario. Existen para que los tests puedan
 * comprobar la GEOMETRIA y las PROPORCIONES contra la intencion —y no contra
 * un numero copiado del render— y para dejar por escrito contra que se
 * dimensiono cada pieza.
 */
export const LAYOUT = {
  buildingLeft: ANNEX_LEFT,
  buildingRight: HALL_RIGHT,
  annexLeft: ANNEX_LEFT,
  annexRight: ANNEX_RIGHT,
  annexRoofY: ANNEX_ROOF_Y,
  hallLeft: HALL_LEFT,
  hallRight: HALL_RIGHT,
  hallRoofY: HALL_ROOF_Y,
  wallBaseY: HORIZON_Y,
  groundY: GROUND_Y,
  courtNearY: COURT_NEAR_Y,
  bodyHeight: BODY_HEIGHT,
  blueBandH: BLUE_H,
  windowBandH: WINDOW_H,
  whiteBandH: WHITE_H,
  plinthH: PLINTH_H,
  windowBandY: WINDOW_Y,
  whiteBandY: WHITE_Y,
  plinthY: PLINTH_Y,
  muralX0: MURAL_X0,
  muralX1: MURAL_X1,
  muralY: MURAL_Y0,
  muralH: MURAL_PANEL_H,
  muralFigureHeight: ATHLETE_INK_ROWS * MURAL_CELL,
  muralFigureCount: ATHLETES.length,
  stairX: STAIR_X,
  stairDoorH: STAIR_DOOR_H,
  hallHeight: HORIZON_Y - HALL_ROOF_Y,
};

/**
 * Descriptor del escenario. `engine/stage.js` no sabe nada del patio: recibe
 * esto y hornea. Un escenario nuevo es otro archivo con la misma forma.
 */
export const highSchoolCourtyard = {
  id: 'high-school-courtyard',
  name: 'EL PATIO DEL INSTITUTO',
  horizonY: HORIZON_Y,
  safetyColor: PAL.skyMid,
  // VELO DE SEPARACION DE PLANOS, declarado por el ESCENARIO y no fijo en
  // main.js. El callejon nocturno lo llevaba a 0.28 y ahi tenia sentido:
  // atenuar alejaba el fondo OSCURO del delineado CLARO de los cuerpos. En un
  // patio de dia pasa justo lo contrario. El numero sale de medir el render en
  // la banda donde pelean los luchadores, y el test de legibilidad vigila las
  // dos mitades del compromiso: distancia al rimlight por arriba y margen para
  // la luz aditiva (`lighter`) por abajo.
  separationDim: 0.14,
  // Semillas fijas por capa: el fondo tiene que salir IDENTICO en todas las
  // maquinas y en cada recarga, o el host y el cliente verian patios distintos.
  seeds: { far: 0x5f3759df, mid: 0x9e3779b9, front: 0x2545f491 },
  paintFar,
  paintMid,
  paintFront,
  layout: LAYOUT,
  palette: PAL,
};
