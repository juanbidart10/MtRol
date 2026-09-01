import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { deferred, waitUntil } from "./helpers/profiling-harness.mjs";

globalThis.foundry = { utils: {
  deepClone: value => value === undefined ? undefined : structuredClone(value)
} };
globalThis.game = { actors: new Map() };

const { ActorRuntimeRepository } = await import("../scripts/runtime/actor-runtime-repository.js");

function actor(id) {
  return {
    id,
    uuid: `Actor.${id}`,
    documentName: "Actor",
    flags: { mtrol: {} },
    async setFlag(scope, key, value) {
      this.flags[scope] ??= {};
      this.flags[scope][key] = structuredClone(value);
      return value;
    }
  };
}

test("1000 Actors liberan cache reconstruible por lifecycle sin tocar persistencia", async () => {
  const repository = new ActorRuntimeRepository();
  const actors = Array.from({ length: 1000 }, (_, index) => actor(`evict-${index}`));
  await Promise.all(actors.map((entry, index) => repository.mutate(entry, draft => {
    draft.receipts[`tx-${index}`] = {
      transactionId: `tx-${index}`,
      status: "completed",
      updatedAt: Date.now()
    };
  })));
  assert.equal(repository.cache.size, 1000);
  assert.equal(repository.mutationQueues.size, 0);
  const persistedBefore = structuredClone(actors[0].flags.mtrol.transactionRuntime.receipts);

  await Promise.all(actors.map(entry => repository.evict(entry)));
  assert.equal(repository.cache.size, 0);
  assert.equal(repository.mutationQueues.size, 0);
  assert.deepEqual(actors[0].flags.mtrol.transactionRuntime.receipts, persistedBefore);
});

test("eviction espera in-flight, luego reconstruye cache desde receipts persistentes", async () => {
  const repository = new ActorRuntimeRepository();
  const entry = actor("in-flight");
  await repository.mutate(entry, draft => {
    draft.receipts.persisted = {
      transactionId: "persisted",
      status: "completed",
      updatedAt: Date.now()
    };
    draft.marker = 1;
  });
  const gate = deferred();
  const originalSetFlag = entry.setFlag.bind(entry);
  let block = true;
  entry.setFlag = async (...args) => {
    if (block) await gate.promise;
    return originalSetFlag(...args);
  };
  const mutation = repository.mutate(entry, draft => { draft.marker = 2; });
  assert.equal(await waitUntil(() => repository.mutationQueues.has(entry.uuid)), true);
  let evictionCompleted = false;
  const eviction = repository.evict(entry).then(result => {
    evictionCompleted = true;
    return result;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(evictionCompleted, false);
  assert.equal(repository.cache.has(entry.uuid), true);

  block = false;
  gate.resolve();
  await Promise.all([mutation, eviction]);
  assert.equal(repository.cache.has(entry.uuid), false);
  assert.equal(entry.flags.mtrol.transactionRuntime.marker, 2);
  assert.equal(entry.flags.mtrol.transactionRuntime.receipts.persisted.status, "completed");

  await repository.mutate(entry, draft => { draft.marker = 3; });
  assert.equal(repository.cache.has(entry.uuid), true);
  assert.equal(repository.read(entry).marker, 3);
  assert.equal(repository.read(entry).receipts.persisted.status, "completed");
});

test("lifecycle usa deleteActor y sólo evicta synthetic Actor en deleteToken", async () => {
  const source = await readFile(new URL("../scripts/core/hooks.js", import.meta.url), "utf8");
  assert.match(source, /actorRuntimeRepository\.evict\(actor\)/);
  assert.match(source, /Hooks\.on\("deleteActor", actor => evictActorRuntimeCache/);
  assert.match(source, /Hooks\.on\("deleteToken"[\s\S]*if \(!linked\)/);
});
