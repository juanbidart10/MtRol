import test from "node:test";
import assert from "node:assert/strict";

globalThis.ui = {
  notifications: {
    warn() {},
    error() {}
  }
};

const equipment =
  await import("../scripts/items/equipment-engine.js");
const invariants =
  await import("../scripts/items/item-invariants.js");

function createItem(id, {
  equipado = false,
  slot = "pies",
  equipable = true
} = {}) {
  return {
    id,
    uuid: `Actor.test.Item.${id}`,
    name: id,
    type: "objeto",
    system: { equipado, slot, equipable, peso: 1, cantidad: 1 },
    updateCalls: 0,
    async update(changes) {
      this.updateCalls += 1;
      if (Object.hasOwn(changes, "system.equipado")) {
        this.system.equipado = changes["system.equipado"];
      }
      return this;
    }
  };
}

function createActor(items, equipamiento = {}, { failFlags = false } = {}) {
  const collection = [...items];
  collection.get = id => collection.find(item => item.id === id) ?? null;

  return {
    id: "test",
    uuid: "Actor.test",
    type: "personaje",
    system: { equipamiento: { ...equipamiento } },
    items: collection,
    actorUpdateCalls: [],
    embeddedUpdateCalls: [],
    createCalls: 0,
    deleteCalls: 0,
    async update(changes) {
      this.actorUpdateCalls.push({ ...changes });
      for (const [path, value] of Object.entries(changes)) {
        const slot = path.replace("system.equipamiento.", "");
        this.system.equipamiento[slot] = value;
      }
      return this;
    },
    async updateEmbeddedDocuments(_type, updates) {
      this.embeddedUpdateCalls.push(updates.map(update => ({ ...update })));
      if (failFlags) throw new Error("fallo simulado");
      for (const update of updates) {
        const document = collection.get(update._id);
        document.system.equipado = update["system.equipado"];
      }
      return updates;
    },
    async createEmbeddedDocuments() {
      this.createCalls += 1;
      throw new Error("No debe crear documentos.");
    },
    async deleteEmbeddedDocuments() {
      this.deleteCalls += 1;
      throw new Error("No debe eliminar documentos.");
    }
  };
}

test("reemplazar equipamiento devuelve el anterior al inventario sin crear documentos", async () => {
  const bootsA = createItem("boots-a", { equipado: true });
  const bootsB = createItem("boots-b", { equipado: false });
  const historicalOrphan = createItem("historical-orphan", {
    equipado: true,
    slot: "cabeza"
  });
  const actor = createActor(
    [bootsA, bootsB, historicalOrphan],
    { pies: "boots-a" }
  );

  assert.equal(await equipment.equiparObjeto(actor, bootsB), true);

  assert.equal(actor.system.equipamiento.pies, "boots-b");
  assert.equal(bootsA.system.equipado, false);
  assert.equal(bootsB.system.equipado, true);
  assert.equal(historicalOrphan.system.equipado, true);
  assert.deepEqual(
    invariants.getInventoryItems(actor).map(item => item.id),
    ["boots-a", "historical-orphan"]
  );
  assert.equal(actor.createCalls, 0);
  assert.equal(actor.deleteCalls, 0);
});

test("desequipar limpia todas las referencias del objeto y lo hace visible", async () => {
  const item = createItem("multi", { equipado: true, slot: "pies" });
  const actor = createActor(
    [item],
    { pies: "multi", extra: "multi" }
  );

  assert.equal(await equipment.desequiparObjeto(actor, item), true);
  assert.equal(actor.system.equipamiento.pies, "");
  assert.equal(actor.system.equipamiento.extra, "");
  assert.equal(item.system.equipado, false);
  assert.deepEqual(invariants.getInventoryItems(actor).map(entry => entry.id), ["multi"]);
});

test("equipar y desequipar repetidamente no agrega ni elimina documentos", async () => {
  const item = createItem("repeat", { equipado: false });
  const actor = createActor([item], { pies: "" });
  const initialCount = actor.items.length;

  for (let index = 0; index < 3; index += 1) {
    assert.equal(await equipment.equiparObjeto(actor, item), true);
    assert.equal(await equipment.desequiparObjeto(actor, item), true);
  }

  assert.equal(actor.items.length, initialCount);
  assert.equal(actor.createCalls, 0);
  assert.equal(actor.deleteCalls, 0);
});

test("un fallo de sincronizacion intenta rollback y no queda silenciado", async () => {
  const previous = createItem("previous", { equipado: true });
  const next = createItem("next", { equipado: false });
  const actor = createActor(
    [previous, next],
    { pies: "previous" },
    { failFlags: true }
  );
  const originalError = console.error;
  let logged = false;
  console.error = () => { logged = true; };

  try {
    assert.equal(await equipment.equiparObjeto(actor, next), false);
  } finally {
    console.error = originalError;
  }

  assert.equal(actor.system.equipamiento.pies, "previous");
  assert.equal(logged, true);
  assert.equal(actor.actorUpdateCalls.length, 2);
});
