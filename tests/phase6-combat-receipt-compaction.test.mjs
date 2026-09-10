import test from "node:test";
import assert from "node:assert/strict";

globalThis.game ??= { combats: new Map(), combat: null };

const {
  COMBAT_RECEIPT_SCHEMA_VERSION,
  RECEIPT_KIND_COMPACT,
  RECEIPT_KIND_FULL,
  ReceiptStore,
  TransactionResultExpiredError,
  canCompactReceipt,
  compactReceipt,
  encodeReceiptKey,
  getReceiptFromRuntime
} = await import("../scripts/runtime/receipt-store.js");
const { RuntimeRepository } = await import("../scripts/runtime/runtime-repository.js");
const { TransactionCoordinator } = await import("../scripts/runtime/transaction-coordinator.js");
const { CommandRegistry } = await import("../scripts/runtime/command-registry.js");

const clone = value => value === undefined ? undefined : structuredClone(value);

class MemoryRepository {
  constructor(runtime = { revision: 0, pendingActions: {}, receipts: {} }) {
    this.runtime = clone(runtime);
    this.queue = Promise.resolve();
  }

  read() {
    return clone(this.runtime);
  }

  async mutate(_target, mutator) {
    const operation = this.queue.catch(() => undefined).then(async () => {
      const draft = clone(this.runtime);
      const value = await mutator(draft, { revision: draft.revision ?? 0 });
      draft.revision = Number(draft.revision ?? 0) + 1;
      this.runtime = draft;
      return { runtime: clone(draft), value: clone(value) };
    });
    this.queue = operation;
    return operation;
  }
}

function fullReceipt(overrides = {}) {
  return {
    receiptSchemaVersion: COMBAT_RECEIPT_SCHEMA_VERSION,
    kind: RECEIPT_KIND_FULL,
    transactionId: "tx-full",
    command: "resource.test",
    pendingActionId: null,
    status: "completed",
    createdAt: 10,
    updatedAt: 20,
    completedAt: 20,
    result: { ok: true, transactionId: "tx-full", changed: true, result: { value: 1 }, reasonCode: null },
    prepared: { large: "x".repeat(1000) },
    checkpoints: { applied: { at: 15, large: "y".repeat(1000) } },
    recoveryReason: "closed",
    ...overrides
  };
}

function encodedReceipts(receipts) {
  return Object.fromEntries(Object.values(receipts).map(receipt =>
    [encodeReceiptKey(receipt.transactionId), receipt]));
}

function target(id = "combat-compaction") {
  return { id, uuid: `Combat.${id}` };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test("active, prepared, applying, applied y recovery-required permanecen FULL", () => {
  for (const status of ["processing", "prepared", "applying", "applied", "recovery-required"]) {
    assert.equal(canCompactReceipt(fullReceipt({ status })), false, status);
  }
});

test("failed ambiguo permanece FULL y sólo failureSafety probado es elegible", () => {
  assert.equal(canCompactReceipt(fullReceipt({ status: "failed", failureSafety: null })), false);
  assert.equal(canCompactReceipt(fullReceipt({ status: "failed", failureSafety: "no-effects" })), true);
  assert.equal(canCompactReceipt(fullReceipt({ status: "failed", failureSafety: "rolled-back" })), true);
});

test("pendingAction abierta o reacción disponible bloquean compaction", () => {
  const receipt = fullReceipt({
    transactionId: "opposition.resolve:pending",
    command: "opposition.resolve",
    pendingActionId: "pending"
  });
  assert.equal(canCompactReceipt(receipt, {
    pendingActions: { pending: { id: "pending", status: "waiting-defense" } }
  }), false);
  assert.equal(canCompactReceipt(receipt, {
    pendingActions: {
      pending: { id: "pending", status: "resolved", terminalHandledAt: 30, reactionMovement: { status: "available" } }
    }
  }), false);
  assert.equal(canCompactReceipt(receipt, {
    pendingActions: {
      pending: { id: "pending", status: "resolved", terminalHandledAt: 30, reactionMovement: { status: "completed" } }
    }
  }), true);
});

test("legacy, corrupto, command desconocido e in-flight permanecen FULL", () => {
  const receipt = fullReceipt();
  assert.equal(canCompactReceipt({ ...receipt, receiptSchemaVersion: undefined, kind: undefined }), false);
  assert.equal(canCompactReceipt({ ...receipt, transactionId: null }), false);
  assert.equal(canCompactReceipt({ ...receipt, command: "unknown.command" }), false);
  assert.equal(canCompactReceipt(receipt, { isTransactionInFlight: () => true }), false);
});

test("COMPACT conserva identidad y replay mínimo pero elimina evidencia pesada cerrada", () => {
  const full = fullReceipt({ actorUuid: "Actor.a", targetActorUuid: "Actor.b", tokenUuid: "Scene.s.Token.t" });
  const compact = compactReceipt(full);
  assert.equal(compact.kind, RECEIPT_KIND_COMPACT);
  assert.equal(compact.receiptSchemaVersion, COMBAT_RECEIPT_SCHEMA_VERSION);
  assert.equal(compact.transactionId, full.transactionId);
  assert.equal(compact.command, full.command);
  assert.deepEqual(compact.result, full.result);
  assert.equal(compact.resultAvailable, true);
  assert.equal(compact.actorUuid, "Actor.a");
  assert.equal(compact.targetActorUuid, "Actor.b");
  assert.equal(compact.tokenUuid, "Scene.s.Token.t");
  assert.equal(compact.prepared, undefined);
  assert.equal(compact.checkpoints, undefined);
  assert.equal(compact.recoveryReason, undefined);
  assert.deepEqual(compactReceipt(compact), compact);
});

test("retry de transacción COMPACT devuelve resultado estable y jamás reaplica", async () => {
  const repository = new MemoryRepository();
  const store = new ReceiptStore({ repository, compactCompletedReceipts: true });
  const combat = target("replay");
  let effects = 0;
  const execute = () => store.execute(combat, {
    transactionId: "resource-replay",
    command: "resource.test"
  }, async () => ({ ok: true, transactionId: "resource-replay", changed: true, result: { effects: ++effects } }));

  const first = await execute();
  const second = await execute();
  assert.deepEqual(second, first);
  assert.equal(effects, 1);
  assert.equal(store.get(combat, "resource-replay").kind, RECEIPT_KIND_COMPACT);
});

test("opposition COMPACT responde TRANSACTION_RESULT_EXPIRED sin fallback ni side effect", async () => {
  const repository = new MemoryRepository({
    revision: 0,
    pendingActions: {
      pending: { id: "pending", status: "resolved", terminalHandledAt: 100, reactionMovement: { status: "completed" } }
    },
    receipts: {}
  });
  const store = new ReceiptStore({ repository, compactCompletedReceipts: true });
  const combat = target("expired");
  let effects = 0;
  const execute = () => store.execute(combat, {
    transactionId: "opposition.resolve:pending",
    command: "opposition.resolve",
    pendingActionId: "pending"
  }, async () => ({ pendingAction: { id: "pending", payload: "x".repeat(5000), effects: ++effects } }));

  await execute();
  const compact = store.get(combat, "opposition.resolve:pending");
  assert.equal(compact.kind, RECEIPT_KIND_COMPACT);
  assert.equal(compact.resultAvailable, false);
  await assert.rejects(execute, error =>
    error instanceof TransactionResultExpiredError &&
    error.reasonCode === "TRANSACTION_RESULT_EXPIRED" &&
    error.ok === false && error.changed === false);
  assert.equal(effects, 1);
});

test("CommandRegistry propaga RESULT_EXPIRED y no invoca handler ni genera otra identidad", async () => {
  const expired = compactReceipt(fullReceipt({
    transactionId: "opposition.resolve:registry",
    command: "opposition.resolve",
    pendingActionId: "registry"
  }));
  const repository = new MemoryRepository({
    revision: 0,
    pendingActions: { registry: { id: "registry", status: "resolved", terminalHandledAt: 1 } },
    receipts: encodedReceipts({ [expired.transactionId]: expired })
  });
  const store = new ReceiptStore({ repository, compactCompletedReceipts: true });
  const registry = new CommandRegistry({ receiptStore: store, observability: null });
  let handlers = 0;
  registry.register("opposition.resolve", async () => ({ handlers: ++handlers }));
  await assert.rejects(() => registry.dispatch({
    command: "opposition.resolve",
    transactionId: expired.transactionId,
    combatId: "registry-combat",
    payload: { pendingActionId: "registry" }
  }, { isPrimaryGM: true, requestingUserId: "gm" }), error =>
    error.reasonCode === "TRANSACTION_RESULT_EXPIRED" && error.changed === false);
  assert.equal(handlers, 0);
  assert.deepEqual(Object.keys(repository.read().receipts), [encodeReceiptKey(expired.transactionId)]);
});

test("transactionId desconocido sigue ejecutándose y se diferencia de uno expirado", async () => {
  const repository = new MemoryRepository({
    revision: 0,
    pendingActions: { old: { id: "old", status: "resolved", terminalHandledAt: 1 } },
    receipts: encodedReceipts({
      old: compactReceipt(fullReceipt({
        transactionId: "old",
        command: "opposition.resolve",
        pendingActionId: "old"
      }))
    })
  });
  const store = new ReceiptStore({ repository, compactCompletedReceipts: true });
  let effects = 0;
  await assert.rejects(() => store.execute(target(), {
    transactionId: "old", command: "opposition.resolve", pendingActionId: "old"
  }, async () => ({ effects: ++effects })), TransactionResultExpiredError);
  const fresh = await store.execute(target(), {
    transactionId: "resource-new", command: "resource.test"
  }, async () => ({ effects: ++effects }));
  assert.equal(fresh.effects, 1);
});

test("execution vs compaction conserva FULL durante in-flight y compacta al terminar", async () => {
  const repository = new MemoryRepository();
  const store = new ReceiptStore({ repository, compactCompletedReceipts: true });
  const gate = deferred();
  const combat = target("in-flight");
  const operation = store.execute(combat, {
    transactionId: "resource-in-flight", command: "resource.test"
  }, async () => {
    await gate.promise;
    return { ok: true };
  });
  while (!store.get(combat, "resource-in-flight")) {
    await new Promise(resolve => setImmediate(resolve));
  }
  const during = await store.compactEligible(combat);
  assert.equal(during.changed, false);
  assert.equal(store.get(combat, "resource-in-flight").kind, RECEIPT_KIND_FULL);
  gate.resolve();
  await operation;
  assert.equal(store.get(combat, "resource-in-flight").kind, RECEIPT_KIND_COMPACT);
});

test("retry vs compaction y dos cleanups concurrentes son idempotentes", async () => {
  const receipt = fullReceipt({ transactionId: "resource-race", result: { stable: true } });
  const repository = new MemoryRepository({ revision: 0, pendingActions: {},
    receipts: encodedReceipts({ "resource-race": receipt }) });
  const store = new ReceiptStore({ repository, compactCompletedReceipts: true });
  let effects = 0;
  const retry = store.execute(target("race"), {
    transactionId: "resource-race", command: "resource.test"
  }, async () => ({ effects: ++effects }));
  const [result] = await Promise.all([
    retry,
    store.compactEligible(target("race")),
    store.compactEligible(target("race"))
  ]);
  assert.deepEqual(result, { stable: true });
  assert.equal(effects, 0);
  assert.equal(store.get(target("race"), "resource-race").kind, RECEIPT_KIND_COMPACT);
});

test("TransactionCoordinator compacta al salir de in-flight y conserva replay exacto", async () => {
  const repository = new MemoryRepository();
  const store = new ReceiptStore({ repository, compactCompletedReceipts: true });
  const coordinator = new TransactionCoordinator({ combatReceiptStore: store, actorReceiptStore: store });
  const combat = target("coordinator");
  let effects = 0;
  const execute = () => coordinator.execute({ combat }, {
    transactionId: "resource-coordinator",
    command: "resource.test",
    metadata: { actorUuid: "Actor.coordinator" },
    apply: async ({ checkpoint }) => {
      await checkpoint("write-intent", { actorUuid: "Actor.coordinator" });
      return { ok: true, transactionId: "resource-coordinator", changed: true, result: { effects: ++effects } };
    }
  });
  const first = await execute();
  const second = await execute();
  assert.deepEqual(second, first);
  assert.equal(effects, 1);
  const receipt = store.get(combat, "resource-coordinator");
  assert.equal(receipt.kind, RECEIPT_KIND_COMPACT);
  assert.equal(receipt.checkpoints, undefined);
});

test("recovery/reconcile concurrentes con compaction convergen sin pérdida ni corrupción", async () => {
  const repository = new MemoryRepository({
    revision: 0,
    pendingActions: {},
    receipts: encodedReceipts({
      recovery: fullReceipt({ transactionId: "recovery", status: "recovery-required" }),
      applied: fullReceipt({ transactionId: "applied", status: "applied", result: { recovered: true } })
    })
  });
  const store = new ReceiptStore({ repository, compactCompletedReceipts: true });
  const combat = target("recovery-race");
  await Promise.all([
    store.compactEligible(combat),
    store.complete(combat, "recovery", { recovered: "manual" }),
    store.complete(combat, "applied", { recovered: true })
  ]);
  await store.compactEligible(combat);
  const runtime = repository.read();
  assert.equal(getReceiptFromRuntime(runtime, "recovery").kind, RECEIPT_KIND_COMPACT);
  assert.equal(getReceiptFromRuntime(runtime, "applied").kind, RECEIPT_KIND_COMPACT);
  assert.deepEqual(getReceiptFromRuntime(runtime, "recovery").result, { recovered: "manual" });
  assert.deepEqual(getReceiptFromRuntime(runtime, "applied").result, { recovered: true });
});

test("recovery y reconcile pendientes nunca se compactan", async () => {
  const receipts = {
    recovery: fullReceipt({ transactionId: "recovery", status: "recovery-required" }),
    applying: fullReceipt({ transactionId: "applying", status: "applying" }),
    applied: fullReceipt({ transactionId: "applied", status: "applied" })
  };
  const repository = new MemoryRepository({ revision: 0, pendingActions: {},
    receipts: encodedReceipts(receipts) });
  const store = new ReceiptStore({ repository, compactCompletedReceipts: true });
  const result = await store.compactEligible(target("recovery"));
  assert.equal(result.changed, false);
  for (const receipt of Object.values(repository.read().receipts)) {
    assert.equal(receipt.kind, RECEIPT_KIND_FULL);
  }
});

test("Combat inactivo, cambio de escena y reload conservan identidad; deleteCombat elimina el scope", () => {
  const runtime = {
    revision: 0,
    pendingActions: {},
    receipts: encodedReceipts({
      full: fullReceipt({ transactionId: "full" }),
      compact: compactReceipt(fullReceipt({ transactionId: "compact" }))
    }),
    recovery: {},
    authority: {}
  };
  const combat = {
    id: "lifecycle",
    uuid: "Combat.lifecycle",
    active: false,
    flags: { mtrol: { runtime: clone(runtime) } },
    getFlag: (_scope, key) => key === "runtime" ? clone(combat.flags.mtrol.runtime) : null
  };
  const previousCombats = game.combats;
  const previousCombat = game.combat;
  const previousScene = game.scenes;
  try {
    game.combats = new Map([[combat.id, combat]]);
    game.combat = null;
    game.scenes = new Map([["other-scene", { id: "other-scene" }]]);
    const beforeReload = new RuntimeRepository().read(combat.id);
    const afterReload = new RuntimeRepository().read(combat.id);
    assert.equal(getReceiptFromRuntime(beforeReload, "full").kind, RECEIPT_KIND_FULL);
    assert.equal(getReceiptFromRuntime(afterReload, "compact").kind, RECEIPT_KIND_COMPACT);
    game.combats.delete(combat.id);
    assert.equal(new RuntimeRepository().read(combat.id), null);
  } finally {
    game.combats = previousCombats;
    game.combat = previousCombat;
    game.scenes = previousScene;
  }
});

test("stress 1000 identidades reduce retención pesada sin reducir keys", async t => {
  const repository = new MemoryRepository();
  const store = new ReceiptStore({ repository, compactCompletedReceipts: false });
  const combat = target("stress-1000");
  await Promise.all(Array.from({ length: 1000 }, (_, index) => store.execute(combat, {
    transactionId: `resource-${index}`,
    command: "resource.stress"
  }, async () => ({ ok: true, transactionId: `resource-${index}`, changed: true, result: { index } }))));
  await repository.mutate(combat, draft => {
    for (const receipt of Object.values(draft.receipts)) {
      receipt.prepared = { payload: "p".repeat(500) };
      receipt.checkpoints = {
        intent: { at: receipt.createdAt, payload: "i".repeat(250) },
        applied: { at: receipt.updatedAt, payload: "a".repeat(250) }
      };
      receipt.recoveryReason = "closed-heavy-metadata";
    }
  });
  const beforeReceipts = repository.read().receipts;
  const beforeBytes = Buffer.byteLength(JSON.stringify(beforeReceipts));
  const peak = {
    keys: Object.keys(beforeReceipts).length,
    full: Object.values(beforeReceipts).filter(receipt => receipt.kind === RECEIPT_KIND_FULL).length,
    compact: 0,
    bytes: beforeBytes
  };
  store.compactCompletedReceipts = true;
  const summary = await store.compactEligible(combat);
  const afterReceipts = repository.read().receipts;
  const afterBytes = Buffer.byteLength(JSON.stringify(afterReceipts));
  const after = {
    keys: Object.keys(afterReceipts).length,
    full: Object.values(afterReceipts).filter(receipt => receipt.kind === RECEIPT_KIND_FULL).length,
    compact: Object.values(afterReceipts).filter(receipt => receipt.kind === RECEIPT_KIND_COMPACT).length,
    checkpoints: Object.values(afterReceipts).filter(receipt => receipt.checkpoints).length,
    bytes: afterBytes
  };
  assert.deepEqual({ peakKeys: peak.keys, afterKeys: after.keys }, { peakKeys: 1000, afterKeys: 1000 });
  assert.equal(peak.full, 1000);
  assert.equal(after.full, 0);
  assert.equal(after.compact, 1000);
  assert.equal(after.checkpoints, 0);
  assert.ok(afterBytes < beforeBytes * 0.5);
  assert.equal(summary.compacted, 1000);
  t.diagnostic(JSON.stringify({
    operation: "combat-receipt-compaction-1000",
    before: { keys: 0, full: 0, compact: 0, bytes: 2 },
    peak,
    after,
    reductionBytes: beforeBytes - afterBytes,
    reductionPercent: Number((((beforeBytes - afterBytes) / beforeBytes) * 100).toFixed(2))
  }));
});
