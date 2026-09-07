function cloneFormulaData(formulaData) {
  if (globalThis.foundry?.utils?.deepClone) return foundry.utils.deepClone(formulaData ?? {});
  return structuredClone(formulaData ?? {});
}

function formulaReferencesAttribute(formula, attribute) {
  const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`@atributos\\.${escaped}(?![A-Za-z0-9_])`).test(String(formula ?? ""));
}

export function applyAttributeDamageMultiplier(state, effect) {
  if (!formulaReferencesAttribute(state.context.formula, effect.attribute)) return null;
  const before = Number(state.formulaData?.atributos?.[effect.attribute]);
  if (!Number.isFinite(before)) throw new TypeError(`El atributo ${effect.attribute} no posee un valor finito.`);
  const after = before * Number(effect.multiplier);
  const formulaData = cloneFormulaData(state.formulaData);
  formulaData.atributos ??= {};
  formulaData.atributos[effect.attribute] = after;
  return {
    state: { ...state, formulaData },
    before,
    after,
    delta: after - before,
    attribute: effect.attribute
  };
}

export function applyFlatDamageReductionFromAttribute(state, effect) {
  const attributeValue = Number(state.context.targetActor?.system?.atributos?.[effect.attribute]);
  if (!Number.isFinite(attributeValue)) throw new TypeError(`El atributo ${effect.attribute} no posee un valor finito.`);
  const before = Math.max(0, Number(state.currentDamage) || 0);
  const reduction = Math.max(0, attributeValue * Number(effect.multiplier));
  const after = Math.max(0, before - reduction);
  return {
    state: { ...state, currentDamage: after },
    before,
    after,
    delta: after - before,
    attribute: effect.attribute,
    attributeValue,
    reduction: before - after
  };
}

export function applyConditionalRollMultiplier(state, effect) {
  const hp = state.context.sourceActor?.system?.vitales?.hp ?? {};
  const current = Number(hp.value);
  const maximum = Number(hp.max);
  if (!Number.isFinite(current) || !Number.isFinite(maximum) || maximum <= 0) {
    throw new TypeError("Frenesí requiere HP actual y máximo válidos.");
  }
  const hpPercentage = current / maximum;
  if (hpPercentage > 0.25) return null;
  const before = Number(state.value);
  if (!Number.isFinite(before)) throw new TypeError("El resultado base del Roll no es finito.");
  const after = before * Number(effect.multiplier);
  return {
    state: { ...state, value: after },
    before,
    after,
    delta: after - before,
    multiplier: Number(effect.multiplier),
    hpPercentage
  };
}

export function applyInitiativeBonus(state, effect) {
  const before = Number(state.value);
  if (!Number.isFinite(before)) throw new TypeError("La iniciativa base no es finita.");
  const after = before + Number(effect.value);
  return {
    state: { ...state, value: after },
    before,
    after,
    delta: after - before
  };
}

export function applyDamageToResource(state, effect) {
  if (state.context.sourceActor?.uuid &&
      state.context.sourceActor.uuid === state.context.targetActor?.uuid) return null;
  if (effect.damageSourceAttribute &&
      effect.damageSourceAttribute !== state.context.damageSourceAttribute) return null;
  const damageApplied = Math.max(0, Number(state.context.currentDamage) || 0);
  const requested = Math.floor(damageApplied * Number(effect.percentage));
  if (requested <= 0) return null;
  const resourceData = state.context.sourceActor?.system?.vitales?.[effect.resource] ?? {};
  const before = Number(resourceData.value);
  const maximum = Number(resourceData.max);
  if (!Number.isFinite(before) || !Number.isFinite(maximum) || maximum < 0) {
    throw new TypeError(`El recurso ${effect.resource} no posee valores válidos.`);
  }
  const after = Math.min(maximum, before + requested);
  const resourceDelta = Math.max(0, after - before);
  if (resourceDelta <= 0) return null;
  const intent = Object.freeze({
    resource: effect.resource,
    amount: requested,
    resourceDelta,
    resourceBefore: before,
    resourceAfter: after,
    resourceMax: maximum,
    damageApplied,
    percentage: Number(effect.percentage)
  });
  return {
    state,
    resourceIntent: intent,
    before,
    after,
    delta: resourceDelta,
    resource: effect.resource,
    damageApplied,
    percentage: Number(effect.percentage),
    resourceDelta
  };
}

export function applyPolicyMultiplier(state, effect) {
  const before = Number(state.value);
  if (!Number.isFinite(before)) throw new TypeError("La ganancia base no es finita.");
  const after = before * Number(effect.multiplier);
  return {
    state: { ...state, value: after },
    before,
    after,
    delta: after - before,
    multiplier: Number(effect.multiplier)
  };
}

export function applyAwakeningSlotGrant(state, effect) {
  const before = Number(state.value);
  if (!Number.isFinite(before)) throw new TypeError("La capacidad base no es finita.");
  const after = before + Number(effect.value);
  return {
    state: { ...state, value: after },
    before,
    after,
    delta: Number(effect.value)
  };
}

export function applyAttributeCapOverride(state, effect) {
  const before = Number(state.value);
  if (!Number.isFinite(before)) throw new TypeError("El cap base no es finito.");
  const after = Math.max(before, Number(effect.value));
  return {
    state: { ...state, value: after },
    before,
    after,
    delta: after - before
  };
}

export function collectEffectImmunity(state, effect) {
  const policy = Object.freeze({
    filters: Object.freeze(effect.filters.map(filter => Object.freeze({ ...filter }))),
    protectedApplicationScope: effect.protectedApplicationScope,
    protectedPolarity: effect.protectedPolarity
  });
  return {
    state: { ...state, immunityPolicies: [...(state.immunityPolicies ?? []), policy] },
    before: state.immunityPolicies?.length ?? 0,
    after: (state.immunityPolicies?.length ?? 0) + 1,
    delta: 1,
    immunityPolicy: policy
  };
}
