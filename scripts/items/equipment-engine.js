import {
  MTROL_BODY_SLOTS
} from "../constants/body-slots.js";

import {
  getDocumentById,
  getEquipmentItemForSlot,
  getEquipmentState,
  getReferencedSlotsForItem,
  isMtrolObject,
  toDocumentArray
} from "./item-invariants.js";
import { logger } from "../utils/logger.js";

export const MTROL_HAND_SLOTS = [
  "manoIzq",
  "manoDer"
];

function notifyWarning(message) {
  globalThis.ui?.notifications?.warn?.(message);
}

function notifyError(message) {
  globalThis.ui?.notifications?.error?.(message);
}

export function canUserManageEquipment(
  actor,
  user = globalThis.game?.user
) {
  if (!actor || !user) return false;
  if (user.isGM === true) return true;

  if (typeof actor.testUserPermission === "function") {
    return actor.testUserPermission(user, "OWNER") === true;
  }

  return actor.isOwner === true;
}

function buildFlagUpdates(actor, equipmentState) {
  const referencedIds = new Set(
    equipmentState.entries
      .map(entry => entry.resolvedItemId)
      .filter(Boolean)
  );

  return toDocumentArray(actor.items)
    .filter(isMtrolObject)
    .map(item => ({
      item,
      desired: referencedIds.has(item.id),
      original: item.system?.equipado
    }))
    .filter(entry => entry.original !== entry.desired);
}

async function updateItemFlags(actor, entries, valueSelector) {
  if (!entries.length) return;

  const updates = entries.map(entry => ({
    _id: entry.item.id,
    "system.equipado": valueSelector(entry)
  }));

  if (typeof actor.updateEmbeddedDocuments === "function") {
    await actor.updateEmbeddedDocuments("Item", updates, { render: false });
    return;
  }

  await Promise.all(entries.map(entry =>
    entry.item.update(
      { "system.equipado": valueSelector(entry) },
      { render: false }
    )
  ));
}

async function applyEquipmentTransition(
  actor,
  slotOverrides,
  operation
) {
  const priorState = getEquipmentState(actor);
  const nextState = getEquipmentState(actor, { slotOverrides });
  const actorChanges = {};
  const actorRollback = {};

  for (const [slot, nextReference] of Object.entries(slotOverrides)) {
    const priorReference = actor.system?.equipamiento?.[slot] ?? "";
    if (priorReference === nextReference) continue;
    actorChanges[`system.equipamiento.${slot}`] = nextReference;
    actorRollback[`system.equipamiento.${slot}`] = priorReference;
  }

  const flagUpdates = buildFlagUpdates(actor, nextState);
  let actorWasUpdated = false;

  try {
    if (Object.keys(actorChanges).length) {
      await actor.update(actorChanges, { render: false });
      actorWasUpdated = true;
    }

    await updateItemFlags(actor, flagUpdates, entry => entry.desired);
    return true;
  } catch (error) {
    const rollbackErrors = [];

    try {
      await updateItemFlags(actor, flagUpdates, entry => entry.original);
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError);
    }

    if (actorWasUpdated && Object.keys(actorRollback).length) {
      try {
        await actor.update(actorRollback, { render: false });
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }

    logger.error("EQUIPMENT", "equipment transition failed", {
      command: operation,
      actorUuid: actor?.uuid ?? actor?.id,
      status: rollbackErrors.length ? "recovery-required" : "rolled-back",
      reasonCode: rollbackErrors.length ? "EQUIPMENT_ROLLBACK_INCOMPLETE" : "EQUIPMENT_UPDATE_FAILED",
      slotOverrides,
      error: error.message,
      rollbackErrors: rollbackErrors.map(candidate => candidate.message)
    });

    notifyError(
      rollbackErrors.length
        ? `No se pudo ${operation} y la restauracion fue incompleta. Revisa la consola del GM.`
        : `No se pudo ${operation}. Se restauro el estado anterior.`
    );

    return false;
  }
}

export function getEquippedHandItems(actor) {
  return {
    manoIzq: getEquipmentItemForSlot(actor, "manoIzq"),
    manoDer: getEquipmentItemForSlot(actor, "manoDer")
  };
}

export function getEquippedShields(actor) {
  const hands = getEquippedHandItems(actor);

  return MTROL_HAND_SLOTS
    .map(slot => ({ slot, item: hands[slot] }))
    .filter(({ item }) =>
      String(item?.system?.tipoObjeto ?? "")
        .trim()
        .toLowerCase() === "escudo"
    );
}

export async function equiparObjeto(actor, item) {
  if (!actor || !item || !isMtrolObject(item)) return false;

  if (!canUserManageEquipment(actor)) {
    notifyWarning("No tienes permiso para modificar el equipamiento de este Actor.");
    return false;
  }

  const actorItem = getDocumentById(actor.items, item.id);
  if (actorItem !== item) {
    notifyWarning("El objeto no pertenece al actor seleccionado.");
    return false;
  }

  if (!item.system?.equipable) {
    notifyWarning("Este objeto no es equipable.");
    return false;
  }

  const slot = item.system?.slot;

  if (!slot) {
    notifyWarning("Este objeto no tiene un slot asignado.");
    return false;
  }

  if (!MTROL_BODY_SLOTS.includes(slot)) {
    notifyWarning("El slot asignado al objeto no es valido.");
    return false;
  }

  const existingReferences = getReferencedSlotsForItem(actor, item);
  const slotOverrides = Object.fromEntries(
    existingReferences
      .filter(referencedSlot => referencedSlot !== slot)
      .map(referencedSlot => [referencedSlot, ""])
  );

  slotOverrides[slot] = item.id;

  return applyEquipmentTransition(
    actor,
    slotOverrides,
    `equipar ${item.name ?? "el objeto"}`
  );
}

export async function desequiparObjeto(actor, item) {
  if (!actor || !item || !isMtrolObject(item)) return false;

  if (!canUserManageEquipment(actor)) {
    notifyWarning("No tienes permiso para modificar el equipamiento de este Actor.");
    return false;
  }

  const actorItem = getDocumentById(actor.items, item.id);
  if (actorItem !== item) return false;

  const referencedSlots = getReferencedSlotsForItem(actor, item);
  const slotOverrides = Object.fromEntries(
    referencedSlots.map(slot => [slot, ""])
  );

  return applyEquipmentTransition(
    actor,
    slotOverrides,
    `desequipar ${item.name ?? "el objeto"}`
  );
}
