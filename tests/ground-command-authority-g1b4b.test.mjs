import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { AuthorityService } from "../scripts/core/authority-service.js";
import { CommandRegistry } from "../scripts/runtime/command-registry.js";
import { ReceiptIdentityConflictError, ReceiptStore } from "../scripts/runtime/receipt-store.js";
import {
  GROUND_AUTHORITY_FLAG,
  GROUND_PUBLIC_FLAG,
  GroundPersistencePrimitive,
  GroundSceneFlagStorage
} from "../scripts/ground/ground-repository.js";
import { GroundLifecycleService } from "../scripts/ground/ground-lifecycle-service.js";
import { GroundReconciliationService } from "../scripts/ground/ground-reconciliation-service.js";
import { GroundSceneReceiptRepository, createGroundReceiptScope } from "../scripts/ground/ground-receipt-scope.js";
import { createItemTransferSnapshot } from "../scripts/items/item-transfer-data.js";
import {
  GROUND_COMMAND,
  GROUND_SOCKET_ACTION,
  dispatchGroundSocketCommand,
  getGroundCommandForSocketAction,
  registerGroundCommands
} from "../scripts/runtime/ground-commands.js";

const GROUND_ID = "ground:world-one:AbCdEfGhIjKlMnOpQrStUvWx";

function clone(value) { return structuredClone(value); }

class FakeScene {
  constructor(id = "scene-a") {
    this.id = id;
    this.flags = {};
    this.writes = [];
  }
  getFlag(scope, key) { return this.flags[scope]?.[key] ?? null; }
  async setFlag(scope, key, value) {
    this.flags[scope] ??= {};
    this.flags[scope][key] = clone(value);
    this.writes.push(key);
    return this;
  }
}

class MemoryRepository {
  constructor() { this.runtime = { revision: 0, receipts: {} }; this.target = { id: "unused" }; }
  read() { return clone(this.runtime); }
  async mutate(_target, mutator) {
    const draft = this.read();
    const value = await mutator(draft);
    draft.revision += 1;
    this.runtime = clone(draft);
    return { runtime: this.read(), value };
  }
}

function snapshotFixture() {
  return createItemTransferSnapshot({
    uuid: "Actor.source.Item.source-item",
    toObject: () => ({
      _id: "source-item", name: "Objeto secreto", type: "objeto", img: "item.webp",
      system: { cantidad: 2, secret: "never-return" }, flags: { mtrol: { private: true } },
      effects: [{ _id: "effect", name: "Private" }]
    })
  });
}

function createInput() {
  return {
    worldId: "world-one", sceneId: "scene-a", position: { x: 10, y: 20 },
    visibility: "HIDDEN", pickupEnabled: true,
    appearance: { mode: "GENERIC", img: "systems/mtrol/assets/item.svg" },
    quantity: 1, itemSnapshot: snapshotFixture(),
    provenance: {
      sourceActorUuid: "Actor.source", sourceItemUuid: "Actor.source.Item.source-item",
      createdBy: "gm-a", createdAt: 1000, operationId: "create-ground"
    }
  };
}

function usersFixture() {
  const users = [
    { id: "gm-a", isGM: true, active: true },
    { id: "gm-b", isGM: true, active: false },
    { id: "player", isGM: false, active: true }
  ];
  users.get = id => users.find(user => user.id === id) ?? null;
  return users;
}

async function fixture({ authority = null } = {}) {
  const scene = new FakeScene();
  const resolveScene = id => id === scene.id ? scene : null;
  const repository = new GroundPersistencePrimitive({
    publicStorage: new GroundSceneFlagStorage({ flagKey: GROUND_PUBLIC_FLAG, recordKind: "public", resolveScene }),
    authorityStorage: new GroundSceneFlagStorage({ flagKey: GROUND_AUTHORITY_FLAG, recordKind: "authority", resolveScene })
  });
  const lifecycle = new GroundLifecycleService({ repository, idFactory: () => GROUND_ID });
  const reconciliation = new GroundReconciliationService({ repository });
  const receiptRepository = new GroundSceneReceiptRepository({ resolveScene });
  const receiptStore = new ReceiptStore({ repository: new MemoryRepository() });
  const registry = new CommandRegistry({ receiptStore, observability: null });
  const users = usersFixture();
  const authorityService = authority ?? {
    resolveUser: id => users.get(id),
    createWriteContext: () => ({ authorityUserId: "gm-a", generation: "1:gm-a" }),
    validateWriteContext: () => true,
    isPrimaryGM: () => true
  };
  const dependencies = {
    authorityService, repository, reconciliation, resolveScene,
    createReceiptTarget: sceneId => createGroundReceiptScope(sceneId, { repository: receiptRepository }),
    logger: { warn() {}, error() {} }
  };
  registerGroundCommands(registry, dependencies);
  return { scene, repository, lifecycle, reconciliation, receiptRepository, receiptStore, registry, users, authorityService, dependencies };
}

async function makeRepairable(fx) {
  await fx.lifecycle.createPendingGround(createInput());
  await fx.lifecycle.activateGround("scene-a", GROUND_ID, { transactionId: "activate" });
  const envelope = clone(fx.scene.flags.mtrol[GROUND_PUBLIC_FLAG]);
  delete envelope.records[GROUND_ID];
  envelope.revision += 1;
  fx.scene.flags.mtrol[GROUND_PUBLIC_FLAG] = envelope;
  return fx.reconciliation.inspectGroundRecovery("scene-a", GROUND_ID).repairPlan;
}

const gmContext = () => ({ isPrimaryGM: true, requestingUserId: "gm-a" });
const playerContext = () => ({ isPrimaryGM: true, requestingUserId: "player" });
const inspectEnvelope = payload => ({ command: GROUND_COMMAND.INSPECT, transactionId: "inspect", payload });
const reconcileEnvelope = (transactionId, repairPlan, extra = {}) => ({
  command: GROUND_COMMAND.RECONCILE, transactionId,
  payload: { sceneId: "scene-a", groundId: GROUND_ID, repairPlan, ...extra }
});

test("G1B.4B registers only ground.inspect and ground.reconcile on the existing registry", async () => {
  const fx = await fixture();
  assert.equal(fx.registry.has("ground.inspect"), true);
  assert.equal(fx.registry.has("ground.reconcile"), true);
  assert.deepEqual([...fx.registry.handlers.keys()].sort(), ["ground.inspect", "ground.reconcile"]);
  assert.equal(fx.registry.handlers.get("ground.inspect").idempotent, false);
  assert.equal(fx.registry.handlers.get("ground.reconcile").idempotent, true);
  assert.equal(fx.registry.handlers.get("ground.reconcile").scope, "world");
});

test("Player is rejected from inspect and reconcile with stable GM-only reason", async () => {
  const fx = await fixture();
  await assert.rejects(fx.registry.dispatch(inspectEnvelope({ sceneId: "scene-a", groundId: GROUND_ID }), playerContext()),
    error => error.reasonCode === "GROUND_GM_REQUIRED");
  await assert.rejects(fx.registry.dispatch(reconcileEnvelope("player-reconcile", {}), playerContext()),
    error => error.reasonCode === "GROUND_GM_REQUIRED");
});

test("payload requestingUserId cannot elevate the authenticated Player", async () => {
  const fx = await fixture();
  await assert.rejects(fx.registry.dispatch(inspectEnvelope({
    sceneId: "scene-a", groundId: GROUND_ID, requestingUserId: "gm-a"
  }), playerContext()), error => ["GROUND_GM_REQUIRED", "GROUND_COMMAND_PAYLOAD_INVALID"].includes(error.reasonCode));
});

test("socket sender identity rejects a declared GM spoof before Ground dispatch", () => {
  const users = usersFixture();
  const service = new AuthorityService({ getUsers: () => users, getCurrentUser: () => users.get("gm-a") });
  assert.throws(() => service.authenticateSocketRequest({ requestingUserId: "gm-a", targetGMId: "gm-a" }, {
    senderUserId: "player"
  }), error => error.reasonCode === "SENDER_SPOOFED");
  const authenticated = service.authenticateSocketRequest({ payload: { requestingUserId: "gm-a" } }, {
    senderUserId: "player"
  });
  assert.equal(authenticated.requestingUserId, "player");
});

test("strict DTO allow-list rejects privileged and unknown fields", async () => {
  const fx = await fixture();
  for (const field of ["itemSnapshot", "system", "flags", "provenance", "lifecycle", "recoveryEvidence",
    "pickupEnabled", "visibility", "appearance", "createdBy", "authorityUserId", "generation", "other"]) {
    await assert.rejects(fx.registry.dispatch(inspectEnvelope({ sceneId: "scene-a", groundId: GROUND_ID, [field]: {} }), gmContext()),
      error => error.reasonCode === "GROUND_COMMAND_PAYLOAD_INVALID");
  }
});

test("GM inspect is read-only, receipt-free and returns a minimized diagnostic", async () => {
  const fx = await fixture();
  await fx.lifecycle.createPendingGround(createInput());
  const before = JSON.stringify(fx.scene.flags);
  const result = await fx.registry.dispatch(inspectEnvelope({ sceneId: "scene-a", groundId: GROUND_ID }), gmContext());
  assert.equal(JSON.stringify(fx.scene.flags), before);
  assert.equal(fx.scene.flags.mtrol.groundCommandReceipts, undefined);
  assert.equal(result.groundId, GROUND_ID);
  assert.equal(result.classification, "CONSISTENT_PENDING");
  assert.equal("itemSnapshot" in result, false);
  assert.equal("authorityRecord" in result, false);
  assert.equal("repairPlan" in result, false);
  assert.doesNotMatch(JSON.stringify(result), /never-return|provenance|effects|system/);
});

test("repairable inspect does not return the private G1B.3 plan or authority fingerprint", async () => {
  const fx = await fixture();
  await makeRepairable(fx);
  const result = await fx.registry.dispatch(inspectEnvelope({ sceneId: "scene-a", groundId: GROUND_ID }), gmContext());
  assert.equal(result.recoverability, "REPAIRABLE");
  assert.equal("repairPlan" in result, false);
  assert.equal("authorityFingerprint" in result, false);
  assert.doesNotMatch(JSON.stringify(result), /itemSnapshot|never-return|provenance|effects|system/);
});

test("GM reconcile applies a valid G1B.3 plan and verifies durable MATCHED state", async () => {
  const fx = await fixture();
  const repairPlan = await makeRepairable(fx);
  const result = await fx.registry.dispatch(reconcileEnvelope("repair-one", repairPlan), gmContext());
  assert.equal(result.outcome, "REPAIRED");
  assert.equal(result.pairStatus, "MATCHED");
  assert.equal(fx.repository.read("scene-a", GROUND_ID).status, "MATCHED");
  assert.ok(fx.scene.flags.mtrol.groundCommandReceipts);
  assert.equal("state" in result, false);
  assert.equal("authorityRecord" in result, false);
});

test("reconcile retry and lost ACK replay without a second repair", async () => {
  const fx = await fixture();
  const repairPlan = await makeRepairable(fx);
  let repairs = 0;
  const original = fx.dependencies.reconciliation;
  fx.dependencies.reconciliation = {
    inspectGroundRecovery: (...args) => original.inspectGroundRecovery(...args),
    async repairGround(...args) { repairs += 1; return original.repairGround(...args); }
  };
  const registry = new CommandRegistry({ receiptStore: fx.receiptStore, observability: null });
  registerGroundCommands(registry, fx.dependencies);
  const request = reconcileEnvelope("lost-ack", repairPlan);
  const first = await registry.dispatch(request, gmContext());
  const retry = await registry.dispatch(request, gmContext());
  assert.deepEqual(retry, first);
  assert.equal(repairs, 1);
});

test("same reconcile transaction with different payload conflicts", async () => {
  const fx = await fixture();
  const repairPlan = await makeRepairable(fx);
  await fx.registry.dispatch(reconcileEnvelope("payload-conflict", repairPlan), gmContext());
  await assert.rejects(fx.registry.dispatch(reconcileEnvelope("payload-conflict", {
    ...repairPlan, publicRevision: repairPlan.publicRevision + 1
  }), gmContext()), ReceiptIdentityConflictError);
});

test("stale repair plan remains rejected by G1B.3 policy", async () => {
  const fx = await fixture();
  const repairPlan = await makeRepairable(fx);
  await fx.repository.updateAuthority("scene-a", GROUND_ID, { position: { x: 50, y: 60 } });
  await assert.rejects(fx.registry.dispatch(reconcileEnvelope("stale-plan", repairPlan), gmContext()),
    error => error.reasonCode === "GROUND_REPAIR_PLAN_STALE");
});

test("stale AuthorityWriteContext rejects reconcile before its public write", async () => {
  let validations = 0;
  const fx = await fixture({ authority: {
    resolveUser: id => ({ id, isGM: true, active: true }),
    createWriteContext: () => ({ authorityUserId: "gm-a", generation: "old" }),
    validateWriteContext: () => { validations += 1; throw Object.assign(new Error("stale"), { reasonCode: "AUTHORITY_CONTEXT_STALE" }); },
    isPrimaryGM: () => true
  } });
  const repairPlan = await makeRepairable(fx);
  const publicWrites = fx.scene.writes.filter(key => key === GROUND_PUBLIC_FLAG).length;
  await assert.rejects(fx.registry.dispatch(reconcileEnvelope("stale-authority", repairPlan), gmContext()),
    error => error.reasonCode === "AUTHORITY_CONTEXT_STALE");
  assert.equal(validations, 1);
  assert.equal(fx.scene.writes.filter(key => key === GROUND_PUBLIC_FLAG).length, publicWrites);
  assert.equal(fx.reconciliation.inspectGroundRecovery("scene-a", GROUND_ID).recoverability, "REPAIRABLE");
});

test("authority loss between lifecycle writes prevents the next write and leaves inspectable state", async () => {
  const fx = await fixture();
  await fx.lifecycle.createPendingGround(createInput());
  await fx.lifecycle.activateGround("scene-a", GROUND_ID, { transactionId: "activate" });
  let validations = 0;
  const guarded = new GroundLifecycleService({
    repository: fx.repository,
    assertAuthority: () => {
      validations += 1;
      if (validations >= 2) throw Object.assign(new Error("handoff"), { reasonCode: "AUTHORITY_CONTEXT_STALE" });
    }
  });
  const publicWrites = fx.scene.writes.filter(key => key === GROUND_PUBLIC_FLAG).length;
  await assert.rejects(guarded.updateGroundPublicState("scene-a", GROUND_ID, {
    position: { x: 100, y: 200 }
  }, { transactionId: "handoff" }), /handoff|autoridad|recovery/i);
  assert.equal(fx.scene.writes.filter(key => key === GROUND_PUBLIC_FLAG).length, publicWrites);
  assert.equal(fx.reconciliation.inspectGroundRecovery("scene-a", GROUND_ID).recoverability, "REPAIRABLE");
});

test("A to B to A does not rehabilitate an old AuthorityWriteContext", () => {
  const users = usersFixture();
  const service = new AuthorityService({ getUsers: () => users, getCurrentUser: () => users.get("gm-a") });
  const old = service.createWriteContext();
  users.get("gm-a").active = false; users.get("gm-b").active = true;
  assert.throws(() => service.validateWriteContext(old), error => error.reasonCode === "AUTHORITY_CONTEXT_STALE");
  users.get("gm-b").active = false; users.get("gm-a").active = true;
  assert.throws(() => service.validateWriteContext(old), error => error.reasonCode === "AUTHORITY_CONTEXT_STALE");
});

test("no Primary fails closed before Ground domain execution", async () => {
  const fx = await fixture();
  let calls = 0;
  fx.registry.handlers.get("ground.inspect").handler = async () => { calls += 1; return {}; };
  await assert.rejects(fx.registry.dispatch(inspectEnvelope({ sceneId: "scene-a", groundId: GROUND_ID }), {
    isPrimaryGM: false, requestingUserId: "gm-a"
  }), /Primary GM/);
  assert.equal(calls, 0);
});

test("Ground socket mappings reuse existing action translation and dispatch contract", async () => {
  assert.equal(getGroundCommandForSocketAction(GROUND_SOCKET_ACTION.INSPECT), GROUND_COMMAND.INSPECT);
  assert.equal(getGroundCommandForSocketAction(GROUND_SOCKET_ACTION.RECONCILE), GROUND_COMMAND.RECONCILE);
  assert.equal(getGroundCommandForSocketAction("unknown"), null);
  const fx = await fixture();
  await fx.lifecycle.createPendingGround(createInput());
  const dispatched = await dispatchGroundSocketCommand({
    action: GROUND_SOCKET_ACTION.INSPECT, requestId: "request", transactionId: "socket-inspect",
    requestingUserId: "gm-a", payload: { sceneId: "scene-a", groundId: GROUND_ID }
  }, { registry: fx.registry, dependencies: fx.dependencies, isPrimaryGM: () => true });
  assert.equal(dispatched.handled, true);
  assert.equal(dispatched.result.groundId, GROUND_ID);
});

test("existing socket listener authenticates sender and keeps nested caller spoof unprivileged", async () => {
  const previousGame = globalThis.game;
  const previousFoundry = globalThis.foundry;
  const users = usersFixture();
  const listeners = [];
  const emitted = [];
  globalThis.foundry = {
    ...(previousFoundry ?? {}),
    utils: {
      ...(previousFoundry?.utils ?? {}),
      deepClone: clone,
      randomID: () => "socket-random"
    }
  };
  globalThis.game = {
    user: users.get("gm-a"), users, scenes: new Map(), combats: new Map(),
    socket: {
      on(namespace, listener) { listeners.push({ namespace, listener }); },
      emit(namespace, data) { emitted.push({ namespace, data }); }
    }
  };
  try {
    const { registerMtrolSockets } = await import("../scripts/core/sockets.js");
    registerMtrolSockets();
    assert.equal(listeners.length, 1);
    const listener = listeners[0].listener;
    await listener({
      action: GROUND_SOCKET_ACTION.INSPECT,
      requestId: "declared-spoof",
      transactionId: "declared-spoof",
      requestingUserId: "gm-a",
      targetGMId: "gm-a",
      payload: { sceneId: "scene-a", groundId: GROUND_ID }
    }, "player");
    assert.equal(emitted.at(-1).data.reasonCode, "SENDER_SPOOFED");

    await listener({
      action: GROUND_SOCKET_ACTION.INSPECT,
      requestId: "nested-spoof",
      transactionId: "nested-spoof",
      requestingUserId: "player",
      targetGMId: "gm-a",
      payload: { sceneId: "scene-a", groundId: GROUND_ID, requestingUserId: "gm-a" }
    }, "player");
    assert.equal(emitted.at(-1).data.reasonCode, "GROUND_GM_REQUIRED");
  } finally {
    globalThis.game = previousGame;
    globalThis.foundry = previousFoundry;
  }
});

test("source integration adds no namespace, listener, Primary selector, public service facade, or gameplay command", async () => {
  const [sockets, init, commands] = await Promise.all([
    readFile(new URL("../scripts/core/sockets.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/core/init.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/runtime/ground-commands.js", import.meta.url), "utf8")
  ]);
  assert.match(sockets, /getGroundCommandForSocketAction/);
  assert.match(sockets, /dispatchGroundSocketCommand\(request\)/);
  assert.equal((sockets.match(/game\.socket\.on\("system\.mtrol"/g) ?? []).length, 1);
  assert.doesNotMatch(sockets, /system\.mtrol\.ground/);
  assert.match(init, /registerGroundCommands\(\)/);
  assert.doesNotMatch(init, /game\.mtrol\.ground/);
  assert.doesNotMatch(commands, /resolvePrimaryGM|GroundAuthorityService|GroundManager|ground\.drop|ground\.pickup/);
});
