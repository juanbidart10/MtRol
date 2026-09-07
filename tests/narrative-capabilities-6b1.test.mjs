import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveNarrativeCapabilities, collectNarrativeCapabilities } from "../scripts/effects/narrative-capability-resolver.js";
import { getRacialPassiveDefinition } from "../scripts/races/racial-passive-catalog.js";
import { declareNarrativeCapabilityAuthoritative } from "../scripts/effects/narrative-capability-service.js";
import { declareNarrativeCapability, dispatchNarrativeCapabilityCommand, registerNarrativeCapabilityCommands } from "../scripts/runtime/narrative-capability-commands.js";
import { onDeclareNarrativeCapability } from "../scripts/sheets/actors/personaje-narrative-controller.js";
import { actorRuntimeRepository, actorReceiptStore, commandRegistry } from "../scripts/runtime/runtime-foundation.js";
import { buildNarrativeCapabilityCard } from "../scripts/ui/narrative-capability-card.js";
import { registerMtrolSockets } from "../scripts/core/sockets.js";
import { resolveInitiativeEffects } from "../scripts/effects/effect-pipeline.js";

let sequence = 0;
let socketListener;
globalThis.foundry = { utils: { randomID: () => `req${++sequence}`, deepClone: structuredClone } };
globalThis.ui = { notifications: { warn() {}, info() {} } };
globalThis.Roll = class { constructor() { throw new Error("No deben existir tiradas narrativas"); } };

const expected = [
  ["elfo", "comunicacion_animal", "speak_with_animals", "Comunicación Animal"],
  ["sellado", "anima", "reshape_own_body", "Ánima"],
  ["hada", "virtus", "flight", "Vuelo"],
  ["animalium", "instinto_racial", "see_hidden_targets", "Detectar Ocultos"],
  ["elfo_oscuro", "maldito_alimentacion", "feed_on_living_being", "Alimentarse"]
];

function fixture(raceId = "elfo", { synthetic = false, combat = false } = {}) {
  actorRuntimeRepository.resetForTests();
  const users = new Map([
    ["gm", { id: "gm", name: "GM", isGM: true, active: true, viewedScene: "scene" }],
    ["other-gm", { id: "other-gm", name: "GM 2", isGM: true, active: true, viewedScene: "scene" }],
    ["owner", { id: "owner", name: "Jugadora", active: true, viewedScene: "scene" }],
    ["stranger", { id: "stranger", name: "Ajeno", active: true, viewedScene: "scene" }]
  ]);
  const scene = { id: "scene", name: "Pradera" };
  const actor = {
    documentName: "Actor", id: "actor", uuid: synthetic ? "Scene.scene.Token.token.Actor.actor" : "Actor.actor",
    name: "Aldren", ownership: { owner: 3 }, flags: {},
    system: { identidad: { raceId }, atributos: { fuerza: 4 }, vitales: { hp: { value: 5 }, mp: { value: 2 } } },
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
    async setFlag(scope, key, value) {
      assert.equal(scope, "mtrol"); assert.equal(key, "transactionRuntime", "única escritura permitida: receipt de auditoría");
      this.flags.mtrol ??= {}; this.flags.mtrol[key] = structuredClone(value);
    },
    async update() { throw new Error("No debe mutar gameplay del Actor"); }
  };
  const token = {
    documentName: "Token", id: "token", uuid: "Scene.scene.Token.token", actor, parent: scene,
    x: 0, y: 0, elevation: 0, hidden: true, width: 1, height: 1,
    async update() { throw new Error("No debe mutar Token"); }
  };
  if (synthetic) actor.token = token;
  const messages = new Map();
  const docs = new Map([[actor.uuid, actor], [token.uuid, token]]);
  const sends = [];
  globalThis.fromUuid = async uuid => docs.get(uuid) ?? null;
  globalThis.game = {
    user: users.get("gm"), users, actors: new Map([[actor.id, actor]]), scenes: new Map([[scene.id, scene]]), messages,
    combat: combat ? { id: "combat", round: 9, turn: 3, flags: { mtrol: { actionConsumed: true } } } : null,
    socket: { on(_channel, listener) { socketListener = listener; }, emit(channel, data) { sends.push({ channel, data }); } }
  };
  globalThis.ChatMessage = { async create(data) {
    assert.equal(data.author, "gm");
    const message = { ...data, id: `message${++sequence}`, author: users.get(data.author) };
    messages.set(message.id, message);
    return message;
  } };
  return { actor, token, scene, users, messages, sends };
}

function payload(actor, capabilityId = "speak_with_animals", transactionId = `req${++sequence}`) {
  return { actorUuid: actor.uuid, capabilityId, transactionId };
}
const owner = { requestingUserId: "owner" };
function snapshot(fx) {
  return structuredClone({ system: fx.actor.system, ownership: fx.actor.ownership,
    token: { x: fx.token.x, y: fx.token.y, elevation: fx.token.elevation, hidden: fx.token.hidden, width: fx.token.width, height: fx.token.height },
    combat: game.combat, flags: Object.fromEntries(Object.entries(fx.actor.flags.mtrol ?? {}).filter(([key]) => key !== "transactionRuntime")) });
}

for (const [raceId, passiveId, capabilityId, label] of expected) {
  test(`6B.1 ${label}: se deriva de pasiva y sólo crea declaración y receipt, dentro/fuera de Combat`, async () => {
    for (const combat of [false, true]) {
      const fx = fixture(raceId, { combat });
      const before = snapshot(fx);
      const resolved = resolveNarrativeCapabilities(fx.actor);
      assert.equal(resolved.capabilities.length, 1);
      assert.equal(resolved.capabilities[0].technicalId, capabilityId);
      assert.equal(resolved.capabilities[0].passiveId, passiveId);
      const result = await declareNarrativeCapabilityAuthoritative(payload(fx.actor, capabilityId), owner);
      assert.equal(result.capabilityId, capabilityId);
      assert.equal(result.passiveId, passiveId);
      assert.equal(result.displayName, label);
      assert.equal(result.userId, "owner");
      assert.equal(result.sceneId, "scene");
      assert.ok(result.timestamp > 0);
      assert.equal(fx.messages.size, 1);
      const message = fx.messages.get(result.messageId);
      assert.equal(message.rolls, undefined);
      assert.deepEqual(message.whisper, ["gm", "other-gm", "owner"]);
      assert.match(message.content, /criterio del GM/);
      assert.deepEqual(snapshot(fx), before);
    }
  });
}

test("6B.1 cambio de Raza/F5 deriva sin flags de capabilities ni estado stale", () => {
  const fx = fixture();
  for (const [raceId, ids] of [["elfo", ["speak_with_animals"]], ["gnomo", []], ["hada", ["flight"]], ["animalium", ["see_hidden_targets"]]]) {
    fx.actor.system.identidad.raceId = raceId;
    assert.deepEqual(resolveNarrativeCapabilities(fx.actor).capabilities.map(entry => entry.technicalId), ids);
    const reload = { uuid: fx.actor.uuid, system: structuredClone(fx.actor.system) };
    assert.deepEqual(resolveNarrativeCapabilities(reload).capabilities, resolveNarrativeCapabilities(fx.actor).capabilities);
  }
  assert.deepEqual(fx.actor.flags, {});
});

test("6B.1 declarar Detectar Ocultos no pierde ni duplica iniciativa +10", async () => {
  const fx = fixture("animalium");
  const before = resolveInitiativeEffects(fx.actor, 12);
  assert.equal(before.value, 22);
  await declareNarrativeCapabilityAuthoritative(payload(fx.actor, "see_hidden_targets"), owner);
  const after = resolveInitiativeEffects(fx.actor, 12);
  assert.equal(after.value, 22);
  assert.equal(after.appliedEffects.length, 1);
});

test("6B.1 una declaración sin escena no necesita Token ni escena artificial", async () => {
  const fx = fixture();
  fx.users.get("owner").viewedScene = null;
  const result = await declareNarrativeCapabilityAuthoritative(payload(fx.actor), owner);
  assert.equal(result.sceneId, null);
  assert.equal(result.tokenUuid, null);
});

test("6B.1 un provider futuro de Despertar otorga capability sin depender de Raza", () => {
  const fx = fixture("humano");
  const providers = [{ id: "future-awakening", resolve: () => ({ passiveIds: ["comunicacion_animal", "comunicacion_animal"] }) }];
  assert.deepEqual(resolveNarrativeCapabilities(fx.actor, { providers }).capabilities.map(entry => entry.technicalId), ["speak_with_animals"]);
});

test("6B.1 deduplica capability entre pasivas conservando fuentes", () => {
  const first = getRacialPassiveDefinition("comunicacion_animal");
  const capabilities = collectNarrativeCapabilities([first, { ...first, technicalId: "future-source" }, first]);
  assert.equal(capabilities.length, 1);
  assert.deepEqual(capabilities[0].passiveIds, ["comunicacion_animal", "future-source"]);
});

test("6B.1 identidad ausente, inválida y pasiva desconocida no rompen la hoja", () => {
  const fx = fixture("");
  assert.deepEqual(resolveNarrativeCapabilities(fx.actor).capabilities, []);
  fx.actor.system.identidad = { raceId: "corrupt", raza: "Elfo" };
  const diagnostics = [];
  const log = { warnOnce: (_channel, _message, data) => diagnostics.push(data) };
  assert.deepEqual(resolveNarrativeCapabilities(fx.actor, { log }).capabilities, []);
  assert.equal(diagnostics[0].code, "RACE_ID_UNKNOWN");
  const result = resolveNarrativeCapabilities(fx.actor, { log,
    providers: [{ resolve: () => ({ passiveIds: ["unknown-passive"] }) }] });
  assert.deepEqual(result.capabilities, []);
  assert.equal(result.diagnostics[0].code, "PASSIVE_ID_UNKNOWN");
});

test("6B.1 posesión/Trascendental quedan sin botones y Alimentación no pertenece a Maldición", () => {
  for (const race of ["maldito", "espectral"]) assert.deepEqual(resolveNarrativeCapabilities(fixture(race).actor).capabilities, []);
  assert.equal(getRacialPassiveDefinition("trascendental").effects.length, 4);
  assert.equal(getRacialPassiveDefinition("maldito_alimentacion").effects[0].type, "CAPABILITY");
});

test("6B.1 owner/GM permitidos; ajeno, capability falsa y botón stale rechazados", async () => {
  const fx = fixture();
  await declareNarrativeCapabilityAuthoritative(payload(fx.actor), owner);
  await declareNarrativeCapabilityAuthoritative(payload(fx.actor), { requestingUserId: "other-gm" });
  for (const [data, context] of [
    [payload(fx.actor), { requestingUserId: "stranger" }],
    [payload(fx.actor, "flight"), owner],
    [payload(fx.actor, "possession"), owner],
    [{ ...payload(fx.actor), passiveId: "virtus" }, owner],
    [{ ...payload(fx.actor), amount: 50 }, owner]
  ]) await assert.rejects(declareNarrativeCapabilityAuthoritative(data, context));
  fx.actor.system.identidad.raceId = "gnomo";
  await assert.rejects(declareNarrativeCapabilityAuthoritative(payload(fx.actor), owner), /ya no está activa/);
  assert.equal(fx.messages.size, 2);
});

test("6B.1 doble socket y replay tras reload no duplican Chat", async () => {
  const fx = fixture();
  const data = payload(fx.actor);
  const results = await Promise.all(Array.from({ length: 5 }, () => declareNarrativeCapabilityAuthoritative(data, owner)));
  assert.equal(new Set(results.map(result => result.messageId)).size, 1);
  assert.equal(fx.messages.size, 1);
  actorRuntimeRepository.resetForTests();
  assert.equal((await declareNarrativeCapabilityAuthoritative(data, owner)).messageId, results[0].messageId);
  assert.equal(fx.messages.size, 1);
  assert.equal(actorReceiptStore.inFlight.size, 0);
});

test("6B.1 un cambio de Primary GM recupera receipt sin publicar otra declaración", async () => {
  const fx = fixture();
  const data = payload(fx.actor);
  const result = await declareNarrativeCapabilityAuthoritative(data, owner);
  fx.users.get("gm").active = false;
  game.user = fx.users.get("other-gm");
  actorRuntimeRepository.resetForTests();
  assert.equal((await declareNarrativeCapabilityAuthoritative(data, owner)).messageId, result.messageId);
  assert.equal(fx.messages.size, 1);
});

test("6B.1 si se pierde confirmación después de crear Chat, el reintento recupera su evidencia", async () => {
  const fx = fixture();
  const data = payload(fx.actor);
  const create = ChatMessage.create;
  ChatMessage.create = async input => { await create(input); throw new Error("confirmación interrumpida"); };
  await assert.rejects(declareNarrativeCapabilityAuthoritative(data, owner), /interrumpida/);
  assert.equal(fx.messages.size, 1);
  actorRuntimeRepository.resetForTests();
  const result = await declareNarrativeCapabilityAuthoritative(data, owner);
  assert.ok(fx.messages.has(result.messageId));
  assert.equal(fx.messages.size, 1);
});

test("6B.1 Actor sin Token, sintético y contexto de escena validado", async () => {
  const plain = fixture();
  assert.equal((await declareNarrativeCapabilityAuthoritative(payload(plain.actor), owner)).tokenUuid, null);
  const fx = fixture("hada", { synthetic: true });
  const before = snapshot(fx);
  const result = await declareNarrativeCapabilityAuthoritative(payload(fx.actor, "flight"), owner);
  assert.equal(result.tokenUuid, fx.token.uuid);
  assert.deepEqual(snapshot(fx), before);
  await assert.rejects(declareNarrativeCapabilityAuthoritative({ ...payload(fx.actor, "flight"), tokenUuid: "bad" }, owner), /Token/);
  fx.users.get("owner").viewedScene = "other";
  const elsewhere = await declareNarrativeCapabilityAuthoritative(payload(fx.actor, "flight"), owner);
  assert.equal(elsewhere.sceneId, "scene");
  assert.equal(elsewhere.sceneName, null, "no revelar el nombre de una escena que el jugador no está viendo");
});

test("6B.1 command registrado reutiliza autoridad Primary GM sin requerir Combat", async () => {
  const fx = fixture();
  registerNarrativeCapabilityCommands();
  assert.equal(commandRegistry.handlers.get("capability.narrative-declare").scope, "world");
  const result = await dispatchNarrativeCapabilityCommand({ payload: payload(fx.actor), requestingUserId: "owner" });
  assert.ok(result.messageId);
  game.user = fx.users.get("owner");
  await assert.rejects(dispatchNarrativeCapabilityCommand({ payload: payload(fx.actor), requestingUserId: "owner" }), /Primary GM/);
});

test("6B.1 transporte autentica al emisor y una suplantación no llega a Chat", async () => {
  const fx = fixture();
  registerMtrolSockets();
  const request = { action: "mtrolDeclareNarrativeCapability", requestId: "socket1", payload: payload(fx.actor), requestingUserId: "owner", targetGMId: "gm" };
  await socketListener(request, "stranger");
  assert.equal(fx.messages.size, 0);
  assert.equal(fx.sends.at(-1).data.reasonCode, "SENDER_SPOOFED");
  await socketListener(request, "owner");
  assert.equal(fx.messages.size, 1);
  assert.equal(fx.sends.at(-1).data.ok, true);
});

test("6B.1 cliente player reutiliza transporte, no crea Chat local y exige GM conectado", async () => {
  const fx = fixture();
  game.user = fx.users.get("owner");
  const operation = declareNarrativeCapability(fx.actor, "speak_with_animals");
  const request = fx.sends.at(-1).data;
  assert.equal(request.action, "mtrolDeclareNarrativeCapability");
  assert.equal(request.combatId, null);
  assert.equal(fx.messages.size, 0);
  game.user = fx.users.get("gm");
  await socketListener(request, "owner");
  const response = fx.sends.at(-1).data;
  game.user = fx.users.get("owner");
  await socketListener(response, "gm");
  assert.ok((await operation).messageId);
  fx.users.get("gm").active = false; fx.users.get("other-gm").active = false;
  await assert.rejects(declareNarrativeCapability(fx.actor, "speak_with_animals"), /GM conectado/);
});

test("6B.1 click del botón declara; doble click inmediato sólo registra uno", async () => {
  const fx = fixture();
  let renders = 0;
  const sheet = { actor: fx.actor, render() { renders++; } };
  const button = { disabled: false, dataset: { capabilityId: "speak_with_animals" } };
  const event = { currentTarget: button, detail: 1, preventDefault() {}, stopPropagation() {} };
  const first = onDeclareNarrativeCapability.call(sheet, event);
  assert.equal(await onDeclareNarrativeCapability.call(sheet, event), false);
  assert.equal(await first, true);
  assert.equal(fx.messages.size, 1);
  assert.equal(renders, 1);
  assert.equal(sheet._mtrolNarrativeDeclarationPending, false);
  button.disabled = false;
  assert.equal(await onDeclareNarrativeCapability.call(sheet, { ...event, detail: 2 }), false);
  assert.equal(fx.messages.size, 1);
});

test("6B.1 Chat escapa nombres/descripciones y no publica secretos a terceros", async () => {
  const fx = fixture(); fx.actor.name = '<img src=x onerror="alert(1)">';
  const result = await declareNarrativeCapabilityAuthoritative(payload(fx.actor), owner);
  assert.doesNotMatch(buildNarrativeCapabilityCard(result), /<img/);
  assert.match(buildNarrativeCapabilityCard(result), /&lt;img/);
  assert.equal(fx.messages.get(result.messageId).whisper.includes("stranger"), false);
});

test("6B.1 UI dinámica, no race-specific ni motor de turnos/dados en la nueva ruta", async () => {
  const read = path => readFile(new URL(path, import.meta.url), "utf8");
  const [template, sheet, resolver, service, controller] = await Promise.all([
    read("../templates/actors/personaje-sheet.html"), read("../scripts/sheets/actors/personaje-sheet.js"),
    read("../scripts/effects/narrative-capability-resolver.js"), read("../scripts/effects/narrative-capability-service.js"),
    read("../scripts/sheets/actors/personaje-narrative-controller.js")
  ]);
  assert.match(template, /#each narrativeCapabilities/);
  assert.match(template, /data-capability-id="\{\{technicalId\}\}"/);
  assert.match(sheet, /context.narrativeCapabilities = resolveNarrativeCapabilities\(this.actor\).capabilities/);
  assert.match(sheet, /onDeclareNarrativeCapability.bind\(this\)/);
  assert.doesNotMatch(resolver, /raceId|race-catalog|sourceRaceId/);
  assert.doesNotMatch(service + controller, /new Roll|actionConsumed|TurnState|pendingAction|game\.combat|game\.mtrol|\.elevation\s*=/);
});
