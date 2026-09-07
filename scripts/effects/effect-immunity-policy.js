import { resolveActivePassives } from "./passive-assignment-resolver.js";
import { MTROL_EFFECT_TYPES, validateEffectDefinition } from "./effect-types.js";

function matchesFilter(candidate, filter) {
  if (filter.sourceCategory) return candidate.sourceCategory === filter.sourceCategory;
  if (filter.tag) return (candidate.tags ?? []).includes(filter.tag);
  return false;
}

export function resolveEffectImmunityPolicies(actor, {
  resolvePassives = current => resolveActivePassives(current)
} = {}) {
  const policies = [];
  const diagnostics = [];
  const resolution = resolvePassives(actor);
  diagnostics.push(...resolution.diagnostics);
  for (const passive of resolution.passives) {
    passive.effects.forEach((effect, effectIndex) => {
      if (effect.type !== MTROL_EFFECT_TYPES.EFFECT_IMMUNITY) return;
      const validation = validateEffectDefinition(effect);
      if (!validation.valid) {
        diagnostics.push({
          code: "EFFECT_DEFINITION_INVALID",
          passiveId: passive.technicalId,
          effectType: effect.type,
          errors: validation.errors
        });
        return;
      }
      policies.push(Object.freeze({
        passiveId: passive.technicalId,
        effectIndex,
        filters: effect.filters,
        protectedApplicationScope: effect.protectedApplicationScope,
        protectedPolarity: effect.protectedPolarity
      }));
    });
  }
  return Object.freeze({
    policies: Object.freeze(policies),
    diagnostics: Object.freeze(diagnostics)
  });
}

export function evaluateEffectImmunity(targetActor, candidate, options = {}) {
  if (!targetActor || candidate?.targetActorUuid !== targetActor.uuid) {
    return Object.freeze({ blocked: false, policy: null, diagnostics: Object.freeze([]) });
  }
  if (candidate.applicationScope !== "target" || candidate.polarity !== "hostile") {
    return Object.freeze({ blocked: false, policy: null, diagnostics: Object.freeze([]) });
  }
  if (candidate.sourceActorUuid && candidate.sourceActorUuid === targetActor.uuid) {
    return Object.freeze({ blocked: false, policy: null, diagnostics: Object.freeze([]) });
  }
  const resolution = resolveEffectImmunityPolicies(targetActor, options);
  const policy = resolution.policies.find(entry =>
    entry.protectedApplicationScope === candidate.applicationScope &&
    entry.protectedPolarity === candidate.polarity &&
    entry.filters.some(filter => matchesFilter(candidate, filter))
  ) ?? null;
  return Object.freeze({
    blocked: Boolean(policy),
    policy,
    diagnostics: resolution.diagnostics
  });
}
