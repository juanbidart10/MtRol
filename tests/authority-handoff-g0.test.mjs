import test from "node:test";
import assert from "node:assert/strict";
import { AuthorityService } from "../scripts/core/authority-service.js";
import { CommandRegistry } from "../scripts/runtime/command-registry.js";
import { ReceiptStore, createReceiptScope } from "../scripts/runtime/receipt-store.js";
import { TransactionCoordinator } from "../scripts/runtime/transaction-coordinator.js";
import { TradeRuntimeRepository, createDefaultTradeRuntime } from "../scripts/trade/trade-runtime-repository.js";

function gate() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test("G0 characterization: GM anterior puede escribir después de recovery del nuevo GM", async () => {
  // Two client instances of the existing classes; one shared durable setting.
  // This proves the client runtime gap, not a live Foundry server race.
  const originalGame = globalThis.game;
  let persisted = createDefaultTradeRuntime();
  const users = [{ id: "a", isGM: true, active: true }, { id: "b", isGM: true, active: true }];
  globalThis.game = { settings: {
    get: () => structuredClone(persisted),
    set: async (_namespace, _key, value) => { persisted = structuredClone(value); }
  } };
  const paused = gate();
  const resume = gate();
  const writes = [];
  function client(user) {
    const authority = new AuthorityService({ getUsers: () => users, getCurrentUser: () => user });
    const repository = new TradeRuntimeRepository();
    const store = new ReceiptStore({ repository });
    const coordinator = new TransactionCoordinator({ combatReceiptStore: store });
    const scope = { receiptScope: createReceiptScope(repository, repository.target, "handoff-test") };
    const registry = new CommandRegistry({ observability: null });
    registry.register("audit.transfer", () => coordinator.execute(scope, {
      transactionId: "same-operation", command: "audit.transfer", serializationKey: "same-item",
      prepare: () => ({ authorityEpoch: "a-epoch" }),
      apply: async () => {
        paused.resolve();
        await resume.promise;
        writes.push(user.id);
        return { writer: user.id };
      },
      reconcile: async () => {
        writes.push(user.id);
        return { resolved: true, result: { writer: user.id } };
      }
    }), { scope: "world", idempotent: false });
    return { authority, registry, repository };
  }
  const a = client(users[0]);
  const b = client(users[1]);
  const dispatch = client => client.registry.dispatch({
    command: "audit.transfer", transactionId: "same-operation", payload: {}
  }, { requestingUserId: "owner", isPrimaryGM: client.authority.isPrimaryGM() });
  let pending;
  try {
    pending = dispatch(a);
    await paused.promise;
    users[0].active = false;
    await b.repository.mutate(b.repository.target, draft => {
      draft.authority = { gmUserId: "b", epoch: "b-epoch" };
    });
    assert.equal(a.authority.isPrimaryGM(), false);
    assert.equal(b.authority.isPrimaryGM(), true);
    await dispatch(b);
    assert.deepEqual(writes, ["b"]);
    resume.resolve();
    await pending;
    assert.deepEqual(writes, ["b", "a"], "epoch persistido y misma clave no cercan al escritor antiguo");
  } finally {
    resume.resolve();
    if (pending) await pending;
    globalThis.game = originalGame;
  }
});

test("G0 fencing local bloquea el siguiente efecto y checkpoint tras handoff", async () => {
  const originalGame = globalThis.game;
  let persisted = createDefaultTradeRuntime();
  const users = [{ id: "a", isGM: true, active: true }, { id: "b", isGM: true, active: false }];
  globalThis.game = { settings: { get: () => structuredClone(persisted), set: async (_n, _k, v) => { persisted = structuredClone(v); } } };
  const authority = new AuthorityService({ getUsers: () => users, getCurrentUser: () => users[0] });
  const repository = new TradeRuntimeRepository();
  const store = new ReceiptStore({ repository });
  const coordinator = new TransactionCoordinator({ combatReceiptStore: store, authority });
  const scope = { receiptScope: createReceiptScope(repository, repository.target, "fence-test") };
  const context = authority.createWriteContext();
  const effects = [];
  try {
    const result = await coordinator.execute(scope, {
      transactionId: "fence-tx", command: "ground.drop", authorityContext: context,
      apply: async ({ assertAuthority, checkpoint }) => {
        assertAuthority(); effects.push("first");
        users[0].active = false; users[1].active = true;
        assertAuthority(); effects.push("forbidden");
        await checkpoint("second");
        return { ok: true };
      }
    }).catch(error => error);
    assert.equal(result.reasonCode, "AUTHORITY_CONTEXT_STALE");
    assert.deepEqual(effects, ["first"]);
    const receipt = store.get(scope.receiptScope, "fence-tx");
    assert.equal(receipt.status, "recovery-required");
    assert.equal(receipt.checkpoints && Object.keys(receipt.checkpoints).length, 0);
  } finally {
    globalThis.game = originalGame;
  }
});

test("G0 fencing local no ejecuta compensación ciega y retry conserva idempotencia", async () => {
  const originalGame = globalThis.game;
  let persisted = createDefaultTradeRuntime();
  const users = [{ id: "a", isGM: true, active: true }, { id: "b", isGM: true, active: false }];
  globalThis.game = { settings: { get: () => structuredClone(persisted), set: async (_n, _k, v) => { persisted = structuredClone(v); } } };
  const authority = new AuthorityService({ getUsers: () => users, getCurrentUser: () => users[0] });
  const repository = new TradeRuntimeRepository();
  const store = new ReceiptStore({ repository });
  const coordinator = new TransactionCoordinator({ combatReceiptStore: store, authority });
  const scope = { receiptScope: createReceiptScope(repository, repository.target, "fence-retry") };
  const context = authority.createWriteContext();
  let compensations = 0;
  try {
    const first = await coordinator.execute(scope, {
      transactionId: "retry-tx", command: "ground.pickup", authorityContext: context,
      apply: async ({ assertAuthority }) => {
        assertAuthority(); users[0].active = false; users[1].active = true; assertAuthority();
        return { ok: true };
      },
      reconcile: async () => { compensations++; return { resolved: false }; }
    }).catch(error => error);
    assert.equal(first.reasonCode, "AUTHORITY_CONTEXT_STALE");
    const retry = await coordinator.execute(scope, {
      transactionId: "retry-tx", command: "ground.pickup", authorityContext: context,
      apply: async () => { throw new Error("must not apply retry"); },
      reconcile: async () => { compensations++; return { resolved: false }; }
    }).catch(error => error);
    assert.equal(retry.reasonCode, "RECOVERY_REQUIRED");
    assert.equal(compensations, 1);
  } finally { globalThis.game = originalGame; }
});

test("G0 una generación antigua no recupera validez tras A→B→A", () => {
  const users = [{ id: "a", isGM: true, active: true }, { id: "b", isGM: true, active: false }];
  const authority = new AuthorityService({ getUsers: () => users, getCurrentUser: () => users[0] });
  const context = authority.createWriteContext();
  users[0].active = false; users[1].active = true;
  assert.throws(() => authority.validateWriteContext(context), error => error.reasonCode === "AUTHORITY_CONTEXT_STALE");
  users[0].active = true; users[1].active = false;
  assert.throws(() => authority.validateWriteContext(context), error => error.reasonCode === "AUTHORITY_CONTEXT_STALE");
});
