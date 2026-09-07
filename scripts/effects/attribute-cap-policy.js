import { createEffectContext } from "./effect-context.js";
import { resolveEffects } from "./effect-resolver.js";
import { MTROL_EFFECT_PHASES } from "./effect-types.js";

function actorWithRaceOverride(actor, raceIdOverride) {
  if (!raceIdOverride) return actor;
  return {
    ...actor,
    system: {
      ...(actor?.system ?? {}),
      identidad: {
        ...(actor?.system?.identidad ?? {}),
        raceId: raceIdOverride
      }
    }
  };
}

export function resolveAttributeCap(actor, {
  baseCap = 5,
  attributeId = null,
  raceIdOverride = null,
  resolvePassives = undefined
} = {}) {
  const contextActor = actorWithRaceOverride(actor, raceIdOverride);
  return resolveEffects(createEffectContext({
    phase: MTROL_EFFECT_PHASES.ATTRIBUTE_CAP_POLICY,
    sourceActor: contextActor,
    policyValue: baseCap,
    sourceAttribute: attributeId,
    metadata: { raceIdOverride }
  }), resolvePassives ? { resolvePassives } : {});
}
