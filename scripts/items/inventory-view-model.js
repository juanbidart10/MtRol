import {
  MTROL_BODY_SLOTS,
  MTROL_BODY_SLOT_LABELS
} from "../constants/body-slots.js";

import {
  getEquipmentState,
  getInventoryItems,
  getItemQuantity,
  getItemUnitWeight,
  getItemWeightContribution
} from "./item-invariants.js";

import {
  calcularCargaActor
} from "../core/mtrol-carry-weight.js";

export const MTROL_INVENTORY_CATEGORY_KEYS = Object.freeze([
  "armas",
  "armaduras",
  "consumibles",
  "materiales",
  "objetos"
]);

export const MTROL_INVENTORY_CATEGORY_DEFINITIONS = Object.freeze([
  Object.freeze({ id: "armas", label: "Armas", icon: "fa-khanda" }),
  Object.freeze({ id: "armaduras", label: "Armaduras", icon: "fa-shield-alt" }),
  Object.freeze({ id: "consumibles", label: "Consumibles", icon: "fa-flask" }),
  Object.freeze({ id: "materiales", label: "Materiales", icon: "fa-gem" }),
  Object.freeze({ id: "objetos", label: "Objetos", icon: "fa-shopping-bag" })
]);

export const MTROL_INVENTORY_FILTER_DEFINITIONS = Object.freeze([
  Object.freeze({ id: "all", label: "Todos" }),
  ...MTROL_INVENTORY_CATEGORY_DEFINITIONS
]);

const MTROL_EQUIPMENT_PRESENTATION_LABELS = Object.freeze({
  ...MTROL_BODY_SLOT_LABELS,
  pies: "Botas",
  manoDer: "Arma 1",
  manoIzq: "Arma 2"
});

const MTROL_EQUIPMENT_SLOT_ICONS = Object.freeze({
  cabeza: "fa-hat-wizard",
  cuello: "fa-gem",
  hombros: "fa-shield-alt",
  brazos: "fa-fist-raised",
  pecho: "fa-shield-alt",
  manoDer: "fa-khanda",
  manoIzq: "fa-khanda",
  piernas: "fa-running",
  pies: "fa-shoe-prints",
  extra: "fa-plus-circle"
});

const MTROL_ITEM_TYPE_LABELS = Object.freeze({
  arma: "Arma",
  armadura: "Armadura",
  escudo: "Escudo",
  consumible: "Consumible",
  material: "Material",
  general: "Objeto",
  llave: "Objeto",
  moneda: "Objeto"
});

export const MTROL_EQUIPMENT_LEFT_SLOTS = Object.freeze([
  "cabeza",
  "hombros",
  "brazos",
  "manoDer",
  "piernas"
]);

export const MTROL_EQUIPMENT_RIGHT_SLOTS = Object.freeze([
  "cuello",
  "extra",
  "pecho",
  "manoIzq",
  "pies"
]);

export const MTROL_ITEM_PRESENTATION_CATEGORIES = Object.freeze({
  arma: "armas",
  armadura: "armaduras",
  escudo: "armaduras",
  consumible: "consumibles",
  material: "materiales",
  general: "objetos",
  llave: "objetos",
  moneda: "objetos"
});

const ITEM_NAME_COLLATOR = new Intl.Collator("es", {
  sensitivity: "base",
  numeric: true
});

function getPresentationCategory(item) {
  const objectType = String(item?.system?.tipoObjeto ?? "")
    .trim()
    .toLowerCase();

  return MTROL_ITEM_PRESENTATION_CATEGORIES[objectType] ?? "objetos";
}

function sortItemsByName(items) {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const comparison = ITEM_NAME_COLLATOR.compare(
        String(left.item?.name ?? ""),
        String(right.item?.name ?? "")
      );

      return comparison || left.index - right.index;
    })
    .map(entry => entry.item);
}

function buildEquipmentTooltip(item, slotLabel) {
  if (!item) return slotLabel;

  const tipoObjeto = String(item.system?.tipoObjeto ?? "").trim().toLowerCase();
  const lines = [
    String(item.name ?? ""),
    `Tipo: ${MTROL_ITEM_TYPE_LABELS[tipoObjeto] ?? "Objeto"}`,
    `Peso: ${getItemUnitWeight(item)}`
  ];

  if (tipoObjeto === "arma" && item.system?.danio !== undefined) {
    lines.push(`Daño: ${item.system.danio}`);
  }

  if (["armadura", "escudo"].includes(tipoObjeto)) {
    const defense = item.system?.defensa ?? item.system?.defensaBase;
    if (defense !== undefined && defense !== null && defense !== "") {
      lines.push(`Defensa: ${defense}`);
    }
  }

  return lines.join("\n");
}

function buildEquipmentPresentation(actor) {
  const state = getEquipmentState(actor);
  const equipment = {};
  const slots = [];

  for (const slotId of MTROL_BODY_SLOTS) {
    const entry = state.entries.find(candidate => candidate.slot === slotId);
    const item = entry?.item ?? null;

    equipment[slotId] = item;
    slots.push({
      id: slotId,
      label: MTROL_EQUIPMENT_PRESENTATION_LABELS[slotId] ?? slotId,
      icon: MTROL_EQUIPMENT_SLOT_ICONS[slotId] ?? "fa-box-open",
      item,
      reference: entry?.reference ?? "",
      broken: entry?.broken === true,
      tooltip: buildEquipmentTooltip(
        item,
        MTROL_EQUIPMENT_PRESENTATION_LABELS[slotId] ?? slotId
      )
    });
  }

  return { equipment, slots };
}

function buildInventoryCategories(actor) {
  const categories = Object.fromEntries(
    MTROL_INVENTORY_CATEGORY_KEYS.map(category => [category, []])
  );

  for (const item of getInventoryItems(actor)) {
    categories[getPresentationCategory(item)].push(item);
  }

  for (const category of MTROL_INVENTORY_CATEGORY_KEYS) {
    categories[category] = sortItemsByName(categories[category]);
  }

  return categories;
}

function buildWeightPresentation(actor) {
  const load = calcularCargaActor(actor);
  const current = load.pesoActual;
  const capacity = load.pesoMaximo;
  const remaining = Math.max(0, capacity - current);
  const ratio = capacity > 0 ? current / capacity : 0;
  let state = "normal";

  if (current > capacity) {
    state = "overloaded";
  } else if (current >= capacity * 0.9) {
    state = "heavy";
  }

  return {
    current,
    capacity,
    remaining,
    ratio,
    state
  };
}

export function buildCarrySegments(ratio) {
  const numericRatio = Number.isFinite(Number(ratio)) ? Number(ratio) : 0;
  const filled = Math.max(0, Math.min(10, Math.ceil(numericRatio * 10)));

  return {
    filled,
    segments: Array.from({ length: 10 }, (_value, index) => ({
      filled: index < filled
    }))
  };
}

function buildItemMetrics(categories) {
  const metrics = {};

  for (const item of Object.values(categories).flat()) {
    metrics[item.id] = {
      quantity: getItemQuantity(item),
      unitWeight: getItemUnitWeight(item),
      totalWeight: getItemWeightContribution(item)
    };
  }

  return metrics;
}

export function buildInventoryViewModel(actor) {
  const equipmentPresentation = buildEquipmentPresentation(actor);
  const categories = buildInventoryCategories(actor);
  const items = sortItemsByName(Object.values(categories).flat());
  const slotsById = Object.fromEntries(
    equipmentPresentation.slots.map(slot => [slot.id, slot])
  );

  return {
    equipment: equipmentPresentation.equipment,
    slots: equipmentPresentation.slots,
    slotsLeft: MTROL_EQUIPMENT_LEFT_SLOTS.map(slot => slotsById[slot]),
    slotsRight: MTROL_EQUIPMENT_RIGHT_SLOTS.map(slot => slotsById[slot]),
    items,
    categories,
    categoryDefinitions: MTROL_INVENTORY_CATEGORY_DEFINITIONS,
    filterDefinitions: MTROL_INVENTORY_FILTER_DEFINITIONS,
    itemMetrics: buildItemMetrics(categories),
    weight: buildWeightPresentation(actor)
  };
}
