import test from "node:test";
import assert from "node:assert/strict";

const invariants =
  await import("../scripts/items/item-invariants.js");

function item(id, system = {}, { sourceSystem = system, includeSource = true } = {}) {
  const document = {
    id,
    uuid: `Actor.test.Item.${id}`,
    name: id,
    type: "objeto",
    system: { ...system }
  };

  if (includeSource) document._source = { system: { ...sourceSystem } };
  return document;
}

function actor(items, equipamiento = {}) {
  const collection = [...items];
  collection.get = id => collection.find(entry => entry.id === id) ?? null;

  return {
    id: "test",
    uuid: "Actor.test",
    type: "personaje",
    system: { equipamiento: { ...equipamiento } },
    items: collection
  };
}

test("la regla central respeta peso cero y solo usa slots cuando peso esta ausente", () => {
  const zero = item("zero", { peso: 0, slots: 1, cantidad: 7 });
  const legacy = item(
    "legacy",
    { peso: 0, slots: 2, cantidad: 3 },
    { sourceSystem: { slots: 2, cantidad: 3 } }
  );
  delete legacy.system.peso;

  assert.equal(invariants.getItemUnitWeight(zero), 0);
  assert.equal(invariants.getItemWeightContribution(zero), 0);
  assert.equal(invariants.analyzeItemWeight(zero).modernZero, true);

  assert.equal(invariants.getItemUnitWeight(legacy), 2);
  assert.equal(invariants.getItemWeightContribution(legacy), 6);
  assert.equal(invariants.analyzeItemWeight(legacy).migratableLegacy, true);
});

test("normaliza cadenas numericas y limita valores invalidos sin caer a slots", () => {
  const numericString = item("string", {
    peso: "2",
    slots: 9,
    cantidad: "3"
  });
  const invalidWeight = item("invalid", {
    peso: "no",
    slots: 9,
    cantidad: 1
  });

  assert.equal(invariants.getItemWeightContribution(numericString), 6);
  assert.equal(invariants.analyzeItemWeight(numericString).normalized, 2);
  assert.equal(invariants.analyzeItemQuantity(numericString).normalized, 3);

  assert.equal(invariants.getItemWeightContribution(invalidWeight), 0);
  assert.equal(invariants.analyzeItemWeight(invalidWeight).invalid, true);
  assert.equal(invariants.analyzeItemWeight(invalidWeight).calculationSource, "invalid-system.peso");
});

test("un material con peso moderno cero aporta cero", () => {
  const material = item("material", {
    peso: 0,
    slots: 4,
    cantidad: 5,
    material: "papiro"
  });

  assert.equal(invariants.getItemUnitWeight(material), 0);
  assert.equal(invariants.getItemWeightContribution(material), 0);
});

test("clasifica cantidades ausentes, cero, negativas, nulas, vacias e invalidas", () => {
  const cases = [
    [item("absent", { peso: 2 }, { sourceSystem: { peso: 2 } }), "quantity-absent", 1],
    [item("zero", { peso: 2, cantidad: 0 }), "quantity-zero", 0],
    [item("negative", { peso: 2, cantidad: -1 }), "quantity-negative", 0],
    [item("null", { peso: 2, cantidad: null }), "quantity-invalid", 0],
    [item("empty", { peso: 2, cantidad: "" }), "quantity-invalid", 0],
    [item("invalid", { peso: 2, cantidad: "x" }), "quantity-invalid", 0]
  ];

  for (const [document, classification, effectiveValue] of cases) {
    const analysis = invariants.analyzeItemQuantity(document);
    assert.equal(analysis.classification, classification);
    assert.equal(analysis.effectiveValue, effectiveValue);
  }
});

test("las referencias de slots son la fuente de verdad para inventario y equipamiento", () => {
  const orphan = item("orphan", {
    peso: 1,
    cantidad: 1,
    equipado: true,
    slot: "pies"
  });
  const referenced = item("referenced", {
    peso: 1,
    cantidad: 1,
    equipado: false,
    slot: "manoDer"
  });
  const normal = item("normal", {
    peso: 1,
    cantidad: 1,
    equipado: false,
    slot: ""
  });
  const testActor = actor(
    [orphan, referenced, normal],
    { manoDer: "referenced", cabeza: "missing" }
  );

  assert.deepEqual(
    invariants.getInventoryItems(testActor).map(entry => entry.id),
    ["orphan", "normal"]
  );
  assert.deepEqual(
    invariants.getActuallyEquippedItems(testActor).map(entry => entry.id),
    ["referenced"]
  );
  assert.equal(invariants.isItemActuallyEquipped(testActor, orphan), false);
  assert.equal(invariants.isItemActuallyEquipped(testActor, referenced), true);
  assert.equal(
    invariants.analyzeItemEquipment(testActor, orphan).classification,
    "equipped-but-unreferenced"
  );
  assert.equal(
    invariants.analyzeItemEquipment(testActor, referenced).classification,
    "referenced-but-unequipped"
  );
  assert.equal(
    invariants.getEquipmentState(testActor).entries.find(entry => entry.slot === "cabeza").broken,
    true
  );
});

test("detecta referencias multiples e incompatibles sin modificar documentos", () => {
  const conflicted = item("conflicted", {
    peso: 1,
    cantidad: 1,
    equipado: true,
    slot: "pies"
  });
  const testActor = actor(
    [conflicted],
    { cabeza: "conflicted", cuello: "conflicted" }
  );

  const analysis = invariants.analyzeItemEquipment(testActor, conflicted);

  assert.equal(analysis.classification, "slot-conflict");
  assert.deepEqual(analysis.referencedSlots, ["cabeza", "cuello"]);
  assert.equal(analysis.conflicts.includes("item-referenced-by-multiple-slots"), true);
  assert.equal(analysis.conflicts.includes("declared-slot-does-not-match-reference"), true);
});
