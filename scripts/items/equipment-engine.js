import {
  MTROL_BODY_SLOTS
} from "../constants/body-slots.js";

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