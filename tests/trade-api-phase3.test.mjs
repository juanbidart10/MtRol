import test from "node:test";
import assert from "node:assert/strict";

globalThis.foundry = {
  utils: {
    duplicate: value => structuredClone(value),
    deepClone: value => structuredClone(value),
    randomID: () => "phase3-api"
  }
};

const intruder = { id: "intruder", isGM: false, active: true };
const users = [intruder];
users.get = id => users.find(user => user.id === id) ?? null;
globalThis.game = {
  user: intruder,
  users,
  mtrol: {},
  socket: { emit() {} }
};
globalThis.fromUuid = async () => {
  throw new Error("La API no debe resolver un Actor ajeno.");
};
globalThis.Hooks = { callAll() {} };

const {
  installTradeApi,
  receiveTradeSessionSync
} = await import("../scripts/trade/trade-api.js");

const publicSession = {
  id: "trade-api-phase3",
  state: "NEGOTIATING",
  participants: {
    participantA: { userId: "player-a", actorUuid: "Actor.a" },
    participantB: { userId: "player-b", actorUuid: "Actor.b" }
  },
  revision: 1,
  publicOffers: { participantA: [], participantB: [] },
  confirmations: {
    participantA: { confirmed: false, revision: null, confirmedAt: null },
    participantB: { confirmed: false, revision: null, confirmedAt: null }
  }
};

test("API Fase 3 rechaza acceso privado de un usuario ajeno antes de resolver Actor", async () => {
  installTradeApi();
  receiveTradeSessionSync({
    targetUserIds: [intruder.id],
    session: publicSession
  });
  await assert.rejects(() => game.mtrol.trade.getMyInventory(publicSession.id), /no participa/);
});

test("la caché de API conserva sólo la sesión pública sanitizada", () => {
  const cached = game.mtrol.trade.getSession(publicSession.id);
  assert.equal(Object.hasOwn(cached, "offers"), false);
  assert.equal(Object.hasOwn(cached, "reservations"), false);
  assert.equal(Object.hasOwn(cached, "authority"), false);
  assert.equal(JSON.stringify(cached).includes("inventory"), false);
});

test("una sesión terminal se elimina de la caché después de notificar runtime", () => {
  receiveTradeSessionSync({
    targetUserIds: [intruder.id],
    session: { ...publicSession, state: "CANCELLED" }
  });
  assert.equal(game.mtrol.trade.getSession(publicSession.id), null);
});
