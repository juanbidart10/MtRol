import {
  getCompetencyFormula,
  isCanonicalCompetencyTechnicalId,
  MTROL_COMPETENCY_TECHNICAL_IDS
} from "./competency-catalog.js";

import { logger } from "../utils/logger.js";

export function buildCompetencyFormulaContext(items = [], {
  actorUuid = null
} = {}) {
  const indexed = new Map();
  const duplicates = new Set();
  const data = Object.fromEntries(
    MTROL_COMPETENCY_TECHNICAL_IDS.map(technicalId => [technicalId, 0])
  );
  const labels = {};

  for (const item of items ?? []) {
    if (item?.type !== "competencia") continue;

    const technicalId = String(item.system?.technicalId ?? "").trim();
    if (!isCanonicalCompetencyTechnicalId(technicalId)) continue;

    if (indexed.has(technicalId)) {
      duplicates.add(technicalId);
      data[technicalId] = 0;
      delete labels[`competencias.${technicalId}`];
      continue;
    }

    indexed.set(technicalId, item);
    const formula = getCompetencyFormula(item.system?.nivel);

    if (!formula) {
      data[technicalId] = 0;
      logger.warnOnce("FORMULA", "Nivel de competencia inválido; la referencia resuelve a 0", {
        actorUuid,
        itemUuid: item.uuid ?? null,
        technicalId,
        level: item.system?.nivel ?? null
      }, { key: `competency-level:${item.uuid ?? technicalId}` });
      continue;
    }

    data[technicalId] = `(${formula})`;
    labels[`competencias.${technicalId}`] = String(item.name ?? technicalId).toUpperCase();
  }

  for (const technicalId of duplicates) {
    logger.warnOnce("FORMULA", "technicalId de competencia duplicado; la referencia resuelve a 0", {
      actorUuid,
      technicalId
    }, { key: `competency-duplicate:${actorUuid ?? "unknown"}:${technicalId}` });
  }

  return { data, labels, indexed, duplicates };
}
