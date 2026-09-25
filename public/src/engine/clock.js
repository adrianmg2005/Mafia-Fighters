// Reloj de simulación independiente del dibujado.
//
// POR QUÉ EXISTE: el bucle del juego estaba atado a `requestAnimationFrame`,
// y el navegador **no ejecuta rAF en una pestaña de fondo**. Como el modelo
// es host-autoritativo (solo p1 simula), bastaba con hacer clic en la
// pestaña de p2 para que la de p1 dejara de tickear y la partida entera se
// congelara: el input de p2 viajaba bien hasta `peerInputP2` en el host, pero
// nadie lo consumía porque `hostUpdate()` ya no corría. El síntoma era "P2 no
// responde"; la causa, que el motor dependía del ciclo de dibujado.
//
// POR QUÉ UN WORKER Y NO UN setInterval NORMAL: los temporizadores del hilo
// principal también se estrangulan en segundo plano — Chrome los limita a
// 1/segundo, y tras unos minutos oculta aplica "intensive throttling" y baja
// a 1/minuto. Un Worker dedicado no está sujeto a ese recorte, así que su
// `setInterval` sigue latiendo a ritmo real aunque la pestaña esté detrás.
//
// El fallback a `setInterval` en el hilo principal está por si el entorno no
// permite Workers ni blob: URLs (algún CSP estricto). Entonces el juego sigue
// funcionando en primer plano y solo se degrada al pasar a segundo plano,
// que es exactamente el comportamiento anterior — nunca peor.

const WORKER_SOURCE = `
  let timer = null;
  self.onmessage = (event) => {
    const data = event.data || {};
    if (data.type === 'start') {
      if (timer !== null) clearInterval(timer);
      timer = setInterval(() => self.postMessage(1), data.intervalMs);
    } else if (data.type === 'stop') {
      if (timer !== null) clearInterval(timer);
      timer = null;
    }
  };
`;

function tryCreateWorkerClock(intervalMs, onTick) {
  if (typeof Worker !== 'function' || typeof Blob !== 'function' || typeof URL?.createObjectURL !== 'function') {
    return null;
  }
  try {
    const blob = new Blob([WORKER_SOURCE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    // La URL se puede liberar en cuanto el Worker está construido: ya tiene
    // su copia del código.
    URL.revokeObjectURL(url);
    worker.onmessage = () => onTick();
    worker.postMessage({ type: 'start', intervalMs });
    return {
      backgroundSafe: true,
      stop() {
        worker.postMessage({ type: 'stop' });
        worker.terminate();
      },
    };
  } catch {
    return null;
  }
}

// Arranca un reloj que llama a `onTick` cada ~intervalMs, también con la
// pestaña en segundo plano. El consumidor NO debe asumir que el intervalo es
// exacto: tiene que medir el tiempo real transcurrido (performance.now()) y
// usar un acumulador, como hace main.js.
export function createSimulationClock({ intervalMs = 1000 / 60, onTick }) {
  const viaWorker = tryCreateWorkerClock(intervalMs, onTick);
  if (viaWorker) return viaWorker;

  const timer = setInterval(onTick, intervalMs);
  return {
    backgroundSafe: false,
    stop() { clearInterval(timer); },
  };
}
