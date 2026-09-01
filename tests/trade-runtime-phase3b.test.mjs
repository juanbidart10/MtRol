import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class FakeApplicationV2 {
  constructor(options = {}) { this.options = options; this.renderCount = 0; }
  render() { this.renderCount += 1; return this; }
  bringToTop() {}
  async close() { return true; }
  async _prepareContext() { return {}; }
  _onRender() {}
}

globalThis.foundry = {
  applications: {
    api: {
      ApplicationV2: FakeApplicationV2,
      HandlebarsApplicationMixin: Base => class extends Base {}
    }
  },
  utils: {
    duplicate: value => structuredClone(value),
    deepClone: value => structuredClone(value),
    mergeObject: (left, right) => ({ ...left, ...right }),
    randomID: () => "phase3b-operation"
  }
};

const notifications = { info() {}, warn() {}, error() {} };
globalThis.ui = { notifications };
globalThis.Hooks = { on() {}, callAll() {} };

const userA = { id: "player-a", name: "Jugador A", isGM: false, active: true };
const userB = { id: "player-b", name: "Jugador B", isGM: false, active: true };
const users = [userA, userB];
users.get = id => users.find(user => user.id === id) ?? null;
globalThis.game = { user: userA, users, mtrol: { trade: {} } };

const { TradeSessionStore } = await import("../scripts/trade/trade-session-service.js");
const { buildPublicTradeItemSnapshot } = await import("../scripts/trade/trade-item-presentation.js");
const {
  buildParticipantTradeView,
  buildPublicTradeSessionView,
  buildTradeItemInspectorView
} = await import("../scripts/trade/trade-view-model.js");
const {
  buildOwnOfferEntries,
  buildTradeAppRenderContext,
  removeOwnOfferEntry,
  upsertOwnOfferEntry
} = await import("../scripts/trade/trade-app-view-model.js");
const {
  closeAllTradeApps,
  configureTradeRuntimeApi,
  countOpenTradeApps,
  handleTradeSessionRuntimeUpdate,
  openTradeApp,
  requestTradeFromTarget
} = await import("../scripts/trade/trade-runtime.js");

function setTradeApi(api) {
  game.mtrol.trade = api;
  configureTradeRuntimeApi(api);
}

function actor(id, owner, specs) {
  const items = [];
  items.get = itemId => items.find(item => item.id === itemId) ?? null;
  const document = {
    id,
    uuid: `Actor.${id}`,
    name: `Personaje ${id.toUpperCase()}`,
    type: "personaje",
    system: { atributos: { fuerza: { value: 5 } }, equipamiento: {} },
    items,
    testUserPermission(user, permission) {
      return permission === "OWNER" && user?.id === owner.id;
    }
  };
  for (const spec of specs) {
    const system = {
      tipoObjeto: spec.type ?? "general",
      cantidad: spec.quantity,
      peso: 1,
      descripcion: spec.description ?? "",
      equipado: spec.equipped ?? false,
      slot: spec.slot ?? "",
      valor: spec.value ?? 0
    };
    const item = {
      id: spec.id,
      uuid: `${document.uuid}.Item.${spec.id}`,
      name: spec.name,
      img: `icons/${spec.id}.webp`,
      type: "objeto",
      parent: document,
      system,
      _source: { system: structuredClone(system) }
    };
    items.push(item);
    if (spec.equipped && spec.slot) document.system.equipamiento[spec.slot] = item.id;
  }
  return document;
}

const actorA = actor("a", userA, [
  { id: "potion-a", name: "Poción A", quantity: 10, type: "consumible" },
  { id: "secret-a", name: "Secreto A", quantity: 2 },
  { id: "sword-a", name: "Espada A", quantity: 1, type: "arma", equipped: true, slot: "manoDer" }
]);
const actorB = actor("b", userB, [
  { id: "potion-b", name: "Poción B", quantity: 10, type: "consumible", description: "Descripción B" },
  { id: "coin-b", name: "Moneda B", quantity: 100, type: "moneda", value: 1 },
  { id: "secret-b", name: "Secreto B", quantity: 3 }
]);
globalThis.canvas = {
  tokens: {
    controlled: [{ actor: actorA, document: { uuid: "Scene.trade.Token.a" } }],
    placeables: []
  }
};

let operation = 0;
function fixture() {
  const itemByUuid = new Map([...actorA.items, ...actorB.items].map(item => [item.uuid, item]));
  const store = new TradeSessionStore({
    idFactory: () => `trade-3b-${++operation}`,
    now: () => ++operation,
    resolveRealQuantity: reference => itemByUuid.get(reference.itemUuid)?.system?.cantidad ?? 0,
    resolveOfferItem: reference => ({
      publicSnapshot: buildPublicTradeItemSnapshot(itemByUuid.get(reference.itemUuid), reference.quantity)
    })
  });
  store.reconcileAuthority({ gmUserId: "gm", epoch: "3b" });
  return store;
}

async function requested(store) {
  return store.createSession({
    participantA: { userId: userA.id, actorUuid: actorA.uuid, actorName: actorA.name },
    participantB: { userId: userB.id, actorUuid: actorB.uuid, actorName: actorB.name },
    authority: { gmUserId: "gm", epoch: "3b" },
    operationId: `create-${++operation}`
  });
}

async function negotiating(store) {
  const session = await requested(store);
  return store.acceptSession({
    sessionId: session.id,
    participantKey: "participantB",
    requestingUserId: userB.id,
    operationId: `accept-${++operation}`
  });
}

function participantView(session, which) {
  const isA = which === "A";
  return buildParticipantTradeView({
    session: buildPublicTradeSessionView(session),
    actor: isA ? actorA : actorB,
    user: isA ? userA : userB
  });
}

function context(session, which) {
  const publicSession = buildPublicTradeSessionView(session);
  return buildTradeAppRenderContext({
    session: publicSession,
    view: participantView(session, which)
  });
}

async function setOffer(store, session, key, user, entries) {
  return store.setOffer({
    sessionId: session.id,
    participantKey: key,
    requestingUserId: user.id,
    entries,
    operationId: `offer-${++operation}`
  });
}

test("3B-01 iniciar solicitud usa el nuevo API createSession", async () => {
  let payload = null;
  game.user = userA;
  setTradeApi({
    createSession: async value => { payload = value; return { id: "request-runtime" }; },
    getSession: () => null
  });
  await requestTradeFromTarget({ sourceActor: actorA, targetToken: { actor: actorB, uuid: "Token.b" } });
  assert.equal(payload.participantAActorUuid, actorA.uuid);
  assert.equal(payload.participantBActorUuid, actorB.uuid);
  assert.equal(payload.participantBUserId, userB.id);
});

test("3B-02 una solicitud crea estado REQUESTED", async () => {
  const store = fixture();
  assert.equal((await requested(store)).state, "REQUESTED");
});

test("3B-03 B debe aceptar explícitamente", async () => {
  const store = fixture();
  const session = await requested(store);
  assert.equal(context(session, "B").uiState.canAccept, true);
  assert.equal(session.state, "REQUESTED");
});

test("3B-04 aceptar activa NEGOTIATING", async () => {
  const store = fixture();
  const session = await negotiating(store);
  assert.equal(session.state, "NEGOTIATING");
  assert.equal(context(session, "B").uiState.canEdit, true);
});

test("3B-05 A obtiene solamente su inventario local", async () => {
  const session = await negotiating(fixture());
  assert.deepEqual(context(session, "A").myInventory.items.map(item => item.itemId), ["potion-a", "secret-a", "sword-a"]);
});

test("3B-06 B obtiene solamente su inventario local", async () => {
  const session = await negotiating(fixture());
  assert.deepEqual(context(session, "B").myInventory.items.map(item => item.itemId), ["coin-b", "potion-b", "secret-b"]);
});

test("3B-07 render context de A no contiene inventario B", async () => {
  assert.equal(JSON.stringify(context(await negotiating(fixture()), "A")).includes("Secreto B"), false);
});

test("3B-08 render context de B no contiene inventario A", async () => {
  assert.equal(JSON.stringify(context(await negotiating(fixture()), "B")).includes("Secreto A"), false);
});

test("3B-09 contexto no contiene otherActor ni targetInventory", async () => {
  const keys = Object.keys(context(await negotiating(fixture()), "A"));
  assert.equal(keys.includes("otherActor"), false);
  assert.equal(keys.includes("otherInventory"), false);
  assert.equal(keys.includes("targetInventory"), false);
});

test("3B-10 A ve la oferta pública de B", async () => {
  const store = fixture(); let session = await negotiating(store);
  session = await setOffer(store, session, "participantB", userB, [{ itemUuid: actorB.items.get("potion-b").uuid, itemId: "potion-b", quantity: 3 }]);
  assert.equal(context(session, "A").otherOffer[0].name, "Poción B");
});

test("3B-11 B ve la oferta pública de A", async () => {
  const store = fixture(); let session = await negotiating(store);
  session = await setOffer(store, session, "participantA", userA, [{ itemUuid: actorA.items.get("potion-a").uuid, itemId: "potion-a", quantity: 2 }]);
  assert.equal(context(session, "B").otherOffer[0].name, "Poción A");
});

test("3B-12 Item no ofertado de B no aparece para A", async () => {
  const store = fixture(); let session = await negotiating(store);
  session = await setOffer(store, session, "participantB", userB, [{ itemUuid: actorB.items.get("potion-b").uuid, itemId: "potion-b", quantity: 1 }]);
  assert.equal(JSON.stringify(context(session, "A").otherOffer).includes("Secreto B"), false);
});

test("3B-13 Item no ofertado de A no aparece para B", async () => {
  const store = fixture(); let session = await negotiating(store);
  session = await setOffer(store, session, "participantA", userA, [{ itemUuid: actorA.items.get("potion-a").uuid, itemId: "potion-a", quantity: 1 }]);
  assert.equal(JSON.stringify(context(session, "B").otherOffer).includes("Secreto A"), false);
});

test("3B-14 añadir Item actualiza la oferta rival", async () => {
  const store = fixture(); let session = await negotiating(store);
  assert.equal(context(session, "B").otherOffer.length, 0);
  session = await setOffer(store, session, "participantA", userA, [{ itemUuid: actorA.items.get("potion-a").uuid, itemId: "potion-a", quantity: 1 }]);
  assert.equal(context(session, "B").otherOffer.length, 1);
});

test("3B-15 retirar Item desaparece para el rival", async () => {
  const store = fixture(); let session = await negotiating(store);
  session = await setOffer(store, session, "participantA", userA, [{ itemUuid: actorA.items.get("potion-a").uuid, itemId: "potion-a", quantity: 1 }]);
  session = await setOffer(store, session, "participantA", userA, []);
  assert.equal(context(session, "B").otherOffer.length, 0);
});

test("3B-16 cambiar cantidad actualiza al rival", async () => {
  const store = fixture(); let session = await negotiating(store);
  session = await setOffer(store, session, "participantA", userA, [{ itemUuid: actorA.items.get("potion-a").uuid, itemId: "potion-a", quantity: 2 }]);
  session = await setOffer(store, session, "participantA", userA, [{ itemUuid: actorA.items.get("potion-a").uuid, itemId: "potion-a", quantity: 4 }]);
  assert.equal(context(session, "B").otherOffer[0].quantity, 4);
});

test("3B-17 Item equipado aparece no comerciable", async () => {
  const session = await negotiating(fixture());
  const sword = context(session, "A").myInventory.items.find(item => item.itemId === "sword-a");
  assert.equal(sword.equipped, true); assert.equal(sword.tradeable, false);
});

test("3B-18 la UI no ofrece añadir un Item equipado", async () => {
  const template = await readFile(new URL("../templates/apps/trade-app.html", import.meta.url), "utf8");
  assert.match(template, /data-action="add"[^>]*\{\{#unless tradeable\}\}disabled/);
});

test("3B-19 cantidad parcial funciona", async () => {
  const store = fixture(); let session = await negotiating(store);
  session = await setOffer(store, session, "participantB", userB, [{ itemUuid: actorB.items.get("potion-b").uuid, itemId: "potion-b", quantity: 4 }]);
  assert.equal(context(session, "A").otherOffer[0].quantity, 4);
});

test("3B-20 moneda parcial funciona", async () => {
  const store = fixture(); let session = await negotiating(store);
  session = await setOffer(store, session, "participantB", userB, [{ itemUuid: actorB.items.get("coin-b").uuid, itemId: "coin-b", quantity: 17 }]);
  assert.equal(context(session, "A").otherOffer[0].tipoObjeto, "moneda");
  assert.equal(context(session, "A").otherOffer[0].quantity, 17);
});

test("3B-21 inspección rival usa el snapshot público", async () => {
  const store = fixture(); let session = await negotiating(store);
  session = await setOffer(store, session, "participantB", userB, [{ itemUuid: actorB.items.get("potion-b").uuid, itemId: "potion-b", quantity: 1 }]);
  const inspector = buildTradeItemInspectorView(context(session, "A").otherOffer[0]);
  assert.equal(inspector.description, "Descripción B"); assert.equal(Object.hasOwn(inspector, "item"), false);
});

test("3B-22 inspección rival es read-only", () => {
  const inspector = buildTradeItemInspectorView({ itemUuid: "Actor.b.Item.x", itemId: "x", quantity: 1, publicData: {} });
  assert.equal(inspector.readOnly, true); assert.equal(inspector.editable, false);
});

test("3B-23 A sólo puede construir mutaciones sobre su oferta", async () => {
  const store = fixture(); const session = await negotiating(store);
  const own = upsertOwnOfferEntry(buildOwnOfferEntries(session, "participantA"), { itemUuid: "Actor.a.Item.potion-a", itemId: "potion-a", quantity: 1 });
  assert.equal(own[0].itemUuid.startsWith("Actor.a."), true); assert.deepEqual(session.offers.participantB, []);
});

test("3B-24 B sólo puede retirar de su oferta", () => {
  const entries = [{ itemUuid: "Actor.b.Item.coin-b", itemId: "coin-b", quantity: 2 }];
  assert.deepEqual(removeOwnOfferEntry(entries, "Actor.b.Item.coin-b"), []);
});

test("3B-25 confirmación A se refleja en B", async () => {
  const store = fixture(); let session = await negotiating(store);
  session = await store.confirmSession({ sessionId: session.id, participantKey: "participantA", requestingUserId: userA.id, revision: session.revision, operationId: `confirm-${++operation}` });
  assert.equal(context(session, "B").confirmations.rival, true);
});

test("3B-26 confirmación B se refleja en A", async () => {
  const store = fixture(); let session = await negotiating(store);
  session = await store.confirmSession({ sessionId: session.id, participantKey: "participantB", requestingUserId: userB.id, revision: session.revision, operationId: `confirm-${++operation}` });
  assert.equal(context(session, "A").confirmations.rival, true);
});

test("3B-27 cambiar oferta invalida ambas confirmaciones", async () => {
  const store = fixture(); let session = await negotiating(store);
  session = await store.confirmSession({ sessionId: session.id, participantKey: "participantA", requestingUserId: userA.id, revision: 0, operationId: `confirm-${++operation}` });
  session = await store.confirmSession({ sessionId: session.id, participantKey: "participantB", requestingUserId: userB.id, revision: 0, operationId: `confirm-${++operation}` });
  session = await setOffer(store, session, "participantA", userA, [{ itemUuid: actorA.items.get("potion-a").uuid, itemId: "potion-a", quantity: 1 }]);
  assert.equal(session.confirmations.participantA.confirmed, false); assert.equal(session.confirmations.participantB.confirmed, false);
});

test("3B-28 cancelación A termina la sesión para ambos", async () => {
  await closeAllTradeApps();
  const store = fixture(); let session = await negotiating(store);
  const active = buildPublicTradeSessionView(session);
  game.user = userA;
  setTradeApi({ getSession: () => active, getMyTradeView: async () => participantView(active, "A") });
  await openTradeApp(active.id);
  session = await store.cancelSession({ sessionId: session.id, participantKey: "participantA", requestingUserId: userA.id, operationId: `cancel-${++operation}` });
  assert.equal(buildPublicTradeSessionView(session).state, "CANCELLED");
  await handleTradeSessionRuntimeUpdate(buildPublicTradeSessionView(session));
  assert.equal(countOpenTradeApps(), 0);
});

test("3B-29 cancelación B termina la sesión para ambos", async () => {
  await closeAllTradeApps();
  const store = fixture(); let session = await negotiating(store);
  const active = buildPublicTradeSessionView(session);
  game.user = userB;
  setTradeApi({ getSession: () => active, getMyTradeView: async () => participantView(active, "B") });
  await openTradeApp(active.id);
  session = await store.cancelSession({ sessionId: session.id, participantKey: "participantB", requestingUserId: userB.id, operationId: `cancel-${++operation}` });
  assert.equal(buildPublicTradeSessionView(session).state, "CANCELLED");
  await handleTradeSessionRuntimeUpdate(buildPublicTradeSessionView(session));
  assert.equal(countOpenTradeApps(), 0);
});

test("3B-30 el runtime nuevo no ejecuta transferencia real", async () => {
  const source = await readFile(new URL("../scripts/trade/trade-runtime.js", import.meta.url), "utf8");
  const sockets = await readFile(new URL("../scripts/core/sockets.js", import.meta.url), "utf8");
  const init = await readFile(new URL("../scripts/core/init.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /trade-engine|ejecutarComercio|createEmbeddedDocuments|updateEmbeddedDocuments/);
  assert.doesNotMatch(sockets, /mtrolEjecutarComercio|ejecutarComercioMtrolDesdeSocket/);
  assert.doesNotMatch(init, /ejecutarComercioMtrolDesdeSocket/);
});

test("3B-31 el flujo normal de hoja no invoca trade-engine legacy", async () => {
  const source = await readFile(new URL("../scripts/sheets/actors/personaje-sheet.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /trade-engine|ejecutarComercioMtrol/);
  assert.match(source, /requestTradeFromTarget/);
});

test("3B-32 el flujo normal no abre trade-dialog legacy", async () => {
  const source = await readFile(new URL("../scripts/sheets/actors/personaje-sheet.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /trade-dialog|abrirDialogoComercioMtrol/);
});

test("3B-33 socket público no serializa inventario rival", async () => {
  const payload = buildPublicTradeSessionView(await negotiating(fixture()));
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes("Secreto B"), false); assert.equal(serialized.includes("system"), false);
});

test("3B-34 caché sólo recibe sesión sanitizada", async () => {
  const api = await readFile(new URL("../scripts/trade/trade-api.js", import.meta.url), "utf8");
  assert.match(api, /buildPublicTradeSessionView\(rawSession\)/);
  assert.doesNotMatch(api, /clientSessions\.set\([^\n]*Inventory/);
});

test("3B-35 una sesión no abre ventanas duplicadas", async () => {
  await closeAllTradeApps();
  game.user = userA;
  const session = buildPublicTradeSessionView(await negotiating(fixture()));
  setTradeApi({
    getSession: () => session,
    getMyTradeView: async () => participantView(session, "A")
  });
  const first = await openTradeApp(session.id);
  const second = await openTradeApp(session.id);
  assert.equal(first, second); assert.equal(countOpenTradeApps(), 1);
  await closeAllTradeApps();
});
