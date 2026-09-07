import {
  getRacialPassiveDefinition
} from "./racial-passive-catalog.js";

const RACE_SOURCE = [
  ["humano", "Humano", 1, { voluntad: 1, carisma: 1 }, "prodigio"],
  ["elfo", "Elfo", 1, { inteligencia: 1, percepcion: 1 }, "comunicacion_animal"],
  ["elfo_oscuro", "Elfo Oscuro", 1, { destreza: 1, percepcion: 1 }, "maldito_alimentacion"],
  ["enano", "Enano", 1, { fuerza: 1, resistencia: 1 }, "inquebrantable"],
  ["orco", "Orco", 2, { resistencia: 1, fuerza: 2 }, "sed_de_batalla"],
  ["gnomo", "Gnomo", 2, { aura: 1, percepcion: 1, inteligencia: 1 }, "elemental"],
  ["sellado", "Sellado", 2, { percepcion: 1, voluntad: 1, carisma: 1 }, "anima"],
  ["draconiano", "Draconiano", 2, { voluntad: 1, destreza: 1, aura: 1 }, "frenesi"],
  ["animalium", "Animalium", 3, { percepcion: 1, fuerza: 2, destreza: 1 }, "instinto_racial"],
  ["hada", "Hada", 3, { aura: 1, destreza: 1, carisma: 1, percepcion: 1 }, "virtus"],
  ["maldito", "Maldito", 3, { percepcion: 1, inteligencia: 2, carisma: 1 }, "maldicion"],
  ["bendito", "Bendito", 3, { voluntad: 1, carisma: 1, aura: 2 }, "bendicion"],
  ["espectral", "Espectral", 3, { voluntad: 1, carisma: 1, inteligencia: 1, aura: 1 }, "trascendental"],
  ["oscuro", "Oscuro", 4, { fuerza: 1, aura: 1, inteligencia: 1, resistencia: 1, destreza: 1 }, "subyugador"],
  ["iluminado", "Iluminado", 4, { fuerza: 1, aura: 1, inteligencia: 1, resistencia: 1, voluntad: 1 }, "celestial"],
  ["eterno", "Eterno", 5, { resistencia: 2, inteligencia: 2, voluntad: 2 }, "infinito"]
];

const RACE_DEFINITIONS = Object.freeze(RACE_SOURCE.map(([
  technicalId, displayName, unlockLevel, creationAttributeBonuses, basePassiveId
]) => Object.freeze({
  technicalId,
  displayName,
  unlockLevel,
  creationAttributeBonuses: Object.freeze({ ...creationAttributeBonuses }),
  basePassiveId
})));

export const MTROL_RACE_IDS = Object.freeze(
  RACE_DEFINITIONS.map(definition => definition.technicalId)
);

export const MTROL_RACE_CATALOG = Object.freeze(Object.fromEntries(
  RACE_DEFINITIONS.map(definition => [definition.technicalId, definition])
));

function normalizeLabel(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("es");
}

const RACE_ID_BY_NORMALIZED_LABEL = Object.freeze(Object.fromEntries(
  RACE_DEFINITIONS.map(definition => [normalizeLabel(definition.displayName), definition.technicalId])
));

export function getRaceDefinition(technicalId) {
  return MTROL_RACE_CATALOG[String(technicalId ?? "").trim()] ?? null;
}

export function getAllRaceDefinitions() {
  return RACE_DEFINITIONS;
}

export function isValidRaceId(technicalId) {
  return getRaceDefinition(technicalId) !== null;
}

export function getCanonicalRaceIdByLabel(label) {
  return RACE_ID_BY_NORMALIZED_LABEL[normalizeLabel(label)] ?? null;
}

export function validateRaceCatalog() {
  const errors = [];
  if (RACE_DEFINITIONS.length !== 16) errors.push("RaceCatalog debe contener 16 Razas.");
  if (new Set(MTROL_RACE_IDS).size !== RACE_DEFINITIONS.length) errors.push("Hay technicalId de Raza duplicados.");
  for (const definition of RACE_DEFINITIONS) {
    const passive = getRacialPassiveDefinition(definition.basePassiveId);
    if (!passive) errors.push(`${definition.technicalId} referencia una pasiva inexistente.`);
    else if (passive.sourceRaceId !== definition.technicalId || passive.unlockLevel !== definition.unlockLevel) {
      errors.push(`${definition.technicalId} no coincide con la identidad de su pasiva.`);
    }
  }
  return { valid: errors.length === 0, errors };
}

