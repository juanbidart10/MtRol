// =========================
// MTROL - CATEGORIES
// =========================

export const MTROL_CATEGORIES = {

  PASIVA: "pasiva",

  BASICO: "basico",

  COMPETENCIA: "competencia",

  HECHIZO: "hechizo",

  COMBATE: "combate",

  CONTRAATAQUE: "contraataque"

};

// =========================
// HELPERS
// =========================

export function normalizarCategoria(valor) {

  return String(valor ?? "")
    .trim()
    .toLowerCase();

}

export function esCategoria(item, categoria) {

  return normalizarCategoria(
    item?.system?.categoria
  ) === categoria;

}