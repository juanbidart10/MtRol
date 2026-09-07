import { MTROL_EFFECT_PHASES } from "./effect-types.js";

export function createEffectContext({
  phase,
  sourceActor = null,
  targetActor = null,
  action = null,
  actionType = null,
  actionDomain = null,
  damageType = null,
  sourceAttribute = null,
  damageSourceAttribute = null,
  formula = "",
  formulaData = {},
  roll = null,
  rawDamage = null,
  currentDamage = null,
  baseRollResult = null,
  initiative = null,
  policyValue = null,
  isCombat = false,
  combatId = null,
  mitigationPolicy = "standard",
  metadata = {}
} = {}) {
  if (!Object.values(MTROL_EFFECT_PHASES).includes(phase)) {
    throw new TypeError("EffectContext requiere una phase canónica.");
  }
  return Object.freeze({
    phase,
    sourceActor,
    targetActor,
    action,
    actionType,
    actionDomain,
    damageType,
    sourceAttribute,
    damageSourceAttribute,
    formula: String(formula ?? ""),
    formulaData,
    roll,
    rawDamage,
    currentDamage,
    baseRollResult,
    initiative,
    policyValue,
    isCombat: isCombat === true,
    combatId: combatId ?? null,
    mitigationPolicy,
    metadata: Object.freeze({ ...metadata })
  });
}
