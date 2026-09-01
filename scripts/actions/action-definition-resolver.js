import { getItemAbilityDamageConfig } from "./ability-config.js";
import { MTROL_CATEGORIES, normalizarCategoria } from "../core/categories.js";
import { getOppositionActionDefinition } from "./opposition-policy.js";
import { logger } from "../utils/logger.js";

const OPPOSED_DAMAGE_ACTION_TYPES = new Set([
  "attack",
  "basicAttack",
  "combatSkill",
  "damage"
]);

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function isTrue(value) {
  return value === true || value === "true";
}

function isFalse(value) {
  return value === false || value === "false";
}

export function getItemDamageFormula(item) {
  return String(item?.system?.danio ?? "").trim();
}

export function isOpposedDamageAction(item) {
  const system = item?.system ?? {};
  if (!getItemDamageFormula(item)) return false;
  return OPPOSED_DAMAGE_ACTION_TYPES.has(system.actionType) || system.effect === "damage";
}

function hasConfiguredActionDefinition(system = {}) {
  return (
    system.actionType !== undefined ||
    system.effect !== undefined ||
    system.defenseType !== undefined ||
    system.requiresTarget !== undefined ||
    system.requiresOpposition !== undefined ||
    system.oppositionType !== undefined
  );
}

export function resolveActionDefinition(item) {
  const system = item?.system ?? {};
  const persistedSystem = item?._source?.system ?? system;
  const hasExplicitOpposition = Object.hasOwn(persistedSystem, "requiresOpposition");
  const oppositionDefinition = getOppositionActionDefinition(item, { logger });
  const baseDefinition = {
    ...oppositionDefinition,
    actionBehavior: system.actionType ?? "utility",
    effect: system.effect ?? "none",
    defenseType: system.defenseType ?? "custom",
    effectDuration: Number(system.effectDuration ?? 1),
    effectIntensity: Number(system.effectIntensity ?? 0),
    oppositionType: system.oppositionType ?? "free"
  };

  if (
    isTrue(system.requiresOpposition) ||
    (!hasExplicitOpposition && isOpposedDamageAction(item))
  ) {
    return { ...baseDefinition, requiresOpposition: true };
  }

  if (!hasConfiguredActionDefinition(system) && normalizeText(item?.name) === "cadenas infernales") {
    // Legacy fallback temporal; conservar hasta migrar el Item en Fase 6.
    return {
      ...baseDefinition,
      actionBehavior: "control",
      effect: "stunned",
      defenseType: "custom",
      effectDuration: 1,
      effectIntensity: 0,
      oppositionType: "free",
      requiresOpposition: true
    };
  }

  return { ...baseDefinition, requiresOpposition: false };
}

export function resolveCanonicalDamageContext({
  sourceActor,
  sourceItem,
  targetActor,
  requiresOpposition = true,
  data = {}
} = {}) {
  const formula = getItemDamageFormula(sourceItem);
  const executesDamage = !isFalse(sourceItem?.system?.ejecutaDanio);
  const config = getItemAbilityDamageConfig(sourceItem, { requiresOpposition });
  const basicCostIncludedInActivation =
    normalizarCategoria(sourceItem?.system?.categoria) === MTROL_CATEGORIES.COMPETENCIA &&
    config.costType === "basic";
  const available =
    executesDamage &&
    formula.length > 0 &&
    (!requiresOpposition || config.resolution === "onOppositionWin");

  return {
    available,
    formula: available ? formula : "",
    flatValue: available && Number.isFinite(Number(formula)) ? Number(formula) : null,
    sourceActorUuid: sourceActor?.uuid ?? null,
    sourceTokenUuid: data.sourceTokenUuid ?? null,
    targetActorUuid: targetActor?.uuid ?? null,
    targetTokenUuid: data.targetTokenUuid ?? null,
    competenciaUuid: sourceItem?.uuid ?? null,
    competenciaId: sourceItem?.id ?? null,
    competenciaName: sourceItem?.name ?? null,
    title: sourceItem?.name ?? "Tirada de Daño",
    icon: sourceItem?.img ?? sourceActor?.img ?? "",
    localized: !isFalse(sourceItem?.system?.usaDanioLocalizado),
    costoTotal: Number(data.costoTotal ?? 0),
    resolution: config.resolution,
    mode: config.mode,
    costType: config.costType,
    basicCostIncludedInActivation,
    rollData: {}
  };
}

