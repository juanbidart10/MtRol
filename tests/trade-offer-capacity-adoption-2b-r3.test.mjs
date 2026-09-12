import test from "node:test";
import assert from "node:assert/strict";

import { SharedReservationLedger } from "../scripts/runtime/shared-reservation-ledger.js";
import { TradeRuntimeRepository } from "../scripts/trade/trade-runtime-repository.js";
import { TradeSessionStore } from "../scripts/trade/trade-session-service.js";

const participant = (side, suffix = "one") => ({
  userId: side === "a" ? `user-a-${suffix}` : `user-b-${suffix}`,
  actorUuid: `Actor.${side}-${suffix}`,
  actorName: side
});

function fixture({ quantities = {}, repository = new TradeRuntimeRepository(), id = "trade-one" } = {}) {
  const quantityByItem = new Map(Object.entries(quantities));
  const realQuantity = async (_actorUuid, itemUuid) => quantityByItem.get(itemUuid) ?? 10;
  const ledger = new SharedReservationLedger({ repository });
  const store = new TradeSessionStore({
    idFactory: () => id,
    repository,
    reservationLedger: ledger,
    resolveRealQuantity: reference => quantityByItem.get(reference.itemUuid) ?? 10,
    resolveOfferItem: reference => ({
      itemUuid: reference.itemUuid,
      itemId: reference.itemId,
      publicSnapshot: { itemUuid: reference.itemUuid, itemId: reference.itemId, quantity: reference.quantity }
    })
  });
  store.authority = { gmUserId: "gm", epoch: "epoch" };
  return { store, ledger, repository, realQuantity, quantityByItem };
}

async function accepted(fx, suffix = "one") {
  let session = await fx.store.createSession({
    participantA: participant("a", suffix), participantB: participant("b", suffix),
    authority: { gmUserId: "gm", epoch: "epoch" }, operationId: `create-${suffix}`
  });
  session = await fx.store.acceptSession({
    sessionId: session.id, participantKey: "participantB",
    requestingUserId: `user-b-${suffix}`, operationId: `accept-${suffix}`
  });
  return session;
}

const offer = (fx, session, entries, operationId, suffix = "one") => fx.store.setOffer({
  sessionId: session.id, participantKey: "participantA", requestingUserId: `user-a-${suffix}`,
  entries, revision: session.revision, operationId
});

const tradeId = (sessionId, itemUuid) => `trade:${sessionId}:participantA:${itemUuid}`;

test("CREATE de setOffer persiste una reserva Trade canónica", async () => {
  const itemUuid = "Item.create";
  const fx = fixture({ quantities: { [itemUuid]: 1 } });
  let session = await accepted(fx);
  session = await offer(fx, session, [{ itemUuid, quantity: 1 }], "offer-create");
  await fx.ledger.hydrateFromPersistence();
  const reservation = fx.ledger.get(tradeId(session.id, itemUuid));
  assert.equal(reservation?.domain, "trade");
  assert.equal(reservation?.state, "RESERVED");
  assert.equal(reservation?.quantity, 1);
});

test("Ground gana la última unidad y Trade rechaza sin mutar la oferta", async () => {
  const itemUuid = "Item.ground-first";
  const fx = fixture({ quantities: { [itemUuid]: 1 } });
  const session = await accepted(fx);
  await fx.ledger.reserve({ operationId: "ground-first", domain: "ground-test", actorUuid: "Actor.a-one", itemUuid, quantity: 1 }, { realQuantity: fx.realQuantity });
  await assert.rejects(offer(fx, session, [{ itemUuid, quantity: 1 }], "trade-loses"), /disponib|reserva|capacidad/i);
  assert.deepEqual(fx.store.getSession(session.id).offers.participantA, []);
});

test("Trade gana la última unidad y Ground rechaza", async () => {
  const itemUuid = "Item.trade-first";
  const fx = fixture({ quantities: { [itemUuid]: 1 } });
  let session = await accepted(fx);
  session = await offer(fx, session, [{ itemUuid, quantity: 1 }], "trade-wins");
  await assert.rejects(fx.ledger.reserve({ operationId: "ground-loses", domain: "ground-test", actorUuid: "Actor.a-one", itemUuid, quantity: 1 }, { realQuantity: fx.realQuantity }), /disponib|reserva|capacidad/i);
});

test("REPLACE fallido preserva cantidad y oferta anteriores", async () => {
  const itemUuid = "Item.replace";
  const fx = fixture({ quantities: { [itemUuid]: 3 } });
  let session = await accepted(fx);
  session = await offer(fx, session, [{ itemUuid, quantity: 2 }], "offer-two");
  await fx.ledger.reserve({ operationId: "ground-one", domain: "ground-test", actorUuid: "Actor.a-one", itemUuid, quantity: 1 }, { realQuantity: fx.realQuantity });
  await assert.rejects(offer(fx, session, [{ itemUuid, quantity: 3 }], "offer-three"), /disponib|reserva|capacidad/i);
  await fx.ledger.hydrateFromPersistence();
  assert.equal(fx.ledger.get(tradeId(session.id, itemUuid)).quantity, 2);
  assert.equal(fx.store.getSession(session.id).offers.participantA[0].quantity, 2);
});

test("ADD REMOVE RE-ADD conserva identidad y usa REACQUIRE con nueva cantidad", async () => {
  const itemUuid = "Item.readd";
  const fx = fixture({ quantities: { [itemUuid]: 3 } });
  let session = await accepted(fx);
  session = await offer(fx, session, [{ itemUuid, quantity: 3 }], "add");
  session = await offer(fx, session, [], "remove");
  await fx.ledger.hydrateFromPersistence();
  const released = fx.ledger.get(tradeId(session.id, itemUuid));
  assert.equal(released.state, "RELEASED");
  session = await offer(fx, session, [{ itemUuid, quantity: 2 }], "readd");
  await fx.ledger.hydrateFromPersistence();
  const reacquired = fx.ledger.get(tradeId(session.id, itemUuid));
  assert.equal(reacquired.state, "RESERVED");
  assert.equal(reacquired.quantity, 2);
  assert.equal(reacquired.revision, released.revision + 1);
  assert.equal(fx.ledger.list().filter(record => record.operationId === reacquired.operationId).length, 1);
});

test("re-add sin capacidad preserva RELEASED y oferta previa", async () => {
  const itemUuid = "Item.readd-full";
  const fx = fixture({ quantities: { [itemUuid]: 3 } });
  let session = await accepted(fx);
  session = await offer(fx, session, [{ itemUuid, quantity: 3 }], "add-full");
  session = await offer(fx, session, [], "remove-full");
  await fx.ledger.reserve({ operationId: "ground-full", domain: "ground-test", actorUuid: "Actor.a-one", itemUuid, quantity: 3 }, { realQuantity: fx.realQuantity });
  await assert.rejects(offer(fx, session, [{ itemUuid, quantity: 3 }], "readd-full"), /disponib|reserva|capacidad/i);
  await fx.ledger.hydrateFromPersistence();
  assert.equal(fx.ledger.get(tradeId(session.id, itemUuid)).state, "RELEASED");
  assert.deepEqual(fx.store.getSession(session.id).offers.participantA, []);
});

test("re-add quarantined no muta ledger ni proyección", async () => {
  const itemUuid = "Item.readd-quarantine";
  const fx = fixture({ quantities: { [itemUuid]: 3 } });
  let session = await accepted(fx);
  session = await offer(fx, session, [{ itemUuid, quantity: 1 }], "add-q");
  session = await offer(fx, session, [], "remove-q");
  await fx.ledger.quarantineResource({ actorUuid: "Actor.a-one", itemUuid, reason: "LEGACY_RESERVATION_CONFLICT", evidence: { source: "test" } });
  await assert.rejects(offer(fx, session, [{ itemUuid, quantity: 1 }], "readd-q"), error => error.reasonCode === "CAPACITY_QUARANTINED");
  assert.deepEqual(fx.store.getSession(session.id).offers.participantA, []);
});

test("revisión multi-item es atómica y preserva todo cuando CREATE falla", async () => {
  const a = "Item.mix-a", b = "Item.mix-b", c = "Item.mix-c", d = "Item.mix-d";
  const fx = fixture({ quantities: { [a]: 4, [b]: 2, [c]: 2, [d]: 0 } });
  let session = await accepted(fx);
  session = await offer(fx, session, [{ itemUuid: a, quantity: 2 }, { itemUuid: b, quantity: 1 }, { itemUuid: c, quantity: 1 }], "mix-initial");
  session = await offer(fx, session, [{ itemUuid: a, quantity: 2 }, { itemUuid: b, quantity: 1 }], "mix-release-c");
  const before = fx.store.getSession(session.id);
  await assert.rejects(offer(fx, session, [{ itemUuid: a, quantity: 3 }, { itemUuid: c, quantity: 2 }, { itemUuid: d, quantity: 1 }], "mix-fail"), /disponib|reserva|capacidad/i);
  assert.deepEqual(fx.store.getSession(session.id).offers.participantA, before.offers.participantA);
  await fx.ledger.hydrateFromPersistence();
  assert.equal(fx.ledger.get(tradeId(session.id, a)).quantity, 2);
  assert.equal(fx.ledger.get(tradeId(session.id, b)).state, "RESERVED");
  assert.equal(fx.ledger.get(tradeId(session.id, c)).state, "RELEASED");
  assert.equal(fx.ledger.get(tradeId(session.id, d)), null);
});

test("orden distinto es NOOP de capacidad", async () => {
  const a = "Item.order-a", b = "Item.order-b";
  const fx = fixture({ quantities: { [a]: 2, [b]: 2 } });
  let session = await accepted(fx);
  session = await offer(fx, session, [{ itemUuid: a, quantity: 1 }, { itemUuid: b, quantity: 1 }], "ordered");
  await fx.ledger.hydrateFromPersistence();
  const revisions = fx.ledger.list().map(r => [r.operationId, r.revision]);
  const same = await offer(fx, session, [{ itemUuid: b, quantity: 1 }, { itemUuid: a, quantity: 1 }], "reordered");
  await fx.ledger.hydrateFromPersistence();
  assert.equal(same.revision, session.revision);
  assert.deepEqual(fx.ledger.list().map(r => [r.operationId, r.revision]), revisions);
});

test("reload observa ledger y RELEASED se readquiere, no se recrea", async () => {
  const itemUuid = "Item.reload-readd";
  const first = fixture({ quantities: { [itemUuid]: 2 } });
  let session = await accepted(first);
  session = await offer(first, session, [{ itemUuid, quantity: 1 }], "reload-add");
  session = await offer(first, session, [], "reload-remove");
  const second = fixture({ repository: first.repository, quantities: { [itemUuid]: 2 }, id: "unused" });
  await second.ledger.hydrateFromPersistence();
  await second.store.hydrateFromPersistence();
  const reloaded = second.store.getSession(session.id);
  await offer(second, reloaded, [{ itemUuid, quantity: 2 }], "reload-readd");
  await second.ledger.hydrateFromPersistence();
  assert.equal(second.ledger.get(tradeId(session.id, itemUuid)).state, "RESERVED");
  assert.equal(second.ledger.get(tradeId(session.id, itemUuid)).quantity, 2);
  assert.equal(second.ledger.list().filter(r => r.operationId === tradeId(session.id, itemUuid)).length, 1);
});

test("proyección RAM corrupta no permite overcommit", async () => {
  const itemUuid = "Item.corrupt";
  const fx = fixture({ quantities: { [itemUuid]: 1 } });
  let session = await accepted(fx);
  session = await offer(fx, session, [{ itemUuid, quantity: 1 }], "reserve-corrupt");
  fx.store.reservationsByItem.clear();
  fx.store.sessions.get(session.id).reservations = [];
  const other = fixture({ repository: fx.repository, quantities: { [itemUuid]: 1 }, id: "trade-other" });
  let otherSession = await other.store.createSession({
    participantA: { ...participant("a", "other"), actorUuid: "Actor.a-one" },
    participantB: participant("b", "other"),
    authority: { gmUserId: "gm", epoch: "epoch" }, operationId: "create-other"
  });
  otherSession = await other.store.acceptSession({
    sessionId: otherSession.id, participantKey: "participantB",
    requestingUserId: "user-b-other", operationId: "accept-other"
  });
  await assert.rejects(offer(other, otherSession, [{ itemUuid, quantity: 1 }], "other-offer", "other"), /disponib|reserva|capacidad/i);
});

test("retry después de reload es idempotente y no incrementa reservation revision", async () => {
  const itemUuid = "Item.retry";
  const first = fixture({ quantities: { [itemUuid]: 1 } });
  let session = await accepted(first);
  const command = { sessionId: session.id, participantKey: "participantA", requestingUserId: "user-a-one", entries: [{ itemUuid, quantity: 1 }], revision: session.revision, operationId: "retry-offer" };
  const result = await first.store.setOffer(command);
  await first.ledger.hydrateFromPersistence();
  const revision = first.ledger.get(tradeId(session.id, itemUuid)).revision;
  const second = fixture({ repository: first.repository, quantities: { [itemUuid]: 1 } });
  await second.ledger.hydrateFromPersistence();
  await second.store.hydrateFromPersistence();
  assert.deepEqual(await second.store.setOffer(command), result);
  await second.ledger.hydrateFromPersistence();
  assert.equal(second.ledger.get(tradeId(session.id, itemUuid)).revision, revision);
});

test("Trade contra Trade por la última unidad produce exactamente un ganador", async () => {
  const itemUuid = "Item.trade-race";
  const repository = new TradeRuntimeRepository();
  const one = fixture({ repository, quantities: { [itemUuid]: 1 }, id: "trade-race-a" });
  const two = fixture({ repository, quantities: { [itemUuid]: 1 }, id: "trade-race-b" });
  const a = await accepted(one, "race-a");
  const b = await accepted(two, "race-b");
  // The sessions intentionally refer to one canonical inventory owner.
  two.store.sessions.get(b.id).participants.participantA.actorUuid = "Actor.a-race-a";
  const results = await Promise.allSettled([
    offer(one, a, [{ itemUuid, quantity: 1 }], "race-offer-a", "race-a"),
    two.store.setOffer({ sessionId: b.id, participantKey: "participantA", requestingUserId: "user-a-race-b", entries: [{ itemUuid, quantity: 1 }], revision: b.revision, operationId: "race-offer-b" })
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const ledger = new SharedReservationLedger({ repository });
  await ledger.hydrateFromPersistence();
  assert.equal(ledger.reservedQuantity("Actor.a-race-a", itemUuid), 1);
});

test("dos revisiones concurrentes desde la misma session revision aceptan sólo una", async () => {
  const itemUuid = "Item.stale-race";
  const fx = fixture({ quantities: { [itemUuid]: 5 } });
  let session = await accepted(fx);
  session = await offer(fx, session, [{ itemUuid, quantity: 1 }], "stale-base");
  const command = quantity => fx.store.setOffer({
    sessionId: session.id, participantKey: "participantA", requestingUserId: "user-a-one",
    entries: [{ itemUuid, quantity }], revision: session.revision, operationId: `stale-${quantity}`
  });
  const results = await Promise.allSettled([command(2), command(3)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
});

test("cancel pre-effect libera canónicamente y retry es idempotente", async () => {
  const itemUuid = "Item.cancel";
  const fx = fixture({ quantities: { [itemUuid]: 2 } });
  let session = await accepted(fx);
  session = await offer(fx, session, [{ itemUuid, quantity: 2 }], "cancel-offer");
  const command = { sessionId: session.id, participantKey: "participantA", requestingUserId: "user-a-one", operationId: "cancel-command" };
  const cancelled = await fx.store.cancelSession(command);
  await fx.ledger.hydrateFromPersistence();
  const released = fx.ledger.get(tradeId(session.id, itemUuid));
  assert.equal(cancelled.state, "CANCELLED");
  assert.equal(released.state, "RELEASED");
  assert.deepEqual(await fx.store.cancelSession(command), cancelled);
  await fx.ledger.hydrateFromPersistence();
  assert.equal(fx.ledger.get(tradeId(session.id, itemUuid)).revision, released.revision);
});

test("RECOVERY_REQUIRED no puede cancelar ni liberar ciegamente", async () => {
  const itemUuid = "Item.recovery-cancel";
  const fx = fixture({ quantities: { [itemUuid]: 1 } });
  let session = await accepted(fx);
  session = await offer(fx, session, [{ itemUuid, quantity: 1 }], "recovery-offer");
  fx.store.sessions.get(session.id).state = "RECOVERY_REQUIRED";
  await assert.rejects(fx.store.cancelSession({ sessionId: session.id, participantKey: "participantA", requestingUserId: "user-a-one", operationId: "unsafe-cancel" }), /recovery/i);
  await fx.ledger.hydrateFromPersistence();
  assert.equal(fx.ledger.get(tradeId(session.id, itemUuid)).state, "RESERVED");
});

test("disconnect pre-effect mediante finishForLifecycle libera capacidad canónica", async () => {
  const itemUuid = "Item.disconnect";
  const fx = fixture({ quantities: { [itemUuid]: 1 } });
  let session = await accepted(fx);
  session = await offer(fx, session, [{ itemUuid, quantity: 1 }], "disconnect-offer");
  const terminal = await fx.store.finishForLifecycle({
    sessionId: session.id, authorityUserId: "gm", state: "CANCELLED",
    reason: "participant-disconnected", operationId: "disconnect-finish"
  });
  await fx.ledger.hydrateFromPersistence();
  assert.equal(terminal.state, "CANCELLED");
  assert.equal(fx.ledger.get(tradeId(session.id, itemUuid)).state, "RELEASED");
});

test("usuario que no es participante no alcanza la mutación del ledger", async () => {
  const itemUuid = "Item.permission";
  const fx = fixture({ quantities: { [itemUuid]: 1 } });
  const session = await accepted(fx);
  await assert.rejects(fx.store.setOffer({
    sessionId: session.id, participantKey: "participantA", requestingUserId: "intruder",
    entries: [{ itemUuid, quantity: 1 }], revision: session.revision, operationId: "intrusion"
  }), /no puede actuar/i);
  await fx.ledger.hydrateFromPersistence();
  assert.equal(fx.ledger.list().length, 0);
});

test("estado terminal o ambiguo no puede ser mutado ni revivido mediante setOffer", async () => {
  const itemUuid = "Item.terminal";
  const fx = fixture({ quantities: { [itemUuid]: 1 } });
  let session = await accepted(fx);
  session = await offer(fx, session, [{ itemUuid, quantity: 1 }], "terminal-offer");
  await fx.ledger.transition(tradeId(session.id, itemUuid), "COMMITTING");
  await fx.ledger.transition(tradeId(session.id, itemUuid), "COMMITTED");
  fx.quantityByItem.set(itemUuid, 2);
  await assert.rejects(offer(fx, session, [{ itemUuid, quantity: 2 }], "terminal-retry"), /estado durable/i);
});

test("legacy consistente no duplica ni incrementa revision", async () => {
  const itemUuid = "Item.legacy-consistent";
  const first = fixture({ quantities: { [itemUuid]: 3 } });
  let session = await accepted(first);
  session = await offer(first, session, [{ itemUuid, quantity: 3 }], "legacy-consistent-offer");
  await first.ledger.hydrateFromPersistence();
  const before = first.ledger.get(tradeId(session.id, itemUuid));
  const second = fixture({ repository: first.repository, quantities: { [itemUuid]: 3 } });
  await second.store.hydrateFromPersistence();
  await second.ledger.hydrateFromPersistence();
  assert.equal(second.ledger.list().filter(r => r.operationId === before.operationId).length, 1);
  assert.equal(second.ledger.get(before.operationId).revision, before.revision);
  assert.equal(second.ledger.getResourceQuarantine("Actor.a-one", itemUuid), null);
});

test("legacy ausente con evidencia inequívoca se importa una sola vez", async () => {
  const itemUuid = "Item.legacy-absent";
  const repository = new TradeRuntimeRepository();
  const legacy = new TradeSessionStore({
    idFactory: () => "legacy-session", repository,
    resolveRealQuantity: () => 3,
    resolveOfferItem: reference => ({ publicSnapshot: { itemUuid: reference.itemUuid, quantity: reference.quantity } })
  });
  legacy.authority = { gmUserId: "gm", epoch: "epoch" };
  const legacyFx = { store: legacy };
  let session = await accepted(legacyFx);
  session = await legacy.setOffer({ sessionId: session.id, participantKey: "participantA", requestingUserId: "user-a-one", entries: [{ itemUuid, quantity: 3 }], revision: session.revision, operationId: "legacy-offer" });
  const migrated = fixture({ repository, quantities: { [itemUuid]: 3 } });
  await migrated.store.hydrateFromPersistence();
  await migrated.ledger.hydrateFromPersistence();
  const record = migrated.ledger.get(tradeId(session.id, itemUuid));
  assert.equal(record.quantity, 3);
  assert.equal(record.evidence.migratedFromLegacyProjection, true);
  await migrated.store.hydrateFromPersistence();
  await migrated.ledger.hydrateFromPersistence();
  assert.equal(migrated.ledger.list().filter(r => r.operationId === record.operationId).length, 1);
});

test("legacy conflict crea quarantine sin elegir quantity", async () => {
  const itemUuid = "Item.legacy-conflict";
  const fx = fixture({ quantities: { [itemUuid]: 5 } });
  let session = await accepted(fx);
  session = await offer(fx, session, [{ itemUuid, quantity: 3 }], "legacy-three");
  await fx.repository.mutate(fx.repository.target, draft => {
    draft.reservations[tradeId(session.id, itemUuid)].quantity = 2;
  });
  const reloaded = fixture({ repository: fx.repository, quantities: { [itemUuid]: 5 } });
  await reloaded.store.hydrateFromPersistence();
  await reloaded.ledger.hydrateFromPersistence();
  assert.equal(reloaded.ledger.get(tradeId(session.id, itemUuid)).quantity, 2);
  assert.equal(reloaded.ledger.getResourceQuarantine("Actor.a-one", itemUuid).state, "ACTIVE");
  await assert.rejects(offer(reloaded, reloaded.store.getSession(session.id), [{ itemUuid, quantity: 4 }], "blocked-by-q"), error => error.reasonCode === "CAPACITY_QUARANTINED");
});

test("fallo de persistencia posterior al ledger conserva capacidad y retry converge", async () => {
  class FaultRepository extends TradeRuntimeRepository {
    writes = 0;
    failAt = null;
    async write(...args) {
      this.writes += 1;
      if (this.writes === this.failAt) throw new Error("injected trade persistence failure");
      return super.write(...args);
    }
  }
  const itemUuid = "Item.persist-window";
  const repository = new FaultRepository();
  const fx = fixture({ repository, quantities: { [itemUuid]: 1 } });
  const session = await accepted(fx);
  repository.failAt = repository.writes + 2;
  const command = { sessionId: session.id, participantKey: "participantA", requestingUserId: "user-a-one", entries: [{ itemUuid, quantity: 1 }], revision: session.revision, operationId: "persist-window-offer" };
  await assert.rejects(fx.store.setOffer(command), /injected/);
  const durable = new SharedReservationLedger({ repository });
  await durable.hydrateFromPersistence();
  assert.equal(durable.get(tradeId(session.id, itemUuid)).state, "RESERVED");
  assert.deepEqual(fx.store.getSession(session.id).offers.participantA, []);
  const recovered = await fx.store.setOffer(command);
  assert.equal(recovered.offers.participantA[0].quantity, 1);
  await durable.hydrateFromPersistence();
  assert.equal(durable.get(tradeId(session.id, itemUuid)).revision, 0);
});

test("lost ACK converge por receipt Trade sin repetir capacity mutation", async () => {
  const itemUuid = "Item.ack";
  const fx = fixture({ quantities: { [itemUuid]: 1 } });
  const session = await accepted(fx);
  const command = { sessionId: session.id, participantKey: "participantA", requestingUserId: "user-a-one", entries: [{ itemUuid, quantity: 1 }], revision: session.revision, operationId: "ack-offer" };
  await fx.store.setOffer(command);
  await fx.ledger.hydrateFromPersistence();
  const revision = fx.ledger.get(tradeId(session.id, itemUuid)).revision;
  const retry = await fx.store.setOffer(command);
  assert.equal(retry.offers.participantA[0].quantity, 1);
  await fx.ledger.hydrateFromPersistence();
  assert.equal(fx.ledger.get(tradeId(session.id, itemUuid)).revision, revision);
});
