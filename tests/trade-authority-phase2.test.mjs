import test from "node:test";
import assert from "node:assert/strict";

let randomId = 0;
const emitted = [];

globalThis.foundry = {
  utils: {
    duplicate: value => structuredClone(value),
    deepClone: value => structuredClone(value),
    randomID: () => `random-${++randomId}`
  }
};

const gm = { id: "gm", isGM: true, active: true };
const gm2 = { id: "gm-2", isGM: true, active: false };
const playerA = { id: "player-a", isGM: false, active: true };
const playerB = { id: "player-b", isGM: false, active: true };
const intruder = { id: "intruder", isGM: false, active: true };
const users = [gm, gm2, playerA, playerB, intruder];
users.get = id => users.find(user => user.id === id) ?? null;

globalThis.game = {
  user: gm,
  users,
  socket: {
    emit(channel, payload) {
      emitted.push({ channel, payload: structuredClone(payload) });
    }
  }
};
globalThis.CONST = { GRID_TYPES: { SQUARE: 1 } };
globalThis.canvas = { grid: { type: 1, size: 100 } };

function createItem(actor, id, quantity) {
  const item = {
    id,
    uuid: `${actor.uuid}.Item.${id}`,
    name: id,
    type: "objeto",
    parent: actor,
    system: { cantidad: quantity, peso: 1, equipado: false },
    _source: {
      system: { cantidad: quantity, peso: 1, equipado: false }
    }
  };
  actor.items.push(item);
  return item;
}

function createActor(id, ownerUserId) {
  const items = [];
  items.get = itemId => items.find(item => item.id === itemId) ?? null;
  return {
    id,
    uuid: `Actor.${id}`,
    items,
    testUserPermission(user, permission) {
      return permission === "OWNER" && user.id === ownerUserId;
    }
  };
}

const actorA = createActor("actor-a", playerA.id);
const actorB = createActor("actor-b", playerB.id);
const actorWithoutOwner = createActor("actor-no-owner", "nobody");
const potion = createItem(actorA, "potion", 10);
const elixir = createItem(actorB, "elixir", 5);
const scene = { uuid: "Scene.trade", grid: { type: 1, size: 100 } };
const tokenA = { uuid: `${scene.uuid}.Token.a`, actor: actorA, parent: scene, x: 0, y: 0, width: 1, height: 1, elevation: 0 };
const tokenB = { uuid: `${scene.uuid}.Token.b`, actor: actorB, parent: scene, x: 100, y: 0, width: 1, height: 1, elevation: 0 };
const documents = new Map([
  [actorA.uuid, actorA],
  [actorB.uuid, actorB],
  [actorWithoutOwner.uuid, actorWithoutOwner],
  [potion.uuid, potion],
  [elixir.uuid, elixir],
  [tokenA.uuid, tokenA],
  [tokenB.uuid, tokenB]
]);

globalThis.fromUuid = async uuid => documents.get(String(uuid)) ?? null;

const {
  acceptTradeSessionAuthoritative,
  createTradeSessionAuthoritative,
  initializeTradeAuthority,
  observeTradeSessionsAuthoritative,
  reconcileTradeAuthority,
  setTradeOfferAuthoritative,
  tradeSessionStore
} = await import("../scripts/trade/trade-authority.js");
const { tradeMovementLocks } = await import("../scripts/trade/trade-proximity-service.js");

function resetAuthority() {
  tradeSessionStore.reset();
  tradeMovementLocks.clear();
  emitted.length = 0;
  gm.active = true;
  gm2.active = false;
  game.user = gm;
  initializeTradeAuthority();
  emitted.length = 0;
}

async function createSession(operationId = "create-authority") {
  return createTradeSessionAuthoritative({
    participantAActorUuid: actorA.uuid,
    participantATokenUuid: tokenA.uuid,
    participantBActorUuid: actorB.uuid,
    participantBTokenUuid: tokenB.uuid,
    participantBUserId: playerB.id,
    operationId
  }, {
    requestingUserId: playerA.id
  });
}

test("la autoridad GM crea una sesión desde Actors canónicos con OWNER", async () => {
  resetAuthority();
  const session = await createSession();

  assert.equal(session.participants.participantA.actorUuid, actorA.uuid);
  assert.equal(session.participants.participantB.actorUuid, actorB.uuid);
  assert.equal(session.authority.gmUserId, gm.id);
  assert.equal(observeTradeSessionsAuthoritative().length, 1);
  assert.equal(emitted.at(-1).payload.action, "mtrolTradeSessionSync");
});

test("Actor sin OWNER para el solicitante no puede comerciar y no deja lock", async () => {
  resetAuthority();

  await assert.rejects(() => createTradeSessionAuthoritative({
    participantAActorUuid: actorWithoutOwner.uuid,
    participantBActorUuid: actorB.uuid,
    participantBUserId: playerB.id,
    operationId: "no-owner"
  }, {
    requestingUserId: playerA.id
  }), /OWNER/);

  assert.equal(tradeSessionStore.getActiveSessionIdForActor(actorWithoutOwner.uuid), null);
  assert.equal(tradeSessionStore.listSessions().length, 0);
});

test("un usuario desconectado o GM no puede ser participante", async () => {
  resetAuthority();
  playerB.active = false;
  await assert.rejects(() => createSession("offline-user"), /no está conectado/);
  playerB.active = true;

  await assert.rejects(() => createTradeSessionAuthoritative({
    participantAActorUuid: actorA.uuid,
    participantBActorUuid: actorB.uuid,
    participantBUserId: gm.id,
    operationId: "gm-participant"
  }, {
    requestingUserId: playerA.id
  }), /no participa/);
});

test("la reserva resuelve Item UUID canónico y rechaza Item de otro Actor", async () => {
  resetAuthority();
  let session = await createSession();
  session = await acceptTradeSessionAuthoritative({
    sessionId: session.id,
    participantKey: "participantB",
    operationId: "accept-authority"
  }, {
    requestingUserId: playerB.id
  });

  session = await setTradeOfferAuthoritative({
    sessionId: session.id,
    participantKey: "participantA",
    entries: [{ itemUuid: potion.uuid, itemId: potion.id, quantity: 4 }],
    operationId: "canonical-offer"
  }, {
    requestingUserId: playerA.id
  });
  assert.equal(session.reservations[0].itemUuid, potion.uuid);
  assert.equal(session.reservations[0].quantity, 4);

  await assert.rejects(() => setTradeOfferAuthoritative({
    sessionId: session.id,
    participantKey: "participantA",
    entries: [{ itemUuid: elixir.uuid, itemId: elixir.id, quantity: 1 }],
    operationId: "foreign-item"
  }, {
    requestingUserId: playerA.id
  }), /no pertenece/);
});

test("un cliente que no es GM primario no puede ejecutar handlers autoritativos", async () => {
  resetAuthority();
  game.user = playerA;

  await assert.rejects(() => createSession("client-authority"), /GM primario/);
  game.user = gm;
});

test("el payload sincronizado contiene sólo la TradeSession y no inventarios", async () => {
  resetAuthority();
  await createSession();
  const sync = emitted.find(entry => entry.payload.action === "mtrolTradeSessionSync");
  const serialized = JSON.stringify(sync.payload);

  assert.deepEqual(sync.payload.targetUserIds.sort(), [playerA.id, playerB.id].sort());
  assert.equal(serialized.includes("items"), false);
  assert.equal(serialized.includes("inventory"), false);
  assert.equal(serialized.includes("potion"), false);
});

test("al cambiar el GM primario la sesión persistente no se invalida", async () => {
  resetAuthority();
  const session = await createSession();
  gm.active = false;
  gm2.active = true;

  const result = await reconcileTradeAuthority();

  assert.equal(result.primary, false);
  assert.equal(result.invalidated.length, 0);
  assert.equal(tradeSessionStore.getSession(session.id).state, "REQUESTED");
  assert.equal(tradeSessionStore.getActiveSessionIdForActor(actorA.uuid), session.id);
  assert.equal(tradeSessionStore.getReservationsForSession(session.id).length, 0);

  gm.active = true;
  gm2.active = false;
});
