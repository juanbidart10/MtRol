import {
  getClassDefinition,
  getEffectiveClassDomain,
  isValidClassDomain
} from "./class-registry.js";

import {
  isCanonicalCompetencyTechnicalId
} from "../competencies/competency-catalog.js";

import {
  createCanonicalCompetencyItemData
} from "../competencies/competency-item-factory.js";

function actorItems(actor) {
  const collection = actor?.items;
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection?.contents)) return collection.contents;
  if (typeof collection?.values === "function") return Array.from(collection.values());
  return Array.from(collection ?? []);
}

function validateApprenticeSelection(definition, selections) {
  const contract = definition.competencySelection;
  if (!Array.isArray(selections) || selections.length !== contract.count) {
    throw new Error(`Aprendiz requiere exactamente ${contract.count} Competencias.`);
  }
  const normalized = selections.map(value => String(value ?? "").trim());
  if (contract.unique && new Set(normalized).size !== contract.count) {
    throw new Error("Las Competencias de Aprendiz deben ser distintas.");
  }
  if (normalized.some(id => !isCanonicalCompetencyTechnicalId(id))) {
    throw new Error("Aprendiz contiene una Competencia fuera del catálogo canónico.");
  }
  if (contract.initialLevel !== 1) {
    throw new Error("El contrato de Aprendiz debe otorgar nivel inicial 1.");
  }
  return normalized.map(technicalId => ({ technicalId, level: 1 }));
}

export function resolveClassApplication({
  classId,
  classDomain = null,
  competencySelections = null
} = {}) {
  const definition = getClassDefinition(classId);
  if (!definition) throw new Error("La Clase solicitada no existe.");

  if (definition.technicalId === "aprendiz") {
    if (!isValidClassDomain(classDomain)) {
      throw new Error("Aprendiz requiere un domain physical, magical o hybrid explícito.");
    }
    return {
      definition,
      domain: classDomain,
      competencies: validateApprenticeSelection(definition, competencySelections)
    };
  }

  if (competencySelections !== null && competencySelections !== undefined) {
    throw new Error("Sólo Aprendiz admite selección manual de Competencias.");
  }

  return {
    definition,
    domain: getEffectiveClassDomain(definition.technicalId),
    competencies: definition.initialCompetencies.map(entry => ({ ...entry }))
  };
}

export function planClassInitialCompetencies(actor, application) {
  const indexed = new Map();
  const duplicateIds = new Set();

  for (const item of actorItems(actor)) {
    if (item?.type !== "competencia") continue;
    const technicalId = String(item.system?.technicalId ?? "").trim();
    if (!isCanonicalCompetencyTechnicalId(technicalId)) continue;
    if (indexed.has(technicalId)) duplicateIds.add(technicalId);
    else indexed.set(technicalId, item);
  }

  const requestedIds = new Set(application.competencies.map(entry => entry.technicalId));
  const conflicts = [...duplicateIds]
    .filter(technicalId => requestedIds.has(technicalId))
    .map(technicalId => ({
      type: "duplicate-technical-id",
      technicalId,
      itemIds: actorItems(actor)
        .filter(item => item?.type === "competencia" && item.system?.technicalId === technicalId)
        .map(item => item.id ?? item._id ?? null)
    }));

  const missing = application.competencies.filter(entry => !indexed.has(entry.technicalId));

  return {
    application,
    existing: application.competencies.filter(entry => indexed.has(entry.technicalId)),
    missing,
    conflicts,
    createData: missing.map(entry =>
      createCanonicalCompetencyItemData(entry.technicalId, { level: entry.level })
    )
  };
}

export function prepareClassInitialCompetencyGrant(actor, options = {}) {
  const application = resolveClassApplication(options);
  return planClassInitialCompetencies(actor, application);
}
