import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  AuthorityBoundaryError,
  AuthorityService
} from "../scripts/core/authority-service.js";
import {
  HookDispatcher,
  registerFoundryHookAdapters
} from "../scripts/core/hook-dispatcher.js";
import { IntegrationObservability } from "../scripts/core/integration-observability.js";
import { LifecycleCoordinator } from "../scripts/core/lifecycle.js";

function usersFixture() {
  const users = new Map([
    ["gm-b", { id: "gm-b", isGM: true, active: true }],
    ["gm-a", { id: "gm-a", isGM: true, active: true }],
    ["owner", { id: "owner", isGM: false, active: true }],
    ["other", { id: "other", isGM: false, active: true }]
  ]);
  let current = users.get("gm-a");
  const service = new AuthorityService({
    getUsers: () => users,
    getCurrentUser: () => current
  });
  return { users, service, setCurrent: user => { current = user; } };
}

test("AuthorityService resuelve Primary GM de forma determinista y reacciona al relevo", () => {
  const fx = usersFixture();
  assert.equal(fx.service.resolvePrimaryGM().id, "gm-a");
  assert.equal(fx.service.isPrimaryGM(), true);
  fx.users.get("gm-a").active = false;
  assert.equal(fx.service.resolvePrimaryGM().id, "gm-b");
  assert.equal(fx.service.isPrimaryGM(), false);
  fx.setCurrent(fx.users.get("gm-b"));
  assert.equal(fx.service.isPrimaryGM(), true);
});

test("AuthorityService autentica al emisor real y rechaza userId falsificado", () => {
  const { service } = usersFixture();
  const metadata = service.authenticateSocketRequest({
    requestingUserId: "owner",
    targetGMId: "gm-a"
  }, { senderUserId: "owner" });
  assert.equal(metadata.requestingUserId, "owner");
  assert.equal(metadata.authorityUserId, "gm-a");
  assert.throws(() => service.authenticateSocketRequest({
    requestingUserId: "gm-a",
    targetGMId: "gm-a"
  }, { senderUserId: "owner" }), error =>
    error instanceof AuthorityBoundaryError && error.reasonCode === "SENDER_SPOOFED");
});

test("AuthorityService separa ownership básico de validación mecánica", () => {
  const { service } = usersFixture();
  const actor = {
    ownership: { owner: 3 },
    testUserPermission(user) { return user.id === "owner"; }
  };
  assert.equal(service.ownsActor(actor, "owner"), true);
  assert.equal(service.ownsActor(actor, "other"), false);
  assert.throws(() => service.assertActorOwnership(actor, "other"), /no controla/);
});

test("HookDispatcher mantiene orden explícito y bloquea en subscriber crítico", () => {
  const calls = [];
  const dispatcher = new HookDispatcher("preUpdateActor", {
    observability: new IntegrationObservability(),
    log: { warn() {}, error() {} }
  });
  dispatcher.subscribe("late", () => calls.push("late"), { priority: 30 });
  dispatcher.subscribe("guard", () => { calls.push("guard"); return false; }, { priority: 20, critical: true });
  dispatcher.subscribe("early", () => calls.push("early"), { priority: 10 });
  assert.equal(dispatcher.dispatchSync({}), false);
  assert.deepEqual(calls, ["early", "guard"]);
});

test("HookDispatcher aísla fallo no crítico y evita registros duplicados", async () => {
  const calls = [];
  const dispatcher = new HookDispatcher("updateToken", {
    observability: new IntegrationObservability(),
    log: { warn() {}, error() {} }
  });
  assert.equal(dispatcher.subscribe("visual", () => { throw new Error("visual"); }), true);
  assert.equal(dispatcher.subscribe("visual", () => calls.push("duplicate")), false);
  dispatcher.subscribe("domain", () => calls.push("domain"), { priority: 200, critical: true });
  await dispatcher.dispatch({});
  assert.deepEqual(calls, ["domain"]);
});

test("HookDispatcher síncrono ignora un veto no crítico y continúa", () => {
  const calls = [];
  const dispatcher = new HookDispatcher("preUpdateActor", {
    observability: new IntegrationObservability(),
    log: { warn() {}, error() {} }
  });
  dispatcher.subscribe("advisory", () => { calls.push("advisory"); return false; });
  dispatcher.subscribe("guard", () => calls.push("guard"), { priority: 200, critical: true });
  assert.equal(dispatcher.dispatchSync({}), true);
  assert.deepEqual(calls, ["advisory", "guard"]);
});

test("el bridge Foundry registra cada hook documental una sola vez", () => {
  const previousHooks = globalThis.Hooks;
  const registrations = [];
  globalThis.Hooks = { on: name => registrations.push(name) };
  try {
    assert.equal(registerFoundryHookAdapters(), true);
    assert.equal(registerFoundryHookAdapters(), false);
    assert.deepEqual(registrations, [
      "preUpdateActor", "updateActor",
      "preUpdateItem", "updateItem",
      "preUpdateToken", "updateToken"
    ]);
  } finally {
    globalThis.Hooks = previousHooks;
  }
});

test("instrumentación cuenta siempre y sólo retiene detalle cuando se habilita", () => {
  const metrics = new IntegrationObservability();
  metrics.record("hook", "updateToken");
  assert.equal(metrics.snapshot().counts["hook:updateToken"], 1);
  assert.equal(metrics.snapshot().events.length, 0);
  metrics.configure({ enabled: true, limit: 2 });
  metrics.record("socket", "movement.commit", { transactionId: "tx" });
  assert.equal(metrics.snapshot().events[0].transactionId, "tx");
});

test("LifecycleCoordinator ejecuta cada fase una sola vez y comparte in-flight", async () => {
  let runs = 0;
  const lifecycle = new LifecycleCoordinator({
    observability: new IntegrationObservability(),
    log: { debug() {} }
  });
  const operation = async () => { runs += 1; await Promise.resolve(); };
  const [first, second] = await Promise.all([
    lifecycle.run("READY", operation),
    lifecycle.run("READY", operation)
  ]);
  assert.equal(runs, 1);
  assert.deepEqual(second, first);
  assert.equal((await lifecycle.run("READY", operation)).duplicate, true);
});

test("contrato de integración: socket autentica sender, façade no cambia en ready y hooks convergen", async () => {
  const [socketSource, initSource, readySource, hookSource, turnSource, transactionSource] = await Promise.all([
    readFile(new URL("../scripts/core/sockets.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/core/init.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/core/ready.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/core/hook-dispatcher.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/combat/turn-system.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/runtime/transaction-commands.js", import.meta.url), "utf8")
  ]);
  assert.match(socketSource, /async \(data, senderUserId\)/);
  assert.match(socketSource, /authenticateSocketRequest\(data, \{ senderUserId \}\)/);
  assert.match(socketSource, /if \(socketsRegistered\) return false/);
  assert.doesNotMatch(socketSource, /game\.mtrol\.actions/);
  assert.match(initSource, /game\.mtrol\.roll \?\?= mtrolRoll/);
  assert.doesNotMatch(readySource, /game\.mtrol\.roll\s*=/);
  assert.equal((hookSource.match(/Hooks\.on\("preUpdateToken"/g) ?? []).length, 1);
  assert.equal((hookSource.match(/Hooks\.on\("updateToken"/g) ?? []).length, 1);
  assert.doesNotMatch(turnSource, /Hooks\.on\("(?:preUpdateToken|updateToken)"/);
  for (const [legacyAction, command] of [
    ["mtrolEndTurn", "turn.end"],
    ["mtrolGrantTurnMovement", "turn.movement-grant"],
    ["mtrolFinalizeTurnUse", "turn.use-finalize"],
    ["mtrolCompleteTurnAction", "turn.action-complete"]
  ]) {
    assert.match(transactionSource, new RegExp(`${legacyAction}: "${command.replace(".", "\\.")}"`));
    assert.match(transactionSource, new RegExp(`register\\("${command.replace(".", "\\.")}"`));
  }
});
