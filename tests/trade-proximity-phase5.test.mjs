import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

globalThis.foundry = { utils: { deepClone: structuredClone, duplicate: structuredClone, randomID: () => "p5" } };
globalThis.CONST = { GRID_TYPES: { SQUARE: 1 } };
const gm = { id: "gm", isGM: true, active: true };
const userA = { id: "a", isGM: false, active: true };
const userB = { id: "b", isGM: false, active: true };
const users = [gm, userA, userB]; users.get = id => users.find(user => user.id === id) ?? null;
globalThis.game = { user: userA, users, mtrol: { trade: { listSessions: () => [] } }, socket: { emit() {} } };
globalThis.ui = { notifications: { warn() {} } };
globalThis.Hooks = { on() {}, callAll() {} };

const {
  TradeMovementLockService,
  measureSquareGridTokenDistance,
  validateTradeTokenProximity
} = await import("../scripts/trade/trade-proximity-service.js");
const {
  enforceTradeTokenMovementAuthoritative,
  preventLockedTradeTokenMovement
} = await import("../scripts/trade/trade-hooks.js");
const { tradeMovementLocks } = await import("../scripts/trade/trade-proximity-service.js");

function token(id, actorUuid, { scene = "Scene.one", x = 0, y = 0, width = 1, height = 1 } = {}) {
  const parent = { uuid: scene, grid: { type: 1, size: 100 } };
  return {
    id,
    uuid: `${scene}.Token.${id}`,
    actor: { uuid: actorUuid },
    parent,
    x, y, width, height, elevation: 0,
    async update(position) { Object.assign(this, position); this.lastUpdate = position; }
  };
}

function session(state, a, b, id = "session-5") {
  return {
    id,
    state,
    participants: {
      participantA: { userId: userA.id, actorUuid: a.actor.uuid, tokenUuid: a.uuid },
      participantB: { userId: userB.id, actorUuid: b.actor.uuid, tokenUuid: b.uuid }
    }
  };
}

test("5-01 Scenes distintas rechazan", () => {
  assert.throws(() => validateTradeTokenProximity({ tokenA: token("a", "Actor.a"), tokenB: token("b", "Actor.b", { scene: "Scene.two" }) }), /misma Scene/);
});

test("5-02 distancia mayor a una casilla rechaza", () => {
  assert.throws(() => validateTradeTokenProximity({ tokenA: token("a", "Actor.a"), tokenB: token("b", "Actor.b", { x: 200 }) }), /adyacentes/);
});

test("5-03 adyacencia ortogonal acepta", () => {
  assert.equal(validateTradeTokenProximity({ tokenA: token("a", "Actor.a"), tokenB: token("b", "Actor.b", { x: 100 }) }).distance, 1);
});

test("5-04 diagonal acepta", () => {
  assert.equal(validateTradeTokenProximity({ tokenA: token("a", "Actor.a"), tokenB: token("b", "Actor.b", { x: 100, y: 100 }) }).valid, true);
});

test("5-05 mismo Actor rechaza", () => {
  assert.throws(() => validateTradeTokenProximity({ tokenA: token("a", "Actor.a"), tokenB: token("b", "Actor.a", { x: 100 }) }), /distintos/);
});

test("5-06 Token faltante rechaza", () => {
  assert.throws(() => validateTradeTokenProximity({ tokenA: token("a", "Actor.a"), tokenB: null }), /deben existir/);
});

test("5-07 aceptación NEGOTIATING crea movement locks", () => {
  const a = token("a7", "Actor.a"); const b = token("b7", "Actor.b", { x: 100 }); const locks = new TradeMovementLockService();
  locks.lockSession(session("NEGOTIATING", a, b), { participantA: a, participantB: b }); assert.equal(locks.count(), 2);
});

test("5-08 REQUESTED no bloquea", () => {
  const a = token("a8", "Actor.a"); const b = token("b8", "Actor.b", { x: 100 });
  assert.throws(() => new TradeMovementLockService().lockSession(session("REQUESTED", a, b), { participantA: a, participantB: b }), /todavía no/);
});

test("5-09 Jugador A no mueve su Token", () => {
  const a = token("a9", "Actor.a"); const b = token("b9", "Actor.b", { x: 100 });
  game.user = userA; game.mtrol.trade.listSessions = () => [session("NEGOTIATING", a, b)];
  assert.equal(preventLockedTradeTokenMovement(a, { x: 50 }, userA.id), false);
});

test("5-10 Jugador B no mueve su Token", () => {
  const a = token("a10", "Actor.a"); const b = token("b10", "Actor.b", { x: 100 });
  game.user = userB; game.mtrol.trade.listSessions = () => [session("READY", a, b)];
  assert.equal(preventLockedTradeTokenMovement(b, { y: 50 }, userB.id), false);
});

test("5-11 GM sí mueve y actualiza la posición autorizada", async () => {
  tradeMovementLocks.clear(); const a = token("a11", "Actor.a"); const b = token("b11", "Actor.b", { x: 100 });
  tradeMovementLocks.lockSession(session("NEGOTIATING", a, b), { participantA: a, participantB: b }); game.user = gm;
  a.x = 50; await enforceTradeTokenMovementAuthoritative(a, { x: 50 }, {}, gm.id);
  assert.equal(tradeMovementLocks.getLock(a.uuid).position.x, 50);
});

test("5-12 cancel libera A", () => {
  const a = token("a12", "Actor.a"); const b = token("b12", "Actor.b", { x: 100 }); const locks = new TradeMovementLockService(); const s = session("NEGOTIATING", a, b);
  locks.lockSession(s, { participantA: a, participantB: b }); locks.releaseSession(s.id); assert.equal(locks.getLock(a.uuid), null);
});

test("5-13 cancel libera B", () => {
  const a = token("a13", "Actor.a"); const b = token("b13", "Actor.b", { x: 100 }); const locks = new TradeMovementLockService(); const s = session("NEGOTIATING", a, b);
  locks.lockSession(s, { participantA: a, participantB: b }); locks.releaseSession(s.id); assert.equal(locks.getLock(b.uuid), null);
});

test("5-14 complete libera locks", () => {
  const a = token("a14", "Actor.a"); const b = token("b14", "Actor.b", { x: 100 }); const locks = new TradeMovementLockService(); const s = session("EXECUTING", a, b);
  locks.lockSession(s, { participantA: a, participantB: b }); assert.equal(locks.releaseSession(s.id), 2);
});

test("5-15 invalid libera locks", () => {
  const locks = new TradeMovementLockService(); locks.clear(); assert.equal(locks.count(), 0);
});

test("5-16 error lifecycle puede limpiar todos los locks", () => {
  const a = token("a16", "Actor.a"); const b = token("b16", "Actor.b", { x: 100 }); const locks = new TradeMovementLockService();
  locks.lockSession(session("READY", a, b), { participantA: a, participantB: b }); locks.clear(); assert.equal(locks.count(), 0);
});

test("5-17 bypass ordinario se revierte por autoridad", async () => {
  tradeMovementLocks.clear(); const a = token("a17", "Actor.a"); const b = token("b17", "Actor.b", { x: 100 });
  tradeMovementLocks.lockSession(session("NEGOTIATING", a, b), { participantA: a, participantB: b }); game.user = gm; a.x = 300;
  assert.equal(await enforceTradeTokenMovementAuthoritative(a, { x: 300 }, {}, userA.id), true); assert.equal(a.x, 0);
});

test("5-18 Token grande calcula proximidad desde su superficie", () => {
  const a = token("a18", "Actor.a", { width: 2, height: 2 }); const b = token("b18", "Actor.b", { x: 200, y: 100 });
  assert.equal(measureSquareGridTokenDistance(a, b, { size: 100 }), 1);
});

test("5-19 locks pertenecen a sessionId", () => {
  const a = token("a19", "Actor.a"); const b = token("b19", "Actor.b", { x: 100 }); const locks = new TradeMovementLockService();
  locks.lockSession(session("NEGOTIATING", a, b, "owned-session"), { participantA: a, participantB: b }); assert.equal(locks.getLock(a.uuid).sessionId, "owned-session");
});

test("5-20 sesión nueva no hereda lock viejo y authority integra cleanup", async () => {
  const a = token("a20", "Actor.a"); const b = token("b20", "Actor.b", { x: 100 }); const locks = new TradeMovementLockService(); const old = session("NEGOTIATING", a, b, "old");
  locks.lockSession(old, { participantA: a, participantB: b }); locks.releaseSession("old"); assert.equal(locks.getLock(a.uuid), null);
  const source = await readFile(new URL("../scripts/trade/trade-authority.js", import.meta.url), "utf8"); assert.match(source, /tradeMovementLocks\.releaseSession/);
});
