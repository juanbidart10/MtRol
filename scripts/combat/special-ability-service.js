import { getClassDefinition } from "../actors/class-registry.js";

export const MTROL_SPECIAL_ABILITIES_FLAG = "specialAbilities";
export const MTROL_SPECIAL_ABILITY_SLOTS = Object.freeze([1, 2]);
export const MTROL_ORB_CONTEXTUAL_HANDLER = "orb-contextual";

const SLOT_KEYS = Object.freeze({ 1: "specialAbility1", 2: "specialAbility2" });

function normalizeSlot(slot) {
  const value = Number(slot);
  if (!MTROL_SPECIAL_ABILITY_SLOTS.includes(value)) {
    throw new Error("El slot de Habilidad Especial no es válido.");
  }
  return value;
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function actorFlags(actor) {
  return actor?.getFlag?.("mtrol", MTROL_SPECIAL_ABILITIES_FLAG) ??
    actor?.flags?.mtrol?.[MTROL_SPECIAL_ABILITIES_FLAG] ?? {};
}

function itemSpecialKey(item) {
  return normalizeText(
    item?.system?.specialAbilityKey ??
    item?.getFlag?.("mtrol", "specialAbilityKey") ??
    item?.flags?.mtrol?.specialAbilityKey
  );
}

function itemSpecialHandler(item) {
  return normalizeText(
    item?.system?.specialAbilityHandler ??
    item?.getFlag?.("mtrol", "specialAbilityHandler") ??
    item?.flags?.mtrol?.specialAbilityHandler
  );
}

function actorItems(actor) {
  const collection = actor?.items;
  const items = Array.isArray(collection)
    ? collection
    : Array.isArray(collection?.contents)
      ? collection.contents
      : typeof collection?.values === "function"
        ? Array.from(collection.values())
        : Array.from(collection ?? []);
  return items.filter(item => item?.type === "competencia");
}

function resolveEmbeddedItem(actor, reference) {
  if (!reference) return null;
  const items = actorItems(actor);
  const uuid = normalizeText(reference.uuid ?? reference.itemUuid);
  if (uuid) {
    const byUuid = items.find(item => item.uuid === uuid);
    if (byUuid) return byUuid;
  }
  const itemId = normalizeText(reference.itemId ?? reference.id);
  if (itemId) {
    const byId = actor?.items?.get?.(itemId) ?? items.find(item => item.id === itemId);
    if (byId) return byId;
  }
  const key = normalizeText(reference.key);
  if (key) {
    const byKey = items.find(item => itemSpecialKey(item) === key);
    if (byKey) return byKey;
  }
  const legacyNames = Array.isArray(reference.legacyNames) ? reference.legacyNames : [];
  return items.find(item => legacyNames.includes(item.name)) ?? null;
}

export function getClassSpecialAbilityReference(actor, slot) {
  const normalizedSlot = normalizeSlot(slot);
  const classId = normalizeText(actor?.system?.identidad?.classId);
  return getClassDefinition(classId)?.[SLOT_KEYS[normalizedSlot]] ?? null;
}

export function resolveSpecialAbilitySlot(actor, slot) {
  const normalizedSlot = normalizeSlot(slot);
  const persisted = actorFlags(actor)?.[String(normalizedSlot)] ?? {};
  const overrideItemUuid = normalizeText(persisted.overrideItemUuid);
  const classReference = getClassSpecialAbilityReference(actor, normalizedSlot);
  const effectiveReference = overrideItemUuid ? { uuid: overrideItemUuid } : classReference;
  const item = resolveEmbeddedItem(actor, effectiveReference);
  const configured = Boolean(effectiveReference);
  const unlocked = persisted.unlocked === true;
  const configuredHandler = itemSpecialHandler(item);
  const handler = configuredHandler && configuredHandler !== "default"
    ? configuredHandler
    : (!overrideItemUuid ? normalizeText(classReference?.handler) : "") || "default";

  return {
    slot: normalizedSlot,
    label: `Habilidad Especial ${normalizedSlot === 1 ? "I" : "II"}`,
    unlocked,
    locked: !unlocked,
    overrideItemUuid: overrideItemUuid || null,
    source: overrideItemUuid ? "override" : "class",
    classReference,
    configured,
    invalidReference: configured && !item,
    item,
    itemId: item?.id ?? null,
    itemUuid: item?.uuid ?? null,
    handler
  };
}

export function findSpecialAbilitySlotForItem(actor, item) {
  if (!actor || !item) return null;
  return MTROL_SPECIAL_ABILITY_SLOTS
    .map(slot => resolveSpecialAbilitySlot(actor, slot))
    .find(state => state.item?.id === item.id || state.item?.uuid === item.uuid) ?? null;
}

export function validateSpecialAbilityExecution(actor, item, { slot, mode = null } = {}) {
  const state = resolveSpecialAbilitySlot(actor, slot);
  if (!state.configured) throw new Error(`${state.label} no tiene una habilidad asignada.`);
  if (state.invalidReference || !state.item) throw new Error(`La referencia de ${state.label} no se pudo resolver.`);
  if (!state.unlocked) throw new Error(`${state.label} está bloqueada.`);
  if (state.item.id !== item?.id && state.item.uuid !== item?.uuid) {
    throw new Error("La habilidad ejecutada no coincide con el slot resuelto.");
  }
  if (state.handler === MTROL_ORB_CONTEXTUAL_HANDLER && !["attack", "movement"].includes(mode)) {
    throw new Error("El modo contextual seleccionado no está disponible.");
  }
  return state;
}

export function buildSpecialAbilitySlotView(actor, slot, {
  getCooldownStatus = () => ({ available: true, availableAtRound: null, roundsRemaining: 0 }),
  getActionGuard = () => ({ allowed: true, reason: null }),
  viewerIsGM = false
} = {}) {
  const state = resolveSpecialAbilitySlot(actor, slot);
  const cooldown = state.item ? getCooldownStatus(state.item) : { available: true };
  const guard = state.item ? getActionGuard(actor, state.item) : { allowed: false, reason: null };
  const name = state.item?.name ?? state.classReference?.label ?? "Sin habilidad asignada";
  const hiddenByLock = state.configured && state.locked && !viewerIsGM;
  const status = !state.configured
    ? "Inactiva"
    : state.invalidReference
      ? "Referencia inválida"
      : state.locked
        ? "Bloqueada"
        : !cooldown.available
          ? "En enfriamiento"
          : guard.allowed ? "Disponible" : (guard.reason ?? "No disponible");
  const candidates = actorItems(actor).map(item => ({
    id: item.id,
    uuid: item.uuid,
    name: item.name,
    selected: item.uuid === state.overrideItemUuid
  }));

  if (hiddenByLock) {
    return {
      slot: state.slot,
      label: state.label,
      unlocked: false,
      locked: true,
      configured: state.configured,
      invalidReference: false,
      item: null,
      itemId: null,
      itemUuid: null,
      overrideItemUuid: null,
      source: null,
      classReference: null,
      handler: null,
      name: "Habilidad bloqueada",
      img: "icons/svg/lock.svg",
      cooldown: null,
      cooldownAvailable: true,
      availableAtRound: null,
      status: "Bloqueada",
      canUse: false,
      candidates: []
    };
  }

  return {
    ...state,
    name,
    img: state.item?.img ?? "icons/svg/item-bag.svg",
    cooldown: Number(state.item?.system?.cooldown ?? 0),
    cooldownAvailable: cooldown.available !== false,
    availableAtRound: cooldown.availableAtRound ?? null,
    status,
    canUse: Boolean(state.item && state.unlocked && cooldown.available !== false && guard.allowed),
    candidates
  };
}

export async function updateSpecialAbilitySlot(actor, slot, changes = {}) {
  if (!game.user?.isGM) throw new Error("Sólo un GM puede configurar Habilidades Especiales.");
  const normalizedSlot = normalizeSlot(slot);
  const current = actorFlags(actor);
  const previous = current?.[String(normalizedSlot)] ?? {};
  const next = {
    unlocked: changes.unlocked === undefined ? previous.unlocked === true : changes.unlocked === true,
    overrideItemUuid: changes.clearOverride === true
      ? null
      : changes.overrideItemUuid === undefined
        ? normalizeText(previous.overrideItemUuid) || null
        : normalizeText(changes.overrideItemUuid) || null
  };
  if (next.overrideItemUuid && !resolveEmbeddedItem(actor, { uuid: next.overrideItemUuid })) {
    throw new Error("El override debe referenciar una Competencia embebida en este Actor.");
  }
  await actor.update({ [`flags.mtrol.${MTROL_SPECIAL_ABILITIES_FLAG}.${normalizedSlot}`]: next });
  return resolveSpecialAbilitySlot(actor, normalizedSlot);
}

function specialAbilityFlagsChanged(changes) {
  const direct = Object.keys(changes ?? {}).some(key =>
    key === `flags.mtrol.${MTROL_SPECIAL_ABILITIES_FLAG}` ||
    key.startsWith(`flags.mtrol.${MTROL_SPECIAL_ABILITIES_FLAG}.`));
  const nested = Object.hasOwn(changes?.flags?.mtrol ?? {}, MTROL_SPECIAL_ABILITIES_FLAG);
  return direct || nested;
}

export function installSpecialAbilityAuthorityHooks() {
  Hooks.on("preUpdateActor", (_actor, changes, _options, userId) => {
    if (!specialAbilityFlagsChanged(changes)) return true;
    const user = game.users?.get?.(userId) ?? Array.from(game.users ?? []).find(entry => entry.id === userId);
    if (user?.isGM) return true;
    ui.notifications.warn("Sólo un GM puede configurar Habilidades Especiales.");
    return false;
  });
  Hooks.on("updateActor", (actor, changes) => {
    if (specialAbilityFlagsChanged(changes) && actor?.sheet?.rendered) actor.sheet.render(false);
  });
}

export function installSpecialAbilityApi() {
  game.mtrol = game.mtrol || {};
  game.mtrol.specialAbilities = {
    resolveSlot: resolveSpecialAbilitySlot,
    updateSlot: updateSpecialAbilitySlot
  };
}
