import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

globalThis.foundry = {
  utils: {
    duplicate: value => structuredClone(value),
    deepClone: value => structuredClone(value),
    randomID: () => "socket-test-id"
  }
};

const users = [];
users.get = id => users.find(user => user.id === id) ?? null;

globalThis.game = {
  user: { id: "player-a", isGM: false, active: true },
  users,
  mtrol: {},
  socket: { emit() {} }
};

globalThis.fromUuid = async () => null;
globalThis.Hooks = {
  calls: [],
  callAll(...args) {
    this.calls.push(args);
  }
};

const {
  installTradeApi,
  receiveTradeAuthorityReset,
  receiveTradeSessionSync
} = await import("../scripts/trade/trade-api.js");

test("la API cliente conserva sólo sesiones sanitizadas y limpia cache al cambiar epoch", () => {
  installTradeApi();
  receiveTradeAuthorityReset({
    authority: { gmUserId: "gm-1", epoch: "epoch-1" },
    invalidatedSessionIds: []
  });

  const session = {
    id: "trade-client",
    state: "REQUESTED",
    participants: {
      participantA: { userId: "player-a", actorUuid: "Actor.a" },
      participantB: { userId: "player-b", actorUuid: "Actor.b" }
    },
    offers: { participantA: [], participantB: [] },
    reservations: []
  };
  assert.equal(receiveTradeSessionSync({
    targetUserIds: ["player-a", "player-b"],
    session,
    reason: "test"
  }), true);
  assert.equal(game.mtrol.trade.getSession(session.id).id, session.id);
  assert.equal(game.mtrol.trade.listSessions().length, 1);

  receiveTradeAuthorityReset({
    authority: { gmUserId: "gm-2", epoch: "epoch-2" },
    invalidatedSessionIds: []
  });
  assert.equal(game.mtrol.trade.getSession(session.id), null);
  assert.deepEqual(game.mtrol.trade.listSessions(), []);
});

test("sockets conecta las cinco mutaciones de Fase 2 mediante respondWithResult", async () => {
  const source = await readFile(
    new URL("../scripts/runtime/trade-commands.js", import.meta.url),
    "utf8"
  );

  for (const action of [
    "mtrolTradeCreateSession",
    "mtrolTradeAcceptSession",
    "mtrolTradeSetOffer",
    "mtrolTradeConfirm",
    "mtrolTradeCancel"
  ]) {
    assert.match(source, new RegExp(`${action}: "trade\\.`));
  }

  assert.match(source, /commandRegistry\.register\("trade\.create"/);
  assert.match(source, /receiptTarget: tradeReceiptScope/);
});
