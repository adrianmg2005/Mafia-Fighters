// Rasterizado pixel art de los luchadores, en coordenadas LOCALES
// (0,0)-(w,h) con los pies en y=h. Geometría pura: no sabe nada de Character,
// del mundo ni de la cámara — por eso la usa engine/spriteAtlasBuilder.js para
// hornear cada frame del atlas una sola vez.
//
// Qué cambió respecto al prototipo: antes cada parte del cuerpo era un
// `fillRect` con coordenadas en coma flotante, así que el personaje era
// literalmente un montón de cajas grises y, al escalar el canvas, los bordes
// caían entre píxeles. Ahora TODO se dibuja sobre una rejilla de "píxeles de
// arte" (`PIXEL_UNIT` px de pantalla cada uno): cada figura se compone fila a
// fila con entrantes variables (`taper`), que es lo que da bordes escalonados,
// hombreras que sobresalen, cinturas estrechas y botas — silueta de verdad en
// lugar de rectángulos. Al ser múltiplos exactos de la rejilla, el escalado a
// pantalla completa (ver engine/viewport.js) no rompe ni un borde.
//
// Cada personaje tiene su propio "body kit" con proporciones y paleta. Un
// fighter nuevo solo tiene que declarar `art: 'rook' | 'vixen' | 'default'`
// en su config (ver characters/fighterN.js).

// Píxel de arte = 1 px lógico: la rejilla del personaje es de 80x120 REALES,
// no de 40x60 bloques de 2px.
//
// Duplicar la densidad no es solo cambiar este número: las formas de cada kit
// están expresadas en múltiplos de `u`, así que si `u` pasa de 2 a 1 todos
// los detalles se quedan a la mitad de tamaño. Por eso los kits que ya
// existían (Rook, Vixen y el genérico) declaran `const u = pix.unit * 2` y
// siguen dibujando EXACTAMENTE la misma silueta que antes, y usan `px`
// (= pix.unit, 1px de verdad) solo para lo nuevo: contorno, sombreado de dos
// tonos y detalle fino. Samuel está dibujado entero a 1px.
//
// El coste está donde no molesta: el atlas se hornea UNA vez por personaje al
// arrancar (ver spriteAtlasBuilder.js) y a partir de ahí cada frame es un
// `drawImage`. Subir la densidad encarece el horneado, no el bucle de juego.
export const PIXEL_UNIT = 1;

function clampByte(v) {
  return Math.max(0, Math.min(255, v));
}

// Deriva sombra/luz de un color base (evita tener que declarar cada tono a
// mano cuando un personaje solo aporta su color de equipo).
export function shade(hex, amount) {
  const num = parseInt(hex.slice(1), 16);
  const r = clampByte((num >> 16) + amount);
  const g = clampByte(((num >> 8) & 0xff) + amount);
  const b = clampByte((num & 0xff) + amount);
  return `rgb(${r}, ${g}, ${b})`;
}

// --- Rejilla de píxeles ---------------------------------------------------
// Todo el dibujo pasa por aquí, así que es imposible que se cuele un rect a
// medio píxel. `taper` es la pieza clave del estilo: compone una forma fila a
// fila, estrechándola o ensanchándola, que es como se hace una silueta en
// pixel art de verdad.
function makePix(ctx, unit) {
  const snap = (v) => Math.round(v / unit) * unit;
  const snapSize = (v) => Math.max(unit, Math.round(v / unit) * unit);

  const pix = {
    unit,
    // --- Pasada de contorno --------------------------------------------
    // Mientras `outline` esté puesto, TODAS las figuras se dibujan infladas
    // 1px y con ese color. Dibujando el cuerpo dos veces (primero inflado,
    // luego normal) sale un contorno de 1px alrededor de la UNIÓN de todas
    // las piezas, que es lo que de verdad perfila la silueta.
    //
    // Hacerlo así y no pieza a pieza es lo que evita el problema clásico:
    // un contorno por figura dibuja líneas por DENTRO del cuerpo, donde dos
    // piezas se tocan, y el personaje acaba pareciendo un puzle. Aquí el
    // inflado interior lo tapa el propio relleno de la segunda pasada.
    outline: null,
    get grow() {
      return pix.outline ? unit : 0;
    },
    rect(x, y, w, h, color) {
      if (!color && !pix.outline) return;
      const g = pix.grow;
      ctx.fillStyle = pix.outline || color;
      ctx.fillRect(snap(x) - g, snap(y) - g, snapSize(w) + g * 2, snapSize(h) + g * 2);
    },
    // Forma fila a fila: `top`/`bottom` son el entrante lateral (en px) al
    // principio y al final, interpolado linealmente. Con top>bottom sale un
    // trapecio que se ensancha (hombros), al revés una cintura.
    taper(x, y, w, h, color, { top = 0, bottom = 0, curve = 0 } = {}) {
      if (!color && !pix.outline) return;
      const g = pix.grow;
      ctx.fillStyle = pix.outline || color;
      const rows = Math.max(1, Math.round(h / unit));
      for (let i = 0; i < rows; i += 1) {
        const t = rows === 1 ? 0 : i / (rows - 1);
        // `curve` abomba la forma hacia fuera por el centro (torsos, muslos).
        const bulge = curve * Math.sin(t * Math.PI);
        const inset = top + (bottom - top) * t - bulge;
        const rw = w - inset * 2;
        if (rw < unit) continue;
        ctx.fillRect(snap(x + inset) - g, snap(y) + i * unit - g, snapSize(rw) + g * 2, unit + g * 2);
      }
    },
    // Filo de 1px que SIGUE la curva de un `taper`, a diferencia de `edge`,
    // que es una columna recta. Es la pieza que hace posible el sombreado de
    // dos tonos: con una columna recta, la luz de un torso con cintura se
    // sale del cuerpo por arriba y se mete por dentro por abajo. Con esto,
    // cada masa se pinta con su relleno + un filo claro por el lado iluminado
    // y uno oscuro por el contrario, y ambos siguen el contorno real.
    rim(x, y, w, h, color, {
      top = 0, bottom = 0, curve = 0, side = 'right', inset = 0,
    } = {}) {
      if (!color || pix.outline) return;
      ctx.fillStyle = color;
      const rows = Math.max(1, Math.round(h / unit));
      for (let i = 0; i < rows; i += 1) {
        const t = rows === 1 ? 0 : i / (rows - 1);
        const bulge = curve * Math.sin(t * Math.PI);
        const ins = top + (bottom - top) * t - bulge;
        const rw = w - ins * 2;
        if (rw < unit * 2) continue;
        const ex = side === 'left' ? x + ins + inset : x + ins + rw - unit - inset;
        ctx.fillRect(snap(ex), snap(y) + i * unit, unit, unit);
      }
    },
    // Elipse rellena, fila a fila y ajustada a la rejilla. `fromY`/`toY`
    // recortan las filas (y absoluta): sirve para pintar solo la parte de
    // abajo de una masa con otro material (el mono sobre la barriga) sin
    // perder la curva. Como `taper`, respeta la pasada de contorno.
    ellipse(ecx, ecy, rx, ry, color, { fromY = -Infinity, toY = Infinity } = {}) {
      if ((!color && !pix.outline) || rx <= 0 || ry <= 0) return;
      const g = pix.grow;
      ctx.fillStyle = pix.outline || color;
      const y0 = Math.floor((ecy - ry) / unit) * unit;
      for (let y = y0; y < ecy + ry; y += unit) {
        if (y < fromY || y >= toY) continue;
        const dy = (y + unit / 2 - ecy) / ry;
        if (Math.abs(dy) >= 1) continue;
        const half = rx * Math.sqrt(1 - dy * dy);
        const xa = snap(ecx - half);
        const xb = snap(ecx + half);
        if (xb - xa < unit) continue;
        ctx.fillRect(xa - g, y - g, xb - xa + g * 2, unit + g * 2);
      }
    },
    // Miembro: cápsula que recorre los puntos `pts` ([x, y]) con el radio
    // interpolado de `radii` (uno por punto). Se estampa un círculo cada medio
    // píxel, así que las uniones (codo, rodilla) salen redondas y un brazo
    // no puede despegarse del hombro.
    limb(pts, radii, color) {
      if (!color && !pix.outline) return;
      for (let k = 0; k < pts.length - 1; k += 1) {
        const [ax, ay] = pts[k];
        const [bx, by] = pts[k + 1];
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (unit * 0.5)));
        for (let i = 0; i <= steps; i += 1) {
          const t = i / steps;
          const r = radii[k] + (radii[k + 1] - radii[k]) * t;
          pix.ellipse(ax + (bx - ax) * t, ay + (by - ay) * t, r, r, color);
        }
      }
    },
    // Franja de luz/sombra de 1 píxel de arte pegada a un lateral.
    edge(x, y, w, h, color, side = 'left') {
      if (!color) return;
      if (pix.outline) return; // un filo interior no define silueta
      ctx.fillStyle = color;
      const ex = side === 'left' ? x : x + w - unit;
      ctx.fillRect(snap(ex), snap(y), unit, snapSize(h));
    },
  };
  return pix;
}

// --- Reparto vertical del cuerpo ------------------------------------------
//
// BUG CORREGIDO — "los luchadores flotan sobre el suelo y sobre su sombra".
// Cada kit declaraba a mano la altura de cabeza, torso, cadera y piernas, y
// la suma no llegaba a `h`: medido rasterizando la pose, el arte terminaba en
// y≈98 de una caja de 120, así que los cuatro kits flotaban entre 16 y 24px
// por encima del pavimento (y de la elipse de sombra, que sí se dibuja en
// GROUND_Y). De paso, el personaje ocupaba solo el 80% de su propia hurtbox.
//
// La solución no es ajustar los números a ojo kit por kit —eso se vuelve a
// romper a la primera que alguien toque una proporción—, sino DERIVAR la
// altura de las piernas del espacio que queda: los pies caen en `h` por
// construcción, pase lo que pase con el resto. `h` es exactamente el borde
// inferior de la hurtbox (ver hitboxManager.getHurtbox) y el pivote del
// sprite (ver spriteAtlasBuilder), así que alinear ahí alinea las tres cosas
// a la vez: hurtbox, pies y sombra.
export function layoutBody(h, u, {
  headTop, headH, torsoH, hipH,
}) {
  const headY = h * headTop;
  const head = h * headH;
  const torsoY = headY + head - u;
  const torso = h * torsoH;
  const hipY = torsoY + torso - u;
  const hip = h * hipH;
  const legY = hipY + hip - u;
  return {
    headY,
    headH: head,
    torsoY,
    torsoH: torso,
    hipY,
    hipH: hip,
    legY,
    legH: h - legY, // <- el resto: los pies pisan el suelo
  };
}

// --- Paletas ---------------------------------------------------------------
// Cada kit define sus tonos a mano en lugar de derivarlos todos del color de
// equipo: con solo `shade()` los dos personajes salían del mismo material y
// era imposible que Rook leyera "metal oscuro" y Vixen "tela ajustada".
const PALETTES = {
  rook: {
    armor: '#8c3f36',
    armorDark: '#48201c',
    armorLight: '#c2665a',
    metal: '#8b96a6',
    metalDark: '#454c58',
    metalLight: '#ccd5e0',
    skin: '#dca471',
    skinDark: '#9c6b44',
    accent: '#f2c14e',
    outline: '#1a1118',
  },
  vixen: {
    suit: '#2f6fae',
    suitDark: '#173556',
    suitLight: '#5aa5e0',
    cloth: '#d7e6f5',
    skin: '#f0c49a',
    skinDark: '#b8875e',
    hair: '#e8524f',
    hairDark: '#96292b',
    accent: '#ffe27a',
    outline: '#10141f',
  },
  // Samuel: piel morena y tostada, pelo y barba castaño MUY oscuros (a esta
  // escala el castaño medio se confunde con la piel y la barba deja de
  // leerse), ojos claros, mono de trabajo AZUL MARINO y botas de cuero, y
  // herramientas de metal limpio para que la llave destaque.
  mecanico: {
    skin: '#c98a5c',
    skinDark: '#96603a',
    skinShadow: '#6d4225', // segundo tono de sombra: pliegues y contacto
    skinLight: '#e6b487',
    hair: '#3a2213',
    hairDark: '#1f1109',
    hairLight: '#6a4428', // brillo de cada bucle
    beard: '#2e1b0d',
    beardLight: '#48301a', // perfil de la barba contra la mandíbula
    eyeWhite: '#f2e6d8',
    iris: '#7fb347', // ojos verde claro, avellana brillante (los mismos del retrato de la cinemática)
    teeth: '#f4efe6', // la sonrisa
    mouth: '#3a1a12',
    // La camiseta es oscura, pero NO casi negra: con #1f2128 sobre el
    // callejón (que también es oscuro) el torso se convertía en un agujero
    // sin silueta. Este gris azulado mantiene la lectura de "ropa de trabajo
    // sucia" y deja ver los bordes.
    shirt: '#2b313d',
    shirtDark: '#171b23',
    shirtLight: '#454d5e',
    // Mono azul MARINO. Con el tono más oscuro no bajar más: sobre el fondo
    // en penumbra el pantalón trasero se perdería (ver `shirt`).
    denim: '#243558',
    denimDark: '#162038',
    denimLight: '#3b5388',
    denimDeep: '#0e1527', // la pierna de atrás, en sombra
    boot: '#5a3f2a', // cuero de las botas de trabajo
    bootMid: '#46311f',
    bootLight: '#7d5a3d',
    bootDark: '#241910',
    // --- MODO DESPERTAR (prototipo, tecla Ñ): el rapero ---
    // (la camiseta, `tee` y `teeShade`, es la del modo rapero de la Ultimate)
    teeDeep: '#9ea5a3',
    shorts: '#8a8f96', // bermudas grises deportivas
    shortsDark: '#61666d',
    shortsLight: '#b3b8be',
    sneaker: '#f4f4f2', // zapatillas blancas
    sneakerDark: '#b9bcbf',
    sneakerLight: '#ffffff',
    capBlue: '#2f5fc4', // gorra hacia atrás, blanca con paneles azules
    capBlueDark: '#1e3f8a',
    capWhite: '#f4f4f0',
    emblem: '#16161a', // el emblema negro de la camiseta (ola y montaña)
    wire: '#d9c27a', // gafas de montura redonda de alambre
    boxer: '#d8343c', // la cinturilla del calzoncillo, con las bermudas caídas
    // Suela de goma de las botas: su propio material (gris casi negro, no el
    // marrón del cuero). Es lo que dice hacia dónde mira la bota.
    sole: '#262427',
    soleEdge: '#48454a',
    metal: '#9aa4b2',
    metalDark: '#4a515d',
    metalLight: '#e2e9f2',
    grease: '#232830', // guante y manchas de aceite (ver nota de `shirt`)
    greaseDark: '#14171c',
    greaseLight: '#3c434f',
    // Aceite usado del bidón. Más NEGRO y más neutro que `grease`, que tira a
    // azul: el guante y las manchas del mono tienen que quedar por debajo en
    // la escala de grises para que el chorro se distinga del propio cuerpo.
    // Son los mismos tonos que la familia de partículas `oil`.
    oil: '#1a1a1a',
    oilLight: '#2d2d2d',
    accent: '#e8a33d',
    accentLight: '#ffd88a',
    gas: '#7ed957',
    gasDark: '#3f8c2e',
    gasLight: '#c8f57e',
    smoke: '#b9b5ad',
    smokeDark: '#6e6a63',
    smokeLight: '#e6e3dc',
    ember: '#ff6b2b', // brasa del cigarro
    // El cojín donut de la embestida y la silla gamer del D-Smash.
    donutDough: '#e3a560',
    donutDoughDark: '#b0733a',
    donutGlaze: '#ff8fc8',
    donutGlazeLight: '#ffc6e3',
    donutIcing: '#fff4e4',
    donutIcingShade: '#e3d4c0',
    chairBlack: '#1c1c21',
    chairDark: '#0b0b0e',
    chairChrome: '#aeb4bd',
    chairGreen: '#39ff14',
    cigar: '#6b3a1e', // el puro habanero del Despertado
    cigarLight: '#94562d',
    cigarBand: '#c8102e',
    // --- modo rapero de la Ultimate (ver la foto de referencia) ---
    cap: '#f2f0e8', // gorra blanca hacia atrás
    capShade: '#c9c5b8',
    capStrap: '#ff2d8f', // la cinta de ajuste rosa fosforito
    strapLight: '#ff7ac0',
    shades: '#17161c', // gafas de sol de pasta
    shadesGlint: '#8fa6c9',
    gold: '#ffc743', // cadenas gruesas
    goldDark: '#a67617',
    tee: '#e9f2ee', // camiseta clara
    teeShade: '#bcc9c4',
    blood: '#d8202a', // sangrado de oídos de la víctima
    bloodDark: '#8c1018',
    outline: '#14100e',
  },
};

// Kit genérico para cualquier personaje futuro que no traiga arte propio:
// se construye a partir de su color de equipo.
function buildDefaultPalette(color) {
  return {
    armor: color,
    armorDark: shade(color, -60),
    armorLight: shade(color, 40),
    metal: '#8b96a6',
    metalDark: '#454c58',
    metalLight: '#ccd5e0',
    skin: '#e6b183',
    skinDark: '#a9784f',
    accent: '#f2c14e',
    outline: '#15121a',
  };
}

// --- ROOK: el tanque -------------------------------------------------------
// Silueta maciza: hombreras que sobresalen del ancho del torso, peto blindado,
// piernas cortas y gruesas rematadas en botas. La cabeza es pequeña a
// propósito — es lo que hace leer "grande" al resto del cuerpo.
function drawRook(pix, { w, h, pose, palette: p }) {
  // Rook se sigue dibujando en bloques de 2px (misma silueta exacta que
  // antes); la densidad de 1px se usa para el contorno y el sombreado.
  const u = pix.unit * 2;
  const cx = w / 2;

  // El esqueleto se calcula SIN los offsets de la pose y las piernas rellenan
  // lo que queda, así que los pies caen en `h` haga lo que haga la animación.
  // Los offsets se aplican por PIEZA: antes `headOffY` arrastraba también al
  // torso, la cadera y las piernas (el reparto vertical se encadenaba desde
  // la cabeza), así que la respiración del idle levantaba al personaje del
  // suelo y el agachado lo hundía por debajo del pavimento.
  // Reparto pensado para que las piernas se queden en ~40% del alto: al
  // derivarlas del espacio sobrante se llevaban casi la mitad del cuerpo y
  // el tanque salia zancudo.
  const L = layoutBody(h, u, {
    headTop: 0.045, headH: 0.145, torsoH: 0.36, hipH: 0.10,
  });

  const headW = w * 0.26;
  const headH = L.headH;
  const headX = cx - headW / 2 + pose.headOffX;
  const headY = L.headY + pose.headOffY;

  const torsoW = w * 0.40;
  const torsoH = L.torsoH;
  const torsoX = cx - torsoW / 2 + pose.torsoOffX;
  const torsoY = L.torsoY + pose.torsoOffY;

  const hipW = w * 0.34;
  const hipX = cx - hipW / 2 + pose.torsoOffX * 0.6;
  const hipY = L.hipY + pose.torsoOffY;
  const hipH = L.hipH;

  const legW = w * 0.16;
  const legH = L.legH;
  const legY = L.legY;
  const legBackX = cx - legW - u + pose.legBackOffX;
  const legFrontX = cx + u + pose.legFrontOffX;

  const armW = w * 0.155;
  const armH = h * 0.285;
  const armY = torsoY + h * 0.055;
  const armBackX = torsoX - armW + u + pose.armBackOffX;
  const armFrontX = torsoX + torsoW - u + pose.armFrontOffX;

  // --- capa trasera (más oscura: sugiere profundidad sin contorno) ---
  pix.taper(legBackX, legY + pose.legBackOffY, legW, legH, p.armorDark, { top: 0, bottom: -u });
  pix.rect(legBackX - u, legY + pose.legBackOffY + legH - h * 0.06, legW + u * 2, h * 0.06, p.metalDark);
  pix.taper(armBackX, armY + pose.armBackOffY, armW, armH, p.armorDark, { top: 0, bottom: u });

  // --- torso: peto que se ensancha hacia los hombros ---
  pix.taper(torsoX, torsoY, torsoW, torsoH, p.armor, { top: -u * 2, bottom: u * 2, curve: u });
  // Placa pectoral y cinturón, para que el torso no sea una mancha lisa
  pix.rect(torsoX + u, torsoY + torsoH * 0.28, torsoW - u * 2, u * 2, p.armorDark);
  pix.rect(torsoX + u * 2, torsoY + u * 2, torsoW - u * 4, u, p.armorLight);
  pix.edge(torsoX - u, torsoY + u, torsoW + u * 2, torsoH - u * 2, p.armorLight, 'right');
  pix.rect(hipX, hipY, hipW, hipH, p.metalDark);
  pix.rect(hipX + hipW * 0.35, hipY + u, hipW * 0.3, hipH - u * 2, p.accent);

  // --- hombreras: SOBRESALEN del torso, es la firma de la silueta ---
  const pauldronW = w * 0.26;
  const pauldronH = h * 0.11;
  const pauldronY = torsoY - u;
  pix.taper(torsoX - pauldronW + u * 2, pauldronY, pauldronW, pauldronH, p.metal, { top: u * 2, bottom: 0 });
  pix.taper(torsoX + torsoW - u * 2, pauldronY, pauldronW, pauldronH, p.metal, { top: u * 2, bottom: 0 });
  pix.rect(torsoX - pauldronW + u * 2, pauldronY, pauldronW, u, p.metalLight);
  pix.rect(torsoX + torsoW - u * 2, pauldronY, pauldronW, u, p.metalLight);

  // --- pierna y brazo delanteros, por encima del cuerpo ---
  pix.taper(legFrontX, legY + pose.legFrontOffY, legW, legH, p.armor, { top: 0, bottom: -u });
  pix.rect(legFrontX - u, legY + pose.legFrontOffY + legH - h * 0.06, legW + u * 2, h * 0.06, p.metal);
  pix.taper(armFrontX, armY + pose.armFrontOffY, armW, armH, p.armor, { top: 0, bottom: u });
  // Guantelete: el puño se lee separado del brazo
  pix.rect(armFrontX - u, armY + pose.armFrontOffY + armH - h * 0.07, armW + u * 2, h * 0.07, p.metal);

  // --- cabeza con casco ---
  pix.taper(headX, headY, headW, headH, p.skin, { top: u, bottom: u });
  pix.taper(headX - u, headY - u, headW + u * 2, headH * 0.55, p.metal, { top: u * 2, bottom: 0 });
  pix.rect(headX, headY + headH * 0.5, headW, u, p.skinDark);
  pix.rect(headX - u, headY + headH * 0.42, headW + u * 2, u, p.metalDark); // visera
}

// --- VIXEN: la asesina -----------------------------------------------------
// Todo lo contrario: hombros estrechos, cintura marcada, piernas largas y
// postura baja. La coleta y la banda del brazo se mueven con inercia
// (`pose.hairSwing`), que es lo que da sensación de agilidad incluso en un
// frame quieto.
function drawVixen(pix, { w, h, pose, palette: p }) {
  const u = pix.unit * 2; // misma silueta de siempre (ver la nota en drawRook)
  const cx = w / 2;

  // Vixen conserva las piernas mas largas del roster (es su lectura), pero
  // no a costa de quedarse sin torso.
  const L = layoutBody(h, u, {
    headTop: 0.06, headH: 0.135, torsoH: 0.31, hipH: 0.08,
  });

  const headW = w * 0.21;
  const headH = L.headH;
  const headX = cx - headW / 2 + pose.headOffX;
  const headY = L.headY + pose.headOffY;

  const torsoW = w * 0.26;
  const torsoH = L.torsoH;
  const torsoX = cx - torsoW / 2 + pose.torsoOffX;
  const torsoY = L.torsoY + pose.torsoOffY;

  const hipW = w * 0.28;
  const hipX = cx - hipW / 2 + pose.torsoOffX * 0.6;
  const hipY = L.hipY + pose.torsoOffY;
  const hipH = L.hipH;

  const legW = w * 0.115;
  const legH = L.legH;
  const legY = L.legY;
  const legBackX = cx - legW - u + pose.legBackOffX;
  const legFrontX = cx + u + pose.legFrontOffX;

  const armW = w * 0.10;
  const armH = h * 0.30;
  const armY = torsoY + h * 0.035;
  const armBackX = torsoX - armW + u + pose.armBackOffX;
  const armFrontX = torsoX + torsoW - u + pose.armFrontOffX;

  // --- coleta: se dibuja DETRÁS de todo y arrastra con inercia ---
  const swing = pose.hairSwing || 0;
  const tailX = headX - headW * 0.5 - swing * 1.6;
  const tailY = headY + headH * 0.35;
  pix.taper(tailX, tailY, headW * 0.5, headH * 1.9, p.hairDark, { top: 0, bottom: u * 2 });
  pix.taper(tailX - swing * 0.8, tailY + headH * 1.4, headW * 0.42, headH * 1.2, p.hairDark, { top: 0, bottom: u * 2 });

  // --- capa trasera ---
  pix.taper(legBackX, legY + pose.legBackOffY, legW, legH, p.suitDark, { top: 0, bottom: u });
  pix.rect(legBackX - u, legY + pose.legBackOffY + legH - h * 0.05, legW + u * 2, h * 0.05, p.outline);
  pix.taper(armBackX, armY + pose.armBackOffY, armW, armH, p.suitDark, { top: 0, bottom: u });

  // --- torso: hombros estrechos, cintura marcada ---
  pix.taper(torsoX, torsoY, torsoW, torsoH, p.suit, { top: -u, bottom: u * 2, curve: u * 0.5 });
  pix.edge(torsoX, torsoY + u, torsoW, torsoH - u * 2, p.suitLight, 'right');
  pix.rect(torsoX, torsoY + torsoH * 0.22, torsoW, u, p.cloth); // correa cruzada
  pix.rect(hipX, hipY, hipW, hipH, p.suitDark);
  pix.rect(hipX + u, hipY + u, hipW - u * 2, u, p.accent);

  // --- banda/bufanda al viento: la segunda pieza con inercia ---
  const scarfX = torsoX + torsoW * 0.2;
  const scarfY = torsoY + torsoH * 0.18;
  pix.taper(scarfX - swing * 2.2, scarfY, w * 0.16, h * 0.05, p.hair, { top: 0, bottom: u });
  pix.taper(scarfX - swing * 3.4, scarfY + h * 0.035, w * 0.12, h * 0.04, p.hairDark, { top: 0, bottom: u });

  // --- pierna y brazo delanteros ---
  pix.taper(legFrontX, legY + pose.legFrontOffY, legW, legH, p.suit, { top: 0, bottom: u });
  pix.rect(legFrontX - u, legY + pose.legFrontOffY + legH - h * 0.05, legW + u * 2, h * 0.05, p.cloth);
  pix.taper(armFrontX, armY + pose.armFrontOffY, armW, armH, p.suit, { top: 0, bottom: u });
  pix.rect(armFrontX - u, armY + pose.armFrontOffY + armH - h * 0.05, armW + u * 2, h * 0.05, p.cloth);

  // --- cabeza con antifaz ---
  pix.taper(headX, headY, headW, headH, p.skin, { top: u, bottom: u });
  pix.taper(headX - u, headY - u, headW + u * 2, headH * 0.45, p.hair, { top: u, bottom: 0 }); // flequillo
  pix.rect(headX - u, headY + headH * 0.4, headW + u * 2, u, p.outline); // antifaz
}

// Kit genérico: la silueta del prototipo, pero ya sobre la rejilla y con
// entrantes, para que un personaje nuevo sin arte propio no desentone.
function drawDefaultFighter(pix, { w, h, pose, palette: p }) {
  const u = pix.unit * 2; // misma silueta de siempre (ver la nota en drawRook)
  const cx = w / 2;
  const L = layoutBody(h, u, {
    headTop: 0.05, headH: 0.14, torsoH: 0.33, hipH: 0.09,
  });
  const headW = w * 0.24, headH = L.headH;
  const headX = cx - headW / 2 + pose.headOffX;
  const headY = L.headY + pose.headOffY;
  const torsoW = w * 0.34, torsoH = L.torsoH;
  const torsoX = cx - torsoW / 2 + pose.torsoOffX;
  const torsoY = L.torsoY + pose.torsoOffY;
  const legW = w * 0.14, legH = L.legH;
  const legY = L.legY;
  const armW = w * 0.12, armH = h * 0.29;
  const armY = torsoY + h * 0.04;

  pix.taper(cx - legW - u + pose.legBackOffX, legY + pose.legBackOffY, legW, legH, p.armorDark, { bottom: -u });
  pix.taper(torsoX - armW + u + pose.armBackOffX, armY + pose.armBackOffY, armW, armH, p.armorDark, { bottom: u });
  pix.taper(torsoX, torsoY, torsoW, torsoH, p.armor, { top: -u, bottom: u, curve: u });
  pix.edge(torsoX, torsoY + u, torsoW, torsoH - u * 2, p.armorLight, 'right');
  pix.taper(cx + u + pose.legFrontOffX, legY + pose.legFrontOffY, legW, legH, p.armor, { bottom: -u });
  pix.taper(torsoX + torsoW - u + pose.armFrontOffX, armY + pose.armFrontOffY, armW, armH, p.armor, { bottom: u });
  pix.taper(headX, headY, headW, headH, p.skin, { top: u, bottom: u });
  pix.rect(headX, headY + headH * 0.55, headW, u, p.skinDark);
}

// --- Utillaje de Samuel ----------------------------------------------------
// Las herramientas no son sprites aparte: se componen sobre la MISMA rejilla
// que el cuerpo, en el momento, a partir de la mano delantera. `pose.tool`
// (0..1) es su presencia y `pose.toolAngle` hacia dónde apunta, así que la
// llave acompaña al arco del gancho en lugar de aparecer clavada en una
// postura fija.

// Llave inglesa: mango compuesto celda a celda a lo largo del ángulo (igual
// que el arco de ataque) y una cabeza con MUESCA en la punta. La muesca es lo
// que la hace leer como "llave" y no como un bate: sin ese hueco de un píxel,
// a 40x60 es un palo con un bulto.
// Llave grifa: mango compuesto celda a celda a lo largo del ángulo (igual que
// el arco de ataque) y cabeza con MUESCA en la punta. La muesca es lo que la
// hace leer como "llave" y no como un bate: sin ese hueco, a esta escala es
// un palo con un bulto.
//
// A 1px se puede hacer lo que antes no cabía: el mango tiene tres tonos
// (sombra abajo, cuerpo, brillo arriba) y la cabeza un destello en diagonal.
// Ese brillo es lo que la lee como METAL pulido y no como piedra gris.
function drawWrench(pix, x, y, length, angle, p, { flip = 1 } = {}) {
  const px = pix.unit;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const perpX = -dy * flip;
  const perpY = dx * flip;
  const thick = px * 3;
  const steps = Math.max(3, Math.round(length / px));

  // DOS pasadas, y el orden importa: el bloque de cada paso solapa al
  // anterior, así que con relleno y brillo intercalados en el mismo bucle
  // cada bloque borraba el brillo del paso previo y el mango salía plano —
  // solo sobrevivía el último píxel. Primero se pinta todo el mango y
  // después, encima, los cantos.
  for (let i = 0; i < steps; i += 1) {
    const grip = i < steps * 0.28;
    pix.rect(
      x + dx * i * px - perpX * px, y + dy * i * px - perpY * px,
      thick, thick, grip ? p.grease : p.metal,
    );
  }
  for (let i = 0; i < steps; i += 1) {
    const grip = i < steps * 0.28;
    const cxp = x + dx * i * px;
    const cyp = y + dy * i * px;
    pix.rect(cxp + perpX * px, cyp + perpY * px, px, px, grip ? p.greaseLight : p.metalLight);
    pix.rect(cxp - perpX * px * 2, cyp - perpY * px * 2, px, px, grip ? p.greaseDark : p.metalDark);
  }

  // Cabeza: bloque con la boca abierta hacia fuera, claramente más gorda que
  // el mango. Escala con la llave — una cabeza fija sobre un mango del doble
  // de largo se lee como un palo con un nudo.
  const g = Math.max(1, Math.round(length / (px * 13))); // 1 a 26px, ~5 a 64
  const hx = x + dx * steps * px;
  const hy = y + dy * steps * px;
  const hw = px * (3 + g);
  pix.rect(hx - hw, hy - hw, hw * 2 + px, hw * 2 + px, p.metal);
  pix.rect(hx - hw, hy - hw, hw * 2 + px, px, p.metalLight);
  pix.rect(hx - hw, hy + hw, hw * 2 + px, px, p.metalDark);
  // Destello diagonal: dos celdas blancas que cruzan la cabeza.
  pix.rect(hx - px, hy - px * 2, px, px, p.metalLight);
  pix.rect(hx, hy - px, px, px, p.metalLight);
  // La boca: dos dientes con el hueco en medio, en perpendicular al mango.
  const mouthX = hx + dx * hw;
  const mouthY = hy + dy * hw;
  const tw = px * (1 + g);
  pix.rect(mouthX + perpX * hw * 0.7, mouthY + perpY * hw * 0.7, tw, tw, p.metal);
  pix.rect(mouthX - perpX * hw * 0.7, mouthY - perpY * hw * 0.7, tw, tw, p.metal);
  pix.rect(mouthX, mouthY, tw, tw, p.metalDark); // hueco de la boca

  // DESTELLO EN CRUZ en la mordaza. Solo cuando la pose lo pide (el frame de
  // impacto del launcher y del llavezo aéreo): es lo que vende el golpe
  // metálico, y permanente sería un adorno que deja de significar nada.
  if (pix.toolFlash) {
    const f = px * 4;
    pix.rect(mouthX - f, mouthY, f * 2 + px, px, '#ffffff');
    pix.rect(mouthX, mouthY - f, px, f * 2 + px, '#ffffff');
    pix.rect(mouthX - px, mouthY - px, px * 3, px * 3, '#ffffff');
  }
}

// COJÍN DONUT de la embestida: un cojín con forma de donut rosa gigante (el
// de Los Simpson): masa tostada con su sombra, GLASEADO rosa con el borde
// ondulado y su brillo, y encima CREMA blanca espesa: tres goterones gordos
// con volumen (sombra debajo, brillo arriba), churretes largos que caen por
// el borde hasta la masa y acaban en gota, y gotas sueltas. El agujero, en
// sombra, por encima de todo. 60x46, casi el ancho del torso.
function drawDonutCushion(pix, x, y, p) {
  const px = pix.unit;
  const cx = x + px * 30;
  const cy = y + px * 26;
  pix.ellipse(cx, cy, px * 31, px * 23, p.outline);
  pix.ellipse(cx, cy, px * 30, px * 22, p.donutDough);
  pix.ellipse(cx, cy + px * 3, px * 29, px * 18, p.donutDoughDark, { fromY: cy + px * 9 }); // la panza en sombra
  // El glaseado rosa, con el borde ondulado.
  pix.ellipse(cx, cy - px * 2, px * 27, px * 18, p.donutGlaze, { toY: cy + px * 6 });
  for (let k = -24; k <= 22; k += 6) {
    pix.ellipse(cx + px * k, cy + px * 6, px * 3.5, px * (2 + ((k + 24) % 4)), p.donutGlaze);
  }
  pix.ellipse(cx - px * 13, cy - px * 13, px * 8, px * 2.5, p.donutGlazeLight); // brillo
  // CREMA blanca espesa: churretes que caen por el borde (antes que los
  // goterones, que los tapan arriba), cada uno acabado en gota.
  for (const [dx, dy, len] of [[-21, -5, 13], [-13, -1, 19], [-4, 1, 11], [7, -2, 21], [16, -2, 14], [23, -4, 8]]) {
    pix.rect(cx + px * dx, cy + px * dy, px * 4, px * len, p.donutIcing);
    pix.rect(cx + px * (dx + 3), cy + px * dy, px, px * len, p.donutIcingShade);
    pix.ellipse(cx + px * (dx + 2), cy + px * (dy + len), px * 3, px * 2.8, p.donutIcing);
    pix.rect(cx + px * (dx + 1), cy + px * (dy + len - 1), px, px, '#ffffff');
  }
  // Los goterones gordos, con volumen.
  for (const [dx, dy, rx, ry] of [[-13, -9, 10, 5.5], [3, -12, 12, 5.5], [17, -5, 8, 5], [-4, -3, 8, 4.5]]) {
    pix.ellipse(cx + px * dx, cy + px * (dy + 1.5), px * rx, px * ry, p.donutIcingShade);
    pix.ellipse(cx + px * dx, cy + px * dy, px * rx, px * ry, p.donutIcing);
    pix.ellipse(cx + px * (dx - rx * 0.35), cy + px * (dy - ry * 0.4), px * rx * 0.35, px * ry * 0.3, '#ffffff');
  }
  // Gotas sueltas, cayendo.
  for (const [dx, dy] of [[-17, 24], [11, 27], [2, 20]]) {
    pix.ellipse(cx + px * dx, cy + px * dy, px * 2, px * 2.4, p.donutIcing);
    pix.rect(cx + px * (dx - 1), cy + px * (dy - 1), px, px, '#ffffff');
  }
  // El agujero.
  pix.ellipse(cx, cy - px, px * 8, px * 5.5, p.outline);
  pix.ellipse(cx, cy - px, px * 7, px * 4.5, p.donutDoughDark);
}

// SILLA GAMER de carreras: base de estrella con ruedas, pistón cromado,
// asiento acolchado con el vivo verde, reposabrazos, y el RESPALDO de bacquet
// alto con sus alas a la altura de los hombros, los paneles laterales verde
// chillón con su costura, el cojín lumbar, el cabecero y los dos huecos del
// arnés. Se agarra por la base (la mano delantera, en `x, y`) y se orienta con
// `angle`: -PI/2 = en vertical (el respaldo arriba); hacia delante y abajo, el
// respaldo contra el suelo. Sin rotación: cada pieza se pinta celda a celda
// a lo largo del eje de la silla (como la llave), primero su contorno.
export const CHAIR_LENGTH = 72; // de la base a la punta del respaldo
function drawGamerChair(pix, x, y, angle, p) {
  const px = pix.unit;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  // `along` sube por el eje de la silla; `across`, positivo hacia la parte
  // de delante del asiento y negativo hacia el respaldo.
  const box = (a0, a1, c0, c1, color) => {
    for (let a = a0; a < a1; a += 1) {
      for (let c = c0; c < c1; c += 1) {
        pix.rect(x + (dx * a - dy * c) * px, y + (dy * a + dx * c) * px, px, px, color);
      }
    }
  };
  const B = p.chairBlack;
  const D = p.chairDark;
  const G = p.chairGreen;
  const C = p.chairChrome;
  const parts = [
    [-3, 1, -22, 22], // base de estrella
    [1, 16, -3, 3], // columna del pistón
    [16, 27, -22, 22], // asiento
    [30, 35, -2, 20], // reposabrazos
    [27, 72, -22, -8], // respaldo
    [46, 62, -8, -3], // las alas del bacquet
  ];
  for (const [a0, a1, c0, c1] of parts) box(a0 - 1, a1 + 1, c0 - 1, c1 + 1, p.outline);
  box(-3, 1, -22, 22, D);
  for (const c of [-22, -1, 18]) {
    box(-8, -3, c, c + 4, B); // ruedas
    box(-6, -5, c + 1, c + 3, C);
  }
  box(1, 16, -3, 3, B);
  box(2, 10, -1, 1, C); // el pistón cromado
  box(16, 27, -22, 22, B);
  box(16, 18, -22, 22, G); // vivo del asiento
  box(24, 27, -20, 20, '#2e2e36'); // el cojín, con luz
  box(22, 30, 8, 11, D); // soporte del reposabrazos
  box(30, 35, -2, 20, B);
  box(34, 35, -2, 20, G);
  box(27, 72, -22, -8, B);
  box(46, 62, -8, -3, B);
  box(30, 68, -19, -16, G); // panel lateral verde
  for (let a = 30; a < 68; a += 4) box(a, a + 2, -12, -11, G); // costura
  box(33, 41, -8, -5, D); // cojín lumbar
  box(36, 38, -8, -5, G);
  box(57, 61, -17, -13, '#050507'); // huecos del arnés
  box(64, 67, -17, -13, '#050507');
  box(64, 70, -8, -4, D); // cabecero
  box(66, 68, -7, -5, G); // el logo
}

// Chispas al arrastrar el bloque: se dibujan en el ARTE (no como partículas)
// porque tienen que ir horneadas en el frame, pegadas a la base del bloque,
// y no esparcidas por el mundo. Las partículas de verdad las lanza main.js
// cuando el golpe conecta.
function drawDragSparks(pix, { w, h, pose, palette: p }) {
  const amount = pose.sparks || 0;
  if (amount <= 0.02) return;
  const px = pix.unit;
  // Por delante del cuerpo: dentro de la silueta las tapaba la propia pierna
  // (las chispas se dibujan por detrás del luchador).
  const baseX = w * 0.80;
  const baseY = h * 0.9;
  // Dos abanicos con angulos distintos: uno rasante (la chispa que sale
  // disparada hacia delante al rozar) y otro mas abierto hacia arriba. Con un
  // solo abanico se leia como una raya, no como chispas saltando.
  for (let lane = 0; lane < 2; lane += 1) {
    for (let i = 0; i < 8; i += 1) {
      const t = i / 7;
      const spread = (lane ? -0.2 : -0.9) - t * (lane ? 0.5 : 1.1);
      const dist = px * (3 + t * 20) * amount;
      const sx = baseX + Math.cos(spread) * dist;
      const sy = baseY + Math.sin(spread) * dist * 0.75;
      const tone = t < 0.25 ? '#ffffff' : (t < 0.65 ? p.accentLight : p.accent);
      pix.rect(sx, sy, px * (t < 0.5 ? 3 : 2), px * (t < 0.5 ? 2 : 1), tone);
    }
  }
  // Foco de contacto: el punto donde el bloque roza el suelo.
  pix.rect(baseX - px * 2, baseY - px, px * 5, px * 2, '#ffffff');
  pix.rect(baseX - px * 4, baseY, px * 9, px, p.accentLight);
}

// MICRO DORADO del rapero (Modo Despertado): mango en la mano y la rejilla,
// una bola dorada con su malla, a MIC_LENGTH px en la dirección `angle` (se
// orienta como la llave). La cabeza es lo que golpea: ver effectorPoint.
export const MIC_LENGTH = 22;
function drawGoldMic(pix, x, y, angle, p) {
  const px = pix.unit;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  for (let i = 0; i <= 16; i += 1) pix.rect(x + dx * i * px - px * 1.5, y + dy * i * px - px * 1.5, px * 4, px * 4, p.goldDark);
  for (let i = 0; i <= 16; i += 1) pix.rect(x + dx * i * px - px * 0.5, y + dy * i * px - px * 0.5, px * 2, px * 2, p.gold);
  const mx = x + dx * MIC_LENGTH * px;
  const my = y + dy * MIC_LENGTH * px;
  pix.ellipse(mx, my, px * 6.5, px * 6.5, p.goldDark);
  pix.ellipse(mx, my, px * 5.5, px * 5.5, p.gold);
  for (const k of [-3, 0, 3]) pix.rect(mx - px * 4, my + k * px, px * 8, px, p.goldDark); // la malla
  for (const k of [-3, 0, 3]) pix.rect(mx + k * px, my - px * 4, px, px * 8, p.goldDark);
  pix.rect(mx - px * 3, my - px * 4, px * 2, px * 2, '#fff0b8'); // brillo
}

// PURO HABANERO gigante: 20 px de tabaco con su anilla roja y la BRASA en la
// punta, que se enciende con la calada (`ember` 0..1: apagada, al rojo, al
// blanco).
function drawBigCigar(pix, x, y, angle, p, ember) {
  const px = pix.unit;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const len = 20;
  for (let i = 0; i < len; i += 1) {
    pix.rect(x + dx * i * px - px * 1.5, y + dy * i * px - px * 1.5, px * 4, px * 4, i === 5 || i === 6 ? p.cigarBand : p.cigar);
  }
  for (let i = 0; i < len; i += 1) pix.rect(x + dx * i * px, y + dy * i * px - px * 1.5, px, px, p.cigarLight);
  const tx = x + dx * len * px;
  const ty = y + dy * len * px;
  pix.rect(tx - px * 2, ty - px * 2, px * 4, px * 4, ember > 0.3 ? p.ember : p.smokeDark);
  if (ember > 0.3) pix.rect(tx - px, ty - px, px * 2, px * 2, ember > 0.8 ? '#fff4c2' : '#ffd27a');
}

// Prop en la mano delantera según lo que pida la pose. Se dibuja DESPUÉS del
// brazo para que quede agarrado y no detrás de él.
function drawHeldTool(pix, {
  pose, palette: p, handX, handY, facing = 1,
}) {
  const strength = pose.tool || 0;
  if (strength <= 0.05) return;
  const kind = pose.toolKind || 'wrench';

  if (kind === 'mic') {
    drawGoldMic(pix, handX, handY, pose.toolAngle ?? -1.2, p);
    return;
  }
  if (kind === 'cigar') {
    drawBigCigar(pix, handX, handY, pose.toolAngle ?? -0.3, p, pose.ember || 0);
    return;
  }
  if (kind === 'donut') {
    // A la altura del pecho, no de la mano: lo lleva CARGADO por delante.
    drawDonutCushion(pix, handX - pix.unit * 12, handY - pix.unit * 30, p);
    return;
  }
  const angle = pose.toolAngle ?? -0.4;
  // Llave GRANDE: es "una llave grifa pesada", y una herramienta pequeña
  // desaparece contra el cuerpo. Con este largo el mango cruza medio sprite y
  // la cabeza asoma por fuera de la silueta.
  // LLAVE TITÁNICA: 64px, más de la mitad de la altura de Samuel (120). A
  // 26px la herramienta desaparecía contra el cuerpo y el golpe se leía como
  // un puñetazo con un bulto; a 64 la herramienta ES el golpe, que es la
  // regla de este personaje.
  drawWrench(pix, handX, handY, pix.unit * 64 * (0.65 + strength * 0.35), angle, p, { flip: facing });
}

function drawGasCloud(pix, { w, h, pose, palette }) {
  const amount = pose.gas || 0;
  if (amount <= 0.01) return;
  const px = pix.unit;
  const gas = palette.gas || '#7ed957';
  const gasDark = palette.gasDark || '#3f8c2e';
  const gasLight = palette.gasLight || '#c8f57e';

  // Nube DENSA con degradado real, aprovechando la densidad de 1px: cuatro
  // filas del abanico y 4 tonos repartidos por distancia (blanco en la boca
  // del escape -> verde claro -> verde -> verde oscuro en el borde). Con dos
  // filas y dos tonos se leia como una hilera de puntos; el degradado es lo
  // que la convierte en volumen.
  const lanes = 4;
  const perLane = 9;
  const originX = w * (pose.gasX ?? 0.34);
  const originY = h * (pose.gasY ?? 0.62);
  const baseAngle = pose.gasAngle ?? Math.PI * 0.85;

  for (let lane = 0; lane < lanes; lane += 1) {
    const laneOff = (lane / (lanes - 1) - 0.5) * 0.95;
    for (let i = 0; i < perLane; i += 1) {
      const t = i / (perLane - 1);
      // Cada carril se abre un poco mas al alejarse: el chorro se expande.
      const spread = baseAngle + laneOff * (0.5 + t * 0.9);
      const dist = px * (3 + t * 26) * amount;
      const bx = originX + Math.cos(spread) * dist;
      const by = originY + Math.sin(spread) * dist * 0.85;

      // DISIPACIÓN EN 3 FASES. `amount` va de 1 a 0 mientras la nube muere, y
      // antes la nube entera se desvanecía de golpe al llegar a 0: aparecía y
      // desaparecía sin transición. Ahora la vida de la nube se reparte en
      // tres tramos con tamaño y tono propios — crece, se abre y se
      // deshilacha — y las burbujas del borde se van antes que el núcleo,
      // que es como se deshace una nube de verdad.
      const fase = amount > 0.66 ? 2 : (amount > 0.33 ? 1 : 0);
      // En las dos últimas fases el borde del abanico ya se ha ido.
      if (t > 0.35 + fase * 0.32) continue;
      const crecer = [1.45, 1.15, 1][fase]; // al deshacerse, las burbujas se hinchan
      const size = px * (t < 0.25 ? 2 : (t < 0.55 ? 3 : (t < 0.8 ? 4 : 5))) * crecer;

      let tone = gasDark;
      if (t < 0.15) tone = '#ffffff';
      else if (t < 0.4) tone = gasLight;
      else if (t < 0.7) tone = gas;
      // Y al apagarse pierde el blanco y el verde claro: primero se va la luz.
      if (fase === 1 && tone === '#ffffff') tone = gasLight;
      if (fase === 0) tone = tone === gasDark ? gasDark : gas;
      pix.rect(bx, by, size, size, tone);
      // Punto de luz dentro de las burbujas grandes: da el brillo de burbuja.
      if (t > 0.45 && lane % 2 === 0) pix.rect(bx + px, by + px, px, px, gasLight);
    }
  }
  // Nucleo brillante en la boca del escape. Se apaga con la nube: es lo
  // primero que desaparece, no lo último.
  if (amount > 0.33) {
    pix.rect(originX - px * 2, originY - px * 2, px * 5, px * 5, gasLight);
    if (amount > 0.66) pix.rect(originX - px, originY - px, px * 3, px * 3, '#ffffff');
  }
}


// Bocanada de humo de cigarro. Sale de la BOCA (no de la espalda como el gas)
// y se comporta al revés que una explosión: se expande despacio, sube y se
// deshace en tonos grises, sin blanco. El blanco lo tiene el gas; si el humo
// también lo llevara, los dos efectos de Samuel se confundirían de un vistazo.
function drawSmokePuff(pix, { w, h, pose, palette }) {
  const amount = pose.smokePuff || 0;
  if (amount <= 0.01) return;
  const px = pix.unit;
  const smoke = palette.smoke || '#b9b5ad';
  const dark = palette.smokeDark || '#6e6a63';
  const light = palette.smokeLight || '#e6e3dc';

  const originX = w * 0.68; // boca, mirando a la derecha
  const originY = h * 0.14;
  const puffs = 14;
  for (let i = 0; i < puffs; i += 1) {
    const t = i / (puffs - 1);
    // Sube en diagonal y se va abriendo: una bocanada, no un chorro.
    const drift = 0.35 - t * 0.9;
    const dist = px * (2 + t * 22) * amount;
    const bx = originX + Math.cos(drift) * dist;
    const by = originY + Math.sin(drift) * dist * 0.75 - t * px * 6 * amount;
    // Mismas tres fases que el gas, pero al revés de brillo: el humo se
    // ACLARA al deshacerse (se diluye en el aire) en vez de apagarse.
    const fase = amount > 0.66 ? 2 : (amount > 0.33 ? 1 : 0);
    if (t > 0.4 + fase * 0.3) continue;
    const crecer = [1.6, 1.25, 1][fase];
    const size = px * (t < 0.3 ? 2 : (t < 0.7 ? 3 : 4)) * crecer;
    let tone = t < 0.25 ? light : (t < 0.65 ? smoke : dark);
    if (fase === 1 && tone === dark) tone = smoke;
    if (fase === 0) tone = light;
    pix.rect(bx, by, size, size, tone);
  }
}

// Onda de choque del eructo sónico: arcos concéntricos de celdas por delante
// de la cara. Se dibujan como arcos DISCRETOS (celdas sueltas repartidas por
// el ángulo) y no como círculos rellenos, que es lo que la hace leer como
// onda translúcida sin necesidad de alfa continuo.
function drawShockwave(pix, { w, h, pose, palette }) {
  const amount = pose.shock || 0;
  if (amount <= 0.01) return;
  const px = pix.unit;
  // Origen y dirección ajustables: el eructo neutro sale al frente desde la
  // boca; el Uair, hacia arriba desde la coronilla.
  const originX = w * (pose.shockX ?? 0.7);
  const originY = h * (pose.shockY ?? 0.16);
  const dir = pose.shockAngle ?? 0;
  const rings = 3;

  for (let r = 0; r < rings; r += 1) {
    // Cada anillo sale un poco después que el anterior: la onda se propaga.
    const phase = amount - r * 0.22;
    if (phase <= 0) continue;
    const radius = px * (4 + phase * 30);
    const cells = 9;
    const tone = r === 0 ? palette.gasLight || '#c8f57e' : (r === 1 ? palette.smoke : palette.smokeDark);
    for (let i = 0; i < cells; i += 1) {
      const angle = dir - 0.85 + (i / (cells - 1)) * 1.7; // abanico
      const cx2 = originX + Math.cos(angle) * radius;
      const cy2 = originY + Math.sin(angle) * radius * 0.85;
      const size = px * (r === 0 ? 3 : 2);
      pix.rect(cx2, cy2, size, size, tone);
    }
  }
}


// Micrófono con cable: la mano delantera lo agarra y el cable cae en bucle.
// El cable es lo que lo identifica — un micro sin cable a esta escala es un
// palo gris cualquiera.
function drawMicrophone(pix, { w, h, pose, palette: p }) {
  const amount = pose.mic || 0;
  if (amount <= 0.05) return;
  const px = pix.unit;
  // Sigue a la mano delantera: se deriva de los mismos offsets que el brazo.
  const mx = w * 0.72 + (pose.armFrontOffX || 0);
  const my = h * 0.42 + (pose.armFrontOffY || 0);

  // Cabeza del micro (rejilla) y mango.
  pix.rect(mx, my - px * 3, px * 5, px * 5, p.metalLight);
  pix.rect(mx + px, my - px * 2, px * 3, px * 3, p.metalDark);
  pix.rect(mx + px, my - px * 2, px, px, p.metalLight); // brillo
  pix.rect(mx + px, my + px * 2, px * 3, px * 6, p.grease); // mango
  pix.rect(mx + px, my + px * 2, px, px * 6, p.greaseLight);

  // Cable: tres tramos que caen y se curvan, en pasos discretos.
  const cx0 = mx + px * 2;
  const cy0 = my + px * 8;
  for (let i = 0; i < 10; i += 1) {
    const t = i / 9;
    const cxp = cx0 - t * px * 9 + Math.sin(t * Math.PI * 1.6) * px * 4;
    const cyp = cy0 + t * px * 12;
    pix.rect(cxp, cyp, px, px, p.greaseDark);
  }
}

// Notas musicales y barras de distorsión: lo que sale de la boca mientras
// rapea. Alterna corcheas (un óvalo con palo) y barras verticales tipo
// ecualizador, que es lo que lo lee como SONIDO y no como confeti.
function drawMusicNotes(pix, { w, h, pose, palette: p }) {
  const amount = pose.notes || 0;
  if (amount <= 0.05) return;
  const px = pix.unit;
  const originX = w * 0.78;
  const originY = h * 0.18;

  for (let i = 0; i < 7; i += 1) {
    const t = i / 6;
    const dist = px * (4 + t * 26) * amount;
    const angle = -0.9 + t * 1.5;
    const nx = originX + Math.cos(angle) * dist;
    const ny = originY + Math.sin(angle) * dist * 0.7 - t * px * 4;
    const tone = t < 0.4 ? '#ffffff' : (t < 0.75 ? p.accentLight : p.accent);
    if (i % 2 === 0) {
      // Corchea: cabeza + palo.
      pix.rect(nx, ny + px * 2, px * 3, px * 2, tone);
      pix.rect(nx + px * 2, ny - px * 2, px, px * 4, tone);
      pix.rect(nx + px * 3, ny - px * 2, px, px, tone);
    } else {
      // Barra de distorsión (ecualizador).
      const barH = px * (2 + ((i * 3) % 4));
      pix.rect(nx, ny - barH, px * 2, barH * 2, tone);
    }
  }
}

// Sangrado de oídos de la víctima: dos chorros de píxeles rojos que salen a
// los lados de la cabeza y caen. Cómico por lo exagerado, no gore: tonos
// planos y trayectoria en arco corto.
function drawEarBleed(pix, { w, h, pose, palette: p }) {
  const amount = pose.earBlood || 0;
  if (amount <= 0.05) return;
  const px = pix.unit;
  const headY = h * 0.14 + (pose.headOffY || 0);
  const blood = p.blood || '#d8202a';
  const dark = p.bloodDark || '#8c1018';

  for (const side of [-1, 1]) {
    const ex = w * 0.5 + side * w * 0.14 + (pose.headOffX || 0);
    for (let i = 0; i < 6; i += 1) {
      const t = i / 5;
      const bx = ex + side * px * (1 + t * 7);
      const by = headY + t * t * px * 14;
      pix.rect(bx, by, px * (t < 0.5 ? 2 : 1), px * 2, t < 0.6 ? blood : dark);
    }
  }
}

// --- SAMUEL: el mecánico ---------------------------------------------------
//
// Único kit dibujado ENTERO a 1px (los demás siguen en bloques de 2px, ver la
// nota de PIXEL_UNIT), y por eso es el que puede permitirse anatomía: pecho y
// abdominales insinuados, deltoides y bíceps con volumen, mandíbula, nariz y
// ojos de verdad.
//
// El idioma de sombreado es el mismo en todas las masas y conviene mantenerlo:
//   1. relleno con `taper`
//   2. `rim` CLARO por el lado de la luz (frontal-superior, el farol del
//      callejón queda delante)
//   3. `rim` OSCURO por el lado contrario
// `rim` sigue la curva del taper, así que la luz nunca se sale del cuerpo ni
// se mete por dentro, que es lo que pasaba al sombrear con columnas rectas.
//
// Tres rasgos lo identifican de un vistazo, sacados de las fotos:
//   - pelo castaño oscuro con volumen y rizo arriba, RECORTADO en los
//     laterales (el degradado de las sienes es lo que lo fecha y lo hace suyo)
//   - barba tupida cerrada, unida a las patillas, perfilada en la mandíbula
//   - aro negro en la oreja, con agujero visible
// --- SAMUEL ("mecánico"): el brawler pesado, dibujado del natural ----------
//
// Rediseño sobre las fotos de Samuel (septiembre de 2026), en DOS vueltas.
//
// La primera cambió las cajas por masas redondas, pero dejó dos fallos de
// lectura que se vieron en la arena: el torso eran dos elipses (pecho y
// barriga) descolocadas, y con el pecho desnudo cruzado por UN tirante en
// diagonal y el peto escondido el cuerpo se leía DE ESPALDAS mientras la
// cabeza iba de perfil (una torsión de 180°). Los brazos colgaban rectos y
// acababan en muñones.
//
// Ahora es una pose de GUARDIA en 3/4 frontal, la de los juegos de lucha: el
// pecho y la barriga miran a cámara mientras encara a la derecha.
//   - El torso es UNA pieza con su perfil fila a fila (hombros anchos, pecho,
//     barriga que sale por delante, cadera), sombreado por bandas verticales.
//   - Lo que dice "de frente": pectorales y vello en el esternón, el PETO
//     centrado con su bolsillo y los DOS tirantes (uno al hombro, el otro caído
//     sobre la barriga con su hebilla).
//   - Los brazos se articulan (codo por cinemática inversa, ver `joint`) y
//     acaban en PUÑOS cerrados con nudillos, dedos y pulgar. En las poses
//     neutras (`pose.guard`) suben a la guardia: codos abajo pegados al
//     cuerpo, puño delantero a la altura de la barbilla y el trasero delante
//     del pecho. Brazos y puños se ENTINTAN (contorno propio) porque pasan por
//     delante del torso, piel sobre piel.
//   - Piernas abiertas con las rodillas flexionadas hacia fuera: peso.
//   - La cara en 3/4: los dos ojos, la nariz hacia delante y la oreja con el
//     aro en el lado visible.
//
// Coordenadas: caja de 80x120 con los pies en y=120. Los offsets de la pose
// mueven los EXTREMOS (manos, tobillos, cabeza, torso) respecto a su sitio de
// reposo; sin guardia, las manos reposan donde las dejaba el kit original, que
// es con lo que se ajustaron los golpes de poseLibrary.js y sus hitboxes.

// Codo o rodilla: el punto intermedio de una cadena de dos segmentos de
// largos l1 y l2 que va de A a B. `bend` elige el lado (+1 / -1). Si B queda
// más lejos de lo que alcanza la cadena, el miembro se estira recto.
function joint(ax, ay, bx, by, l1, l2, bend) {
  const dx = bx - ax;
  const dy = by - ay;
  const dist = Math.hypot(dx, dy) || 0.001;
  if (dist >= l1 + l2) return { x: ax + dx * (l1 / (l1 + l2)), y: ay + dy * (l1 / (l1 + l2)) };
  const along = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const off = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const ux = dx / dist;
  const uy = dy / dist;
  return { x: ax + ux * along - uy * off * bend, y: ay + uy * along + ux * off * bend };
}

// BRAZO con largo de verdad: 17 px de brazo y 16 de antebrazo. Con 13 + 13
// la mano no llegaba a la cadera (del hombro a la cadera hay ~40 px), así que
// en reposo el codo se doblaba hacia FUERA y el antebrazo volvía pegado a la
// barriga: "alitas de pollo".
export const ARM_UPPER = 17;
export const ARM_FORE = 16;

/** ¿El brazo CUELGA? La mano, casi un brazo entero por debajo del hombro. */
export function armHangs(shoulder, hand) {
  return hand.y - shoulder.y > (ARM_UPPER + ARM_FORE) * 0.75;
}

/**
 * Dónde va el CODO entre el hombro y la mano: de las dos soluciones de la
 * cadena, la anatómica. Con la mano a la altura del hombro o más arriba
 * (guardia, golpes), la que queda claramente más ABAJO: el codo apunta al
 * suelo, pegado a las costillas. Colgando, hacia ATRÁS (la flexión natural
 * de un brazo caído). Plegado con la mano más abajo, del lado de la mano
 * (hacia el eje del torso `cx` si está justo debajo). Nunca abierto hacia
 * fuera con la mano dentro (alitas de pollo) ni hacia dentro con la mano
 * fuera (el antebrazo vuelve cruzado: brazos en X, pinzas de cangrejo).
 */
export function armElbow(shoulder, hand, cx) {
  const a = joint(shoulder.x, shoulder.y, hand.x, hand.y, ARM_UPPER, ARM_FORE, 1);
  const b = joint(shoulder.x, shoulder.y, hand.x, hand.y, ARM_UPPER, ARM_FORE, -1);
  if (hand.y - shoulder.y < 10 && Math.abs(a.y - b.y) > 4) return a.y > b.y ? a : b;
  if (armHangs(shoulder, hand)) return a.x <= b.x ? a : b;
  // Plegado: el codo, del MISMO lado que la mano (con la mano hacia fuera y
  // el codo hacia dentro, el antebrazo volvía cruzándose: brazos en X);
  // con la mano justo debajo, hacia el eje del torso.
  const side = Math.sign(Math.round(hand.x - shoulder.x)) || Math.sign(cx - shoulder.x) || 1;
  return (a.x - b.x) * side >= 0 ? a : b;
}

// Perfil del torso en 3/4: [y relativa al hombro, borde de atrás, borde de
// delante] respecto al centro. Hombros anchos y redondeados arriba, pecho,
// BARRIGA que se abomba por delante (y un poco por detrás) y cadera.
const TORSO_PROFILE = [
  [0, -10, 10], [2, -16, 16], [5, -19, 19], [9, -19, 19], [16, -17, 18],
  [22, -16, 20], [30, -17, 23], [36, -16, 22], [42, -15, 18], [47, -14, 15],
];

function torsoEdges(dy) {
  const P = TORSO_PROFILE;
  if (dy <= P[0][0]) return [P[0][1], P[0][2]];
  for (let i = 1; i < P.length; i += 1) {
    if (dy <= P[i][0]) {
      const t = (dy - P[i - 1][0]) / (P[i][0] - P[i - 1][0]);
      return [P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t, P[i - 1][2] + (P[i][2] - P[i - 1][2]) * t];
    }
  }
  const last = P[P.length - 1];
  return [last[1], last[2]];
}

/**
 * Hombros y manos del kit `mecanico` para una pose (lo que dibuja el kit,
 * expuesto para que los tests midan la MISMA geometría). Los codos salen de
 * `armElbow` con el `cx` que se devuelve.
 */
export function mecanicoArms({ w, pose, awake = false }) {
  const cx = w / 2 + pose.torsoOffX;
  const top = 31 + pose.torsoOffY;
  const guard = Math.max(0, Math.min(1, pose.guard || 0));
  const mix = (a, b) => a + (b - a) * guard;
  const defiant = awake && pose.stance === 'idle';
  const lean = (pose.lean || 0) + (defiant ? -1.5 : 0);
  const breath = pose.breath || 0;
  // PERSPECTIVA 3/4 DE COMBATE: el hombro de delante, junto a la base del
  // cuello y hacia la cámara (a 13 px del eje, con su caída; a 15 y más alto
  // era una joroba); el de ATRÁS, escorzado DETRÁS de la cabeza (a 6 px del
  // eje). Con los dos a la misma distancia el cuerpo se leía plano, de
  // frente, con dos brazos iguales: un maniquí.
  const shoulderBack = { x: cx - 6 + lean, y: top + 7 - breath * 0.6 };
  const shoulderFront = { x: cx + 13 + lean, y: top + 8 - breath * 0.6 };
  // Manos: reposo bajo (el del kit original) -> guardia, más el offset. En
  // guardia, el puño de delante adelantado a la altura de la barbilla y el
  // de atrás pegado a la mandíbula, asomando por delante de la cara.
  const handFront = { x: w / 2 + mix(21, 25) + pose.armFrontOffX, y: mix(62, 35) + pose.armFrontOffY };
  const handBack = { x: w / 2 + mix(-20, 18) + pose.armBackOffX, y: mix(61, 29) + pose.armBackOffY };
  // En guardia el puño va SIEMPRE por delante de su hombro: con el torso
  // encorvado o agachado, la guardia a su altura de siempre caía justo encima
  // del hombro y el codo, sin sitio para bajar, se iba de lado cruzando el
  // pecho (la "momia").
  if (guard > 0) {
    handFront.x = Math.max(handFront.x, shoulderFront.x + 9 * guard);
    handBack.x = Math.max(handBack.x, shoulderBack.x + 14 * guard);
  }
  return {
    cx, shoulderBack, shoulderFront, handFront, handBack,
    elbowFront: armElbow(shoulderFront, handFront, cx),
    elbowBack: armElbow(shoulderBack, handBack, cx),
  };
}

function drawMecanico(pix, {
  w, h, pose, palette: p, outfit = 'normal', layer = 'body',
}) {
  const px = pix.unit; // 1px real: este kit dibuja a máxima densidad
  // MODO DESPERTAR (prototipo, tecla Ñ): el rapero. Camiseta blanca ancha,
  // bermudas grises deportivas, zapatillas, sin barba, gorra hacia atrás azul
  // y blanca y gafas rectangulares. Es un OUTFIT del mismo kit: el cuerpo, las
  // poses y la sincronía con las cajas son los de siempre.
  const awake = outfit === 'awakened';
  const cx = w / 2 + pose.torsoOffX;
  const T = pose.torsoOffY;
  const guard = Math.max(0, Math.min(1, pose.guard || 0));
  const mix = (a, b) => a + (b - a) * guard;

  // Volumen de una masa en tres capas: sombra, base desplazada hacia la luz
  // (arriba-delante) y brillo. La silueta la da la primera, la más grande.
  const massEllipse = (x, y, rx, ry, [dark, base, light], opts = {}) => {
    pix.ellipse(x, y, rx, ry, dark, opts);
    pix.ellipse(x + px, y - px, rx - px * 1.5, ry - px * 1.5, base, opts);
    if (light) pix.ellipse(x + px * 2.5, y - px * 2.5, rx * 0.45, ry * 0.4, light, opts);
  };
  // Miembro entintado: primero la tinta (contorno propio, porque pasa por
  // delante del cuerpo), luego sombra, base y brillo.
  const massLimb = (pts, radii, [dark, base, light], ink = true) => {
    if (ink) pix.limb(pts, radii.map((r) => r + px), p.outline);
    pix.limb(pts, radii, dark);
    pix.limb(pts.map(([x, y]) => [x + px * 0.8, y - px * 0.8]), radii.map((r) => r - px * 1.3), base);
    if (light) pix.limb(pts.map(([x, y]) => [x + px * 1.8, y - px * 1.6]), radii.map((r) => r * 0.35), light);
  };

  const skin = [p.skinShadow, p.skin, p.skinLight];
  const skinBack = [p.skinShadow, p.skinDark, p.skin];
  const denim = [p.denimDark, p.denim, p.denimLight];
  const denimBack = [p.denimDeep, p.denimDark, p.denim];
  const tee = [p.teeShade, p.tee, '#ffffff'];
  const shorts = [p.shortsDark, p.shorts, p.shortsLight];
  const shortsBack = [p.outline, p.shortsDark, p.shorts];

  // Inclinación (`lean`): hombros y cabeza se van, la cadera se queda; el
  // torso se CIZALLA fila a fila entre las dos. Es como se echa atrás para
  // cargar y se vuelca hacia delante al pegar, sin rotar nada.
  // ACTITUD DESAFIANTE (Despertar, en reposo): brazos cruzados, pecho fuera
  // (echado un pelo atrás) y la barbilla alta.
  const defiant = awake && pose.stance === 'idle';
  const lean = (pose.lean || 0) + (defiant ? -1.5 : 0);
  // Hincharse (`inflate`, el eructo) y respirar (`breath`, el reposo).
  const inflate = Math.max(0, Math.min(1, pose.inflate || 0));
  const breath = pose.breath || 0;

  // --- anclajes -------------------------------------------------------------
  const top = 31 + T; // arranque del cuello / línea de hombros
  const { shoulderBack, shoulderFront, handFront, handBack } = mecanicoArms({ w, pose, awake });
  const hipBack = { x: cx - 8, y: 79 + T };
  const hipFront = { x: cx + 8, y: 79 + T };
  const bootH = 12;
  // Piernas abiertas: los tobillos más separados que la cadera.
  const ankleBack = { x: w / 2 - 12 + pose.legBackOffX, y: h - bootH + pose.legBackOffY };
  const ankleFront = { x: w / 2 + 13 + pose.legFrontOffX, y: h - bootH + pose.legFrontOffY };

  // Bota de trabajo: caña, puntera redonda hacia delante y suela gruesa. Su
  // base cae en y = tobillo + bootH: con los offsets a 0, en h.
  //
  // La bota se ORIENTA con la pierna: la suela mira hacia donde apunta la
  // pierna (de la rodilla al tobillo). De pie (pierna casi vertical) es la
  // bota de siempre, plana contra el suelo. Con la pierna lejos de la
  // vertical se rasteriza GIRADA píxel a píxel (esta rejilla no rota): en la
  // patada de bota la suela mira al rival y la puntera de acero sube; en la
  // coz, la suela mira hacia atrás. Antes se dibujaba siempre plana y la
  // patada parecía un pie fracturado pisando una baldosa invisible.
  const bootColorAt = (lx, ly, tones) => {
    const inEllipse = (ex, ey, rx, ry) => ((lx - ex) / rx) ** 2 + ((ly - ey) / ry) ** 2 <= 1;
    let c = null;
    if (lx >= -6 && lx < 6 && ly >= -1 && ly < 9) c = tones[0];
    if (inEllipse(3, 7, 8, 5)) c = tones[0];
    if (lx >= -5 && lx < 5 && ly >= 0 && ly < 9) c = tones[1];
    if (inEllipse(3, 6.5, 6.5, 3.5)) c = tones[1];
    if (lx >= 4 && lx < 8 && ly >= 4 && ly < 5) c = tones[2]; // puntera de acero
    if (lx >= -4 && lx < 3 && ((ly >= 2 && ly < 3) || (ly >= 4 && ly < 5))) c = tones[0]; // cordones
    if (lx >= -7 && lx < 11 && ly >= 9 && ly < 12) c = ly < 10 ? p.soleEdge : p.sole; // suela de goma
    return c;
  };
  // Un pie PLANTADO (el tobillo a la altura del suelo) va siempre plano,
  // aunque la espinilla vaya en diagonal: lo que se flexiona es el tobillo.
  // Girarlo con la pierna hacía que el pie de apoyo pisara de talón.
  const drawBoot = (ax, ay, tones, legAngle = Math.PI / 2) => {
    const planted = ay >= h - bootH - 1.5;
    let turn = planted ? 0 : legAngle - Math.PI / 2;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    if (Math.abs(turn) > 0.4) {
      const c = Math.cos(turn);
      const s = Math.sin(turn);
      for (let y = Math.floor(ay) - 16; y <= ay + 16; y += px) {
        for (let x = Math.floor(ax) - 16; x <= ax + 16; x += px) {
          const dx = x + px / 2 - ax;
          const dy = y + px / 2 - ay;
          const color = bootColorAt(dx * c + dy * s, -dx * s + dy * c, tones);
          if (color) pix.rect(x, y, px, px, color);
        }
      }
      return;
    }
    const bottom = ay + bootH;
    pix.rect(ax - px * 6, ay - px, px * 12, bootH - px * 2, tones[0]);
    pix.ellipse(ax + px * 3, bottom - px * 5, px * 8, px * 5, tones[0]);
    pix.rect(ax - px * 5, ay, px * 10, bootH - px * 3, tones[1]);
    pix.ellipse(ax + px * 3, bottom - px * 5.5, px * 6.5, px * 3.5, tones[1]);
    pix.rect(ax + px * 4, bottom - px * 8, px * 4, px, tones[2]); // brillo de la puntera
    pix.rect(ax - px * 4, ay + px * 2, px * 7, px, tones[0]); // cordones
    pix.rect(ax - px * 4, ay + px * 4, px * 7, px, tones[0]);
    pix.rect(ax - px * 7, bottom - px * 3, px * 18, px * 3, p.sole); // suela de goma
    pix.rect(ax - px * 7, bottom - px * 3, px * 18, px, p.soleEdge);
  };

  // Pierna del mono: cadera -> rodilla (flexionada hacia FUERA) -> tobillo.
  // Devuelve hacia dónde apunta la espinilla (rodilla -> tobillo): es lo que
  // orienta la bota.
  const drawLeg = (hip, ankle, tones, bend, back = false) => {
    const knee = joint(hip.x, hip.y, ankle.x, ankle.y, 15, 15, bend);
    if (awake) {
      // Pierna desnuda y, encima, la bermuda hasta justo debajo de la rodilla,
      // con la franja lateral clara de la ropa deportiva.
      massLimb([[hip.x, hip.y], [knee.x, knee.y], [ankle.x, ankle.y - px * 2]], [px * 7.5, px * 6, px * 5], back ? skinBack : skin, false);
      const hem = { x: knee.x + (ankle.x - knee.x) * 0.15, y: knee.y + (ankle.y - knee.y) * 0.15 };
      massLimb([[hip.x, hip.y], [hem.x, hem.y]], [px * 9.5, px * 8.5], back ? shortsBack : shorts, false);
      pix.limb([[hip.x + px * 6, hip.y + px], [hem.x + px * 6, hem.y - px]], [px * 0.6, px * 0.6], p.shortsLight);
    } else {
      massLimb([[hip.x, hip.y], [knee.x, knee.y], [ankle.x, ankle.y - px * 2]], [px * 9, px * 7.5, px * 6.5], tones, false);
      // Pliegue de la rodilla: la tela se arruga donde dobla.
      pix.rect(knee.x - px * 3, knee.y, px * 6, px, tones[0]);
    }
    return Math.atan2(ankle.y - knee.y, ankle.x - knee.x);
  };

  // PUÑO cerrado, mirando hacia delante: bloque redondeado con tinta propia,
  // cuatro dedos separados por líneas oscuras, nudillos claros en el frente y
  // el pulgar cruzado por debajo.
  const drawFist = (x, y, tones, down = false) => {
    if (down) {
      // Colgando, el puño mira al SUELO: los nudillos abajo, los dedos
      // doblados hacia el cuerpo y el pulgar por delante.
      pix.ellipse(x, y, px * 4.5, px * 5.5, p.outline);
      pix.ellipse(x, y, px * 3.5, px * 4.5, tones[0]);
      pix.ellipse(x + px * 0.5, y - px, px * 3, px * 3.5, tones[1]);
      pix.rect(x - px * 3, y + px * 3, px * 6, px, tones[2]); // nudillos
      for (const dx of [-2, 0, 2]) pix.rect(x + px * dx, y, px, px * 3, p.skinShadow); // dedos
      pix.rect(x + px * 3, y - px * 3, px, px * 4, p.skinShadow); // pulgar
      return;
    }
    pix.ellipse(x, y, px * 5.5, px * 5, p.outline);
    pix.ellipse(x, y, px * 4.5, px * 4, tones[0]);
    pix.ellipse(x + px * 0.5, y - px * 0.5, px * 3.8, px * 3.2, tones[1]);
    pix.rect(x + px * 3, y - px * 3, px, px * 6, tones[2]); // nudillos
    for (const dy of [-2, 0, 2]) pix.rect(x, y + px * dy, px * 4, px, p.skinShadow); // dedos
    pix.rect(x - px * 3, y + px * 3, px * 5, px, p.skinShadow); // pulgar
    pix.rect(x - px * 2, y + px * 2, px * 3, px, tones[1]);
  };

  // Brazo: hombro -> codo (atrás colgando, abajo en guardia: `armElbow`) ->
  // puño. Fuerte pero no hinchado (con 7 px de radio el bíceps parecía un
  // tubo inflado) y estrechándose hacia la muñeca. Después, el HOMBRO se pinta
  // ENCIMA con los mismos tonos y sin contorno: tapa la tinta del arranque
  // del brazo y hombro y brazo se leen como UNA extremidad (con el deltoides
  // debajo y el contorno del brazo cruzándolo, eran dos piezas sueltas).
  const drawArm = (shoulder, hand, tones) => {
    const elbow = armElbow(shoulder, hand, cx);
    const down = armHangs(shoulder, hand);
    massLimb([[shoulder.x, shoulder.y], [elbow.x, elbow.y], [hand.x - (down ? 0 : px * 2), hand.y - (down ? px * 2 : 0)]], [px * 5.5, px * 4.5, px * 4], tones);
    drawFist(hand.x, hand.y, tones, down);
    pix.ellipse(shoulder.x, shoulder.y + px, px * 5, px * 4.5, tones[1]);
    pix.ellipse(shoulder.x + px, shoulder.y, px * 2.5, px * 2, tones[2]);
    return elbow;
  };

  // Mangas cortas y anchas de la camiseta del Despertar: tapan el hombro y
  // medio brazo (el bíceps).
  const drawSleeve = (sh, el, tones) => {
    const end = { x: sh.x + (el.x - sh.x) * 0.4, y: sh.y + (el.y - sh.y) * 0.4 };
    massLimb([[sh.x, sh.y], [end.x, end.y]], [px * 6, px * 5.5], tones);
  };

  // ===========================================================================
  // CAPAS DE PROFUNDIDAD: brazo de ATRÁS -> cuerpo -> brazo de DELANTE.
  // El de atrás es su propia capa (`layer: 'back'`, la pinta drawPixelFighter
  // ANTES de la pasada de contorno): así el contorno del torso y de la cabeza
  // lo separa de ellos, y el torso lo tapa donde se cruzan. Va en SOMBRA
  // (sin brillo y un tono más oscuro que el de delante): es lo que da la
  // profundidad.
  // ===========================================================================
  if (layer === 'back') {
    const elbowBack = drawArm(shoulderBack, handBack, [p.skinShadow, p.skinDark, p.skinDark]);
    if (awake) drawSleeve(shoulderBack, elbowBack, [p.teeDeep, p.teeDeep, p.teeShade]);
    return;
  }

  // ===========================================================================
  // PIERNAS Y BOTAS
  // ===========================================================================
  const shinBack = drawLeg(hipBack, ankleBack, denimBack, 1, true);
  drawBoot(ankleBack.x, ankleBack.y, awake ? [p.sneakerDark, p.sneakerDark, p.sneaker] : [p.bootDark, p.bootMid, p.boot], shinBack);
  const shinFront = drawLeg(hipFront, ankleFront, denim, -1);
  drawBoot(ankleFront.x, ankleFront.y, awake ? [p.sneakerDark, p.sneaker, p.sneakerLight] : [p.bootDark, p.boot, p.bootLight], shinFront);

  // ===========================================================================
  // TORSO: una pieza, de frente en 3/4
  // ===========================================================================
  const torsoRows = TORSO_PROFILE[TORSO_PROFILE.length - 1][0];
  // Cizalla de la inclinación: entera en los hombros, nada en la cadera.
  const shear = (y) => lean * Math.max(0, Math.min(1, 1 - (y - top) / torsoRows));
  const bibTop = top + 15; // arranque del peto, a media altura del pecho
  const waist = top + 27; // el mono cubre todo el ancho por debajo
  const chestX = cx + shear(top + 12); // centro del pecho, ya inclinado
  const bellyX = cx + shear(waist + 8); // centro de la barriga
  const bibL = chestX - 8;
  const bibR = chestX + 12;
  for (let dy = 0; dy <= torsoRows; dy += 1) {
    const y = top + dy;
    const [l0, r0] = torsoEdges(dy);
    // La barriga se abomba al hincharse (sobre todo por delante) y el pecho
    // se ensancha un píxel al inspirar.
    const belly = Math.max(0, 1 - Math.abs(dy - 31) / 16);
    const chest = Math.max(0, 1 - Math.abs(dy - 9) / 8);
    const l = l0 - inflate * 2.5 * belly - Math.max(0, breath) * 0.8 * chest;
    const r = r0 + inflate * 7 * belly + Math.max(0, breath) * 0.8 * chest;
    // La camiseta ancha sobresale 2 px por cada lado y cae hasta la cadera;
    // debajo, las bermudas CAÍDAS dejan asomar la cinturilla del calzoncillo.
    const teeRow = awake && y < waist + 10;
    const boxerRow = awake && !teeRow && y < waist + 13;
    const xl = cx + shear(y) + l - (teeRow ? 2 : 0);
    const xr = cx + shear(y) + r + (teeRow ? 2 : 0);
    const width = xr - xl;
    if (pix.outline) {
      pix.rect(xl, y, width, px, p.outline);
      continue;
    }
    // Material de la fila: piel arriba, peto en el centro, mono abajo. (En
    // el Despertar: camiseta arriba y bermuda en la cintura.)
    const denimRow = awake ? !teeRow : y >= waist;
    const tones = awake ? (teeRow ? tee : shorts) : (denimRow ? denim : skin);
    if (boxerRow) {
      pix.rect(xl, y, width, px, y === waist + 11 ? '#f4f4f0' : p.boxer);
      continue;
    }
    pix.rect(xl, y, width, px, tones[1]);
    // Bandas verticales: atrás en sombra, delante con luz.
    pix.rect(xl, y, px * 4, px, tones[0]);
    pix.rect(xl, y, px, px, denimRow ? p.denimDeep : p.skinShadow);
    pix.rect(xr - px * 3, y, px * 2, px, tones[2]);
    if (!awake && !denimRow && y >= bibTop) {
      const bs = shear(y) - shear(top + 12);
      pix.rect(bibL + bs, y, bibR - bibL, px, p.denim);
      pix.rect(bibL + bs, y, px, px, p.denimDark);
      pix.rect(bibR + bs - px, y, px, px, p.denimLight);
    }
  }
  if (!pix.outline && awake) {
    // Camiseta: cuello redondo con la piel del cuello, el EMBLEMA en negro en
    // la tripa (genérico: una montaña detrás y una ola rompiendo; en el pecho
    // lo tapaban los brazos cruzados), pliegues de tela ancha y el bajo sobre
    // la bermuda.
    pix.ellipse(chestX + px, top + px * 1.5, px * 6, px * 3, p.teeShade);
    pix.ellipse(chestX + px, top + px, px * 4.5, px * 2.2, p.skinDark);
    const ex = chestX + px * 4;
    const ey = top + px * 30;
    for (let k = 0; k < 4; k += 1) pix.rect(ex - px * k, ey - px * 3 + px * k, px * (1 + k * 2), px, p.emblem);
    pix.rect(ex - px * 7, ey + px, px * 12, px, p.emblem);
    pix.rect(ex - px * 7, ey - px, px * 2, px * 2, p.emblem);
    pix.rect(ex - px * 6, ey - px * 3, px * 3, px * 2, p.emblem);
    pix.rect(ex - px * 5, ey - px * 2, px, px, p.tee);
    pix.rect(chestX - px * 3, top + px * 18, px * 9, px, p.teeShade);
    pix.rect(chestX - px * 12, top + px * 24, px * 6, px, p.teeShade);
    pix.rect(bellyX + px * 8, waist + px * 4, px * 7, px, p.teeShade);
    pix.rect(bellyX - px * 6, waist + px * 8, px * 5, px, p.teeShade);
    pix.rect(cx - px * 16, waist + px * 9, px * 36, px, p.teeDeep); // bajo
  }
  if (!pix.outline && !awake) {
    // Pecho: dos pectorales (el lejano más estrecho, en 3/4), esternón y
    // vello. Es lo que dice "de frente" a primera vista.
    pix.rect(chestX - px * 14, top + px * 11, px * 12, px, p.skinDark);
    pix.rect(chestX + px * 2, top + px * 11, px * 11, px, p.skinDark);
    pix.rect(chestX - px * 13, top + px * 12, px * 10, px, p.skinShadow);
    pix.rect(chestX + px * 3, top + px * 12, px * 9, px, p.skinShadow);
    pix.rect(chestX, top + px * 4, px, px * 9, p.skinDark);
    pix.rect(chestX - px * 10, top + px * 4, px * 7, px, p.skinLight); // clavícula
    pix.rect(chestX + px * 3, top + px * 4, px * 7, px, p.skinLight);
    for (const [dx, dy] of [[-2, 6], [1, 5], [-1, 8], [2, 8], [0, 10], [-3, 9], [3, 11], [-2, 12]]) {
      pix.rect(chestX + px * dx, top + px * dy, px, px, p.skinShadow);
    }

    // Peto: bolsillo con vivo y la costura de arriba.
    pix.rect(bibL, bibTop, bibR - bibL, px, p.denimLight);
    pix.rect(chestX - px * 3, bibTop + px * 4, px * 11, px * 6, p.denimDark);
    pix.rect(chestX - px * 3, bibTop + px * 4, px * 11, px, p.denimLight);
    pix.rect(chestX + px, bibTop + px * 6, px * 3, px, p.metal); // lápiz en el bolsillo

    // BARRIGA sobre el mono: brillo redondo arriba-delante y el pliegue de
    // debajo, donde la barriga cae sobre la cadera. Sin esto el mono es un saco.
    pix.ellipse(bellyX + px * (9 + inflate * 3), waist + px * 7, px * 8, px * 5, p.denimLight, { toY: waist + px * 9 });
    pix.ellipse(bellyX + px * (10 + inflate * 3), waist + px * 6, px * 4, px * 2, p.denimLight);
    pix.rect(bellyX - px * 8, waist + px * 15, px * 26, px, p.denimDark);
    pix.rect(bellyX - px * 5, waist + px * 16, px * 20, px, p.denimDeep);
    pix.rect(bellyX + px * 2, waist + px * 17, px, px * 4, p.denimDark); // bragueta
    // Manchas de grasa, sutiles.
    pix.rect(bellyX - px * 12, waist + px * 5, px * 3, px * 2, p.grease);
    pix.rect(bellyX + px * 15, waist + px * 12, px * 2, px, p.grease);

    // Tirante PUESTO: del peto sube por el pecho junto al cuello (por fuera
    // pasaba bajo el hombro y el brazo en guardia lo tapaba entero).
    pix.limb([[bibL + px * 2, bibTop + px], [chestX - px * 6, top + px * 6], [chestX - px * 8, top]], [px * 1.8, px * 1.8, px * 1.8], p.denimDark);
    pix.limb([[bibL + px * 3, bibTop], [chestX - px * 5, top + px * 6]], [px * 0.5, px * 0.5], p.denimLight);
    pix.rect(bibL, bibTop, px * 3, px * 3, p.metal);
    pix.rect(bibL, bibTop, px * 3, px, p.metalLight);
    // Tirante CAÍDO: suelto desde la otra esquina del peto, colgando por
    // delante de la barriga, con la hebilla abajo.
    const strapEnd = { x: bellyX + px * (17 + inflate * 6), y: waist + px * 8 };
    pix.limb([[bibR - px * 2, bibTop + px], [chestX + px * (16 + inflate * 4), bibTop + px * 8], [strapEnd.x, strapEnd.y]], [px * 1.8, px * 1.8, px * 1.8], p.denimDark);
    pix.rect(strapEnd.x - px * 2, strapEnd.y, px * 5, px * 4, p.metal);
    pix.rect(strapEnd.x - px, strapEnd.y + px, px * 3, px * 2, p.metalDark);
    pix.rect(strapEnd.x - px * 2, strapEnd.y, px * 5, px, p.metalLight);
    pix.rect(bibR - px * 3, bibTop, px * 3, px * 3, p.metal); // botón sin tirante
  }

  // ===========================================================================
  // CABEZA, en 3/4 mirando a la derecha
  // ===========================================================================
  const hx = w / 2 + 2 + pose.headOffX + lean * 1.1; // centro del cráneo
  const hy = 17 + pose.headOffY - (defiant ? 1 : 0);
  // Caja de la cabeza para lo que se pone encima (gorra, cadenas, bidón).
  const headX = hx - px * 11;
  const headY = hy - px * 12;
  const headW = px * 22;
  const headH = px * 24;

  // Cuello corto y ancho, en sombra bajo la barba.
  // Hasta el trapecio: con los hombros pegados al cuello ya no tapan su base,
  // y echando la cabeza atrás (el eructo) quedaba una fila de aire.
  pix.rect(hx - px * 7, hy + px * 7, px * 14, px * 11, p.skinShadow);
  pix.rect(hx - px * 5, hy + px * 7, px * 10, px * 6, p.skinDark);

  massEllipse(hx, hy, px * (11 + inflate * 1.5), px * 12.5, skin);

  // Barba PERFILADA: sigue la mandíbula por los dos lados y la barbilla, y
  // sube por las patillas hasta el pelo.
  // Con los mofletes hinchados (eructo) la barba se abomba por los lados.
  if (!awake) {
    pix.ellipse(hx + px, hy + px * 6, px * (11 + inflate * 2), px * 9, p.beard, { fromY: hy + px * 2 });
    pix.ellipse(hx + px * 2, hy + px * 7, px * 8, px * 6.5, p.beardLight, { fromY: hy + px * 6 });
    pix.rect(hx - px * 9, hy - px * 4, px * 3, px * 8, p.beard); // patilla visible
    pix.rect(hx + px * 9, hy - px * 3, px * 2, px * 6, p.beard); // patilla lejana
  } else {
    // AFEITADO: la mandíbula limpia, marcada solo por su sombra.
    pix.ellipse(hx + px, hy + px * 9, px * 9, px * 3, p.skinDark, { fromY: hy + px * 10 });
    pix.rect(hx - px * 2, hy + px * 11, px * 8, px, p.skinShadow);
  }
  // Mejillas limpias por encima de la línea de la barba (las dos).
  pix.ellipse(hx + px, hy + px * 1.5, px * 8, px * 3.5, p.skin);
  pix.rect(hx - px * 5, hy + px, px * 4, px, p.skinLight); // pómulo cercano
  pix.rect(hx + px * 5, hy + px, px * 3, px, p.skinLight); // pómulo lejano

  // Ojos verdes: el cercano más grande, el lejano más estrecho (3/4). Los
  // dos miran a la derecha, al rival.
  pix.rect(hx - px * 5, hy - px * 2, px * 5, px * 2, p.eyeWhite);
  pix.rect(hx - px * 2, hy - px * 2, px * 2, px * 2, p.iris);
  pix.rect(hx - px, hy - px * 2, px, px, p.outline);
  pix.rect(hx + px * 4, hy - px * 2, px * 4, px * 2, p.eyeWhite);
  pix.rect(hx + px * 6, hy - px * 2, px * 2, px * 2, p.iris);
  pix.rect(hx + px * 7, hy - px * 2, px, px, p.outline);
  pix.rect(hx - px * 5, hy, px * 5, px, p.skinDark); // párpados inferiores
  pix.rect(hx + px * 4, hy, px * 4, px, p.skinDark);
  // Cejas gruesas; la de delante levantada por fuera: la cara de pícaro.
  pix.rect(hx - px * 6, hy - px * 4, px * 6, px * 2, p.hairDark);
  pix.rect(hx + px * 4, hy - px * 4, px * 3, px * 2, p.hairDark);
  pix.rect(hx + px * 7, hy - px * 5, px * 3, px * 2, p.hairDark);

  // Nariz: puente entre los ojos y punta hacia delante, con aleta y sombra.
  pix.rect(hx + px * 1, hy - px * 2, px * 2, px * 4, p.skinLight);
  pix.rect(hx + px, hy + px, px * 4, px * 2, p.skin);
  pix.rect(hx + px * 3, hy + px, px * 2, px, p.skinLight);
  pix.rect(hx, hy + px * 3, px * 5, px, p.skinShadow);

  // Bigote y SONRISA: dientes a la vista y las dos comisuras hacia arriba.
  // Eructando (`mouthOpen`), la boca se abre en un óvalo oscuro.
  const mouthOpen = pose.mouthOpen || 0;
  if (!awake) pix.rect(hx - px * 3, hy + px * 4, px * 10, px * 2, p.beard);
  if (mouthOpen > 0.3) {
    pix.ellipse(hx + px * 2.5, hy + px * (7.5 + mouthOpen), px * (3 + mouthOpen * 1.5), px * (1.5 + mouthOpen * 1.8), p.mouth);
    pix.rect(hx, hy + px * 6, px * 5, px, p.teeth);
  } else {
    pix.rect(hx - px, hy + px * 6, px * 6, px, p.teeth);
    pix.rect(hx - px, hy + px * 7, px * 6, px, p.mouth);
    pix.rect(hx - px * 2, hy + px * 5, px, px * 2, p.mouth);
    pix.rect(hx + px * 5, hy + px * 5, px, px * 2, p.mouth);
    pix.rect(hx, hy + px * 8, px * 4, px, p.beardLight); // labio de abajo
  }

  // --- pelo: rizos con volumen y degradado corto en los lados ---------------
  // El degradado va por los lados y la nuca, pegado al cráneo. Cruzando la
  // frente se leía como una cinta y se comía la frente, que es la banda de
  // piel que separa el pelo de las cejas y hace que la cara se lea.
  // Despertado, la gorra RECOGE todo el pelo de arriba y de detrás: la mata
  // de rizos es más grande que la cúpula y asomaba por encima y por la nuca
  // (la gorra parecía un parche). Solo cuelgan rizos por DEBAJO (ver gorra).
  // Sin la gorra (`capOff`: la acaba de lanzar), vuelve la mata entera.
  const capped = awake && !((pose.capOff || 0) > 0.5);
  if (!capped) {
    pix.ellipse(hx - px * 6, hy - px * 5, px * 5, px * 6, p.hairDark, { toY: hy - px * 2 });
    pix.ellipse(hx, hy - px * 8, px * 11, px * 6, p.hair, { toY: hy - px * 6 });
    const curls = [
      [-10, -6], [-9, -10], [-5, -13], [0, -14], [5, -13], [9, -11], [11, -7],
      [-6, -9], [-1, -11], [4, -10], [8, -8],
    ];
    for (const [dx, dy] of curls) {
      const x = hx + px * dx;
      const y = hy + px * dy;
      pix.ellipse(x, y, px * 3, px * 2.6, p.hair);
      pix.rect(x - px, y - px * 2, px * 2, px, p.hairLight); // brillo del bucle
      pix.rect(x + px, y + px, px * 2, px, p.hairDark); // su sombra
    }
    // Flequillo rizado: bucles pequeños sobre la frente.
    pix.ellipse(hx + px * 5, hy - px * 6, px * 2.2, px * 1.8, p.hair);
    pix.ellipse(hx - px * 1, hy - px * 6, px * 2, px * 1.6, p.hair);
    pix.rect(hx + px * 5, hy - px * 5, px, px, p.hairDark);
  }

  // --- gorra y gafas del Despertar -----------------------------------------
  if (capped) {
    // Gorra HACIA ATRÁS (la del retrato): cúpula blanca con los paneles
    // azules, la visera asomando por la nuca y, en la frente, el hueco de
    // ajuste con la TIRA FUCSIA apoyada en la piel.
    pix.ellipse(hx, hy - px * 6, px * 12, px * 8, p.capShade, { toY: hy - px * 2 });
    pix.ellipse(hx + px, hy - px * 7, px * 10.5, px * 6.5, p.capWhite, { toY: hy - px * 3 });
    // Lo azul, a este tamaño, en una FRANJA por la base de la cúpula y el
    // botón de arriba: dos paneles laterales se leían como orejas.
    pix.rect(hx - px * 11, hy - px * 5, px * 22, px * 2, p.capBlue);
    pix.rect(hx - px, hy - px * 13, px * 3, px * 2, p.capBlue);
    pix.rect(hx - px * 20, hy - px * 5, px * 10, px * 3, p.capWhite); // visera atrás
    pix.rect(hx - px * 20, hy - px * 3, px * 10, px, p.capShade);
    // El hueco de ajuste deja ver la FRENTE (en sombra bajo la tela), no pelo,
    // y la tira cruza el hueco limpia, dos filas por encima de las gafas: a
    // la altura de la montura, el alambre la cortaba a trozos (y con la
    // barbilla alta del reposo desafiante, una fila no bastaba).
    pix.rect(hx, hy - px * 10, px * 10, px * 8, p.capShade); // costura del hueco
    pix.rect(hx + px, hy - px * 9, px * 8, px * 7, p.skinDark);
    pix.rect(hx, hy - px * 7, px * 10, px * 2, p.capStrap); // la tira fucsia
    pix.rect(hx, hy - px * 7, px * 10, px, p.strapLight);
    pix.rect(hx + px * 4, hy - px * 7, px * 2, px * 2, '#d8dde6'); // hebilla
    // Los rizos, solo por DEBAJO del borde de la gorra: en la nuca (detrás de
    // la oreja), la patilla delante de ella y un mechón en el lado lejano.
    const below = { fromY: hy - px * 2 };
    for (const [dx, dy, rx, ry] of [[-13, -1, 2.2, 1.8], [-13.5, 2, 1.8, 1.6], [-8, -1, 1.8, 1.6], [11, -1, 1.5, 1.4]]) {
      const x = hx + px * dx;
      const y = hy + px * dy;
      pix.ellipse(x, y, px * rx, px * ry, p.hair, below);
      pix.rect(x - px, Math.max(y - px, hy - px * 2), px, px, p.hairLight);
    }
    pix.rect(hx - px * 9, hy - px * 2, px * 2, px * 4, p.hair); // patilla
  }
  if (awake) {
    // Gafas de montura REDONDA de alambre fino: los ojos se ven detrás. En
    // 3/4 el cristal lejano es más estrecho.
    const wireRing = (ringX, ringY, rx, ry) => {
      for (let yy = Math.floor(ringY - ry - 1); yy <= ringY + ry + 1; yy += px) {
        for (let xx = Math.floor(ringX - rx - 1); xx <= ringX + rx + 1; xx += px) {
          const d = Math.hypot((xx + 0.5 - ringX) / rx, (yy + 0.5 - ringY) / ry);
          if (d >= 0.78 && d <= 1.18) pix.rect(xx, yy, px, px, p.wire);
        }
      }
    };
    wireRing(hx - px * 2.5, hy - px, px * 3.6, px * 3);
    wireRing(hx + px * 6, hy - px, px * 2.6, px * 3);
    pix.rect(hx + px, hy - px * 2, px * 3, px, p.wire); // puente
    pix.rect(hx - px * 9, hy - px * 2, px * 3, px, p.wire); // patilla
  }

  // --- oreja y ARO NEGRO, en el lado visible --------------------------------
  // El aro cuelga del lóbulo sobre un recorte de piel, para que el negro se
  // vea contra algo que no sea la barba (negro sobre castaño no se distingue).
  const earX = hx - px * 12;
  const earY = hy - px * 3;
  pix.rect(earX, earY, px * 4, px * 6, p.skinDark);
  pix.rect(earX + px, earY + px, px * 2, px * 3, p.skinShadow);
  pix.rect(earX, earY, px, px * 5, p.skinLight);
  pix.rect(earX, earY + px * 6, px * 4, px * 4, p.skin);
  const ringX = earX;
  const ringY = earY + px * 6;
  pix.rect(ringX, ringY, px * 4, px, p.outline);
  pix.rect(ringX, ringY + px * 4, px * 4, px, p.outline);
  pix.rect(ringX, ringY + px, px, px * 3, p.outline);
  pix.rect(ringX + px * 3, ringY + px, px, px * 3, p.outline);
  pix.rect(ringX + px, ringY + px, px * 2, px * 3, p.skin);
  pix.rect(ringX, ringY + px, px, px, p.metalLight); // destello

  // --- MODO RAPERO ---------------------------------------------------------
  // Durante la Ultimate, Samuel se transforma. Se dibuja ENCIMA de la cabeza
  // normal para que barba, nariz y boca sigan siendo las suyas.
  if ((pose.rapper || 0) > 0.05) {
    // `rapper` es un PROGRESO: la TOMA 1 de la cinemática lo sube de 0 a 1 y
    // cada prenda aparece en su tramo (gorra -> gafas -> cadenas).
    const look = Math.min(1, pose.rapper);
    const conGorra = look > 0.08;
    const conGafas = look > 0.42;
    const conCadenas = look > 0.72;

    // Gorra blanca HACIA ATRÁS: cúpula apoyada en el cráneo, visera por la
    // nuca y la cinta rosa fosforito de la foto.
    if (conGorra) {
      const capTop = headY - px * 3;
      const capH = headH * 0.3 + px * 4;
      pix.taper(headX - px, capTop, headW + px * 2, capH, p.cap, { top: px * 3, bottom: 0 });
      pix.rect(headX + px * 2, capTop + px, px * 6, px, '#ffffff');
      pix.rect(headX - px, capTop + capH - px, headW + px * 2, px, p.capShade);
      pix.taper(headX - px * 9, headY + px * 3, px * 9, px * 4, p.cap, { top: 0, bottom: px });
      pix.rect(headX - px * 9, headY + px * 6, px * 9, px, p.capShade);
      pix.rect(headX - px * 2, headY + px, px * 6, px * 3, p.capStrap);
      pix.rect(headX - px * 2, headY + px, px * 6, px, '#ff7ac0');
      pix.rect(headX + px, headY + px * 2, px * 2, px, '#ff7ac0');
    }

    // Gafas de sol de pasta sobre los dos ojos.
    if (conGafas) {
      const glassY = hy - px * 3;
      pix.rect(hx - px * 7, glassY, px * 17, px * 4, p.shades);
      pix.rect(hx - px * 5, glassY + px, px * 3, px, p.shadesGlint);
      pix.rect(hx + px * 5, glassY + px, px * 2, px, p.shadesGlint);
      pix.rect(hx - px * 11, glassY + px, px * 4, px, p.outline); // patilla
    }

    // Cadenas gruesas de oro: dos vueltas en V hechas con ESLABONES sueltos.
    const neckX = cx + px * 2;
    const neckY = hy + px * 14;
    const vueltas = conCadenas
      ? [{ w: 8, drop: 5, tone: p.gold }, { w: 5, drop: 9, tone: p.goldDark }].slice(0, look > 0.86 ? 2 : 1)
      : [];
    for (const vuelta of vueltas) {
      for (let i = -vuelta.w; i <= vuelta.w; i += 2) {
        const t = Math.abs(i) / vuelta.w;
        const lx = neckX + i * px;
        const ly = neckY + (1 - t * t) * px * vuelta.drop;
        pix.rect(lx, ly, px * 2, px * 2, vuelta.tone);
        if (i % 4 === 0) pix.rect(lx, ly, px, px, '#fff0b8');
      }
    }
    if (conCadenas) {
      pix.rect(neckX - px * 2, neckY + px * 10, px * 4, px * 4, p.gold);
      pix.rect(neckX - px, neckY + px * 11, px * 2, px, '#fff0b8');
      pix.rect(neckX - px * 2, neckY + px * 13, px * 4, px, p.goldDark);
    }
  }

  // --- cigarro: solo cuando fuma ------------------------------------------
  // En todas las poses tapaba la sonrisa; sale en las que echan humo (Pausa
  // del Cigarro, humo, eructo), en la comisura de delante.
  if ((pose.smokePuff || 0) > 0.05 && mouthOpen < 0.3) {
    pix.rect(hx + px * 5, hy + px * 6, px * 5, px * 2, p.smokeLight);
    pix.rect(hx + px * 10, hy + px * 6, px * 2, px * 2, p.ember);
    pix.rect(hx + px * 5, hy + px * 8, px * 4, px, p.smokeDark);
  }

  // ===========================================================================
  // BRAZO DE DELANTE: la última capa, por encima del torso, iluminado.
  // ===========================================================================
  const elbowFront = drawArm(shoulderFront, handFront, skin);
  if (awake) drawSleeve(shoulderFront, elbowFront, tee);
  const handX = handFront.x;
  const handY = handFront.y;

  // Jab: el puño extendido se agranda un poco y marca más los nudillos.
  if ((pose.fist || 0) > 0.5) {
    pix.rect(handX + px * 4, handY - px * 3, px, px * 6, p.skinLight);
    pix.rect(handX + px * 5, handY - px * 2, px, px * 4, p.outline);
  }

  // --- herramienta en la mano delantera ------------------------------------
  drawHeldTool(pix, { pose, palette: p, handX, handY: handY + px * 2 });

  // --- silla gamer, LO ÚLTIMO DE TODO --------------------------------------
  // Se agarra por la base con la mano delantera; por encima de todo, que en
  // el frame del golpe no la tape el cuerpo.
  if ((pose.chair || 0) > 0.5) drawGamerChair(pix, handX, handY + px * 2, pose.chairAngle ?? -Math.PI / 2, p);
}


const KITS = {
  rook: { draw: drawRook, palette: PALETTES.rook },
  vixen: { draw: drawVixen, palette: PALETTES.vixen },
  // `layered`: el kit pinta una capa de FONDO (el brazo de atrás) antes de la
  // pasada de contorno.
  mecanico: { draw: drawMecanico, palette: PALETTES.mecanico, layered: true },
};

export function getPalette(art, color) {
  return KITS[art]?.palette ?? buildDefaultPalette(color);
}

// Arco de ataque: la estela curva que acompaña a un golpe fuerte. Se dibuja
// como una tira de celdas a lo largo de un arco, no como una línea suavizada,
// para que siga leyéndose como pixel art.
function drawAttackArc(pix, { w, h, pose, palette }) {
  const strength = pose.arc || 0;
  if (strength <= 0.01) return;
  // Estos efectos se disenaron en bloques de 2px; con la densidad nueva se
  // fijan su propia unidad para conservar exactamente el mismo tamano.
  const u = pix.unit * 2;
  const cx = w * 0.5;
  const cy = h * (pose.arcY ?? 0.38);
  const radius = w * (0.52 + strength * 0.22);
  const spread = Math.PI * 0.55;
  const center = pose.arcAngle ?? 0;
  const steps = 11;

  for (let i = 0; i < steps; i += 1) {
    const t = i / (steps - 1);
    const angle = center - spread / 2 + spread * t;
    // Se desvanece por los extremos: el arco "entra y sale" del golpe.
    const fade = Math.sin(t * Math.PI);
    if (fade * strength < 0.25) continue;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    const thick = fade > 0.7 ? u * 2 : u;
    pix.rect(x, y, thick, thick, fade > 0.75 ? '#ffffff' : palette.accent);
  }
}

// Humo/sombra del teletransporte de Vixen: columnas de celdas que se
// deshacen hacia arriba. Solo aparece si la pose lo pide (`pose.smoke`).
function drawWarpSmoke(pix, { w, h, pose }) {
  const amount = pose.smoke || 0;
  if (amount <= 0.01) return;
  const u = pix.unit * 2;
  const puffs = 14;
  for (let i = 0; i < puffs; i += 1) {
    const t = i / puffs;
    const px = w * (0.15 + 0.7 * ((i * 7) % puffs) / puffs);
    const py = h * (0.9 - t * 0.85 * amount);
    const size = u * (t < 0.5 ? 2 : 1);
    const tone = i % 3 === 0 ? 'rgba(232, 82, 79, 0.75)' : 'rgba(24, 20, 38, 0.8)';
    pix.rect(px, py, size, size, tone);
  }
}

// Brillo de contorno: una línea de píxeles claros que recorre los dos flancos
// de la silueta, aditiva para que no tape la forma. La usan dos cosas con la
// misma mecánica y distinto significado, así que comparte código y solo
// cambia paleta y cobertura:
//   - `armorGlow` (Rook): azul, medio cuerpo. "Este golpe tiene armadura".
//   - `superGlow`: dorado/rojo, cuerpo entero y más intenso. Es el aviso de
//     que lo que está cargando es LA Ultimate, y por eso tiene que leerse
//     distinto de cualquier otro destello del juego.
function drawRimGlow(ctx, pix, { w, h, glow, tones, fromY, toY, intensity }) {
  if (glow <= 0.01) return;
  const u = pix.unit * 2;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = Math.min(1, glow) * intensity;
  const rows = Math.round((h * (toY - fromY)) / u);
  for (let i = 0; i < rows; i += 1) {
    const y = h * fromY + i * u;
    const wobble = Math.sin(i * 0.9 + glow * 6) * u;
    const tone = tones[i % tones.length];
    pix.rect(w * 0.22 + wobble, y, u, u, tone);
    pix.rect(w * 0.74 - wobble, y, u, u, tone);
  }
  ctx.restore();
}

// ESTELAS DE MOVIMIENTO (pose.trails, ver engine/keyedPoses.js): arcos o
// trazos semitransparentes que marcan la trayectoria del arma o del miembro
// durante el impacto, y con ella el ALCANCE del golpe. Pixel art: celdas de
// 1px en la rejilla y la transparencia en escalones de 0.2 (un degradado
// continuo delataría el render vectorial). El borde exterior va más opaco y
// más claro, y la estela se intensifica hacia el final del barrido: es lo que
// dice hacia dónde va el golpe.
function trailAlpha(a) {
  return Math.round(Math.max(0, Math.min(1, a)) * 5) / 5;
}

function drawTrails(pix, { pose }) {
  const trails = pose.trails;
  if (!trails?.length) return;
  const px = pix.unit;
  for (const tr of trails) {
    const strength = tr.alpha ?? 1;
    if (strength <= 0.05) continue;
    const half = (tr.w || 6) / 2;
    if (tr.type === 'streak') {
      const len = Math.hypot(tr.x1 - tr.x0, tr.y1 - tr.y0) || 1;
      const nx = -(tr.y1 - tr.y0) / len;
      const ny = (tr.x1 - tr.x0) / len;
      for (let d = 0; d <= len; d += px) {
        const u = d / len; // 0 cola -> 1 cabeza
        const width = half * (0.35 + 0.65 * u);
        for (let o = -width; o <= width; o += px) {
          const edge = Math.abs(o) > width - px * 1.5;
          const a = trailAlpha(strength * (edge ? 0.35 : 0.55) * (0.25 + 0.75 * u));
          if (a <= 0) continue;
          pix.rect(tr.x0 + (tr.x1 - tr.x0) * u + nx * o, tr.y0 + (tr.y1 - tr.y0) * u + ny * o, px, px,
            `rgba(255, 248, 230, ${a})`);
        }
      }
      continue;
    }
    if (tr.type === 'arc' || tr.type === 'ring') {
      const ring = tr.type === 'ring';
      const rx = ring ? tr.rx : tr.r;
      const ry = ring ? tr.ry : tr.r;
      const a0 = ring ? 0 : tr.a0;
      const a1 = ring ? Math.PI * 2 : tr.a1;
      const span = a1 - a0;
      const steps = Math.ceil(Math.abs(span) * Math.max(rx, ry) / px);
      const seen = new Set();
      for (let k = 0; k <= steps; k += 1) {
        const u = k / steps;
        const ang = a0 + span * u;
        // El anillo del giro "corre": su tramo brillante da la vuelta con la
        // fase, así se lee como rotación y no como un aro quieto.
        const lead = ring ? (0.5 + 0.5 * Math.cos(ang - strength * Math.PI * 4)) : u;
        for (let o = -half; o <= half; o += px) {
          const x = Math.round((tr.cx + Math.cos(ang) * (rx + o)) / px) * px;
          const y = Math.round((tr.cy + Math.sin(ang) * (ry + o * (ry / rx))) / px) * px;
          const key = x * 4096 + y;
          if (seen.has(key)) continue;
          seen.add(key);
          const rim = o > half - px * 2;
          const a = trailAlpha(strength * (rim ? 0.8 : 0.45) * (0.2 + 0.8 * lead));
          if (a <= 0) continue;
          pix.rect(x, y, px, px, rim ? `rgba(255, 255, 255, ${a})` : `rgba(255, 238, 200, ${a})`);
        }
      }
    }
  }
}

// Smear del frame de impacto: tres copias arrastradas del extremo del
// miembro que golpea, en la dirección del golpe y cada una más pequeña y más
// apagada. Es el recurso clásico de animación para que un golpe rápido no
// parezca teletransportarse entre dos frames — y aquí importa especialmente,
// porque las animaciones de ataque tienen 6-8 frames para cubrir 40.
//
// Se dibuja SOBRE la silueta y no se hornea aparte: es parte de la pose.
function drawSmear(pix, { w, h, pose, palette }) {
  const amount = pose.smear || 0;
  if (amount <= 0.01) return;
  const px = pix.unit;
  const angle = pose.smearAngle || 0;
  // Punto de partida: la punta del miembro que golpea, deducida del propio
  // desplazamiento de la pose (así vale igual para puño, codo o bota).
  const brazo = Math.abs(pose.armFrontOffX) > Math.abs(pose.legFrontOffX);
  const ox = w * 0.5 + (brazo ? pose.armFrontOffX : pose.legFrontOffX);
  const oy = h * (brazo ? 0.36 : 0.74) + (brazo ? pose.armFrontOffY : pose.legFrontOffY);
  const tones = [palette.skinLight || '#e8b98d', palette.skin || '#c98f61', palette.outline || '#17161c'];

  for (let i = 0; i < 3; i += 1) {
    const back = (i + 1) * px * 4 * amount;
    const sx = ox - Math.cos(angle) * back;
    const sy = oy - Math.sin(angle) * back;
    const size = px * (3 - i);
    pix.rect(sx, sy, size, size, tones[i]);
  }
}

function drawArmorGlow(ctx, pix, { w, h, pose }) {
  drawRimGlow(ctx, pix, {
    w, h, glow: pose.armorGlow || 0, tones: ['#9fd8ff'], fromY: 0.16, toY: 0.66, intensity: 0.85,
  });
  // Dorado con vetas rojas: alternar los dos tonos fila a fila es lo que da
  // el "oro caliente" sin salir de la rejilla de píxeles ni usar degradados.
  drawRimGlow(ctx, pix, {
    w,
    h,
    glow: pose.superGlow || 0,
    tones: ['#ffd24a', '#ffd24a', '#ff5a3c'],
    fromY: 0.05,
    toY: 0.95,
    intensity: 1,
  });
}

// Punto de entrada del rasterizador. `art` elige el body kit; `color` solo se
// usa para el kit genérico (Rook y Vixen traen paleta propia).
export function drawPixelFighter(ctx, {
  w, h, art = 'default', color = '#cccccc', pose, attackHighlight = false, outfit = 'normal',
}) {
  const kit = KITS[art];
  const palette = kit?.palette ?? buildDefaultPalette(color);
  const pix = makePix(ctx, PIXEL_UNIT);

  ctx.save();
  if (pose.alpha !== undefined && pose.alpha < 1) ctx.globalAlpha = Math.max(0, pose.alpha);

  drawWarpSmoke(pix, { w, h, pose });
  // El gas va DETRÁS del cuerpo (sale de él, no se le pega encima) y es
  // genérico como el humo de warp: cualquier kit que ponga `pose.gas` lo
  // tiene, aunque hoy solo lo use Samuel.
  drawGasCloud(pix, { w, h, pose, palette });
  drawDragSparks(pix, { w, h, pose, palette });
  drawSmokePuff(pix, { w, h, pose, palette });
  drawMusicNotes(pix, { w, h, pose, palette });

  // Cuerpo en DOS pasadas: primero todo inflado 1px en el color de contorno y
  // después el cuerpo real encima. El resultado es un contorno limpio de 1px
  // alrededor de la silueta completa (ver la nota de `pix.outline`), que es
  // lo que despega al personaje del fondo del callejón.
  const body = kit?.draw ?? drawDefaultFighter;
  const args = {
    w, h, pose, palette, outfit,
  };
  // Un kit por CAPAS pinta primero su capa de fondo (el brazo de atrás), con
  // su propia tinta: la pasada de contorno del cuerpo cae encima y lo separa.
  if (kit?.layered) body(pix, { ...args, layer: 'back' });
  pix.outline = palette.outline || '#12101a';
  body(pix, args);
  pix.outline = null;
  body(pix, args);

  drawTrails(pix, { pose });
  drawSmear(pix, { w, h, pose, palette });
  drawArmorGlow(ctx, pix, { w, h, pose });
  drawShockwave(pix, { w, h, pose, palette });
  // Micro y sangre van DELANTE del cuerpo: el micro se agarra con la mano y
  // la sangre sale de la cabeza hacia el espectador.
  drawMicrophone(pix, { w, h, pose, palette });
  drawEarBleed(pix, { w, h, pose, palette });
  if (attackHighlight) drawAttackArc(pix, { w, h, pose, palette });

  ctx.restore();
}
