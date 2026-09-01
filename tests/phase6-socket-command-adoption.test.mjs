import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

globalThis.foundry = { utils: { randomID: () => "id", deepClone: structuredClone } };
globalThis.game = { user: { id: "gm", isGM: true, active: true }, users: new Map([
  ["gm", { id: "gm", isGM: true, active: true }], ["owner", { id: "owner", active: true }]
]) };
const { CommandRegistry } = await import("../scripts/runtime/command-registry.js");
const { commandRegistry } = await import("../scripts/runtime/runtime-foundation.js");
const { registerProgressionCommands, getProgressionCommandForSocketAction, dispatchProgressionSocketCommand } =
  await import("../scripts/runtime/progression-commands.js");
const { registerActionCommands, getActionCommandForSocketAction, dispatchActionSocketCommand, serializeResolvedDamageResult } =
  await import("../scripts/runtime/action-commands.js");

const context = { requestingUserId: "owner", isPrimaryGM: true };
const envelope = (command, payload = {}) => ({ command, transactionId: "transport-tx", payload });
const registry = () => new CommandRegistry();

test("progresión delega payload exacto y conserva respuesta receipt sin otra transacción", async () => {
  const calls = [], registryInstance = registry();
  registerProgressionCommands(registryInstance, {
    spendAttribute: async (...args) => { calls.push(["attribute", ...args]); return { changed: true }; },
    spendCompetence: async (...args) => { calls.push(["competence", ...args]); return { replayed: true }; }
  });
  const payload = { actorUuid: "Scene.s.Token.t.Actor.a", transactionId: "domain-tx", expectedValue: 2, expectedPendingPoints: 1 };
  assert.deepEqual(await registryInstance.dispatch(envelope("progression.spend-attribute", payload), context), { receipt: { changed: true } });
  assert.deepEqual(await registryInstance.dispatch(envelope("progression.spend-competence", payload), context), { receipt: { replayed: true } });
  assert.equal(calls[0][1], payload); assert.equal(calls[1][1], payload);
  assert.deepEqual(calls.map(call => call[2]), [{ requestingUserId: "owner" }, { requestingUserId: "owner" }]);
  for (const definition of registryInstance.handlers.values()) assert.equal(definition.idempotent, false);
});

test("ready-damage conserva creación y serialización en ese orden", async () => {
  const calls = [], instance = registry(), pending = { id: "ready" };
  registerActionCommands(instance, {
    createReady: async (...args) => { calls.push(["create", ...args]); return pending; },
    serialize: value => { calls.push(["serialize", value]); return { id: value.id, serialized: true }; }
  });
  const payload = { pendingAction: { sourceActorUuid: "Actor.a", attackerRoll: { total: 12 } } };
  assert.deepEqual(await instance.dispatch(envelope("action.ready-damage-create", payload), context),
    { pendingAction: { id: "ready", serialized: true } });
  assert.equal(calls[0][1], payload.pendingAction);
  assert.deepEqual(calls[0][2], { requestingUserId: "owner" });
  assert.equal(calls[1][1], pending);
});

test("daño ejecuta una vez, relee pending y conserva proyección de respuesta", async () => {
  const calls = [], instance = registry();
  registerActionCommands(instance, {
    executeDamage: async (...args) => { calls.push(["execute", ...args]); return { success: true, totalFinalDanio: 5 }; },
    getPending: id => { calls.push(["get", id]); return { id, damage: { status: "applied" } }; },
    serialize: value => { calls.push(["serialize"]); return value; }
  });
  const result = await instance.dispatch(envelope("action.resolved-damage-execute", { pendingActionId: "p" }), context);
  assert.deepEqual(calls.map(call => call[0]), ["execute", "get", "serialize"]);
  assert.deepEqual(calls[0], ["execute", "p", { requestingUserId: "owner" }]);
  assert.equal(result.pendingAction.damage.status, "applied");
  assert.deepEqual(result.damageResult, { success: true, fumble: false, totalBaseDanio: 0, totalFinalDanio: 5, resultadoDanio: null });
});

test("proyección localizada mantiene todos los campos legacy y descarta campos ajenos", () => {
  const result = serializeResolvedDamageResult({ success: true, fumble: false, totalBaseDanio: "9", totalFinalDanio: "5",
    secret: { irrelevant: true }, resultadoDanio: {
      numeroLocalizacion: "4", slot: "pecho", zona: "torso", item: "armor",
      defensaInicial: "4", defensaFinal: "0", danioOriginal: "9", danioAbsorbido: "4",
      hpPerdido: "5", hpAnterior: "20", hpNuevo: "15", itemDestruido: true, aplicacion: "localized", ignored: 123
    } });
  assert.deepEqual(result, { success: true, fumble: false, totalBaseDanio: 9, totalFinalDanio: 5, resultadoDanio: {
    numeroLocalizacion: 4, slot: "pecho", zona: "torso", item: "armor",
    defensaInicial: 4, defensaFinal: 0, danioOriginal: 9, danioAbsorbido: 4,
    hpPerdido: 5, hpAnterior: 20, hpNuevo: 15, itemDestruido: true, aplicacion: "localized"
  } });
  assert.equal(serializeResolvedDamageResult(null).resultadoDanio, null);
  assert.equal(serializeResolvedDamageResult({ success: 1 }).success, false);
});

test("registry niega autoridad/identidad ausente antes de tocar dominio", async () => {
  let calls = 0; const instance = registry();
  registerProgressionCommands(instance, { spendAttribute: () => calls++, spendCompetence: () => calls++ });
  registerActionCommands(instance, { createReady: () => calls++, executeDamage: () => calls++ });
  for (const command of instance.handlers.keys()) {
    await assert.rejects(instance.dispatch(envelope(command), { ...context, isPrimaryGM: false }), /Primary GM/);
    await assert.rejects(instance.dispatch(envelope(command), { isPrimaryGM: true }), /solicitante/);
  }
  assert.equal(calls, 0);
});

test("errores de ownership, snapshot y recovery se propagan sin serialización ni fallback", async () => {
  const instance = registry(); const failure = Object.assign(new Error("recovery-required"), { reasonCode: "RECOVERY_REQUIRED" });
  let projections = 0;
  const reject = async () => { throw failure; };
  registerProgressionCommands(instance, { spendAttribute: reject, spendCompetence: reject });
  registerActionCommands(instance, { createReady: reject, executeDamage: reject, serialize: () => projections++, getPending: () => projections++ });
  for (const command of instance.handlers.keys()) await assert.rejects(instance.dispatch(envelope(command), context), error => error === failure);
  assert.equal(projections, 0);
});

test("registros son idempotentes y no sustituyen handlers instalados", () => {
  const instance = registry(); registerActionCommands(instance); registerProgressionCommands(instance);
  const definitions = [...instance.handlers.values()];
  registerActionCommands(instance); registerProgressionCommands(instance);
  assert.equal(instance.handlers.size, 4); assert.deepEqual([...instance.handlers.values()], definitions);
});

test("nombres de transporte existentes convergen en los cuatro commands y rechazan prototype keys", async () => {
  assert.equal(getProgressionCommandForSocketAction("mtrolSpendPendingAttribute"), "progression.spend-attribute");
  assert.equal(getProgressionCommandForSocketAction("mtrolSpendPendingCompetence"), "progression.spend-competence");
  assert.equal(getActionCommandForSocketAction("mtrolCreateReadyDamageAction"), "action.ready-damage-create");
  assert.equal(getActionCommandForSocketAction("mtrolExecuteResolvedDamage"), "action.resolved-damage-execute");
  for (const name of ["constructor", "toString", "__proto__", "other"]) {
    assert.equal(getActionCommandForSocketAction(name), null); assert.equal(getProgressionCommandForSocketAction(name), null);
  }
  assert.deepEqual(await dispatchActionSocketCommand({ action: "other" }), { handled: false, result: null });
  assert.deepEqual(await dispatchProgressionSocketCommand({ action: "other" }), { handled: false, result: null });
});

test("adapters mantienen payload, identidad autenticada y requestId legacy como correlación", async () => {
  const calls = [];
  registerProgressionCommands(commandRegistry, {
    spendAttribute: async (payload, options) => { calls.push({ payload, options }); return { ok: true }; },
    spendCompetence: async () => ({ ok: true })
  });
  registerActionCommands(commandRegistry, {
    createReady: async (payload, options) => { calls.push({ payload, options }); return payload; },
    serialize: value => value
  });
  const payload = { transactionId: "receipt-id", actorUuid: "Scene.s.Token.t.Actor.a" };
  assert.deepEqual(await dispatchProgressionSocketCommand({ action: "mtrolSpendPendingAttribute", requestId: "request", requestingUserId: "owner", payload }),
    { handled: true, result: { receipt: { ok: true } } });
  const pendingAction = { id: "p" };
  assert.deepEqual(await dispatchActionSocketCommand({ action: "mtrolCreateReadyDamageAction", requestId: "legacy-request", requestingUserId: "owner", payload: { pendingAction } }),
    { handled: true, result: { pendingAction } });
  assert.equal(calls[0].payload, payload); assert.equal(calls[1].payload, pendingAction);
  assert.deepEqual(calls.map(call => call.options), [{ requestingUserId: "owner" }, { requestingUserId: "owner" }]);
});

test("guardrail: socket sin servicios mutadores de progresión/daño y registro en lifecycle existente", async () => {
  const sockets = await readFile(new URL("../scripts/core/sockets.js", import.meta.url), "utf8");
  const init = await readFile(new URL("../scripts/core/init.js", import.meta.url), "utf8");
  assert.doesNotMatch(sockets, /createReadyDamageActionAuthoritative|executeResolvedDamageAuthoritative|spendPending(?:Attribute|Competence)PointAuthoritative|resultadoDanio/);
  assert.doesNotMatch(sockets, /\.(?:update|setFlag|createEmbeddedDocuments|deleteEmbeddedDocuments)\s*\(/);
  assert.match(sockets, /dispatchProgressionSocketCommand\(request\)/);
  assert.match(sockets, /dispatchActionSocketCommand\(request\)/);
  assert.match(init, /registerProgressionCommands\(\)/); assert.match(init, /registerActionCommands\(\)/);
});
