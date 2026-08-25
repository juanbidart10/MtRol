import test from "node:test";
import assert from "node:assert/strict";

globalThis.foundry = {
  utils: {
    duplicate: value => structuredClone(value),
    deepClone: value => structuredClone(value)
  }
};

const {
  TRADE_SESSION_STATES,
  TradeSessionStore
} = await import("../scripts/trade/trade-session-service.js");

const PARTICIPANT_A = Object.freeze({
  userId: "player-a",
  actorUuid: "Actor.actor-a",
  tokenUuid: "Scene.scene.Token.token-a"
});

const PARTICIPANT_B = Object.freeze({
  userId: "player-b",
  actorUuid: "Actor.actor-b",
  tokenUuid: "Scene.scene.Token.token-b"
});

const AUTHORITY = Object.freeze({
  gmUserId: "gm",
  epoch: "epoch-1"
});

const POTION_A = Object.freeze({
  itemUuid: "Actor.actor-a.Item.potion",
  itemId: "potion"
});

const COIN_A = Object.freeze({
  itemUuid: "Actor.actor-a.Item.coin",
  itemId: "coin"
});

function createFixture({ onSessionCreated = null } = {}) {
  let id = 0;
  let now = 1000;
  const quantities = new Map([
    [POTION_A.itemUuid, 10],
    [COIN_A.itemUuid, 100],
    ["Actor.actor-b.Item.elixir", 5]
  ]);
  const store = new TradeSessionStore({
    idFactory: () => `trade-${++id}`,
    now: () => ++now,
    onSessionCreated,
    resolveRealQuantity: reference => quantities.get(reference.itemUuid) ?? 0
  });
  store.reconcileAuthority(AUTHORITY);
  return { store, quantities };
}

async function createRequested(store, operationId = "create-1") {
  return store.createSession({
    participantA: PARTICIPANT_A,
    participantB: PARTICIPANT_B,
    authority: AUTHORITY,
    operationId
  });
}

async function createNegotiating(store) {
  const requested = await createRequested(store);
  return store.acceptSession({
    sessionId: requested.id,
    participantKey: "participantB",
    requestingUserId: PARTICIPANT_B.userId,
    operationId: "accept-1"
  });
}

async function reservePotion(store, quantity = 4, operationId = "offer-a-1") {
  const session = store.listSessions({ activeOnly: true })[0] ?? await createNegotiating(store);
  return store.setOffer({
    sessionId: session.id,
    participantKey: "participantA",
    requestingUserId: PARTICIPANT_A.userId,
    entries: [{ ...POTION_A, quantity }],
    operationId
  });
}

async function makeReady(store) {
  let session = await createNegotiating(store);
  session = await store.confirmSession({
    sessionId: session.id,
    participantKey: "participantA",
    requestingUserId: PARTICIPANT_A.userId,
    revision: session.revision,
    operationId: "confirm-a"
  });
  return store.confirmSession({
    sessionId: session.id,
    participantKey: "participantB",
    requestingUserId: PARTICIPANT_B.userId,
    revision: session.revision,
    operationId: "confirm-b"
  });
}

test("crea una TradeSession válida, única y con dos participantes distintos", async () => {
  const { store } = createFixture();
  const first = await createRequested(store);

  assert.equal(first.state, TRADE_SESSION_STATES.REQUESTED);
  assert.equal(first.id, "trade-1");
  assert.notEqual(first.participants.participantA.actorUuid, first.participants.participantB.actorUuid);
  assert.notEqual(first.participants.participantA.userId, first.participants.participantB.userId);
  assert.equal(store.getActiveSessionIdForActor(PARTICIPANT_A.actorUuid), first.id);
  assert.equal(store.getActiveSessionIdForActor(PARTICIPANT_B.actorUuid), first.id);

  await store.cancelSession({
    sessionId: first.id,
    participantKey: "participantA",
    requestingUserId: PARTICIPANT_A.userId,
    operationId: "cancel-first"
  });
  const second = await createRequested(store, "create-2");
  assert.equal(second.id, "trade-2");
});

test("rechaza participantes con el mismo Actor o el mismo usuario", async () => {
  const { store } = createFixture();

  await assert.rejects(() => store.createSession({
    participantA: PARTICIPANT_A,
    participantB: { ...PARTICIPANT_B, actorUuid: PARTICIPANT_A.actorUuid },
    authority: AUTHORITY,
    operationId: "same-actor"
  }), /Actors distintos/);

  await assert.rejects(() => store.createSession({
    participantA: PARTICIPANT_A,
    participantB: { ...PARTICIPANT_B, userId: PARTICIPANT_A.userId },
    authority: AUTHORITY,
    operationId: "same-user"
  }), /usuarios distintos/);
});

test("un Actor no puede pertenecer a dos sesiones activas", async () => {
  const { store } = createFixture();
  await createRequested(store);

  await assert.rejects(() => store.createSession({
    participantA: PARTICIPANT_A,
    participantB: {
      userId: "player-c",
      actorUuid: "Actor.actor-c"
    },
    authority: AUTHORITY,
    operationId: "create-conflict"
  }), /comercio activo/);

  assert.equal(store.listSessions({ activeOnly: true }).length, 1);
});

test("reserva lógica parcial sin modificar la cantidad real", async () => {
  const { store, quantities } = createFixture();
  const session = await createNegotiating(store);
  const offered = await store.setOffer({
    sessionId: session.id,
    participantKey: "participantA",
    requestingUserId: PARTICIPANT_A.userId,
    entries: [{ ...POTION_A, quantity: 4 }],
    operationId: "reserve-partial"
  });
  const availability = await store.getAvailability(PARTICIPANT_A.actorUuid, POTION_A, {
    sessionId: session.id
  });

  assert.equal(quantities.get(POTION_A.itemUuid), 10);
  assert.equal(offered.reservations[0].quantity, 4);
  assert.equal(availability.real, 10);
  assert.equal(availability.reserved, 4);
  assert.equal(availability.available, 6);
  assert.equal(availability.availableIncludingSession, 10);
});

test("rechaza una reserva superior a la cantidad disponible", async () => {
  const { store } = createFixture();
  const session = await createNegotiating(store);

  await assert.rejects(() => store.setOffer({
    sessionId: session.id,
    participantKey: "participantA",
    requestingUserId: PARTICIPANT_A.userId,
    entries: [{ ...POTION_A, quantity: 11 }],
    operationId: "reserve-too-much"
  }), /supera la disponibilidad/);

  assert.deepEqual(store.getReservationsForSession(session.id), []);
  assert.equal(store.getSession(session.id).revision, 0);
});

test("múltiples entradas del mismo Item se agregan en una única reserva", async () => {
  const { store } = createFixture();
  const session = await createNegotiating(store);
  const offered = await store.setOffer({
    sessionId: session.id,
    participantKey: "participantA",
    requestingUserId: PARTICIPANT_A.userId,
    entries: [
      { ...POTION_A, quantity: 2 },
      { ...POTION_A, quantity: 3 },
      { ...COIN_A, quantity: 20 }
    ],
    operationId: "multi-reserve"
  });

  assert.equal(offered.offers.participantA.length, 2);
  assert.equal(offered.reservations.length, 2);
  assert.equal(
    offered.reservations.find(reservation => reservation.itemId === "potion").quantity,
    5
  );
  assert.equal(store.getReservedQuantity(PARTICIPANT_A.actorUuid, POTION_A), 5);
  assert.equal(store.getReservedQuantity(PARTICIPANT_A.actorUuid, COIN_A), 20);
});

test("modificar una oferta incrementa revision e invalida confirmaciones", async () => {
  const { store } = createFixture();
  let session = await createNegotiating(store);
  session = await reservePotion(store, 2);
  session = await store.confirmSession({
    sessionId: session.id,
    participantKey: "participantA",
    requestingUserId: PARTICIPANT_A.userId,
    revision: session.revision,
    operationId: "confirm-before-change"
  });
  assert.equal(session.confirmations.participantA.confirmed, true);

  session = await store.setOffer({
    sessionId: session.id,
    participantKey: "participantA",
    requestingUserId: PARTICIPANT_A.userId,
    entries: [{ ...POTION_A, quantity: 3 }],
    operationId: "offer-change"
  });

  assert.equal(session.revision, 2);
  assert.deepEqual(session.confirmations.participantA, {
    confirmed: false,
    revision: null,
    confirmedAt: null
  });
  assert.equal(session.confirmations.participantB.confirmed, false);
  assert.equal(session.state, TRADE_SESSION_STATES.NEGOTIATING);
});

test("una confirmación vieja no produce READY", async () => {
  const { store } = createFixture();
  const session = await reservePotion(store, 2);

  await assert.rejects(() => store.confirmSession({
    sessionId: session.id,
    participantKey: "participantA",
    requestingUserId: PARTICIPANT_A.userId,
    revision: session.revision - 1,
    operationId: "stale-confirmation"
  }), /revisión vigente/);

  assert.equal(store.getSession(session.id).state, TRADE_SESSION_STATES.NEGOTIATING);
  assert.equal(store.getSession(session.id).confirmations.participantA.confirmed, false);
});

test("dos confirmaciones de la revisión exacta producen READY", async () => {
  const { store } = createFixture();
  let session = await reservePotion(store, 2);
  const revision = session.revision;

  session = await store.confirmSession({
    sessionId: session.id,
    participantKey: "participantA",
    requestingUserId: PARTICIPANT_A.userId,
    revision,
    operationId: "ready-confirm-a"
  });
  assert.equal(session.state, TRADE_SESSION_STATES.NEGOTIATING);

  session = await store.confirmSession({
    sessionId: session.id,
    participantKey: "participantB",
    requestingUserId: PARTICIPANT_B.userId,
    revision,
    operationId: "ready-confirm-b"
  });
  assert.equal(session.state, TRADE_SESSION_STATES.READY);
});

test("CANCELLED libera reservas, confirmaciones e índice Actor → session", async () => {
  const { store } = createFixture();
  const offered = await reservePotion(store, 4);
  const cancelled = await store.cancelSession({
    sessionId: offered.id,
    participantKey: "participantA",
    requestingUserId: PARTICIPANT_A.userId,
    operationId: "cancel-reserved"
  });

  assert.equal(cancelled.state, TRADE_SESSION_STATES.CANCELLED);
  assert.deepEqual(cancelled.reservations, []);
  assert.equal(store.getReservedQuantity(PARTICIPANT_A.actorUuid, POTION_A), 0);
  assert.equal(store.getActiveSessionIdForActor(PARTICIPANT_A.actorUuid), null);
  assert.equal(store.getActiveSessionIdForActor(PARTICIPANT_B.actorUuid), null);
});

test("COMPLETED libera reservas y locks", async () => {
  const { store } = createFixture();
  let session = await reservePotion(store, 4);
  session = await store.confirmSession({
    sessionId: session.id,
    participantKey: "participantA",
    requestingUserId: PARTICIPANT_A.userId,
    revision: session.revision,
    operationId: "complete-confirm-a"
  });
  session = await store.confirmSession({
    sessionId: session.id,
    participantKey: "participantB",
    requestingUserId: PARTICIPANT_B.userId,
    revision: session.revision,
    operationId: "complete-confirm-b"
  });
  session = await store.beginExecution({
    sessionId: session.id,
    authorityUserId: "gm",
    executionId: "execution-phase2",
    revision: session.revision,
    operationId: "begin-execution"
  });
  session = await store.completeSession({
    sessionId: session.id,
    authorityUserId: "gm",
    executionId: "execution-phase2",
    operationId: "complete-execution"
  });

  assert.equal(session.state, TRADE_SESSION_STATES.COMPLETED);
  assert.deepEqual(session.reservations, []);
  assert.equal(store.getActiveSessionIdForActor(PARTICIPANT_A.actorUuid), null);
});

test("INVALID libera reservas y conserva el motivo", async () => {
  const { store } = createFixture();
  const session = await reservePotion(store, 4);
  const invalid = await store.invalidateSession({
    sessionId: session.id,
    authorityUserId: "gm",
    reason: "test-invalid",
    operationId: "invalidate"
  });

  assert.equal(invalid.state, TRADE_SESSION_STATES.INVALID);
  assert.equal(invalid.invalidReason, "test-invalid");
  assert.deepEqual(invalid.reservations, []);
  assert.equal(store.getActiveSessionIdForActor(PARTICIPANT_A.actorUuid), null);
});

test("repetir create con el mismo operationId devuelve la misma sesión", async () => {
  const { store } = createFixture();
  const first = await createRequested(store, "same-create");
  const repeated = await createRequested(store, "same-create");

  assert.equal(repeated.id, first.id);
  assert.equal(store.listSessions().length, 1);
});

test("cancelar repetidamente es idempotente", async () => {
  const { store } = createFixture();
  const session = await createNegotiating(store);
  const first = await store.cancelSession({
    sessionId: session.id,
    participantKey: "participantB",
    requestingUserId: PARTICIPANT_B.userId,
    operationId: "cancel-repeat"
  });
  const replay = await store.cancelSession({
    sessionId: session.id,
    participantKey: "participantB",
    requestingUserId: PARTICIPANT_B.userId,
    operationId: "cancel-repeat"
  });
  const newRequest = await store.cancelSession({
    sessionId: session.id,
    participantKey: "participantB",
    requestingUserId: PARTICIPANT_B.userId,
    operationId: "cancel-after-terminal"
  });

  assert.equal(replay.cancelledAt, first.cancelledAt);
  assert.equal(newRequest.cancelledAt, first.cancelledAt);
});

test("un request repetido no aplica dos veces la mutación de oferta", async () => {
  const { store } = createFixture();
  const session = await createNegotiating(store);
  const payload = {
    sessionId: session.id,
    participantKey: "participantA",
    requestingUserId: PARTICIPANT_A.userId,
    entries: [{ ...POTION_A, quantity: 4 }],
    operationId: "same-offer-operation"
  };
  const first = await store.setOffer(payload);
  const replay = await store.setOffer(payload);

  assert.equal(first.revision, 1);
  assert.equal(replay.revision, 1);
  assert.equal(store.getSession(session.id).revision, 1);
  assert.equal(store.getReservedQuantity(PARTICIPANT_A.actorUuid, POTION_A), 4);
});

test("un operationId no puede reutilizarse con otro payload", async () => {
  const { store } = createFixture();
  const session = await createNegotiating(store);
  await store.setOffer({
    sessionId: session.id,
    participantKey: "participantA",
    requestingUserId: PARTICIPANT_A.userId,
    entries: [{ ...POTION_A, quantity: 2 }],
    operationId: "operation-collision"
  });

  await assert.rejects(() => store.setOffer({
    sessionId: session.id,
    participantKey: "participantA",
    requestingUserId: PARTICIPANT_A.userId,
    entries: [{ ...POTION_A, quantity: 3 }],
    operationId: "operation-collision"
  }), /otro payload/);
});

test("usuario ajeno no puede mutar y A no puede actuar como B", async () => {
  const { store } = createFixture();
  const session = await createNegotiating(store);

  await assert.rejects(() => store.setOffer({
    sessionId: session.id,
    participantKey: "participantA",
    requestingUserId: "intruder",
    entries: [],
    operationId: "intruder"
  }), /no puede actuar/);

  await assert.rejects(() => store.setOffer({
    sessionId: session.id,
    participantKey: "participantB",
    requestingUserId: PARTICIPANT_A.userId,
    entries: [],
    operationId: "impersonate-b"
  }), /no puede actuar/);
});

test("fallo durante creación no deja session lock zombie", async () => {
  const { store } = createFixture({
    onSessionCreated: () => {
      throw new Error("fallo de lifecycle");
    }
  });

  await assert.rejects(() => createRequested(store), /fallo de lifecycle/);
  assert.equal(store.getActiveSessionIdForActor(PARTICIPANT_A.actorUuid), null);
  assert.equal(store.getActiveSessionIdForActor(PARTICIPANT_B.actorUuid), null);
  assert.equal(store.listSessions().length, 0);
});

test("cambio o pérdida del GM invalida sesiones y limpia recursos locales", async () => {
  const { store } = createFixture();
  const session = await reservePotion(store, 4);

  assert.deepEqual(store.reconcileAuthority(AUTHORITY), []);
  const invalidated = store.reconcileAuthority({
    gmUserId: "gm-2",
    epoch: "epoch-2",
    reason: "primary-gm-changed"
  });

  assert.equal(invalidated.length, 1);
  assert.equal(invalidated[0].id, session.id);
  assert.equal(invalidated[0].state, TRADE_SESSION_STATES.INVALID);
  assert.equal(invalidated[0].invalidReason, "primary-gm-changed");
  assert.equal(store.getReservedQuantity(PARTICIPANT_A.actorUuid, POTION_A), 0);
  assert.equal(store.getActiveSessionIdForActor(PARTICIPANT_A.actorUuid), null);
});

test("ausencia total de GM invalida la sesión sin dejar reservas zombie", async () => {
  const { store } = createFixture();
  const session = await reservePotion(store, 4);
  const invalidated = store.reconcileAuthority({
    gmUserId: null,
    epoch: null,
    reason: "primary-gm-lost"
  });

  assert.equal(invalidated[0].id, session.id);
  assert.equal(invalidated[0].invalidReason, "primary-gm-lost");
  assert.equal(store.getReservedQuantity(PARTICIPANT_A.actorUuid, POTION_A), 0);
  assert.equal(store.getActiveSessionIdForActor(PARTICIPANT_A.actorUuid), null);
});

test("TradeSession sólo serializa referencias y ofertas, nunca inventarios de Actor", async () => {
  const { store } = createFixture();
  const session = await reservePotion(store, 4);
  const serialized = JSON.stringify(session);

  assert.equal(serialized.includes("inventoryA"), false);
  assert.equal(serialized.includes("inventoryB"), false);
  assert.equal(serialized.includes("actor.items"), false);
  assert.equal(Object.hasOwn(session.participants.participantA, "actor"), false);
});
