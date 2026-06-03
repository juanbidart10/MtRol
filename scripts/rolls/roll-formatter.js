// =========================
// MTROL - ROLL FORMATTER
// =========================
// Utilidades visuales para fórmulas y chat.
// =========================

export function mtrolCrearFormulaVisual(formula, etiquetas = {}) {
  let visual = formula;

  for (const [clave, etiqueta] of Object.entries(etiquetas)) {
    visual = visual.replaceAll(`@${clave}`, etiqueta);
  }

  return visual;
}

export function mtrolNormalizarFormulaVisual(formulaVisual) {
  return String(formulaVisual ?? "")
    .replaceAll("d", "D");
}