import test from "node:test";
import assert from "node:assert/strict";

const metrics = {
  creates: 0,
  deletes: 0,
  baseItemUpdates: [],
  directItemUpdates: [],
  renders: 0
};
const warnings = [];

class MockActorSheet {
  constructor(actor) {
    this.actor = actor;
    this.options = {};
    this.position = {};
  }

  static get defaultOptions() { return {}; }
  getData() { return {}; }
  activateListeners() {}
  render() { metrics.renders += 1; }
}

class MockItemSheet {
  constructor(item) {
    this.item = item;
    this.options = {};
    this.position = {};
  }

  static get defaultOptions() { return {}; }
  getData() { return {}; }
  activateListeners() {}
  async _updateObject(_event, formData) {
    metrics.baseItemUpdates.push(structuredClone(formData));
    return structuredClone(formData);
  }
}

globalThis.foundry = {
  appv1: {
    sheets: {
      ActorSheet: MockActorSheet,
      ItemSheet: MockItemSheet
    }
  },
  utils: {
    deepClone: value => structuredClone(value),
    duplicate: value => structuredClone(value),
    escapeHTML: value => String(value ?? ""),
    mergeObject: (target, source) => Object.assign(target, source),
    randomID: () => "permission-request"
  }
};

globalThis.game = {
  user: { id: "gm", isGM: true, targets: new Set() },
  users: [],
  system: { id: "mtrol", version: "1.2.5" },
  socket: { emit() {}, on() {} }
};

globalThis.ui = {
  notifications: {
    warn(message) { warnings.push(message); },
    info() {},
    error() {}
  }
};

globalThis.Math.clamp ??= (value, min, max) =>
  Math.min(max, Math.max(min, value));

const { PersonajeSheet } =
  await import("../scripts/sheets/actors/personaje-sheet.js");
const { ObjetoSheet } =
  await import("../scripts/sheets/items/objeto-sheet.js");

const USERS = Object.freeze({
  gm: Object.freeze({ id: "gm", isGM: true }),
  owner: Object.freeze({ id: "owner", isGM: false }),
  observer: Object.freeze({ id: "observer", isGM: false })
});

function resetMetrics() {
  metrics.creates = 0;
  metrics.deletes = 0;
  metrics.baseItemUpdates = [];
  metrics.directItemUpdates = [];
  metrics.renders = 0;
  warnings.length = 0;
}

function setUser(user) {
  game.user = { ...user, targets: new Set() };
  warnings.length = 0;
}

function createItem() {
  const item = {
    id: "item",
    uuid: "Actor.structural.Item.item",
    name: "Espada",
    img: "icons/svg/item-bag.svg",
    type: "objeto",
    system: {
      tipoObjeto: "arma",
      equipable: true,
      equipado: false,
      slot: "manoDer",
      cantidad: 1,
      peso: 2,
      material: "hierro",
      danio: "5",
      defensa: 0,
      defensaBase: 0,
      descripcion: "",
      valor: 10
    },
    async update(changes) {
      metrics.directItemUpdates.push(structuredClone(changes));
      if (Object.hasOwn(changes, "img")) this.img = changes.img;
    },
    async delete() {
      metrics.deletes += 1;
    },
    sheet: { render() {} }
  };

  return item;
}

function createActor(item = createItem()) {
  const items = [item];
  items.get = id => items.find(candidate => candidate.id === id) ?? null;

  return {
    id: "structural",
    uuid: "Actor.structural",
    name: "Structural",
    type: "personaje",
    isOwner: game.user.id === "owner" || game.user.isGM,
    items,
    system: {
      atributos: { fuerza: 3 },
      recursos: { dharma: 0 },
      equipamiento: {}
    },
    testUserPermission(user, permission) {
      return permission === "OWNER" && user?.id === "owner";
    },
    async update() {},
    async updateEmbeddedDocuments() {},
    async createEmbeddedDocuments() {
      metrics.creates += 1;
    }
  };
}

function createItemEvent(itemId = "item") {
  return {
    preventDefault() {},
    currentTarget: {
      dataset: { itemId },
      closest() { return { dataset: { itemId } }; }
    }
  };
}

function createHtmlHarness() {
  const registrations = [];
  const removals = [];

  return {
    registrations,
    removals,
    html: {
      find(selector) {
        const chain = {
          off() { return chain; },
          on(eventName) {
            registrations.push({ selector, eventName });
            return chain;
          },
          remove() {
            removals.push(selector);
            return chain;
          },
          each() { return chain; }
        };
        return chain;
      }
    }
  };
}

function registeredSelectors(harness) {
  return new Set(harness.registrations.map(entry => entry.selector));
}

test.beforeEach(resetMetrics);

test("crear Items permanece exclusivamente GM-only", async () => {
  for (const [user, expectedCreates] of [
    [USERS.gm, 1],
    [USERS.owner, 0],
    [USERS.observer, 0]
  ]) {
    resetMetrics();
    setUser(user);
    const sheet = new PersonajeSheet(createActor());

    await sheet._onCreateObjeto({ preventDefault() {} });
    assert.equal(metrics.creates, expectedCreates);
  }
});

test("solo GM persiste campos mecánicos; img continúa como excepción no-GM", async () => {
  const mechanicalData = {
    name: "Espada alterada",
    "system.tipoObjeto": "material",
    "system.equipable": false,
    "system.slot": "extra",
    "system.peso": 999,
    "system.cantidad": 99,
    "system.material": "dragonil",
    "system.danio": "500",
    "system.defensa": 20,
    "system.descripcion": "alterada",
    "system.valor": 9999,
    img: "icons/changed.webp"
  };

  setUser(USERS.gm);
  const gmResult = await new ObjetoSheet(createItem())._updateObject(null, {
    ...mechanicalData
  });
  assert.equal(gmResult["system.tipoObjeto"], "material");
  assert.equal(metrics.baseItemUpdates.length, 1);

  for (const user of [USERS.owner, USERS.observer]) {
    resetMetrics();
    setUser(user);
    const item = createItem();
    const result = await new ObjetoSheet(item)._updateObject(null, {
      ...mechanicalData
    });

    assert.equal(result, undefined);
    assert.deepEqual(metrics.baseItemUpdates, []);
    assert.deepEqual(metrics.directItemUpdates, [{ img: "icons/changed.webp" }]);
    assert.equal(item.system.tipoObjeto, "arma");
    assert.equal(item.system.equipable, true);
    assert.equal(item.system.slot, "manoDer");
    assert.equal(item.system.peso, 2);
    assert.equal(item.system.cantidad, 1);
    assert.equal(item.system.material, "hierro");
    assert.equal(item.system.danio, "5");
    assert.equal(item.system.defensa, 0);
  }
});

test("eliminación manual permanece exclusivamente GM-only", async () => {
  for (const [user, expectedDeletes] of [
    [USERS.gm, 1],
    [USERS.owner, 0],
    [USERS.observer, 0]
  ]) {
    resetMetrics();
    setUser(user);
    const item = createItem();
    const sheet = new PersonajeSheet(createActor(item));

    await sheet._onDeleteItem(createItemEvent());
    assert.equal(metrics.deletes, expectedDeletes);
  }
});

test("listeners estructurales son GM-only y no revive controles legacy de equipamiento", () => {
  for (const [user, expected] of [
    [USERS.gm, { structural: true }],
    [USERS.owner, { structural: false }],
    [USERS.observer, { structural: false }]
  ]) {
    setUser(user);
    const harness = createHtmlHarness();
    new PersonajeSheet(createActor()).activateListeners(harness.html);
    const selectors = registeredSelectors(harness);

    assert.equal(selectors.has(".item-equip"), false);
    assert.equal(selectors.has(".item-unequip"), false);
    assert.equal(selectors.has(".item-create-objeto"), expected.structural);
    assert.equal(selectors.has(".item-delete"), expected.structural);

    if (!expected.structural) {
      assert.equal(
        harness.removals.includes(".item-create-objeto, .item-delete"),
        true
      );
    }
  }
});
