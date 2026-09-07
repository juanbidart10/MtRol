import {
  getCanonicalCompetencyDefinition
} from "./competency-catalog.js";

function baseCompetencySystem() {
  return {
    nivel: 1,
    categoria: "competencia",
    actionType: "utility",
    effect: "none",
    requiresTarget: false,
    requiresOpposition: false,
    oppositionType: "free",
    effectDuration: 1,
    effectIntensity: 0,
    banner: "",
    damageResolution: "onOppositionWin",
    damageMode: "enabled",
    damageCostType: "none",
    cooldown: 0,
    fx: { visual: "", sonido: "", duracion: 5000, escala: 1 },
    descripcion: ""
  };
}

export function createBlankCompetencyItemData() {
  return {
    name: "Nueva competencia",
    type: "competencia",
    img: "icons/svg/item-bag.svg",
    system: {
      ...baseCompetencySystem(),
      technicalId: ""
    }
  };
}

export function createCanonicalCompetencyItemData(technicalId, { level = 1 } = {}) {
  const definition = getCanonicalCompetencyDefinition(technicalId);
  if (!definition) throw new Error(`La Competencia ${technicalId} no existe en el catálogo canónico.`);
  if (level !== 1) throw new Error("Una Competencia inicial de Clase debe comenzar en nivel 1.");

  return {
    name: definition.name,
    type: "competencia",
    img: "icons/svg/item-bag.svg",
    system: {
      ...baseCompetencySystem(),
      technicalId: definition.technicalId,
      nivel: 1
    }
  };
}
