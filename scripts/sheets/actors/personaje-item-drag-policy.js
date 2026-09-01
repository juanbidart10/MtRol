export const MTROL_INTERNAL_ITEM_DRAG_SOURCE = "mtrol-personaje-sheet";

export function buildInternalItemDragData(actor, item, slotOrigin = "") {
  return {
    type: "Item",
    uuid: item?.uuid ?? `${actor?.uuid ?? `Actor.${actor?.id}`}.Item.${item?.id}`,
    actorId: actor?.id ?? "",
    itemId: item?.id ?? "",
    mtrolInternal: {
      source: MTROL_INTERNAL_ITEM_DRAG_SOURCE,
      actorId: actor?.id ?? "",
      itemId: item?.id ?? "",
      slotOrigin: String(slotOrigin ?? "")
    }
  };
}

export function classifyItemDropData(actor, data) {
  const marker = data?.mtrolInternal;
  const isMarkedInternal = marker?.source === MTROL_INTERNAL_ITEM_DRAG_SOURCE;
  const actorId = String(marker?.actorId ?? data?.actorId ?? "").trim();
  const itemId = String(marker?.itemId ?? data?.itemId ?? "").trim();
  const uuid = String(data?.uuid ?? "").trim();
  const actorItems = Array.from(actor?.items ?? []);
  const uuidItem = uuid
    ? actorItems.find(item => String(item?.uuid ?? "") === uuid) ?? null
    : null;
  const idItem = itemId
    ? actor?.items?.get?.(itemId) ?? actorItems.find(item => item?.id === itemId) ?? null
    : null;
  const claimsCurrentActor = actorId === actor?.id ||
    Boolean(actor?.uuid && uuid.startsWith(`${actor.uuid}.Item.`));

  if (isMarkedInternal) {
    if (actorId !== actor?.id || !itemId || !idItem) return { kind: "invalid-internal", item: null };
    if (uuid && String(idItem.uuid ?? "") !== uuid) return { kind: "invalid-internal", item: null };
    return { kind: "internal", item: idItem };
  }
  if (uuidItem) return { kind: "internal", item: uuidItem };
  if (claimsCurrentActor) {
    if (idItem && uuid && String(idItem.uuid ?? "") !== uuid) {
      return { kind: "invalid-internal", item: null };
    }
    return idItem ? { kind: "internal", item: idItem } : { kind: "invalid-internal", item: null };
  }
  return { kind: "external", item: null };
}

