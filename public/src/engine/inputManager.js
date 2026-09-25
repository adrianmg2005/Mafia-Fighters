// MAPEO DE CONTROLES ESTILO SMASH (sección 3 del diseño).
//
// Dos piezas separadas a propósito:
//
//   1. LECTURA (pollLocalInput): teclado + mando -> un objeto de booleanos.
//      Es lo ÚNICO que viaja por red, 60 veces por segundo, del cliente p2 al
//      host. Un solo esquema para todos los clientes: a qué luchador mueve
//      ese input lo decide el ROL que asigna el servidor, no las teclas.
//
//   2. INTERPRETACIÓN (InputTracker + resolveAttack): flancos de pulsación,
//      doble toque para el dash y la regla Botón + Dirección -> movimiento.
//      Corre SOLO en el host, dentro de la simulación, con el número de frame
//      de la simulación como reloj: por eso es determinista y por eso el
//      cliente remoto no necesita saber nada de ella.
//
// Ya no hay buffer de cadenas ni patrones 'lp>lp>hp': en un platform fighter
// el movimiento lo decide el botón + la dirección EN EL FRAME en que se
// pulsa, no la secuencia anterior.

const KEYBOARD_MAP = {
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  // W es a la vez "arriba" (modificador de U-Tilt, U-Smash, Up Special...) y
  // "saltar". Son dos campos distintos para que el mando pueda separarlos
  // (stick arriba sin saltar); en teclado van siempre juntos y el conflicto
  // U-Tilt/salto se resuelve en el jump squat (ver Fighter.tickJumpSquat).
  up: ['KeyW', 'ArrowUp'],
  jump: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  attack: ['KeyU'], // normales, tilts y aéreos
  smash: ['KeyI'], // ataques smash cargables
  special: ['KeyO'],
  grab: ['KeyJ'],
  shield: ['Space', 'ShiftLeft', 'ShiftRight'],
  ultra: ['KeyP'], // Final Smash
  // Menús de partida (listo / revancha). Viaja con el resto del input porque
  // el host resuelve los menús con los dos flujos de input que ya recibe.
  start: ['Enter'],
  // Pausa + guía de combate. También viaja por red: la pausa es estado de la
  // SIMULACIÓN (congela a los dos jugadores en el mismo frame), no un menú
  // local. Lo único local es cómo navega cada uno la guía (engine/pauseMenu.js).
  pause: ['Escape'],
  // MODO DESPERTAR (prototipo): la tecla Ñ. En un teclado español la Ñ es la
  // tecla física `Semicolon`; en cualquier distribución que la escriba se
  // marca además como `KeyÑ` al leer `e.key` (ver el listener de keydown).
  awaken: ['KeyÑ', 'Semicolon'],
};

// Teclas cuyo comportamiento por defecto molesta: las flechas y el espacio
// hacen scroll de la página y eso mueve el canvas debajo del jugador.
const PREVENT_DEFAULT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

// Mando estándar del navegador, repartido como en Smash: A ataque, B especial,
// X/Y salto, gatillos escudo, L1 agarre, R2 smash, START pausa. El Final Smash
// va en los dos clicks de stick, que no se pulsan por accidente, y SELECT es
// "listo / revancha" (START ya es la pausa).
const GAMEPAD_BUTTONS = {
  attack: [0],
  special: [1],
  jump: [2, 3],
  grab: [4],
  shield: [5, 6],
  smash: [7],
  ultra: [10, 11],
  start: [8],
  pause: [9],
};

const AXIS_DEADZONE = 0.35;
// Stick empujado a fondo: el "umbral" de dash del diseño (sección 3). En
// teclado no existe y el dash sale del doble toque.
const AXIS_DASH = 0.85;
const TRIGGER_THRESHOLD = 0.5;

export const INPUT_KEYS = [
  'left', 'right', 'up', 'down', 'jump', 'attack', 'smash', 'special', 'grab', 'shield', 'ultra',
  'dash', 'start', 'pause', 'awaken',
];

const keysDown = new Set();

// --- Foco de ventana --------------------------------------------------------
// Sin esto, probar con dos pestañas en el mismo PC es inviable: el navegador
// solo entrega `keydown`/`keyup` a la pestaña con foco, así que cambiar de
// pestaña con una tecla pulsada deja esa tecla marcada para siempre.
let windowHasFocus = true;

function setFocus(value) {
  windowHasFocus = value;
  if (!value) keysDown.clear();
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  windowHasFocus = typeof document !== 'undefined' && typeof document.hasFocus === 'function'
    ? document.hasFocus()
    : true;
  // La Ñ no tiene `code` propio: se reconoce también por el carácter.
  const isEnye = (e) => typeof e.key === 'string' && e.key.toLowerCase() === 'ñ';
  window.addEventListener('keydown', (e) => {
    if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
    keysDown.add(e.code);
    if (isEnye(e)) keysDown.add('KeyÑ');
  });
  window.addEventListener('keyup', (e) => {
    keysDown.delete(e.code);
    if (isEnye(e)) keysDown.delete('KeyÑ');
  });
  window.addEventListener('focus', () => setFocus(true));
  window.addEventListener('blur', () => setFocus(false));
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) setFocus(false);
    });
  }
}

export function isInputFocused() {
  return windowHasFocus;
}

export function createEmptyInputState() {
  const state = {};
  for (const key of INPUT_KEYS) state[key] = false;
  return state;
}

/** Normaliza lo que llegue por red: solo booleanos y solo claves conocidas. */
export function sanitizeInput(raw) {
  const state = createEmptyInputState();
  if (!raw || typeof raw !== 'object') return state;
  for (const key of INPUT_KEYS) state[key] = raw[key] === true;
  return state;
}

function readKeyboard(state) {
  for (const [action, codes] of Object.entries(KEYBOARD_MAP)) {
    if (codes.some((code) => keysDown.has(code))) state[action] = true;
  }
}

function readGamepad(state, pad) {
  if (!pad) return;
  const [axisX = 0, axisY = 0] = pad.axes;
  if (pad.buttons[12]?.pressed || axisY < -AXIS_DEADZONE) state.up = true;
  if (pad.buttons[13]?.pressed || axisY > AXIS_DEADZONE) state.down = true;
  if (pad.buttons[14]?.pressed || axisX < -AXIS_DEADZONE) state.left = true;
  if (pad.buttons[15]?.pressed || axisX > AXIS_DEADZONE) state.right = true;
  if (Math.abs(axisX) > AXIS_DASH) state.dash = true;
  for (const [action, indices] of Object.entries(GAMEPAD_BUTTONS)) {
    for (const index of indices) {
      const button = pad.buttons[index];
      if (button && (button.pressed || button.value > TRIGGER_THRESHOLD)) state[action] = true;
    }
  }
}

// Teclado y mando se COMBINAN (OR): con un mando enchufado en reposo el
// teclado tiene que seguir funcionando.
export function pollLocalInput() {
  const state = createEmptyInputState();
  if (!windowHasFocus) return state;
  readKeyboard(state);
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  readGamepad(state, pads[0]);
  return state;
}

// ============================================================================
// INTERPRETACIÓN (solo en la simulación del host)
// ============================================================================

// Dos pulsaciones de la misma dirección separadas por menos de esto = dash.
export const DOUBLE_TAP_FRAMES = 12;

// BUFFER DE ENTRADA: una pulsación de ataque o de salto se GUARDA 6 frames. Si
// el luchador no puede actuar cuando se pulsa (recovery, landing lag, hitlag
// propio...), la acción sale sola en el primer frame en que pueda, sin
// perder un tick. Cada pulsación se ejecuta UNA vez: al usarse se consume.
export const BUFFER_FRAMES = 6;
// Solo se guardan las acciones; el escudo no (su pulsación es la del tech,
// que tiene su propia ventana) ni las direcciones de movimiento.
const BUFFERED_KEYS = ['attack', 'smash', 'special', 'grab', 'jump', 'ultra', 'down'];
const DIRECTIONS = ['left', 'right', 'up', 'down'];

/**
 * Memoria de input de UN luchador: flancos, instante de cada pulsación y
 * doble toque. Todo en frames de simulación, nunca en tiempo real.
 */
export class InputTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.held = createEmptyInputState();
    this.pressed = createEmptyInputState();
    this.released = createEmptyInputState();
    this.lastPress = {};
    this.prevPress = {};
    this.bufferUntil = {};
    for (const key of INPUT_KEYS) {
      this.lastPress[key] = -Infinity;
      this.prevPress[key] = -Infinity;
      this.bufferUntil[key] = -Infinity;
    }
    this.frame = 0;
  }

  update(state, frame) {
    this.frame = frame;
    for (const key of INPUT_KEYS) {
      const now = !!state[key];
      const was = this.held[key];
      this.pressed[key] = now && !was;
      this.released[key] = !now && was;
      if (this.pressed[key]) {
        this.prevPress[key] = this.lastPress[key];
        this.lastPress[key] = frame;
        if (BUFFERED_KEYS.includes(key)) this.bufferUntil[key] = frame + BUFFER_FRAMES;
      }
      this.held[key] = now;
    }
  }

  /**
   * Copia el estado mantenido SIN generar flancos ni tocar el buffer. Lo usa
   * la pausa: las teclas con las que se navega la guía no pueden salir como
   * saltos o ataques al reanudar.
   */
  absorb(state) {
    for (const key of INPUT_KEYS) {
      this.held[key] = !!state[key];
      this.pressed[key] = false;
      this.released[key] = false;
    }
  }

  /** ¿Hay una pulsación de `key` sin usar dentro de la ventana de buffer? */
  buffered(key) {
    return this.bufferUntil[key] >= this.frame;
  }

  /** Marca como usada la pulsación guardada de `key`. */
  consume(key) {
    this.bufferUntil[key] = -Infinity;
  }

  /**
   * Alarga las pulsaciones guardadas que sigan vivas. Al aterrizar con lag,
   * una pulsación hecha justo ANTES de tocar el suelo tiene que sobrevivir al
   * lag entero: es el caso "salto antes de tocar suelo" del diseño.
   */
  extendBuffers(frames) {
    for (const key of BUFFERED_KEYS) {
      if (this.buffered(key)) this.bufferUntil[key] += frames;
    }
  }

  /**
   * Dirección horizontal: -1, 0 o +1. Con izquierda y derecha a la vez gana
   * la ÚLTIMA pulsada (el SOCD "last input priority" de los mandos arcade de
   * teclado). Con la regla antigua (las dos = 0) el dash dance en teclado era
   * imposible: pulsar A sin haber soltado del todo D paraba en seco.
   */
  get horizontal() {
    if (this.held.right && this.held.left) return this.lastPress.left > this.lastPress.right ? -1 : 1;
    return (this.held.right ? 1 : 0) - (this.held.left ? 1 : 0);
  }

  /** ¿Se acaba de pulsar `dir` por segunda vez dentro de la ventana de doble toque? */
  doubleTapped(dir) {
    return this.pressed[dir] && this.lastPress[dir] - this.prevPress[dir] <= DOUBLE_TAP_FRAMES;
  }

  /**
   * Dirección que MODIFICA un botón pulsado ahora. Si hay varias mantenidas
   * (W para saltar y D para ir hacia delante), manda la pulsada más
   * recientemente: es lo que en un stick analógico sería "hacia dónde
   * apunta", y en teclado evita que mantener W para subir convierta todos los
   * aéreos en Up Air.
   */
  modifierDirection() {
    let best = null;
    let bestFrame = -Infinity;
    for (const dir of DIRECTIONS) {
      if (!this.held[dir]) continue;
      if (this.lastPress[dir] > bestFrame) {
        best = dir;
        bestFrame = this.lastPress[dir];
      }
    }
    return best;
  }
}

/**
 * Traduce la dirección absoluta (left/right) a la relativa al facing.
 * @returns {'up'|'down'|'forward'|'back'|null}
 */
export function relativeDirection(dir, facing) {
  if (dir === 'left') return facing < 0 ? 'forward' : 'back';
  if (dir === 'right') return facing > 0 ? 'forward' : 'back';
  return dir;
}

// Tablas Botón + Dirección de la sección 3. Son DATOS: el Fighter busca aquí
// el nombre del movimiento y la moveTable del personaje decide qué es.
const GROUND_ATTACK = { null: 'jab', forward: 'ftilt', back: 'ftilt', up: 'utilt', down: 'dtilt' };
const GROUND_SMASH = { null: 'fsmash', forward: 'fsmash', back: 'fsmash', up: 'usmash', down: 'dsmash' };
const AIR_ATTACK = { null: 'nair', forward: 'fair', back: 'bair', up: 'uair', down: 'dair' };
const SPECIAL = { null: 'nspecial', forward: 'sspecial', back: 'sspecial', up: 'uspecial', down: 'dspecial' };

/**
 * Qué movimiento sale de `button` con la dirección modificadora `dir`
 * (absoluta) en este contexto.
 *
 * @param {'attack'|'smash'|'special'|'grab'|'ultra'} button
 * @param {object} ctx
 * @param {boolean} ctx.grounded
 * @param {number}  ctx.facing
 * @param {boolean} ctx.running  en DASH/RUN: el ataque normal es el Dash Attack
 * @param {string|null} dir     'left'|'right'|'up'|'down'|null
 * @returns {{ move: string, turn: boolean } | null}
 *   `turn` indica que el movimiento sale hacia el lado contrario al facing
 *   (un F-Tilt o F-Smash pulsando atrás se ejecuta dándose la vuelta).
 */
export function resolveAttack(button, { grounded, facing, running = false }, dir) {
  const rel = relativeDirection(dir, facing);
  const turn = rel === 'back';
  const key = rel ?? 'null';
  switch (button) {
    case 'attack':
      if (!grounded) return { move: AIR_ATTACK[key], turn: false };
      if (running && (rel === null || rel === 'forward')) return { move: 'dashattack', turn: false };
      return { move: GROUND_ATTACK[key], turn };
    case 'smash':
      // En el aire, el botón de smash hace el aéreo de esa dirección (como el
      // C-stick de Smash): no hay smash attacks aéreos.
      if (!grounded) return { move: AIR_ATTACK[key], turn: false };
      return { move: GROUND_SMASH[key], turn };
    case 'special':
      return { move: SPECIAL[key], turn };
    case 'grab':
      return grounded ? { move: 'grab', turn: false } : null;
    case 'ultra':
      return { move: 'final', turn: false };
    default:
      return null;
  }
}
