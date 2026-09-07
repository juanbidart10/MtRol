import { MTROL_ATTRIBUTE_CAP } from "../progression/progression-constants.js";

export const MTROL_EFFECT_PHASES = Object.freeze({
  DAMAGE_FORMULA_BUILD: "DAMAGE_FORMULA_BUILD",
  DAMAGE_MITIGATION: "DAMAGE_MITIGATION",
  ROLL_RESULT_MODIFICATION: "ROLL_RESULT_MODIFICATION",
  INITIATIVE_BUILD: "INITIATIVE_BUILD",
  AFTER_DAMAGE_APPLIED: "AFTER_DAMAGE_APPLIED",
  COMPETENCY_PROGRESSION_POLICY: "COMPETENCY_PROGRESSION_POLICY",
  PROGRESSION_POLICY: "PROGRESSION_POLICY",
  ATTRIBUTE_CAP_POLICY: "ATTRIBUTE_CAP_POLICY",
  AWAKENING_CAPACITY_POLICY: "AWAKENING_CAPACITY_POLICY",
  EFFECT_IMMUNITY_POLICY: "EFFECT_IMMUNITY_POLICY"
});

export const MTROL_EFFECT_TYPES = Object.freeze({
  ATTRIBUTE_DAMAGE_MULTIPLIER: "ATTRIBUTE_DAMAGE_MULTIPLIER",
  FLAT_DAMAGE_REDUCTION_FROM_ATTRIBUTE: "FLAT_DAMAGE_REDUCTION_FROM_ATTRIBUTE",
  CONDITIONAL_ROLL_MULTIPLIER: "CONDITIONAL_ROLL_MULTIPLIER",
  INITIATIVE_BONUS: "INITIATIVE_BONUS",
  DAMAGE_TO_RESOURCE: "DAMAGE_TO_RESOURCE",
  COMPETENCY_PROGRESSION_MULTIPLIER: "COMPETENCY_PROGRESSION_MULTIPLIER",
  EFFECT_IMMUNITY: "EFFECT_IMMUNITY",
  GRANT_AWAKENING_SLOT: "GRANT_AWAKENING_SLOT",
  ATTRIBUTE_CAP_OVERRIDE: "ATTRIBUTE_CAP_OVERRIDE",
  PROGRESSION_MULTIPLIER: "PROGRESSION_MULTIPLIER"
});

export const MTROL_EFFECT_SUBJECTS = Object.freeze({
  SOURCE: "source",
  TARGET: "target"
});

export const MTROL_EFFECT_ATTRIBUTE_KEYS = Object.freeze([
  "resistencia", "carisma", "fuerza", "inteligencia", "voluntad",
  "aura", "percepcion", "destreza", "suerte"
]);

function validateCommon(effect, expectedSubject) {
  const errors = [];
  if (!MTROL_EFFECT_ATTRIBUTE_KEYS.includes(effect?.attribute)) errors.push("attribute no es canónico");
  if (effect?.subject !== expectedSubject) errors.push(`subject debe ser ${expectedSubject}`);
  if (effect?.requiresCombat !== true && effect?.requiresCombat !== false) errors.push("requiresCombat debe ser booleano");
  if (!Number.isFinite(Number(effect?.priority))) errors.push("priority debe ser numérica");
  return errors;
}

function validatePolicyCommon(effect) {
  const errors = [];
  if (effect?.subject !== MTROL_EFFECT_SUBJECTS.SOURCE) errors.push("subject debe ser source");
  if (!Number.isFinite(Number(effect?.priority))) errors.push("priority debe ser numérica");
  if (effect?.applicationScope !== "self") errors.push("applicationScope debe ser self");
  return errors;
}

export const MTROL_EFFECT_TYPE_REGISTRY = Object.freeze({
  [MTROL_EFFECT_TYPES.ATTRIBUTE_DAMAGE_MULTIPLIER]: Object.freeze({
    type: MTROL_EFFECT_TYPES.ATTRIBUTE_DAMAGE_MULTIPLIER,
    phase: MTROL_EFFECT_PHASES.DAMAGE_FORMULA_BUILD,
    subject: MTROL_EFFECT_SUBJECTS.SOURCE,
    validate(effect) {
      const errors = validateCommon(effect, MTROL_EFFECT_SUBJECTS.SOURCE);
      if (!Number.isFinite(Number(effect?.multiplier)) || Number(effect.multiplier) <= 0) {
        errors.push("multiplier debe ser mayor que 0");
      }
      return errors;
    }
  }),
  [MTROL_EFFECT_TYPES.FLAT_DAMAGE_REDUCTION_FROM_ATTRIBUTE]: Object.freeze({
    type: MTROL_EFFECT_TYPES.FLAT_DAMAGE_REDUCTION_FROM_ATTRIBUTE,
    phase: MTROL_EFFECT_PHASES.DAMAGE_MITIGATION,
    subject: MTROL_EFFECT_SUBJECTS.TARGET,
    validate(effect) {
      const errors = validateCommon(effect, MTROL_EFFECT_SUBJECTS.TARGET);
      if (!Number.isFinite(Number(effect?.multiplier)) || Number(effect.multiplier) < 0) {
        errors.push("multiplier debe ser mayor o igual que 0");
      }
      return errors;
    }
  }),
  [MTROL_EFFECT_TYPES.CONDITIONAL_ROLL_MULTIPLIER]: Object.freeze({
    type: MTROL_EFFECT_TYPES.CONDITIONAL_ROLL_MULTIPLIER,
    phase: MTROL_EFFECT_PHASES.ROLL_RESULT_MODIFICATION,
    subject: MTROL_EFFECT_SUBJECTS.SOURCE,
    validate(effect) {
      const errors = [];
      if (effect?.subject !== MTROL_EFFECT_SUBJECTS.SOURCE) errors.push("subject debe ser source");
      if (effect?.condition !== "hpPercentage <= 0.25") errors.push("condition no está soportada");
      if (!Number.isFinite(Number(effect?.multiplier)) || Number(effect.multiplier) <= 0) {
        errors.push("multiplier debe ser mayor que 0");
      }
      if (!Number.isFinite(Number(effect?.priority))) errors.push("priority debe ser numérica");
      return errors;
    }
  }),
  [MTROL_EFFECT_TYPES.INITIATIVE_BONUS]: Object.freeze({
    type: MTROL_EFFECT_TYPES.INITIATIVE_BONUS,
    phase: MTROL_EFFECT_PHASES.INITIATIVE_BUILD,
    subject: MTROL_EFFECT_SUBJECTS.SOURCE,
    validate(effect) {
      const errors = [];
      if (effect?.subject !== MTROL_EFFECT_SUBJECTS.SOURCE) errors.push("subject debe ser source");
      if (!Number.isFinite(Number(effect?.value))) errors.push("value debe ser numérico");
      if (!Number.isFinite(Number(effect?.priority))) errors.push("priority debe ser numérica");
      return errors;
    }
  }),
  [MTROL_EFFECT_TYPES.DAMAGE_TO_RESOURCE]: Object.freeze({
    type: MTROL_EFFECT_TYPES.DAMAGE_TO_RESOURCE,
    phase: MTROL_EFFECT_PHASES.AFTER_DAMAGE_APPLIED,
    subject: MTROL_EFFECT_SUBJECTS.SOURCE,
    validate(effect) {
      const errors = [];
      if (effect?.subject !== MTROL_EFFECT_SUBJECTS.SOURCE) errors.push("subject debe ser source");
      if (!["hp", "mp"].includes(effect?.resource)) errors.push("resource debe ser hp o mp");
      if (!Number.isFinite(Number(effect?.percentage)) || Number(effect.percentage) < 0) {
        errors.push("percentage debe ser mayor o igual que 0");
      }
      if (effect?.damageSourceAttribute !== undefined &&
          effect.damageSourceAttribute !== null &&
          !MTROL_EFFECT_ATTRIBUTE_KEYS.includes(effect.damageSourceAttribute)) {
        errors.push("damageSourceAttribute no es canónico");
      }
      if (!Number.isFinite(Number(effect?.priority))) errors.push("priority debe ser numérica");
      return errors;
    }
  }),
  [MTROL_EFFECT_TYPES.COMPETENCY_PROGRESSION_MULTIPLIER]: Object.freeze({
    type: MTROL_EFFECT_TYPES.COMPETENCY_PROGRESSION_MULTIPLIER,
    phase: MTROL_EFFECT_PHASES.COMPETENCY_PROGRESSION_POLICY,
    subject: MTROL_EFFECT_SUBJECTS.SOURCE,
    validate(effect) {
      const errors = validatePolicyCommon(effect);
      if (!Number.isFinite(Number(effect?.multiplier)) || Number(effect.multiplier) <= 0) {
        errors.push("multiplier debe ser mayor que 0");
      }
      return errors;
    }
  }),
  [MTROL_EFFECT_TYPES.PROGRESSION_MULTIPLIER]: Object.freeze({
    type: MTROL_EFFECT_TYPES.PROGRESSION_MULTIPLIER,
    phase: MTROL_EFFECT_PHASES.PROGRESSION_POLICY,
    subject: MTROL_EFFECT_SUBJECTS.SOURCE,
    validate(effect) {
      const errors = validatePolicyCommon(effect);
      if (!Number.isFinite(Number(effect?.multiplier)) || Number(effect.multiplier) <= 0) {
        errors.push("multiplier debe ser mayor que 0");
      }
      return errors;
    }
  }),
  [MTROL_EFFECT_TYPES.GRANT_AWAKENING_SLOT]: Object.freeze({
    type: MTROL_EFFECT_TYPES.GRANT_AWAKENING_SLOT,
    phase: MTROL_EFFECT_PHASES.AWAKENING_CAPACITY_POLICY,
    subject: MTROL_EFFECT_SUBJECTS.SOURCE,
    validate(effect) {
      const errors = validatePolicyCommon(effect);
      if (!Number.isInteger(Number(effect?.value)) || Number(effect.value) < 0) {
        errors.push("value debe ser un entero mayor o igual que 0");
      }
      return errors;
    }
  }),
  [MTROL_EFFECT_TYPES.ATTRIBUTE_CAP_OVERRIDE]: Object.freeze({
    type: MTROL_EFFECT_TYPES.ATTRIBUTE_CAP_OVERRIDE,
    phase: MTROL_EFFECT_PHASES.ATTRIBUTE_CAP_POLICY,
    subject: MTROL_EFFECT_SUBJECTS.SOURCE,
    validate(effect) {
      const errors = validatePolicyCommon(effect);
      if (!Number.isInteger(Number(effect?.value)) || Number(effect.value) < MTROL_ATTRIBUTE_CAP) {
        errors.push("value debe ser un entero mayor o igual que el cap estándar");
      }
      return errors;
    }
  }),
  [MTROL_EFFECT_TYPES.EFFECT_IMMUNITY]: Object.freeze({
    type: MTROL_EFFECT_TYPES.EFFECT_IMMUNITY,
    phase: MTROL_EFFECT_PHASES.EFFECT_IMMUNITY_POLICY,
    subject: MTROL_EFFECT_SUBJECTS.SOURCE,
    validate(effect) {
      const errors = validatePolicyCommon(effect);
      if (!Array.isArray(effect?.filters) || effect.filters.length === 0) {
        errors.push("filters debe contener al menos un filtro");
      } else {
        for (const filter of effect.filters) {
          const keys = Object.keys(filter ?? {});
          if (keys.length !== 1 || !["sourceCategory", "tag"].includes(keys[0]) ||
              typeof filter[keys[0]] !== "string" || !filter[keys[0]].trim()) {
            errors.push("cada filtro debe declarar sourceCategory o tag");
          }
        }
      }
      if (effect?.protectedApplicationScope !== "target") {
        errors.push("protectedApplicationScope debe ser target");
      }
      if (effect?.protectedPolarity !== "hostile") errors.push("protectedPolarity debe ser hostile");
      return errors;
    }
  })
});

export function getEffectTypeContract(type) {
  return MTROL_EFFECT_TYPE_REGISTRY[String(type ?? "")] ?? null;
}

export function validateEffectDefinition(effect) {
  const contract = getEffectTypeContract(effect?.type);
  if (!contract) return { supported: false, valid: true, errors: [] };
  const errors = contract.validate(effect);
  return { supported: true, valid: errors.length === 0, errors };
}
