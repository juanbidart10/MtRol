import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

globalThis.foundry = {
  utils: {
    deepClone: value => structuredClone(value),
    duplicate: value => structuredClone(value),
    randomID: () => "phase4-id"
  }
};

const {
  TradeTransferCoordinator,
  prepareTradeTransferPlan
} = await import("../scripts/trade/trade-transfer-service.js");
const { TradeSessionStore } = await import("../scripts/trade/trade-session-service.js");
const { tradeRuntimeRepository } = await import("../scripts/trade/trade-runtime-repository.js");

test.beforeEach(() => tradeRuntimeRepository.resetForTests());

let nextItemId = 0;

function makeItem(actor, { id, name, quantity, type = "general", equipped = false, slot = "", weight = 1 }) {
  const system = { tipoObjeto: type, cantidad: quantity, equipado: equipped, slot, peso: weight };
  return {
    id,
    uuid: `${actor.uuid}.Item.${id}`,
    name,
    type: "objeto",
    system,
    _source: { system: structuredClone(system) },
    parent: actor,
    toObject() {
      return { _id: this.id, name: this.name, type: this.type, system: structuredClone(this.system), flags: { private: true } };
    }
  };
}

function makeActor(id, specs = []) {
  const items = [];
  items.get = itemId => items.find(item => item.id === itemId) ?? null;
  const actor = {
    id,
    uuid: `Actor.${id}`,
    system: { atributos: { fuerza: { value: 5 } }, equipamiento: {} },
    items,
    createCalls: 0,
    updateCalls: 0,
    deleteCalls: 0,
    failCreateAt: null,
    failUpdateAt: null,
    failDeleteAt: null,
    async createEmbeddedDocuments(_type, data, options = {}) {
      this.createCalls += 1;
      if (this.failCreateAt === this.createCalls) throw new Error("injected create failure");
      return data.map(source => {
        const requestedId = source._id ?? source.id;
        const itemId = options.keepId && requestedId ? requestedId : `created-${++nextItemId}`;
        if (items.get(itemId)) throw new Error("id collision");
        const item = makeItem(this, {
          id: itemId,
          name: source.name,
          quantity: Number(source.system?.cantidad ?? 1),
          type: source.system?.tipoObjeto ?? "general",
          equipped: source.system?.equipado ?? false,
          slot: source.system?.slot ?? "",
          weight: Number(source.system?.peso ?? 1)
        });
        items.push(item);
        return item;
      });
    },
    async updateEmbeddedDocuments(_type, updates) {
      this.updateCalls += 1;
      if (this.failUpdateAt === this.updateCalls) throw new Error("injected update failure");
      for (const update of updates) {
        const item = items.get(update._id);
        if (!item) throw new Error("missing update item");
        const quantity = update["system.cantidad"] ?? update.system?.cantidad;
        if (quantity !== undefined) {
          item.system.cantidad = quantity;
          item._source.system.cantidad = quantity;
        }
      }
      return updates.map(update => items.get(update._id));
    },
    async deleteEmbeddedDocuments(_type, ids) {
      this.deleteCalls += 1;
      if (this.failDeleteAt === this.deleteCalls) throw new Error("injected delete failure");
      for (const itemId of ids) {
        const index = items.findIndex(item => item.id === itemId);
        if (index >= 0) items.splice(index, 1);
      }
      return [];
    }
  };
  for (const spec of specs) items.push(makeItem(actor, spec));
  return actor;
}

function readySession(actorA, actorB, offersA = [], offersB = [], { id = "trade-4", revision = 2 } = {}) {
  const participants = {
    participantA: { userId: "user-a", actorUuid: actorA.uuid, actorName: "A" },
    participantB: { userId: "user-b", actorUuid: actorB.uuid, actorName: "B" }
  };
  const offers = { participantA: offersA, participantB: offersB };
  const reservations = [];
  for (const key of ["participantA", "participantB"]) {
    for (const entry of offers[key]) reservations.push({
      sessionId: id,
      participantKey: key,
      actorUuid: participants[key].actorUuid,
      itemUuid: entry.itemUuid,
      itemId: entry.itemId,
      quantity: entry.quantity
    });
  }
  return {
    id,
    state: "READY",
    revision,
    participants,
    offers,
    reservations,
    confirmations: {
      participantA: { confirmed: true, revision },
      participantB: { confirmed: true, revision }
    }
  };
}

function offer(item, quantity) {
  return { itemUuid: item.uuid, itemId: item.id, quantity };
}

async function planFor(session, actors, executionId = "exec-1") {
  return prepareTradeTransferPlan({
    session,
    executionId,
    resolveActor: async uuid => actors.find(actor => actor.uuid === uuid) ?? null
  });
}

test("4-01 READY ejecuta una sola vez", async () => {
  const a = makeActor("a1", [{ id: "p", name: "Poción", quantity: 2 }]); const b = makeActor("b1");
  const plan = await planFor(readySession(a, b, [offer(a.items.get("p"), 1)]), [a, b]);
  const coordinator = new TradeTransferCoordinator(); await coordinator.executePlan(plan); await coordinator.executePlan(plan);
  assert.equal(b.items.length, 1);
});

test("4-02 una confirmación insuficiente no prevalida", async () => {
  const a = makeActor("a2"); const b = makeActor("b2"); const session = readySession(a, b);
  session.confirmations.participantB.confirmed = false;
  await assert.rejects(planFor(session, [a, b]), /Ambas confirmaciones/);
});

test("4-03 revisión vieja no prevalida", async () => {
  const a = makeActor("a3"); const b = makeActor("b3"); const session = readySession(a, b);
  session.confirmations.participantA.revision = 1;
  await assert.rejects(planFor(session, [a, b]), /revisión vigente/);
});

test("4-04 Item inexistente aborta antes de mutación", async () => {
  const a = makeActor("a4"); const b = makeActor("b4");
  const missing = { itemUuid: `${a.uuid}.Item.missing`, itemId: "missing", quantity: 1 };
  await assert.rejects(planFor(readySession(a, b, [missing]), [a, b]), /ya no existe/);
  assert.equal(a.updateCalls + a.deleteCalls + b.createCalls, 0);
});

test("4-05 cantidad insuficiente aborta", async () => {
  const a = makeActor("a5", [{ id: "p", name: "P", quantity: 1 }]); const b = makeActor("b5");
  await assert.rejects(planFor(readySession(a, b, [offer(a.items[0], 2)]), [a, b]), /no cubre/);
});

test("4-06 Item equipado aborta", async () => {
  const a = makeActor("a6", [{ id: "s", name: "Espada", quantity: 1, equipped: true, slot: "manoDer" }]); const b = makeActor("b6");
  await assert.rejects(planFor(readySession(a, b, [offer(a.items[0], 1)]), [a, b]), /equipado/);
});

test("4-07 transferencia total elimina origen y crea destino", async () => {
  const a = makeActor("a7", [{ id: "p", name: "P", quantity: 4 }]); const b = makeActor("b7");
  const plan = await planFor(readySession(a, b, [offer(a.items[0], 4)]), [a, b]); await new TradeTransferCoordinator().executePlan(plan);
  assert.equal(a.items.length, 0); assert.equal(b.items[0].system.cantidad, 4);
});

test("4-08 transferencia parcial conserva remanente", async () => {
  const a = makeActor("a8", [{ id: "p", name: "P", quantity: 10 }]); const b = makeActor("b8");
  await new TradeTransferCoordinator().executePlan(await planFor(readySession(a, b, [offer(a.items[0], 4)]), [a, b]));
  assert.equal(a.items[0].system.cantidad, 6); assert.equal(b.items[0].system.cantidad, 4);
});

test("4-09 transferencia bilateral es simétrica", async () => {
  const a = makeActor("a9", [{ id: "a", name: "A", quantity: 2 }]); const b = makeActor("b9", [{ id: "b", name: "B", quantity: 3 }]);
  const session = readySession(a, b, [offer(a.items[0], 1)], [offer(b.items[0], 2)]);
  await new TradeTransferCoordinator().executePlan(await planFor(session, [a, b]));
  assert.equal(a.items.some(item => item.name === "B"), true); assert.equal(b.items.some(item => item.name === "A"), true);
});

test("4-10 comercio unilateral es válido", async () => {
  const a = makeActor("a10", [{ id: "gift", name: "Regalo", quantity: 1 }]); const b = makeActor("b10");
  await new TradeTransferCoordinator().executePlan(await planFor(readySession(a, b, [offer(a.items[0], 1)], []), [a, b]));
  assert.equal(b.items[0].name, "Regalo");
});

test("4-11 moneda se comporta como stack", async () => {
  const a = makeActor("a11", [{ id: "coin", name: "Moneda", quantity: 100, type: "moneda" }]); const b = makeActor("b11");
  await new TradeTransferCoordinator().executePlan(await planFor(readySession(a, b, [offer(a.items[0], 17)]), [a, b]));
  assert.equal(a.items[0].system.cantidad, 83); assert.equal(b.items[0].system.tipoObjeto, "moneda");
});

test("4-12 doble ejecución concurrente no duplica", async () => {
  const a = makeActor("a12", [{ id: "p", name: "P", quantity: 2 }]); const b = makeActor("b12");
  const plan = await planFor(readySession(a, b, [offer(a.items[0], 1)]), [a, b]); const c = new TradeTransferCoordinator();
  await Promise.all([c.executePlan(plan), c.executePlan(plan)]); assert.equal(b.items.length, 1);
});

test("4-13 doble click lógico devuelve el mismo recibo", async () => {
  const a = makeActor("a13"); const b = makeActor("b13"); const plan = await planFor(readySession(a, b), [a, b]); const c = new TradeTransferCoordinator();
  assert.deepEqual(await c.executePlan(plan), await c.executePlan(plan));
});

test("4-14 executionId repetido devuelve recibo", async () => {
  const a = makeActor("a14"); const b = makeActor("b14"); const c = new TradeTransferCoordinator(); const plan = await planFor(readySession(a, b), [a, b], "same");
  const first = await c.executePlan(plan); assert.deepEqual(c.getReceipt("same"), first);
});

test("4-15 executionId conflictivo se rechaza", async () => {
  const a = makeActor("a15", [{ id: "p", name: "P", quantity: 2 }]); const b = makeActor("b15"); const c = new TradeTransferCoordinator();
  await c.executePlan(await planFor(readySession(a, b), [a, b], "conflict"));
  await assert.rejects(c.executePlan(await planFor(readySession(a, b, [offer(a.items[0], 1)]), [a, b], "conflict")), /otro plan/);
});

test("4-16 sesión COMPLETED no se prevalida", async () => {
  const a = makeActor("a16"); const b = makeActor("b16"); const session = readySession(a, b); session.state = "COMPLETED";
  await assert.rejects(planFor(session, [a, b]), /READY/);
});

test("4-17 rollback recupera modificación parcial", async () => {
  const a = makeActor("a17", [{ id: "a", name: "A", quantity: 3 }]); const b = makeActor("b17", [{ id: "b", name: "B", quantity: 1 }]);
  b.failDeleteAt = 1; const session = readySession(a, b, [offer(a.items[0], 1)], [offer(b.items[0], 1)]);
  const error = await new TradeTransferCoordinator().executePlan(await planFor(session, [a, b])).catch(value => value);
  assert.equal(error.rollbackSucceeded, true); assert.equal(a.items.get("a").system.cantidad, 3); assert.equal(b.items.get("b").system.cantidad, 1);
});

test("4-18 rollback no toca Items ajenos", async () => {
  const a = makeActor("a18", [{ id: "trade", name: "T", quantity: 2 }, { id: "other", name: "O", quantity: 9 }]); const b = makeActor("b18");
  a.failUpdateAt = 1; await new TradeTransferCoordinator().executePlan(await planFor(readySession(a, b, [offer(a.items.get("trade"), 1)]), [a, b])).catch(() => {});
  assert.equal(a.items.get("other").system.cantidad, 9);
});

test("4-19 error creando destino no elimina origen", async () => {
  const a = makeActor("a19", [{ id: "p", name: "P", quantity: 1 }]); const b = makeActor("b19"); b.failCreateAt = 1;
  await assert.rejects(new TradeTransferCoordinator().executePlan(await planFor(readySession(a, b, [offer(a.items[0], 1)]), [a, b])));
  assert.equal(a.items.length, 1);
});

test("4-20 error eliminando origen restaura destino", async () => {
  const a = makeActor("a20", [{ id: "p", name: "P", quantity: 1 }]); const b = makeActor("b20"); a.failDeleteAt = 1;
  await assert.rejects(new TradeTransferCoordinator().executePlan(await planFor(readySession(a, b, [offer(a.items[0], 1)]), [a, b])));
  assert.equal(a.items.length, 1); assert.equal(b.items.length, 0);
});

test("4-21 IDs de destino no colisionan con origen", async () => {
  const a = makeActor("a21", [{ id: "same", name: "P", quantity: 1 }]); const b = makeActor("b21", [{ id: "same", name: "Existente", quantity: 1 }]);
  await new TradeTransferCoordinator().executePlan(await planFor(readySession(a, b, [offer(a.items[0], 1)]), [a, b]));
  assert.equal(new Set(b.items.map(item => item.id)).size, 2);
});

test("4-22 destino no recibe referencias de equipamiento ni flags privados", async () => {
  const a = makeActor("a22", [{ id: "p", name: "P", quantity: 1 }]); const b = makeActor("b22");
  const plan = await planFor(readySession(a, b, [offer(a.items[0], 1)]), [a, b]);
  assert.equal(plan.entries[0].incomingData.system.equipado, false); assert.equal(plan.entries[0].incomingData.system.slot, ""); assert.equal("flags" in plan.entries[0].incomingData, false);
});

test("4-23 peso final se conserva", async () => {
  const a = makeActor("a23", [{ id: "p", name: "P", quantity: 5, weight: 2 }]); const b = makeActor("b23");
  await new TradeTransferCoordinator().executePlan(await planFor(readySession(a, b, [offer(a.items[0], 2)]), [a, b]));
  const weight = [...a.items, ...b.items].reduce((sum, item) => sum + item.system.cantidad * item.system.peso, 0); assert.equal(weight, 10);
});

test("4-24 completar sesión libera reservas", async () => {
  const store = new TradeSessionStore(); store.reconcileAuthority({ gmUserId: "gm", epoch: "e" });
  const session = await store.createSession({ participantA: { userId: "a", actorUuid: "Actor.a" }, participantB: { userId: "b", actorUuid: "Actor.b" }, authority: { gmUserId: "gm", epoch: "e" }, operationId: "c" });
  const raw = store.sessions.get(session.id); raw.state = "EXECUTING"; raw.execution = { executionId: "x" };
  await store.completeSession({ sessionId: session.id, authorityUserId: "gm", executionId: "x", operationId: "done" }); assert.equal(store.getReservationsForSession(session.id).length, 0);
});

test("4-25 completar limpia índices Actor a sesión", async () => {
  const store = new TradeSessionStore(); store.reconcileAuthority({ gmUserId: "gm", epoch: "e" });
  const session = await store.createSession({ participantA: { userId: "a", actorUuid: "Actor.a" }, participantB: { userId: "b", actorUuid: "Actor.b" }, authority: { gmUserId: "gm", epoch: "e" }, operationId: "c25" });
  const raw = store.sessions.get(session.id); raw.state = "EXECUTING"; raw.execution = { executionId: "x" };
  await store.completeSession({ sessionId: session.id, authorityUserId: "gm", executionId: "x", operationId: "done25" }); assert.equal(store.getActiveSessionIdForActor("Actor.a"), null);
});

test("4-26 ChatMessage fallido está aislado del commit", async () => {
  const source = await readFile(new URL("../scripts/trade/trade-authority.js", import.meta.url), "utf8");
  assert.match(source, /completeSession[\s\S]*publishTradeSession[\s\S]*createTradeCompletionMessage/);
  assert.match(source, /Comercio completado, pero falló el ChatMessage/);
});

test("4-27 EXECUTING rechaza modificación de oferta y cancelación", async () => {
  const store = new TradeSessionStore(); const raw = readySession(makeActor("x27"), makeActor("y27")); raw.authority = { gmUserId: "gm", epoch: "e" }; store.sessions.set(raw.id, raw);
  raw.state = "EXECUTING";
  await assert.rejects(store.setOffer({ sessionId: raw.id, participantKey: "participantA", requestingUserId: "user-a", entries: [], operationId: "offer27" }), /no admite/);
  await assert.rejects(store.cancelSession({ sessionId: raw.id, participantKey: "participantA", requestingUserId: "user-a", operationId: "cancel27" }), /no puede cancelarse/);
});

test("4-28 beginExecution concurrente sólo permite una transición", async () => {
  const store = new TradeSessionStore(); store.reconcileAuthority({ gmUserId: "gm", epoch: "e" });
  const created = await store.createSession({ participantA: { userId: "user-a", actorUuid: "Actor.x28" }, participantB: { userId: "user-b", actorUuid: "Actor.y28" }, authority: { gmUserId: "gm", epoch: "e" }, operationId: "c28" });
  const raw = store.sessions.get(created.id); raw.state = "READY"; raw.revision = 1;
  raw.confirmations.participantA = { confirmed: true, revision: 1 }; raw.confirmations.participantB = { confirmed: true, revision: 1 };
  const first = store.beginExecution({ sessionId: raw.id, authorityUserId: "gm", executionId: "e1", revision: 1, operationId: "b1" });
  const second = store.beginExecution({ sessionId: raw.id, authorityUserId: "gm", executionId: "e2", revision: 1, operationId: "b2" });
  const settled = await Promise.allSettled([first, second]); assert.equal(settled.filter(result => result.status === "fulfilled").length, 1);
});

test("4-29 cantidades reales finales coinciden con el plan", async () => {
  const a = makeActor("a29", [{ id: "p", name: "P", quantity: 7 }]); const b = makeActor("b29"); const plan = await planFor(readySession(a, b, [offer(a.items[0], 3)]), [a, b]);
  const receipt = await new TradeTransferCoordinator().executePlan(plan); assert.equal(receipt.transferredEntries, 1); assert.equal(a.items[0].system.cantidad + b.items[0].system.cantidad, 7);
});

test("4-30 el motor nuevo no importa ni activa el legacy", async () => {
  const source = await readFile(new URL("../scripts/trade/trade-transfer-service.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /trade-engine|trade-dialog|mtrolEjecutarComercio|delete all actor\.items/);
});
