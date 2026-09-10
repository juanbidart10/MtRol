import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

let uid = 0;
globalThis.foundry = { utils: { deepClone: structuredClone, duplicate: structuredClone, randomID: () => `id-${++uid}` } };
const users = new Map([
  ["gm-a", { id: "gm-a", isGM: true, active: true }],
  ["gm-b", { id: "gm-b", isGM: true, active: true }],
  ["player", { id: "player", isGM: false, active: true }]
]);
const documents = new Map(), notifications = [], emitted = [], handlers = new Map();
const socket = { on: (name, handler) => handlers.set(name, handler), emit: (_name, data) => emitted.push(data) };
globalThis.game = { user: users.get("gm-a"), users, actors: new Map(), combats: new Map(), combat: null, socket };
globalThis.ui = { notifications: { warn: message => notifications.push(message) } };
globalThis.fromUuid = async uuid => documents.get(uuid) ?? null;

const { ActorRuntimeRepository, pruneActorReceiptsForTests, NON_COMBAT_RECEIPT_MAX_AGE_MS } = await import("../scripts/runtime/actor-runtime-repository.js");
const { ReceiptStore, getReceiptFromRuntime } = await import("../scripts/runtime/receipt-store.js");
const { TransactionCoordinator } = await import("../scripts/runtime/transaction-coordinator.js");
const foundation = await import("../scripts/runtime/runtime-foundation.js");
const { runActorResourceTransaction, restoreActorResourceAuthoritative, resetActorResourceServiceForTests } = await import("../scripts/actors/actor-resource-service.js");
const orbs = await import("../scripts/progression/orb-management-service.js");
const { registerOrbCommands, getOrbCommandForSocketAction } = await import("../scripts/runtime/orb-commands.js");
const { registerMtrolSockets } = await import("../scripts/core/sockets.js");
const { handleSocketResponse } = await import("../scripts/core/socket-requests.js");
const { aplicarDanioCanonicoAutorizado } = await import("../scripts/combat/damage-authorized.js");
registerMtrolSockets();

function actorFixture(uuid = "Actor.a") {
  const actor = { documentName: "Actor", id: uuid.split(".").at(-1), uuid, flags: {},
    system: { orbs: [], vitales: { hp: { value: 20, max: 20 } } }, items: new Map(), writes: 0, flagWrites: 0,
    getFlag(scope, key) { return this.flags[scope]?.[key]; },
    async setFlag(scope, key, value) { this.flagWrites++; (this.flags[scope] ??= {})[key] = structuredClone(value); },
    async update(changes) {
      this.writes++;
      for (const [path, value] of Object.entries(changes)) {
        const keys = path.split("."); let target = this;
        for (const key of keys.slice(0, -1)) target = target[key] ??= {};
        target[keys.at(-1)] = structuredClone(value);
      }
      return this;
    }
  };
  documents.set(uuid, actor); game.actors.set(actor.id, actor);
  return actor;
}

function harness() {
  const repo = new ActorRuntimeRepository();
  const store = new ReceiptStore({ repository: repo });
  const log = [], alerts = [];
  const coordinator = new TransactionCoordinator({ actorReceiptStore: store,
    logger: { warn: (...args) => log.push(args), error: (...args) => log.push(args) },
    notify: message => alerts.push(message) });
  return { repo, store, coordinator, log, alerts };
}
const recovery = error => error.reasonCode === "RECOVERY_REQUIRED";
const request = actor => ({ actorUuid: actor.uuid, transactionId: "orb-add", orbId: "orb-1", type: "ignis", level: 1, expectedOrbCount: 0 });
const options = actor => ({ trustedActor: actor, requestingUserId: "gm-a" });

test.beforeEach(() => {
  users.get("gm-a").active = true; users.get("gm-b").active = true;
  game.user = users.get("gm-a"); game.combat = null; game.actors.clear(); game.combats.clear(); game.socket = socket;
  documents.clear(); notifications.length = 0; emitted.length = 0;
  resetActorResourceServiceForTests(); orbs.resetOrbManagementServiceForTests();
});

test("retención protege pendientes, estados desconocidos y failed legacy, incluso vencidos", () => {
  const now = Date.now(), old = now - NON_COMBAT_RECEIPT_MAX_AGE_MS - 1, receipts = {};
  for (const status of ["processing", "prepared", "applying", "applied", "recovery-required", "unknown", "failed"]) {
    receipts[status] = { status, updatedAt: old, result: { changed: false } };
  }
  receipts.noStatus = { updatedAt: old };
  receipts.safeFailure = { status: "failed", failureSafety: "no-effects", updatedAt: old };
  receipts.rolledBack = { status: "failed", failureSafety: "rolled-back", updatedAt: old };
  for (let i = 0; i < 140; i++) receipts[`done-${i}`] = { status: "completed", updatedAt: now - i };
  const retained = pruneActorReceiptsForTests(receipts, now);
  assert.equal(Object.keys(retained).length, 128 + 8);
  assert.ok(retained["recovery-required"]); assert.ok(retained.failed); assert.ok(retained.noStatus);
  assert.equal(retained.safeFailure, undefined); assert.equal(retained.rolledBack, undefined);
});

test("ActorRepository conserva evidencia en documento tras escritura y reconstrucción", async () => {
  const actor = actorFixture(), repo = new ActorRuntimeRepository();
  actor.flags.mtrol = { transactionRuntime: { revision: 0, receipts: { old: { status: "recovery-required", updatedAt: 1 } } } };
  await repo.mutate(actor, draft => { draft.receipts.new = { status: "completed", updatedAt: Date.now() }; });
  const fresh = new ActorRuntimeRepository();
  assert.ok(fresh.read(actor).receipts.old); assert.equal(fresh.read(actor).schemaVersion, 1);
});

test("escritura sin ACK queda en recovery aunque no alcanzó su primer checkpoint", async () => {
  const actor = actorFixture(), fx = harness();
  const execute = () => fx.coordinator.execute({ actor }, { transactionId: "lost", command: "resource.test",
    apply: async () => { await actor.update({ "system.vitales.hp.value": 15 }); throw new Error("lost ACK"); } });
  await assert.rejects(execute(), recovery);
  assert.equal(fx.store.get(actor, "lost").status, "recovery-required");
  assert.equal(fx.store.get(actor, "lost").result.changed, true);
  await assert.rejects(execute(), recovery);
  await assert.rejects(fx.coordinator.execute({ actor }, { transactionId: "new", command: "damage.apply", apply: () => assert.fail("blocked") }), recovery);
  assert.equal(actor.writes, 1); assert.equal(fx.alerts.length, 1); assert.ok(fx.log.length);
  assert.equal(fx.store.get(actor, "new"), null);
});

test("validación en prepare y rollback certificado permiten otra operación segura", async () => {
  const actor = actorFixture(), fx = harness();
  await assert.rejects(fx.coordinator.execute({ actor }, { transactionId: "invalid", command: "resource.test",
    prepare: () => { throw new Error("invalid snapshot"); }, apply: () => assert.fail() }), /invalid snapshot/);
  assert.equal(fx.store.get(actor, "invalid").failureSafety, "no-effects");
  await assert.rejects(fx.coordinator.execute({ actor }, { transactionId: "rollback", command: "resource.test",
    apply: async ({ checkpoint }) => { await checkpoint("intent"); throw Object.assign(new Error("rolled back"), { transactionRolledBack: true }); }
  }), /rolled back/);
  assert.equal(fx.store.get(actor, "rollback").failureSafety, "rolled-back");
  assert.deepEqual(await fx.coordinator.execute({ actor }, { transactionId: "fresh", command: "resource.test", apply: () => ({ ok: true }) }), { ok: true });
  assert.equal(fx.alerts.length, 0);
});

test("resultado applied durable se completa sin repetir apply si falla el receipt final", async () => {
  const actor = actorFixture(), fx = harness(); let calls = 0;
  const complete = fx.store.complete.bind(fx.store); let fail = true;
  fx.store.complete = (...args) => { if (fail) { fail = false; throw new Error("receipt unavailable"); } return complete(...args); };
  const execute = () => fx.coordinator.execute({ actor }, { transactionId: "final", command: "resource.test", apply: () => { calls++; return { ok: true }; } });
  await assert.rejects(execute(), recovery);
  assert.equal(fx.store.get(actor, "final").status, "applied");
  assert.deepEqual(await execute(), { ok: true }); assert.equal(calls, 1);
});

test("fallo de persistencia del error conserva applying y el error original", async () => {
  const actor = actorFixture(), fx = harness();
  const update = fx.store.update.bind(fx.store);
  fx.store.update = (...args) => {
    if (fx.store.get(actor, "lost")?.status === "applying") throw new Error("cannot persist error");
    return update(...args);
  };
  await assert.rejects(fx.coordinator.execute({ actor }, { transactionId: "lost", command: "resource.test",
    apply: () => { throw new Error("original failure"); }
  }), error => recovery(error) && error.message === "original failure");
  assert.equal(fx.store.get(actor, "lost").status, "applying");
  await assert.rejects(fx.coordinator.execute({ actor }, { transactionId: "new", command: "resource.test", apply: () => assert.fail() }), recovery);
});

test("concurrencia: otro ID del mismo Actor espera y se bloquea; otro Actor continúa", async () => {
  const actor = actorFixture(), other = actorFixture("Actor.b"), fx = harness(); let release, entered;
  const waiting = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const first = fx.coordinator.execute({ actor }, { transactionId: "first", command: "resource.test",
    apply: async () => { entered(); await waiting; throw new Error("lost"); } });
  const rejection = assert.rejects(first, recovery); await started;
  const second = fx.coordinator.execute({ actor }, { transactionId: "second", command: "damage.apply", apply: () => assert.fail() });
  const blocked = assert.rejects(second, recovery);
  assert.equal(await fx.coordinator.execute({ actor: other }, { transactionId: "other", command: "resource.test", apply: () => "ok" }), "ok");
  release(); await rejection; await blocked;
  assert.equal(fx.coordinator.operationQueues.size, 0); assert.equal(fx.coordinator.inFlight.size, 0);
});

test("recursos distinguen validación auditada de escritura incierta", async () => {
  const actor = actorFixture();
  await assert.rejects(runActorResourceTransaction(actor, { transactionId: "invalid", origin: "mp-cost", tracksWrites: true },
    async () => { throw new Error("MP insuficiente"); }), /MP insuficiente/);
  assert.equal(foundation.actorReceiptStore.get(actor, "invalid").failureSafety, "no-effects");
  await assert.rejects(runActorResourceTransaction(actor, { transactionId: "lost", origin: "mp-cost", tracksWrites: true },
    async (target, { beforeWrite }) => { await beforeWrite(); await target.update({ "system.vitales.hp.value": 15 }); throw new Error("lost"); }), recovery);
  assert.equal(foundation.actorReceiptStore.get(actor, "lost").status, "recovery-required");
  await assert.rejects(orbs.addActorOrbAuthoritative(request(actor), options(actor)), recovery);
  assert.equal(actor.system.orbs.length, 0);
});

test("daño incierto bloquea recursos tras finalizar combate y reconstruir caches", async () => {
  const actor = actorFixture(), combat = actorFixture("Combat.c"); game.actors.delete(combat.id);
  game.combat = combat; game.combats.set(combat.id, combat);
  const update = actor.update.bind(actor);
  actor.update = async changes => { await update(changes); throw new Error("lost HP ACK"); };
  await assert.rejects(aplicarDanioCanonicoAutorizado({ targetActor: actor, payload: { danio: 5, slot: "pecho" }, transactionId: "damage" }), recovery);
  game.combat = null; resetActorResourceServiceForTests();
  await assert.rejects(runActorResourceTransaction(actor, { transactionId: "resource", origin: "mp-cost" }, () => assert.fail()), recovery);
  assert.equal(actor.writes, 1);
});

test("Orbes persisten alta/edición/baja y replay después de pérdida de RAM", async () => {
  const actor = actorFixture(), payload = request(actor);
  const first = await orbs.addActorOrbAuthoritative(payload, options(actor));
  orbs.resetOrbManagementServiceForTests();
  const replay = await orbs.addActorOrbAuthoritative(payload, options(actor));
  assert.equal(first.replayed, false); assert.equal(replay.replayed, true); assert.equal(actor.writes, 1);
  await orbs.updateActorOrbAuthoritative({ actorUuid: actor.uuid, transactionId: "edit", orbId: "orb-1", type: "ignis", level: 3, expectedType: "ignis", expectedLevel: 1 }, options(actor));
  const deletion = { actorUuid: actor.uuid, transactionId: "delete", orbId: "orb-1", expectedType: "ignis", expectedLevel: 3 };
  await orbs.deleteActorOrbAuthoritative(deletion, options(actor)); orbs.resetOrbManagementServiceForTests();
  assert.equal((await orbs.deleteActorOrbAuthoritative(deletion, options(actor))).replayed, true);
  assert.equal(actor.writes, 3); assert.equal(actor.system.orbs.length, 0);
});

test("Orbes rechazan intención distinta con mismo ID y serializan duplicados", async () => {
  const actor = actorFixture(), payload = request(actor);
  const results = await Promise.all([orbs.addActorOrbAuthoritative(payload, options(actor)), orbs.addActorOrbAuthoritative(payload, options(actor))]);
  assert.equal(actor.writes, 1); assert.equal(results[1].replayed, true);
  await assert.rejects(orbs.addActorOrbAuthoritative({ ...payload, level: 2 }, options(actor)), error => error.reasonCode === "ORB_TRANSACTION_CONFLICT");
  assert.equal(actor.writes, 1);
});

test("Orbes: snapshot inválido no bloquea un pedido nuevo válido", async () => {
  const actor = actorFixture();
  await assert.rejects(orbs.addActorOrbAuthoritative({ ...request(actor), expectedOrbCount: 7 }, options(actor)), /colección/);
  assert.equal(actor.writes, 0);
  await orbs.addActorOrbAuthoritative({ ...request(actor), transactionId: "correct" }, options(actor));
  assert.equal(actor.writes, 1);
});

test("Orbes: ACK perdido exige recovery después de F5 y bloquea otro ID", async () => {
  const actor = actorFixture(), payload = request(actor), update = actor.update.bind(actor);
  actor.update = async changes => { await update(changes); throw new Error("lost orb ACK"); };
  await assert.rejects(orbs.addActorOrbAuthoritative(payload, options(actor)), recovery);
  orbs.resetOrbManagementServiceForTests();
  await assert.rejects(orbs.addActorOrbAuthoritative(payload, options(actor)), recovery);
  await assert.rejects(orbs.addActorOrbAuthoritative({ ...payload, transactionId: "new", type: "aqua", orbId: "orb-2", expectedOrbCount: 1 }, options(actor)), recovery);
  assert.equal(actor.writes, 1); assert.equal(actor.system.orbs.length, 1);
});

test("Orbes: Actor sintético resuelto por UUID usa su propio receipt", async () => {
  const actor = actorFixture("Scene.s.Token.t.Actor.synthetic"); game.actors.clear();
  await orbs.addActorOrbAuthoritative(request(actor), { requestingUserId: "gm-b" });
  assert.equal(getReceiptFromRuntime(actor.flags.mtrol.transactionRuntime, "orb-add").status, "completed");
  assert.equal(actor.writes, 1);
});

test("Orbes: jugador y ejecución directa fuera de Primary GM no escriben", async () => {
  const actor = actorFixture();
  await assert.rejects(orbs.addActorOrbAuthoritative(request(actor), { ...options(actor), requestingUserId: "player" }), error => error.reasonCode === "ORB_GM_REQUIRED");
  game.user = users.get("gm-b");
  await assert.rejects(orbs.addActorOrbAuthoritative(request(actor), { ...options(actor), requestingUserId: "gm-b" }), error => error.reasonCode === "NOT_PRIMARY_GM");
  assert.equal(actor.writes, 0); assert.equal(actor.flagWrites, 0);
});

test("socket de Orbes autentica sender, rechaza jugador y ejecuta solicitud de otro GM", async () => {
  const actor = actorFixture(), handler = handlers.get("system.mtrol");
  const data = { action: "mtrolAddActorOrb", requestId: "req", requestingUserId: "gm-b", payload: request(actor) };
  await handler(data, "player"); assert.equal(emitted.at(-1).reasonCode, "SENDER_SPOOFED");
  await handler({ ...data, requestingUserId: "player" }, "player"); assert.equal(emitted.at(-1).reasonCode, "ORB_GM_REQUIRED");
  assert.equal(actor.flagWrites, 0);
  await handler(data, "gm-b"); assert.equal(emitted.at(-1).ok, true); assert.equal(emitted.at(-1).result.orb.id, "orb-1");
  assert.equal(actor.writes, 1);
});

test("API de Orbes del GM secundario delega sin escribir localmente", async () => {
  const actor = actorFixture(); game.user = users.get("gm-b");
  game.socket = { ...socket, emit: (_channel, request) => {
    assert.equal(request.action, "mtrolAddActorOrb"); assert.equal(request.targetGMId, "gm-a");
    assert.equal(request.requestingUserId, "gm-b"); assert.equal(request.payload.actorUuid, actor.uuid);
    handleSocketResponse({ action: "mtrolSocketResponse", requestId: request.requestId, targetUserId: "gm-b", ok: true, result: { orb: { id: "accepted" } } }, { senderUserId: "gm-a" });
  } };
  assert.equal((await orbs.addActorOrb(actor, { type: "ignis", level: 1 })).orb.id, "accepted");
  assert.equal(actor.writes, 0); assert.equal(actor.flagWrites, 0);
});

test("recovery de Orbes tras cambio de GM completa sólo resultado durable y avisa ambigüedad", async () => {
  const actor = actorFixture();
  for (const [id, status] of [["done", "applied"], ["lost", "applying"]]) {
    await foundation.actorReceiptStore.begin(actor, id, { command: "orb.add" });
    await foundation.actorReceiptStore.transition(actor, id, status, { actorUuid: actor.uuid, ...(id === "done" ? { result: { orb: { id: "o" } } } : {}) });
  }
  users.get("gm-a").active = false; game.user = users.get("gm-b");
  const result = await foundation.recoveryCoordinator.recoverActorTransactions(new Map([[actor.id, actor]]), { isPrimaryGM: true, notify: message => notifications.push(message) });
  assert.deepEqual(result.completedIds, ["done"]); assert.deepEqual(result.requiredIds, ["lost"]);
  assert.equal(actor.writes, 0); assert.equal(notifications.length, 1);
  const repeated = await foundation.recoveryCoordinator.recoverActorTransactions([actor], { isPrimaryGM: true });
  assert.deepEqual(repeated.requiredIds, ["lost"]);
});

test("registro de Orbes idempotente, sin Map de receipts y sin lógica en socket", async () => {
  registerOrbCommands(); const count = foundation.commandRegistry.handlers.size;
  registerOrbCommands(); assert.equal(foundation.commandRegistry.handlers.size, count);
  assert.equal(getOrbCommandForSocketAction("constructor"), null);
  const domain = await readFile(new URL("../scripts/progression/orb-management-service.js", import.meta.url), "utf8");
  const socketSource = await readFile(new URL("../scripts/core/sockets.js", import.meta.url), "utf8");
  assert.doesNotMatch(domain, /completedTransactions/);
  assert.doesNotMatch(socketSource, /addActorOrbAuthoritative|system\.orbs/);
});

test("consumible: sólo rechazo certificado previo a inventario permite rollback", async () => {
  const actor = actorFixture(); actor.system.vitales.hp.value = 10;
  await assert.rejects(restoreActorResourceAuthoritative(actor, "hp", 5, {
    transactionId: "safe-rollback", commit: async () => { throw Object.assign(new Error("validation before inventory write"), { transactionNoEffects: true }); }
  }), /validation/);
  assert.equal(actor.system.vitales.hp.value, 10);
  assert.equal(foundation.actorReceiptStore.get(actor, "safe-rollback").failureSafety, "rolled-back");
  await assert.rejects(restoreActorResourceAuthoritative(actor, "hp", 5, {
    transactionId: "ambiguous-commit", commit: async () => { throw new Error("inventory ACK lost"); }
  }), recovery);
  assert.equal(actor.system.vitales.hp.value, 15);
  assert.equal(foundation.actorReceiptStore.get(actor, "ambiguous-commit").status, "recovery-required");
});

test("consumible: rollback fallido nunca se certifica como sin efectos", async () => {
  const actor = actorFixture(); actor.system.vitales.hp.value = 10;
  const update = actor.update.bind(actor);
  actor.update = async (changes, options) => {
    if (options?.mtrolConsumableRollback) throw new Error("rollback failed");
    return update(changes);
  };
  await assert.rejects(restoreActorResourceAuthoritative(actor, "hp", 5, {
    transactionId: "rollback-failed", commit: async () => { throw Object.assign(new Error("pre-write failure"), { transactionNoEffects: true }); }
  }), recovery);
  assert.equal(actor.system.vitales.hp.value, 15);
  assert.equal(foundation.actorReceiptStore.get(actor, "rollback-failed").status, "recovery-required");
});

test("mismo ID en otro Actor de Combat no recibe el resultado del primero", async () => {
  const actor = actorFixture(), other = actorFixture("Actor.other"), combat = actorFixture("Combat.shared");
  game.combat = combat; game.combats.set(combat.id, combat);
  await runActorResourceTransaction(actor, { transactionId: "shared", origin: "mp-cost" }, () => ({ ok: true }));
  await assert.rejects(runActorResourceTransaction(other, { transactionId: "shared", origin: "mp-cost" }, () => assert.fail()), error => error.reasonCode === "TRANSACTION_CONFLICT");
});

test("socket rechaza un Item como objetivo de Orbes sin escribir recibos", async () => {
  const item = actorFixture("Actor.a.Item.i"); item.documentName = "Item";
  await handlers.get("system.mtrol")({ action: "mtrolAddActorOrb", requestId: "item", requestingUserId: "gm-a", payload: request(item) }, "gm-a");
  assert.equal(emitted.at(-1).reasonCode, "ORB_ACTOR_INVALID");
  assert.equal(item.writes, 0); assert.equal(item.flagWrites, 0);
});

test("reconcile usa evidencia de dominio, no el envelope de error anterior", async () => {
  const actor = actorFixture(), fx = harness(); let writes = 0;
  const execute = () => fx.coordinator.execute({ actor }, { transactionId: "evidence", command: "resource.test",
    apply: async ({ checkpoint }) => { writes++; await checkpoint("applied", { value: 7 }); throw new Error("response lost"); },
    reconcile: receipt => receipt.checkpoints?.applied
      ? { resolved: true, result: receipt.result ?? { ok: true, value: receipt.checkpoints.applied.value } }
      : { resolved: false }
  });
  await assert.rejects(execute(), recovery);
  assert.deepEqual(await execute(), { ok: true, value: 7 });
  assert.equal(writes, 1); assert.equal(fx.store.get(actor, "evidence").status, "completed");
});

test("repetición acotada: 160 ediciones + replay mantienen 128 terminales y liberan colas", async () => {
  const actor = actorFixture(); await orbs.addActorOrbAuthoritative(request(actor), options(actor));
  for (let index = 0; index < 160; index++) {
    const levelBefore = actor.system.orbs[0].level;
    const payload = { actorUuid: actor.uuid, transactionId: `edit-${index}`, orbId: "orb-1", type: "ignis",
      level: levelBefore === 1 ? 2 : 1, expectedType: "ignis", expectedLevel: levelBefore };
    await orbs.updateActorOrbAuthoritative(payload, options(actor));
    if (index % 20 === 0) orbs.resetOrbManagementServiceForTests();
    assert.equal((await orbs.updateActorOrbAuthoritative(payload, options(actor))).replayed, true);
  }
  assert.equal(actor.writes, 161);
  assert.equal(Object.keys(actor.flags.mtrol.transactionRuntime.receipts).length, 128);
  assert.equal(foundation.transactionCoordinator.inFlight.size, 0);
  assert.equal(foundation.transactionCoordinator.operationQueues.size, 0);
  assert.equal(foundation.actorRuntimeRepository.mutationQueues.size, 0);
});
