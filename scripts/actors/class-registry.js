import { isCanonicalCompetencyTechnicalId } from "../competencies/competency-catalog.js";

export const MTROL_CLASS_RESOURCE_PROFILES = Object.freeze({
  physical: Object.freeze({ hpPerResistance: 10, mpPerIntelligence: 5 }),
  magicHybrid: Object.freeze({ hpPerResistance: 5, mpPerIntelligence: 10 })
});

export const MTROL_CLASS_DOMAINS = Object.freeze({
  PHYSICAL: "physical",
  MAGICAL: "magical",
  HYBRID: "hybrid"
});

export const MTROL_CLASS_FAMILIES = Object.freeze({
  PHYSICAL: "PHYSICAL",
  MAGICAL: "MAGICAL",
  HYBRID: "HYBRID"
});

const FAMILY_BY_DOMAIN = Object.freeze({
  physical: MTROL_CLASS_FAMILIES.PHYSICAL,
  magical: MTROL_CLASS_FAMILIES.MAGICAL,
  hybrid: MTROL_CLASS_FAMILIES.HYBRID
});

const COUNTERATTACK_DOMAINS_BY_FAMILY = Object.freeze({
  [MTROL_CLASS_FAMILIES.PHYSICAL]: Object.freeze(["PHYSICAL"]),
  [MTROL_CLASS_FAMILIES.MAGICAL]: Object.freeze(["MAGICAL"]),
  [MTROL_CLASS_FAMILIES.HYBRID]: Object.freeze(["PHYSICAL"])
});

// Contrato preexistente: se conserva sin ampliar ni ejecutar nuevas habilidades.
const CLASS_SPECIAL_ABILITIES = Object.freeze({
  mago: Object.freeze({
    specialAbility1: Object.freeze({
      key: "orbe-control", label: "Orbe Control", handler: "orb-contextual",
      legacyNames: Object.freeze(["Orbe Control"])
    }),
    specialAbility2: Object.freeze({
      key: "orbe-aumentado", label: "Orbe Aumentado", handler: "orb-contextual",
      legacyNames: Object.freeze(["Orbe Aumentado"])
    })
  })
});

const CLASS_CATALOG_SOURCE = [
  ["asesino", "Asesino", "physical", ["combate_con_armas", "evasion", "apunalar"]],
  ["bandido", "Bandido", "physical", ["combate_con_armas", "evasion", "apunalar"]],
  ["caballero", "Caballero", "physical", ["combate_con_armas", "defensa_con_escudos", "etiqueta"]],
  ["cazador", "Cazador", "physical", ["combate_a_distancia", "orientacion", "supervivencia"]],
  ["comerciante", "Comerciante", "physical", ["comercio", "etiqueta", "politica"]],
  ["espadachin", "Espadachín", "physical", ["combate_con_armas", "evasion", "supervivencia"]],
  ["explorador", "Explorador", "physical", ["transportes", "cartografia", "orientacion"]],
  ["guerrero", "Guerrero", "physical", ["combate_con_armas", "defensa_con_escudos", "supervivencia"]],
  ["inventor", "Inventor", "physical", ["carpinteria", "simbologia", "comercio"]],
  ["ladron", "Ladrón", "physical", ["robar", "politica", "comercio"]],
  ["monje", "Monje", "physical", ["combate_sin_armas", "meditar", "simbologia"]],
  ["ninja", "Ninja", "physical", ["combate_con_armas", "combate_a_distancia", "evasion"]],
  ["paladin", "Paladín", "physical", ["combate_con_armas", "defensa_con_escudos", "monturas"]],
  ["valkiria", "Valkiria", "physical", ["combate_con_armas", "medicina", "monturas"]],
  ["alquimista", "Alquimista", "hybrid", ["alquimia", "magia", "botanica"]],
  ["clerigo", "Clérigo", "hybrid", ["combate_con_armas", "magia", "meditar"]],
  ["bardo", "Bardo", "hybrid", ["musica", "magia", "evasion"]],
  ["nigromante", "Nigromante", "magical", ["necromancia", "simbologia", "magia"]],
  ["bruja", "Bruja", "magical", ["magia", "clarividencia", "medicina"]],
  ["chaman", "Chamán", "magical", ["botanica", "meditar", "magia"]],
  ["druida", "Druida", "magical", ["magia", "domar", "mitologia"]],
  ["guardian", "Guardián", "magical", ["cosmologia", "magia", "orientacion"]],
  ["hechicero", "Hechicero", "magical", ["simbologia", "magia", "tramperia"]],
  ["mago", "Mago", "magical", ["magia", "simbologia", "meditar"]],
  ["oraculo", "Oráculo", "magical", ["clarividencia", "magia", "orientacion"]]
];

function resourceProfileForDomain(domain) {
  return domain === MTROL_CLASS_DOMAINS.PHYSICAL ? "physical" : "magicHybrid";
}

function createClassDefinition([technicalId, displayName, domain, competencyIds]) {
  const family = FAMILY_BY_DOMAIN[domain];
  return Object.freeze({
    technicalId,
    displayName,
    domain,
    initialCompetencies: Object.freeze(
      competencyIds.map(id => Object.freeze({ technicalId: id, level: 1 }))
    ),
    competencySelection: null,
    // Alias contractuales existentes.
    id: technicalId,
    label: displayName,
    resourceProfile: resourceProfileForDomain(domain),
    family,
    counterattackDomains: COUNTERATTACK_DOMAINS_BY_FAMILY[family],
    attributeMovementFollowUp: domain === MTROL_CLASS_DOMAINS.PHYSICAL
      ? "attack-if-in-range"
      : "none",
    specialAbility1: CLASS_SPECIAL_ABILITIES[technicalId]?.specialAbility1 ?? null,
    specialAbility2: CLASS_SPECIAL_ABILITIES[technicalId]?.specialAbility2 ?? null
  });
}

const APPRENTICE_DEFINITION = Object.freeze({
  technicalId: "aprendiz",
  displayName: "Aprendiz",
  domain: null,
  initialCompetencies: Object.freeze([]),
  competencySelection: Object.freeze({ count: 3, initialLevel: 1, unique: true }),
  id: "aprendiz",
  label: "Aprendiz",
  resourceProfile: null,
  family: null,
  counterattackDomains: Object.freeze([]),
  attributeMovementFollowUp: "none",
  specialAbility1: null,
  specialAbility2: null
});

const CLASS_DEFINITIONS = Object.freeze([
  ...CLASS_CATALOG_SOURCE.map(createClassDefinition),
  APPRENTICE_DEFINITION
]);

export const MTROL_CLASS_IDS = Object.freeze(
  CLASS_DEFINITIONS.map(definition => definition.technicalId)
);

export const MTROL_CLASS_REGISTRY = Object.freeze(
  Object.fromEntries(CLASS_DEFINITIONS.map(definition => [definition.technicalId, definition]))
);

export function isValidClassDomain(domain) {
  return Object.values(MTROL_CLASS_DOMAINS).includes(domain);
}

export function isValidClassId(classId) {
  return typeof classId === "string" && Object.hasOwn(MTROL_CLASS_REGISTRY, classId);
}

export function getClassDefinition(classId) {
  return isValidClassId(classId) ? MTROL_CLASS_REGISTRY[classId] : null;
}

export function getEffectiveClassDomain(classId, explicitDomain = null) {
  const definition = getClassDefinition(classId);
  if (!definition) return null;
  if (definition.technicalId !== "aprendiz") return definition.domain;
  return isValidClassDomain(explicitDomain) ? explicitDomain : null;
}

export function getResourceProfileForClass(classId, explicitDomain = null) {
  const domain = getEffectiveClassDomain(classId, explicitDomain);
  const profileId = domain ? resourceProfileForDomain(domain) : null;
  return profileId ? MTROL_CLASS_RESOURCE_PROFILES[profileId] ?? null : null;
}

export function getAttributeMovementFollowUpForClass(classId, explicitDomain = null) {
  return getEffectiveClassDomain(classId, explicitDomain) === MTROL_CLASS_DOMAINS.PHYSICAL
    ? "attack-if-in-range"
    : "none";
}

export function getCounterattackPolicyForClass(classId, explicitDomain = null) {
  const domain = getEffectiveClassDomain(classId, explicitDomain);
  const family = domain ? FAMILY_BY_DOMAIN[domain] : null;
  if (!family) return null;
  return {
    classId,
    family,
    counterattackDomains: Array.from(COUNTERATTACK_DOMAINS_BY_FAMILY[family] ?? [])
  };
}

export function validateClassCatalog() {
  const errors = [];
  if (CLASS_DEFINITIONS.length !== 26) errors.push("El catálogo debe contener 26 Clases.");
  if (new Set(MTROL_CLASS_IDS).size !== MTROL_CLASS_IDS.length) errors.push("Hay technicalId de Clase duplicados.");

  for (const definition of CLASS_DEFINITIONS) {
    if (definition.technicalId === "aprendiz") continue;
    if (!isValidClassDomain(definition.domain)) errors.push(`Domain inválido en ${definition.technicalId}.`);
    if (definition.initialCompetencies.length !== 3) errors.push(`${definition.technicalId} debe declarar 3 Competencias.`);
    const ids = definition.initialCompetencies.map(entry => entry.technicalId);
    if (new Set(ids).size !== ids.length) errors.push(`${definition.technicalId} repite Competencias.`);
    for (const competency of definition.initialCompetencies) {
      if (!isCanonicalCompetencyTechnicalId(competency.technicalId)) {
        errors.push(`${definition.technicalId} referencia ${competency.technicalId}, que no existe.`);
      }
      if (competency.level !== 1) errors.push(`${definition.technicalId} declara un nivel inicial distinto de 1.`);
    }
  }

  return { valid: errors.length === 0, errors };
}

const validation = validateClassCatalog();
if (!validation.valid) throw new Error(`ClassCatalog inválido: ${validation.errors.join(" ")}`);

export const getClassResourceProfile = getResourceProfileForClass;

export function getAllClassDefinitions() {
  return CLASS_DEFINITIONS.map(definition => ({
    ...definition,
    initialCompetencies: definition.initialCompetencies.map(entry => ({ ...entry })),
    competencySelection: definition.competencySelection
      ? { ...definition.competencySelection }
      : null
  }));
}
