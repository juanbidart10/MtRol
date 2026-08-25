import test from "node:test";
import assert from "node:assert/strict";

globalThis.foundry = { utils: { deepClone: structuredClone, duplicate: structuredClone, randomID: () => "p6" } };
const gm = { id: "gm", name: "GM", isGM: true, active: true };
const userA = { id: "a", isGM: false, active: true };
const userB = { id: "b", isGM: false, active: true };
const users = [gm, userA, userB]; users.get = id => users.find(user => user.id === id) ?? null;
const emitted = [];
globalThis.game = { user: gm, users, socket: { emit: (_channel, payload) => emitted.push(payload) } };
globalThis.Hooks = { callAll() {}, on() {} };
globalThis.ui = { notifications: { warn() {} } };

function actor(id, owner) {
  const items = []; items.get = itemId => items.find(item => item.id === itemId) ?? null;
  return { id, uuid: `Actor.${id}`, type: "personaje", system: { equipamiento: {} }, items, testUserPermission: user => user.id === owner.id };
}

function item(parent, id, quantity = 10) {
  const system = { tipoObjeto: "general", cantidad: quantity, peso: 1, equipado: false, slot: "" };
  const value = { id, uuid: `${parent.uuid}.Item.${id}`, name: id, img: "icons/item.webp", type: "objeto", parent, system, _source: { system: structuredClone(system) } };
  parent.items.push(value); return value;
}

const actorA = actor("a", userA); const actorB = actor("b", userB);
const offered = item(actorA, "offered", 10); const unrelated = item(actorA, "unrelated", 5);
const tokenA = { id: "ta", uuid: "Scene.s.Token.ta", actor: actorA, x: 0, y: 0, elevation: 0 };
const tokenB = { id: "tb", uuid: "Scene.s.Token.tb", actor: actorB, x: 100, y: 0, elevation: 0 };
const documents = new Map([[actorA.uuid, actorA], [actorB.uuid, actorB], [offered.uuid, offered], [unrelated.uuid, unrelated], [tokenA.uuid, tokenA], [tokenB.uuid, tokenB]]);
globalThis.fromUuid = async uuid => documents.get(String(uuid)) ?? null;

const { tradeSessionStore } = await import("../scripts/trade/trade-authority.js");
const { tradeMovementLocks } = await import("../scripts/trade/trade-proximity-service.js");
const {
  handleTradeActorDeleted,
  handleTradeItemMutation,
  handleTradeTokenDeleted,
  handleTradeUserConnection
} = await import("../scripts/trade/trade-lifecycle-service.js");

let operation = 0;
async function negotiating({ withOffer = true } = {}) {
  tradeSessionStore.reset(); tradeMovementLocks.clear(); emitted.length = 0;
  offered.system.cantidad = 10; offered._source.system.cantidad = 10; offered.system.equipado = false; offered.system.slot = "";
  actorA.system.equipamiento = {};
  tradeSessionStore.reconcileAuthority({ gmUserId: gm.id, epoch: "p6" });
  let session = await tradeSessionStore.createSession({
    participantA: { userId: userA.id, actorUuid: actorA.uuid, tokenUuid: tokenA.uuid },
    participantB: { userId: userB.id, actorUuid: actorB.uuid, tokenUuid: tokenB.uuid },
    authority: { gmUserId: gm.id, epoch: "p6" }, operationId: `create-${++operation}`
  });
  session = await tradeSessionStore.acceptSession({ sessionId: session.id, participantKey: "participantB", requestingUserId: userB.id, operationId: `accept-${++operation}` });
  tradeMovementLocks.lockSession(session, { participantA: tokenA, participantB: tokenB });
  if (withOffer) session = await tradeSessionStore.setOffer({ sessionId: session.id, participantKey: "participantA", requestingUserId: userA.id, entries: [{ itemUuid: offered.uuid, itemId: offered.id, quantity: 6 }], operationId: `offer-${++operation}` });
  return session;
}

test("6-01 desconexión A cancela", async () => { const s = await negotiating(); await handleTradeUserConnection(userA, false); assert.equal(tradeSessionStore.getSession(s.id).state, "CANCELLED"); });
test("6-02 desconexión B cancela", async () => { const s = await negotiating(); await handleTradeUserConnection(userB, false); assert.equal(tradeSessionStore.getSession(s.id).state, "CANCELLED"); });
test("6-03 desconexión libera reservas", async () => { const s = await negotiating(); await handleTradeUserConnection(userA, false); assert.equal(tradeSessionStore.getReservationsForSession(s.id).length, 0); });
test("6-04 desconexión libera movement locks", async () => { await negotiating(); await handleTradeUserConnection(userA, false); assert.equal(tradeMovementLocks.count(), 0); });
test("6-05 sesión desaparece del índice activo", async () => { await negotiating(); await handleTradeUserConnection(userA, false); assert.equal(tradeSessionStore.getActiveSessionIdForActor(actorA.uuid), null); });
test("6-06 cliente restante recibe terminal", async () => { await negotiating(); await handleTradeUserConnection(userA, false); assert.equal(emitted.at(-1).session.state, "CANCELLED"); });

test("6-07 Item ofertado eliminado invalida entrada", async () => { const s = await negotiating(); await handleTradeItemMutation(offered, { deleted: true }); assert.equal(tradeSessionStore.getSession(s.id).invalidEntries[0].reason, "Objeto eliminado"); });
test("6-08 Item no ofertado eliminado no afecta", async () => { const s = await negotiating(); await handleTradeItemMutation(unrelated, { deleted: true }); assert.equal(tradeSessionStore.getSession(s.id).revision, s.revision); });
test("6-09 cantidad reducida invalida", async () => { const s = await negotiating(); offered.system.cantidad = 4; offered._source.system.cantidad = 4; await handleTradeItemMutation(offered); assert.equal(tradeSessionStore.getSession(s.id).invalidEntries.length, 1); });
test("6-10 cantidad aumentada mantiene validez", async () => { const s = await negotiating(); offered.system.cantidad = 12; offered._source.system.cantidad = 12; await handleTradeItemMutation(offered); assert.equal(tradeSessionStore.getSession(s.id).revision, s.revision); });
test("6-11 Item ofertado equipado invalida", async () => { const s = await negotiating(); offered.system.equipado = true; offered.system.slot = "manoDer"; actorA.system.equipamiento.manoDer = offered.id; await handleTradeItemMutation(offered); assert.equal(tradeSessionStore.getSession(s.id).invalidEntries[0].reason, "Objeto equipado"); });

test("6-12 invalidación limpia confirmaciones", async () => { const s = await negotiating(); const raw = tradeSessionStore.sessions.get(s.id); raw.confirmations.participantA = { confirmed: true, revision: raw.revision }; await handleTradeItemMutation(offered, { deleted: true }); assert.equal(tradeSessionStore.getSession(s.id).confirmations.participantA.confirmed, false); });
test("6-13 invalidación aumenta revisión", async () => { const s = await negotiating(); await handleTradeItemMutation(offered, { deleted: true }); assert.equal(tradeSessionStore.getSession(s.id).revision, s.revision + 1); });
test("6-14 mutación corregible no cancela sesión", async () => { const s = await negotiating(); await handleTradeItemMutation(offered, { deleted: true }); assert.equal(tradeSessionStore.getSession(s.id).state, "NEGOTIATING"); });
test("6-15 corrección permite volver a negociar", async () => { const s = await negotiating(); offered.system.cantidad = 4; offered._source.system.cantidad = 4; await handleTradeItemMutation(offered); offered.system.cantidad = 10; offered._source.system.cantidad = 10; const corrected = await tradeSessionStore.setOffer({ sessionId: s.id, participantKey: "participantA", requestingUserId: userA.id, entries: [{ itemUuid: offered.uuid, itemId: offered.id, quantity: 4 }], operationId: `correct-${++operation}` }); assert.equal(corrected.invalidEntries.length, 0); });

test("6-16 Token eliminado limpia sesión", async () => { const s = await negotiating(); await handleTradeTokenDeleted(tokenA); assert.equal(tradeSessionStore.getSession(s.id).state, "INVALID"); });
test("6-17 Actor eliminado limpia sesión", async () => { const s = await negotiating(); await handleTradeActorDeleted(actorA); assert.equal(tradeSessionStore.getSession(s.id).state, "INVALID"); });
test("6-18 cambio GM no deja locks zombie", async () => { const s = await negotiating(); const invalidated = tradeSessionStore.reconcileAuthority({ gmUserId: "other", epoch: "new" }); invalidated.forEach(value => tradeMovementLocks.releaseSession(value.id)); assert.equal(tradeMovementLocks.count(), 0); });
test("6-19 cambio GM no deja reservas zombie", async () => { await negotiating(); tradeSessionStore.reconcileAuthority({ gmUserId: "other", epoch: "new2" }); assert.equal(tradeSessionStore.getReservationsForSession(tradeSessionStore.listSessions()[0].id).length, 0); });

test("6-20 desconexión durante EXECUTING no cancela ni duplica", async () => { const s = await negotiating({ withOffer: false }); tradeSessionStore.sessions.get(s.id).state = "EXECUTING"; const result = await handleTradeUserConnection(userA, false); assert.equal(result.length, 0); assert.equal(tradeSessionStore.getSession(s.id).state, "EXECUTING"); });
test("6-21 hook repetido es idempotente", async () => { const s = await negotiating(); await handleTradeItemMutation(offered, { deleted: true }); const once = tradeSessionStore.getSession(s.id); await handleTradeItemMutation(offered, { deleted: true }); assert.equal(tradeSessionStore.getSession(s.id).revision, once.revision); });
test("6-22 updates propios de transferencia se ignoran", async () => { const s = await negotiating(); offered.system.cantidad = 1; offered._source.system.cantidad = 1; await handleTradeItemMutation(offered, { options: { mtrolTradeExecutionId: "exec" } }); assert.equal(tradeSessionStore.getSession(s.id).revision, s.revision); });
