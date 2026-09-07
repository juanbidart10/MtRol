// =========================
// MTROL - FORMULA PARSER
// =========================
// Prepara el contexto de fórmula para Roll:
// - @atributos
// - @recursos
// - @vitales
// - @competencias.<technicalId>
// - @mano
// - @manoDer
// - @manoIzq
// =========================

import {
  mtrolObtenerDanioManos,
  mtrolResolverDanioArmas
} from "./roll-helpers.js";

import {
  buildCompetencyFormulaContext
} from "../competencies/competency-formula-context.js";

export function mtrolPrepararRollData(actor, { includeWeapons = false } = {}) {
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

  const competencyContext =
    buildCompetencyFormulaContext(actor?.items ?? [], {
      actorUuid: actor?.uuid ?? null
    });

  data.competencias =
    competencyContext.data;

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
    manoIzq: "MANO IZQUIERDA",
    ...competencyContext.labels
  };

  const danioManos =
    mtrolObtenerDanioManos(actor);

  data.mano =
    danioManos.total;

  data.manoDer =
    danioManos.manoDer;

  data.manoIzq =
    danioManos.manoIzq;

  const armas = includeWeapons ? mtrolResolverDanioArmas(actor) : { total: 0, items: [] };
  data.armas = armas.total;
  etiquetas.armas = "@ARMAS";

  return {
    data,
    etiquetas,
    danioManos,
    armas
  };
}
