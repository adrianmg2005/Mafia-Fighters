// FASE CANÓNICA DE UN MOVIMIENTO: el reloj con el que se anima un golpe.
//
// El `progress` de la vista de un luchador en un movimiento NO es
// frame / frames. Es la fase del golpe en una línea de tiempo común a todos:
//
//   [0, 0.3)    ARRANQUE      anticipación: carga, echarse atrás, levantar
//   [0.3, 0.5)  ACTIVOS       el impacto: el miembro o el arma donde está la caja
//   [0.5, 1]    RECUPERACIÓN  follow-through y vuelta a la guardia
//
// y cada tramo se estira sobre los frames que ocupa de verdad ESE movimiento.
//
// POR QUÉ. Con frame / frames cada pose tenía el pico escrito a mano en un %
// que no coincidía con los frames activos, y varios movimientos con frame data
// distinta compartían pose. Rasterizado frame a frame con las cajas encima
// (tests/renderMoves.mjs), el golpe visible llegaba DESPUÉS de que la caja se
// apagara en el F-Tilt, el codazo, el Bair, el Fair, el D-Smash y el eructo
// cargado, y en el U-Tilt la caja estaba sobre la cabeza con la llave
// apuntando al suelo. Con la fase canónica, una pose se escribe UNA vez con
// su impacto en [0.3, 0.5) y cuadra con cualquier frame data: si alguien
// retoca los frames de un golpe, la animación sigue sincronizada sola.
//
// Es presentación pura: lo calcula el Fighter para su vista (el remoto no
// conoce la moveTable) y no cambia nada de la simulación.

export const IMPACT_START = 0.3;
export const IMPACT_END = 0.5;

const windows = new WeakMap();

/**
 * Frames "activos" de un movimiento, [primero, último] (inclusive): la unión
 * de sus hitboxes (agarres incluidos). Si no tiene, lo que hace de impacto:
 * la ventana del contraataque, el frame del lanzamiento o del golpe del
 * agarre, o el primer proyectil o efecto que suelta. null si no hay nada.
 */
export function activeWindow(move) {
  if (windows.has(move)) return windows.get(move);
  let win = null;
  const extend = (a, b) => {
    win = win ? [Math.min(win[0], a), Math.max(win[1], b)] : [a, b];
  };
  for (const hb of move.hitboxes || []) extend(hb.from, hb.to);
  if (!win && move.counter) extend(move.counter.from, move.counter.to);
  if (!win && move.throw) extend(move.throw.frame, move.throw.frame);
  if (!win && move.pummel) extend(move.pummel.frame, move.pummel.frame);
  if (!win && move.spawn?.length) extend(move.spawn[0].frame, move.spawn[0].frame);
  if (!win && move.fx?.length) extend(move.fx[0].frame, move.fx[0].frame);
  windows.set(move, win);
  return win;
}

/** Fase canónica (0..1) del frame `frame` de `move`. */
export function movePhase(move, frame) {
  const n = move.frames ?? 1;
  const win = activeWindow(move);
  if (!win || n <= 1) return Math.max(0, Math.min(1, frame / n));
  const first = Math.max(0, Math.min(win[0], n - 1));
  const end = Math.max(first + 1, Math.min(n, win[1] + 1)); // exclusivo
  if (frame < first) return first > 0 ? (IMPACT_START * frame) / first : IMPACT_START;
  if (frame < end) return IMPACT_START + ((IMPACT_END - IMPACT_START) * (frame - first)) / (end - first);
  return Math.min(1, IMPACT_END + ((1 - IMPACT_END) * (frame - end)) / Math.max(1, n - end));
}
