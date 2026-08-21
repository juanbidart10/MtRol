import {
  MTROL_CATEGORIES,
  normalizarCategoria
} from "../core/categories.js";

/**
 * True only for the canonical, ordinary Competencia family eligible for
 * progression points. Names and presentation labels are deliberately ignored.
 */
export function isProgressionCompetence(item) {
  return item?.type === "competencia"
    && normalizarCategoria(item.system?.categoria) === MTROL_CATEGORIES.COMPETENCIA
    && item.system?.tipo !== "habilidad-combate";
}
