import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  deferred,
  delay,
  metricView,
  profileTasks,
  waitUntil
} from "./helpers/profiling-harness.mjs";

globalThis.foundry = { utils: {
  deepClone: value => value === undefined ? undefined : structuredClone(value),
  randomID: (() => { let id = 0; return () => `stress-${++id}`; })()
} };
globalThis.ui = { notifications: { warn() {}, error() {}, info() {} } };
globalThis.Hooks = { callAll() {}, on() {}, once() {} };

const gm = { id: "gm", isGM: true, active: true };
const player = { id: "player", isGM: false, active: true };
const emitted = [];
globalThis.game = {
  user: player,
  users: new Map([[gm.id, gm], [player.id, player]]),
  actors: new Map(),
  combats: new Map(),
  combat: null,
  socket: { emit(_namespace, payload) { emitted.push(payload); } }
};

const { ReceiptStore } = await import("../scripts/runtime/receipt-store.js");
const { TransactionCoordinator } = await import("../scripts/runtime/transaction-coordinator.js");
const { CommandRegistry } = await import("../scripts/runtime/command-registry.js");
const {
  ActorRuntimeRepository,
  NON_COMBAT_RECEIPT_MAX_COUNT
} = await import("../scripts/runtime/actor-runtime-repository.js");
const { MtrolLogger } = await import("../scripts/utils/logger.js");
const {
  requestPrimaryGM,
  handleSocketResponse
} = await import("../scripts/core/socket-requests.js");
const { TradeSessionStore } = await import("../scripts/trade/trade-session-service.js");
const { TradeAuditService } = await import("../scripts/trade/trade-audit-service.js");

class ProfileRepository {
  constructor() {
    this.states = new Map();
    this.queues = new Map();
    this.peakQueueKeys = 0;
  }

  key(target) {
    return target?.uuid ?? target?.id ?? String(target);
  }

  read(target) {
    const value = this.states.get(this.key(target));
    return value ? structuredClone(value) : { revision: 0, receipts: {} };
  }

  async mutate(target, mutator) {
    const key = this.key(target);
    const previous = this.queues.get(key) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      const draft = this.read(target);
      const value = await mutator(draft, { revision: draft.revision ?? 0 });
      draft.revision = Number(draft.revision ?? 0) + 1;
      this.states.set(key, structuredClone(draft));
      return { runtime: structuredClone(draft), value, attempts: 1 };
    });
    this.queues.set(key, operation);
    this.peakQueueKeys = Math.max(this.peakQueueKeys, this.queues.size);
    try {
      return await operation;
    } finally {
      if (this.queues.get(key) === operation) this.queues.delete(key);
    }
  }
}

function foundation() {
  const combatRepository = new ProfileRepository();
  const actorRepository = new ProfileRepository();
  const combatStore = new ReceiptStore({ repository: combatRepository });
  const actorStore = new ReceiptStore({ repository: actorRepository });
  const coordinator = new TransactionCoordinator({
    combatReceiptStore: combatStore,
    actorReceiptStore: actorStore
  });
  return { combatRepository, actorRepository, combatStore, actorStore, coordinator };
}

function actor(id) {
  return { id, uuid: `Actor.${id}` };
}

function executeResource(coordinator, targetActor, index, apply, extra = {}) {
  return coordinator.execute({ actor: targetActor }, {
    transactionId: extra.transactionId ?? `resource-${targetActor.id}-${index}`,
    command: "resource.stress",
    metadata: { actorUuid: targetActor.uuid },
    apply,
    reconcile: extra.reconcile
  });
}

test("TransactionCoordinator: orden, paralelismo por Actor, dedupe y cleanup", async t => {
  const { coordinator, actorRepository } = foundation();
  const sameActor = actor("same");
  const order = [];
  const sameMetric = await profileTasks("transaction.same-actor", Array.from({ length: 100 }, (_, index) =>
    () => executeResource(coordinator, sameActor, index, async () => {
      await delay(1);
      order.push(index);
      return { index };
    })));
  assert.deepEqual(order, Array.from({ length: 100 }, (_, index) => index));
  assert.equal(coordinator.inFlight.size, 0);
  assert.equal(coordinator.operationQueues.size, 0);

  let active = 0;
  let peakActive = 0;
  const distinctMetric = await profileTasks("transaction.distinct-actors", Array.from({ length: 100 }, (_, index) =>
    () => executeResource(coordinator, actor(`parallel-${index}`), index, async () => {
      active += 1;
      peakActive = Math.max(peakActive, active);
      await delay(4);
      active -= 1;
      return { index };
    })));
  assert.ok(peakActive >= 20, `paralelismo insuficiente: ${peakActive}`);
  assert.ok(distinctMetric.totalMs < sameMetric.totalMs);
  assert.equal(coordinator.inFlight.size, 0);
  assert.equal(coordinator.operationQueues.size, 0);
  assert.equal(actorRepository.queues.size, 0);

  let duplicateEffects = 0;
  const duplicateResults = await Promise.all(Array.from({ length: 100 }, () =>
    executeResource(coordinator, actor("duplicate"), 0, async () => {
      duplicateEffects += 1;
      await delay(2);
      return { applied: duplicateEffects };
    }, { transactionId: "resource-duplicate" })));
  assert.equal(duplicateEffects, 1);
  assert.deepEqual(new Set(duplicateResults.map(result => result.applied)), new Set([1]));
  assert.equal(coordinator.inFlight.size, 0);
  assert.equal(coordinator.operationQueues.size, 0);

  t.diagnostic(JSON.stringify(metricView(sameMetric, { peakQueueKeys: 1 })));
  t.diagnostic(JSON.stringify(metricView(distinctMetric, { peakActive, peakQueueKeys: actorRepository.peakQueueKeys })));
});

test("TransactionCoordinator: reject no envenena y recovery concurrente no duplica", async t => {
  const { coordinator, actorStore } = foundation();
  const rejectedActor = actor("reject-safe");
  const failed = executeResource(coordinator, rejectedActor, 0, async () => {
    const error = new Error("synthetic no effects");
    error.transactionNoEffects = true;
    throw error;
  });
  const succeeded = executeResource(coordinator, rejectedActor, 1, async () => ({ ok: true }));
  const settled = await Promise.allSettled([failed, succeeded]);
  assert.equal(settled[0].status, "rejected");
  assert.equal(settled[1].status, "fulfilled");

  const recoveryActor = actor("recovery");
  let applyCount = 0;
  const interrupted = Array.from({ length: 50 }, () => executeResource(
    coordinator,
    recoveryActor,
    0,
    async ({ checkpoint }) => {
      applyCount += 1;
      await checkpoint("effect-intent", { applied: true });
      throw new Error("ambiguous synthetic effect");
    },
    { transactionId: "resource-recovery" }
  ));
  const interruptedSettled = await Promise.allSettled(interrupted);
  assert.equal(applyCount, 1);
  assert.equal(interruptedSettled.filter(result => result.status === "rejected").length, 50);
  assert.equal(actorStore.get(recoveryActor, "resource-recovery").status, "recovery-required");

  let reconcileCount = 0;
  const recovered = await Promise.all(Array.from({ length: 50 }, () => executeResource(
    coordinator,
    recoveryActor,
    0,
    async () => { throw new Error("must not reapply"); },
    {
      transactionId: "resource-recovery",
      reconcile: async () => {
        reconcileCount += 1;
        await delay(1);
        return { resolved: true, result: { recovered: true } };
      }
    }
  )));
  assert.equal(reconcileCount, 1);
  assert.deepEqual(new Set(recovered.map(result => result.recovered)), new Set([true]));
  assert.equal(coordinator.inFlight.size, 0);
  assert.equal(coordinator.operationQueues.size, 0);
  t.diagnostic(JSON.stringify({ operation: "transaction.concurrent-recovery", applyCount, reconcileCount, callers: 50 }));
});

test("CommandRegistry: bursts 10/50/100/250, envelopes y resultado undefined", async t => {
  const registry = new CommandRegistry({ observability: null });
  registry.register("stress.valid", async payload => ({ ok: true, value: payload.value }), {
    idempotent: false,
    scope: "world"
  });
  registry.register("stress.invalid", async () => ({ ok: true }), {
    idempotent: false,
    scope: "world",
    validate: payload => { if (payload.valid !== true) throw new Error("invalid payload"); }
  });
  registry.register("stress.undefined", async () => undefined, { idempotent: false, scope: "world" });
  registry.register("stress.failure", async () => { throw new Error("synthetic failure"); }, {
    idempotent: false,
    scope: "world"
  });
  const context = { isPrimaryGM: true, requestingUserId: "player" };
  for (const size of [10, 50, 100, 250]) {
    const metric = await profileTasks(`command-registry.burst-${size}`, Array.from({ length: size }, (_, index) => () => {
      const commands = ["stress.valid", "stress.invalid", "stress.undefined", "stress.failure"];
      const command = commands[index % commands.length];
      return registry.dispatch({
        command,
        transactionId: `registry-${size}-${index}`,
        payload: { value: index, valid: false }
      }, context);
    }));
    assert.equal(metric.settled.length, size);
    assert.equal(metric.settled.some(result => result.status === "pending"), false);
    t.diagnostic(JSON.stringify(metricView(metric)));
  }
  await assert.rejects(
    registry.dispatch({ command: "stress.undefined", transactionId: "undefined-explicit" }, context),
    error => error.reasonCode === "COMMAND_RESULT_UNDEFINED"
  );
});

test("ReceiptStore: dedupe en ráfaga, 1000 receipts y cleanup in-flight", async t => {
  const repository = new ProfileRepository();
  const store = new ReceiptStore({ repository });
  const target = { id: "combat-stress", uuid: "Combat.combat-stress" };
  let effects = 0;
  const duplicateMetric = await profileTasks("receipt.duplicate-burst", Array.from({ length: 250 }, () => () =>
    store.execute(target, { transactionId: "receipt-duplicate", command: "stress.receipt" }, async () => {
      effects += 1;
      await delay(2);
      return { effects };
    })));
  assert.equal(effects, 1);
  assert.equal(store.inFlight.size, 0);

  const bulkMetric = await profileTasks("receipt.bulk-1000", Array.from({ length: 1000 }, (_, index) => () =>
    store.execute(target, { transactionId: `receipt-${index}`, command: "stress.receipt" }, async () => ({ index }))));
  assert.equal(store.inFlight.size, 0);
  assert.equal(Object.keys(repository.read(target).receipts).length, 1001);
  assert.equal(repository.queues.size, 0);
  t.diagnostic(JSON.stringify(metricView(duplicateMetric, { effects, residualInFlight: store.inFlight.size })));
  t.diagnostic(JSON.stringify(metricView(bulkMetric, {
    peakQueueKeys: repository.peakQueueKeys,
    residualReceipts: Object.keys(repository.read(target).receipts).length
  })));
});

test("movimiento transaccional: misma reserva serializa y reservas distintas progresan", async t => {
  const { coordinator } = foundation();
  const combat = { id: "movement-combat", uuid: "Combat.movement-combat" };
  const run = (transactionId, serializationKey, onApply) => coordinator.execute({ combat }, {
    transactionId,
    command: "movement.commit",
    metadata: { tokenUuid: `Scene.s.Token.${serializationKey}` },
    serializationKey,
    apply: onApply
  });
  const order = [];
  const same = await profileTasks("movement.same-reservation", Array.from({ length: 100 }, (_, index) => () =>
    run(`movement-same-${index}`, "movement:token-a", async () => {
      await delay(1);
      order.push(index);
      return { index };
    })));
  assert.deepEqual(order, Array.from({ length: 100 }, (_, index) => index));

  let active = 0;
  let peakActive = 0;
  const distinct = await profileTasks("movement.distinct-reservations", Array.from({ length: 100 }, (_, index) => () =>
    run(`movement-distinct-${index}`, `movement:token-${index}`, async () => {
      active += 1;
      peakActive = Math.max(peakActive, active);
      await delay(3);
      active -= 1;
      return { index };
    })));
  assert.ok(peakActive >= 20);
  assert.ok(distinct.totalMs < same.totalMs);
  assert.equal(coordinator.inFlight.size, 0);
  assert.equal(coordinator.operationQueues.size, 0);
  t.diagnostic(JSON.stringify(metricView(same)));
  t.diagnostic(JSON.stringify(metricView(distinct, { peakActive })));
});

test("ActorRuntimeRepository: receipts acotados y cache reconstruible observable", async t => {
  const repository = new ActorRuntimeRepository();
  const store = new ReceiptStore({ repository });
  const targetActor = actor("bounded-receipts");
  const metric = await profileTasks("actor-receipts.bulk-1000", Array.from({ length: 1000 }, (_, index) => () =>
    store.execute(targetActor, { transactionId: `actor-receipt-${index}`, command: "resource.stress" }, async () => ({ index }))));
  assert.equal(Object.keys(repository.read(targetActor).receipts).length, NON_COMBAT_RECEIPT_MAX_COUNT);
  assert.equal(repository.mutationQueues.size, 0);
  assert.equal(store.inFlight.size, 0);

  const cacheBefore = repository.cache.size;
  const cacheActors = [];
  for (let index = 0; index < 1000; index += 1) {
    const cacheActor = actor(`cache-${index}`);
    cacheActors.push(cacheActor);
    await repository.mutate(cacheActor, draft => { draft.marker = index; });
  }
  const cachePeak = repository.cache.size;
  assert.equal(cachePeak, 1001);
  assert.equal(repository.mutationQueues.size, 0);
  await Promise.all(cacheActors.map(cacheActor => repository.evict(cacheActor)));
  const cacheAfterLifecycle = repository.cache.size;
  assert.equal(cacheAfterLifecycle, 1);
  t.diagnostic(JSON.stringify(metricView(metric, {
    receiptLimit: NON_COMBAT_RECEIPT_MAX_COUNT,
    residualReceipts: Object.keys(repository.read(targetActor).receipts).length,
    cacheBefore,
    cachePeak,
    cacheAfterLifecycle,
    residualQueues: repository.mutationQueues.size
  })));
});

test("socket burst real completa todas las Promises sin respuestas flotantes", async t => {
  for (const size of [10, 50, 100, 250]) {
    emitted.length = 0;
    const metric = await profileTasks(`socket.request-response-${size}`, Array.from({ length: size }, (_, index) => async () => {
      const response = requestPrimaryGM("mtrolStress", {
        index,
        transactionId: `socket-real-${size}-${index}`
      });
      const request = emitted.at(-1);
      handleSocketResponse({
        action: "mtrolSocketResponse",
        requestId: request.requestId,
        targetUserId: player.id,
        ok: index % 5 !== 0,
        reasonCode: index % 5 === 0 ? "SYNTHETIC_REJECT" : null,
        result: { index }
      }, { senderUserId: gm.id });
      return response;
    }));
    assert.equal(metric.settled.length, size);
    assert.equal(metric.errors, 0);
    assert.equal(emitted.length, size);
    // Duplicate/late responses are safely ignored and cannot settle twice.
    for (const request of [...emitted]) {
      assert.equal(handleSocketResponse({
        action: "mtrolSocketResponse", requestId: request.requestId,
        targetUserId: player.id, ok: true
      }, { senderUserId: gm.id }), true);
    }
    t.diagnostic(JSON.stringify(metricView(metric, { unresolved: 0 })));
  }
});

test("head-of-line: misma clave espera y Actor independiente progresa", async t => {
  const { coordinator } = foundation();
  const gate = deferred();
  let sameCompleted = false;
  let otherCompleted = false;
  const slow = executeResource(coordinator, actor("hol-a"), 0, async () => {
    await gate.promise;
    return { slow: true };
  });
  assert.equal(await waitUntil(() => coordinator.operationQueues.size === 1), true);
  const same = executeResource(coordinator, actor("hol-a"), 1, async () => ({ same: true }))
    .then(result => { sameCompleted = true; return result; });
  const other = executeResource(coordinator, actor("hol-b"), 0, async () => ({ other: true }))
    .then(result => { otherCompleted = true; return result; });
  assert.equal(await waitUntil(() => otherCompleted), true);
  assert.equal(sameCompleted, false);
  gate.resolve();
  await Promise.all([slow, same, other]);
  assert.equal(sameCompleted, true);
  assert.equal(coordinator.operationQueues.size, 0);
  t.diagnostic(JSON.stringify({ operation: "transaction.hol", sameKeyWaited: true, independentKeyProgressed: true }));
});

test("TradeSessionStore exhibe head-of-line global entre sesiones independientes", async t => {
  const gate = deferred();
  let mutateCalls = 0;
  const repository = {
    target: { id: "trade-runtime" },
    async mutate(_target, mutator) {
      mutateCalls += 1;
      if (mutateCalls === 1) await gate.promise;
      const draft = { sessions: {}, operationReceipts: {}, authority: {}, recovery: {} };
      const value = await mutator(draft);
      return { runtime: draft, value };
    }
  };
  let ids = 0;
  const store = new TradeSessionStore({ idFactory: () => `trade-stress-${++ids}`, repository });
  const participant = (id, side) => ({
    userId: `${side}-${id}`,
    actorUuid: `Actor.${side}-${id}`,
    actorName: `${side}-${id}`,
    tokenUuid: `Scene.s.Token.${side}-${id}`
  });
  const create = id => store.createSession({
    participantA: participant(id, "a"),
    participantB: participant(id, "b"),
    authority: { gmUserId: "gm", epoch: "epoch" },
    operationId: `trade-operation-${id}`
  });
  let secondCompleted = false;
  const first = create(1);
  assert.equal(await waitUntil(() => mutateCalls === 1), true);
  const second = create(2).then(result => { secondCompleted = true; return result; });
  await delay(5);
  assert.equal(mutateCalls, 1);
  assert.equal(secondCompleted, false);
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(mutateCalls, 2);
  t.diagnostic(JSON.stringify({
    operation: "trade.hol-independent-sessions",
    globalSerializationObserved: true,
    secondEnteredPersistenceBeforeRelease: false
  }));
});

test("Trade audit queue: latencias, fallo aislado y continuidad posterior", async t => {
  const previousUser = game.user;
  game.user = gm;
  try {
    const records = [];
    let writes = 0;
    const storage = {
      async read() { return structuredClone(records); },
      async write(next) {
        writes += 1;
        await delay(1);
        if (writes === 1) throw new Error("synthetic audit failure");
        records.splice(0, records.length, ...structuredClone(next));
      }
    };
    const audit = new TradeAuditService({ storage });
    const terminal = index => ({
      id: `audit-${index}`,
      state: "CANCELLED",
      revision: 1,
      participants: {
        participantA: { userId: `a-${index}`, actorUuid: `Actor.a-${index}`, actorName: `a-${index}` },
        participantB: { userId: `b-${index}`, actorUuid: `Actor.b-${index}`, actorName: `b-${index}` }
      },
      publicOffers: { participantA: [], participantB: [] },
      confirmations: {},
      createdAt: Date.now(),
      cancelledAt: Date.now()
    });
    const metric = await profileTasks("trade.audit-queue", Array.from({ length: 100 }, (_, index) => () =>
      audit.persistTerminal(terminal(index))));
    assert.equal(metric.errors, 1);
    assert.equal(records.length, 99);
    assert.equal((await audit.persistTerminal(terminal("after-failure"))).sessionId, "audit-after-failure");
    t.diagnostic(JSON.stringify(metricView(metric, {
      failedWrites: 1,
      successfulWrites: 99,
      subsequentOperationSucceeded: true
    })));
  } finally {
    game.user = previousUser;
  }
});

test("logger dedupe: separación de keys, sanitización y retención lazy", t => {
  const entries = [];
  const sink = { warn: (...args) => entries.push(args), error: (...args) => entries.push(args), log() {} };
  const logger = new MtrolLogger({ level: "warn", sink });
  const originalNow = Date.now;
  // Date.now() is epoch-based in production; start beyond every dedupe window.
  let now = 100000;
  Date.now = () => now;
  try {
    const document = { id: "actor", uuid: "Actor.actor", documentName: "Actor", update() {} };
    for (let index = 0; index < 1000; index += 1) {
      logger.warnOnce("STRESS", "burst", { transactionId: `tx-${index}`, actor: document }, {
        key: `tx-${index}`,
        windowMs: 5000
      });
    }
    assert.equal(entries.length, 1000);
    assert.equal(logger.recentKeys.size, 1000);
    assert.deepEqual(entries[0][1].actor, { uuid: "Actor.actor", id: "actor", documentName: "Actor" });
    logger.warnOnce("STRESS", "burst", { transactionId: "tx-0" }, { key: "tx-0", windowMs: 5000 });
    assert.equal(entries.length, 1000);
    now += 6000;
    logger.warnOnce("STRESS", "after-window", {}, { key: "after-window", windowMs: 5000 });
    const residualAfterWindow = logger.recentKeys.size;
    assert.equal(residualAfterWindow, 1);
    now += 60000;
    logger.warnOnce("STRESS", "after-retention", {}, { key: "after-retention", windowMs: 5000 });
    const residualAfterRetention = logger.recentKeys.size;
    assert.equal(residualAfterRetention, 1);
    t.diagnostic(JSON.stringify({
      operation: "logger.dedupe-burst",
      emitted: entries.length,
      peakKeys: 1000,
      residualAfterWindow,
      residualAfterRetention,
      documentRetainedInSink: false
    }));
  } finally {
    Date.now = originalNow;
  }
});
