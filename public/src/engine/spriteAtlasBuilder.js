import { KEYED_POSES, KEYED_FRAME_COUNT } from './keyedPoses.js';
import { FIGHTER_WIDTH, FIGHTER_HEIGHT } from '../characters/fighter.js';
import { computePoseForKind } from './poseLibrary.js';
import { drawPixelFighter } from './pixelFighterArt.js';

// Margen por celda. Tiene que cubrir el frame que más se sale de la caja
// w x h: el derribo empuja miembros hasta ~0.26*h por DEBAJO de los pies, la
// ulti escala el rig un 14% y el arco de ataque sobresale ~0.24*w por el
// lateral. Quedarse corto aquí recorta sprites, no da error.
// Medido rasterizando TODAS las poses de los tres personajes: el frame que
// más se sale (la llave inglesa en el gancho) usaba exactamente 32px, o sea
// que el margen estaba justo al límite y cualquier retoque del arte habría
// empezado a recortar sprites en silencio. 40 deja holgura real.
// Margen de celda, POR EJE. Lo fija el frame que más se sale, y ese frame es
// el gancho de llave: con la llave titánica a 64px la punta llega a 55px
// fuera de la caja del cuerpo (medido; con la llave de 26 eran 32). Quedarse
// corto aquí RECORTA SPRITES EN SILENCIO — no da error, simplemente falta
// arte, que es el peor modo de fallo de este pipeline.
//
// Está separado en X e Y porque el desbordamiento NO es simétrico y pagarlo
// simétrico cuesta memoria de verdad. Medido sobre el rasterizado real:
//   peor caso en X: 72px  (el culatazo de cigüeñal, la llave en horizontal)
//   peor caso en Y: 59px  (el bidón levantado por encima de la cabeza)
// De ahí 84 y 72, que dejan 12-13px de holgura en cada eje. El colchón importa:
// la vez anterior este margen quedó justo al límite y cualquier retoque del
// arte habría empezado a recortar en silencio.
//
// COSTE, que conviene tener presente: los tres atlas pasan de 8.6 Mpx (~34 MB
// de VRAM) a 23.6 (~94 MB), y el horneado de arranque de ~35ms a ~1.1s. No es
// el precio del margen sino el de los props grandes, que es lo que obliga al
// margen. Por frame de juego no cuesta nada —los luchadores siguen siendo
// `drawImage` desde el atlas, 0 fillRect—, así que encarece el arranque y la
// memoria, no el bucle. Si algún día molesta, la salida es dimensionar la
// celda POR ANIMACIÓN en vez de usar una única para todas: hoy las 35 poses
// pagan el margen que solo necesitan dos.
const CELL_PADDING_X = 84;
const CELL_PADDING_Y = 72;

// Un solo plan de animación sirve para cualquier personaje: lo que cambia
// entre fighters es la silueta (body kit) y los matices de la pose, no la
// coreografía. Nombres alineados 1:1 con `pose` en fighterN.js y con los
// estados que usa renderer.js, para que nadie tenga que traducir entre
// "nombre de animación" y "nombre de pose" en dos sitios distintos.
//
// `sampleBy: 'progress'` marca las animaciones que NO avanzan con un reloj
// propio, sino con el progreso real del movimiento (ver `progressDriven` más
// abajo y SpriteAnimator.playAtProgress): así la anticipación cae dentro de
// los startupFrames y el frame de impacto dentro de los activeFrames, en vez
// de ir cada uno a su ritmo.
// `lift` (px, o función del índice de frame) sube el sprite para que el
// cuerpo apoye en los PIES. Tres poses —la agonía del Final Smash, el derribo
// y la levantada— se dibujaron para un combate sobre una pista continua, donde
// hundir el rig 16-20 px bajo los pies se leía como "tumbado en el suelo".
// Sobre el canto de una losa flotante se lee como enterrado. Las cifras son
// MEDIDAS sobre el rasterizado (fila más baja con píxel) y hay un test que las
// vuelve a medir. No se aplica a los golpes que bajan de los pies (pisotón,
// barrido, gas): eso es el EFECTO del golpe, no el cuerpo.
const ANIMATION_PLAN = {
  idle: {
    kind: 'idle', frameCount: 6, frameDurationMs: 150, loop: true, sampleBy: 'time', timeSpan: (2 * Math.PI) / 1.6,
  },
  'walk-fwd': {
    kind: 'walk-fwd', frameCount: 8, frameDurationMs: 62, loop: true, sampleBy: 'time', timeSpan: (2 * Math.PI) / 10,
  },
  'walk-back': {
    kind: 'walk-back', frameCount: 6, frameDurationMs: 85, loop: true, sampleBy: 'time', timeSpan: (2 * Math.PI) / 7,
  },
  jump_rise: { kind: 'jump', frameCount: 1, frameDurationMs: 1000, loop: true, sampleBy: 'fixed', rising: true },
  jump_fall: { kind: 'jump', frameCount: 1, frameDurationMs: 1000, loop: true, sampleBy: 'fixed', rising: false },
  // Poses nuevas de Samuel (engine/keyedPoses.js).
  rapidjab: { kind: 'rapidjab', frameCount: 10, frameDurationMs: 40, loop: false, sampleBy: 'progress' },
  bellybump: { kind: 'bellybump', frameCount: 10, frameDurationMs: 40, loop: false, sampleBy: 'progress' },
  bootkick: { kind: 'bootkick', frameCount: 10, frameDurationMs: 40, loop: false, sampleBy: 'progress' },
  backkick: { kind: 'backkick', frameCount: 10, frameDurationMs: 40, loop: false, sampleBy: 'progress' },
  wrencharc: { kind: 'wrencharc', frameCount: 10, frameDurationMs: 40, loop: false, sampleBy: 'progress' },
  spin360: { kind: 'spin360', frameCount: 20, frameDurationMs: 40, loop: false, sampleBy: 'progress' },
  hammer: { kind: 'hammer', frameCount: 10, frameDurationMs: 40, loop: false, sampleBy: 'progress' },
  burpup: { kind: 'burpup', frameCount: 10, frameDurationMs: 40, loop: false, sampleBy: 'progress' },
  buttslam: { kind: 'buttslam', frameCount: 10, frameDurationMs: 40, loop: false, sampleBy: 'progress' },
  inhale: { kind: 'inhale', frameCount: 8, frameDurationMs: 40, loop: false, sampleBy: 'progress' },
  rocket: { kind: 'rocket', frameCount: 10, frameDurationMs: 40, loop: false, sampleBy: 'progress' },
  waft: { kind: 'waft', frameCount: 10, frameDurationMs: 40, loop: false, sampleBy: 'progress' },
  flyingslam: { kind: 'flyingslam', frameCount: 10, frameDurationMs: 40, loop: false, sampleBy: 'progress' },
  slamdive: { kind: 'slamdive', frameCount: 2, frameDurationMs: 80, loop: true, sampleBy: 'progress' },
  chairslam: { kind: 'chairslam', frameCount: 10, frameDurationMs: 42, loop: false, sampleBy: 'progress' },
  // Modo Despertado (su tabla de movimientos, samuelAwakenedMoveTable).
  micjab: { kind: 'micjab', frameCount: 10, frameDurationMs: 40, loop: false, sampleBy: 'progress' },
  micslam: { kind: 'micslam', frameCount: 10, frameDurationMs: 40, loop: false, sampleBy: 'progress' },
  burpsky: { kind: 'burpsky', frameCount: 10, frameDurationMs: 40, loop: false, sampleBy: 'progress' },
  windmill: { kind: 'windmill', frameCount: 10, frameDurationMs: 40, loop: false, sampleBy: 'progress' },
  dropkick: { kind: 'dropkick', frameCount: 10, frameDurationMs: 40, loop: false, sampleBy: 'progress' },
  divebomb: { kind: 'divebomb', frameCount: 10, frameDurationMs: 40, loop: false, sampleBy: 'progress' },
  habano: { kind: 'habano', frameCount: 10, frameDurationMs: 40, loop: false, sampleBy: 'progress' },
  rapdash: { kind: 'rapdash', frameCount: 10, frameDurationMs: 40, loop: false, sampleBy: 'progress' },
  parry: { kind: 'parry', frameCount: 10, frameDurationMs: 40, loop: false, sampleBy: 'progress' },
  parrypunch: { kind: 'parrypunch', frameCount: 10, frameDurationMs: 40, loop: false, sampleBy: 'progress' },
  capthrow: { kind: 'capthrow', frameCount: 10, frameDurationMs: 40, loop: false, sampleBy: 'progress' },
  battlestance: { kind: 'battlestance', frameCount: 10, frameDurationMs: 60, loop: true, sampleBy: 'progress' },
  jab: { kind: 'jab', frameCount: 6, frameDurationMs: 40, loop: false, sampleBy: 'progress', attackHighlight: true },
  kick: { kind: 'kick', frameCount: 7, frameDurationMs: 45, loop: false, sampleBy: 'progress', attackHighlight: true },
  launcher: { kind: 'launcher', frameCount: 7, frameDurationMs: 48, loop: false, sampleBy: 'progress', attackHighlight: true },
  special: { kind: 'special', frameCount: 8, frameDurationMs: 45, loop: false, sampleBy: 'progress', attackHighlight: true },
  ultra: { kind: 'ultra', frameCount: 8, frameDurationMs: 55, loop: false, sampleBy: 'progress', attackHighlight: true },
  // Remate aéreo con efecto (hoy el escape de gas de Samuel). Es una entrada
  // GENÉRICA del plan, no una animación "de Samuel": cualquier personaje que
  // declare `pose: 'gasblast'` en un movimiento la usa, igual que 'launcher'
  // o 'special'. Cuesta 7 celdas más por atlas, que se hornean una vez.
  gasblast: { kind: 'gasblast', frameCount: 7, frameDurationMs: 42, loop: false, sampleBy: 'progress', attackHighlight: true },
  // Eslabones de cadena con animación propia (ver 'Target Strings'). Como
  // todas las del plan son genéricas: cualquier personaje que declare ese
  // `pose` en un movimiento las usa.
  stomp: { kind: 'stomp', frameCount: 6, frameDurationMs: 40, loop: false, sampleBy: 'progress', attackHighlight: true },
  smokekick: { kind: 'smokekick', frameCount: 8, frameDurationMs: 45, loop: false, sampleBy: 'progress', attackHighlight: true },
  lowswing: { kind: 'lowswing', frameCount: 7, frameDurationMs: 45, loop: false, sampleBy: 'progress', attackHighlight: true },
  headbutt: { kind: 'headbutt', frameCount: 7, frameDurationMs: 45, loop: false, sampleBy: 'progress', attackHighlight: true },
  burp: { kind: 'burp', frameCount: 8, frameDurationMs: 45, loop: false, sampleBy: 'progress' },
  sidekick: { kind: 'sidekick', frameCount: 7, frameDurationMs: 42, loop: false, sampleBy: 'progress', attackHighlight: true },
  uppercut: { kind: 'uppercut', frameCount: 6, frameDurationMs: 40, loop: false, sampleBy: 'progress', attackHighlight: true },
  crankswing: { kind: 'crankswing', frameCount: 7, frameDurationMs: 42, loop: false, sampleBy: 'progress', attackHighlight: true },
  elbow: { kind: 'elbow', frameCount: 6, frameDurationMs: 40, loop: false, sampleBy: 'progress', attackHighlight: true },
  lowsweep: { kind: 'lowsweep', frameCount: 7, frameDurationMs: 40, loop: false, sampleBy: 'progress', attackHighlight: true },
  hook: { kind: 'hook', frameCount: 6, frameDurationMs: 42, loop: false, sampleBy: 'progress', attackHighlight: true },
  smokespin: { kind: 'smokespin', frameCount: 8, frameDurationMs: 42, loop: false, sampleBy: 'progress', attackHighlight: true },
  // Activación de la Ultimate: el berrido al micro que lanza la onda.
  micshout: { kind: 'micshout', frameCount: 8, frameDurationMs: 45, loop: false, sampleBy: 'progress' },
  // Variante de embestida de la misma ulti (starter cuerpo a cuerpo en vez de
  // onda). No la usa nadie ahora mismo, así que no se hornea en ningún atlas
  // — el plan solo describe qué EXISTE; lo que se hornea lo decide
  // animationsForMoveTable a partir de la moveTable de cada personaje.
  micdash: { kind: 'micdash', frameCount: 8, frameDurationMs: 45, loop: false, sampleBy: 'progress' },
  // Poses de la cinemática. `rap` y `earpain` son CÍCLICAS (sampleBy 'time')
  // porque durante la cinemática el estado no tiene duración propia —la lleva
  // el director— así que tienen que poder repetirse en bucle.
  //
  // `rapintro` es la excepción y va por PROGRESO: la transformación de la
  // TOMA 1 es un cambio con principio y final, no un bucle, y el director la
  // recorre de 0 a 1 en su tramo del plano.
  rapintro: { kind: 'rapintro', frameCount: 10, frameDurationMs: 45, loop: false, sampleBy: 'progress' },
  rap: {
    kind: 'rap', frameCount: 8, frameDurationMs: 70, loop: true, sampleBy: 'time', timeSpan: (2 * Math.PI) / 9,
  },
  earpain: {
    kind: 'earpain', frameCount: 6, frameDurationMs: 60, loop: true, sampleBy: 'time', timeSpan: (2 * Math.PI) / 5, lift: 20,
  },
  hitstun: { kind: 'hitstun', frameCount: 5, frameDurationMs: 45, loop: false, sampleBy: 'progress' },
  air_hurt: {
    kind: 'air_hurt', frameCount: 4, frameDurationMs: 130, loop: true, sampleBy: 'time', timeSpan: (2 * Math.PI) / 6,
  },
  knockdown: {
    kind: 'knockdown', frameCount: 1, frameDurationMs: 1000, loop: true, sampleBy: 'fixed', lift: 16,
  },
  // Levantarse: 5 frames guiados por el progreso real del estado WAKEUP, así
  // que la animación dura exactamente sus 8 frames de invulnerabilidad.
  wakeup: {
    kind: 'wakeup', frameCount: 5, frameDurationMs: 27, loop: false, sampleBy: 'progress', lift: (i, n) => 16 * (1 - (i + 0.5) / n),
  },
  // Agachado: como la guardia, casi estático — solo respira.
  crouch: {
    kind: 'crouch', frameCount: 2, frameDurationMs: 240, loop: true, sampleBy: 'time', timeSpan: Math.PI,
  },
  // Guardia: ciclo lentísimo, casi estático — solo respira.
  block: {
    kind: 'block', frameCount: 2, frameDurationMs: 260, loop: true, sampleBy: 'time', timeSpan: Math.PI,
  },
  stagger: {
    kind: 'stagger', frameCount: 4, frameDurationMs: 90, loop: true, sampleBy: 'time', timeSpan: (2 * Math.PI) / 5,
  },
  // RODILLAZO AL ESTÓMAGO (atacante). Guiada por progreso como el resto de
  // ataques, para que la anticipación caiga en el startup y el frame de
  // impacto en los frames activos.
  gutknee: { kind: 'gutknee', frameCount: 6, frameDurationMs: 40, loop: false, sampleBy: 'progress', attackHighlight: true },
  // DOBLADO POR EL ESTÓMAGO (víctima). La necesita CUALQUIER personaje —
  // cualquiera puede comerse el rodillazo—, y `rosterVictimPoses()` la
  // recoge sola de la moveTable y la añade a todos los atlas.
  gutpunch: { kind: 'gutpunch', frameCount: 4, frameDurationMs: 55, loop: false, sampleBy: 'progress' },
};

// Animaciones que necesita CUALQUIER personaje, tenga los movimientos que
// tenga: locomoción, reacciones y estados de la FSM. El resto (los `pose` de
// su moveTable) se añaden por personaje.
const BASE_ANIMATIONS = [
  'idle', 'walk-fwd', 'walk-back', 'jump_rise', 'jump_fall',
  'hitstun', 'air_hurt', 'knockdown', 'wakeup', 'crouch', 'block', 'stagger',
];

// Qué animaciones hornear para un personaje: las de base más las que usen sus
// movimientos. Sin esto, cada animación nueva de UN personaje engordaba el
// atlas de TODOS: al añadir las cinco poses de las cadenas de Samuel, Rook y
// Vixen habrían cargado con 36 frames de pisotones y eructos que no van a
// reproducir jamás. Con el subconjunto, el atlas de cada uno crece solo con
// lo suyo.
// `extra` son animaciones que este personaje necesita aunque no salgan de
// sus propios movimientos. Hoy son las poses de VÍCTIMA de las ultis del
// roster: cualquiera puede acabar siendo la víctima de "Batalla de Gallos",
// así que todos tienen que llevar horneada la pose de taparse los oídos. Ver
// rosterVictimPoses() en characters/roster.js.
export { CELL_PADDING_X, CELL_PADDING_Y };

export function animationsForMoveTable(moveTable, extra = []) {
  const used = new Set([...BASE_ANIMATIONS, ...extra]);
  for (const move of Object.values(moveTable || {})) {
    if (move.pose) used.add(move.pose);
    // Poses del ATACANTE durante la cinemática de su Final Smash. Una pose
    // que solo aparece dentro de un sub-objeto no se hornea si no se busca
    // aquí, y el personaje se queda sin animación justo en ese momento. Sin
    // error: solo falta arte.
    if (move.finalSmash?.attackerPose) used.add(move.finalSmash.attackerPose);
    if (move.finalSmash?.transformPose) used.add(move.finalSmash.transformPose);
  }
  // Se devuelve en el orden del plan (no en el de inserción) para que el
  // atlas sea determinista: mismo personaje, mismo atlas, siempre.
  return Object.keys(ANIMATION_PLAN).filter((name) => used.has(name));
}

// `h` y `kit` se pasan en las tres ramas: hay poses (knockdown/wakeup) cuyos
// offsets son proporción de la altura, y todas modulan su amplitud según el
// personaje.
function samplePose(plan, i, kit) {
  const common = { h: FIGHTER_HEIGHT, kit };
  if (plan.sampleBy === 'time') {
    const t = plan.frameCount > 1 ? (i / plan.frameCount) * plan.timeSpan : 0;
    return computePoseForKind(plan.kind, { ...common, t });
  }
  if (plan.sampleBy === 'progress') {
    // Cada frame se muestrea en el CENTRO del tramo de progreso en el que se
    // enseña: SpriteAnimator.playAtProgress muestra el frame i durante
    // [i/n, (i+1)/n). Muestreado en i/(n-1), el dibujo iba medio frame
    // desfasado respecto a lo que pasaba (y el impacto caía fuera de los
    // frames activos). El primer frame de un golpe ya no es exactamente el
    // reposo, sino la anticipación de su primer tramo.
    const progress = plan.frameCount > 1 ? (i + 0.5) / plan.frameCount : 0;
    return computePoseForKind(plan.kind, { ...common, progress });
  }
  return computePoseForKind(plan.kind, { ...common, rising: plan.rising });
}

// Hornea, una sola vez por personaje, un atlas real (canvas offscreen) con
// todas las poses convertidas en frames discretos, listo para que
// SpriteAnimator lo reproduzca como si fuera una hoja de sprites cargada de
// disco. Sustituirlo por una hoja real es, en el futuro, cuestión de
// construir `frames`/`animations` a mano (o con un empaquetador tipo
// TexturePacker) en vez de llamar a esta función — SpriteAnimator no cambia.
//
// `art` elige el body kit (silueta + paleta) en pixelFighterArt.js; `color`
// solo se usa para personajes sin arte propio.
function buildLazyAtlas({
  art, color, wanted, outfit,
}) {
  const w = FIGHTER_WIDTH;
  const h = FIGHTER_HEIGHT;
  const cellW = w + CELL_PADDING_X * 2;
  const cellH = h + CELL_PADDING_Y * 2;
  const pivot = { x: cellW / 2, y: cellH - CELL_PADDING_Y };
  const frames = [];
  const animations = {};
  for (const [name, base] of Object.entries(ANIMATION_PLAN)) {
    if (wanted && !wanted.includes(name)) continue;
    const plan = effectivePlan(base, art);
    const frameIndices = [];
    for (let i = 0; i < plan.frameCount; i += 1) {
      const lift = typeof plan.lift === 'function' ? plan.lift(i, plan.frameCount) : (plan.lift ?? 0);
      let canvas = null;
      frames.push({
        sx: 0,
        sy: 0,
        sw: cellW,
        sh: cellH,
        pivotX: pivot.x,
        pivotY: pivot.y + lift,
        // Identidad propia para las cachés de silueta (todas en sx=sy=0).
        id: `${outfit}:${name}:${i}`,
        get image() {
          if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.width = cellW;
            canvas.height = cellH;
            const c = canvas.getContext('2d');
            c.imageSmoothingEnabled = false;
            const pose = samplePose(plan, i, art);
            c.translate(pivot.x, pivot.y);
            c.scale(pose.scale, pose.scale);
            c.translate(-w / 2, -h);
            drawPixelFighter(c, {
              w, h, art, color, pose, attackHighlight: !!plan.attackHighlight, outfit,
            });
          }
          return canvas;
        },
      });
      frameIndices.push(frames.length - 1);
    }
    animations[name] = {
      frameIndices, frameDurationMs: plan.frameDurationMs, loop: plan.loop, progressDriven: plan.sampleBy === 'progress',
    };
  }
  return {
    image: null, frames, animations, pivot, lazy: true,
  };
}

// Las poses por claves (Samuel) hornean 10 frames: con la fase canónica, los
// frames 3 y 4 caen EXACTOS en los frames activos [0.3, 0.5).
function effectivePlan(plan, art) {
  if (art !== 'mecanico' || plan.sampleBy !== 'progress' || !KEYED_POSES[plan.kind]) return plan;
  return { ...plan, frameCount: KEYED_FRAME_COUNT[plan.kind] ?? 10 };
}

/**
 * Las poses que hornea el atlas para la animación `name`, una por frame y en
 * el mismo orden. Para los tests de anatomía: se puede dibujar cada frame
 * con y sin accesorios sin recortarlo del atlas.
 */
export function animationPoses(name, art = 'default') {
  const base = ANIMATION_PLAN[name];
  if (!base) return [];
  const plan = effectivePlan(base, art);
  return Array.from({ length: plan.frameCount }, (_, i) => samplePose(plan, i, art));
}

/**
 * `outfit` elige la ropa del kit ('awakened': el rapero del Modo Despertar).
 * `lazy` no hornea nada: cada frame se rasteriza en su propio lienzo la
 * PRIMERA vez que se enseña y se guarda. Un atlas completo mide ~95 MB en
 * memoria; el del Despertar dura 10 s y enseña unas decenas de frames, así que
 * se hace perezoso (y el primer uso cae dentro de la congelación de 2 s de la
 * cinemática, donde un frame que tarda no se nota).
 */
export function buildFighterAtlas({
  art = 'default', color = '#cccccc', animations: wanted = null, outfit = 'normal', lazy = false,
} = {}) {
  if (lazy) return buildLazyAtlas({ art, color, wanted, outfit });
  const w = FIGHTER_WIDTH;
  const h = FIGHTER_HEIGHT;
  const cellW = w + CELL_PADDING_X * 2;
  const cellH = h + CELL_PADDING_Y * 2;
  const pivot = { x: cellW / 2, y: cellH - CELL_PADDING_Y }; // pies, centrado horizontal

  // Sin lista explícita se hornea el plan entero (compatibilidad); con ella,
  // solo lo que ese personaje usa de verdad.
  const planEntries = Object.entries(ANIMATION_PLAN)
    .filter(([name]) => !wanted || wanted.includes(name))
    .map(([name, plan]) => [name, effectivePlan(plan, art)]);
  const totalFrames = planEntries.reduce((sum, [, plan]) => sum + plan.frameCount, 0);
  const columns = Math.ceil(Math.sqrt(totalFrames));
  const rows = Math.ceil(totalFrames / columns);

  const atlas = document.createElement('canvas');
  atlas.width = columns * cellW;
  atlas.height = rows * cellH;
  const actx = atlas.getContext('2d');
  actx.imageSmoothingEnabled = false;

  const frames = [];
  const animations = {};
  let cursor = 0;

  for (const [name, plan] of planEntries) {
    const frameIndices = [];

    for (let i = 0; i < plan.frameCount; i += 1) {
      const col = cursor % columns;
      const row = Math.floor(cursor / columns);
      const cellX = col * cellW;
      const cellY = row * cellH;
      const pose = samplePose(plan, i, art);

      actx.save();
      // Origen en los pies, para que el escalado de la pose (la ulti "crece",
      // el derribo se achata) no desplace el punto de apoyo del personaje.
      actx.translate(cellX + pivot.x, cellY + pivot.y);
      actx.scale(pose.scale, pose.scale);
      actx.translate(-w / 2, -h);
      drawPixelFighter(actx, {
        w, h, art, color, pose, attackHighlight: !!plan.attackHighlight, outfit,
      });
      actx.restore();

      const lift = typeof plan.lift === 'function' ? plan.lift(i, plan.frameCount) : (plan.lift ?? 0);
      frames.push({
        sx: cellX, sy: cellY, sw: cellW, sh: cellH, pivotX: pivot.x, pivotY: pivot.y + lift,
      });
      frameIndices.push(cursor);
      cursor += 1;
    }

    animations[name] = {
      frameIndices,
      frameDurationMs: plan.frameDurationMs,
      loop: plan.loop,
      // El renderer consulta esto para decidir si el frame lo manda el reloj
      // del animador o el progreso del estado (ver renderer.drawFighter).
      progressDriven: plan.sampleBy === 'progress',
    };
  }

  return { image: atlas, frames, animations, pivot };
}
