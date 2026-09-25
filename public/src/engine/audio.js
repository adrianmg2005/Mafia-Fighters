// Efectos de sonido retro 100% PROCEDURALES (Web Audio API).
//
// No hay ni un solo archivo de audio en el proyecto ni ninguna dependencia:
// cada sonido se sintetiza en el momento con osciladores nativos y ruido
// blanco generado en un AudioBuffer. Es la misma filosofia que el resto del
// arte del juego -el atlas de sprites se hornea en caliente, el escenario se
// dibuja por capas con un RNG sembrado-, y encaja con el formato: una
// recreativa de los 90 sintetizaba sus efectos con un chip, no reproducia
// samples de estudio.
//
// DECISIONES QUE CONVIENE NO DESHACER
//
//  1. El AudioContext NO se crea al importar el modulo. Todos los navegadores
//     modernos bloquean (o crean en estado 'suspended') un contexto de audio
//     que no nace de un gesto del usuario, y un contexto suspendido no suena
//     nunca aunque mas tarde se le manden notas. Por eso `initAudio()` solo
//     registra listeners de `pointerdown`/`keydown` y el contexto se crea -y
//     se reanuda- en el primer gesto real. Mientras tanto `playSfx()` es un
//     no-op silencioso, nunca un error.
//  2. Cada llamada crea nodos nuevos y los desconecta al terminar
//     (`onended`). Los OscillatorNode/BufferSourceNode son de un solo uso por
//     diseno en Web Audio: reutilizarlos no es una optimizacion, es un error.
//  3. Las envolventes usan siempre `setValueAtTime` + rampas explicitas. Un
//     gain que arranca en su valor final produce un "click" audible (una
//     discontinuidad en la onda); el ataque de 2-8ms lo elimina sin suavizar
//     la pegada.
//  4. Hay un tope de voces simultaneas (MAX_VOICES): en un combo de 6 golpes
//     con hitstop, sin limite, se solapan decenas de nodos y satura.

const MASTER_VOLUME = 0.34;
const MAX_VOICES = 18;

// Ruido blanco: un segundo de muestras aleatorias que se reutiliza como
// fuente de todos los sonidos percusivos (golpes, gong, sirena). Generarlo
// una vez y releerlo con offsets distintos es lo que hace que un golpe no
// cueste practicamente nada.
const NOISE_SECONDS = 1;

let audioCtx = null;
let masterGain = null;
let noiseBuffer = null;
let muted = false;
let initialised = false;
let voices = 0;

function createContext() {
  if (audioCtx) return audioCtx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  audioCtx = new Ctor();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = muted ? 0 : MASTER_VOLUME;
  masterGain.connect(audioCtx.destination);

  const frames = Math.floor(audioCtx.sampleRate * NOISE_SECONDS);
  noiseBuffer = audioCtx.createBuffer(1, frames, audioCtx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;

  return audioCtx;
}

// El primer gesto del usuario (tecla o clic) crea y/o reanuda el contexto.
// El listener NO se elimina tras el primer uso: si el navegador vuelve a
// suspender el contexto (pestana oculta mucho rato, ahorro de energia), el
// siguiente gesto lo reanuda solo.
function unlock() {
  const context = createContext();
  if (context && context.state === 'suspended') context.resume();
}

export function toggleMute() {
  muted = !muted;
  if (masterGain && audioCtx) {
    masterGain.gain.setTargetAtTime(muted ? 0 : MASTER_VOLUME, audioCtx.currentTime, 0.02);
  }
  return muted;
}

export function initAudio() {
  if (initialised || typeof window === 'undefined') return;
  initialised = true;
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  // M silencia/activa. Va aqui y no en engine/input.js a proposito: no es
  // input de juego (no viaja por red ni entra en la simulacion), es una
  // preferencia local de esta pestana, igual que el F1 del panel de debug.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyM' || e.repeat) return;
    toggleMute();
  });
}

export function isAudioMuted() {
  return muted;
}

// --- Bloques de sintesis ---------------------------------------------------

function trackVoice(node) {
  voices += 1;
  node.onended = () => {
    voices -= 1;
    try {
      node.disconnect();
    } catch (err) {
      // ya desconectado: nada que hacer
    }
  };
}

// Envolvente minima (ataque + decaimiento exponencial). El
// `exponentialRampToValueAtTime` no puede llegar nunca a 0 (indefinido en la
// especificacion), de ahi el suelo de 0.0001 seguido de un corte seco.
function envelope(gainNode, when, {
  attack = 0.004, peak = 1, duration = 0.2, sustain = 0,
}) {
  const g = gainNode.gain;
  const safePeak = Math.max(0.0002, peak);
  g.setValueAtTime(0.0001, when);
  g.exponentialRampToValueAtTime(safePeak, when + attack);
  if (sustain > 0) g.setValueAtTime(safePeak, when + attack + sustain);
  g.exponentialRampToValueAtTime(0.0001, when + attack + sustain + duration);
  g.setValueAtTime(0, when + attack + sustain + duration + 0.005);
}

// Golpe de ruido blanco filtrado: la base de cualquier impacto percusivo.
function noiseBurst({
  when, duration = 0.08, gain = 0.6, type = 'bandpass', freq = 1200, endFreq = null, q = 1,
}) {
  if (!audioCtx || voices > MAX_VOICES) return;
  const src = audioCtx.createBufferSource();
  src.buffer = noiseBuffer;
  // Offset aleatorio dentro del buffer: si todos los golpes leyeran desde la
  // muestra 0, dos impactos seguidos sonarian EXACTAMENTE igual y el oido lo
  // detecta enseguida como repeticion mecanica.
  const offset = Math.random() * Math.max(0, NOISE_SECONDS - duration - 0.02);

  const filter = audioCtx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, when);
  if (endFreq) filter.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), when + duration);
  filter.Q.value = q;

  const vca = audioCtx.createGain();
  envelope(vca, when, { attack: 0.002, peak: gain, duration });

  src.connect(filter).connect(vca).connect(masterGain);
  trackVoice(src);
  src.start(when, offset, duration + 0.05);
  src.stop(when + duration + 0.06);
}

// Tono con barrido de frecuencia opcional: cuerpo de los golpes pesados,
// notas de los acordes y sirenas.
function tone({
  when, freq, endFreq = null, duration = 0.2, gain = 0.3, type = 'square',
  attack = 0.004, sustain = 0, detune = 0,
}) {
  if (!audioCtx || voices > MAX_VOICES) return;
  const osc = audioCtx.createOscillator();
  osc.type = type;
  osc.detune.value = detune;
  osc.frequency.setValueAtTime(freq, when);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), when + duration);

  const vca = audioCtx.createGain();
  envelope(vca, when, {
    attack, peak: gain, duration, sustain,
  });

  osc.connect(vca).connect(masterGain);
  trackVoice(osc);
  osc.start(when);
  osc.stop(when + attack + sustain + duration + 0.05);
}

// --- Catalogo de efectos ---------------------------------------------------
// Cada entrada recibe el instante de arranque y compone el sonido con los
// bloques de arriba. Nada de esto guarda estado: se puede llamar dos veces en
// el mismo frame sin efectos secundarios.

const SFX = {
  // Golpe ligero: ruido blanco corto y agudo. Un jab no tiene cuerpo grave,
  // es todo "chasquido".
  hit_light: (t) => {
    noiseBurst({
      when: t, duration: 0.05, gain: 0.5, freq: 2400, endFreq: 900, q: 0.8,
    });
    tone({
      when: t, freq: 320, endFreq: 180, duration: 0.05, gain: 0.18, type: 'triangle',
    });
  },

  // Golpe medio: el mismo chasquido con algo mas de cuerpo por debajo.
  hit_normal: (t) => {
    noiseBurst({
      when: t, duration: 0.07, gain: 0.55, freq: 1500, endFreq: 500, q: 0.9,
    });
    tone({
      when: t, freq: 220, endFreq: 110, duration: 0.09, gain: 0.26, type: 'triangle',
    });
  },

  // Golpe pesado / derribo: bombo de verdad -seno descendente de 180 a 45Hz
  // con pegada- mas un golpe de ruido grave encima. El barrido rapido de
  // frecuencia ES el "thump": un tono fijo suena a pitido, no a impacto.
  hit_heavy: (t) => {
    tone({
      when: t, freq: 180, endFreq: 45, duration: 0.26, gain: 0.85, type: 'sine', attack: 0.002,
    });
    noiseBurst({
      when: t, duration: 0.14, gain: 0.5, type: 'lowpass', freq: 1400, endFreq: 260, q: 0.7,
    });
    tone({
      when: t + 0.01, freq: 90, endFreq: 38, duration: 0.2, gain: 0.35, type: 'square',
    });
  },

  // Bloqueo en guardia: tono metalico seco. Dos cuadradas agudas ligeramente
  // desafinadas entre si (el batido es lo que suena a metal) con decaimiento
  // muy corto: rebote, no impacto.
  guard: (t) => {
    tone({
      when: t, freq: 1560, duration: 0.07, gain: 0.22, type: 'square',
    });
    tone({
      when: t, freq: 2090, duration: 0.05, gain: 0.16, type: 'square', detune: 18,
    });
    noiseBurst({
      when: t, duration: 0.04, gain: 0.3, freq: 3600, q: 2.5,
    });
  },

  // Llave inglesa conectando: golpe METALICO seco. Dos cuadradas agudas en
  // relacion inarmonica (x2.71, no una octava) mas un golpe de ruido con Q
  // alta: esa relacion "desafinada" entre parciales es lo que suena a hierro
  // golpeado en vez de a nota musical. El decaimiento es cortisimo a
  // proposito - una llave no resuena como un gong, da un "clang" y se acaba.
  wrench: (t) => {
    tone({
      when: t, freq: 1180, endFreq: 940, duration: 0.13, gain: 0.34, type: 'square',
    });
    tone({
      when: t, freq: 3200, endFreq: 2400, duration: 0.09, gain: 0.18, type: 'square', detune: 24,
    });
    noiseBurst({
      when: t, duration: 0.07, gain: 0.5, freq: 2800, endFreq: 1100, q: 3.2,
    });
    // Cuerpo grave: el peso de la herramienta detras del chasquido.
    tone({
      when: t, freq: 150, endFreq: 60, duration: 0.18, gain: 0.5, type: 'sine',
    });
  },

  // BIDON DE ACEITE ESTAMPADO. Un bidon no suena como una llave: la llave es
  // un "clang" corto y afinado (parciales muy separados, x2.71), el bidon es
  // CHAPA GRANDE - parciales GRAVES y MUY JUNTOS entre si, que es lo que
  // produce el zumbido sucio de una lata en vez de una nota. Y va de mas a
  // menos: primero el impacto seco contra el craneo, detras la resonancia.
  barrel_slam: (t) => {
    // 1. El impacto seco. Ruido grave que se apaga en 120ms: es el "toc",
    //    lo primero que se oye en un golpe de verdad.
    noiseBurst({
      when: t, duration: 0.12, gain: 0.72, type: 'lowpass', freq: 900, endFreq: 170, q: 0.8,
    });
    // 2. La chapa. Tres parciales juntos y desafinados entre si; el batido
    //    que producen ES el zumbido del bidon.
    [88, 131, 179].forEach((freq, i) => {
      tone({
        when: t + i * 0.004,
        freq,
        // Cae de tono al vaciarse el golpe: un bidon abollado se destensa.
        endFreq: freq * 0.72,
        duration: 0.34,
        gain: 0.2 - i * 0.04,
        type: 'square',
        detune: i * 11,
      });
    });
    // 3. El peso: seno muy grave, como el bombo de un hit_heavy. Es lo que
    //    hace que se sienta un bidon lleno y no una lata vacia.
    tone({
      when: t, freq: 130, endFreq: 42, duration: 0.24, gain: 0.6, type: 'sine',
    });
  },

  // Bloque de motor / embestida con el hombro: mas sordo que la llave, sin
  // brillo agudo - es masa, no filo.
  clank: (t) => {
    tone({
      when: t, freq: 320, endFreq: 110, duration: 0.2, gain: 0.5, type: 'square',
    });
    noiseBurst({
      when: t, duration: 0.12, gain: 0.45, type: 'lowpass', freq: 900, endFreq: 220,
    });
  },

  // Escape de gas comico: ruido blanco pasado por un filtro paso banda que
  // BARRE hacia abajo (de 3kHz a 200Hz) - el barrido del filtro es lo que
  // convierte el ruido en "pfffff" en vez de en estatica - mas una burbuja
  // chiptune descendente encima. El toque comico esta en esa burbuja: sin
  // ella suena a fuga industrial, con ella suena a dibujo animado.
  gas_blast: (t) => {
    noiseBurst({
      when: t, duration: 0.34, gain: 0.55, type: 'bandpass', freq: 3000, endFreq: 200, q: 1.4,
    });
    tone({
      when: t + 0.02, freq: 640, endFreq: 90, duration: 0.3, gain: 0.26, type: 'triangle',
    });
    // Dos "glup" cortos al final: la burbuja que revienta.
    tone({
      when: t + 0.2, freq: 220, endFreq: 420, duration: 0.07, gain: 0.2, type: 'sine',
    });
    tone({
      when: t + 0.28, freq: 300, endFreq: 150, duration: 0.09, gain: 0.16, type: 'sine',
    });
  },

  // ERUCTO SONICO: la gracia esta en el FORMANTE. Un eructo es ruido grave
  // pasado por la cavidad de la boca, asi que se sintetiza con una onda
  // diente de sierra muy grave (75 -> 40 Hz) atravesando dos filtros paso
  // banda a frecuencias de vocal (500 y 1100 Hz, la "a"), y se le mete un
  // temblor de amplitud. Sin los dos formantes suena a motor; con ellos,
  // inconfundible.
  burp: (t) => {
    tone({
      when: t, freq: 78, endFreq: 42, duration: 0.42, gain: 0.5, type: 'sawtooth', attack: 0.02,
    });
    noiseBurst({
      when: t, duration: 0.4, gain: 0.42, type: 'bandpass', freq: 520, endFreq: 380, q: 6,
    });
    noiseBurst({
      when: t + 0.02, duration: 0.34, gain: 0.3, type: 'bandpass', freq: 1150, endFreq: 900, q: 8,
    });
    // Coletilla: el "hueco" final que remata el chiste.
    tone({
      when: t + 0.34, freq: 130, endFreq: 70, duration: 0.14, gain: 0.26, type: 'square',
    });
  },

  // PISOTON: golpe seco de suela contra el suelo, sin brillo agudo.
  stomp: (t) => {
    tone({
      when: t, freq: 120, endFreq: 45, duration: 0.16, gain: 0.6, type: 'sine',
    });
    noiseBurst({
      when: t, duration: 0.09, gain: 0.45, type: 'lowpass', freq: 700, endFreq: 180,
    });
  },

  // CABEZAZO: impacto hueco de craneo, mas mate que un punetazo.
  headbutt: (t) => {
    tone({
      when: t, freq: 210, endFreq: 85, duration: 0.22, gain: 0.7, type: 'sine',
    });
    tone({
      when: t + 0.01, freq: 420, endFreq: 260, duration: 0.1, gain: 0.22, type: 'triangle',
    });
    noiseBurst({
      when: t, duration: 0.07, gain: 0.35, type: 'lowpass', freq: 1200, endFreq: 300,
    });
  },

  // PATADA + BOCANADA: el golpe y, justo detras, el soplido de la calada.
  smoke_kick: (t) => {
    tone({
      when: t, freq: 190, endFreq: 80, duration: 0.18, gain: 0.55, type: 'sine',
    });
    noiseBurst({
      when: t, duration: 0.1, gain: 0.45, freq: 1400, endFreq: 420, q: 0.9,
    });
    // Soplido: ruido filtrado suave y largo, sin pegada.
    noiseBurst({
      when: t + 0.1, duration: 0.3, gain: 0.22, type: 'bandpass', freq: 900, endFreq: 300, q: 1.2,
    });
  },

  // ACOPLE DE MICROFONO: el chirrido agudo de realimentacion. Es un tono
  // que SUBE mientras un ruido muy resonante (Q alta) lo acompana: esa
  // subida es exactamente lo que hace un acople real al realimentarse, y sin
  // ella suena a pitido de horno.
  mic_feedback: (t) => {
    tone({
      when: t, freq: 900, endFreq: 2600, duration: 0.5, gain: 0.3, type: 'sine', attack: 0.03,
    });
    tone({
      when: t + 0.05, freq: 1350, endFreq: 3100, duration: 0.42, gain: 0.16, type: 'triangle',
    });
    noiseBurst({
      when: t, duration: 0.45, gain: 0.3, type: 'bandpass', freq: 1800, endFreq: 3400, q: 14,
    });
  },

  // BERRIDO AL MICRO + salida de la onda: golpe grave con cuerpo y un barrido
  // descendente que "lanza" la onda hacia delante.
  mic_shout: (t) => {
    noiseBurst({
      when: t, duration: 0.26, gain: 0.55, type: 'bandpass', freq: 700, endFreq: 260, q: 3.5,
    });
    tone({
      when: t, freq: 160, endFreq: 65, duration: 0.34, gain: 0.6, type: 'sawtooth', attack: 0.01,
    });
    tone({
      when: t + 0.04, freq: 2400, endFreq: 420, duration: 0.3, gain: 0.2, type: 'square',
    });
  },

  // COMPAS DE RAP: bombo + caja sintetizados, el patron que suena en cada
  // barra de la cinematica. El bombo es un seno que cae en picado y la caja
  // es ruido con un tono corto encima, que es como se hace una caja en un
  // chip de 8 bits.
  rap_beat: (t) => {
    // Bombo
    tone({
      when: t, freq: 150, endFreq: 42, duration: 0.18, gain: 0.7, type: 'sine', attack: 0.002,
    });
    // Caja, medio tiempo despues
    noiseBurst({
      when: t + 0.13, duration: 0.09, gain: 0.45, type: 'highpass', freq: 1400, q: 0.8,
    });
    tone({
      when: t + 0.13, freq: 320, endFreq: 190, duration: 0.07, gain: 0.2, type: 'triangle',
    });
    // Hi-hat de cierre
    noiseBurst({
      when: t + 0.22, duration: 0.04, gain: 0.2, type: 'highpass', freq: 5200, q: 1.2,
    });
  },

  // MIC DROP: el micro cae, rebota y el acople revienta en una explosion
  // sonica. Tres golpes descendentes + el chirrido a plena potencia.
  mic_drop: (t) => {
    tone({
      when: t, freq: 220, endFreq: 90, duration: 0.1, gain: 0.5, type: 'square',
    });
    tone({
      when: t + 0.1, freq: 170, endFreq: 70, duration: 0.08, gain: 0.35, type: 'square',
    });
    // El acople reventando: ruido resonante ancho + subgrave.
    noiseBurst({
      when: t + 0.18, duration: 0.5, gain: 0.6, type: 'bandpass', freq: 2600, endFreq: 500, q: 5,
    });
    tone({
      when: t + 0.18, freq: 90, endFreq: 30, duration: 0.6, gain: 0.75, type: 'sine', attack: 0.004,
    });
    tone({
      when: t + 0.18, freq: 1800, endFreq: 260, duration: 0.45, gain: 0.25, type: 'sawtooth',
    });
  },

  // Armadura aguantando: mas grave y con mas cuerpo que la guardia.
  armor: (t) => {
    tone({
      when: t, freq: 620, endFreq: 380, duration: 0.16, gain: 0.3, type: 'square',
    });
    noiseBurst({
      when: t, duration: 0.09, gain: 0.35, freq: 900, q: 1.6,
    });
  },

  // Activacion de Ultimate: acorde ascendente de recreativa. Cuatro notas
  // encadenadas cada 55ms (La - Do# - Mi - La octava) mas un swell grave por
  // debajo que da la sensacion de "carga".
  ultra: (t) => {
    const notes = [440, 554.37, 659.25, 880];
    notes.forEach((freq, i) => {
      tone({
        when: t + i * 0.055, freq, duration: 0.3, gain: 0.26, type: 'triangle', attack: 0.006,
      });
      tone({
        when: t + i * 0.055, freq: freq * 2, duration: 0.16, gain: 0.1, type: 'square',
      });
    });
    tone({
      when: t, freq: 110, endFreq: 220, duration: 0.42, gain: 0.3, type: 'sawtooth', attack: 0.05,
    });
  },

  // Clean Hit: el instante en que la embestida de captura conecta y el mundo
  // se para. Es deliberadamente SECO -sin cola ni resonancia-: lo que vende
  // la congelacion es el silencio que viene justo detras, y un golpe con
  // reverberacion lo llenaria. Ataque instantaneo, 90ms y fuera.
  ultra_catch: (t) => {
    tone({
      when: t, freq: 300, endFreq: 48, duration: 0.09, gain: 0.95, type: 'square', attack: 0.001,
    });
    noiseBurst({
      when: t, duration: 0.06, gain: 0.7, type: 'bandpass', freq: 3200, endFreq: 900, q: 2.2,
    });
    tone({
      when: t, freq: 70, endFreq: 40, duration: 0.12, gain: 0.5, type: 'sine', attack: 0.001,
    });
  },

  // Impacto dentro de la cinematica de ulti: pesado pero mas corto, para que
  // 5-6 seguidos no se conviertan en una papilla de graves.
  ultra_hit: (t) => {
    tone({
      when: t, freq: 240, endFreq: 70, duration: 0.15, gain: 0.6, type: 'sine',
    });
    noiseBurst({
      when: t, duration: 0.08, gain: 0.45, freq: 2000, endFreq: 600, q: 1,
    });
  },

  // Gong de K.O.: cuatro parciales inarmonicos con decaimiento largo (asi
  // suena un metal grande golpeado, no una nota de sintetizador) mas el golpe
  // de ruido inicial del mazo.
  ko: (t) => {
    noiseBurst({
      when: t, duration: 0.25, gain: 0.55, type: 'lowpass', freq: 2200, endFreq: 300,
    });
    [98, 146.8, 233, 311].forEach((freq, i) => {
      tone({
        when: t + i * 0.012,
        freq,
        endFreq: freq * 0.86,
        duration: 1.5 - i * 0.18,
        gain: 0.3 - i * 0.05,
        type: i % 2 ? 'triangle' : 'sine',
        attack: 0.008,
      });
    });
  },

  // Fin por tiempo: sirena descendente, distinta del gong para que se
  // distinga de oido si ha rematado alguien o ha ganado el reloj.
  time_up: (t) => {
    tone({
      when: t, freq: 880, endFreq: 220, duration: 0.7, gain: 0.3, type: 'sawtooth', attack: 0.02,
    });
    tone({
      when: t + 0.08, freq: 660, endFreq: 165, duration: 0.6, gain: 0.2, type: 'square',
    });
  },

  // Cartel de ROUND N: dos golpes secos de anuncio.
  round_call: (t) => {
    tone({
      when: t, freq: 523.25, duration: 0.12, gain: 0.3, type: 'square',
    });
    tone({
      when: t + 0.14, freq: 783.99, duration: 0.22, gain: 0.3, type: 'square',
    });
  },

  // FIGHT!: acorde corto ascendente con cuerpo.
  fight: (t) => {
    tone({
      when: t, freq: 392, endFreq: 784, duration: 0.3, gain: 0.34, type: 'sawtooth', attack: 0.01,
    });
    tone({
      when: t, freq: 196, duration: 0.34, gain: 0.26, type: 'square',
    });
    noiseBurst({
      when: t, duration: 0.12, gain: 0.3, freq: 1800, endFreq: 400,
    });
  },

  // Cuenta atras 3-2-1 y aviso de los ultimos 10 segundos del reloj.
  countdown: (t) => tone({
    when: t, freq: 660, duration: 0.11, gain: 0.26, type: 'square',
  }),
  countdown_go: (t) => tone({
    when: t, freq: 1320, duration: 0.22, gain: 0.3, type: 'square',
  }),
  timer_tick: (t) => tone({
    when: t, freq: 1046, duration: 0.05, gain: 0.14, type: 'square',
  }),

  // Navegacion por menus (seleccion de personaje y menu post-partida).
  menu_move: (t) => tone({
    when: t, freq: 520, duration: 0.05, gain: 0.2, type: 'square',
  }),
  menu_confirm: (t) => {
    tone({
      when: t, freq: 700, duration: 0.07, gain: 0.24, type: 'square',
    });
    tone({
      when: t + 0.06, freq: 1050, duration: 0.14, gain: 0.24, type: 'square',
    });
  },
  menu_cancel: (t) => tone({
    when: t, freq: 420, endFreq: 240, duration: 0.12, gain: 0.22, type: 'square',
  }),

  // Fanfarria de victoria: arpegio mayor ascendente + remate sostenido.
  // --- Platform fighter --------------------------------------------------
  // Salto: barrido ascendente corto. Es el sonido que más se repite del
  // juego, así que es flojo y seco a propósito.
  jump: (t) => tone({
    when: t, freq: 260, endFreq: 520, duration: 0.07, gain: 0.12, type: 'triangle',
  }),
  // Aterrizaje: golpe de ruido grave, sin tono.
  land: (t) => noiseBurst({
    when: t, duration: 0.05, gain: 0.28, type: 'lowpass', freq: 700, endFreq: 200, q: 0.7,
  }),
  // Agarre de borde: el "clac" metálico de la cantonera.
  ledge: (t) => {
    tone({
      when: t, freq: 1400, endFreq: 1100, duration: 0.05, gain: 0.16, type: 'square',
    });
    noiseBurst({
      when: t, duration: 0.03, gain: 0.2, freq: 3000, q: 2,
    });
  },
  // Esquiva: soplido de ruido que sube.
  dodge: (t) => noiseBurst({
    when: t, duration: 0.12, gain: 0.22, freq: 600, endFreq: 2600, q: 1.2,
  }),
  // Escudo roto: cristal que se rompe (ruido agudo) y un tono que cae.
  shield_break: (t) => {
    noiseBurst({
      when: t, duration: 0.3, gain: 0.5, type: 'highpass', freq: 2400, q: 0.6,
    });
    tone({
      when: t, freq: 900, endFreq: 120, duration: 0.45, gain: 0.3, type: 'square',
    });
  },
  // K.O. por blast zone: explosión grave y larga con un chasquido encima.
  ko_blast: (t) => {
    tone({
      when: t, freq: 120, endFreq: 30, duration: 0.7, gain: 0.8, type: 'sine', attack: 0.003,
    });
    noiseBurst({
      when: t, duration: 0.6, gain: 0.6, type: 'lowpass', freq: 2200, endFreq: 150, q: 0.6,
    });
    noiseBurst({
      when: t, duration: 0.08, gain: 0.5, freq: 4000, q: 1.5,
    });
  },

  // SPECIAL ZOOM: chasquido SECO y el sonido se desploma (un grave que cae a
  // subgrave) con tres ecos cada vez más flojos — la reverberación del
  // instante congelado. El estallido del lanzamiento suena al soltarse la
  // congelación (main.js), no aquí.
  special_zoom: (t) => {
    noiseBurst({
      when: t, duration: 0.04, gain: 0.7, type: 'highpass', freq: 3200, q: 0.8,
    });
    tone({
      when: t, freq: 220, endFreq: 38, duration: 0.55, gain: 0.55, type: 'sine', attack: 0.002,
    });
    [0.11, 0.22, 0.33].forEach((d, i) => {
      noiseBurst({
        when: t + d, duration: 0.07, gain: 0.3 / (i + 1), type: 'bandpass', freq: 1800 - i * 450, q: 1.4,
      });
    });
  },
  // Robo de borde: el clac de la cantonera y un soplido de expulsión.
  ledge_trump: (t) => {
    tone({
      when: t, freq: 1500, endFreq: 900, duration: 0.06, gain: 0.2, type: 'square',
    });
    noiseBurst({
      when: t + 0.02, duration: 0.14, gain: 0.26, freq: 900, endFreq: 3000, q: 1.1,
    });
  },

  victory: (t) => {
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      tone({
        when: t + i * 0.1, freq, duration: 0.26, gain: 0.26, type: 'square',
      });
      tone({
        when: t + i * 0.1, freq: freq / 2, duration: 0.26, gain: 0.16, type: 'triangle',
      });
    });
    tone({
      when: t + 0.42, freq: 1046.5, duration: 0.6, gain: 0.3, type: 'square', sustain: 0.1,
    });
  },
};

// Punto de entrada unico. Si el contexto todavia no existe (nadie ha tocado
// una tecla ni hecho clic) no hace absolutamente nada - nunca lanza.
export function playSfx(name, { delay = 0 } = {}) {
  if (muted || !audioCtx || audioCtx.state !== 'running') return;
  const fn = SFX[name];
  if (!fn) return;
  fn(audioCtx.currentTime + delay);
}

export function hasAudioContext() {
  return !!audioCtx && audioCtx.state === 'running';
}
