import { logger } from "../utils/logger.js";
import { resolveActivePassives } from "./passive-assignment-resolver.js";
import {
  MTROL_EFFECT_PHASES,
  getEffectTypeContract,
  validateEffectDefinition
} from "./effect-types.js";
import {
  applyAttributeDamageMultiplier,
  applyConditionalRollMultiplier,
  applyDamageToResource,
  applyFlatDamageReductionFromAttribute,
  applyInitiativeBonus,
  applyPolicyMultiplier,
  applyAwakeningSlotGrant,
  applyAttributeCapOverride,
  collectEffectImmunity
} from "./effect-handlers.js";
import { evaluateEffectImmunity } from "./effect-immunity-policy.js";

const HANDLERS = Object.freeze({
  ATTRIBUTE_DAMAGE_MULTIPLIER: applyAttributeDamageMultiplier,
  FLAT_DAMAGE_REDUCTION_FROM_ATTRIBUTE: applyFlatDamageReductionFromAttribute,
  CONDITIONAL_ROLL_MULTIPLIER: applyConditionalRollMultiplier,
  INITIATIVE_BONUS: applyInitiativeBonus,
  DAMAGE_TO_RESOURCE: applyDamageToResource,
  COMPETENCY_PROGRESSION_MULTIPLIER: applyPolicyMultiplier,
  PROGRESSION_MULTIPLIER: applyPolicyMultiplier,
  GRANT_AWAKENING_SLOT: applyAwakeningSlotGrant,
  ATTRIBUTE_CAP_OVERRIDE: applyAttributeCapOverride,
  EFFECT_IMMUNITY: collectEffectImmunity
});

function effectEntries(context, resolvePassives) {
  const entries = [];
  const diagnostics = [];
  for (const [subject, actor] of [["source", context.sourceActor], ["target", context.targetActor]]) {
    if (!actor) continue;
    const resolution = resolvePassives(actor);
    diagnostics.push(...resolution.diagnostics);
    const seenPassiveIds = new Set();
    for (const passive of resolution.passives) {
      if (seenPassiveIds.has(passive.technicalId)) continue;
      seenPassiveIds.add(passive.technicalId);
      passive.effects.forEach((effect, index) => entries.push({ passive, effect, index, subject, actor }));
    }
  }
  return { entries, diagnostics };
}

function stableSort(entries) {
  return entries.sort((left, right) =>
    Number(left.effect.priority ?? 100) - Number(right.effect.priority ?? 100) ||
    left.passive.technicalId.localeCompare(right.passive.technicalId) ||
    left.index - right.index
  );
}

export function resolveEffects(context, {
  resolvePassives = actor => resolveActivePassives(actor),
  log = logger
} = {}) {
  const initialState = context.phase === MTROL_EFFECT_PHASES.DAMAGE_FORMULA_BUILD
    ? { context, formulaData: context.formulaData }
    : context.phase === MTROL_EFFECT_PHASES.DAMAGE_MITIGATION
      ? { context, currentDamage: Math.max(0, Number(context.currentDamage) || 0) }
      : context.phase === MTROL_EFFECT_PHASES.ROLL_RESULT_MODIFICATION
        ? { context, value: Number(context.baseRollResult) }
        : context.phase === MTROL_EFFECT_PHASES.INITIATIVE_BUILD
          ? { context, value: Number(context.initiative) }
          : context.phase === MTROL_EFFECT_PHASES.AFTER_DAMAGE_APPLIED
            ? { context, resourceIntents: [] }
            : context.phase === MTROL_EFFECT_PHASES.EFFECT_IMMUNITY_POLICY
              ? { context, immunityPolicies: [] }
              : { context, value: Number(context.policyValue) };
  let state = initialState;
  const appliedEffects = [];
  const skippedEffects = [];
  const { entries, diagnostics } = effectEntries(context, resolvePassives);

  for (const entry of stableSort(entries)) {
    const { passive, effect, index, subject, actor } = entry;
    const contract = getEffectTypeContract(effect.type);
    const handler = HANDLERS[effect.type];
    if (!contract || !handler) {
      skippedEffects.push({ passiveId: passive.technicalId, effectType: effect.type, reason: "HANDLER_NOT_ENABLED" });
      continue;
    }
    const validation = validateEffectDefinition(effect);
    if (!validation.valid) {
      const diagnostic = {
        code: "EFFECT_DEFINITION_INVALID", passiveId: passive.technicalId,
        effectType: effect.type, errors: validation.errors
      };
      diagnostics.push(diagnostic);
      log?.errorOnce?.("EFFECT", "invalid effect definition isolated", diagnostic, {
        key: `effect-invalid:${passive.technicalId}:${effect.type}`
      });
      continue;
    }
    if (contract.phase !== context.phase || contract.subject !== subject) continue;
    if (effect.requiresCombat && !context.isCombat) continue;
    if (context.phase === MTROL_EFFECT_PHASES.DAMAGE_MITIGATION && context.mitigationPolicy === "none") continue;

    const candidate = Object.freeze({
      sourceCategory: "racialPassive",
      sourcePassiveId: passive.technicalId,
      sourceActorUuid: actor?.uuid ?? null,
      targetActorUuid: context.targetActor?.uuid ?? null,
      tags: Object.freeze([...(passive.tags ?? []), ...(effect.tags ?? [])]),
      applicationScope: effect.applicationScope ?? null,
      polarity: effect.polarity ?? null
    });
    const immunity = evaluateEffectImmunity(context.targetActor, candidate);
    diagnostics.push(...immunity.diagnostics);
    if (immunity.blocked) {
      skippedEffects.push({
        passiveId: passive.technicalId,
        effectType: effect.type,
        reason: "EFFECT_IMMUNITY",
        immunityPassiveId: immunity.policy.passiveId
      });
      continue;
    }

    try {
      const result = handler(state, effect);
      if (!result) continue;
      state = result.state;
      if (result.resourceIntent) {
        state = {
          ...state,
          resourceIntents: [
            ...(state.resourceIntents ?? []),
            Object.freeze({
              ...result.resourceIntent,
              passiveId: passive.technicalId,
              effectType: effect.type,
              effectIndex: index
            })
          ]
        };
      }
      const applied = Object.freeze({
        passiveId: passive.technicalId,
        effectIndex: index,
        effectType: effect.type,
        phase: context.phase,
        subject,
        actorUuid: actor?.uuid ?? null,
        before: result.before,
        after: result.after,
        delta: result.delta,
        attribute: result.attribute ?? null,
        attributeValue: result.attributeValue ?? null,
        reduction: result.reduction ?? null,
        resource: result.resource ?? null,
        damageApplied: result.damageApplied ?? null,
        percentage: result.percentage ?? null,
        resourceDelta: result.resourceDelta ?? null,
        multiplier: result.multiplier ?? null,
        hpPercentage: result.hpPercentage ?? null,
        baseRollResult: context.phase === MTROL_EFFECT_PHASES.ROLL_RESULT_MODIFICATION
          ? context.baseRollResult
          : null,
        initiativeBefore: context.phase === MTROL_EFFECT_PHASES.INITIATIVE_BUILD
          ? result.before
          : null,
        initiativeAfter: context.phase === MTROL_EFFECT_PHASES.INITIATIVE_BUILD
          ? result.after
          : null,
        resourceBefore: result.resource ? result.before : null,
        resourceAfter: result.resource ? result.after : null,
        sourceCategory: candidate.sourceCategory,
        sourcePassiveId: candidate.sourcePassiveId,
        sourceActorUuid: candidate.sourceActorUuid,
        targetActorUuid: candidate.targetActorUuid,
        tags: candidate.tags,
        applicationScope: candidate.applicationScope,
        polarity: candidate.polarity
      });
      appliedEffects.push(applied);
      log?.debug?.("EFFECT", "effect applied", {
        passiveId: applied.passiveId, effectType: applied.effectType, phase: applied.phase,
        sourceActorUuid: context.sourceActor?.uuid ?? null,
        targetActorUuid: context.targetActor?.uuid ?? null,
        before: applied.before, after: applied.after
      });
    } catch (error) {
      const diagnostic = {
        code: "EFFECT_HANDLER_FAILED", passiveId: passive.technicalId,
        effectType: effect.type, error: error.message
      };
      diagnostics.push(diagnostic);
      log?.errorOnce?.("EFFECT", "effect handler failure isolated", diagnostic, {
        key: `effect-handler:${passive.technicalId}:${effect.type}:${actor?.uuid ?? "actor"}`
      });
    }
  }

  return Object.freeze({
    formulaData: state.formulaData ?? context.formulaData,
    value: state.currentDamage ?? state.value ?? null,
    resourceIntents: Object.freeze(state.resourceIntents ?? []),
    immunityPolicies: Object.freeze(state.immunityPolicies ?? []),
    appliedEffects: Object.freeze(appliedEffects),
    skippedEffects: Object.freeze(skippedEffects.map(entry => Object.freeze(entry))),
    diagnostics: Object.freeze(diagnostics.map(entry => Object.freeze({ ...entry })))
  });
}
