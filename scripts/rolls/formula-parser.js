// =========================
// MTROL - FORMULA PARSER
// =========================
// Prepara el contexto de fórmula para Roll:
// - @atributos
// - @recursos
// - @vitales
// - @competencias.nombre
// - @mano
// - @manoDer
// - @manoIzq
// =========================

import {
  mtrolSlug,
  mtrolObtenerDanioManos
} from "./roll-helpers.js";

export function mtrolPrepararRollData(actor) {
  const data =
    actor?.getRollData
      ? actor.getRollData()
      : {};

  data.atributos =
    actor?.system?.atributos ?? {};

  data.recursos =
    actor?.system?.recursos ?? {};

  data.vitales =
    actor?.system?.vitales ?? {};

  data.competencias =
    data.competencias ?? {};

  const etiquetas = {
    "atributos.aura": "AURA",
    "atributos.percepcion": "PERCEPCIÓN",
    "atributos.fuerza": "FUERZA",
    "atributos.destreza": "DESTREZA",
    "atributos.inteligencia": "INTELIGENCIA",
    "atributos.voluntad": "VOLUNTAD",
    "atributos.resistencia": "RESISTENCIA",
    "atributos.carisma": "CARISMA",
    "atributos.suerte": "SUERTE",

    mano: "DAÑO DE MANO",
    manoDer: "MANO DERECHA",
    manoIzq: "MANO IZQUIERDA"
  };

  const danioManos =
    mtrolObtenerDanioManos(actor);

  data.mano =
    danioManos.total;

  data.manoDer =
    danioManos.manoDer;

  data.manoIzq =
    danioManos.manoIzq;

  for (const item of actor?.items ?? []) {
    if (item.type !== "competencia") continue;

    const slug =
      mtrolSlug(item.name);

    if (!slug) continue;

    const nivel =
      Number(item.system?.nivel ?? 0);

    data.competencias[slug] =
      nivel;

    etiquetas[`competencias.${slug}`] =
      item.name.toUpperCase();
  }

  return {
    data,
    etiquetas,
    danioManos
  };
}