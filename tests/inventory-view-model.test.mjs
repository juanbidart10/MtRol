import test from "node:test";
import assert from "node:assert/strict";

import {
  MTROL_BODY_SLOTS
} from "../scripts/constants/body-slots.js";

import {
  buildInventoryViewModel,
  MTROL_INVENTORY_CATEGORY_KEYS
} from "../scripts/items/inventory-view-model.js";

function createCollection(items = []) {
  const collection = [...items];
  collection.get = id => collection.find(item => item.id === id) ?? null;
  return collection;
}

function createItem(id, {
  name = id,
  tipoObjeto = "general",
  equipado = false,
  slot = "",
  peso = 0,
  cantidad = 1
} = {}) {
  return {
    id,
    uuid: `Actor.presentation.Item.${id}`,
    name,
    type: "objeto",
    system: {
      tipoObjeto,
      equipado,
      slot,
      peso,
      cantidad
    }
  };
}

function createActor({
  items = [],
  equipamiento = {},
  fuerza = 5
} = {}) {
  return {
    id: "presentation",
    uuid: "Actor.presentation",
    type: "personaje",
    system: {
      atributos: { fuerza },
      equipamiento: Object.fromEntries(
        MTROL_BODY_SLOTS.map(slot => [slot, equipamiento[slot] ?? ""])
      )
    },
    items: createCollection(items)
  };
}

function categoryIds(viewModel, category) {
  return viewModel.categories[category].map(item => item.id);
}

test("expone los diez slots vacios y las cinco categorias para un Actor sin Items", () => {
  const viewModel = buildInventoryViewModel(createActor());

  assert.deepEqual(Object.keys(viewModel.equipment), MTROL_BODY_SLOTS);
  assert.deepEqual(Object.values(viewModel.equipment), MTROL_BODY_SLOTS.map(() => null));
  assert.deepEqual(Object.keys(viewModel.categories), MTROL_INVENTORY_CATEGORY_KEYS);
  assert.deepEqual(
    Object.values(viewModel.categories).map(items => items.length),
    MTROL_INVENTORY_CATEGORY_KEYS.map(() => 0)
  );
  assert.equal(viewModel.slots.length, 10);
  assert.equal(viewModel.slots.every(slot => slot.item === null), true);
  assert.deepEqual(viewModel.categoryDefinitions.map(category => category.label), [
    "Armas",
    "Armaduras",
    "Consumibles",
    "Materiales",
    "Objetos"
  ]);
});

test("expone labels visuales sin alterar los IDs internos de slots", () => {
  const viewModel = buildInventoryViewModel(createActor());
  const labels = Object.fromEntries(viewModel.slots.map(slot => [slot.id, slot.label]));

  assert.equal(labels.pies, "Botas");
  assert.equal(labels.manoDer, "Arma 1");
  assert.equal(labels.manoIzq, "Arma 2");
  assert.deepEqual(viewModel.slots.map(slot => slot.id), MTROL_BODY_SLOTS);
});

test("precalcula cantidad y pesos por Item sin mutar las referencias categorizadas", () => {
  const item = createItem("metric-item", {
    tipoObjeto: "material",
    cantidad: 3,
    peso: 2.5
  });
  const viewModel = buildInventoryViewModel(createActor({ items: [item] }));

  assert.equal(viewModel.categories.materiales[0], item);
  assert.deepEqual(viewModel.itemMetrics[item.id], {
    quantity: 3,
    unitWeight: 2.5,
    totalWeight: 7.5
  });
});

test("resuelve correctamente un Item referenciado en cada slot autoritativo", () => {
  const items = MTROL_BODY_SLOTS.map(slot => createItem(`item-${slot}`, {
    slot,
    equipado: false
  }));
  const equipamiento = Object.fromEntries(
    MTROL_BODY_SLOTS.map(slot => [slot, `item-${slot}`])
  );
  const viewModel = buildInventoryViewModel(createActor({ items, equipamiento }));

  for (const slot of MTROL_BODY_SLOTS) {
    assert.equal(viewModel.equipment[slot]?.id, `item-${slot}`);
    assert.equal(viewModel.slots.find(entry => entry.id === slot)?.item?.id, `item-${slot}`);
  }
});

test("una referencia rota queda vacia y documentada sin romper el ViewModel", () => {
  const viewModel = buildInventoryViewModel(createActor({
    equipamiento: { cabeza: "missing-item" }
  }));
  const head = viewModel.slots.find(slot => slot.id === "cabeza");

  assert.equal(viewModel.equipment.cabeza, null);
  assert.equal(head.reference, "missing-item");
  assert.equal(head.broken, true);
});

test("clasifica todos los tipos conocidos y envia vacios o desconocidos a objetos", () => {
  const cases = [
    ["arma", "armas"],
    ["armadura", "armaduras"],
    ["escudo", "armaduras"],
    ["consumible", "consumibles"],
    ["material", "materiales"],
    ["general", "objetos"],
    ["llave", "objetos"],
    ["moneda", "objetos"],
    ["", "objetos"],
    ["tipo-futuro", "objetos"]
  ];
  const items = cases.map(([tipoObjeto], index) => createItem(`item-${index}`, { tipoObjeto }));
  const viewModel = buildInventoryViewModel(createActor({ items }));

  cases.forEach(([, category], index) => {
    assert.equal(categoryIds(viewModel, category).includes(`item-${index}`), true);
  });
});

test("usa las referencias del Actor y no Item.system.equipado como fuente de verdad", () => {
  const legacyOrphan = createItem("legacy-orphan", {
    equipado: true,
    slot: "cabeza"
  });
  const referenced = createItem("referenced", {
    equipado: false,
    slot: "cabeza"
  });
  const viewModel = buildInventoryViewModel(createActor({
    items: [legacyOrphan, referenced],
    equipamiento: { cabeza: referenced.id }
  }));

  assert.equal(viewModel.equipment.cabeza, referenced);
  assert.deepEqual(categoryIds(viewModel, "objetos"), [legacyOrphan.id]);
});

test("un Item equipado no se duplica en ninguna categoria", () => {
  const helmet = createItem("helmet", {
    tipoObjeto: "armadura",
    slot: "cabeza"
  });
  const viewModel = buildInventoryViewModel(createActor({
    items: [helmet],
    equipamiento: { cabeza: helmet.id }
  }));
  const categorizedItems = Object.values(viewModel.categories).flat();

  assert.equal(viewModel.equipment.cabeza, helmet);
  assert.equal(categorizedItems.includes(helmet), false);
});

test("ordena alfabeticamente y conserva estabilidad para nombres equivalentes", () => {
  const items = [
    createItem("zafiro", { name: "Zafiro" }),
    createItem("arco-first", { name: "Arco" }),
    createItem("daga", { name: "Daga" }),
    createItem("arco-second", { name: "arco" })
  ];
  const viewModel = buildInventoryViewModel(createActor({ items }));

  assert.deepEqual(categoryIds(viewModel, "objetos"), [
    "arco-first",
    "arco-second",
    "daga",
    "zafiro"
  ]);
});

test("deriva estados de presentacion en los limites de carga requeridos", () => {
  const cases = [
    { peso: 26.99, state: "normal" },
    { peso: 27, state: "heavy" },
    { peso: 30, state: "heavy" },
    { peso: 30.01, state: "overloaded" }
  ];

  for (const { peso, state } of cases) {
    const viewModel = buildInventoryViewModel(createActor({
      fuerza: 3,
      items: [createItem(`weight-${peso}`, { peso })]
    }));

    assert.equal(viewModel.weight.current, peso);
    assert.equal(viewModel.weight.capacity, 30);
    assert.equal(viewModel.weight.remaining, Math.max(0, 30 - peso));
    assert.equal(viewModel.weight.ratio, peso / 30);
    assert.equal(viewModel.weight.state, state);
  }
});

test("utiliza la capacidad real del Actor en lugar de un maximo fijo", () => {
  const item = createItem("same-weight", { peso: 27 });
  const capacityThirty = buildInventoryViewModel(createActor({
    fuerza: 3,
    items: [item]
  }));
  const capacityFifty = buildInventoryViewModel(createActor({
    fuerza: 5,
    items: [item]
  }));

  assert.deepEqual(capacityThirty.weight, {
    current: 27,
    capacity: 30,
    remaining: 3,
    ratio: 0.9,
    state: "heavy"
  });
  assert.deepEqual(capacityFifty.weight, {
    current: 27,
    capacity: 50,
    remaining: 23,
    ratio: 0.54,
    state: "normal"
  });
});
