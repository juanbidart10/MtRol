import { MTROL_EFFECT_ATTRIBUTE_KEYS } from "../effects/effect-types.js";
import {
  getOppositionActionDefinition,
  OPPOSITION_CAPABILITIES
} from "./opposition-policy.js";

const ATTRIBUTE_REFERENCE = /@atributos\.([A-Za-z0-9_]+)/g;
const COMPETENCY_REFERENCE = /@competencias\.([A-Za-z0-9_]+)/g;
const COMPETENCY_DIE_REFERENCE = /@competenciasDado\b(?:\.([A-Za-z0-9_.]*))?/g;
const KNOWN_ROOT_REFERENCE = /@([A-Za-z][A-Za-z0-9_]*)/g;
const KNOWN_ROOTS = Object.freeze([
  "atributos", "competencias", "competenciasDado", "armas", "recursos", "vitales",
  "mano", "manoDer", "manoIzq"
]);

export function getCanonicalDamageFormula(item, declaredMode = null) {
  const mode = Array.from(item?.system?.executionModes ?? [])
    .find(candidate => candidate?.modeId === declaredMode);
  if (mode && Object.hasOwn(mode, "damageFormula")) {
    return String(mode.damageFormula ?? "").trim();
  }
  const persisted = item?._source?.system ?? {};
  if (Object.hasOwn(persisted, "damageFormula")) {
    return String(item?.system?.damageFormula ?? "").trim();
  }
  return String(item?.system?.damageFormula ?? item?.system?.danio ?? "").trim();
}

export function validateCanonicalFormula(formula, {
  required = true,
  allowWeapons = false,
  label = "fórmula"
} = {}) {
  const text = String(formula ?? "").trim();
  if (!text) {
    if (!required) return { valid: true, formula: "", errors: [] };
    return { valid: false, formula: text, errors: [`${label} vacía.`] };
  }

  const errors = [];
  for (const match of text.matchAll(ATTRIBUTE_REFERENCE)) {
    if (!MTROL_EFFECT_ATTRIBUTE_KEYS.includes(match[1])) {
      errors.push(`Atributo desconocido: @atributos.${match[1]}.`);
    }
  }
  for (const [namespace, reference] of [
    ["competencias", COMPETENCY_REFERENCE],
    ["competenciasDado", COMPETENCY_DIE_REFERENCE]
  ]) {
    for (const match of text.matchAll(reference)) {
      if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(match[1] ?? "")) {
        errors.push(`Referencia de competencia inválida: @${namespace}.${match[1] ?? ""}.`);
      }
    }
  }
  for (const match of text.matchAll(KNOWN_ROOT_REFERENCE)) {
    if (!KNOWN_ROOTS.includes(match[1])) errors.push(`Referencia desconocida: @${match[1]}.`);
    if (match[1] === "armas" && !allowWeapons) {
      errors.push("@armas sólo puede utilizarse en damageFormula.");
    }
  }
  if (allowWeapons && /@armas\.[A-Za-z0-9_]+/.test(text)) {
    errors.push("@armas no admite subclaves.");
  }

  if (errors.length === 0 && typeof globalThis.Roll?.validate === "function") {
    try {
      if (!globalThis.Roll.validate(text)) errors.push(`${label} inválida.`);
    } catch (_error) {
      errors.push(`${label} inválida.`);
    }
  }
  return { valid: errors.length === 0, formula: text, errors };
}

export function normalizeContextualModifiers(modifiers = [], {
  allowGmOnly = globalThis.game?.user?.isGM === true
} = {}) {
  if (!Array.isArray(modifiers)) throw new Error("Los modifiers deben ser una lista.");
  return modifiers.map((modifier, index) => {
    const sourceId = String(modifier?.sourceId ?? "").trim();
    const sourceType = String(modifier?.sourceType ?? "").trim();
    const label = String(modifier?.label ?? "").trim();
    const value = Number(modifier?.value);
    if (!sourceId || !sourceType || !label || !Number.isFinite(value)) {
      throw new Error(`Modifier contextual inválido en posición ${index + 1}.`);
    }
    if (sourceType === "gm-level-difference") {
      if (!allowGmOnly) throw new Error("Sólo el GM puede adjudicar Diferencia de nivel.");
      if (value !== -5) throw new Error("Diferencia de nivel debe valer exactamente -5.");
    }
    return Object.freeze({ sourceId, sourceType, label, value });
  });
}

export function appendModifiersToFormula(formula, modifiers = []) {
  return modifiers.reduce((effective, modifier) => {
    const value = Number(modifier.value);
    return `${effective} ${value < 0 ? "-" : "+"} ${Math.abs(value)}`;
  }, String(formula ?? "").trim());
}

export function findTechnicallyCompatibleResponses(targetActor, actionDefinition) {
  const allowed = new Set(actionDefinition?.allowedResponses ?? []);
  const domain = actionDefinition?.actionDomain ?? null;
  return Array.from(targetActor?.items ?? []).filter(item => {
    if (item?.type !== "competencia") return false;
    const response = getOppositionActionDefinition(item);
    const capability = response.capabilities.some(value => allowed.has(value));
    if (!capability || !response.capabilities.includes(OPPOSITION_CAPABILITIES.REACTION)) return false;
    const usesCounterattack = response.capabilities.some(value =>
      value === OPPOSITION_CAPABILITIES.COUNTERATTACK && allowed.has(value)
    );
    return !usesCounterattack || Boolean(domain && response.responseDomain === domain);
  });
}

export function assertCanonicalOffensiveConfiguration({ item, targetActor, definition, declaredMode = null }) {
  if (definition?.resolutionResult !== "damage") return true;
  const initial = validateCanonicalFormula(item?.system?.formula || item?.system?.formulaTirada, {
    label: "formula"
  });
  const damage = validateCanonicalFormula(getCanonicalDamageFormula(item, declaredMode), {
    allowWeapons: true,
    label: "damageFormula"
  });
  if (!initial.valid) throw new Error(`Configuración inválida de ${item?.name}: ${initial.errors.join(" ")}`);
  if (!damage.valid) throw new Error(`Configuración inválida de ${item?.name}: ${damage.errors.join(" ")}`);
  if (!definition.actionDomain) throw new Error(`${item?.name} no tiene actionDomain válido.`);
  if (!Array.isArray(definition.allowedResponses) || definition.allowedResponses.length === 0) {
    throw new Error(`${item?.name} no declara allowedResponses.`);
  }
  if (targetActor && findTechnicallyCompatibleResponses(targetActor, definition).length === 0) {
    throw new Error(`El objetivo no posee una respuesta técnicamente compatible con ${item?.name}.`);
  }
  return true;
}
