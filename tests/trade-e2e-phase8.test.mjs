import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

globalThis.foundry = { utils: { deepClone: structuredClone, duplicate: structuredClone, randomID: () => "p8" } };
const { TradeSessionStore } = await import("../scripts/trade/trade-session-service.js");
const { TradeTransferCoordinator, prepareTradeTransferPlan } = await import("../scripts/trade/trade-transfer-service.js");
const { buildGMTradeView, buildPublicTradeSessionView } = await import("../scripts/trade/trade-view-model.js");
const { tradeRuntimeRepository } = await import("../scripts/trade/trade-runtime-repository.js");

test.beforeEach(() => tradeRuntimeRepository.resetForTests());

let createdId = 0; let operation = 0;
function actor(id, specs = []) {
  const items = []; items.get = itemId => items.find(item => item.id === itemId) ?? null;
  const value = {
    id, uuid: `Actor.${id}`, items, system: { equipamiento: {} },
    async createEmbeddedDocuments(_type, data) { return data.map(source => { const item = makeItem(value, `new-${++createdId}`, source.name, source.system.cantidad); item.system.tipoObjeto = source.system.tipoObjeto; items.push(item); return item; }); },
    async updateEmbeddedDocuments(_type, updates) { for (const update of updates) { const item = items.get(update._id); item.system.cantidad = update["system.cantidad"]; item._source.system.cantidad = update["system.cantidad"]; } },
    async deleteEmbeddedDocuments(_type, ids) { for (const itemId of ids) { const index = items.findIndex(item => item.id === itemId); if (index >= 0) items.splice(index, 1); } }
  };
  for (const spec of specs) items.push(makeItem(value, spec.id, spec.name, spec.quantity, spec.type));
  return value;
}
function makeItem(parent, id, name, quantity, type = "general") { const system = { cantidad: quantity, tipoObjeto: type, peso: 1, equipado: false, slot: "" }; return { id, uuid: `${parent.uuid}.Item.${id}`, name, img: "i.webp", type: "objeto", parent, system, _source: { system: structuredClone(system) }, toObject() { return { _id: id, name, type: "objeto", system: structuredClone(this.system) }; } }; }
function fixture() {
  const a = actor(`a${++operation}`, [{ id: "potion", name: "Poción", quantity: 10 }]);
  const b = actor(`b${operation}`, [{ id: "coin", name: "Moneda", quantity: 20, type: "moneda" }]);
  const actors = new Map([[a.uuid, a], [b.uuid, b]]);
  const items = new Map([...a.items, ...b.items].map(item => [item.uuid, item]));
  const store = new TradeSessionStore({
    idFactory: () => `session-${operation}`,
    resolveRealQuantity: reference => items.get(reference.itemUuid)?.system.cantidad ?? 0,
    resolveOfferItem: reference => ({ publicSnapshot: { itemUuid: reference.itemUuid, itemId: reference.itemId, name: items.get(reference.itemUuid).name, img: "i.webp", type: "objeto", tipoObjeto: items.get(reference.itemUuid).system.tipoObjeto, quantity: reference.quantity, description: "", publicData: {} } })
  });
  store.reconcileAuthority({ gmUserId: "gm", epoch: "p8" });
  return { a, b, actors, items, store };
}
async function negotiate(f, { offerA = 3, offerB = 4 } = {}) {
  let s = await f.store.createSession({ participantA: { userId: "a", actorUuid: f.a.uuid }, participantB: { userId: "b", actorUuid: f.b.uuid }, authority: { gmUserId: "gm", epoch: "p8" }, operationId: `c-${++operation}` });
  s = await f.store.acceptSession({ sessionId: s.id, participantKey: "participantB", requestingUserId: "b", operationId: `a-${++operation}` });
  if (offerA !== null) s = await f.store.setOffer({ sessionId: s.id, participantKey: "participantA", requestingUserId: "a", entries: [{ itemUuid: f.a.items.get("potion").uuid, itemId: "potion", quantity: offerA }], operationId: `oa-${++operation}` });
  if (offerB !== null) s = await f.store.setOffer({ sessionId: s.id, participantKey: "participantB", requestingUserId: "b", entries: [{ itemUuid: f.b.items.get("coin").uuid, itemId: "coin", quantity: offerB }], operationId: `ob-${++operation}` });
  return s;
}
async function confirmBoth(f, s) { s = await f.store.confirmSession({ sessionId: s.id, participantKey: "participantA", requestingUserId: "a", revision: s.revision, operationId: `ca-${++operation}` }); return f.store.confirmSession({ sessionId: s.id, participantKey: "participantB", requestingUserId: "b", revision: s.revision, operationId: `cb-${++operation}` }); }

test("8-A flujo completo termina en COMPLETED con transferencia bilateral", async () => {
  const f = fixture(); let s = await confirmBoth(f, await negotiate(f)); const executionId = `e-${operation}`;
  const plan = await prepareTradeTransferPlan({ session: s, executionId, resolveActor: uuid => f.actors.get(uuid) });
  s = await f.store.beginExecution({ sessionId: s.id, authorityUserId: "gm", executionId, revision: s.revision, operationId: `be-${++operation}` });
  await new TradeTransferCoordinator().executePlan(plan); s = await f.store.completeSession({ sessionId: s.id, authorityUserId: "gm", executionId, operationId: `ce-${++operation}` });
  assert.equal(s.state, "COMPLETED"); assert.equal(f.a.items.some(item => item.name === "Moneda"), true); assert.equal(f.b.items.some(item => item.name === "Poción"), true);
});

test("8-B cambiar oferta resetea confirmaciones", async () => { const f = fixture(); let s = await negotiate(f); s = await f.store.confirmSession({ sessionId: s.id, participantKey: "participantA", requestingUserId: "a", revision: s.revision, operationId: `c8b-${++operation}` }); s = await f.store.setOffer({ sessionId: s.id, participantKey: "participantB", requestingUserId: "b", entries: [], operationId: `m8b-${++operation}` }); assert.equal(s.confirmations.participantA.confirmed, false); });
test("8-C desconexión conceptual termina CANCELLED y limpia", async () => { const f = fixture(); const s = await negotiate(f); const end = await f.store.finishForLifecycle({ sessionId: s.id, authorityUserId: "gm", state: "CANCELLED", reason: "disconnect", operationId: `d8c-${++operation}` }); assert.equal(end.state, "CANCELLED"); assert.equal(end.reservations.length, 0); });
test("8-D mutación externa, corrección y READY", async () => { const f = fixture(); let s = await negotiate(f); s = await f.store.invalidateOfferEntry({ sessionId: s.id, authorityUserId: "gm", participantKey: "participantA", itemUuid: f.a.items[0].uuid, itemId: f.a.items[0].id, reason: "Cantidad insuficiente", operationId: `i8d-${++operation}` }); assert.equal(s.invalidEntries.length, 1); s = await f.store.setOffer({ sessionId: s.id, participantKey: "participantA", requestingUserId: "a", entries: [{ itemUuid: f.a.items[0].uuid, itemId: f.a.items[0].id, quantity: 2 }], operationId: `r8d-${++operation}` }); s = await confirmBoth(f, s); assert.equal(s.state, "READY"); });
test("8-E mensajes duplicados producen una transferencia", async () => { const f = fixture(); const s = await confirmBoth(f, await negotiate(f)); const plan = await prepareTradeTransferPlan({ session: s, executionId: "dup8", resolveActor: uuid => f.actors.get(uuid) }); const c = new TradeTransferCoordinator(); await Promise.all([c.executePlan(plan), c.executePlan(plan)]); assert.equal(f.b.items.filter(item => item.name === "Poción").length, 1); });
test("8-F fallo inyectado ejecuta rollback dirigido", async () => { const f = fixture(); const s = await confirmBoth(f, await negotiate(f, { offerB: null })); const originalUpdate = f.a.updateEmbeddedDocuments.bind(f.a); let failed = false; f.a.updateEmbeddedDocuments = async (...args) => { if (!failed) { failed = true; throw new Error("fail"); } return originalUpdate(...args); }; const plan = await prepareTradeTransferPlan({ session: s, executionId: "fail8", resolveActor: uuid => f.actors.get(uuid) }); const error = await new TradeTransferCoordinator().executePlan(plan).catch(value => value); assert.equal(error.rollbackSucceeded, true); assert.equal(f.b.items.some(item => item.name === "Poción"), false); });

test("8-07 mismo Item repetido se agrega sin dupe", async () => { const f = fixture(); let s = await negotiate(f, { offerA: null, offerB: null }); const item = f.a.items[0]; s = await f.store.setOffer({ sessionId: s.id, participantKey: "participantA", requestingUserId: "a", entries: [{ itemUuid: item.uuid, itemId: item.id, quantity: 2 }, { itemUuid: item.uuid, itemId: item.id, quantity: 3 }], operationId: `dupe-${++operation}` }); assert.equal(s.offers.participantA.length, 1); assert.equal(s.offers.participantA[0].quantity, 5); });
test("8-08 Actor no puede entrar en múltiples sesiones", async () => { const f = fixture(); await negotiate(f, { offerA: null, offerB: null }); await assert.rejects(negotiate(f, { offerA: null, offerB: null }), /ya participa/); });
test("8-09 payload público no expone internals", async () => { const f = fixture(); const publicView = buildPublicTradeSessionView(await negotiate(f)); const serialized = JSON.stringify(publicView); assert.equal(serialized.includes("reservations"), false); assert.equal(serialized.includes("appliedOperations"), false); assert.equal(serialized.includes("ownership"), false); });
test("8-10 payload público sólo contiene oferta publicada", async () => { const f = fixture(); const view = buildPublicTradeSessionView(await negotiate(f)); assert.equal(JSON.stringify(view).includes("Poción"), true); assert.equal(JSON.stringify(view).includes("inventario secreto"), false); });
test("8-11 terminal limpia reserva, índice y confirmaciones", async () => { const f = fixture(); const s = await negotiate(f); const end = await f.store.finishForLifecycle({ sessionId: s.id, authorityUserId: "gm", state: "INVALID", reason: "audit", operationId: `clean-${++operation}` }); assert.equal(end.reservations.length, 0); assert.equal(f.store.getActiveSessionIdForActor(f.a.uuid), null); assert.equal(end.confirmations.participantA.confirmed, false); });
test("8-12 vista GM observa ofertas sin inventarios", async () => { const f = fixture(); const gmView = buildGMTradeView(await negotiate(f)); assert.equal(gmView.observer, "GM"); assert.equal("privateInventory" in gmView, false); });
test("8-13 flujo normal no importa legacy", async () => { const files = ["../scripts/trade/trade-runtime.js", "../scripts/trade/trade-authority.js", "../scripts/trade/trade-api.js", "../scripts/ui/trade-app.js", "../scripts/sheets/actors/personaje-sheet.js"]; for (const file of files) { const source = await readFile(new URL(file, import.meta.url), "utf8"); assert.doesNotMatch(source, /trade-dialog|trade-engine|mtrolEjecutarComercio|abrirDialogoComercioMtrol/); } });
test("8-14 el runtime no conserva el motor ni el diálogo legacy retirados", async () => { const runtime = await readFile(new URL("../scripts/trade/trade-runtime.js", import.meta.url), "utf8"); assert.doesNotMatch(runtime, /trade-engine|trade-dialog|mtrolEjecutarComercio/); });
