import {
  MTROL_ITEM_PRESENTATION_CATEGORIES,
  buildInventoryViewModel
} from "../items/inventory-view-model.js";

import {
  getItemQuantity,
  getItemUnitWeight,
  isItemActuallyEquipped,
  normalizeEquippedFlag
} from "../items/item-invariants.js";

const PARTICIPANT_KEYS = Object.freeze(["participantA", "participantB"]);
const EDITABLE_STATES = new Set(["NEGOTIATING", "READY"]);
const FALLBACK_ITEM_IMAGE = "icons/svg/item-bag.svg";

function clone(value) {
  if (value === undefined) return undefined;
  return globalThis.foundry?.utils?.deepClone?.(value) ??
    globalThis.foundry?.utils?.duplicate?.(value) ??
    structuredClone(value);
}

function safeString(value) {
  return typeof value === "string" ? value : String(value ?? "");
}

function safeImage(value) {
  const image = safeString(value).trim();
  return image || FALLBACK_ITEM_IMAGE;
}

function participantKeyForUser(session, userId) {
  return PARTICIPANT_KEYS.find(key =>
    session?.participants?.[key]?.userId === String(userId ?? "")
  ) ?? null;
}

function otherParticipantKey(participantKey) {
  return participantKey === "participantA" ? "participantB" : "participantA";
}

function assertPrivateViewAccess({ session, actor, user }) {
  if (!session?.id) throw new Error("La sesión de comercio no existe.");
  if (!user || user.isGM) {
    throw new Error("Los inventarios privados sólo están disponibles para participantes.");
  }

  const participantKey = participantKeyForUser(session, user.id);
  const participant = participantKey ? session.participants[participantKey] : null;
  if (!participant) throw new Error("El usuario no participa de esta sesión.");
  if (!actor || String(actor.uuid ?? "") !== participant.actorUuid) {
    throw new Error("El Actor no corresponde al participante autenticado.");
  }
  if (actor.testUserPermission?.(user, "OWNER") !== true) {
    throw new Error("El usuario no posee OWNER sobre su Actor de comercio.");
  }

  return { participantKey, participant };
}

function sanitizePublicData(publicData = {}) {
  return {
    unitWeight: Number(publicData.unitWeight) || 0,
    damage: publicData.damage ?? null,
    defense: publicData.defense ?? null,
    baseDefense: publicData.baseDefense ?? null,
    material: publicData.material ?? null,
    value: publicData.value ?? null
  };
}

function sanitizePublicOfferEntry(entry = {}) {
  return {
    itemUuid: safeString(entry.itemUuid).trim(),
    itemId: safeString(entry.itemId).trim(),
    name: safeString(entry.name),
    img: safeImage(entry.img),
    type: safeString(entry.type),
    tipoObjeto: safeString(entry.tipoObjeto).trim().toLowerCase() || "general",
    quantity: Number(entry.quantity),
    description: safeString(entry.description),
    publicData: sanitizePublicData(entry.publicData)
  };
}

export function buildPublicOfferView(session, participantKey) {
  if (!PARTICIPANT_KEYS.includes(participantKey)) {
    throw new Error("Participante de comercio inválido.");
  }
  const actorUuid = safeString(session?.participants?.[participantKey]?.actorUuid).trim();
  return (session?.publicOffers?.[participantKey] ?? [])
    .map(sanitizePublicOfferEntry)
    .filter(entry => actorUuid && entry.itemUuid.startsWith(`${actorUuid}.Item.`));
}

/** Public socket/cache contract. This deliberately excludes authority internals,
 * canonical reservations, operation receipts and both Actor inventories. */
export function buildPublicTradeSessionView(session) {
  if (!session?.id) return null;

  return {
    id: safeString(session.id),
    state: safeString(session.state),
    participants: Object.fromEntries(PARTICIPANT_KEYS.map(key => [key, {
      key,
      userId: safeString(session.participants?.[key]?.userId),
      actorUuid: safeString(session.participants?.[key]?.actorUuid),
      actorName: safeString(session.participants?.[key]?.actorName),
      actorImg: safeImage(session.participants?.[key]?.actorImg),
      tokenUuid: safeString(session.participants?.[key]?.tokenUuid) || null
    }])),
    revision: Number(session.revision) || 0,
    publicOffers: Object.fromEntries(PARTICIPANT_KEYS.map(key => [
      key,
      buildPublicOfferView(session, key)
    ])),
    confirmations: Object.fromEntries(PARTICIPANT_KEYS.map(key => [key, {
      confirmed: session.confirmations?.[key]?.confirmed === true,
      revision: Number.isInteger(session.confirmations?.[key]?.revision)
        ? session.confirmations[key].revision
        : null,
      confirmedAt: session.confirmations?.[key]?.confirmedAt ?? null
    }])),
    invalidEntries: (session.invalidEntries ?? []).map(entry => ({
      participantKey: PARTICIPANT_KEYS.includes(entry.participantKey) ? entry.participantKey : null,
      itemUuid: safeString(entry.itemUuid),
      itemId: safeString(entry.itemId),
      quantity: Number(entry.quantity) || 0,
      reason: safeString(entry.reason),
      invalidatedAt: entry.invalidatedAt ?? null
    })).filter(entry => entry.participantKey && entry.itemUuid),
    createdAt: session.createdAt ?? null,
    updatedAt: session.updatedAt ?? null,
    cancelledAt: session.cancelledAt ?? null,
    invalidatedAt: session.invalidatedAt ?? null,
    invalidReason: session.invalidReason ?? null,
    pauseState: session.pauseState ? { ...session.pauseState } : null,
    recovery: session.recovery ? { ...session.recovery } : null,
    execution: {
      executionId: safeString(session.execution?.executionId) || null,
      revision: Number.isInteger(session.execution?.revision) ? session.execution.revision : null,
      status: safeString(session.execution?.status) || null,
      startedAt: session.execution?.startedAt ?? null,
      completedAt: session.execution?.completedAt ?? null,
      failedAt: session.execution?.failedAt ?? null,
      failureReason: session.execution?.failureReason ?? null
    }
  };
}

export function buildPrivateInventoryView({ session, actor, user }) {
  const { participantKey } = assertPrivateViewAccess({ session, actor, user });
  const inventory = buildInventoryViewModel(actor);
  const offeredByUuid = new Map(
    buildPublicOfferView(session, participantKey)
      .map(entry => [entry.itemUuid, entry.quantity])
  );

  const inventoryDocuments = [...inventory.items];
  const knownIds = new Set(inventoryDocuments.map(item => item.id));
  for (const slot of inventory.slots ?? []) {
    if (slot.item && !knownIds.has(slot.item.id)) {
      knownIds.add(slot.item.id);
      inventoryDocuments.push(slot.item);
    }
  }

  const items = inventoryDocuments.map(item => {
      const realQuantity = getItemQuantity(item);
      const offeredQuantity = offeredByUuid.get(item.uuid) ?? 0;
      const tipoObjeto = safeString(item.system?.tipoObjeto).trim().toLowerCase() || "general";
      const equipped = isItemActuallyEquipped(actor, item) ||
        normalizeEquippedFlag(item?.system?.equipado);
      return {
        itemUuid: safeString(item.uuid),
        itemId: safeString(item.id),
        name: safeString(item.name),
        img: safeImage(item.img),
        tipoObjeto,
        category: MTROL_ITEM_PRESENTATION_CATEGORIES[tipoObjeto] ?? "objetos",
        realQuantity,
        offeredQuantity,
        reservedQuantity: offeredQuantity,
        available: equipped ? 0 : Math.max(0, realQuantity - offeredQuantity),
        availableIncludingSession: equipped ? 0 : realQuantity,
        unitWeight: getItemUnitWeight(item),
        equipped,
        tradeable: !equipped && realQuantity > 0
      };
    });

  return {
    sessionId: session.id,
    participantKey,
    actorUuid: actor.uuid,
    items,
    categories: Object.fromEntries(
      Object.values(MTROL_ITEM_PRESENTATION_CATEGORIES)
        .filter((category, index, all) => all.indexOf(category) === index)
        .map(category => [category, items.filter(item => item.category === category)])
    )
  };
}

export function buildParticipantTradeView({ session, actor, user }) {
  const privateInventory = buildPrivateInventoryView({ session, actor, user });
  const participantKey = privateInventory.participantKey;
  const rivalKey = otherParticipantKey(participantKey);
  const ownConfirmation = session.confirmations?.[participantKey] ?? {};
  const rivalConfirmation = session.confirmations?.[rivalKey] ?? {};
  const invalidByUuid = new Map((session.invalidEntries ?? []).map(entry => [
    entry.itemUuid,
    { reason: safeString(entry.reason), participantKey: entry.participantKey }
  ]));
  const ownOffer = buildPublicOfferView(session, participantKey).map(entry => ({
    ...entry,
    invalid: invalidByUuid.has(entry.itemUuid),
    invalidReason: invalidByUuid.get(entry.itemUuid)?.reason ?? null
  }));
  const rivalOffer = buildPublicOfferView(session, rivalKey).map(entry => ({
    ...entry,
    invalid: invalidByUuid.has(entry.itemUuid),
    invalidReason: invalidByUuid.get(entry.itemUuid)?.reason ?? null
  }));

  return {
    sessionId: session.id,
    state: session.state,
    revision: Number(session.revision) || 0,
    participantKey,
    rivalKey,
    ownOffer,
    rivalOffer,
    privateInventory,
    confirmations: {
      own: ownConfirmation.confirmed === true && ownConfirmation.revision === session.revision,
      rival: rivalConfirmation.confirmed === true && rivalConfirmation.revision === session.revision
    },
    canEditOffer: EDITABLE_STATES.has(session.state),
    hasInvalidEntry: ownOffer.some(entry => entry.invalid) || rivalOffer.some(entry => entry.invalid)
  };
}

export function buildGMTradeView(session) {
  const publicSession = buildPublicTradeSessionView(session);
  if (!publicSession) return null;
  return {
    ...publicSession,
    observer: "GM"
  };
}

export function buildTradeItemInspectorView(entry) {
  if (!entry) {
    return { selected: false, readOnly: true, editable: false };
  }

  const item = sanitizePublicOfferEntry(entry);
  const stats = [
    { label: "Cantidad ofrecida", value: item.quantity },
    { label: "Peso unitario", value: item.publicData.unitWeight }
  ];
  if (item.publicData.damage !== null) stats.push({ label: "Daño", value: item.publicData.damage });
  if (item.publicData.defense !== null) stats.push({ label: "Defensa", value: item.publicData.defense });
  if (item.publicData.baseDefense !== null) stats.push({ label: "Defensa base", value: item.publicData.baseDefense });
  if (item.publicData.material !== null) stats.push({ label: "Material", value: item.publicData.material });
  if (item.publicData.value !== null) stats.push({ label: "Valor", value: item.publicData.value });

  return {
    selected: true,
    readOnly: true,
    editable: false,
    ...item,
    totalOfferedWeight: item.publicData.unitWeight * item.quantity,
    stats
  };
}

export function findPublicOfferEntry(session, itemReference) {
  const needle = safeString(itemReference).trim();
  if (!needle) return null;
  for (const participantKey of PARTICIPANT_KEYS) {
    const entry = buildPublicOfferView(session, participantKey).find(candidate =>
      candidate.itemUuid === needle || candidate.itemId === needle
    );
    if (entry) return clone(entry);
  }
  return null;
}
