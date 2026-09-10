import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

let nextId = 0;
const clone = value => value === undefined ? undefined : structuredClone(value);
globalThis.foundry = { utils: { deepClone: clone, duplicate: clone, randomID: () => `state-${++nextId}`, escapeHTML: String } };
globalThis.CONFIG = { statusEffects: [{ id: "stunned", img: "stunned.svg" }] };
globalThis.Hooks = { on() {}, callAll() {} };
globalThis.ui = { notifications: { warn() {}, error() {} } };

const states = await import("../scripts/states/state-engine.js");
const { dispatchStateSocketCommand, registerStateCommands } = await import("../scripts/runtime/state-commands.js");
const { actorRuntimeRepository, commandRegistry, recoveryCoordinator } = await import("../scripts/runtime/runtime-foundation.js");
const { createDefaultRuntime } = await import("../scripts/runtime/runtime-repository.js");
const { setReceiptInRuntime } = await import("../scripts/runtime/receipt-store.js");
const { logger } = await import("../scripts/utils/logger.js");
const { registerMtrolSockets } = await import("../scripts/core/sockets.js");
const { handleSocketResponse } = await import("../scripts/core/socket-requests.js");

function fixture() {
  actorRuntimeRepository.resetForTests();
  const counts = { flags: 0, receipts: 0, effects: 0, chat: 0, icons: 0, combat: 0 };
  const logs = [], emitted = [], handlers = new Map(), documents = new Map();
  const users = new Map([
    ["gm", { id: "gm", isGM: true, active: true }],
    ["gm2", { id: "gm2", isGM: true, active: true }],
    ["owner", { id: "owner", isGM: false, active: true }],
    ["other", { id: "other", isGM: false, active: true }]
  ]);
  logger.sink = { warn: (...args) => logs.push(args), error: (...args) => logs.push(args) };
  logger.setLevel("warn");
  function actor(id, owner) {
    const value = {
      id, uuid: `Actor.${id}`, documentName: "Actor", name: id, flags: { mtrol: {} }, effects: [],
      ownership: { [owner]: 3 },
      testUserPermission(user) { return this.ownership[user.id] === 3; },
      getFlag(_scope, key) { return this.flags.mtrol[key]; },
      async setFlag(_scope, key, data) {
        counts[key === "states" ? "flags" : "receipts"]++;
        this.flags.mtrol[key] = clone(data);
      },
      async createEmbeddedDocuments(_type, data) {
        counts.effects++;
        const effects = data.map(effect => ({ ...effect, getFlag: (_scope, key) => effect.flags.mtrol[key] }));
        this.effects.push(...effects);
        return effects;
      }
    };
    documents.set(value.uuid, value);
    return value;
  }
  const own = actor("own", "owner"), foreign = actor("foreign", "other");
  const token = { uuid: "Scene.scene.Token.own", documentName: "Token", actor: own,
    object: { async toggleEffect() { counts.icons++; } } };
  documents.set(token.uuid, token);
  const combat = { id: "combat", uuid: "Combat.combat", flags: { mtrol: { runtime: createDefaultRuntime() } },
    async update(data) { counts.combat++; this.flags.mtrol.runtime = clone(data["flags.mtrol.runtime"]); } };
  globalThis.game = { user: users.get("gm"), users, combat, combats: new Map([[combat.id, combat]]),
    actors: new Map([[own.id, own], [foreign.id, foreign]]),
    socket: { emit: (_namespace, data) => emitted.push(data), on: (name, handler) => handlers.set(name, handler) } };
  globalThis.fromUuid = async uuid => documents.get(uuid) ?? null;
  globalThis.ChatMessage = { getSpeaker: ({ actor }) => ({ actor: actor.id }), async create() { counts.chat++; } };
  const payload = (overrides = {}) => ({ actorUuid: own.uuid, state: "stunned", transactionId: `tx-${++nextId}`, ...overrides });
  const pending = (overrides = {}) => {
    const action = { id: "pending", combatId: combat.id, status: "resolving", resolutionTransactionId: "resolution",
      sourceActorUuid: foreign.uuid, targetActorUuid: own.uuid, sourceItemName: "Source", responseItemName: "Response",
      attackerRoll: { total: 20 }, defenderRoll: { total: 10 }, effect: "stunned", responseEffect: "stunned", ...overrides };
    combat.flags.mtrol.runtime.pendingActions[action.id] = clone(action);
    return { combatId: combat.id, pendingActionId: action.id, resolutionResult: { success: true }, requestingUserId: "owner" };
  };
  return { counts, logs, emitted, handlers, users, own, foreign, token, combat, payload, pending };
}

function noWrites(fx) { assert.deepEqual(fx.counts, { flags: 0, receipts: 0, effects: 0, chat: 0, icons: 0, combat: 0 }); }
const reason = code => error => error.reasonCode === code;

test("manual: owner y GM permitidos; flags, efecto y chat una vez por transacción", async () => {
  const fx = fixture();
  const payload = fx.payload();
  const request = { action: "mtrolApplyState", requestingUserId: "owner", payload, transactionId: payload.transactionId };
  assert.equal((await dispatchStateSocketCommand(request)).actorUuid, fx.own.uuid);
  await dispatchStateSocketCommand(request);
  assert.equal(fx.counts.flags, 1); assert.equal(fx.counts.effects, 1); assert.equal(fx.counts.chat, 1);
  await states.applyManualStateAuthoritative(fx.payload({ actorUuid: fx.foreign.uuid }), { requestingUserId: "gm" });
  assert.equal(fx.counts.flags, 2);
});

test("manual ajeno: rechazo estructurado sin flag, receipt, efecto, icono o chat", async () => {
  const fx = fixture();
  await assert.rejects(states.applyManualStateAuthoritative(fx.payload({ actorUuid: fx.foreign.uuid }),
    { requestingUserId: "owner" }), reason("STATE_ACTOR_NOT_OWNED"));
  noWrites(fx);
  assert.equal(fx.logs[0][1].reasonCode, "STATE_ACTOR_NOT_OWNED");
  assert.equal(fx.logs[0][1].actorUuid, fx.foreign.uuid);
});

test("source, mecánica y pendingActionId enviados por cliente nunca otorgan permiso", async () => {
  const fx = fixture(); fx.pending();
  const payload = fx.payload({ actorUuid: fx.foreign.uuid, pendingActionId: "pending", mechanical: true,
    options: { source: "validated-action", pendingActionId: "pending", authoritative: true } });
  await assert.rejects(dispatchStateSocketCommand({ payload, transactionId: payload.transactionId, requestingUserId: "owner" }),
    reason("STATE_ACTOR_NOT_OWNED"));
  noWrites(fx);
});

test("Primary GM revalida ownership actual y no confía en actor.isOwner", async () => {
  const fx = fixture(); fx.own.isOwner = true; fx.own.ownership = {};
  await assert.rejects(states.applyManualStateAuthoritative(fx.payload(), { requestingUserId: "owner" }), reason("STATE_ACTOR_NOT_OWNED"));
  noWrites(fx);
});

test("Token y Actor deben coincidir incluso para GM", async () => {
  const fx = fixture();
  await assert.rejects(states.applyManualStateAuthoritative(fx.payload({ actorUuid: fx.foreign.uuid, tokenUuid: fx.token.uuid }),
    { requestingUserId: "gm" }), reason("STATE_TARGET_INVALID"));
  noWrites(fx);
});

test("no-Primary y usuario desconocido no aplican efectos", async () => {
  const fx = fixture(); game.user = fx.users.get("gm2");
  await assert.rejects(states.applyManualStateAuthoritative(fx.payload(), { requestingUserId: "gm2" }), reason("NOT_PRIMARY_GM"));
  game.user = fx.users.get("gm");
  await assert.rejects(states.applyManualStateAuthoritative(fx.payload(), { requestingUserId: "missing" }), reason("STATE_USER_INVALID"));
  noWrites(fx);
});

test("mecánica válida reconstruye objetivo y estado desde la acción, incluso sobre tercero", async () => {
  const fx = fixture(); const context = fx.pending(); context.resolutionResult.success = false;
  const result = await states.applyResolvedActionStateAuthoritative(context);
  assert.equal(result.actorUuid, fx.foreign.uuid); assert.equal(result.source, "Response");
  await states.applyResolvedActionStateAuthoritative(context);
  assert.equal(fx.counts.flags, 1); assert.equal(fx.counts.effects, 1); assert.equal(fx.counts.chat, 1);
});

test("efecto ofensivo válido usa target canónico, no parámetros del cliente", async () => {
  const fx = fixture(); const context = fx.pending();
  const result = await states.applyResolvedActionStateAuthoritative({ ...context, actorUuid: fx.foreign.uuid, state: "dead" });
  assert.equal(result.actorUuid, fx.own.uuid); assert.equal(result.state, "stunned");
});

test("mecánica rechaza acción inexistente, finalizada, recovery o sin efecto concedido", async () => {
  for (const status of ["resolved", "cancelled", "recovery-required", "waiting-defense"]) {
    const fx = fixture();
    await assert.rejects(states.applyResolvedActionStateAuthoritative(fx.pending({ status })), reason("STATE_ACTION_CONTEXT_INVALID"));
    noWrites(fx);
  }
  const fx = fixture();
  await assert.rejects(states.applyResolvedActionStateAuthoritative(fx.pending({ effect: "none" })), reason("STATE_ACTION_EFFECT_INVALID"));
  noWrites(fx);
});

test("mecánica no permite que usuario ajeno resuelva por el defensor", async () => {
  const fx = fixture();
  await assert.rejects(states.applyResolvedActionStateAuthoritative({ ...fx.pending(), requestingUserId: "other" }), reason("STATE_ACTION_NOT_AUTHORIZED"));
  noWrites(fx);
});

test("replay tras F5 usa receipt persistido; id reutilizado con otro estado se rechaza", async () => {
  const fx = fixture(); const payload = fx.payload();
  await states.applyManualStateAuthoritative(payload, { requestingUserId: "owner" });
  actorRuntimeRepository.resetForTests();
  await states.applyManualStateAuthoritative(payload, { requestingUserId: "owner" });
  assert.equal(fx.counts.chat, 1);
  await assert.rejects(states.applyManualStateAuthoritative({ ...payload, state: "dead" }, { requestingUserId: "owner" }), reason("STATE_TRANSACTION_CONFLICT"));
  assert.equal(fx.counts.chat, 1);
});

test("respuesta perdida tras escritura exige recovery y no repite side effects", async () => {
  const fx = fixture(); const payload = fx.payload();
  const setFlag = fx.own.setFlag.bind(fx.own);
  fx.own.setFlag = async (...args) => { await setFlag(...args); if (args[1] === "states") throw new Error("lost acknowledgement"); };
  await assert.rejects(states.applyManualStateAuthoritative(payload, { requestingUserId: "owner" }), reason("STATE_RECOVERY_REQUIRED"));
  actorRuntimeRepository.resetForTests();
  await assert.rejects(states.applyManualStateAuthoritative(payload, { requestingUserId: "owner" }), reason("STATE_RECOVERY_REQUIRED"));
  assert.equal(fx.counts.flags, 1); assert.equal(fx.counts.effects, 0); assert.equal(fx.counts.chat, 0);
});

test("socket real responde reasonCode; spoof y target ajeno tienen cero side effects", async () => {
  const fx = fixture(); registerMtrolSockets();
  const handler = fx.handlers.get("system.mtrol");
  await handler({ action: "mtrolApplyState", requestId: "r1", requestingUserId: "gm", payload: fx.payload() }, "owner");
  assert.equal(fx.emitted.at(-1).reasonCode, "SENDER_SPOOFED");
  await handler({ action: "mtrolApplyState", requestId: "r2", requestingUserId: "owner", payload: fx.payload({ actorUuid: fx.foreign.uuid }) }, "owner");
  assert.equal(fx.emitted.at(-1).ok, false);
  assert.equal(fx.emitted.at(-1).reasonCode, "STATE_ACTOR_NOT_OWNED"); noWrites(fx);
});

test("registro idempotente, façade preservada y ruta insegura físicamente retirada", async () => {
  fixture(); registerStateCommands(); const size = commandRegistry.handlers.size; registerStateCommands();
  assert.equal(commandRegistry.handlers.size, size);
  const old = () => {}; game.mtrol = { states: { syncDeathState: old } };
  states.installMtrolStatesApi(); states.installMtrolStatesApi();
  assert.equal(game.mtrol.states.applyState, states.applyState); assert.equal(game.mtrol.states.syncDeathState, old);
  assert.equal(game.mtrol.states.applyResolvedActionStateAuthoritative, undefined);
  const source = await readFile(new URL("../scripts/core/sockets.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /applyStateFromSocket/);
  assert.match(source, /respondWithResult\(request, \(\) => dispatchStateSocketCommand\(request\)\)/);
});

test("la façade del propietario delega y recibe el reasonCode del Primary GM", async () => {
  const fx = fixture(); game.user = fx.users.get("owner");
  game.socket.emit = (_namespace, request) => {
    assert.equal(request.action, "mtrolApplyState");
    assert.equal(request.payload.actorUuid, fx.foreign.uuid);
    handleSocketResponse({ action: "mtrolSocketResponse", requestId: request.requestId,
      targetUserId: "owner", ok: false, error: "Actor ajeno", reasonCode: "STATE_ACTOR_NOT_OWNED" }, { senderUserId: "gm" });
  };
  await assert.rejects(states.applyState(fx.foreign, "stunned"), reason("STATE_ACTOR_NOT_OWNED"));
  noWrites(fx);
});

test("recovery-required bloquea un nuevo transactionId sin nuevos side effects", async () => {
  const fx = fixture();
  fx.own.flags.mtrol.transactionRuntime = { schemaVersion: 1, revision: 1, receipts: {} };
  setReceiptInRuntime(fx.own.flags.mtrol.transactionRuntime, "broken", {
    transactionId: "broken", command: "state.apply", actorUuid: fx.own.uuid,
    status: "recovery-required", state: "stunned", updatedAt: Date.now()
  });
  await assert.rejects(states.applyManualStateAuthoritative(fx.payload(), { requestingUserId: "owner" }), reason("STATE_RECOVERY_REQUIRED"));
  noWrites(fx);
});

test("identificador de Item y UUID malformado no se aceptan como Actor", async () => {
  const fx = fixture(); fx.own.documentName = "Item";
  await assert.rejects(states.applyManualStateAuthoritative(fx.payload(), { requestingUserId: "gm" }), reason("STATE_TARGET_INVALID"));
  globalThis.fromUuid = async () => { throw new Error("Invalid UUID"); };
  await assert.rejects(states.applyManualStateAuthoritative(fx.payload(), { requestingUserId: "gm" }), reason("STATE_TARGET_INVALID"));
  noWrites(fx);
});

test("recovery de Foundation reconoce estados interrumpidos tras F5", async () => {
  const fx = fixture();
  fx.own.flags.mtrol.transactionRuntime = { schemaVersion: 1, revision: 1, receipts: {} };
  setReceiptInRuntime(fx.own.flags.mtrol.transactionRuntime, "interrupted", {
    transactionId: "interrupted", command: "state.apply", actorUuid: fx.own.uuid,
    status: "applying", state: "stunned", updatedAt: Date.now()
  });
  actorRuntimeRepository.resetForTests();
  const recovered = await recoveryCoordinator.recoverActorTransactions([fx.own], { isPrimaryGM: true });
  assert.deepEqual(recovered.requiredIds, ["interrupted"]);
  const before = { ...fx.counts };
  await assert.rejects(states.applyManualStateAuthoritative(fx.payload(), { requestingUserId: "owner" }), reason("STATE_RECOVERY_REQUIRED"));
  assert.deepEqual(fx.counts, before);
  assert.equal(fx.counts.flags, 0); assert.equal(fx.counts.effects, 0); assert.equal(fx.counts.chat, 0);
});
