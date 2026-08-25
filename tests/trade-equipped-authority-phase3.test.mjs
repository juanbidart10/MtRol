import test from "node:test";
import assert from "node:assert/strict";

let randomId = 0;
globalThis.foundry = {
  utils: {
    duplicate: value => structuredClone(value),
    deepClone: value => structuredClone(value),
    randomID: () => `phase3-${++randomId}`
  }
};

const gm = { id: "gm", isGM: true, active: true };
const playerA = { id: "player-a", isGM: false, active: true };
const playerB = { id: "player-b", isGM: false, active: true };
const users = [gm, playerA, playerB];
users.get = id => users.find(user => user.id === id) ?? null;

globalThis.game = {
  user: gm,
  users,
  socket: { emit() {} }
};
globalThis.CONST = { GRID_TYPES: { SQUARE: 1 } };
globalThis.canvas = { grid: { type: 1, size: 100 } };

function actor(id, ownerId) {
  const items = [];
  items.get = itemId => items.find(item => item.id === itemId) ?? null;
  return {
    id,
    uuid: `Actor.${id}`,
    type: "personaje",
    system: { equipamiento: {} },
    items,
    testUserPermission(user, permission) {
      return permission === "OWNER" && user.id === ownerId;
    }
  };
}

function item(parent, id, quantity) {
  const system = {
    tipoObjeto: "arma",
    cantidad: quantity,
    peso: 1,
    descripcion: "No debe salir del inventario.",
    equipado: true,
    slot: "manoDer",
    danio: "1d8"
  };
  const document = {
    id,
    uuid: `${parent.uuid}.Item.${id}`,
    name: "Espada equipada",
    img: "icons/sword.webp",
    type: "objeto",
    parent,
    system,
    _source: { system: structuredClone(system) }
  };
  parent.items.push(document);
  parent.system.equipamiento.manoDer = id;
  return document;
}

const actorA = actor("actor-a", playerA.id);
const actorB = actor("actor-b", playerB.id);
const equippedItem = item(actorA, "sword", 3);
const scene = { uuid: "Scene.trade", grid: { type: 1, size: 100 } };
const tokenA = { uuid: `${scene.uuid}.Token.a`, actor: actorA, parent: scene, x: 0, y: 0, width: 1, height: 1, elevation: 0 };
const tokenB = { uuid: `${scene.uuid}.Token.b`, actor: actorB, parent: scene, x: 100, y: 0, width: 1, height: 1, elevation: 0 };
const documents = new Map([
  [actorA.uuid, actorA],
  [actorB.uuid, actorB],
  [equippedItem.uuid, equippedItem],
  [tokenA.uuid, tokenA],
  [tokenB.uuid, tokenB]
]);
globalThis.fromUuid = async uuid => documents.get(String(uuid)) ?? null;

const {
  acceptTradeSessionAuthoritative,
  createTradeSessionAuthoritative,
  initializeTradeAuthority,
  setTradeOfferAuthoritative,
  tradeSessionStore
} = await import("../scripts/trade/trade-authority.js");
const { tradeMovementLocks } = await import("../scripts/trade/trade-proximity-service.js");

async function createNegotiating() {
  tradeSessionStore.reset();
  tradeMovementLocks.clear();
  initializeTradeAuthority();
  let session = await createTradeSessionAuthoritative({
    participantAActorUuid: actorA.uuid,
    participantATokenUuid: tokenA.uuid,
    participantBActorUuid: actorB.uuid,
    participantBTokenUuid: tokenB.uuid,
    participantBUserId: playerB.id,
    operationId: "create-equipped"
  }, { requestingUserId: playerA.id });
  session = await acceptTradeSessionAuthoritative({
    sessionId: session.id,
    participantKey: "participantB",
    operationId: "accept-equipped"
  }, { requestingUserId: playerB.id });
  return session;
}

test("16 el GM rechaza un setOffer manipulado con Item equipado sin mutación parcial", async () => {
  const session = await createNegotiating();
  await assert.rejects(() => setTradeOfferAuthoritative({
    sessionId: session.id,
    participantKey: "participantA",
    entries: [{ itemUuid: equippedItem.uuid, itemId: equippedItem.id, quantity: 1 }],
    operationId: "manipulated-equipped"
  }, { requestingUserId: playerA.id }), /está equipado/);

  const after = tradeSessionStore.getSession(session.id);
  assert.equal(after.revision, 0);
  assert.deepEqual(after.offers.participantA, []);
  assert.deepEqual(after.publicOffers.participantA, []);
  assert.deepEqual(after.reservations, []);
});

test("17 el rechazo conserva flag, slot y cantidad del Item equipado", async () => {
  const session = await createNegotiating();
  const beforeSlot = actorA.system.equipamiento.manoDer;
  const beforeQuantity = equippedItem.system.cantidad;

  await assert.rejects(() => setTradeOfferAuthoritative({
    sessionId: session.id,
    participantKey: "participantA",
    entries: [{ itemUuid: equippedItem.uuid, itemId: equippedItem.id, quantity: 1 }],
    operationId: "equipped-remains"
  }, { requestingUserId: playerA.id }), /debe desequiparse manualmente/);

  assert.equal(equippedItem.system.equipado, true);
  assert.equal(actorA.system.equipamiento.manoDer, beforeSlot);
  assert.equal(equippedItem.system.cantidad, beforeQuantity);
});
