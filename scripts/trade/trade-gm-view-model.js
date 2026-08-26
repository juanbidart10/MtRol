import {
  getItemQuantity,
  getItemUnitWeight,
  isItemActuallyEquipped,
  normalizeEquippedFlag
} from "../items/item-invariants.js";

function requireGM(user) {
  if (!user?.isGM) throw new Error("La supervisión de comercio es exclusiva para GM.");
}

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function reservationQuantity(reservations, item) {
  return reservations.filter(entry =>
    entry.itemUuid === item.uuid || entry.itemId === item.id
  ).reduce((total, entry) => total + (Number(entry.quantity) || 0), 0);
}

function invalidFor(session, key, item) {
  return (session.invalidEntries ?? []).find(entry =>
    entry.participantKey === key && (entry.itemUuid === item.uuid || entry.itemId === item.id)
  ) ?? null;
}

function inventoryItem(actor, item, reservations, session, key) {
  const realQuantity = getItemQuantity(item);
  const reservedQuantity = reservationQuantity(reservations, item);
  const invalid = invalidFor(session, key, item);
  const equipped = isItemActuallyEquipped(actor, item) || normalizeEquippedFlag(item.system?.equipado);
  return {
    itemUuid: text(item.uuid),
    itemId: text(item.id),
    name: text(item.name, "Objeto"),
    img: text(item.img, "icons/svg/item-bag.svg"),
    type: text(item.type),
    tipoObjeto: text(item.system?.tipoObjeto, "general"),
    realQuantity,
    reservedQuantity,
    availableQuantity: Math.max(0, realQuantity - reservedQuantity),
    equipped,
    unitWeight: getItemUnitWeight(item),
    invalid: Boolean(invalid),
    invalidReason: invalid?.reason ?? null
  };
}

export async function buildGMTradeMonitorView({
  session,
  user = globalThis.game?.user,
  resolveActor = uuid => globalThis.fromUuid?.(uuid),
  reservations = session?.reservations ?? [],
  timeline = []
} = {}) {
  requireGM(user);
  if (!session?.id) throw new Error("La sesión de comercio no existe.");
  const sides = {};
  for (const key of ["participantA", "participantB"]) {
    const participant = session.participants?.[key];
    const actor = await resolveActor(participant?.actorUuid);
    if (!actor) throw new Error(`No se encontró el Actor de ${key}.`);
    const inventory = Array.from(actor.items ?? []).map(item =>
      inventoryItem(actor, item, reservations, session, key)
    );
    const byUuid = new Map(inventory.map(item => [item.itemUuid, item]));
    sides[key] = {
      key,
      participant: { ...participant },
      inventory,
      offer: (session.publicOffers?.[key] ?? []).map(entry => {
        const real = byUuid.get(entry.itemUuid);
        const invalid = invalidFor(session, key, { uuid: entry.itemUuid, id: entry.itemId });
        return {
          ...entry,
          realQuantity: real?.realQuantity ?? 0,
          reservedQuantity: real?.reservedQuantity ?? 0,
          availableQuantity: real?.availableQuantity ?? 0,
          valid: !invalid && Number(entry.quantity) <= Number(real?.realQuantity ?? 0),
          invalidReason: invalid?.reason ?? (Number(entry.quantity) > Number(real?.realQuantity ?? 0)
            ? "Cantidad ofertada superior a la real"
            : null)
        };
      }),
      confirmation: {
        confirmed: session.confirmations?.[key]?.confirmed === true,
        revision: session.confirmations?.[key]?.revision ?? null,
        current: session.confirmations?.[key]?.confirmed === true &&
          session.confirmations?.[key]?.revision === session.revision
      }
    };
  }

  return {
    gmOnly: true,
    readOnlyOffers: true,
    sessionId: session.id,
    executionId: session.execution?.executionId ?? null,
    authority: { ...session.authority },
    state: session.state,
    revision: session.revision,
    timestamps: {
      createdAt: session.createdAt ?? null,
      updatedAt: session.updatedAt ?? null,
      completedAt: session.completedAt ?? null,
      cancelledAt: session.cancelledAt ?? null,
      invalidatedAt: session.invalidatedAt ?? null
    },
    participantA: sides.participantA,
    participantB: sides.participantB,
    sides: [sides.participantA, sides.participantB],
    reservations: reservations.map(entry => ({
      actorUuid: entry.actorUuid,
      itemUuid: entry.itemUuid,
      itemId: entry.itemId,
      quantity: Number(entry.quantity) || 0,
      sessionId: entry.sessionId ?? session.id,
      participantKey: entry.participantKey
    })),
    timeline: [...timeline],
    canCancel: !["EXECUTING", "COMPLETED", "CANCELLED", "INVALID"].includes(session.state),
    cancelDisabledReason: session.state === "EXECUTING"
      ? "Una transferencia en ejecución no puede interrumpirse."
      : null
  };
}
