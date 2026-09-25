// Partículas pixel art: puramente decorativas, sin efecto en la simulación.
// Vida propia en segundos; se limpian solas al expirar.
//
// Dos decisiones que las hacen leerse como arte de recreativa y no como
// efectos genéricos de canvas:
//  1. Cada partícula se dibuja SNAPEADA a la rejilla de `PARTICLE_UNIT` px,
//     igual que los sprites (ver engine/pixelFighterArt.js). Nada cae a medio
//     píxel al escalar el canvas a pantalla completa.
//  2. Recorren una PALETA de 4 tonos (blanco -> color -> oscuro), que es como
//     se apaga una chispa en pixel art. Las masas (humo, polvo, gas, ondas)
//     además se desvanecen, pero con alfa ESCALONADO en 4 pasos (`stepAlpha`):
//     un fundido alfa continuo delata el render vectorial al instante.
//
// Formas (`shape`), en la rejilla de 2px:
//   square  chispa/gota (por defecto)      burst  estrella de choque rellena
//   star    destello de 4 brazos finos     rays   líneas radiales de impacto
//   spark   viruta alargada en su vuelo    disc   bocanada redonda que crece
//   ring    anillo que se expande          puff/splat  polvo y charco

const PARTICLE_UNIT = 2;

// Familias de impacto. `normal` son las chispas amarillo/naranja de un golpe
// limpio; `guard` el destello azul/blanco al parar; `armor` el dorado de la
// armadura de Rook aguantando; `shadow` los cortes de Vixen.
const PALETTES = {
  normal: ['#ffffff', '#ffe066', '#ff9c3f', '#c8401a'],
  guard: ['#ffffff', '#d8efff', '#63b4ff', '#2554a8'],
  armor: ['#ffffff', '#ffeeb0', '#ffc14b', '#a86a10'],
  heavy: ['#ffffff', '#fff2b0', '#ff7a3d', '#a8250f'],
  shadow: ['#ffffff', '#f3a0ff', '#9b46c9', '#3d1c55'],
  dust: ['#e2dccd', '#b3aa98', '#837a6b', '#544e45'],
  energy: ['#ffffff', '#bfe9ff', '#4aa8ff', '#1d4f9e'],
  // Carga de la Ultimate de Samuel: blanco -> oro -> naranja -> rojo. Es el
  // mismo par oro/rojo que el brillo de contorno de su startup
  // (`superGlow` en pixelFighterArt.js), para que el aura y el cuerpo se lean
  // como UN solo efecto y no como dos que coinciden en el tiempo.
  gold: ['#ffffff', '#ffd24a', '#ff8a2b', '#b4231a'],
  // Chispas de metal contra metal (llave inglesa de Samuel): blanco ->
  // amarillo -> naranja pálido -> gris frío. Acaban en GRIS y no en rojo
  // oscuro como las de un golpe normal, que es lo que hace que se lean como
  // viruta incandescente apagándose y no como fuego.
  metal: ['#ffffff', '#fff3b0', '#ffb347', '#6b6f78'],
  // Gas del escape cómico: el único verde del juego, así que no se confunde
  // con ninguna otra familia de impacto.
  gas: ['#ffffff', '#c8f57e', '#7ed957', '#2f6b23'],
  // Humo de cigarro: grises sin blanco puro. El blanco es del gas; si el humo
  // también lo llevara, los dos efectos de Samuel se confundirían de un
  // vistazo, que es justo lo que no puede pasar cuando uno aturde y el otro
  // estampa contra el suelo.
  smoke: ['#e6e3dc', '#b9b5ad', '#8a867e', '#4a4741'],
  // Aceite usado del bidón: gotas casi NEGRAS con un solo destello claro
  // al principio (el aceite fresco brilla un instante y se apaga). No hay
  // blanco puro ni color intermedio a propósito — es la única familia oscura
  // del juego y por eso se distingue del gas verde y del humo gris incluso
  // con las tres en pantalla.
  oil: ['#7a7a72', '#2d2d2d', '#1a1a1a', '#101010'],
  // Onda sónica de la Ultimate: blanco -> verde lima -> verde -> azul frío.
  // Acaba en AZUL y no en verde oscuro como el gas, que es lo que separa de
  // un vistazo "sonido" de "flatulencia" cuando los dos están en pantalla.
  sonic: ['#ffffff', '#d8ff8f', '#7ed957', '#2f7fb8'],
  // Sangrado cómico de oídos de la víctima.
  blood: ['#ff6b6b', '#d8202a', '#8c1018', '#4a0a0e'],
  // Color PRIMARIO de cada jugador (SLOT_COLORS de renderer.js): la estela de
  // un golpe brutal y la detonación del K.O. dicen de quién ha sido.
  p1: ['#ffffff', '#ffb3a8', '#ff5a4a', '#8c1f16'],
  p2: ['#ffffff', '#b3d6ff', '#4a9dff', '#1d3f8c'],
};

const particles = [];

function paletteColor(kind, t) {
  const palette = PALETTES[kind] || PALETTES.normal;
  // t va de 1 (recién nacida) a 0 (a punto de morir): recorre la paleta de
  // blanco a oscuro en pasos discretos.
  const index = Math.min(palette.length - 1, Math.floor((1 - t) * palette.length));
  return palette[index];
}

function push(p) {
  // `delay` (s): la partícula espera antes de nacer. Es lo que escalona los
  // anillos concéntricos de una onda sin tres llamadas separadas en el tiempo.
  particles.push({
    gravity: 0, drag: 0, shape: 'square', ...p, life: -(p.delay || 0),
  });
}

// Alfa en 4 escalones: fundido de pixel art, no degradado continuo.
function stepAlpha(a) {
  return Math.max(0, Math.min(1, Math.ceil(a * 4) / 4));
}

// Chispas de impacto. `kind` decide la paleta y el temperamento: un golpe
// bloqueado escupe menos chispas y más rectas (rebote seco contra la
// guardia), uno limpio las reparte en abanico.
// SALPICADURA DE ACEITE. Dos cosas a la vez, y las dos hacen falta:
//
//   1. GOTAS que salen despedidas hacia ARRIBA en abanico corto y caen con
//      gravedad alta (900, el doble que una chispa). Una chispa sale en
//      horizontal y se apaga en el aire; un líquido sube poco, cae rápido y
//      llega abajo. Esa diferencia de trayectoria es lo que lo lee como
//      aceite y no como otro fogonazo oscuro.
//   2. MANCHAS en el suelo, que es lo que pidió el diseño: charcos planos
//      que se ABREN a lo ancho mientras se apagan y viven 8 veces más que
//      una chispa. Sin ellas el golpe no deja rastro y el bidón no se
//      distingue de un mazazo cualquiera.
//
// `groundY` es opcional: si no se pasa, las manchas caen a la altura del
// impacto. main.js le pasa el suelo real para que el charco quede en el
// pavimento y no flotando a la altura del pecho.
export function spawnOilSplatter(x, y, groundY = null) {
  const suelo = groundY ?? y + 18;

  for (let i = 0; i < 16; i += 1) {
    // Abanico HACIA ARRIBA (entre -0.2π y -0.8π): el bidón estampa hacia
    // abajo, así que lo que salpica sale despedido en la dirección contraria.
    const angle = -Math.PI * (0.2 + Math.random() * 0.6);
    const speed = 110 + Math.random() * 180;
    push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      maxLife: 0.3 + Math.random() * 0.25,
      size: PARTICLE_UNIT * (Math.random() < 0.45 ? 3 : 2), // gotas GORDAS
      kind: 'oil',
      gravity: 900,
    });
  }

  // Estrella de impacto corta y oscura: el golpe sigue siendo un golpe.
  push({ x, y, vx: 0, vy: 0, maxLife: 0.13, size: 20, kind: 'oil', shape: 'star' });

  // Los charcos. Se reparten alrededor del punto de impacto, no encima: un
  // bidón reventado salpica a los lados.
  for (let i = 0; i < 5; i += 1) {
    const lado = (Math.random() - 0.5) * 66;
    push({
      x: x + lado,
      y: suelo - PARTICLE_UNIT,
      vx: 0, vy: 0, gravity: 0,
      maxLife: 1.4 + Math.random() * 0.7,
      size: PARTICLE_UNIT * (4 + Math.random() * 5),
      kind: 'oil',
      shape: 'splat',
    });
  }
}

export function spawnHitEffect(x, y, kind = 'normal') {
  // El gas no es un impacto: es una nube que se expande despacio y sube. Se
  // desvía aquí y no en main.js para que todas las familias de efecto de
  // golpe sigan viviendo en el mismo sitio.
  if (kind === 'gas') {
    spawnGasCloud(x, y);
    return;
  }
  // El humo de la calada es como el gas pero gris y aún más lento: se queda
  // flotando donde ha caído el golpe.
  if (kind === 'smoke') {
    spawnGasCloud(x, y, 13, 'smoke');
    return;
  }
  // El aceite tampoco es un impacto: es LÍQUIDO. Sale despedido hacia arriba,
  // cae con gravedad alta y MANCHA el suelo donde aterriza.
  if (kind === 'oil') {
    spawnOilSplatter(x, y);
    return;
  }
  const guard = kind === 'guard';
  const metal = kind === 'metal';
  const heavy = kind === 'heavy' || kind === 'armor' || metal;
  // Las cantidades subieron (antes 5/8/12) al recortar el flash de impacto a
  // 2 frames de tinte rojo: el peso visual del golpe tiene que recaer aquí,
  // en el punto EXACTO de la colisión, y no en repintar el cuerpo entero.
  // Ver HIT_FLASH_MS en characters/character.js.
  const count = guard ? 7 : (heavy ? 18 : 13);
  const baseSpeed = guard ? 90 : (heavy ? 165 : 125);

  for (let i = 0; i < count; i += 1) {
    // Abanico alrededor de la horizontal en vez de 360º aleatorios: un
    // impacto real escupe las chispas hacia fuera del punto de contacto.
    const spread = guard ? 0.8 : 2.2;
    const angle = (Math.random() - 0.5) * spread + (Math.random() < 0.5 ? 0 : Math.PI);
    const speed = baseSpeed * (0.5 + Math.random());
    push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - (guard ? 10 : 45),
      maxLife: (guard ? 0.14 : 0.2) + Math.random() * 0.14,
      size: PARTICLE_UNIT * (Math.random() < 0.35 ? 2 : 1),
      kind,
      gravity: guard ? 120 : 420,
    });
  }

  // ESTRELLA DE CHOQUE rellena con núcleo blanco (2 frames en blanco y se
  // apaga por la paleta) y LÍNEAS RADIALES de impacto que salen disparadas en
  // 2-3 frames. Con solo la cruz de líneas de 1px el golpe se leía vacío.
  if (!guard) {
    push({
      x, y, vx: 0, vy: 0, maxLife: heavy ? 0.12 : 0.09, size: heavy ? 22 : 15, kind, shape: 'burst',
      spin: Math.random() * Math.PI,
    });
    const count = heavy ? 12 : 8;
    const offset = Math.random() * Math.PI;
    push({
      x, y, vx: 0, vy: 0, maxLife: 0.055, size: heavy ? 30 : 20, kind, shape: 'rays',
      angles: Array.from({ length: count }, (_, i) => offset + (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.3),
    });
    if (heavy) {
      push({
        x, y, vx: 0, vy: 0, maxLife: 0.2, size: 8, grow: 32, kind, shape: 'ring', squash: 0.8,
      });
    }
  } else {
    // Escudo: anillo azul corto y seco, el golpe rebota.
    push({
      x, y, vx: 0, vy: 0, maxLife: 0.14, size: 6, grow: 16, kind, shape: 'ring', squash: 1,
    });
  }

  // Estrella de impacto: cuatro brazos que crecen y se apagan, encima.
  push({
    x, y, vx: 0, vy: 0,
    maxLife: guard ? 0.1 : 0.17,
    size: guard ? 9 : (heavy ? 24 : 17),
    kind,
    shape: 'star',
  });

  // Viruta incandescente del golpe de llave: unas pocas chispas MUY rápidas
  // que salen casi en horizontal y caen con gravedad alta. Es lo que separa
  // de oído... perdón, de vista, un impacto metálico de uno de carne.
  if (metal) {
    // Virutas ALARGADAS en la dirección del vuelo (shape 'spark'): una chispa
    // de metal se lee como un trazo, no como un punto.
    for (let i = 0; i < 12; i += 1) {
      const angle = (Math.random() - 0.5) * 0.9 + (Math.random() < 0.5 ? 0 : Math.PI);
      const speed = 240 + Math.random() * 220;
      push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 70,
        maxLife: 0.26 + Math.random() * 0.2,
        size: PARTICLE_UNIT,
        kind: 'metal',
        gravity: 760,
        shape: 'spark',
      });
    }
  }

  // Segunda estrella más pequeña y muy corta, desfasada medio frame: es el
  // núcleo blanco del destello. Dos estrellas de tamaños distintos leen como
  // un fogonazo con centro; una sola se lee como una cruz plana.
  if (!guard) {
    push({
      x, y, vx: 0, vy: 0,
      maxLife: 0.08,
      size: heavy ? 13 : 9,
      kind,
      shape: 'star',
    });
  }
}

// Nube de gas cómica (remate aéreo y remate de la Ultimate de Samuel).
// Deliberadamente NO se comporta como un impacto: se expande despacio, sube
// en vez de caer (gravedad negativa), las burbujas son grandes y viven cuatro
// veces más que una chispa. Esa lentitud es el chiste — un golpe es
// instantáneo, una nube se queda ahí flotando.
export function spawnGasCloud(x, y, amount = 16, kind = 'gas') {
  for (let i = 0; i < amount; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 20 + Math.random() * 55;
    push({
      x: x + (Math.random() - 0.5) * 12,
      y: y + (Math.random() - 0.5) * 10,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed * 0.6 - 26, // sube: es un gas
      maxLife: 0.55 + Math.random() * 0.5,
      size: PARTICLE_UNIT * (2 + Math.random() * 2),
      grow: 5 + Math.random() * 5,
      kind,
      gravity: -34,
      drag: 1.5,
      shape: 'disc',
    });
  }
  // Fogonazo verde inicial en el punto exacto del escape.
  push({
    x, y, vx: 0, vy: 0, maxLife: 0.16, size: 20, kind, shape: 'star',
  });
}

// Anillo sónico: partículas repartidas por una circunferencia que se expande
// a la vez. Es lo contrario de una explosión (que sale disparada en todas
// direcciones a velocidades distintas): aquí TODAS van al mismo ritmo, y esa
// uniformidad es lo que lee "onda" en vez de "chispazo".
export function spawnSonicRing(x, y, { amount = 18, speed = 210, kind = 'sonic' } = {}) {
  // ONDAS CONCÉNTRICAS: tres anillos sólidos que nacen escalonados y crecen
  // de diámetro, más grandes cuanto más fuerte el eructo. Son la lectura
  // principal; los puntos de debajo quedan como polvo de la onda.
  const rings = amount >= 20 ? 3 : 2;
  for (let r = 0; r < rings; r += 1) {
    push({
      x, y, vx: 0, vy: 0, delay: r * 0.07, maxLife: 0.32, size: 6, grow: speed * 0.26, kind, shape: 'ring', squash: 0.75,
    });
  }
  for (let i = 0; i < amount; i += 1) {
    const angle = (i / amount) * Math.PI * 2;
    push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed * 0.55, // achatado: es un anillo en el suelo
      maxLife: 0.34,
      size: PARTICLE_UNIT * 2,
      kind,
      drag: 1.1,
    });
  }
  push({
    x, y, vx: 0, vy: 0, maxLife: 0.18, size: 26, kind, shape: 'star',
  });
}

// Notas musicales y barras de distorsión saliendo hacia arriba mientras
// Samuel rapea. Sin gravedad: flotan y se apagan.
export function spawnMusicNotes(x, y, amount = 7) {
  for (let i = 0; i < amount; i += 1) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.5;
    const speed = 60 + Math.random() * 90;
    push({
      x: x + (Math.random() - 0.5) * 16,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      maxLife: 0.5 + Math.random() * 0.35,
      size: PARTICLE_UNIT * (1 + Math.floor(Math.random() * 3)),
      kind: 'armor', // dorado: las notas son del color del acento
      gravity: -20,
      drag: 1.3,
    });
  }
}

// Sangrado de oídos: dos chorros cortos a los lados de la cabeza que caen con
// gravedad alta. Exagerado y plano, que es lo que lo hace cómico.
export function spawnEarBleed(x, y, spread = 16) {
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i += 1) {
      push({
        x: x + side * spread,
        y: y + (Math.random() - 0.5) * 4,
        vx: side * (40 + Math.random() * 70),
        vy: -(20 + Math.random() * 40),
        maxLife: 0.4 + Math.random() * 0.25,
        size: PARTICLE_UNIT * (1 + Math.floor(Math.random() * 2)),
        kind: 'blood',
        gravity: 520,
      });
    }
  }
}

// Nubes de polvo a los pies: al frenar, saltar, aterrizar o salir despedido.
// `dir` es hacia dónde se arrastran (-1/1); 0 las reparte a ambos lados.
export function spawnDust(x, y, dir = 0, amount = 5) {
  for (let i = 0; i < amount; i += 1) {
    const side = dir === 0 ? (i % 2 === 0 ? 1 : -1) : dir;
    push({
      x: x + (Math.random() - 0.5) * 10,
      y: y - Math.random() * 3,
      vx: side * (20 + Math.random() * 45),
      vy: -(10 + Math.random() * 30),
      maxLife: 0.3 + Math.random() * 0.25,
      size: PARTICLE_UNIT * (1.5 + Math.random() * 1.5),
      grow: 3 + Math.random() * 4,
      kind: 'dust',
      gravity: 60,
      drag: 2.2,
      shape: 'disc',
    });
  }
}

// AURA DEL DESPERTAR: motas doradas que nacen alrededor del cuerpo y SUBEN
// despacio, apagándose por la paleta. Con el contorno de luz del sprite, es lo
// que dice "está potenciado" de un vistazo.
export function spawnAuraMotes(x, y, height = 108, amount = 2) {
  for (let i = 0; i < amount; i += 1) {
    push({
      x: x + (Math.random() - 0.5) * 60,
      y: y - Math.random() * height,
      vx: (Math.random() - 0.5) * 14,
      vy: -(40 + Math.random() * 50),
      maxLife: 0.4 + Math.random() * 0.3,
      size: PARTICLE_UNIT * (Math.random() < 0.3 ? 2 : 1),
      kind: 'gold',
      drag: 0.6,
    });
  }
}

// ESCOMBROS: trozos de hormigón que saltan del suelo con un golpe contra la
// losa (el pisotón). Suben poco, caen rápido y se apagan en gris.
export function spawnDebris(x, y, amount = 7) {
  for (let i = 0; i < amount; i += 1) {
    const angle = -Math.PI * (0.15 + Math.random() * 0.7);
    const speed = 110 + Math.random() * 150;
    push({
      x: x + (Math.random() - 0.5) * 14,
      y: y - 2,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      maxLife: 0.35 + Math.random() * 0.25,
      size: PARTICLE_UNIT * (Math.random() < 0.4 ? 2 : 1),
      kind: 'dust',
      gravity: 980,
    });
  }
}

// CHISPAS DE FRICCIÓN del bateo del cigüeñal: una lluvia de virutas que sale
// en el sentido del golpe desde la punta de la llave.
export function spawnSwingSparks(x, y, dir = 1, amount = 9) {
  for (let i = 0; i < amount; i += 1) {
    const angle = (dir > 0 ? 0 : Math.PI) + (Math.random() - 0.5) * 0.8;
    const speed = 200 + Math.random() * 200;
    push({
      x: x + (Math.random() - 0.5) * 20,
      y: y + (Math.random() - 0.5) * 10,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 50,
      maxLife: 0.22 + Math.random() * 0.2,
      size: PARTICLE_UNIT,
      kind: 'metal',
      gravity: 700,
      shape: 'spark',
    });
  }
}

// Destello radial de energía del Super Startup: anillos de píxeles que se
// expanden desde el atacante mientras la pantalla está congelada.
export function spawnSuperAura(x, y, kind = 'energy') {
  const rays = 16;
  for (let i = 0; i < rays; i += 1) {
    const angle = (i / rays) * Math.PI * 2;
    const speed = 150 + Math.random() * 90;
    push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      maxLife: 0.42,
      size: PARTICLE_UNIT * 2,
      kind,
      drag: 1.4,
    });
  }
  // Núcleo: un destello grande que se apaga más despacio que los rayos.
  push({
    x, y, vx: 0, vy: 0, maxLife: 0.35, size: 34, kind, shape: 'star',
  });
}

// ESTELA DE LANZAMIENTO: chispas de choque que se desprenden del cuerpo y se
// quedan casi quietas (salen hacia atrás, contra el vuelo): es lo que dibuja
// el vector en pantalla. `kind` = paleta ('heavy', o la del jugador que golpeó).
export function spawnTrailSparks(x, y, vx, vy, kind = 'heavy', amount = 2) {
  const speed = Math.hypot(vx, vy) || 1;
  for (let i = 0; i < amount; i += 1) {
    const back = 20 + Math.random() * 40;
    const side = (Math.random() - 0.5) * 70;
    push({
      x: x + (Math.random() - 0.5) * 14,
      y: y + (Math.random() - 0.5) * 14,
      vx: (-vx / speed) * back + (-vy / speed) * side,
      vy: (-vy / speed) * back + (vx / speed) * side,
      maxLife: 0.22 + Math.random() * 0.18,
      size: PARTICLE_UNIT * (Math.random() < 0.3 ? 2 : 1),
      kind,
      drag: 2,
    });
  }
}

// DETONACIÓN DE K.O.: un CONO de chispas que sale del punto de cruce hacia
// DENTRO de la pantalla (nx, ny: normal hacia el interior), ±35°. Rápidas y
// con arrastre alto: revientan y se frenan, que es lo que lee "explosión" y
// no "fuente".
export function spawnKoCone(x, y, nx, ny, kind = 'gold', amount = 34) {
  const base = Math.atan2(ny, nx);
  const half = 35 * (Math.PI / 180);
  for (let i = 0; i < amount; i += 1) {
    const angle = base + (Math.random() * 2 - 1) * half;
    const speed = 260 + Math.random() * 520;
    push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      maxLife: 0.45 + Math.random() * 0.35,
      size: PARTICLE_UNIT * (1 + Math.floor(Math.random() * 3)),
      kind: i % 3 === 0 ? 'gold' : kind,
      drag: 2.6,
    });
  }
  push({
    x, y, vx: 0, vy: 0, maxLife: 0.3, size: 40, kind, shape: 'star',
  });
}

export function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const p = particles[i];
    p.life += dt;
    if (p.life < 0) continue; // aún no ha nacido (delay)
    if (p.life >= p.maxLife) {
      particles.splice(i, 1);
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.gravity) p.vy += p.gravity * dt;
    if (p.drag) {
      const k = Math.max(0, 1 - p.drag * dt);
      p.vx *= k;
      p.vy *= k;
    }
  }
}

function snap(v) {
  return Math.round(v / PARTICLE_UNIT) * PARTICLE_UNIT;
}

// Disco relleno en la rejilla, fila a fila.
function fillDisc(ctx, cx, cy, r) {
  const u = PARTICLE_UNIT;
  for (let dy = -r; dy <= r; dy += u) {
    const half = Math.sqrt(Math.max(0, r * r - dy * dy));
    const w = snap(half * 2);
    if (w < u) continue;
    ctx.fillRect(snap(cx - half), snap(cy + dy), w, u);
  }
}

export function drawParticles(ctx) {
  for (const p of particles) {
    if (p.life < 0) continue;
    const t = Math.max(0, 1 - p.life / p.maxLife);
    ctx.fillStyle = paletteColor(p.kind, t);

    if (p.shape === 'disc') {
      // Bocanada: CRECE mientras se desvanece por escalones, con un casquete
      // más claro arriba que le da volumen.
      const r = p.size + (p.grow || 0) * (1 - t);
      ctx.globalAlpha = stepAlpha(Math.min(1, t * 1.6));
      fillDisc(ctx, p.x, p.y, r);
      ctx.fillStyle = paletteColor(p.kind, Math.min(1, t + 0.3));
      fillDisc(ctx, p.x - r * 0.25, p.y - r * 0.3, r * 0.5);
      ctx.globalAlpha = 1;
      continue;
    }

    if (p.shape === 'ring') {
      // Anillo que se expande deprisa al principio y frena (ease-out).
      const u = 1 - t;
      const r = p.size + (p.grow || 0) * (1 - (1 - u) * (1 - u));
      const ry = r * (p.squash ?? 1);
      const thick = PARTICLE_UNIT * (t > 0.5 ? 2 : 1);
      ctx.globalAlpha = stepAlpha(t * 1.3);
      const steps = Math.max(12, Math.ceil((Math.PI * 2 * r) / PARTICLE_UNIT));
      for (let k = 0; k < steps; k += 1) {
        const a = (k / steps) * Math.PI * 2;
        ctx.fillRect(snap(p.x + Math.cos(a) * r), snap(p.y + Math.sin(a) * ry), thick, thick);
      }
      ctx.globalAlpha = 1;
      continue;
    }

    if (p.shape === 'rays') {
      // Líneas de impacto: nacen pegadas al punto y salen disparadas. Duran
      // 2-3 frames; blancas el primero.
      const u = 1 - t;
      const inner = p.size * (0.25 + 0.9 * u);
      const outer = p.size * (0.7 + 1.5 * u);
      ctx.fillStyle = t > 0.6 ? '#ffffff' : paletteColor(p.kind, 0.8);
      for (const a of p.angles) {
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        for (let d = inner; d <= outer; d += PARTICLE_UNIT) {
          ctx.fillRect(snap(p.x + cos * d), snap(p.y + sin * d), PARTICLE_UNIT, PARTICLE_UNIT);
        }
      }
      continue;
    }

    if (p.shape === 'burst') {
      // Estrella de choque RELLENA: núcleo redondo y ocho púas que se
      // estrechan (largas y cortas alternas). Blanca los 2 primeros frames.
      const r = p.size * (0.75 + 0.25 * t);
      ctx.fillStyle = t > 0.7 ? '#ffffff' : paletteColor(p.kind, t);
      fillDisc(ctx, p.x, p.y, r * 0.38);
      for (let k = 0; k < 8; k += 1) {
        const a = (p.spin || 0) + (k / 8) * Math.PI * 2;
        const len = r * (k % 2 === 0 ? 1 : 0.55);
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        for (let d = 0; d <= len; d += PARTICLE_UNIT) {
          const half = (r * 0.2) * (1 - d / len);
          for (let o = -half; o <= half; o += PARTICLE_UNIT) {
            ctx.fillRect(snap(p.x + cos * d - sin * o), snap(p.y + sin * d + cos * o), PARTICLE_UNIT, PARTICLE_UNIT);
          }
        }
      }
      if (t > 0.35) {
        ctx.fillStyle = '#ffffff';
        fillDisc(ctx, p.x, p.y, r * 0.2);
      }
      continue;
    }

    if (p.shape === 'spark') {
      // Viruta: un trazo de 3-4 celdas hacia atrás de su velocidad.
      const sp = Math.hypot(p.vx, p.vy) || 1;
      const len = Math.min(10, sp * 0.02) * (0.5 + t * 0.5);
      for (let d = 0; d <= len; d += PARTICLE_UNIT) {
        ctx.fillRect(snap(p.x - (p.vx / sp) * d), snap(p.y - (p.vy / sp) * d), PARTICLE_UNIT, PARTICLE_UNIT);
      }
      continue;
    }

    if (p.shape === 'star') {
      // Estrella de 4 brazos hecha de celdas: crece y se apaga.
      const reach = snap(p.size * t);
      const thick = PARTICLE_UNIT * (t > 0.5 ? 2 : 1);
      const cx = snap(p.x);
      const cy = snap(p.y);
      ctx.fillRect(cx - reach, cy - thick / 2, reach * 2, thick);
      ctx.fillRect(cx - thick / 2, cy - reach, thick, reach * 2);
      // Diagonales más cortas: el perfil clásico de hitspark de recreativa.
      const diag = snap(reach * 0.55);
      for (let d = PARTICLE_UNIT; d <= diag; d += PARTICLE_UNIT) {
        ctx.fillRect(cx + d, cy + d, PARTICLE_UNIT, PARTICLE_UNIT);
        ctx.fillRect(cx - d, cy + d, PARTICLE_UNIT, PARTICLE_UNIT);
        ctx.fillRect(cx + d, cy - d, PARTICLE_UNIT, PARTICLE_UNIT);
        ctx.fillRect(cx - d, cy - d, PARTICLE_UNIT, PARTICLE_UNIT);
      }
      continue;
    }

    if (p.shape === 'splat') {
      // Charco: se ABRE a lo ancho y se aplana mientras se apaga, que es
      // como se extiende un líquido. Alto fijo de una o dos celdas — un
      // charco visto de lado es una raya, no un cuadrado.
      const ancho = snap(p.size * (1 + (1 - t) * 1.1));
      const alto = PARTICLE_UNIT * (t > 0.35 ? 2 : 1);
      ctx.fillRect(snap(p.x) - ancho / 2, snap(p.y), ancho, alto);
      continue;
    }

    if (p.shape === 'puff') {
      // El polvo CRECE al disiparse, al revés que una chispa.
      const size = snap(p.size * (1 + (1 - t) * 1.5));
      ctx.fillRect(snap(p.x) - size / 2, snap(p.y) - size / 2, size, size);
      continue;
    }

    const size = Math.max(PARTICLE_UNIT, snap(p.size));
    ctx.fillRect(snap(p.x) - size / 2, snap(p.y) - size / 2, size, size);
  }
}

export function clearParticles() {
  particles.length = 0;
}
