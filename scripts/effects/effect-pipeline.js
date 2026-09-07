import { createEffectContext } from "./effect-context.js";
import { resolveEffects } from "./effect-resolver.js";
import { MTROL_EFFECT_PHASES } from "./effect-types.js";

export function resolveGameplayRollEffects(actor, baseRollResult, metadata = {}) {
  return resolveEffects(createEffectContext({
    phase: MTROL_EFFECT_PHASES.ROLL_RESULT_MODIFICATION,
    sourceActor: actor,
    baseRollResult,
    action: metadata.item ?? null,
    actionType: metadata.actionType ?? null,
    actionDomain: metadata.actionDomain ?? null,
    metadata
  }));
}

export function resolveInitiativeEffects(actor, initiative) {
  return resolveEffects(createEffectContext({
    phase: MTROL_EFFECT_PHASES.INITIATIVE_BUILD,
    sourceActor: actor,
    initiative,
    actionType: "initiative"
  }));
}
