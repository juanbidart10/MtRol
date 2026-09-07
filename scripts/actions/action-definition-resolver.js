import {
  getItemAbilityDamageConfig,
  normalizeResolutionResult
} from "./ability-config.js";
import { MTROL_CATEGORIES, normalizarCategoria } from "../core/categories.js";
import { getOppositionActionDefinition } from "./opposition-policy.js";
import { logger } from "../utils/logger.js";
import { MTROL_EFFECT_ATTRIBUTE_KEYS } from "../effects/effect-types.js";
import { getCanonicalDamageFormula } from "./combat-ability-policy.js";

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
  return getCanonicalDamageFormula(item);
}

export function getItemResolutionResult(item) {
  const explicit = normalizeResolutionResult(item?.system?.resolutionResult);
  const persisted = item?._source?.system;
  if (explicit || (persisted && Object.hasOwn(persisted, "resolutionResult"))) return explicit;
  const definition = getOppositionActionDefinition(item, { logger });
  if (definition.capabilities.includes("DODGE")) return "movement";
  if (definition.capabilities.includes("DEFENSE")) return "defense";
  if (getItemDamageFormula(item) && definition.capabilities.includes("OFFENSIVE")) return "damage";
  return "utility";
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

export function resolveActionDefinition(item, { declaredMode = null } = {}) {
  const system = item?.system ?? {};
  const persistedSystem = item?._source?.system ?? system;
  const hasExplicitOpposition = Object.hasOwn(persistedSystem, "requiresOpposition");
  const oppositionDefinition = getOppositionActionDefinition(item, { logger });
  const modeDefinition = Array.from(system.executionModes ?? [])
    .find(mode => mode?.modeId === declaredMode) ?? null;
  const baseDefinition = {
    ...oppositionDefinition,
    actionBehavior: system.actionType ?? "utility",
    effect: system.effect ?? "none",
    defenseType: system.defenseType ?? "custom",
    effectDuration: Number(system.effectDuration ?? 1),
    effectIntensity: Number(system.effectIntensity ?? 0),
    oppositionType: system.oppositionType ?? "free",
    resolutionResult: normalizeResolutionResult(modeDefinition?.resolutionResult) ?? getItemResolutionResult(item)
  };

  if (
    isTrue(system.requiresOpposition) ||
    baseDefinition.resolutionResult === "damage" ||
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
  const formula = getCanonicalDamageFormula(sourceItem, data.declaredMode ?? null);
  const config = getItemAbilityDamageConfig(sourceItem, { requiresOpposition });
  const basicCostIncludedInActivation =
    normalizarCategoria(sourceItem?.system?.categoria) === MTROL_CATEGORIES.COMPETENCIA &&
    config.costType === "basic";
  const resolutionResult = getItemResolutionResult(sourceItem);
  const available =
    resolutionResult === "damage" &&
    formula.length > 0 &&
    requiresOpposition && config.resolution === "onOppositionWin";
  const damageSourceAttribute = MTROL_EFFECT_ATTRIBUTE_KEYS.includes(sourceItem?.system?.damageSourceAttribute)
    ? sourceItem.system.damageSourceAttribute
    : null;

  return {
    available,
    id: data.id ?? null,
    actionItemUuid: sourceItem?.uuid ?? null,
    damageFormula: available ? formula : "",
    formula: available ? formula : "",
    flatValue: available && Number.isFinite(Number(formula)) ? Number(formula) : null,
    damageSourceAttribute,
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
    rollData: {},
    resolutionResult,
    declaredMode: data.declaredMode ?? null,
    createdFromPendingActionId: data.createdFromPendingActionId ?? null,
    modifiers: Array.isArray(data.modifiers) ? foundry.utils.deepClone(data.modifiers) : [],
    receiptLinkage: data.receiptLinkage ?? null
  };
}

