import test from "node:test";
import assert from "node:assert/strict";

import {
  ReceiptFailedError,
  ReceiptIdentityConflictError,
  ReceiptInProgressError,
  ReceiptStore,
  createReceiptFingerprint,
  setReceiptInRuntime
} from "../scripts/runtime/receipt-store.js";
import { CommandRegistry } from "../scripts/runtime/command-registry.js";
import {
  GROUND_RECEIPT_FLAG,
  GroundSceneReceiptRepository,
  createGroundReceiptScope
} from "../scripts/ground/ground-receipt-scope.js";

function clone(value) {
  return structuredClone(value);
}

class MemoryRepository {
  constructor(runtime = { revision: 0, receipts: {} }) {
    this.runtime = clone(runtime);
    this.target = { id: "memory" };
  }

  read() {
    return clone(this.runtime);
  }

  async mutate(_target, mutator) {
    const draft = this.read();
    const value = await mutator(draft);
    draft.revision += 1;
    this.runtime = clone(draft);
    return { runtime: this.read(), value };
  }
}

function primaryContext() {
  return { isPrimaryGM: true, requestingUserId: "gm" };
}

function envelope(command, transactionId, payload) {
  return { command, transactionId, payload };
}

test("canonical receipt fingerprint ignores object key insertion order", async () => {
  const first = await createReceiptFingerprint({ b: 2, a: { y: 2, x: 1 } });
  const second = await createReceiptFingerprint({ a: { x: 1, y: 2 }, b: 2 });
  assert.equal(first, second);
  assert.match(first, /^sha256:[0-9a-f]{64}$/);
});

test("canonical receipt fingerprint changes for semantically different payload", async () => {
  assert.notEqual(
    await createReceiptFingerprint({ quantity: 1, entries: ["a", "b"] }),
    await createReceiptFingerprint({ quantity: 2, entries: ["a", "b"] })
  );
  assert.notEqual(
    await createReceiptFingerprint({ entries: ["a", "b"] }),
    await createReceiptFingerprint({ entries: ["b", "a"] })
  );
});

test("same transaction command and fingerprint replays exactly once", async () => {
  const repository = new MemoryRepository();
  const registry = new CommandRegistry({
    receiptStore: new ReceiptStore({ repository }),
    observability: null
  });
  let calls = 0;
  registry.register("ground.test", async payload => ({ value: payload.value, calls: ++calls }), {
    scope: "world"
  });
  const request = envelope("ground.test", "same", { value: 1 });

  const first = await registry.dispatch(request, primaryContext());
  const replay = await registry.dispatch(request, primaryContext());

  assert.deepEqual(replay, first);
  assert.equal(calls, 1);
  assert.match(repository.runtime.receipts.rk1_73616d65.fingerprint, /^sha256:/);
});

test("same transaction with a different command rejects identity conflict", async () => {
  const repository = new MemoryRepository();
  const registry = new CommandRegistry({
    receiptStore: new ReceiptStore({ repository }), observability: null
  });
  registry.register("ground.first", async () => ({ command: "first" }), { scope: "world" });
  registry.register("ground.second", async () => ({ command: "second" }), { scope: "world" });
  await registry.dispatch(envelope("ground.first", "collision", {}), primaryContext());

  await assert.rejects(
    registry.dispatch(envelope("ground.second", "collision", {}), primaryContext()),
    error => error instanceof ReceiptIdentityConflictError &&
      error.reasonCode === "RECEIPT_IDENTITY_CONFLICT"
  );
});

test("same transaction and command with a different payload rejects identity conflict", async () => {
  const repository = new MemoryRepository();
  const registry = new CommandRegistry({
    receiptStore: new ReceiptStore({ repository }), observability: null
  });
  registry.register("ground.change", async payload => ({ value: payload.value }), { scope: "world" });
  await registry.dispatch(envelope("ground.change", "payload-collision", { value: 1 }), primaryContext());

  await assert.rejects(
    registry.dispatch(envelope("ground.change", "payload-collision", { value: 2 }), primaryContext()),
    ReceiptIdentityConflictError
  );
});

test("concurrent identical command shares execution", async () => {
  const repository = new MemoryRepository();
  const registry = new CommandRegistry({
    receiptStore: new ReceiptStore({ repository }), observability: null
  });
  let release;
  let calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  registry.register("ground.concurrent", async () => {
    calls += 1;
    await gate;
    return { calls };
  }, { scope: "world" });
  const request = envelope("ground.concurrent", "concurrent", { sceneId: "scene" });
  const first = registry.dispatch(request, primaryContext());
  const second = registry.dispatch(request, primaryContext());
  release();

  assert.deepEqual(await second, await first);
  assert.equal(calls, 1);
});

test("failed and processing receipts preserve their previous semantics", async () => {
  const failedRepository = new MemoryRepository();
  const failed = new ReceiptStore({ repository: failedRepository });
  await assert.rejects(failed.execute(failedRepository.target, {
    transactionId: "failed", command: "ground.test", fingerprint: "sha256:failed"
  }, async () => { throw new Error("persisted failure"); }), /persisted failure/);
  await assert.rejects(failed.execute(failedRepository.target, {
    transactionId: "failed", command: "ground.test", fingerprint: "sha256:failed"
  }, async () => null), ReceiptFailedError);

  const processingRuntime = { revision: 0, receipts: {} };
  setReceiptInRuntime(processingRuntime, "processing", {
    transactionId: "processing", command: "ground.test", fingerprint: "sha256:processing",
    status: "processing"
  });
  const processingRepository = new MemoryRepository(processingRuntime);
  await assert.rejects(new ReceiptStore({ repository: processingRepository }).execute(
    processingRepository.target,
    { transactionId: "processing", command: "ground.test", fingerprint: "sha256:processing" },
    async () => null
  ), ReceiptInProgressError);
});

test("legacy receipt replays only for its historical command", async () => {
  const runtime = { revision: 0, receipts: {} };
  setReceiptInRuntime(runtime, "legacy", {
    transactionId: "legacy", command: "ground.test", status: "completed", result: { legacy: true }
  });
  const repository = new MemoryRepository(runtime);
  const store = new ReceiptStore({ repository });

  assert.deepEqual(await store.execute(repository.target, {
    transactionId: "legacy", command: "ground.test", fingerprint: "sha256:new"
  }, async () => ({ legacy: false })), { legacy: true });
  await assert.rejects(store.execute(repository.target, {
    transactionId: "legacy", command: "ground.other", fingerprint: "sha256:new"
  }, async () => null), ReceiptIdentityConflictError);
});

function createScene(id = "scene-a") {
  return {
    id,
    flags: {},
    getFlag(scope, key) { return this.flags?.[scope]?.[key] ?? null; },
    async setFlag(scope, key, value) {
      this.flags[scope] ??= {};
      this.flags[scope][key] = clone(value);
      return this;
    }
  };
}

test("Ground receipt scope is Scene durable across repository reload", async () => {
  const scene = createScene();
  const resolveScene = sceneId => sceneId === scene.id ? scene : null;
  const firstRepository = new GroundSceneReceiptRepository({ resolveScene });
  const firstStore = new ReceiptStore({ repository: firstRepository });
  const scope = createGroundReceiptScope(scene.id, { repository: firstRepository });
  let effects = 0;
  const identity = {
    transactionId: "ground-reconcile:one",
    command: "ground.reconcile",
    fingerprint: await createReceiptFingerprint({ sceneId: scene.id, groundId: "ground:world:abcdefghijklmnop" })
  };
  const first = await firstStore.execute(scope, identity, async () => ({ ok: true, changed: ++effects === 1 }));

  const reloadedRepository = new GroundSceneReceiptRepository({ resolveScene });
  const reloadedStore = new ReceiptStore({ repository: reloadedRepository });
  const replay = await reloadedStore.execute(
    createGroundReceiptScope(scene.id, { repository: reloadedRepository }),
    identity,
    async () => ({ ok: false, changed: ++effects === 1 })
  );

  assert.deepEqual(replay, first);
  assert.equal(effects, 1);
  assert.equal(scene.flags.mtrol[GROUND_RECEIPT_FLAG].sceneId, scene.id);
  const serialized = JSON.stringify(scene.flags.mtrol[GROUND_RECEIPT_FLAG]);
  assert.doesNotMatch(serialized, /itemSnapshot|provenance|effects|system/);
});
