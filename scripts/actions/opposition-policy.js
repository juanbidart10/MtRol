import {
  getCounterattackPolicyForClass
} from "../actors/class-registry.js";

export const OPPOSITION_CAPABILITIES = Object.freeze({
  OFFENSIVE: "OFFENSIVE",
  DEFENSE: "DEFENSE",
  DODGE: "DODGE",
  COUNTERATTACK: "COUNTERATTACK",
  REACTION: "REACTION",
  MOVEMENT: "MOVEMENT"
});

export const OPPOSITION_DOMAINS = Object.freeze({
  PHYSICAL: "PHYSICAL",
  MAGICAL: "MAGICAL"
});

export const DEFAULT_ALLOWED_RESPONSES = Object.freeze([
  OPPOSITION_CAPABILITIES.DEFENSE,
  OPPOSITION_CAPABILITIES.DODGE,
  OPPOSITION_CAPABILITIES.COUNTERATTACK
]);

const VALID_CAPABILITIES = new Set(Object.values(OPPOSITION_CAPABILITIES));
const VALID_DOMAINS = new Set(Object.values(OPPOSITION_DOMAINS));
const CAPABILITY_ORDER = Object.values(OPPOSITION_CAPABILITIES);
const ACTION_IDENTITIES = new Set(["spell", "competence", "combat", "special", "basic"]);
const CATEGORY_IDENTITIES = Object.freeze({
  hechizo: "spell",
  competencia: "competence",
  combate: "combat",
  contraataque: "combat",
  basico: "basic",
  pasiva: "special"
});
const LEGACY_OFFENSIVE_TYPES = new Set(["attack", "basicAttack", "combatSkill", "damage"]);

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeList(values, allowed) {
  const source = Array.isArray(values) ? values : [];
  return Array.from(new Set(source
    .map(value => String(value ?? "").trim().toUpperCase())
    .filter(value => allowed.has(value))));
}

export function normalizeOppositionDomain(value) {
  const domain = String(value ?? "").trim().toUpperCase();
  return VALID_DOMAINS.has(domain) ? domain : null;
}

export function resolveActionIdentity(item = {}) {
  const system = item?.system ?? {};
  const explicit = normalizeText(system.actionIdentity);
  if (ACTION_IDENTITIES.has(explicit)) return explicit;
  const current = normalizeText(system.actionType);
  if (ACTION_IDENTITIES.has(current)) return current;
  return CATEGORY_IDENTITIES[normalizeText(system.categoria)] ?? "special";
}

export function resolveActionCapabilities(item = {}, { logger = null } = {}) {
  const system = item?.system ?? {};
  const explicit = normalizeList(system.capabilities, VALID_CAPABILITIES);
  if (explicit.length > 0) {
    return { capabilities: explicit, legacyMapped: false };
  }

  const capabilities = new Set();
  const legacyActionType = String(system.actionType ?? "");
  const defenseType = normalizeText(system.defenseType);
  const oppositionType = normalizeText(system.oppositionType);
  const category = normalizeText(system.categoria);

  if (LEGACY_OFFENSIVE_TYPES.has(legacyActionType) || system.effect === "damage") {
    capabilities.add(OPPOSITION_CAPABILITIES.OFFENSIVE);
  }
  if (legacyActionType === "movement") capabilities.add(OPPOSITION_CAPABILITIES.MOVEMENT);
  if (legacyActionType === "defense") {
    capabilities.add(OPPOSITION_CAPABILITIES.DEFENSE);
    capabilities.add(OPPOSITION_CAPABILITIES.REACTION);
  }
  if (defenseType === "dodge" || oppositionType === "dodge") {
    capabilities.delete(OPPOSITION_CAPABILITIES.DEFENSE);
    capabilities.add(OPPOSITION_CAPABILITIES.DODGE);
    capabilities.add(OPPOSITION_CAPABILITIES.REACTION);
    if (category === "hechizo") {
      capabilities.add(OPPOSITION_CAPABILITIES.MOVEMENT);
    }
  }
  if (category === "contraataque") {
    capabilities.add(OPPOSITION_CAPABILITIES.OFFENSIVE);
    capabilities.add(OPPOSITION_CAPABILITIES.COUNTERATTACK);
    capabilities.add(OPPOSITION_CAPABILITIES.REACTION);
  }

  const mapped = CAPABILITY_ORDER.filter(capability => capabilities.has(capability));
  if (mapped.length > 0) {
    logger?.debug?.("OPPOSITION", "legacy capability mapping used", {
      itemId: item?.id ?? null,
      legacyActionType,
      capabilities: mapped
    });
  }
  return { capabilities: mapped, legacyMapped: mapped.length > 0 };
}

export function resolveActionDomain(item = {}, { response = false } = {}) {
  const system = item?.system ?? {};
  return normalizeOppositionDomain(
    response
      ? system.responseDomain ?? system.actionDomain ?? system.damageType
      : system.actionDomain ?? system.damageType
  );
}

export function resolveAllowedResponses(item = {}) {
  const explicit = normalizeList(item?.system?.allowedResponses, new Set([
    OPPOSITION_CAPABILITIES.DEFENSE,
    OPPOSITION_CAPABILITIES.DODGE,
    OPPOSITION_CAPABILITIES.COUNTERATTACK
  ]));
  return explicit.length > 0 ? explicit : Array.from(DEFAULT_ALLOWED_RESPONSES);
}

export function getOppositionActionDefinition(item = {}, options = {}) {
  const mapped = resolveActionCapabilities(item, options);
  return {
    actionType: resolveActionIdentity(item),
    legacyActionType: item?.system?.actionType ?? null,
    capabilities: mapped.capabilities,
    legacyMapped: mapped.legacyMapped,
    actionDomain: resolveActionDomain(item),
    responseDomain: resolveActionDomain(item, { response: true }),
    allowedResponses: resolveAllowedResponses(item)
  };
}

function invalid(selectedCapability, reasonCode, humanReason, metadata = {}) {
  return { valid: false, selectedCapability, reasonCode, humanReason, metadata };
}

export function evaluateOppositionResponseEligibility({
  pendingAction,
  actor,
  item,
  selectedCapability = null,
  mode = null,
  guard = null,
  logger = null
} = {}) {
  const definition = getOppositionActionDefinition(item, { logger });
  const preset = String(
    selectedCapability ?? item?.system?.responseCapability ?? ""
  ).trim().toUpperCase();
  const candidates = definition.capabilities.filter(capability =>
    pendingAction?.allowedResponses?.includes(capability)
  );
  const selected = preset || (candidates.length === 1 ? candidates[0] : null);
  const metadata = {
    actionType: definition.actionType,
    capabilities: definition.capabilities,
    actionDomain: pendingAction?.actionDomain ?? null,
    responseDomain: definition.responseDomain,
    allowedResponses: Array.from(pendingAction?.allowedResponses ?? []),
    mode: mode ?? null,
    itemUuid: item?.uuid ?? null,
    legacyMapped: definition.legacyMapped
  };

  if (!pendingAction?.id) return invalid(selected, "NO_PENDING_ACTION", "No existe una oposición activa.", metadata);
  if (pendingAction.status !== "waiting-defense") {
    return invalid(selected, "OPPOSITION_NOT_WAITING", "La oposición ya no admite respuestas.", metadata);
  }
  if (!actor || (
    pendingAction.targetActorId !== actor.id &&
    pendingAction.targetActorUuid !== actor.uuid
  )) {
    return invalid(selected, "UNAUTHORIZED_TARGET", "El Actor no es el objetivo autorizado de esta oposición.", metadata);
  }
  if (!item || item.type !== "competencia") {
    return invalid(selected, "INVALID_RESPONSE_ITEM", "La acción de respuesta no existe o no es utilizable.", metadata);
  }
  if (!preset && candidates.length > 1) {
    return invalid(
      null,
      "AMBIGUOUS_RESPONSE_CAPABILITY",
      "La acción posee varias respuestas posibles y necesita un preset mecánico.",
      metadata
    );
  }
  if (guard && (!guard.allowed || (guard.reactive && guard.opposition?.id !== pendingAction.id))) {
    return invalid(selected, "ACTION_GUARD_REJECTED", guard.reason ?? "La acción no pertenece a esta oposición.", metadata);
  }
  if (!selected || !definition.capabilities.includes(selected)) {
    return invalid(selected, "CAPABILITY_NOT_DECLARED", "La acción no declara una capacidad reactiva válida.", metadata);
  }
  if (!definition.capabilities.includes(OPPOSITION_CAPABILITIES.REACTION)) {
    return invalid(selected, "REACTION_NOT_DECLARED", "La acción no está configurada como reacción.", metadata);
  }
  if (!pendingAction.allowedResponses?.includes(selected)) {
    return invalid(selected, "RESPONSE_NOT_ALLOWED", "La oposición no permite este tipo de respuesta.", metadata);
  }

  if (selected === OPPOSITION_CAPABILITIES.COUNTERATTACK) {
    if (!pendingAction.actionDomain || !definition.responseDomain) {
      return invalid(selected, "COUNTERATTACK_DOMAIN_MISSING", "El contraataque no tiene un dominio mecánico válido.", metadata);
    }
    if (pendingAction.actionDomain !== definition.responseDomain) {
      return invalid(
        selected,
        "COUNTERATTACK_DOMAIN_MISMATCH",
        `No puedes contraatacar un ataque ${pendingAction.actionDomain === "MAGICAL" ? "mágico" : "físico"} con una respuesta ${definition.responseDomain === "MAGICAL" ? "mágica" : "física"}.`,
        metadata
      );
    }
    const classId = actor?.system?.identidad?.classId ?? null;
    const policy = getCounterattackPolicyForClass(classId);
    metadata.classPolicy = policy;
    const exceptionalDomains = normalizeList(item?.system?.counterattackDomainOverrides, VALID_DOMAINS);
    const permittedDomains = new Set([
      ...(policy?.counterattackDomains ?? []),
      ...exceptionalDomains
    ]);
    if (!policy || !permittedDomains.has(definition.responseDomain)) {
      return invalid(selected, "CLASS_POLICY_REJECTED", "La clase no permite contraatacar en ese dominio.", metadata);
    }
  }

  return {
    valid: true,
    selectedCapability: selected,
    reasonCode: "OK",
    humanReason: null,
    metadata
  };
}
