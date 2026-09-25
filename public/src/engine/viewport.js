// Ajusta el tamaño en pantalla del canvas para llenar la ventana manteniendo
// su resolución lógica (y por tanto su relación de aspecto) intacta: el
// resultado es letterboxing/pillarboxing automático (barras negras del body)
// sin recurrir a CSS aspect-ratio, que no cubre bien todos los ratios de
// ventana. La resolución interna del canvas (canvas.width/height) no cambia
// aquí, así que image-rendering: pixelated se mantiene nítido a cualquier
// tamaño de pantalla.
export function initResponsiveCanvas(canvas, logicalWidth, logicalHeight) {
  function resize() {
    const scale = Math.min(
      window.innerWidth / logicalWidth,
      window.innerHeight / logicalHeight,
    );
    canvas.style.width = `${logicalWidth * scale}px`;
    canvas.style.height = `${logicalHeight * scale}px`;
  }

  window.addEventListener('resize', resize);
  resize();
}
