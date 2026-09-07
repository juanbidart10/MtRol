import test from "node:test";
import assert from "node:assert/strict";

const gm = { id: "gm", isGM: true, active: true };
globalThis.game = {
  user: gm,
  users: new Map([[gm.id, gm]])
};
globalThis.ui = {
  notifications: {
    warn() {},
    error() {},
    info() {}
  }
};
globalThis.Hooks = { on() {} };

const {
  preUpdateItemDispatcher
} = await import("../scripts/core/hook-dispatcher.js");
const {
  preventReservedTradeItemDeletion,
  preventReservedTradeItemMutation
} = await import("../scripts/trade/trade-hooks.js");
const {
  configureTradeReservationBoundary
} = await import("../scripts/trade/trade-reservation-boundary.js");
const {
  adjustCompetenceLevel
} = await import("../scripts/progression/competence-level-service.js");

const reservations = new Map();

configureTradeReservationBoundary({
  getReservedQuantity(actorUuid, reference) {
    const itemUuid = String(reference?.itemUuid ?? "").trim();
    const itemId = String(reference?.itemId ?? "").trim();
    if (!itemUuid && !itemId) throw new TypeError("La reserva necesita itemUuid o itemId.");
    return reservations.get(itemUuid || `${actorUuid}::${itemId}`) ?? 0;
  }
});

assert.equal(preUpdateItemDispatcher.subscribe(
  "trade.reservation-guard",
  preventReservedTradeItemMutation,
  { priority: 5, critical: true }
), true);

test.beforeEach(() => reservations.clear());

function applyChanges(item, changes) {
  for (const [path, value] of Object.entries(changes)) {
    if (path.startsWith("system.")) {
      item.system[path.slice("system.".length)] = value;
    } else {
      item[path] = value;
    }
  }
}

function createEmbeddedItem({
  id = "item-1",
  type = "objeto",
  system = {}
} = {}) {
  const actor = { uuid: "Actor.actor-1" };
  const item = {
    id,
    uuid: `${actor.uuid}.Item.${id}`,
    type,
    parent: actor,
    system: { ...system },
    async update(changes, options = {}) {
      const allowed = preUpdateItemDispatcher.dispatchSync(
        this,
        changes,
        options,
        game.user.id
      );
      if (!allowed) return false;
      applyChanges(this, changes);
      return this;
    }
  };
  return item;
}

test("Item embebido no reservado permite actualizar system.nivel atravesando trade.reservation-guard", async () => {
  const item = createEmbeddedItem({ type: "competencia", system: { nivel: 1 } });

  const result = await item.update({ "system.nivel": 2 });

  assert.equal(result, item);
  assert.equal(item.system.nivel, 2);
});

test("Competencia puede subir nivel mediante adjustCompetenceLevel y el subscriber real", async () => {
  const item = createEmbeddedItem({
    type: "competencia",
    system: { nivel: 1, categoria: "competencia" }
  });

  const result = await adjustCompetenceLevel(item, 1);

  assert.deepEqual(result, { changed: true, level: 2 });
  assert.equal(item.system.nivel, 2);
});

test("Competencia puede bajar nivel mediante adjustCompetenceLevel y el subscriber real", async () => {
  const item = createEmbeddedItem({
    type: "competencia",
    system: { nivel: 2, categoria: "competencia" }
  });

  const result = await adjustCompetenceLevel(item, -1);

  assert.deepEqual(result, { changed: true, level: 1 });
  assert.equal(item.system.nivel, 1);
});

test("Item no reservado permite editar nombre y descripción", async () => {
  const item = createEmbeddedItem({ system: { descripcion: "Antes" } });
  item.name = "Objeto anterior";

  const result = await item.update({
    name: "Objeto nuevo",
    "system.descripcion": "Después"
  });

  assert.equal(result, item);
  assert.equal(item.name, "Objeto nuevo");
  assert.equal(item.system.descripcion, "Después");
});

test("Item reservado permite un cambio inocuo", async () => {
  const item = createEmbeddedItem({ system: { cantidad: 5, descripcion: "Antes" } });
  reservations.set(item.uuid, 3);

  const result = await item.update({ "system.descripcion": "Después" });

  assert.equal(result, item);
  assert.equal(item.system.descripcion, "Después");
});

test("Item reservado no puede equiparse", async () => {
  const item = createEmbeddedItem({ system: { cantidad: 5, equipado: false } });
  reservations.set(item.uuid, 3);

  const result = await item.update({ "system.equipado": true });

  assert.equal(result, false);
  assert.equal(item.system.equipado, false);
});

test("Item reservado no puede reducirse por debajo de la reserva", async () => {
  const item = createEmbeddedItem({ system: { cantidad: 5 } });
  reservations.set(item.uuid, 3);

  const result = await item.update({ "system.cantidad": 2 });

  assert.equal(result, false);
  assert.equal(item.system.cantidad, 5);
});

test("Item reservado permite cantidad igual a la reserva", async () => {
  const item = createEmbeddedItem({ system: { cantidad: 5 } });
  reservations.set(item.uuid, 3);

  const result = await item.update({ "system.cantidad": 3 });

  assert.equal(result, item);
  assert.equal(item.system.cantidad, 3);
});

test("Item reservado permite aumentar la cantidad", async () => {
  const item = createEmbeddedItem({ system: { cantidad: 5 } });
  reservations.set(item.uuid, 3);

  const result = await item.update({ "system.cantidad": 6 });

  assert.equal(result, item);
  assert.equal(item.system.cantidad, 6);
});

test("preDeleteItem permite un Item no reservado", () => {
  const item = createEmbeddedItem({ system: { cantidad: 5 } });

  assert.equal(preventReservedTradeItemDeletion(item), true);
});

test("preDeleteItem bloquea un Item reservado", () => {
  const item = createEmbeddedItem({ system: { cantidad: 5 } });
  reservations.set(item.uuid, 3);

  assert.equal(preventReservedTradeItemDeletion(item), false);
});

test("commit Trade con mtrolTradeExecutionId atraviesa el guard", async () => {
  const item = createEmbeddedItem({ system: { cantidad: 5 } });
  reservations.set(item.uuid, 5);

  const result = await item.update(
    { "system.cantidad": 0 },
    { mtrolTradeExecutionId: "execution-1" }
  );

  assert.equal(result, item);
  assert.equal(item.system.cantidad, 0);
});

test("rollback con mtrolTradeRollback atraviesa el guard", async () => {
  const item = createEmbeddedItem({ system: { cantidad: 1 } });
  reservations.set(item.uuid, 5);

  const result = await item.update(
    { "system.cantidad": 5 },
    { mtrolTradeRollback: true }
  );

  assert.equal(result, item);
  assert.equal(item.system.cantidad, 5);
});

test("World Item sin Actor permanece permitido", () => {
  const item = { id: "world-item", uuid: "Item.world-item", parent: null, actor: null };

  assert.equal(preventReservedTradeItemMutation(item, { name: "Nuevo" }), true);
  assert.equal(preventReservedTradeItemDeletion(item), true);
});
