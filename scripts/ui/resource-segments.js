export function prepareFiveSegmentResource(value, {
  resource = "",
  editable = false
} = {}) {
  const numericValue = Number(value);
  const clampedValue = Number.isFinite(numericValue)
    ? Math.min(5, Math.max(0, Math.trunc(numericValue)))
    : 0;

  return {
    value: clampedValue,
    segments: Array.from({ length: 5 }, (_entry, index) => ({
      active: index < clampedValue,
      // El quinto punto se alcanza solamente por el flujo automático que
      // genera la carta. Volver a pulsar el último segmento activo resta uno,
      // de modo que el primero también permite vaciar el recurso a 0.
      editable: editable === true && index < 4,
      position: index + 1,
      resource,
      value: index + 1
    }))
  };
}
