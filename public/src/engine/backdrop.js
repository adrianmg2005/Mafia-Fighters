import {
  STAGE_WIDTH, STAGE_HEIGHT, CAMERA_MARGIN_X, CAMERA_MARGIN_TOP,
} from '../stages/courtyardFrame.js';
import { highSchoolCourtyard } from '../stages/highSchoolCourtyard.js';
import { makeRng, makePix } from './pixelGrid.js';

// MOTOR DEL FONDO LEJANO. Hornea, cachea y desplaza las TRES CAPAS de
// parallax de un "escenario de fondo" pintado a 480x270 (hoy el patio del
// instituto, `stages/highSchoolCourtyard.js`).
//
// Hasta el paso a platform fighter este módulo ERA el escenario (se llamaba
// engine/stage.js y los luchadores pisaban su pista). Ahora el combate ocurre
// en el Patio Flotante de 1280x720 (engine/stage.js), y el patio es lo que se
// ve DETRÁS, a lo lejos: main.js lo blitea en espacio de pantalla a escala
// entera (x3) con un parallax suave derivado de la cámara del combate. Por eso
// este motor sigue hablando en coordenadas del marco de 480x270
// (`stages/courtyardFrame.js`) y no sabe nada del mundo nuevo.
//
// El arte vive en `stages/*.js`: añadir otro fondo es escribir otro archivo
// con la misma forma y llamar a `setActiveStage()`; aquí no hay que tocar nada.

let activeStage = highSchoolCourtyard;

// El horizonte (donde el fondo se convierte en suelo) lo declara el escenario
// y se deriva de GROUND_Y, no es un numero suelto: los luchadores, sus sombras
// de contacto y los charcos persistentes del VFX se anclan al MISMO plano.
export const HORIZON_Y = activeStage.horizonY;

// Color de seguridad del escenario activo, para que main.js limpie el canvas
// fisico con algo que pertenezca a este sitio y no con negro.
export function getStageSafetyColor() {
  return activeStage.safetyColor;
}

export function getStageName() {
  return activeStage.name;
}

// Cuanto velo necesita ESTE escenario para separar el fondo del primer plano.
// Es una propiedad del arte, no del motor: un callejon nocturno y un patio de
// dia piden numeros opuestos (ver la nota en el descriptor del escenario).
export function getStageSeparationDim() {
  return activeStage.separationDim ?? 0;
}

// El arte se hornea más ancho Y más alto que el escenario jugable
// (CAMERA_MARGIN_X a los lados, CAMERA_MARGIN_TOP por arriba) para que
// DynamicCamera pueda hacer zoom out o subir el encuadre en un salto alto
// sin revelar vacío más allá del fondo. Antes solo se ensanchaba a los
// lados: al saltar alto la cámara se aleja y sube (ver engine/camera.js),
// revelando mundo con y < 0 que este atlas nunca llegaba a cubrir — esos
// píxeles del canvas físico se quedaban con lo último dibujado ahí (el
// personaje de frames anteriores), lo que se veía como una estela/rastro
// pegada al fondo. No hace falta margen hacia abajo: GROUND_ANCHOR_Y en
// camera.js ancla el borde inferior de la vista siempre en el mismo punto,
// que ya cubre STAGE_HEIGHT de sobra.
const ART_WIDTH = STAGE_WIDTH + CAMERA_MARGIN_X * 2;
const ART_HEIGHT = STAGE_HEIGHT + CAMERA_MARGIN_TOP;

// PARALLAX DE TRES CAPAS. El escenario sigue siendo estático —el ruido sale
// de un RNG sembrado y se hornea una sola vez—, pero no es UN canvas: son
// tres, y cada uno se blitea con un desplazamiento distinto según cuánto se
// haya movido la cámara del centro. Eso es lo que da profundidad de verdad:
// una diferencia de VALOR entre dos planos insinúa distancia; el
// desplazamiento la demuestra.
//
// El factor es cuánto acompaña la capa al mundo: 1.0 = pegada al suelo real,
// 0.15 = casi fija en pantalla (el horizonte, que a esta distancia no se
// mueve). El desplazamiento se calcula como `(1 - factor)` sobre el
// recorrido de la cámara, así que la capa frontal no necesita corrección
// ninguna y sigue cuadrando con las coordenadas de mundo de siempre.
export const LAYER_FACTORS = { far: 0.15, mid: 0.45, front: 1 };

// Las capas lejanas se desplazan en sentido contrario al de la cámara, así
// que su arte tiene que sobrar por los lados o asomaría el vacío. Con el
// recorrido máximo de la cámara (±CAMERA_MARGIN_X) y el factor más bajo,
// 0.85 del recorrido es lo más que se puede desplazar una capa.
const PARALLAX_SLACK = Math.ceil(CAMERA_MARGIN_X * 0.85) + 8;

function makeLayerCanvas(extraWidth = 0) {
  const canvas = document.createElement('canvas');
  canvas.width = ART_WIDTH + extraWidth * 2;
  canvas.height = ART_HEIGHT;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.translate(CAMERA_MARGIN_X + extraWidth, CAMERA_MARGIN_TOP);
  return { canvas, ctx, extraWidth };
}

function buildStageLayers() {
  const stage = activeStage;
  const far = makeLayerCanvas(PARALLAX_SLACK);
  const mid = makeLayerCanvas(PARALLAX_SLACK);
  const front = makeLayerCanvas(0);

  const boundsFor = (extra) => ({
    left: -CAMERA_MARGIN_X - extra,
    right: STAGE_WIDTH + CAMERA_MARGIN_X + extra,
    top: -CAMERA_MARGIN_TOP,
  });

  const paint = (layer, painter, seed, extra) => {
    const pix = makePix(layer.ctx);
    // Cada capa lleva SU semilla: si compartieran una, el mismo patron de
    // ruido se repetiria en el cielo y en el asfalto y se notaria.
    painter(layer.ctx, pix, makeRng(seed), boundsFor(extra));
  };

  paint(far, stage.paintFar, stage.seeds.far, PARALLAX_SLACK);
  paint(mid, stage.paintMid, stage.seeds.mid, PARALLAX_SLACK);
  paint(front, stage.paintFront, stage.seeds.front, 0);

  return { far, mid, front };
}

let cachedLayers = null;

function getStageLayers() {
  if (!cachedLayers) cachedLayers = buildStageLayers();
  return cachedLayers;
}

/**
 * Cambia el escenario activo. Tira la cache: el arte se vuelve a hornear en
 * el siguiente dibujado, una sola vez.
 */
export function setActiveStage(stage) {
  activeStage = stage;
  cachedLayers = null;
}

export function getActiveStage() {
  return activeStage;
}

export function getStageCanvas() {
  // Compatibilidad: quien solo quiera "el escenario" recibe la capa frontal,
  // que es la que define el espacio jugable.
  return getStageLayers().front.canvas;
}

// El atlas es más ancho y más alto que el escenario jugable (ver ART_WIDTH/
// ART_HEIGHT); su (0,0) corresponde al mundo (-CAMERA_MARGIN_X,
// -CAMERA_MARGIN_TOP), así que se dibuja desplazado para que las
// coordenadas de mundo sigan cuadrando bajo la transformación de DynamicCamera.
export function drawStageBackground(ctx, cameraX = STAGE_WIDTH / 2) {
  const { far, mid, front } = getStageLayers();
  // Cuánto se ha desviado la cámara del centro del escenario. Es el recorrido
  // que las capas de fondo tienen que "no acompañar".
  const desvio = cameraX - STAGE_WIDTH / 2;

  const blit = (capa, factor) => {
    const dx = desvio * (1 - factor);
    ctx.drawImage(
      capa.canvas,
      -CAMERA_MARGIN_X - capa.extraWidth + dx,
      -CAMERA_MARGIN_TOP,
    );
  };

  blit(far, LAYER_FACTORS.far);
  blit(mid, LAYER_FACTORS.mid);
  blit(front, LAYER_FACTORS.front);
}

// "Super Dim" de la cinemática de Ultimate y velo de separación de planos:
// oscurece el ENTORNO, en coordenadas de mundo, para que main.js lo pueda
// dibujar entre el escenario y los luchadores y estos queden recortados a
// plena luz. Cubre exactamente la misma extensión que el atlas (más un margen
// inferior de sobra) para que no aparezca una franja sin oscurecer en el
// zoom out.
const DIM_BOTTOM_MARGIN = 80;

export function drawStageDim(ctx, alpha) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.fillStyle = `rgba(10, 14, 20, ${Math.min(1, alpha)})`;
  ctx.fillRect(
    -CAMERA_MARGIN_X,
    -CAMERA_MARGIN_TOP,
    ART_WIDTH,
    ART_HEIGHT + DIM_BOTTOM_MARGIN,
  );
  ctx.restore();
}
