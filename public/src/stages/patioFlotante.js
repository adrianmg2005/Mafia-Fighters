// "PATIO FLOTANTE" — el escenario del platform fighter.
//
// Un trozo del patio del instituto arrancado de cuajo y flotando en el aire:
// la losa de hormigón con sus líneas de pista, el zócalo azul del
// polideportivo por el canto y, debajo, el bloque de tierra y roca con las
// raíces y las varillas de ferralla colgando. Encima, dos tablones de grada
// como plataformas semisólidas. Detrás, a lo lejos, el patio de verdad (ver
// engine/backdrop.js): es lo que dice que esto FLOTA sobre algo que existe.
//
// Igual que un personaje, este archivo es SOLO DATOS Y ARTE: geometría de
// colisión y una función de pintado. El motor (engine/stage.js) hornea, cachea
// y sirve la geometría a la física; aquí no hay ni una línea de motor.
//
// ============================================================================
// GEOMETRÍA (sección 1.A del diseño, literal)
// ============================================================================
// Losa principal x 340..940 a y 520, bordes agarrables en sus dos esquinas,
// semisólidas 400..580 y 700..880 a y 410, blast zones y reaparición en
// (640, 280). Todo en coordenadas de mundo del canvas de 1280x720.
//
// La parte de abajo NO es un rectángulo: es un bloque de roca que se estrecha
// en tres escalones. La colisión sigue esos escalones (`solids`) y el arte se
// pinta sobre ellos, así que no hay paredes invisibles: si algo choca, es
// porque se ve roca ahí.

export const GEOMETRY = {
  solids: [
    // La losa: tapa pisable, canto y esquinas de agarre.
    {
      id: 'main', left: 340, right: 940, top: 520, bottom: 560,
    },
    // El bloque de tierra bajo la losa, en escalones hacia dentro. Empieza 32
    // px por dentro de cada borde: el hueco bajo la esquina es el que deja
    // colgar a un luchador del borde sin que la roca le empuje.
    {
      id: 'rock1', left: 372, right: 908, top: 560, bottom: 600,
    },
    {
      id: 'rock2', left: 430, right: 850, top: 600, bottom: 640,
    },
    {
      id: 'rock3', left: 520, right: 760, top: 640, bottom: 684,
    },
  ],
  platforms: [
    {
      id: 'left', left: 400, right: 580, y: 410,
    },
    {
      id: 'right', left: 700, right: 880, y: 410,
    },
  ],
  ledges: [
    {
      id: 'ledgeL', x: 340, y: 520, side: -1, surface: 'main',
    },
    {
      id: 'ledgeR', x: 940, y: 520, side: 1, surface: 'main',
    },
  ],
  blastZones: {
    top: -180, bottom: 780, left: -120, right: 1400,
  },
  respawn: { x: 640, y: 280, halfWidth: 46 },
  spawns: {
    p1: {
      x: 490, y: 520, facing: 1, surfaceId: 'main',
    },
    p2: {
      x: 790, y: 520, facing: -1, surfaceId: 'main',
    },
  },
};

// Zona horneada del escenario (en mundo). Cubre la losa, las plataformas y lo
// que cuelga por debajo.
export const BAKE_BOUNDS = {
  left: 320, top: 396, right: 960, bottom: 736,
};

// Paleta. Nada llega al blanco puro (la luz aditiva necesita margen, ver
// lightingManager.js) y el canto azul es el MISMO cobalto que el zócalo del
// polideportivo del fondo: es lo que ata la losa al edificio que se ve detrás.
const PAL = {
  topLight: '#e4dfd2',
  top: '#c9c3b5',
  topGrain: '#b3ac9c',
  line: '#d9b43a',
  lineWorn: '#b99a3e',
  face: '#9d978a',
  faceShade: '#857f73',
  faceDark: '#6f6a61',
  joint: '#7a746a',
  crack: '#5b5750',
  blue: '#2f5fa8',
  blueLight: '#4a7cc4',
  blueDark: '#1f4178',
  steel: '#9aa1ab',
  steelLight: '#d4d9e0',
  steelDark: '#5f656e',
  soil: '#6b4a33',
  soilDark: '#4f3524',
  soilLight: '#80593c',
  stone: '#8d8274',
  stoneDark: '#665d52',
  root: '#3f281a',
  rebar: '#8a4a24',
  rust: '#b8612f',
  plankTop: '#c08a4f',
  plank: '#8b5a2b',
  plankGrain: '#6e4420',
  plankDark: '#4f3017',
  bracket: '#7d848e',
  bracketLight: '#b9c0c9',
  bolt: '#3c4046',
};

const SEED = 0x51a7f10a;

function paintRock(pix, rng) {
  const u = pix.unit;
  const tiers = GEOMETRY.solids.filter((s) => s.id !== 'main');
  const tip = { y: 712, x: 640 };
  // Fila a fila: el ancho sigue al escalón de colisión que toca, con un
  // borde irregular de ±6 px (la roca no es un bloque de Lego). Por debajo
  // del último escalón se cierra en punta.
  for (let y = 560; y < tip.y; y += u) {
    let left;
    let right;
    const tier = tiers.find((t) => y >= t.top && y < t.bottom);
    if (tier) {
      left = tier.left;
      right = tier.right;
    } else {
      const last = tiers[tiers.length - 1];
      const t = (y - last.bottom) / (tip.y - last.bottom);
      left = last.left + (tip.x - 14 - last.left) * t;
      right = last.right - (last.right - (tip.x + 14)) * t;
    }
    const jitterL = Math.floor(rng() * 4) * u;
    const jitterR = Math.floor(rng() * 4) * u;
    left += jitterL - 2;
    right -= jitterR - 2;
    // Estratos: bandas horizontales de tono que bajan con la profundidad.
    const depth = (y - 560) / (tip.y - 560);
    const band = Math.floor((y - 560) / 14) % 3;
    const base = band === 1 ? PAL.soilDark : (depth < 0.2 ? PAL.soilLight : PAL.soil);
    pix.rect(left, y, right - left, u, base);
    // Sombra hacia abajo y a los lados: el bloque tiene volumen.
    pix.rect(left, y, u * 2, u, PAL.soilDark);
    pix.rect(right - u * 2, y, u * 2, u, PAL.root);
  }
  // Piedras incrustadas.
  for (let i = 0; i < 26; i += 1) {
    const y = 566 + rng() * 110;
    const tier = tiers.find((t) => y >= t.top && y < t.bottom) || tiers[tiers.length - 1];
    const x = tier.left + 12 + rng() * (tier.right - tier.left - 24);
    const w = (2 + Math.floor(rng() * 4)) * u;
    const h = (1 + Math.floor(rng() * 2)) * u;
    pix.rect(x, y, w, h, PAL.stone);
    pix.rect(x, y + h, w, u, PAL.stoneDark);
  }
  // Raíces colgando del fondo del bloque.
  for (let i = 0; i < 14; i += 1) {
    const x = 470 + rng() * 340;
    const tier = tiers.find((t) => x >= t.left && x <= t.right && t.id === 'rock3')
      || tiers.find((t) => x >= t.left && x <= t.right && t.id === 'rock2')
      || tiers[0];
    let y = tier.bottom - u;
    let cx = x;
    const len = 6 + Math.floor(rng() * 14);
    for (let k = 0; k < len; k += 1) {
      pix.dot(cx, y, PAL.root);
      y += u;
      if (rng() < 0.3) cx += rng() < 0.5 ? -u : u;
    }
  }
  // Varillas de ferralla oxidadas saliendo en diagonal bajo las esquinas.
  const rebars = [
    { x: 380, y: 566, dx: -1, len: 16 },
    { x: 404, y: 590, dx: -1, len: 12 },
    { x: 900, y: 566, dx: 1, len: 16 },
    { x: 874, y: 594, dx: 1, len: 10 },
  ];
  for (const r of rebars) {
    for (let k = 0; k < r.len; k += 1) {
      pix.dot(r.x + r.dx * k * u, r.y + k * u, k % 4 === 0 ? PAL.rust : PAL.rebar);
    }
  }
}

function paintSlab(pix, rng) {
  const u = pix.unit;
  const { left, right } = GEOMETRY.solids[0];
  const w = right - left;
  // TAPA (520..530): el hormigón de la pista visto casi de canto, con el filo
  // claro arriba que es lo que marca dónde se pisa.
  pix.rect(left, 520, w, u, PAL.topLight);
  pix.rect(left, 522, w, 8, PAL.top);
  for (let i = 0; i < 90; i += 1) {
    pix.dot(left + rng() * w, 522 + Math.floor(rng() * 4) * u, PAL.topGrain);
  }
  // Línea de pista pintada y gastada: tramos con huecos.
  for (let x = left + 22; x < right - 22; x += u) {
    const worn = rng() < 0.16;
    if (!worn) pix.dot(x, 526, rng() < 0.2 ? PAL.lineWorn : PAL.line);
  }
  // CANTO (530..560): hormigón más oscuro, juntas de dilatación y el zócalo
  // azul del polideportivo.
  pix.rect(left, 530, w, 30, PAL.face);
  pix.rect(left, 530, w, u, PAL.faceShade);
  pix.rect(left, 544, w, 10, PAL.blue);
  pix.rect(left, 544, w, u, PAL.blueLight);
  pix.rect(left, 552, w, u, PAL.blueDark);
  pix.rect(left, 556, w, 4, PAL.faceDark);
  for (let x = left + 74; x < right - 20; x += 75) {
    pix.rect(x, 530, u, 30, PAL.joint);
  }
  // Grietas: trazos cortos quebrados en el canto.
  for (let i = 0; i < 9; i += 1) {
    let x = left + 30 + rng() * (w - 60);
    let y = 532;
    const len = 4 + Math.floor(rng() * 6);
    for (let k = 0; k < len; k += 1) {
      if (y >= 544 && y < 554) break; // no se pinta sobre el zócalo
      pix.dot(x, y, PAL.crack);
      y += u;
      x += rng() < 0.5 ? -u : u;
    }
  }
  // Cantoneras de acero en las dos esquinas: es donde se agarra el borde, y
  // tienen que verse como "aquí se agarra".
  for (const cx of [left, right - 14]) {
    pix.rect(cx, 520, 14, 16, PAL.steel);
    pix.rect(cx, 520, 14, u, PAL.steelLight);
    pix.rect(cx, 534, 14, u, PAL.steelDark);
    pix.dot(cx + 4, 526, PAL.bolt);
    pix.dot(cx + 8, 530, PAL.bolt);
  }
}

function paintPlatform(pix, rng, p) {
  const u = pix.unit;
  const w = p.right - p.left;
  // Tablón de grada: 10 px de grosor, que es lo que lo lee como "se puede
  // atravesar" frente a la losa maciza de 40.
  pix.rect(p.left, p.y, w, u, PAL.plankTop);
  pix.rect(p.left, p.y + u, w, 6, PAL.plank);
  pix.rect(p.left, p.y + 8, w, u, PAL.plankDark);
  for (let i = 0; i < 18; i += 1) {
    const x = p.left + 6 + rng() * (w - 16);
    const len = (2 + Math.floor(rng() * 5)) * u;
    pix.rect(x, p.y + u * (1 + Math.floor(rng() * 3)), len, u, PAL.plankGrain);
  }
  // Escuadras metálicas en los extremos, con sus tornillos.
  for (const bx of [p.left, p.right - 10]) {
    pix.rect(bx, p.y, 10, 10, PAL.bracket);
    pix.rect(bx, p.y, 10, u, PAL.bracketLight);
    pix.dot(bx + 4, p.y + 4, PAL.bolt);
  }
  // Dos patas cortas rotas colgando: fue una grada.
  for (const lx of [p.left + 34, p.right - 40]) {
    pix.rect(lx, p.y + 10, 6, 10, PAL.bracket);
    pix.rect(lx, p.y + 10, u, 10, PAL.bracketLight);
    pix.rect(lx, p.y + 20, 6, u, PAL.steelDark);
  }
}

/**
 * Pinta el escenario en coordenadas de MUNDO (el motor ya ha trasladado el
 * contexto al origen de la zona horneada).
 */
function paint(ctx, pix, rng) {
  paintRock(pix, rng);
  paintSlab(pix, rng);
  for (const p of GEOMETRY.platforms) paintPlatform(pix, rng, p);
}

export const patioFlotante = {
  id: 'patio-flotante',
  name: 'PATIO FLOTANTE',
  geometry: GEOMETRY,
  bakeBounds: BAKE_BOUNDS,
  seed: SEED,
  paint,
  // Color con el que se limpia el canvas antes de nada: el gris del cielo del
  // patio, por si algún día se abriera un hueco de cobertura.
  safetyColor: '#9aa4ae',
  // Velo "de distancia" sobre el fondo lejano: lo aclara y lo desatura hacia
  // el cielo (perspectiva aérea) para que la losa, más oscura y saturada, se
  // despegue de él sin necesidad de oscurecerlo.
  backdropHaze: { color: '205, 213, 223', alpha: 0.34 },
};
