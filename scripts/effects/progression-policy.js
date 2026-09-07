import { createEffectContext } from "./effect-context.js";
import { resolveEffects } from "./effect-resolver.js";
import { MTROL_EFFECT_PHASES } from "./effect-types.js";

function resolveGain(actor, baseGain, phase, options = {}) {
  const value = Number(baseGain);
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("La ganancia base debe ser un número no negativo.");
  }
  return resolveEffects(createEffectContext({
    phase,
    sourceActor: actor,
    policyValue: value
  }), options);
}

export function resolveCompetencyProgressionGain(actor, baseGain, options = {}) {
  return resolveGain(actor, baseGain, MTROL_EFFECT_PHASES.COMPETENCY_PROGRESSION_POLICY, options);
}

export function resolveProgressionGain(actor, baseGain, options = {}) {
  return resolveGain(actor, baseGain, MTROL_EFFECT_PHASES.PROGRESSION_POLICY, options);
}
