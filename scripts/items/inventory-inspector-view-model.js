import {
  MTROL_BODY_SLOTS,
  MTROL_BODY_SLOT_LABELS
} from "../constants/body-slots.js";

import {
  getDocumentById,
  getItemQuantity,
  getItemUnitWeight,
  getItemWeightContribution,
  getReferencedSlotsForItem,
  isItemActuallyEquipped
} from "./item-invariants.js";

export const MTROL_INVENTORY_INSPECTOR_TYPE_LABELS = Object.freeze({
  arma: "Arma",
  armadura: "Armadura",
  escudo: "Escudo",
  consumible: "Consumible",
  material: "Material",
  general: "Objeto",
  llave: "Objeto",
  moneda: "Objeto"
});

const MTROL_FALLBACK_ITEM_IMG = "icons/svg/item-bag.svg";

function hasDisplayValue(value) {
  return value !== undefined &&
    value !== null &&
    (typeof value !== "string" || value.trim() !== "");
}

function getSafeItemImage(src) {
  if (typeof src !== "string") return MTROL_FALLBACK_ITEM_IMG;

  const value = src.trim();
  if (!value || ["null", "undefined", "[object object]"].includes(value.toLowerCase())) {
    return MTROL_FALLBACK_ITEM_IMG;
  }

  return value;
}

function addStat(stats, label, value) {
  if (!hasDisplayValue(value)) return;
  stats.push({ label, value });
}

function buildTypeStats(item, tipoObjeto) {
  const stats = [];

  if (tipoObjeto === "arma") {
    addStat(stats, "Daño", item.system?.danio);
  }

  if (tipoObjeto === "armadura" || tipoObjeto === "escudo") {
    addStat(stats, "Defensa", item.system?.defensa);
    addStat(stats, "Defensa base", item.system?.defensaBase);
  }

  if (tipoObjeto === "material") {
    addStat(stats, "Material", item.system?.material);
    addStat(stats, "Valor", item.system?.valor);
  }

  return stats;
}

export function resolveInventoryInspectorItem(actor, selectedItemId) {
  const itemId = String(selectedItemId ?? "").trim();
  if (!itemId) return null;
  return getDocumentById(actor?.items, itemId);
}

export function buildInventoryInspectorViewModel(actor, item) {
  if (!item) {
    return {
      selected: false,
      itemId: null,
      item: null,
      stats: [],
      typeStats: []
    };
  }

  const tipoObjeto = String(item.system?.tipoObjeto ?? "")
    .trim()
    .toLowerCase();
  const referencedSlots = getReferencedSlotsForItem(actor, item);
  const equipped = isItemActuallyEquipped(actor, item);
  const effectiveSlot = referencedSlots[0] ?? "";
  const declaredSlot = String(item.system?.slot ?? "").trim();
  const hasValidDeclaredSlot = MTROL_BODY_SLOTS.includes(declaredSlot);
  const stats = [
    { label: "Cantidad", value: getItemQuantity(item) },
    { label: "Peso unitario", value: getItemUnitWeight(item) },
    { label: "Peso total", value: getItemWeightContribution(item) }
  ];
  return {
    selected: true,
    itemId: item.id,
    item,
    name: String(item.name ?? ""),
    img: getSafeItemImage(item.img),
    tipoObjeto,
    tipoLabel: MTROL_INVENTORY_INSPECTOR_TYPE_LABELS[tipoObjeto] ?? "Objeto",
    description: String(item.system?.descripcion ?? ""),
    quantity: getItemQuantity(item),
    weight: getItemUnitWeight(item),
    totalWeight: getItemWeightContribution(item),
    equipped,
    declaredSlot,
    declaredSlotLabel: hasValidDeclaredSlot
      ? MTROL_BODY_SLOT_LABELS[declaredSlot]
      : "",
    effectiveSlot,
    effectiveSlotLabel: MTROL_BODY_SLOT_LABELS[effectiveSlot] ?? "",
    stats,
    typeStats: buildTypeStats(item, tipoObjeto)
  };
}
