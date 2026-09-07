export const MTROL_ABILITY_ROLES = Object.freeze([
  "offensive",
  "defensive",
  "control",
  "support",
  "utility",
  "mobility"
]);

const MTROL_ABILITY_ROLE_LABELS = Object.freeze({
  offensive: "Ofensivo",
  defensive: "Defensivo",
  control: "Control",
  support: "Soporte",
  utility: "Utilidad",
  mobility: "Movilidad"
});

export function getAbilityRoleLabel(role) {
  return MTROL_ABILITY_ROLE_LABELS[role] ?? "";
}

export const MTROL_DAMAGE_RESOLUTIONS = Object.freeze([
  "onOppositionWin"
]);

export const MTROL_DAMAGE_MODES = Object.freeze([
  "enabled"
]);

export const MTROL_RESOLUTION_RESULTS = Object.freeze([
  "damage",
  "defense",
  "movement",
  "utility"
]);

export const MTROL_DAMAGE_COST_TYPES = Object.freeze([
  "none",
  "basic"
]);

function isTrue(value) {
  return value === true || value === "true";
}

function isFalse(value) {
  return value === false || value === "false";
}

function selectKnown(value, choices, fallback) {
  return choices.includes(value) ? value : fallback;
}

export function normalizeAbilityDamageConfig(system = {}, {
  legacy = false
} = {}) {
  const requiresOpposition = isTrue(system.requiresOpposition);
  const executesDamage = !isFalse(system.ejecutaDanio);
  const resolution = selectKnown(
    legacy ? undefined : system.damageResolution,
    MTROL_DAMAGE_RESOLUTIONS,
    "onOppositionWin"
  );

  const mode = selectKnown(
    legacy ? undefined : system.damageMode,
    MTROL_DAMAGE_MODES,
    "enabled"
  );
  const costType = selectKnown(
    legacy ? undefined : system.damageCostType,
    MTROL_DAMAGE_COST_TYPES,
    "none"
  );

  return {
    executesDamage,
    resolution,
    mode,
    costType,
    additionalMpCost: costType === "basic" ? 1 : 0
  };
}

export function normalizeResolutionResult(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return MTROL_RESOLUTION_RESULTS.includes(normalized) ? normalized : null;
}

export function getItemAbilityDamageConfig(item, {
  requiresOpposition = item?.system?.requiresOpposition
} = {}) {
  const persistedSystem = item?._source?.system;
  const runtimeSystem = item?.system ?? {};
  const hasPersistedConfiguration = Boolean(
    (persistedSystem ?? runtimeSystem) &&
    (
      Object.hasOwn(persistedSystem ?? runtimeSystem, "damageResolution") ||
      Object.hasOwn(persistedSystem ?? runtimeSystem, "damageMode") ||
      Object.hasOwn(persistedSystem ?? runtimeSystem, "damageCostType")
    )
  );

  return normalizeAbilityDamageConfig(
    {
      ...runtimeSystem,
      requiresOpposition
    },
    { legacy: !hasPersistedConfiguration }
  );
}
