import test from "node:test";
import assert from "node:assert/strict";

globalThis.game = {
  user: { id: "gm", isGM: true },
  users: new Map([["gm", { id: "gm", isGM: true }]])
};

globalThis.foundry = {
  utils: {
    duplicate(value) {
      return structuredClone(value);
    },
    escapeHTML(value) {
      return String(value);
    }
  }
};

globalThis.ChatMessage = {
  getSpeaker() { return {}; },
  async create() { return {}; }
};

globalThis.ui = {
  notifications: {
    warn() {},
    error() {}
  }
};

const { ejecutarComercioMtrol } =
  await import("../scripts/items/trade-engine.js");

function createCollection(items) {
  const collection = [...items];
  collection.get = id => collection.find(item => item.id === id) ?? null;
  return collection;
}

function createItem(id, system) {
  return {
    id,
    name: id,
    type: "objeto",
    img: "icons/item.webp",
    system: { ...system },
    parent: null,
    toObject() {
      return {
        _id: this.id,
        name: this.name,
        type: this.type,
        img: this.img,
        system: structuredClone(this.system)
      };
    },
    async update(changes) {
      for (const [path, value] of Object.entries(changes)) {
        if (path === "system.cantidad") this.system.cantidad = value;
        if (path === "system.equipado") this.system.equipado = value;
      }
      return this;
    },
    async delete() {
      const index = this.parent.items.indexOf(this);
      if (index >= 0) this.parent.items.splice(index, 1);
    }
  };
}

function createActor(id, items, equipamiento = {}) {
  const actor = {
    id,
    uuid: `Actor.${id}`,
    name: id,
    type: "personaje",
    system: { equipamiento: { ...equipamiento } },
    items: createCollection(items),
    testUserPermission() { return true; },
    async update(changes) {
      for (const [path, value] of Object.entries(changes)) {
        if (path === "system.equipamiento") {
          this.system.equipamiento = structuredClone(value);
        } else {
          const slot = path.replace("system.equipamiento.", "");
          this.system.equipamiento[slot] = value;
        }
      }
      return this;
    },
    async updateEmbeddedDocuments(_type, updates) {
      for (const update of updates) {
        const item = this.items.get(update._id);
        item.system.equipado = update["system.equipado"];
      }
      return updates;
    },
    async createEmbeddedDocuments(_type, data) {
      const created = data.map((entry, index) => {
        const item = createItem(`created-${index}`, entry.system);
        item.name = entry.name;
        item.parent = this;
        this.items.push(item);
        return item;
      });
      return created;
    },
    async deleteEmbeddedDocuments(_type, ids) {
      for (const itemId of ids) {
        const item = this.items.get(itemId);
        if (item) await item.delete();
      }
    }
  };

  for (const item of actor.items) item.parent = actor;
  return actor;
}

test("comerciar una parte de un item equipado limpia su referencia antes de transferir", async () => {
  const boots = createItem("boots", {
    cantidad: 2,
    peso: 1,
    equipado: true,
    equipable: true,
    slot: "pies"
  });
  const source = createActor("source", [boots], { pies: "boots" });
  const target = createActor("target", [], { pies: "" });

  const result = await ejecutarComercioMtrol({
    sourceActor: source,
    targetActor: target,
    sourceOffer: [{ itemId: "boots", quantity: 1 }],
    requestingUserId: "gm"
  });

  assert.equal(result, true);
  assert.equal(source.system.equipamiento.pies, "");
  assert.equal(boots.system.equipado, false);
  assert.equal(boots.system.cantidad, 1);
  assert.equal(target.items.length, 1);
  assert.equal(target.items[0].system.equipado, false);
});