// Utilidades de pintado de escenarios, compartidas por el fondo lejano
// (engine/backdrop.js) y el escenario de combate (engine/stage.js).

// Ruido determinista: un escenario se hornea una vez, pero tiene que salir
// IGUAL en todas las máquinas (host y clientes ven el mismo fondo) y en cada
// recarga. Math.random() aquí daría un escenario distinto por pestaña.
export function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// Todo el arte de escenario se dibuja sobre la misma rejilla que los sprites
// (2 px), para que no haya un solo borde a medio píxel cuando el canvas se
// escala a pantalla completa.
export const PIXEL_UNIT = 2;

export function makePix(ctx, u = PIXEL_UNIT) {
  const snap = (v) => Math.round(v / u) * u;
  const snapSize = (v) => Math.max(u, Math.round(v / u) * u);
  return {
    unit: u,
    // Se expone el snapeo porque un escenario a veces necesita alinear sus
    // bordes A MANO: `rect` redondea el origen y el tamaño por separado, así
    // que una serie de franjas contiguas de alto variable puede abrir una fila
    // sin pintar entre dos. Snapeando los bordes antes, no hay drift posible.
    snap,
    rect(x, y, w, h, color) {
      ctx.fillStyle = color;
      ctx.fillRect(snap(x), snap(y), snapSize(w), snapSize(h));
    },
    dot(x, y, color, size = u) {
      ctx.fillStyle = color;
      ctx.fillRect(snap(x), snap(y), size, size);
    },
  };
}
