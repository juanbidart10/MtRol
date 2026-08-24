export const MTROL_CLASS_RESOURCE_PROFILES = Object.freeze({
  physical: Object.freeze({
    hpPerResistance: 10,
    mpPerIntelligence: 5
  }),
  magicHybrid: Object.freeze({
    hpPerResistance: 5,
    mpPerIntelligence: 10
  })
});

const PHYSICAL_CLASSES = Object.freeze([
  ["asesino", "Asesino"],
  ["bandido", "Bandido"],
  ["caballero", "Caballero"],
  ["cazador", "Cazador"],
  ["comerciante", "Comerciante"],
  ["espadachin", "Espadachín"],
  ["explorador", "Explorador"],
  ["guerrero", "Guerrero"],
  ["inventor", "Inventor"],
  ["ladron", "Ladrón"],
  ["monje", "Monje"],
  ["ninja", "Ninja"],
  ["paladin", "Paladín"],
  ["valkiria", "Valkiria"]
]);

const MAGIC_HYBRID_CLASSES = Object.freeze([
  ["nigromante", "Nigromante"],
  ["bruja", "Bruja"],
  ["chaman", "Chamán"],
  ["druida", "Druida"],
  ["guardian", "Guardián"],
  ["hechicero", "Hechicero"],
  ["mago", "Mago"],
  ["oraculo", "Oráculo"],
  ["alquimista", "Alquimista"],
  ["clerigo", "Clérigo"],
  ["bardo", "Bardo"]
]);

function createClassDefinitions(entries, resourceProfile) {
  return entries.map(([id, label]) => Object.freeze({
    id,
    label,
    resourceProfile
  }));
}

const CLASS_DEFINITIONS = Object.freeze([
  ...createClassDefinitions(PHYSICAL_CLASSES, "physical"),
  ...createClassDefinitions(MAGIC_HYBRID_CLASSES, "magicHybrid")
]);

export const MTROL_CLASS_IDS = Object.freeze(
  CLASS_DEFINITIONS.map(definition => definition.id)
);

export const MTROL_CLASS_REGISTRY = Object.freeze(
  Object.fromEntries(CLASS_DEFINITIONS.map(definition => [definition.id, definition]))
);

export function isValidClassId(classId) {
  return typeof classId === "string" &&
    Object.hasOwn(MTROL_CLASS_REGISTRY, classId);
}

export function getClassDefinition(classId) {
  return isValidClassId(classId) ? MTROL_CLASS_REGISTRY[classId] : null;
}

export function getResourceProfileForClass(classId) {
  const definition = getClassDefinition(classId);
  return definition
    ? MTROL_CLASS_RESOURCE_PROFILES[definition.resourceProfile] ?? null
    : null;
}

export const getClassResourceProfile = getResourceProfileForClass;

export function getAllClassDefinitions() {
  return CLASS_DEFINITIONS.map(definition => ({ ...definition }));
}
