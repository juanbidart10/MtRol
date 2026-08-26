import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

globalThis.foundry = { utils: { deepClone: structuredClone, duplicate: structuredClone } };
const gm = { id: "gm", isGM: true, active: true };
const player = { id: "p", isGM: false, active: true };
globalThis.game = { user: gm };

const { buildGMTradeMonitorView } = await import("../scripts/trade/trade-gm-view-model.js");
const { TradeAuditService } = await import("../scripts/trade/trade-audit-service.js");
const { TradeSessionStore } = await import("../scripts/trade/trade-session-service.js");
const { buildPublicTradeSessionView } = await import("../scripts/trade/trade-view-model.js");

function item(actor, id, quantity, extra = {}) {
  return { id, uuid: `${actor.uuid}.Item.${id}`, name: id, img: `${id}.webp`, type: "objeto", parent: actor,
    system: { cantidad: quantity, peso: 2, tipoObjeto: "general", equipado: false, ...extra } };
}
const actorA = { uuid: "Actor.a", items: [] };
const actorB = { uuid: "Actor.b", items: [] };
const potion = item(actorA, "potion", 4);
const sword = item(actorB, "sword", 1, { equipado: true });
actorA.items.push(potion); actorB.items.push(sword);
const actors = new Map([[actorA.uuid, actorA], [actorB.uuid, actorB]]);

function session(state = "NEGOTIATING") {
  return {
    id: "trade-10", state, revision: 7,
    authority: { gmUserId: "gm", epoch: "epoch-10" },
    participants: {
      participantA: { key: "participantA", userId: "a", actorUuid: actorA.uuid, actorName: "A", actorImg: "a.webp", tokenUuid: "Token.a" },
      participantB: { key: "participantB", userId: "b", actorUuid: actorB.uuid, actorName: "B", actorImg: "b.webp", tokenUuid: "Token.b" }
    },
    offers: { participantA: [{ actorUuid: actorA.uuid, itemUuid: potion.uuid, itemId: potion.id, quantity: 3 }], participantB: [] },
    publicOffers: { participantA: [{ itemUuid: potion.uuid, itemId: potion.id, name: potion.name, img: potion.img, type: potion.type, tipoObjeto: "general", quantity: 3, publicData: {} }], participantB: [] },
    reservations: [{ actorUuid: actorA.uuid, itemUuid: potion.uuid, itemId: potion.id, quantity: 3, sessionId: "trade-10", participantKey: "participantA" }],
    confirmations: { participantA: { confirmed: true, revision: 7 }, participantB: { confirmed: false, revision: null } },
    invalidEntries: [], execution: { executionId: null }, createdAt: 1, updatedAt: 2
  };
}

async function gmView(state) {
  return buildGMTradeMonitorView({ session: session(state), user: gm, resolveActor: uuid => actors.get(uuid), timeline: [] });
}

test("10-01 GM puede abrir contrato de monitor", async () => assert.equal((await gmView()).gmOnly, true));
test("10-02 jugador no puede abrir contrato GM", async () => assert.rejects(() => buildGMTradeMonitorView({ session: session(), user: player }), /exclusiva/));
test("10-03 GM ve inventario completo A", async () => assert.equal((await gmView()).participantA.inventory[0].name, "potion"));
test("10-04 GM ve inventario completo B", async () => assert.equal((await gmView()).participantB.inventory[0].name, "sword"));
test("10-05 A público no recibe inventario B", () => assert.equal("inventory" in buildPublicTradeSessionView(session()).participants.participantB, false));
test("10-06 B público no recibe inventario A", () => assert.equal("inventory" in buildPublicTradeSessionView(session()).participants.participantA, false));
test("10-07 GM ve oferta A", async () => assert.equal((await gmView()).participantA.offer[0].quantity, 3));
test("10-08 GM ve oferta B vacía", async () => assert.deepEqual((await gmView()).participantB.offer, []));
test("10-09 GM ve cantidad real", async () => assert.equal((await gmView()).participantA.offer[0].realQuantity, 4));
test("10-10 GM ve cantidad reservada", async () => assert.equal((await gmView()).participantA.offer[0].reservedQuantity, 3));
test("10-11 GM ve disponible", async () => assert.equal((await gmView()).participantA.offer[0].availableQuantity, 1));
test("10-12 GM ve revisión", async () => assert.equal((await gmView()).revision, 7));
test("10-13 GM ve confirmación vigente A", async () => assert.equal((await gmView()).participantA.confirmation.current, true));
test("10-14 GM ve confirmación pendiente B", async () => assert.equal((await gmView()).participantB.confirmation.current, false));
test("10-15 GM ve estado", async () => assert.equal((await gmView()).state, "NEGOTIATING"));
test("10-16 Item A conserva UUID para inspección", async () => assert.equal((await gmView()).participantA.inventory[0].itemUuid, potion.uuid));
test("10-17 Item B conserva UUID para inspección", async () => assert.equal((await gmView()).participantB.inventory[0].itemUuid, sword.uuid));
test("10-18 ofertas GM son read-only", async () => assert.equal((await gmView()).readOnlyOffers, true));
test("10-19 monitor no expone acción confirmar", async () => assert.equal("confirm" in await gmView(), false));
test("10-20 EXECUTING deshabilita cancelar", async () => assert.equal((await gmView("EXECUTING")).canCancel, false));

function storeFixture() {
  let now = 10;
  const store = new TradeSessionStore({ idFactory: () => "s", now: () => ++now, resolveRealQuantity: () => 4,
    resolveOfferItem: reference => ({ realQuantity: 4, publicSnapshot: { ...reference, name: "potion", type: "objeto", tipoObjeto: "general", publicData: {} } }) });
  store.reconcileAuthority({ gmUserId: "gm", epoch: "e" });
  return store;
}
async function negotiating(store) {
  const requested = await store.createSession({ participantA: { userId: "a", actorUuid: "Actor.a" }, participantB: { userId: "b", actorUuid: "Actor.b" }, authority: { gmUserId: "gm", epoch: "e" }, operationId: "create" });
  return store.acceptSession({ sessionId: requested.id, participantKey: "participantB", requestingUserId: "b", operationId: "accept" });
}
test("10-21 GM cancela NEGOTIATING", async () => { const s=storeFixture(); const n=await negotiating(s); const x=await s.cancelSessionByGM({sessionId:n.id,authorityUserId:"gm",requestingUserId:"gm2",reason:"sospecha",operationId:"c"}); assert.equal(x.state,"CANCELLED"); });
test("10-22 GM cancela READY", async () => { const s=storeFixture(); let n=await negotiating(s); n=await s.confirmSession({sessionId:n.id,participantKey:"participantA",requestingUserId:"a",revision:0,operationId:"a"}); n=await s.confirmSession({sessionId:n.id,participantKey:"participantB",requestingUserId:"b",revision:0,operationId:"b"}); const x=await s.cancelSessionByGM({sessionId:n.id,authorityUserId:"gm",requestingUserId:"gm2",operationId:"c"}); assert.equal(x.state,"CANCELLED"); });
test("10-23 GM no cancela EXECUTING", async () => { const s=storeFixture(); let n=await negotiating(s); n=await s.confirmSession({sessionId:n.id,participantKey:"participantA",requestingUserId:"a",revision:0,operationId:"a"}); n=await s.confirmSession({sessionId:n.id,participantKey:"participantB",requestingUserId:"b",revision:0,operationId:"b"}); n=await s.beginExecution({sessionId:n.id,authorityUserId:"gm",executionId:"x",revision:0,operationId:"x"}); await assert.rejects(()=>s.cancelSessionByGM({sessionId:n.id,authorityUserId:"gm",requestingUserId:"gm2",operationId:"c"}),/ejecución/); });
test("10-24 cancelación GM libera reservas", async () => { const s=storeFixture(); let n=await negotiating(s); n=await s.setOffer({sessionId:n.id,participantKey:"participantA",requestingUserId:"a",entries:[{itemUuid:"Actor.a.Item.p",itemId:"p",quantity:2}],operationId:"o"}); await s.cancelSessionByGM({sessionId:n.id,authorityUserId:"gm",requestingUserId:"gm2",operationId:"c"}); assert.equal(s.getReservationsForSession(n.id).length,0); });
test("10-25 cancelación GM limpia índices", async () => { const s=storeFixture(); const n=await negotiating(s); await s.cancelSessionByGM({sessionId:n.id,authorityUserId:"gm",requestingUserId:"gm2",operationId:"c"}); assert.equal(s.getActiveSessionIdForActor("Actor.a"),null); });
test("10-26 cancelación registra usuario", async () => { const s=storeFixture(); const n=await negotiating(s); const x=await s.cancelSessionByGM({sessionId:n.id,authorityUserId:"gm",requestingUserId:"gm2",operationId:"c"}); assert.equal(x.cancelledByUserId,"gm2"); });
test("10-27 cancelación registra rol GM", async () => { const s=storeFixture(); const n=await negotiating(s); const x=await s.cancelSessionByGM({sessionId:n.id,authorityUserId:"gm",requestingUserId:"gm2",operationId:"c"}); assert.equal(x.cancelledByRole,"GM"); });
test("10-28 cancelación registra razón", async () => { const s=storeFixture(); const n=await negotiating(s); const x=await s.cancelSessionByGM({sessionId:n.id,authorityUserId:"gm",requestingUserId:"gm2",reason:"abuso",operationId:"c"}); assert.equal(x.cancelReason,"abuso"); });
test("10-29 doble cancelación no genera segunda mutación", async () => { const s=storeFixture(); const n=await negotiating(s); const a=await s.cancelSessionByGM({sessionId:n.id,authorityUserId:"gm",requestingUserId:"gm2",operationId:"c"}); const b=await s.cancelSessionByGM({sessionId:n.id,authorityUserId:"gm",requestingUserId:"gm2",operationId:"c"}); assert.deepEqual(a,b); });

class MemoryStorage { constructor(records=[]) { this.records=structuredClone(records); } async read(){return structuredClone(this.records);} async write(v){this.records=structuredClone(v);} }
function auditFixture(state="COMPLETED") { const s=session(state); s.completedAt=state==="COMPLETED"?20:null; s.cancelledAt=state==="CANCELLED"?20:null; s.invalidatedAt=state==="INVALID"?20:null; s.execution={executionId:"exec-1"}; return s; }
test("10-30 audit COMPLETED correcto", async()=>{const a=new TradeAuditService({storage:new MemoryStorage()});const r=await a.persistTerminal(auditFixture());assert.equal(r.finalState,"COMPLETED");});
test("10-31 audit CANCELLED correcto", async()=>{const a=new TradeAuditService({storage:new MemoryStorage()});const r=await a.persistTerminal(auditFixture("CANCELLED"));assert.equal(r.finalState,"CANCELLED");});
test("10-32 audit INVALID correcto", async()=>{const a=new TradeAuditService({storage:new MemoryStorage()});const r=await a.persistTerminal(auditFixture("INVALID"));assert.equal(r.finalState,"INVALID");});
test("10-33 audit guarda executionId", ()=>assert.equal(new TradeAuditService({storage:new MemoryStorage()}).buildRecord(auditFixture()).executionId,"exec-1"));
test("10-34 audit guarda sessionId", ()=>assert.equal(new TradeAuditService({storage:new MemoryStorage()}).buildRecord(auditFixture()).sessionId,"trade-10"));
test("10-35 audit guarda revisión final", ()=>assert.equal(new TradeAuditService({storage:new MemoryStorage()}).buildRecord(auditFixture()).finalRevision,7));
test("10-36 audit guarda snapshots", ()=>{const a=new TradeAuditService({storage:new MemoryStorage()});a.capturePublicOffers(session(),{[potion.uuid]:4});assert.equal(a.buildRecord(auditFixture()).offerA[0].realQuantity,4);});
test("10-37 audit registra rollback", ()=>{const a=new TradeAuditService({storage:new MemoryStorage()});const r=a.buildRecord(auditFixture("INVALID"),{rollback:{attempted:true,succeeded:true}});assert.equal(r.rollback.succeeded,true);});
test("10-38 historial persiste entre servicios", async()=>{const storage=new MemoryStorage();await new TradeAuditService({storage}).persistTerminal(auditFixture());assert.equal((await new TradeAuditService({storage}).getHistory()).length,1);});
test("10-39 jugador no lee historial", async()=>{const a=new TradeAuditService({storage:new MemoryStorage()});await assert.rejects(()=>a.getHistory({},player),/exclusivo/);});
test("10-40 GM lee historial", async()=>{const a=new TradeAuditService({storage:new MemoryStorage()});await a.persistTerminal(auditFixture());assert.equal((await a.getHistory({},gm)).length,1);});
test("10-41 retención limita registros", async()=>{const a=new TradeAuditService({storage:new MemoryStorage(),retention:2});for(const id of ["1","2","3"]){const s=auditFixture();s.id=id;await a.persistTerminal(s);}assert.deepEqual((await a.getHistory()).map(x=>x.sessionId),["3","2"]);});
test("10-42 timeline registra eventos relevantes", ()=>{const a=new TradeAuditService({storage:new MemoryStorage()});a.recordEvent(session(),"confirm",{message:"ok"});assert.equal(a.getTimeline("trade-10").length,1);});
test("10-43 timeline ignora ruido de render", ()=>{const a=new TradeAuditService({storage:new MemoryStorage()});a.recordEvent(session(),"render",{});assert.equal(a.getTimeline("trade-10").length,0);});

const source = async path => readFile(new URL(path, import.meta.url), "utf8");
test("10-44 una sesión usa un monitor indexado", async()=>assert.match(await source("../scripts/trade/trade-gm-runtime.js"),/const monitors = new Map/));
test("10-45 actualización rerenderiza monitor", async()=>assert.match(await source("../scripts/trade/trade-gm-runtime.js"),/monitor\?\.render/));
test("10-46 terminal actualiza snapshot", async()=>assert.match(await source("../scripts/trade/trade-gm-runtime.js"),/setTerminalSnapshot/));
test("10-47 payload jugador no contiene inventario GM", ()=>{const text=JSON.stringify(buildPublicTradeSessionView(session()));assert.doesNotMatch(text,/gmInventory|fullInventory|inventory/);});
test("10-48 sockets no transportan inventarios completos", async()=>{const text=await source("../scripts/core/sockets.js");assert.doesNotMatch(text,/gmInventoryA|gmInventoryB|fullInventory/);});
test("10-49 GM secundario deriva cancelación al primario", async()=>{const text=await source("../scripts/trade/trade-api.js");assert.match(text,/requestPrimaryGM\("mtrolTradeGMCancel"/);});
test("10-50 monitor no ofrece edición ni confirmación GM", async()=>{const text=await source("../templates/apps/trade-gm-monitor-app.html");assert.doesNotMatch(text,/data-action="(?:confirm|add|remove|update)"/);});
test("10-51 autoridad emite señal GM de sesión activa", async()=>assert.match(await source("../scripts/trade/trade-authority.js"),/mtrolTradeGMSessionSync/));
test("10-52 aceptación abre monitor GM automáticamente", async()=>{const text=await source("../scripts/trade/trade-gm-runtime.js");assert.match(text,/session\.state === "NEGOTIATING" && reason === "session-accepted"/);assert.match(text,/openTradeGMMonitor/);});
test("10-53 cancelación GM libera movement locks", async()=>{const text=await source("../scripts/trade/trade-authority.js");const start=text.indexOf("cancelTradeSessionByGMAuthoritative");assert.match(text.slice(start),/tradeMovementLocks\.releaseSession\(session\.id\)/);});
test("10-54 cancelación GM se publica a ambos participantes", async()=>{const text=await source("../scripts/trade/trade-authority.js");const start=text.indexOf("cancelTradeSessionByGMAuthoritative");assert.match(text.slice(start),/publishTradeSession\(session, \{ reason: "session-cancelled-by-gm" \}\)/);});
test("10-55 historial no ofrece edición ni rollback", async()=>{const text=await source("../templates/apps/trade-audit-history-app.html");assert.doesNotMatch(text,/data-action="(?:edit|delete|rollback)"/);});
