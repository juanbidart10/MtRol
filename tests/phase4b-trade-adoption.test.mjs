import test from "node:test";
import assert from "node:assert/strict";

const settings = new Map();
let nextId = 0;

globalThis.foundry = { utils: {
  deepClone: value => value === undefined ? undefined : structuredClone(value),
  duplicate: value => value === undefined ? undefined : structuredClone(value),
  randomID: () => `phase4b-${++nextId}`
} };
globalThis.game = {
  user: { id: "gm", isGM: true, active: true },
  users: new Map([["gm", { id: "gm", isGM: true, active: true }]]),
  actors: new Map(),
  combats: new Map(),
  settings: {
    register(scope, key, options) {
      const id = `${scope}.${key}`;
      if (!settings.has(id)) settings.set(id, structuredClone(options.default));
    },
    get(scope, key) { return settings.get(`${scope}.${key}`); },
    async set(scope, key, value) {
      settings.set(`${scope}.${key}`, structuredClone(value));
      return value;
    }
  }
};
globalThis.Hooks = { callAll() {}, on() {} };
globalThis.ui = { notifications: { warn() {}, error() {}, info() {} } };

const {
  createDefaultTradeRuntime,
  registerTradeRuntimeSetting,
  TradeRuntimeRepository
} = await import("../scripts/trade/trade-runtime-repository.js");
const { TradeSessionStore } = await import("../scripts/trade/trade-session-service.js");
const { createReceiptScope } = await import("../scripts/runtime/receipt-store.js");
const { receiptStore } = await import("../scripts/runtime/runtime-foundation.js");
const {
  configureTradeReservationBoundary,
  getTradeEffectiveAvailability
} = await import("../scripts/trade/trade-reservation-boundary.js");
const { TradeAuditService } = await import("../scripts/trade/trade-audit-service.js");
const {
  TradeTransferCoordinator,
  prepareTradeTransferPlan
} = await import("../scripts/trade/trade-transfer-service.js");

registerTradeRuntimeSetting();

function resetRuntime() {
  settings.set("mtrol.tradeRuntime", createDefaultTradeRuntime());
}

function participant(key, actorUuid) {
  return {
    userId: key === "participantA" ? "a" : "b",
    actorUuid,
    actorName: key,
    tokenUuid: `Scene.s.Token.${key}`
  };
}

function storeFixture(repository = new TradeRuntimeRepository()) {
  const quantities = new Map();
  const store = new TradeSessionStore({
    idFactory: () => `trade-${++nextId}`,
    repository,
    resolveRealQuantity: reference => quantities.get(reference.itemUuid) ?? 10,
    resolveOfferItem: reference => ({
      publicSnapshot: {
        itemUuid: reference.itemUuid,
        itemId: reference.itemId,
        name: "Objeto",
        quantity: reference.quantity
      }
    })
  });
  store.authority = { gmUserId: "gm", epoch: "epoch" };
  return { store, quantities, repository };
}

async function createAccepted(fx, suffix = "one") {
  let session = await fx.store.createSession({
    participantA: participant("participantA", `Actor.a-${suffix}`),
    participantB: participant("participantB", `Actor.b-${suffix}`),
    authority: { gmUserId: "gm", epoch: "epoch" },
    operationId: `create-${suffix}`
  });
  session = await fx.store.acceptSession({
    sessionId: session.id,
    participantKey: "participantB",
    requestingUserId: "b",
    operationId: `accept-${suffix}`
  });
  return session;
}

test.beforeEach(resetRuntime);

test("runtime Trade world-scoped conserva revisión monotónica y receipts", async () => {
  const repository = new TradeRuntimeRepository();
  const scope = createReceiptScope(repository, repository.target, "phase4b-runtime");
  let effects = 0;
  const execute = () => receiptStore.execute(scope, {
    transactionId: "trade-command-once",
    command: "trade.offer-set"
  }, async () => ({ ok: true, effects: ++effects }));
  assert.deepEqual(await execute(), { ok: true, effects: 1 });
  assert.deepEqual(await execute(), { ok: true, effects: 1 });
  assert.equal(effects, 1);
  assert.ok(new TradeRuntimeRepository().read().revision >= 2);
});

test("fallo real al leer runtime Trade aborta y no degrada a fallback RAM-only", () => {
  const originalGet = game.settings.get;
  const entries = [];
  game.settings.get = () => { throw new Error("settings unavailable"); };
  try {
    const repository = new TradeRuntimeRepository({
      logger: { error: (channel, message, context) => entries.push({ channel, message, context }) }
    });
    assert.throws(() => repository.read(), /settings unavailable/);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].context.reasonCode, "TRADE_RUNTIME_READ_FAILED");
    assert.equal(entries[0].context.status, "failed");
  } finally {
    game.settings.get = originalGet;
  }
});

test("F5 hidrata sesión, índice por Actor, oferta y reserva desde persistencia", async () => {
  const first = storeFixture();
  let session = await createAccepted(first, "f5");
  const itemUuid = "Actor.a-f5.Item.stack";
  first.quantities.set(itemUuid, 10);
  session = await first.store.setOffer({
    sessionId: session.id,
    participantKey: "participantA",
    requestingUserId: "a",
    entries: [{ itemUuid, itemId: "stack", quantity: 3 }],
    revision: session.revision,
    operationId: "offer-f5"
  });

  const second = storeFixture(new TradeRuntimeRepository());
  await second.store.hydrateFromPersistence();
  assert.equal(second.store.getSession(session.id).offers.participantA[0].quantity, 3);
  assert.equal(second.store.getReservedQuantity("Actor.a-f5", { itemUuid, itemId: "stack" }), 3);
  assert.equal(second.store.getActiveSessionIdForActor("Actor.a-f5"), session.id);
});

test("dos creates concurrentes con el mismo Actor producen una sola sesión", async () => {
  const fx = storeFixture();
  const create = (suffix, operationId) => fx.store.createSession({
    participantA: participant("participantA", "Actor.shared"),
    participantB: participant("participantB", `Actor.${suffix}`),
    authority: { gmUserId: "gm", epoch: "epoch" },
    operationId
  });
  const results = await Promise.allSettled([
    create("b1", "race-1"),
    create("b2", "race-2")
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(fx.store.listSessions({ activeOnly: true }).length, 1);
});

test("reserva parcial deja disponible únicamente el resto del stack", async () => {
  const fx = storeFixture();
  let session = await createAccepted(fx, "reserve");
  const item = { id: "stack", uuid: "Actor.a-reserve.Item.stack" };
  session = await fx.store.setOffer({
    sessionId: session.id,
    participantKey: "participantA",
    requestingUserId: "a",
    entries: [{ itemUuid: item.uuid, itemId: item.id, quantity: 3 }],
    operationId: "reserve-three"
  });
  configureTradeReservationBoundary({
    getReservedQuantity: (actorUuid, reference) => fx.store.getReservedQuantity(actorUuid, reference)
  });
  assert.deepEqual(getTradeEffectiveAvailability("Actor.a-reserve", item, 10), {
    real: 10,
    reserved: 3,
    available: 7
  });
});

test("stale revision no puede cambiar oferta ni conservar confirmaciones", async () => {
  const fx = storeFixture();
  let session = await createAccepted(fx, "stale");
  session = await fx.store.setOffer({
    sessionId: session.id,
    participantKey: "participantA",
    requestingUserId: "a",
    entries: [{ itemUuid: "Actor.a-stale.Item.i", itemId: "i", quantity: 1 }],
    revision: session.revision,
    operationId: "fresh-offer"
  });
  await assert.rejects(fx.store.setOffer({
    sessionId: session.id,
    participantKey: "participantA",
    requestingUserId: "a",
    entries: [],
    revision: session.revision - 1,
    operationId: "stale-offer"
  }), /revisión vigente/);
});

test("pausa GM persiste, bloquea oferta y reanuda el estado previo", async () => {
  const fx = storeFixture();
  let session = await createAccepted(fx, "pause");
  session = await fx.store.pauseSession({
    sessionId: session.id,
    authorityUserId: "gm",
    requestingUserId: "gm",
    operationId: "pause"
  });
  assert.equal(session.state, "PAUSED");
  await assert.rejects(fx.store.setOffer({
    sessionId: session.id,
    participantKey: "participantA",
    requestingUserId: "a",
    entries: [],
    operationId: "paused-offer"
  }), /no admite/);
  session = await fx.store.resumeSession({
    sessionId: session.id,
    authorityUserId: "gm",
    requestingUserId: "gm",
    operationId: "resume"
  });
  assert.equal(session.state, "NEGOTIATING");
});

test("history permanece separada, indefinida y pruning es sólo explícito", async () => {
  class MemoryStorage {
    constructor() { this.records = []; }
    async read() { return structuredClone(this.records); }
    async write(records) { this.records = structuredClone(records); }
  }
  const storage = new MemoryStorage();
  const audit = new TradeAuditService({ storage });
  for (const id of ["h1", "h2", "h3"]) {
    await audit.persistTerminal({
      id,
      state: "CANCELLED",
      revision: 1,
      participants: {
        participantA: participant("participantA", "Actor.a"),
        participantB: participant("participantB", "Actor.b")
      },
      publicOffers: { participantA: [], participantB: [] },
      confirmations: {},
      createdAt: Date.now(),
      cancelledAt: Date.now()
    });
  }
  assert.equal((await audit.getHistory()).length, 3);
  assert.deepEqual(await audit.prune({ maxCount: 1 }), { before: 3, after: 1, removed: 2 });
  assert.equal((await audit.getHistory()).length, 3);
});

test("una escritura de audit fallida no envenena la siguiente operación independiente", async () => {
  const records = [];
  let failRead = true;
  const storage = {
    async read() {
      if (failRead) {
        failRead = false;
        throw new Error("audit storage unavailable");
      }
      return structuredClone(records);
    },
    async write(next) {
      records.splice(0, records.length, ...structuredClone(next));
    }
  };
  const audit = new TradeAuditService({ storage });
  const terminal = id => ({
    id,
    state: "CANCELLED",
    revision: 1,
    participants: {
      participantA: participant("participantA", "Actor.a"),
      participantB: participant("participantB", "Actor.b")
    },
    publicOffers: { participantA: [], participantB: [] },
    confirmations: {},
    createdAt: Date.now(),
    cancelledAt: Date.now()
  });
  await assert.rejects(audit.persistTerminal(terminal("audit-failed")), /unavailable/);
  const recovered = await audit.persistTerminal(terminal("audit-next"));
  assert.equal(recovered.sessionId, "audit-next");
  assert.equal(records.length, 1);
});

function makeTransferActor(id, quantity = null) {
  const items = [];
  items.get = itemId => items.find(item => item.id === itemId) ?? null;
  const actor = {
    id,
    uuid: `Actor.${id}`,
    items,
    failDebit: false,
    failRollbackDelete: false,
    async createEmbeddedDocuments(_type, data) {
      return data.map(source => {
        const item = {
          id: `created-${++nextId}`,
          uuid: `${actor.uuid}.Item.created-${nextId}`,
          name: source.name,
          type: "objeto",
          parent: actor,
          flags: structuredClone(source.flags ?? {}),
          system: structuredClone(source.system),
          toObject() { return structuredClone(source); }
        };
        items.push(item);
        return item;
      });
    },
    async updateEmbeddedDocuments(_type, updates) {
      if (actor.failDebit) throw new Error("debit-failed");
      for (const update of updates) items.get(update._id).system.cantidad = update["system.cantidad"];
    },
    async deleteEmbeddedDocuments(_type, ids, options = {}) {
      if (options.mtrolTradeRollback && actor.failRollbackDelete) throw new Error("rollback-delete-failed");
      for (const itemId of ids) {
        const index = items.findIndex(item => item.id === itemId);
        if (index >= 0) items.splice(index, 1);
      }
    }
  };
  if (quantity !== null) {
    const item = {
      id: "source",
      uuid: `${actor.uuid}.Item.source`,
      name: "Stack",
      img: "stack.webp",
      type: "objeto",
      parent: actor,
      flags: {},
      system: { cantidad: quantity, tipoObjeto: "general", equipado: false, slot: "", peso: 1 },
      toObject() { return { _id: this.id, name: this.name, type: this.type, system: structuredClone(this.system) }; }
    };
    items.push(item);
  }
  return actor;
}

test("F5 mid-commit completa credit existente y debit faltante sin dupe", async () => {
  const source = makeTransferActor("source", 10);
  const target = makeTransferActor("target");
  const documents = new Map([[source.uuid, source], [target.uuid, target]]);
  globalThis.fromUuid = async uuid => documents.get(uuid) ?? null;
  const sourceItem = source.items.get("source");
  const session = {
    id: "trade-recovery",
    state: "READY",
    revision: 1,
    participants: {
      participantA: { actorUuid: source.uuid, userId: "a" },
      participantB: { actorUuid: target.uuid, userId: "b" }
    },
    offers: {
      participantA: [{ itemUuid: sourceItem.uuid, itemId: sourceItem.id, quantity: 3 }],
      participantB: []
    },
    confirmations: {
      participantA: { confirmed: true, revision: 1 },
      participantB: { confirmed: true, revision: 1 }
    },
    reservations: [{
      sessionId: "trade-recovery",
      participantKey: "participantA",
      actorUuid: source.uuid,
      itemUuid: sourceItem.uuid,
      itemId: sourceItem.id,
      quantity: 3
    }]
  };
  const plan = await prepareTradeTransferPlan({
    session,
    executionId: "trade-recovery-tx",
    resolveActor: uuid => documents.get(uuid)
  });
  source.failDebit = true;
  target.failRollbackDelete = true;
  const first = new TradeTransferCoordinator();
  const error = await first.executePlan(plan).catch(value => value);
  assert.equal(error.transactionRolledBack, false);
  assert.equal(target.items.length, 1);
  source.failDebit = false;
  target.failRollbackDelete = false;
  const recovered = await new TradeTransferCoordinator().recoverExecution("trade-recovery-tx");
  assert.equal(recovered.recovered, true);
  assert.equal(source.items.get("source").system.cantidad, 7);
  assert.equal(target.items.length, 1);
});
