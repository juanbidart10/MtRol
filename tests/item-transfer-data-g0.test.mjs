import test from "node:test";
import assert from "node:assert/strict";
import { createItemTransferSnapshot, reconstructItemTransferData } from "../scripts/items/item-transfer-data.js";

function fixture(type) {
  return {
    _id: "source", name: "Reliquia", type, img: "relic.webp", ownership: { default: 0 },
    folder: "folder", sort: 30, _stats: { compendiumSource: "Compendium.test.items.source" },
    system: { ...(type === "competencia" ? {} : { cantidad: 7 }), slot: "manoDer",
      equipado: true, equipadaCombate: true, custom: { nested: [1, "x"] } },
    flags: { mtrol: { orb: { level: 2 } }, module: { opaque: ["keep"] } },
    effects: [{ _id: "effect1", name: "Aura", origin: "Actor.a.Item.source",
      flags: { module: { effectId: "effect1" } }, changes: [{ key: "system.test", value: "2" }] }]
  };
}

for (const type of ["objeto", "item", "competencia"]) {
  test(`G0 round trip ${type}: snapshot completo y transformación explícita`, () => {
    const source = fixture(type);
    const original = structuredClone(source);
    const snapshot = createItemTransferSnapshot({ uuid: "Actor.a.Item.source", toObject: () => source });
    assert.deepEqual(snapshot.item, original);
    const result = reconstructItemTransferData(JSON.parse(JSON.stringify(snapshot)), {
      destinationItemUuid: "Actor.b.Item.destination"
    });
    const expected = structuredClone(original);
    for (const field of ["_id", "ownership", "folder", "sort", "_stats"]) delete expected[field];
    expected.system.equipado = false;
    expected.system.equipadaCombate = false;
    expected.effects[0].origin = "Actor.b.Item.destination";
    assert.deepEqual(result.data, expected);
    assert.deepEqual(source, original);
    assert.deepEqual(snapshot.item, original);
    assert.equal(result.data.system.slot, "manoDer");
    result.data.flags.module.opaque.push("changed");
    assert.deepEqual(snapshot.item.flags, original.flags);
  });
}

test("G0 cantidad parcial sólo transforma cantidad y preserva snapshot", () => {
  const snapshot = createItemTransferSnapshot(fixture("objeto"));
  const result = reconstructItemTransferData(snapshot, { quantity: 3 });
  assert.equal(result.data.system.cantidad, 3);
  assert.equal(snapshot.item.system.cantidad, 7);
  for (const quantity of [0, -1, 8, 1.5, NaN, Infinity, "2"]) {
    assert.throws(() => reconstructItemTransferData(snapshot, { quantity }));
  }
});

test("G0 tipo sin cantidad no recibe cantidad artificial", () => {
  const snapshot = createItemTransferSnapshot(fixture("competencia"));
  assert.equal(Object.hasOwn(reconstructItemTransferData(snapshot).data.system, "cantidad"), false);
  assert.throws(() => reconstructItemTransferData(snapshot, { quantity: 2 }));
});

test("G0 rechaza schema/tipo inválidos y origen propio sin contexto destino", () => {
  assert.throws(() => createItemTransferSnapshot({ type: "unsupported" }));
  assert.throws(() => reconstructItemTransferData({ schemaVersion: 99 }));
  const snapshot = createItemTransferSnapshot({ uuid: "Actor.a.Item.source", toObject: () => fixture("objeto") });
  assert.throws(() => reconstructItemTransferData(snapshot), /destinationItemUuid/);
});

test("G0 no toca referencias externas ni IDs internos de efectos", () => {
  const source = fixture("objeto");
  source.effects[0].origin = "Actor.external.Item.other";
  const result = reconstructItemTransferData(createItemTransferSnapshot(source));
  assert.deepEqual(result.data.effects, source.effects);
  assert.deepEqual(result.data.flags, source.flags);
});

test("G0 metadata de efectos permanece en snapshot y se declara su omisión", () => {
  const source = fixture("objeto");
  source.effects[0]._stats = { modifiedTime: 123, compendiumSource: "Compendium.test.effects.e" };
  const snapshot = createItemTransferSnapshot(source);
  const result = reconstructItemTransferData(snapshot);
  assert.deepEqual(snapshot.item.effects[0]._stats, source.effects[0]._stats);
  assert.equal(Object.hasOwn(result.data.effects[0], "_stats"), false);
  assert.ok(result.changes.some(change => change.path === "effects.0._stats" && change.operation === "omit"));
  assert.ok(result.changes.some(change => change.path === "ownership"));
  assert.equal(result.data.effects[0]._id, "effect1");
  assert.equal(result.changes.some(change => change.path === "system.slot"), false);
});
