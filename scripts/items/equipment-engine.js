import {
  MTROL_BODY_SLOTS
} from "../constants/body-slots.js";

export const MTROL_HAND_SLOTS = [
  "manoIzq",
  "manoDer"
];

function normalizeSlot(slot) {
  const value =
    String(slot ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[\s_-]+/g, "");

  if (["manoizq", "manoizquierda", "lefthand", "handleft", "izquierda"].includes(value)) {
    return "manoIzq";
  }

  if (["manoder", "manoderecha", "righthand", "handright", "derecha"].includes(value)) {
    return "manoDer";
  }

  return slot;
}

function resolveEquippedReference(actor, reference) {
  if (!actor || !reference) return null;

  const items =
    Array.from(actor.items ?? []);

  if (typeof reference === "string") {
    return (
      actor.items.get?.(reference) ??
      items.find(item =>
        item.id === reference ||
        item.uuid === reference ||
        item.name === reference
      ) ??
      null
    );
  }

  if (typeof reference !== "object") return null;

  const itemId =
    reference.id ??
    reference._id ??
    reference.itemId ??
    reference.uuid ??
    reference.itemUuid ??
    null;

  if (itemId) {
    const byId =
      actor.items.get?.(itemId) ??
      items.find(item =>
        item.id === itemId ||
        item.uuid === itemId
      );

    if (byId) return byId;
  }

  const itemName =
    reference.name ??
    reference.nombre ??
    reference.item?.name ??
    null;

  return itemName
    ? items.find(item => item.name === itemName) ?? null
    : null;
}

function isCanonicalHandItem(actor, item, slot) {
  if (!actor || !item) return false;
  if (item.type !== "objeto" && item.type !== "item") return false;

  const itemSlot =
    normalizeSlot(item.system?.slot);

  const equipped =
    item.system?.equipado === true ||
    item.system?.equipado === "true";

  return equipped && itemSlot === slot;
}

export function getEquippedHandItems(actor) {
  const result = {
    manoIzq: null,
    manoDer: null
  };

  if (!actor) return result;

  for (const slot of MTROL_HAND_SLOTS) {
    const reference =
      actor.system?.equipamiento?.[slot] ?? null;

    const item =
      resolveEquippedReference(actor, reference);

    result[slot] =
      isCanonicalHandItem(actor, item, slot)
        ? item
        : null;
  }

  return result;
}

export function getEquippedShields(actor) {
  const hands =
    getEquippedHandItems(actor);

  return MTROL_HAND_SLOTS
    .map(slot => ({
      slot,
      item: hands[slot]
    }))
    .filter(({ item }) =>
      String(item?.system?.tipoObjeto ?? "")
        .trim()
        .toLowerCase() === "escudo"
    );
}

// =========================
// MTROL - EQUIPMENT ENGINE
// =========================
// Motor centralizado de equipamiento.
//
// Responsabilidades:
// ✔ Validar objetos equipables
// ✔ Validar slots corporales
// ✔ Equipar objetos
// ✔ Reemplazar objeto ocupado
// ✔ Desequipar objetos
// =========================

export async function equiparObjeto(actor, item) {
  if (!actor || !item) return false;

  if (item.type !== "objeto" && item.type !== "item") return false;

  if (!item.system?.equipable) {
    ui.notifications.warn("Este objeto no es equipable.");
    return false;
  }

  const slot = item.system?.slot;

  if (!slot) {
    ui.notifications.warn("Este objeto no tiene un slot asignado.");
    return false;
  }

  if (!MTROL_BODY_SLOTS.includes(slot)) {
    ui.notifications.warn("El slot asignado al objeto no es válido.");
    return false;
  }

  const ocupadoId = actor.system.equipamiento?.[slot];

  if (ocupadoId && ocupadoId !== item.id) {
    const itemOcupado = actor.items.get(ocupadoId);

    if (itemOcupado) {
      await itemOcupado.update({
        "system.equipado": false
      });
    }
  }

  await actor.update({
    [`system.equipamiento.${slot}`]: item.id
  });

  await item.update({
    "system.equipado": true
  });

  return true;
}

export async function desequiparObjeto(actor, item) {
  if (!actor || !item) return false;

  if (item.type !== "objeto" && item.type !== "item") return false;

  const slot = item.system?.slot;

  if (slot) {
    await actor.update({
      [`system.equipamiento.${slot}`]: ""
    });
  }

  await item.update({
    "system.equipado": false
  });

  return true;
}
