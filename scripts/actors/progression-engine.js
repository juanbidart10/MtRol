import {
  isProgressionCompetence
} from "../progression/progression-competence.js";

export const MTROL_PROGRESSION_ATTRIBUTE_KEYS = Object.freeze([
  "resistencia",
  "carisma",
  "fuerza",
  "inteligencia",
  "voluntad",
  "aura",
  "percepcion",
  "destreza",
  "suerte"
]);

const LEVEL_REQUIREMENTS = Object.freeze({
  1: Object.freeze({
    nextLevel: 2,
    requiredExp: 1000,
    requirements: Object.freeze([
      Object.freeze({ key: "mvp", label: "MVP", required: 1 }),
      Object.freeze({ key: "exp", label: "EXP", required: 1000 }),
      Object.freeze({ key: "missionsCompleted", label: "Misiones completadas", required: 1 }),
      Object.freeze({ key: "competencesAtLeastThree", label: "Competencias de nivel 3 o superior", required: 1 })
    ])
  }),
  2: Object.freeze({
    nextLevel: 3,
    requiredExp: 15000,
    requirements: Object.freeze([
      Object.freeze({ key: "mvp", label: "MVP", required: 20 }),
      Object.freeze({ key: "exp", label: "EXP", required: 15000 }),
      Object.freeze({ key: "dungeonsCompleted", label: "Dungeons completados", required: 1 }),
      Object.freeze({ key: "attributesAtFive", label: "Atributos en nivel 5", required: 2 }),
      Object.freeze({ key: "competencesAtFive", label: "Competencias en nivel 5", required: 2 }),
      Object.freeze({ key: "meritCredits", label: "Créditos de mérito", required: 5 })
    ])
  }),
  3: Object.freeze({
    nextLevel: 4,
    requiredExp: 30000,
    requirements: Object.freeze([
      Object.freeze({ key: "mvp", label: "MVP", required: 30 }),
      Object.freeze({ key: "exp", label: "EXP", required: 30000 }),
      Object.freeze({ key: "missionsCompleted", label: "Misiones completadas", required: 5 }),
      Object.freeze({ key: "attributesAtFive", label: "Atributos en nivel 5", required: 4 }),
      Object.freeze({ key: "competencesAtFive", label: "Competencias en nivel 5", required: 4 }),
      Object.freeze({ key: "dmApproval", label: "Aprobación DM", required: true })
    ])
  }),
  4: Object.freeze({
    nextLevel: 5,
    requiredExp: 50000,
    requirements: Object.freeze([
      Object.freeze({ key: "mvp", label: "MVP", required: 50 }),
      Object.freeze({ key: "exp", label: "EXP", required: 50000 }),
      Object.freeze({ key: "missionsCompleted", label: "Misiones completadas", required: 10 }),
      Object.freeze({ key: "defeatedLevel5Enemy", label: "Enemigo de nivel 5 derrotado", required: true }),
      Object.freeze({ key: "attributesAtFive", label: "Atributos en nivel 5", required: 7 }),
      Object.freeze({ key: "competencesAtFive", label: "Competencias en nivel 5", required: 7 }),
      Object.freeze({ key: "dmApproval", label: "Aprobación DM", required: true })
    ])
  })
});

function toNonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function getActorItems(actor) {
  const items = actor?.items;
  if (!items) return [];
  if (Array.isArray(items)) return items;
  return typeof items[Symbol.iterator] === "function" ? [...items] : [];
}

function formatProgressionNumber(value) {
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(value);
}

export function getRequirementsForLevel(level) {
  const definition = LEVEL_REQUIREMENTS[Number(level)];
  if (!definition) return null;

  return {
    nextLevel: definition.nextLevel,
    requiredExp: definition.requiredExp,
    requirements: definition.requirements.map(requirement => ({ ...requirement }))
  };
}

export function evaluateProgression(actor) {
  const system = actor?.system ?? {};
  const resources = system.recursos ?? {};
  const progression = system.progression ?? {};
  const level = toNonNegativeNumber(resources.nivel) || 1;
  const definition = getRequirementsForLevel(level);

  const attributeValues = MTROL_PROGRESSION_ATTRIBUTE_KEYS.map(key =>
    toNonNegativeNumber(system.atributos?.[key])
  );
  const competenceLevels = getActorItems(actor)
    .filter(isProgressionCompetence)
    .map(item => toNonNegativeNumber(item.system?.nivel));

  const counts = {
    attributesAtFive: attributeValues.filter(value => value >= 5).length,
    competencesAtFive: competenceLevels.filter(value => value >= 5).length,
    competencesAtLeastThree: competenceLevels.filter(value => value >= 3).length
  };
  const current = {
    exp: toNonNegativeNumber(resources.exp),
    mvp: toNonNegativeNumber(resources.mvp),
    missionsCompleted: toNonNegativeNumber(progression.missionsCompleted),
    dungeonsCompleted: toNonNegativeNumber(progression.dungeonsCompleted),
    meritCredits: toNonNegativeNumber(progression.meritCredits),
    defeatedLevel5Enemy: progression.defeatedLevel5Enemy === true,
    dmApproval: progression.dmApproval === true
  };

  if (!definition) {
    return {
      level,
      nextLevel: null,
      maximumLevel: level >= 5,
      current,
      counts,
      requiredExp: null,
      expProgress: { current: current.exp, required: null, percent: 100 },
      globalProgress: { completed: 0, total: 0, percent: 100, text: "Nivel máximo" },
      requirements: [],
      eligible: false
    };
  }

  const values = { ...current, ...counts };
  const requirements = definition.requirements.map(requirement => {
    const value = values[requirement.key];
    const isBoolean = typeof requirement.required === "boolean";
    const met = isBoolean
      ? value === requirement.required
      : value >= requirement.required;

    return {
      ...requirement,
      current: value,
      met,
      valueText: isBoolean
        ? (met ? "Cumplido" : "Pendiente")
        : `${value} / ${requirement.required}`
    };
  });
  const rawPercent = definition.requiredExp > 0
    ? (current.exp / definition.requiredExp) * 100
    : 100;
  const completedRequirements = requirements.filter(requirement => requirement.met).length;
  const totalRequirements = requirements.length;
  const globalPercent = totalRequirements > 0
    ? Math.round((completedRequirements / totalRequirements) * 100)
    : 100;

  return {
    level,
    nextLevel: definition.nextLevel,
    maximumLevel: false,
    current,
    counts,
    requiredExp: definition.requiredExp,
    expProgress: {
      current: current.exp,
      required: definition.requiredExp,
      percent: Math.min(100, Math.max(0, rawPercent)),
      text: `${formatProgressionNumber(current.exp)} / ${formatProgressionNumber(definition.requiredExp)} EXP`
    },
    globalProgress: {
      completed: completedRequirements,
      total: totalRequirements,
      percent: globalPercent,
      text: `${completedRequirements} / ${totalRequirements}`
    },
    requirements,
    eligible: requirements.every(requirement => requirement.met)
  };
}

export function isEligibleForNextLevel(actor) {
  return evaluateProgression(actor).eligible;
}
