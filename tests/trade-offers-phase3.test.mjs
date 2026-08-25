import test from "node:test";
import assert from "node:assert/strict";

globalThis.foundry = {
  utils: {
    duplicate: value => structuredClone(value),
    deepClone: value => structuredClone(value)
  }
};

const { TradeSessionStore } = await import("../scripts/trade/trade-session-service.js");

const A = { userId: "a", actorUuid: "Actor.a" };
const B = { userId: "b", actorUuid: "Actor.b" };
const AUTHORITY = { gmUserId: "gm", epoch: "phase3" };
const POTION = { itemUuid: "Actor.a.Item.potion", itemId: "potion" };
const COIN = { itemUuid: "Actor.a.Item.coin", itemId: "coin" };

function fixture() {
  let now = 0;
  const quantities = new Map([[POTION.itemUuid, 10], [COIN.itemUuid, 50]]);
  const store = new TradeSessionStore({
    idFactory: () => "trade-phase3",
    now: () => ++now,
    resolveRealQuantity: reference => quantities.get(reference.itemUuid) ?? 0,
    resolveOfferItem: reference => ({
      realQuantity: quantities.get(reference.itemUuid) ?? 0,
      publicSnapshot: {
        itemUuid: reference.itemUuid,
        itemId: reference.itemId,
        name: reference.itemId === "coin" ? "Moneda" : "Poción",
        img: "icon.webp",
        type: "objeto",
        tipoObjeto: reference.itemId === "coin" ? "moneda" : "consumible",
        quantity: reference.quantity,
        description: "",
        publicData: {}
      }
    })
  });
  store.reconcileAuthority(AUTHORITY);
  return { store, quantities };
}

async function negotiating(store) {
  let session = await store.createSession({
    participantA: A,
    participantB: B,
    authority: AUTHORITY,
    operationId: "create"
  });
  session = await store.acceptSession({
    sessionId: session.id,
    participantKey: "participantB",
    requestingUserId: "b",
    operationId: "accept"
  });
  return session;
}

async function setPotion(store, quantity, operationId) {
  return store.setOffer({
    sessionId: "trade-phase3",
    participantKey: "participantA",
    requestingUserId: "a",
    entries: [{ ...POTION, quantity }],
    operationId
  });
}

test("18 acepta una cantidad parcial válida", async () => {
  const { store, quantities } = fixture();
  await negotiating(store);
  const session = await setPotion(store, 4, "partial");
  assert.equal(session.publicOffers.participantA[0].quantity, 4);
  assert.equal(quantities.get(POTION.itemUuid), 10);
});

test("19 rechaza cantidad cero sin mutar la sesión", async () => {
  const { store } = fixture();
  const initial = await negotiating(store);
  await assert.rejects(() => setPotion(store, 0, "zero"), /mayor que cero/);
  assert.deepEqual(store.getSession(initial.id).offers.participantA, []);
  assert.equal(store.getSession(initial.id).revision, 0);
});

test("20 rechaza cantidad negativa", async () => {
  const { store } = fixture();
  await negotiating(store);
  await assert.rejects(() => setPotion(store, -1, "negative"), /mayor que cero/);
});

test("21 rechaza cantidad superior a disponibilidad", async () => {
  const { store } = fixture();
  await negotiating(store);
  await assert.rejects(() => setPotion(store, 11, "too-many"), /supera la disponibilidad/);
  assert.equal(store.getReservationsForSession("trade-phase3").length, 0);
});

test("22 availableIncludingSession permite incrementar la reserva propia", async () => {
  const { store } = fixture();
  await negotiating(store);
  await setPotion(store, 4, "four");
  const availability = await store.getAvailability(A.actorUuid, POTION, { sessionId: "trade-phase3" });
  assert.equal(availability.available, 6);
  assert.equal(availability.availableIncludingSession, 10);
  const increased = await setPotion(store, 6, "six");
  assert.equal(increased.reservations[0].quantity, 6);
});

test("23 disminuir cantidad libera parte de la reserva", async () => {
  const { store } = fixture();
  await negotiating(store);
  await setPotion(store, 6, "six");
  await setPotion(store, 2, "two");
  assert.equal(store.getReservedQuantity(A.actorUuid, POTION), 2);
});

test("24 quitar un Item libera su reserva", async () => {
  const { store } = fixture();
  await negotiating(store);
  await setPotion(store, 4, "four");
  await store.setOffer({ sessionId: "trade-phase3", participantKey: "participantA", requestingUserId: "a", entries: [], operationId: "remove" });
  assert.equal(store.getReservedQuantity(A.actorUuid, POTION), 0);
});

test("25 limpiar la oferta libera todas las reservas", async () => {
  const { store } = fixture();
  await negotiating(store);
  await store.setOffer({
    sessionId: "trade-phase3",
    participantKey: "participantA",
    requestingUserId: "a",
    entries: [{ ...POTION, quantity: 2 }, { ...COIN, quantity: 20 }],
    operationId: "two-items"
  });
  await store.setOffer({ sessionId: "trade-phase3", participantKey: "participantA", requestingUserId: "a", entries: [], operationId: "clear" });
  assert.deepEqual(store.getReservationsForSession("trade-phase3"), []);
  assert.deepEqual(store.getSession("trade-phase3").publicOffers.participantA, []);
});

test("26 la misma oferta no incrementa revisión", async () => {
  const { store } = fixture();
  await negotiating(store);
  const first = await setPotion(store, 4, "first");
  const same = await setPotion(store, 4, "same-new-operation");
  assert.equal(first.revision, 1);
  assert.equal(same.revision, 1);
});

test("27 un cambio real incrementa revisión", async () => {
  const { store } = fixture();
  await negotiating(store);
  await setPotion(store, 2, "two");
  const changed = await setPotion(store, 3, "three");
  assert.equal(changed.revision, 2);
});

test("28 un cambio real invalida ambas confirmaciones", async () => {
  const { store } = fixture();
  await negotiating(store);
  let session = await setPotion(store, 2, "two");
  session = await store.confirmSession({ sessionId: session.id, participantKey: "participantA", requestingUserId: "a", revision: session.revision, operationId: "confirm-a" });
  session = await store.confirmSession({ sessionId: session.id, participantKey: "participantB", requestingUserId: "b", revision: session.revision, operationId: "confirm-b" });
  session = await setPotion(store, 3, "change-ready");
  assert.equal(session.confirmations.participantA.confirmed, false);
  assert.equal(session.confirmations.participantB.confirmed, false);
});

test("29 moneda funciona como Item stackeable parcial", async () => {
  const { store } = fixture();
  await negotiating(store);
  const session = await store.setOffer({
    sessionId: "trade-phase3",
    participantKey: "participantA",
    requestingUserId: "a",
    entries: [{ ...COIN, quantity: 17 }],
    operationId: "coins"
  });
  assert.equal(session.publicOffers.participantA[0].tipoObjeto, "moneda");
  assert.equal(session.reservations[0].quantity, 17);
});

test("30 una oferta unilateral con el otro lado vacío es válida", async () => {
  const { store } = fixture();
  await negotiating(store);
  const session = await setPotion(store, 1, "unilateral");
  assert.equal(session.publicOffers.participantA.length, 1);
  assert.deepEqual(session.publicOffers.participantB, []);
});
