import test from "node:test";
import assert from "node:assert/strict";

class MockActorSheet {
  constructor(actor) {
    this.actor = actor;
    this.options = {};
    this.position = {};
    this.renderCount = 0;
  }

  static get defaultOptions() { return {}; }
  render() { this.renderCount += 1; }
}

globalThis.foundry = {
  appv1: { sheets: { ActorSheet: MockActorSheet } },
  utils: {
    deepClone: value => structuredClone(value),
    duplicate: value => structuredClone(value),
    escapeHTML: value => String(value ?? ""),
    mergeObject: (target, source) => Object.assign(target, source),
    randomID: () => "dnd-hotfix"
  }
};

const warnings = [];
const infos = [];

globalThis.game = {
  user: { id: "gm", isGM: true, targets: new Set() },
  users: [],
  system: { id: "mtrol", version: "1.2.5" },
  socket: { emit() {}, on() {} }
};

globalThis.ui = {
  notifications: {
    warn(message) { warnings.push(message); },
    info(message) { infos.push(message); },
    error(message) { warnings.push(message); }
  }
};

globalThis.Math.clamp ??= (value, min, max) => Math.min(max, Math.max(min, value));

const externalItem = {
  id: "external",
  uuid: "Compendium.mtrol.items.Item.external",
  name: "Objeto externo",
  type: "objeto",
  system: { tipoObjeto: "general", cantidad: 1, peso: 2 },
  toObject() {
    return {
      _id: this.id,
      name: this.name,
      type: this.type,
      system: structuredClone(this.system)
    };
  }
};

globalThis.Item = {
  implementation: {
    async fromDropData() { return externalItem; }
  }
};

const {
  PersonajeSheet,
  buildInternalItemDragData,
  classifyItemDropData
} = await import("../scripts/sheets/actors/personaje-sheet.js");

const { calcularCargaActor } = await import("../scripts/core/mtrol-carry-weight.js");

const SLOT_IDS = [
  "cabeza", "cuello", "hombros", "brazos", "pecho",
  "piernas", "pies", "manoIzq", "manoDer", "extra"
];

function setUser(id, isGM = false) {
  game.user = { id, isGM, targets: new Set() };
  warnings.length = 0;
  infos.length = 0;
}

function createItem(id, {
  name = id,
  slot = "cabeza",
  equipable = true,
  equipado = false,
  cantidad = 1,
  peso = 2,
  tipoObjeto = "armadura"
} = {}) {
  return {
    id,
    uuid: `Actor.dnd.Item.${id}`,
    name,
    img: "icons/svg/item-bag.svg",
    type: "objeto",
    system: { slot, equipable, equipado, cantidad, peso, tipoObjeto },
    toObject() { return structuredClone(this); }
  };
}

function createActor(items, equipped = {}) {
  const collection = [...items];
  collection.get = id => collection.find(item => item.id === id) ?? null;

  const actor = {
    id: "dnd",
    uuid: "Actor.dnd",
    name: "DnD",
    type: "personaje",
    items: collection,
    creates: 0,
    deletes: 0,
    system: {
      atributos: { fuerza: 3 },
      equipamiento: Object.fromEntries(SLOT_IDS.map(slot => [slot, equipped[slot] ?? ""]))
    },
    testUserPermission(user, permission) {
      return permission === "OWNER" && user?.id === "owner";
    },
    async update(changes) {
      for (const [path, value] of Object.entries(changes)) {
        if (!path.startsWith("system.equipamiento.")) continue;
        this.system.equipamiento[path.slice("system.equipamiento.".length)] = value;
      }
    },
    async updateEmbeddedDocuments(_type, updates) {
      for (const update of updates) {
        const item = collection.get(update._id);
        if (item && Object.hasOwn(update, "system.equipado")) {
          item.system.equipado = update["system.equipado"];
        }
      }
    },
    async createEmbeddedDocuments(_type, documents) {
      this.creates += documents.length;
      return documents;
    }
  };

  for (const item of items) item.parent = actor;
  return actor;
}

function dropEvent(data, { slot = "", inventory = false } = {}) {
  const slotElement = slot ? { dataset: { slot } } : null;
  const inventoryElement = inventory ? { className: "mtrol-inventory-list-region" } : null;

  return {
    preventDefault() {},
    dataTransfer: {
      getData() { return JSON.stringify(data); }
    },
    target: {
      closest(selector) {
        if (selector.includes("equipment-slot")) return slotElement;
        if (selector.includes("inventory-list-region")) return inventoryElement;
        return null;
      }
    }
  };
}

test.beforeEach(() => setUser("gm", true));

test("payload interno usa identidad documental y datos manipulados no caen al flujo externo", async () => {
  const helmet = createItem("helmet", { name: "Casco eterno" });
  const actor = createActor([helmet]);
  const valid = buildInternalItemDragData(actor, helmet);

  assert.deepEqual(
    { actorId: valid.actorId, itemId: valid.itemId, uuid: valid.uuid },
    { actorId: actor.id, itemId: helmet.id, uuid: helmet.uuid }
  );
  assert.equal(classifyItemDropData(actor, valid).kind, "internal");
  assert.equal(classifyItemDropData(actor, { type: "Item", uuid: helmet.uuid }).kind, "internal");
  assert.equal(classifyItemDropData(actor, { ...valid, actorId: "other", mtrolInternal: { ...valid.mtrolInternal, actorId: "other" } }).kind, "invalid-internal");
  assert.equal(classifyItemDropData(actor, { ...valid, itemId: "missing", mtrolInternal: { ...valid.mtrolInternal, itemId: "missing" } }).kind, "invalid-internal");
  assert.equal(classifyItemDropData(actor, { type: "Item", actorId: actor.id, itemId: helmet.id, uuid: "Actor.other.Item.helmet" }).kind, "invalid-internal");

  const sheet = new PersonajeSheet(actor);
  await sheet._onDrop(dropEvent({
    ...valid,
    itemId: "missing",
    mtrolInternal: { ...valid.mtrolInternal, itemId: "missing" }
  }, { slot: "cabeza" }));
  assert.equal(actor.creates, 0);
});

test("Casco eterno conserva ID, cantidad, peso y un solo documento tras diez ciclos", async () => {
  const helmet = createItem("helmet", { name: "Casco eterno", cantidad: 3, peso: 2 });
  const actor = createActor([helmet]);
  const sheet = new PersonajeSheet(actor);
  sheet._mtrolSelectedItemId = helmet.id;
  const payload = buildInternalItemDragData(actor, helmet);
  const before = {
    id: helmet.id,
    count: actor.items.length,
    quantity: helmet.system.cantidad,
    weight: calcularCargaActor(actor).pesoActual
  };

  for (let cycle = 0; cycle < 10; cycle += 1) {
    assert.equal(await sheet._onDrop(dropEvent(payload, { slot: "cabeza" })), true);
    assert.equal(actor.system.equipamiento.cabeza, helmet.id);
    assert.equal(await sheet._onDrop(dropEvent(payload, { inventory: true })), true);
    assert.equal(actor.system.equipamiento.cabeza, "");
  }

  assert.deepEqual({
    id: helmet.id,
    count: actor.items.length,
    quantity: helmet.system.cantidad,
    weight: calcularCargaActor(actor).pesoActual
  }, before);
  assert.equal(actor.creates, 0);
  assert.equal(sheet._mtrolSelectedItemId, helmet.id);
});

test("reemplazo mismo-slot delega al engine sin copiar y drop incompatible es no-op", async () => {
  const helmetA = createItem("helmet-a", { name: "Casco A", equipado: true });
  const helmetB = createItem("helmet-b", { name: "Casco B" });
  const sword = createItem("sword", { slot: "manoIzq", tipoObjeto: "arma" });
  const actor = createActor([helmetA, helmetB, sword], { cabeza: helmetA.id });
  const sheet = new PersonajeSheet(actor);

  assert.equal(await sheet._onDrop(dropEvent(buildInternalItemDragData(actor, sword), { slot: "cabeza" })), false);
  assert.equal(actor.system.equipamiento.cabeza, helmetA.id);
  assert.equal(sword.system.equipado, false);
  assert.equal(actor.items.length, 3);

  assert.equal(await sheet._onDrop(dropEvent(buildInternalItemDragData(actor, helmetB), { slot: "cabeza" })), true);
  assert.equal(actor.system.equipamiento.cabeza, helmetB.id);
  assert.equal(helmetA.system.equipado, false);
  assert.equal(helmetB.system.equipado, true);
  assert.equal(actor.items.length, 3);
  assert.equal(actor.creates, 0);
});

test("drop interno sobre fondo o mismo slot es no-op sin escrituras de creación", async () => {
  const helmet = createItem("helmet", { equipado: true });
  const actor = createActor([helmet], { cabeza: helmet.id });
  const sheet = new PersonajeSheet(actor);
  const payload = buildInternalItemDragData(actor, helmet, "cabeza");

  assert.equal(await sheet._onDrop(dropEvent(payload)), false);
  assert.equal(await sheet._onDrop(dropEvent(payload, { slot: "cabeza" })), true);
  assert.equal(actor.system.equipamiento.cabeza, helmet.id);
  assert.equal(actor.items.length, 1);
  assert.equal(actor.creates, 0);
});

test("Owner equipa, desequipa y reemplaza sin crear; observador no muta", async () => {
  const helmetA = createItem("helmet-a");
  const helmetB = createItem("helmet-b");
  const actor = createActor([helmetA, helmetB]);
  const sheet = new PersonajeSheet(actor);

  setUser("owner");
  assert.equal(await sheet._onDrop(dropEvent(buildInternalItemDragData(actor, helmetA), { slot: "cabeza" })), true);
  assert.equal(await sheet._onDrop(dropEvent(buildInternalItemDragData(actor, helmetB), { slot: "cabeza" })), true);
  assert.equal(await sheet._onDrop(dropEvent(buildInternalItemDragData(actor, helmetB), { inventory: true })), true);
  assert.equal(actor.creates, 0);

  setUser("observer");
  assert.equal(await sheet._onDrop(dropEvent(buildInternalItemDragData(actor, helmetA), { slot: "cabeza" })), false);
  assert.equal(actor.system.equipamiento.cabeza, "");
  assert.equal(actor.creates, 0);
});

test("drop externo legítimo crea exactamente uno para GM y cero para Owner", async () => {
  const actor = createActor([]);
  const sheet = new PersonajeSheet(actor);
  const payload = { type: "Item", uuid: externalItem.uuid };

  assert.equal(await sheet._onDrop(dropEvent(payload)), true);
  assert.equal(actor.creates, 1);

  setUser("owner");
  assert.equal(await sheet._onDrop(dropEvent(payload)), false);
  assert.equal(actor.creates, 1);
});
