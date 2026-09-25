// Tests del escenario: parallax de tres capas, suelo fijo y legibilidad.
//
//   node --test tests/
//
// Todo se mide sobre el RASTER real (ver tests/fakeCanvas.mjs), no sobre las
// llamadas de dibujo. Los tres modos de fallo que este archivo existe para
// cazar no dan ningun error por si solos:
//   - que una capa deje de ser determinista (host y cliente verian patios
//     distintos, y no hay forma de notarlo salvo comparando pantallas),
//   - que el suelo se mueva con la camara (las sombras de contacto y los
//     charcos dejarian de caer donde pisan los pies),
//   - que el fondo se acerque tanto al delineado de los cuerpos que las
//     figuras dejen de despegarse de el.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCanvas, installDom, luminanceAt, luminanceOf,
} from './fakeCanvas.mjs';

installDom();

const stageMod = await import('../public/src/engine/backdrop.js');
const courtyard = await import('../public/src/stages/highSchoolCourtyard.js');
const { LAYOUT } = courtyard;
const lighting = await import('../public/src/engine/lightingManager.js');
const {
  STAGE_WIDTH, STAGE_HEIGHT, GROUND_Y, CAMERA_MARGIN_X, CAMERA_MARGIN_TOP,
} = await import('../public/src/stages/courtyardFrame.js');

const {
  drawStageBackground, drawStageDim, getStageSeparationDim, getStageSafetyColor,
  setActiveStage, getActiveStage, getStageCanvas, LAYER_FACTORS, HORIZON_Y,
} = stageMod;

const GROUND_ANCHOR_Y = 260; // camera.js: el borde inferior de la vista
const MIN_ZOOM = 0.75;
const MAX_ZOOM = 1.1;

// El delineado claro que llevan los luchadores (characterRenderer.js). Por
// debajo de ~25 de diferencia de luminancia una figura deja de despegarse del
// fondo (guia, 3.6).
const RIM_COLOR = '#5a5f70';
const RIM_LUM = luminanceOf(RIM_COLOR);
const CONTRAST_FLOOR = 25;

/** Dibuja el escenario con la camara en un punto dado y devuelve el canvas. */
function shoot(cameraX, { zoom = MAX_ZOOM, dim = getStageSeparationDim() } = {}) {
  const canvas = createCanvas(STAGE_WIDTH, STAGE_HEIGHT);
  const ctx = canvas.getContext('2d');
  const camY = GROUND_ANCHOR_Y - STAGE_HEIGHT / (2 * zoom);
  ctx.save();
  ctx.translate(STAGE_WIDTH / 2, STAGE_HEIGHT / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-cameraX, -camY);
  drawStageBackground(ctx, cameraX);
  drawStageDim(ctx, dim);
  ctx.restore();
  return canvas;
}

/**
 * Dibuja el escenario SIN la transformacion de camara (el encuadre que usa
 * `renderSelect`). Es el marco en el que se puede exigir identidad pixel a
 * pixel: aqui lo unico que mueve algo es el parallax, asi que si la capa
 * frontal cambia es que se ha desplazado ella, no la camara.
 */
function shootFlat(cameraX) {
  const canvas = createCanvas(STAGE_WIDTH, STAGE_HEIGHT);
  drawStageBackground(canvas.getContext('2d'), cameraX);
  return canvas;
}

/** Fila de pixeles (solo RGB) para comparar franjas entre dos capturas. */
function row(canvas, y) {
  const out = [];
  for (let x = 0; x < canvas.width; x += 1) {
    const [r, g, b] = canvas.pixel(x, y);
    out.push(Math.round(r), Math.round(g), Math.round(b));
  }
  return out;
}

function bandsEqual(a, b, y0, y1) {
  for (let y = y0; y < y1; y += 1) {
    if (row(a, y).join(',') !== row(b, y).join(',')) return y;
  }
  return -1;
}

test('el horneado es determinista: la misma semilla da el mismo patio', () => {
  const a = shoot(STAGE_WIDTH / 2);
  setActiveStage(courtyard.highSchoolCourtyard); // tira la cache y vuelve a hornear
  const b = shoot(STAGE_WIDTH / 2);
  const diff = bandsEqual(a, b, 0, STAGE_HEIGHT);
  assert.equal(diff, -1, `el rehorneado cambio la fila ${diff}: el fondo no es determinista`);
});

test('las tres capas se desplazan con su factor exacto y solo ellas', () => {
  // Se instrumenta el blit: cada capa tiene que salir desplazada (1 - factor)
  // sobre el recorrido de la camara, ni mas ni menos.
  const calls = [];
  const spy = {
    drawImage(img, dx) { calls.push({ w: img.width, dx }); },
  };
  const desvio = 120;
  drawStageBackground(spy, STAGE_WIDTH / 2 + desvio);
  assert.equal(calls.length, 3, 'tienen que ser TRES capas, no una');

  // Los factores se comprueban contra los numeros LITERALES del diseno, no
  // contra LAYER_FACTORS. Derivar lo esperado de la misma constante que se
  // quiere proteger hace el test tautologico: verificado mutando la capa
  // media a 1.0 (parallax desactivado) y viendo pasar la suite entera.
  assert.deepEqual(LAYER_FACTORS, { far: 0.15, mid: 0.45, front: 1 });

  const base = -CAMERA_MARGIN_X;
  const slack = (w) => (w - (STAGE_WIDTH + CAMERA_MARGIN_X * 2)) / 2;
  const got = calls.map((c) => c.dx - (base - slack(c.w)));
  const want = [desvio * 0.85, desvio * 0.55, 0];
  for (let i = 0; i < 3; i += 1) {
    assert.ok(
      Math.abs(got[i] - want[i]) < 1e-9,
      `capa ${i}: desplazamiento ${got[i]} en vez de ${want[i]}`,
    );
  }
  // La capa frontal es la arena: no se corrige NUNCA, o el suelo dejaria de
  // cuadrar con las coordenadas de mundo de los luchadores.
  assert.equal(got[2], 0);
});

test('al mover la camara el fondo cambia y el asfalto NO cambia ni un pixel', () => {
  const a = shootFlat(STAGE_WIDTH / 2);
  const b = shootFlat(STAGE_WIDTH / 2 + 120);

  // La franja alta (cielo, nubes, pabellon, arboleda) TIENE que moverse: si no
  // hay diferencia, el parallax no esta haciendo nada y son tres canvas
  // apilados que igual podrian ser uno.
  const skyDiff = bandsEqual(a, b, 20, 120);
  assert.notEqual(skyDiff, -1, 'la franja alta no cambio: el parallax no esta haciendo nada');

  // Y la del asfalto NO puede moverse ni un pixel: la capa frontal va pegada a
  // las coordenadas de mundo. Si se desplazara, el suelo se deslizaria bajo
  // los pies de los luchadores en cuanto la camara panease.
  const groundDiff = bandsEqual(a, b, GROUND_Y, STAGE_HEIGHT);
  assert.equal(
    groundDiff, -1,
    `el asfalto se desplazo con la camara (fila ${groundDiff}): la capa frontal no puede llevar parallax`,
  );
});

test('la linea de suelo se queda matematicamente fija en GROUND_Y', () => {
  // El horizonte se DERIVA de GROUND_Y, no es un numero suelto.
  assert.equal(HORIZON_Y, GROUND_Y - 5);
  assert.equal(courtyard.HORIZON_Y, HORIZON_Y);

  // En pantalla, el suelo tiene que caer en la MISMA fila pase lo que pase con
  // el paneo horizontal: si se moviera, las sombras de contacto y los charcos
  // persistentes dejarian de caer donde pisan los pies.
  const zoom = MAX_ZOOM;
  const camY = GROUND_ANCHOR_Y - STAGE_HEIGHT / (2 * zoom);
  const groundRow = Math.round((GROUND_Y - camY) * zoom + STAGE_HEIGHT / 2);

  const reference = shootFlat(STAGE_WIDTH / 2);
  for (const cameraX of [60, 160, STAGE_WIDTH / 2, 320, 420]) {
    // 1) El plano del suelo es el MISMO arte pase lo que pase con el paneo:
    //    ni una fila por debajo del horizonte puede cambiar.
    const flat = shootFlat(cameraX);
    const moved = bandsEqual(reference, flat, HORIZON_Y, STAGE_HEIGHT);
    assert.equal(moved, -1, `el plano del suelo cambio en la fila ${moved} con cameraX=${cameraX}`);

    // 2) Y bajo la camara real cae en la fila que dice la aritmetica, con
    //    TODAS las columnas cubiertas: ahi es donde se dibujan las sombras de
    //    contacto y los charcos persistentes.
    const shot = shoot(cameraX, { zoom });
    for (let x = 0; x < STAGE_WIDTH; x += 7) {
      const [, , , alpha] = shot.pixel(x, groundRow + 6);
      assert.equal(alpha, 1, `hueco en el suelo en x=${x} con cameraX=${cameraX}`);
    }
  }
  assert.ok(groundRow > 0 && groundRow < STAGE_HEIGHT, 'GROUND_Y se salio del encuadre');
});

test('edificio y pista son UNA sola ilustracion: no se desincronizan al panear', () => {
  // EL REQUISITO CENTRAL. El polideportivo y la pista que tiene delante viven
  // en la MISMA capa (factor 1.0), asi que la camara los mueve y los escala
  // juntos. Si el edificio llevara parallax, su base se deslizaria sobre la
  // pista al panear y el luchador dejaria de estar plantado en el suelo que la
  // sostiene, que es el efecto de maqueta que habia que quitar.
  //
  // Se comprueba sin ambiguedad: con la camara en dos sitios distintos, la
  // PISTA ENTERA y el RECTANGULO DEL EDIFICIO tienen que dar exactamente los
  // mismos pixeles.
  const a = shootFlat(STAGE_WIDTH / 2);
  const b = shootFlat(STAGE_WIDTH / 2 + 130);

  const floor = bandsEqual(a, b, LAYOUT.wallBaseY, STAGE_HEIGHT);
  assert.equal(floor, -1, `la pista cambia al panear (fila ${floor}): lleva parallax`);

  // Son DOS cuerpos con dos alturas distintas, asi que se comprueban por
  // separado: el rectangulo del cuerpo bajo empieza en SU tejado, no en el de
  // la nave. Comprobando un unico rectangulo, la esquina superior izquierda
  // cae sobre cielo y arboles —que SI se mueven, y deben— y el test fallaba
  // por una razon que no era la suya.
  const cuerpos = [
    { x0: LAYOUT.annexLeft, x1: LAYOUT.annexRight, y0: LAYOUT.annexRoofY },
    { x0: LAYOUT.hallLeft, x1: LAYOUT.hallRight, y0: LAYOUT.hallRoofY },
  ];
  for (const c of cuerpos) {
    for (let y = c.y0; y < LAYOUT.wallBaseY; y += 1) {
      for (let x = c.x0; x < c.x1; x += 1) {
        const pa = a.pixel(x, y);
        const pb = b.pixel(x, y);
        assert.ok(
          Math.round(pa[0]) === Math.round(pb[0]) && Math.round(pa[1]) === Math.round(pb[1]),
          `el edificio cambia en (${x}, ${y}) al panear: no comparte capa con la pista`,
        );
      }
    }
  }

  // Y FUERA del edificio, por debajo de su linea de tejado, SI tiene que haber
  // movimiento: es la arboleda del patio, que esta de verdad mas lejos. Sin
  // esto el test pasaria igual con una pared infinita, que es justo lo que no
  // se quiere.
  let moved = 0;
  for (let y = LAYOUT.hallRoofY; y < LAYOUT.wallBaseY; y += 1) {
    for (let x = 0; x < LAYOUT.buildingLeft - 4; x += 1) {
      if (Math.round(a.pixel(x, y)[0]) !== Math.round(b.pixel(x, y)[0])) moved += 1;
    }
  }
  assert.ok(moved > 200, `solo ${moved} pixeles se mueven junto al edificio: no hay patio detras, hay pared`);
});

test('el muro llega al suelo sin un hueco y sin nada horizontal entre medias', () => {
  // La base del muro esta a cinco pixeles de donde pisan los luchadores. Lo que
  // no puede haber es ni una fila vacia en la union (por ahi se veria el frame
  // anterior) ni una franja horizontal metida entre el muro y los pies: a esa
  // distancia deja de leerse como fondo y pasa a ser el canto de una
  // plataforma. Por eso el muro y la pista se comprueban como un continuo.
  const front = getStageCanvas();
  assert.equal(LAYOUT.wallBaseY, GROUND_Y - 5);

  // La fachada, de tejado a suelo, sin un hueco... (solo en su vano: fuera de
  // el la capa frontal es transparente a proposito, para que se vea el patio)
  for (let y = LAYOUT.hallRoofY; y < LAYOUT.wallBaseY; y += 1) {
    for (let x = LAYOUT.hallLeft + 4; x < LAYOUT.hallRight - 4; x += 7) {
      assert.equal(front.pixel(x + CAMERA_MARGIN_X, y + CAMERA_MARGIN_TOP)[3], 1,
        `hueco en la fachada en (${x}, ${y})`);
    }
  }
  // ...y la pista, en TODO el ancho horneado: un hueco ahi es un agujero por el
  // que se ve el frame anterior (la estela de la seccion 6).
  for (let y = LAYOUT.wallBaseY; y < STAGE_HEIGHT; y += 1) {
    for (let x = -CAMERA_MARGIN_X; x < STAGE_WIDTH + CAMERA_MARGIN_X; x += 7) {
      assert.equal(front.pixel(x + CAMERA_MARGIN_X, y + CAMERA_MARGIN_TOP)[3], 1,
        `hueco en la pista en (${x}, ${y})`);
    }
  }

  // La sombra que el muro proyecta sobre la pista es lo que suelda los dos
  // planos, y tiene que APAGARSE hacia camara: una sombra que no se apaga es
  // una banda gris de canto duro, o sea un bordillo con otro nombre.
  const rowMean = (y) => {
    let sum = 0;
    let n = 0;
    for (let x = 60; x < STAGE_WIDTH - 60; x += 1) {
      const [r, g, b] = front.pixel(x + CAMERA_MARGIN_X, y + CAMERA_MARGIN_TOP);
      sum += 0.299 * r + 0.587 * g + 0.114 * b;
      n += 1;
    }
    return sum / n;
  };
  //
  // Tres medidas, y las tres hacen falta. "Cada escalon mas claro que el
  // anterior" NO basta: el grano del hormigon mete ruido de un par de puntos,
  // asi que una sombra plana con un escalon repetido pasaba igual (verificado
  // mutandola). Lo que distingue una sombra de un bordillo es que se APAGA y
  // que no termina en canto: medido, la sombra actual aclara 28.6 de
  // luminancia y muere con un salto final de 3.5, mientras que la misma banda
  // sin degradar da -4.4 y un canto de 38.5.
  const shadowTop = rowMean(LAYOUT.wallBaseY + 1);
  const shadowEnd = rowMean(LAYOUT.wallBaseY + 11);
  assert.ok(
    shadowEnd - shadowTop > 15,
    `la sombra del muro no se apaga (${(shadowEnd - shadowTop).toFixed(1)} de recorrido): `
    + 'una banda oscura que no se degrada es un bordillo con otro nombre',
  );
  const hardEdge = rowMean(LAYOUT.wallBaseY + 15) - rowMean(LAYOUT.wallBaseY + 13);
  assert.ok(
    Math.abs(hardEdge) < 12,
    `la sombra termina en un canto de ${hardEdge.toFixed(1)}: eso se lee como un escalon`,
  );
  let prev = -Infinity;
  for (let i = 0; i < 6; i += 1) {
    const L = rowMean(LAYOUT.wallBaseY + 1 + i * 2);
    assert.ok(L > prev - 1, `la sombra del muro se OSCURECE en el escalon ${i} (${L.toFixed(1)})`);
    prev = L;
  }

  // NADA CRUZA EL PIE DEL MURO. La valla horizontal que hubo aqui es hoy
  // invisible para las demas aserciones —el muro llega al suelo, asi que ya no
  // deja un hueco ni cambia el perfil de luminancia—, y aun asi es justo lo
  // que el usuario pidio quitar. Lo que SI la delata es su firma: una reja es
  // un patron vertical repetido, o sea muchisimas transiciones de contraste a
  // lo ancho. Medido en la banda de 16px sobre la base del muro: 282 con el
  // muro limpio, 2248 con la reja puesta.
  const verticalEdges = (y) => {
    let n = 0;
    let previous = null;
    for (let x = LAYOUT.hallLeft; x < LAYOUT.hallRight; x += 1) {
      const [r, g, b] = front.pixel(x + CAMERA_MARGIN_X, y + CAMERA_MARGIN_TOP);
      const L = 0.299 * r + 0.587 * g + 0.114 * b;
      if (previous !== null && Math.abs(L - previous) > 14) n += 1;
      previous = L;
    }
    return n;
  };
  let edges = 0;
  for (let y = LAYOUT.wallBaseY - 17; y < LAYOUT.wallBaseY - 1; y += 1) edges += verticalEdges(y);
  assert.ok(
    edges < 800,
    `${edges} transiciones verticales al pie del muro: eso es una reja cruzando por `
    + 'detras de los pies de los luchadores',
  );
});

test('la pista es un plano solido, plano y sin lineas oscuras', () => {
  const front = getStageCanvas();
  const rowMean = (y) => {
    let sum = 0;
    let n = 0;
    for (let x = 60; x < STAGE_WIDTH - 60; x += 1) {
      const [r, g, b] = front.pixel(x + CAMERA_MARGIN_X, y + CAMERA_MARGIN_TOP);
      sum += 0.299 * r + 0.587 * g + 0.114 * b;
      n += 1;
    }
    return sum / n;
  };
  // Por debajo de la sombra del muro, ninguna fila puede ser mas OSCURA que el
  // hormigon. El signo es el discriminante, y hubo que medirlo: un escalon a
  // secas no vale porque las lineas PINTADAS tambien saltan de fila a fila
  // (15.2 al entrar y salir de la linea de fondo) y son contenido legitimo. Lo
  // que no puede haber es una fila oscura cruzando la pista: un bordillo, un
  // murete o el travesano de una valla.
  const means = [];
  for (let y = LAYOUT.wallBaseY + 16; y < STAGE_HEIGHT; y += 1) means.push({ y, L: rowMean(y) });
  const median = [...means].sort((x, y) => x.L - y.L)[Math.floor(means.length / 2)].L;
  const darkest = means.reduce((x, y) => (y.L < x.L ? y : x));
  assert.ok(
    median - darkest.L < 16,
    `la fila ${darkest.y} esta ${(median - darkest.L).toFixed(1)} por debajo del hormigon: `
    + 'eso es una linea oscura cruzando la pista',
  );

  // Y la pista va PLANA: es el suelo pegado al muro, no una plaza vista desde
  // arriba. Con bandas marcadas de perspectiva, los 65px que la camara deja ver
  // por debajo de los pies se leian como una plataforma descolgada.
  //
  // Se mide por PERCENTILES, no por maximo y minimo. El recorrido total lo
  // dominan las pocas filas de LINEAS PINTADAS (llegan a 217 sobre un hormigon
  // de 189), que son contenido legitimo; lo que hay que medir es el hormigon.
  // Medido asi, el suelo actual tiene 6.5 de recorrido entre el percentil 10 y
  // el 90 — el umbral deja mas del doble de margen.
  const sorted = means.map((m) => m.L).sort((x, y) => x - y);
  const pct = (q) => sorted[Math.floor((sorted.length - 1) * q)];
  const spread = pct(0.9) - pct(0.1);
  assert.ok(spread < 14, `el hormigon tiene ${spread.toFixed(1)} de recorrido de luminancia: demasiado contraste para una franja de suelo`);
});

test('el edificio es un BLOQUE con esquinas, no un muro infinito', () => {
  // Una fachada que cruza la pantalla de punta a punta no se lee como un
  // polideportivo: se lee como un pasillo cerrado, y encima delata el truco
  // porque el ojo reconoce el patron periodico de ventanas antes que el
  // edificio. El de la foto tiene dos cuerpos y dos esquinas.
  const front = getStageCanvas();
  const at = (x, y) => front.pixel(x + CAMERA_MARGIN_X, y + CAMERA_MARGIN_TOP)[3];
  const chestY = GROUND_Y - 60;

  // Macizo de esquina a esquina...
  for (let x = LAYOUT.buildingLeft + 4; x < LAYOUT.buildingRight - 4; x += 5) {
    assert.equal(at(x, chestY), 1, `hueco en la fachada en x=${x}`);
  }
  // ...y patio abierto JUSTO al otro lado de cada esquina. Esta es la
  // asercion que un muro infinito no puede pasar.
  assert.equal(at(LAYOUT.buildingLeft - 12, chestY), 0, 'no hay patio a la izquierda del edificio');
  assert.equal(at(LAYOUT.buildingRight + 12, chestY), 0, 'no hay patio a la derecha del edificio');

  const bakedWidth = STAGE_WIDTH + CAMERA_MARGIN_X * 2;
  const span = (LAYOUT.buildingRight - LAYOUT.buildingLeft) / bakedWidth;
  assert.ok(span > 0.35 && span < 0.75, `el edificio ocupa el ${(span * 100).toFixed(0)}% del ancho horneado`);
});

test('la nave guarda las proporciones del pabellon real (plano general)', () => {
  // PLANO GENERAL, ni maqueta ni macro. Los dos extremos se han visto y los dos
  // se leen mal: con el pabellon metido en una caja de 240px la fachada entera
  // era mas baja que un luchador, y al corregirlo se fue a figuras de mural de
  // 68px de las que solo cabian cuatro. Lo que sostiene el plano general son
  // las proporciones del edificio real.
  assert.ok(LAYOUT.blueBandH >= 30 && LAYOUT.blueBandH <= 38, `franja azul ${LAYOUT.blueBandH}px`);
  assert.ok(LAYOUT.windowBandH >= 30 && LAYOUT.windowBandH <= 38, `ventanal ${LAYOUT.windowBandH}px`);
  assert.ok(LAYOUT.whiteBandH >= 78, `pano blanco ${LAYOUT.whiteBandH}px: el edificio queda achatado`);

  // Las cuatro franjas SUMAN la altura de la nave: si no, hay una pieza
  // dibujada encima de otra. Ya paso — el mural acababa pintado dentro del
  // ventanal y, como se pinta el ultimo, se tragaba ademas la puerta.
  const stack = LAYOUT.blueBandH + LAYOUT.windowBandH + LAYOUT.whiteBandH + LAYOUT.plinthH;
  assert.equal(stack, LAYOUT.wallBaseY - LAYOUT.hallRoofY, 'las franjas de la nave no suman su altura');
  assert.equal(stack, LAYOUT.hallHeight, 'la altura declarada de la nave no es la suma de sus franjas');
  assert.ok(LAYOUT.muralY + LAYOUT.muralH <= LAYOUT.plinthY + 1, 'el mural se mete en el zocalo');
  assert.ok(LAYOUT.muralY >= LAYOUT.whiteBandY, 'el mural se sale del pano blanco por arriba');

  // El cuerpo bajo tiene que ser MAS BAJO que la nave, o no hay dos cuerpos.
  assert.ok(LAYOUT.annexRoofY > LAYOUT.hallRoofY + 30, 'el cuerpo bajo no se distingue de la nave');

  // EL PABELLON TIENE QUE DOMINAR AL LUCHADOR. Es la propiedad que introdujo el
  // reescalado y la que se pierde sin hacer ruido: con la nave a 125px —lo que
  // medía antes— la fachada entera era 1.16 cuerpos y el escenario se leia como
  // una maqueta baja detras de dos muñecos. El tope de arriba tambien hace
  // falta: un edificio que crece sin parar deja de caber en el encuadre.
  const vsBody = LAYOUT.hallHeight / LAYOUT.bodyHeight;
  assert.ok(
    vsBody > 1.45 && vsBody < 1.75,
    `la nave mide ${vsBody.toFixed(2)} cuerpos de luchador (se buscan 1.45-1.75)`,
  );
});

test('la linea de tejado cae en el tercio alto del encuadre ancho', () => {
  // EL PLANO QUE HAY QUE COMPONER ES EL DEL ZOOM OUT. Es donde se ve el
  // escenario entero, y es el encuadre en el que se noto que el pabellon
  // parecia una maqueta: a MAX_ZOOM la camara esta tan cerca que la fachada
  // llena la pantalla pase lo que pase, asi que medir ahi no distingue un
  // edificio alto de uno bajo.
  //
  // La medida es en PANTALLA, no en mundo, porque lo que falla o funciona es
  // la proporcion de cuadro que ocupa el cielo. Falla en las dos direcciones:
  // por debajo del 26% el edificio asfixia el encuadre, por encima del 45% la
  // fachada se hunde en el horizonte y vuelve a ser una maqueta (con la nave
  // anterior, de 125px, daba el 47%).
  const camY = GROUND_ANCHOR_Y - STAGE_HEIGHT / (2 * MIN_ZOOM);
  const roofScreenY = STAGE_HEIGHT / 2 + (LAYOUT.hallRoofY - camY) * MIN_ZOOM;
  const share = roofScreenY / STAGE_HEIGHT;
  assert.ok(
    share > 0.26 && share < 0.45,
    `la linea de tejado cae al ${(share * 100).toFixed(0)}% del alto de pantalla `
    + 'en el encuadre ancho (se busca 26-45%)',
  );

  // Y por encima del tejado tiene que haber CIELO de verdad, no mas edificio:
  // la capa frontal esta vacia ahi. Sin esto, la comprobacion de arriba la
  // pasaria igual un edificio que siguiera creciendo por dentro del atlas.
  const front = getStageCanvas();
  for (let x = LAYOUT.hallLeft + 8; x < LAYOUT.hallRight - 8; x += 11) {
    const y = LAYOUT.hallRoofY - 10;
    assert.equal(
      front.pixel(x + CAMERA_MARGIN_X, y + CAMERA_MARGIN_TOP)[3], 0,
      `hay edificio 10px por encima de la linea de tejado en x=${x}`,
    );
  }
});

test('el mural es una TIRA de figuras a la altura de la cadera', () => {
  const body = LAYOUT.bodyHeight;
  // EL MURAL CRECE CON EL EDIFICIO. A 26px las siluetas le quedaban a Samuel
  // por debajo de la rodilla y el mural se leia como un friso de pictogramas;
  // a 68 eran mas altas que su cintura y parecian monstruos. 36px sobre los
  // 108 de un cuerpo es un mural de tamano natural pintado sobre el zocalo.
  assert.ok(
    LAYOUT.muralFigureHeight >= 34 && LAYOUT.muralFigureHeight <= 38,
    `las figuras miden ${LAYOUT.muralFigureHeight}px (se buscan 34-38)`,
  );
  const ratio = LAYOUT.muralFigureHeight / body;
  assert.ok(ratio > 0.30 && ratio < 0.38, `las figuras son el ${(ratio * 100).toFixed(0)}% de un cuerpo`);

  // Y LA FRANJA LE TIENE QUE LLEGAR POR LA CADERA. Es lo que se pidio y no es
  // lo mismo que el alto de la figura: el mural se apoya en el zocalo, asi que
  // lo que decide hasta donde sube es zocalo + panel. Antes del reescalado
  // subia 45px sobre el suelo, o sea el 42% de un cuerpo: el muslo.
  const muralTopAboveGround = GROUND_Y - LAYOUT.muralY;
  const hip = muralTopAboveGround / body;
  assert.ok(
    hip > 0.45 && hip < 0.62,
    `el mural sube ${muralTopAboveGround}px sobre el suelo, el ${(hip * 100).toFixed(0)}% `
    + 'de un cuerpo (se busca la cadera, 45-62%)',
  );

  // LA VARA DE MEDIR DEL MURAL ES LA PUERTA, NO EL LUCHADOR. La escala del
  // edificio es distinta de la del personaje a proposito (~19px/m frente a
  // ~60), asi que lo unico que tiene que cuadrar es el edificio CONSIGO MISMO:
  // una persona pintada no puede ser mas alta que una puerta de verdad. Ese es
  // exactamente el fallo que producia los "monstruos".
  const vsDoor = LAYOUT.muralFigureHeight / LAYOUT.stairDoorH;
  assert.ok(
    vsDoor > 0.7 && vsDoor < 1,
    `las figuras del mural miden ${vsDoor.toFixed(2)} puertas de la planta alta`,
  );

  // Y son MUCHAS: una tira corrida de deportes, no cuatro muñecos sueltos.
  assert.ok(
    LAYOUT.muralFigureCount >= 8 && LAYOUT.muralFigureCount <= 12,
    `${LAYOUT.muralFigureCount} figuras en el mural (se buscan 8-12)`,
  );
  // Todas distintas: un mural con la misma postura repetida no es una tira de
  // deportes, es un patron, y una linea copiada y pegada en la tabla de
  // patrones no daria ningun error.
  const poses = new Set(courtyard.ATHLETE_POSES.map((fig) => fig.join('')));
  assert.equal(poses.size, LAYOUT.muralFigureCount, 'hay posturas repetidas en el mural');

  // La medida declarada tiene que ser la PINTADA, no la de la rejilla.
  const front = getStageCanvas();
  let top = Infinity;
  let bottom = -Infinity;
  let inkColumns = 0;
  for (let x = LAYOUT.muralX0 - 4; x < LAYOUT.muralX1 + 4; x += 1) {
    let hasInk = false;
    for (let y = LAYOUT.whiteBandY; y < LAYOUT.plinthY; y += 1) {
      const [r, g, b, alpha] = front.pixel(x + CAMERA_MARGIN_X, y + CAMERA_MARGIN_TOP);
      // OJO: `alpha > 0`. Un pixel transparente se lee (0,0,0,0), o sea que
      // pasa por negro y cuenta como silueta — con eso, el mural parecia
      // extenderse por el 100% del ancho horneado.
      if (alpha > 0 && r < 40 && g < 45 && b < 50) { // la silueta negra del mural
        hasInk = true;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
    if (hasInk) inkColumns += 1;
  }
  assert.equal(bottom - top + 1, LAYOUT.muralFigureHeight, 'lo pintado no coincide con la medida declarada');
  // La tira tiene que ser CORRIDA: si las siluetas solo ocupasen un par de
  // tramos, serian cuatro muñecos grandes otra vez.
  assert.ok(inkColumns > 90, `solo ${inkColumns} columnas con silueta: el mural no es una tira corrida`);

  // Y TIENE QUE SER UNA SOLA TIRA, no un patron repetido de punta a punta. Esto
  // es lo que cazaria la version en la que el mural se repetia por todo el
  // ancho horneado: entonces las siluetas se extendian por 800px en vez de por
  // un tramo compacto de la fachada.
  let inkLeft = Infinity;
  let inkRight = -Infinity;
  for (let x = -CAMERA_MARGIN_X; x < STAGE_WIDTH + CAMERA_MARGIN_X; x += 1) {
    for (let y = LAYOUT.whiteBandY; y < LAYOUT.plinthY; y += 1) {
      const [r, g, b, alpha] = front.pixel(x + CAMERA_MARGIN_X, y + CAMERA_MARGIN_TOP);
      if (alpha > 0 && r < 40 && g < 45 && b < 50) {
        if (x < inkLeft) inkLeft = x;
        if (x > inkRight) inkRight = x;
        break;
      }
    }
  }
  const bakedWidth = STAGE_WIDTH + CAMERA_MARGIN_X * 2;
  const strip = (inkRight - inkLeft + 1) / bakedWidth;
  assert.ok(
    strip < 0.4,
    `las siluetas se extienden por el ${(strip * 100).toFixed(0)}% del ancho horneado: `
    + 'el mural se ha vuelto un patron repetido en vez de una franja compacta',
  );
  assert.ok(inkLeft > LAYOUT.stairX, 'el mural tiene que quedar a la DERECHA de la escalera');
});

test('el atlas cubre el peor encuadre posible sin dejar un pixel vacio', () => {
  // La estela pegada al fondo al saltar alto salia de aqui: el zoom out sube
  // el encuadre y revela mundo con y < 0. Se prueba el caso limite (zoom
  // minimo + desvio maximo a los dos lados).
  const maxDesvio = CAMERA_MARGIN_X - STAGE_WIDTH / (2 * MIN_ZOOM) + STAGE_WIDTH / 2;
  for (const cameraX of [
    STAGE_WIDTH / 2 - maxDesvio, STAGE_WIDTH / 2, STAGE_WIDTH / 2 + maxDesvio,
  ]) {
    const shot = shoot(cameraX, { zoom: MIN_ZOOM });
    let empty = 0;
    for (let y = 0; y < STAGE_HEIGHT; y += 1) {
      for (let x = 0; x < STAGE_WIDTH; x += 1) if (shot.pixel(x, y)[3] < 1) empty += 1;
    }
    assert.equal(empty, 0, `${empty} pixeles sin cubrir con cameraX=${cameraX} y zoom ${MIN_ZOOM}`);
  }
  // Y el margen vertical horneado sigue cubriendo lo que revela el zoom out.
  assert.ok(
    CAMERA_MARGIN_TOP >= GROUND_ANCHOR_Y - STAGE_HEIGHT / MIN_ZOOM,
    'CAMERA_MARGIN_TOP se ha quedado corto para MIN_ZOOM',
  );
});

test('el fondo deja despegarse a los luchadores (contraste del rimlight)', () => {
  const shot = shoot(STAGE_WIDTH / 2);
  // SE MIDE POR PERCENTILES, NO POR LA MEDIA, y la diferencia importa. Con el
  // muro del gimnasio detras, el fondo de la banda donde pelean los luchadores
  // es BIMODAL: franja azul y zocalo por un lado (lum ~65) y muro blanco por
  // otro (~234). La media de eso cae en ~116, justo encima del rimlight
  // #5a5f70 (95), y el test daba por ilegible un fondo en el que la figura se
  // recorta perfectamente contra las dos mitades. Una media solo describe un
  // fondo uniforme; lo que hay que exigir es que POCO fondo se parezca al
  // delineado.
  //
  // Medido con el velo actual: el 10% peor del fondo esta ya a 32.7 de
  // luminancia del rimlight, y solo el 8.9% cae dentro del margen de
  // confusion de 25.
  const diffs = [];
  let peak = 0;
  for (let y = GROUND_Y - LAYOUT.bodyHeight; y < GROUND_Y; y += 1) {
    for (let x = 40; x < STAGE_WIDTH - 40; x += 1) {
      const L = luminanceAt(shot, x, y);
      diffs.push(Math.abs(L - RIM_LUM));
      if (L > peak) peak = L;
    }
  }
  diffs.sort((a, b) => a - b);
  const p10 = diffs[Math.floor(diffs.length * 0.1)];
  const confusable = diffs.filter((v) => v < CONTRAST_FLOOR).length / diffs.length;
  assert.ok(
    p10 >= CONTRAST_FLOOR,
    `el 10% peor del fondo esta a solo ${p10.toFixed(1)} de luminancia del rimlight ${RIM_COLOR}`,
  );
  assert.ok(
    confusable < 0.2,
    `el ${(confusable * 100).toFixed(1)}% del fondo se confunde con el delineado de los cuerpos`,
  );
  // Y tiene que quedar recorrido hasta el blanco, o una luz aditiva (`lighter`)
  // sobre la fachada no se veria: saturaria contra un fondo ya a tope.
  assert.ok(peak <= 215, `el punto mas claro del fondo llega a ${peak.toFixed(0)}: sin margen para la luz aditiva`);
});

test('la luz aditiva del gas ACLARA el patio y no oscurece ni un pixel', () => {
  const before = shoot(STAGE_WIDTH / 2);
  const after = shoot(STAGE_WIDTH / 2);
  const ctx = after.getContext('2d');
  // Mismo encuadre que `shoot`, para que la luz caiga en coordenadas de mundo.
  const camY = GROUND_ANCHOR_Y - STAGE_HEIGHT / (2 * MAX_ZOOM);
  ctx.save();
  ctx.translate(STAGE_WIDTH / 2, STAGE_HEIGHT / 2);
  ctx.scale(MAX_ZOOM, MAX_ZOOM);
  ctx.translate(-STAGE_WIDTH / 2, -camY);
  // Fogonazo de gas acido sobre la fachada blanca del pabellon.
  lighting.drawLightSource(ctx, 200, GROUND_Y - 40, 60, [120, 255, 110], 1);
  ctx.restore();

  let brighter = 0;
  let darker = 0;
  for (let y = 0; y < STAGE_HEIGHT; y += 1) {
    for (let x = 0; x < STAGE_WIDTH; x += 1) {
      const d = luminanceAt(after, x, y) - luminanceAt(before, x, y);
      if (d > 0.5) brighter += 1;
      if (d < -0.5) darker += 1;
    }
  }
  assert.equal(darker, 0, `la luz aditiva oscurecio ${darker} pixeles: eso es pintar una mancha, no iluminar`);
  assert.ok(brighter > 800, `solo aclaro ${brighter} pixeles: el fogonazo se pierde sobre el hormigon claro`);
});

test('el motor no sabe nada del patio: pinta el escenario que se le ponga', () => {
  const original = getActiveStage();
  const painted = [];
  const fake = {
    id: 'test', name: 'TEST', horizonY: GROUND_Y - 5, safetyColor: '#123456',
    separationDim: 0, seeds: { far: 1, mid: 2, front: 3 },
    paintFar: (ctx, pix, rng, b) => { painted.push(['far', b.left, rng()]); pix.rect(b.left, -100, b.right - b.left, 500, '#ff00ff'); },
    paintMid: (ctx, pix, rng) => { painted.push(['mid', 0, rng()]); },
    paintFront: (ctx, pix, rng) => { painted.push(['front', 0, rng()]); },
  };
  try {
    setActiveStage(fake);
    assert.equal(getStageSafetyColor(), '#123456');
    assert.equal(getStageSeparationDim(), 0);
    const shot = shoot(STAGE_WIDTH / 2, { dim: 0 });
    assert.deepEqual(painted.map((p) => p[0]), ['far', 'mid', 'front']);
    const [r, g, b] = shot.pixel(240, 120);
    assert.deepEqual([r, g, b].map(Math.round), [255, 0, 255], 'no se pinto el escenario inyectado');
    // Cada capa recibe su propio RNG sembrado, no uno compartido.
    assert.notEqual(painted[0][2], painted[1][2]);
  } finally {
    setActiveStage(original);
  }
});

test('el patio declara lo que el motor necesita saber de el', () => {
  const stage = courtyard.highSchoolCourtyard;
  assert.equal(getActiveStage(), stage, 'el escenario oficial tiene que ser el patio');
  for (const key of ['id', 'name', 'horizonY', 'safetyColor', 'seeds', 'paintFar', 'paintMid', 'paintFront']) {
    assert.ok(stage[key] !== undefined, `al escenario le falta "${key}"`);
  }
  // Tres semillas DISTINTAS: con una sola, el mismo patron de ruido saldria en
  // el cielo y en el asfalto.
  const seeds = Object.values(stage.seeds);
  assert.equal(new Set(seeds).size, 3);
  // La pista se ensancha hacia camara —es lo que sostiene la perspectiva de las
  // lineas pintadas y del vallado lateral— pero SUAVEMENTE. El ensanchamiento
  // era de 2.5x cuando la pista era el escenario; ahora el escenario es el
  // muro y la pista es la franja de suelo a sus pies, y con una perspectiva
  // marcada volvia a leerse como una plaza vista desde arriba, o sea como una
  // plataforma descolgada por delante.
  const widening = courtyard.courtHalfWidth(1) / courtyard.courtHalfWidth(0);
  assert.ok(widening > 1.3, `la pista apenas se ensancha (${widening.toFixed(2)}x): no hay suelo, hay un telon`);
  assert.ok(widening < 2.1, `la pista se ensancha ${widening.toFixed(2)}x: demasiada perspectiva para una franja de suelo`);
  assert.equal(courtyard.depthAt(GROUND_Y - 5), 0);
});
