import test from "node:test";
import assert from "node:assert/strict";

globalThis.foundry = {
  utils: {
    duplicate: value => structuredClone(value),
    deepClone: value => structuredClone(value)
  }
};

const {
  buildPublicTradeItemSnapshot,
  PUBLIC_TRADE_ITEM_FIELDS
} = await import("../scripts/trade/trade-item-presentation.js");

const {
  buildGMTradeView,
  buildParticipantTradeView,
  buildPrivateInventoryView,
  buildPublicOfferView,
  buildPublicTradeSessionView,
  buildTradeItemInspectorView
} = await import("../scripts/trade/trade-view-model.js");

const userA = { id: "player-a", isGM: false };
const userB = { id: "player-b", isGM: false };
const intruder = { id: "intruder", isGM: false };

function createActor(id, owner, itemSpecs) {
  const items = [];
  items.get = itemId => items.find(item => item.id === itemId) ?? null;
  const actor = {
    id,
    uuid: `Actor.${id}`,
    type: "personaje",
    system: {
      atributos: { fuerza: { value: 5 } },
      equipamiento: {}
    },
    items,
    testUserPermission(user, permission) {
      return permission === "OWNER" && user?.id === owner.id;
    }
  };

  for (const spec of itemSpecs) {
    const system = {
      tipoObjeto: spec.tipoObjeto ?? "general",
      cantidad: spec.quantity,
      peso: spec.weight ?? 1,
      descripcion: spec.description ?? "",
      equipado: spec.equipped ?? false,
      slot: spec.slot ?? "",
      danio: spec.damage ?? "",
      defensa: spec.defense ?? 0,
      defensaBase: spec.baseDefense ?? 0,
      material: spec.material ?? "",
      valor: spec.value ?? 0
    };
    items.push({
      id: spec.id,
      uuid: `${actor.uuid}.Item.${spec.id}`,
      name: spec.name,
      img: spec.img ?? `icons/${spec.id}.webp`,
      type: "objeto",
      parent: actor,
      system,
      _source: { system: structuredClone(system) }
    });
  }
  return actor;
}

const actorA = createActor("actor-a", userA, [
  { id: "potion", name: "Poción", quantity: 10, description: "Cura heridas." },
  { id: "coin", name: "Moneda solar", quantity: 50, tipoObjeto: "moneda", value: 1 },
  { id: "sword", name: "Espada privada", quantity: 1, tipoObjeto: "arma", damage: "1d8" }
]);
const actorB = createActor("actor-b", userB, [
  { id: "elixir", name: "Elixir", quantity: 5, description: "Restaura energía." },
  { id: "secret", name: "Objeto secreto", quantity: 3 }
]);

function publicEntry(item, quantity) {
  return buildPublicTradeItemSnapshot(item, quantity);
}

function makeSession() {
  return {
    id: "trade-phase3",
    state: "NEGOTIATING",
    participants: {
      participantA: { key: "participantA", userId: userA.id, actorUuid: actorA.uuid },
      participantB: { key: "participantB", userId: userB.id, actorUuid: actorB.uuid }
    },
    revision: 3,
    publicOffers: {
      participantA: [publicEntry(actorA.items.get("potion"), 4)],
      participantB: [publicEntry(actorB.items.get("elixir"), 2)]
    },
    confirmations: {
      participantA: { confirmed: true, revision: 3, confirmedAt: 10 },
      participantB: { confirmed: false, revision: null, confirmedAt: null }
    },
    createdAt: 1,
    updatedAt: 2,
    cancelledAt: null,
    invalidatedAt: null,
    invalidReason: null,
    authority: { gmUserId: "gm", epoch: "private" },
    offers: { participantA: [{ itemId: "private-canonical" }], participantB: [] },
    reservations: [{ actorUuid: actorA.uuid }],
    appliedOperations: ["private-operation"]
  };
}

test("01 participante A obtiene su inventario local", () => {
  const view = buildPrivateInventoryView({ session: makeSession(), actor: actorA, user: userA });
  assert.deepEqual(view.items.map(item => item.itemId), ["sword", "coin", "potion"]);
});

test("02 participante B obtiene su inventario local", () => {
  const view = buildPrivateInventoryView({ session: makeSession(), actor: actorB, user: userB });
  assert.deepEqual(view.items.map(item => item.itemId), ["elixir", "secret"]);
});

test("03 A no puede solicitar el inventario de B", () => {
  assert.throws(() => buildPrivateInventoryView({ session: makeSession(), actor: actorB, user: userA }), /no corresponde/);
});

test("04 B no puede solicitar el inventario de A", () => {
  assert.throws(() => buildPrivateInventoryView({ session: makeSession(), actor: actorA, user: userB }), /no corresponde/);
});

test("05 payload público no contiene actor.items", () => {
  assert.equal(JSON.stringify(buildPublicTradeSessionView(makeSession())).includes("actor.items"), false);
});

test("06 payload público no contiene documentos Actor", () => {
  const payload = buildPublicTradeSessionView(makeSession());
  assert.equal(Object.hasOwn(payload.participants.participantA, "actor"), false);
  assert.equal(JSON.stringify(payload).includes("testUserPermission"), false);
});

test("07 payload público no contiene documentos Item completos", () => {
  const entry = buildPublicOfferView(makeSession(), "participantB")[0];
  assert.equal(Object.hasOwn(entry, "parent"), false);
  assert.equal(Object.hasOwn(entry, "system"), false);
  assert.deepEqual(Object.keys(entry), PUBLIC_TRADE_ITEM_FIELDS);
});

test("08 la vista pública contiene solamente Items ofrecidos", () => {
  assert.deepEqual(buildPublicOfferView(makeSession(), "participantB").map(item => item.itemId), ["elixir"]);
});

test("09 un Item rival no ofertado nunca aparece", () => {
  assert.equal(JSON.stringify(buildParticipantTradeView({ session: makeSession(), actor: actorA, user: userA })).includes("Objeto secreto"), false);
});

test("10 el nombre ofertado es visible", () => {
  assert.equal(buildPublicOfferView(makeSession(), "participantB")[0].name, "Elixir");
});

test("11 la imagen ofertada es visible", () => {
  assert.equal(buildPublicOfferView(makeSession(), "participantB")[0].img, "icons/elixir.webp");
});

test("12 la cantidad ofertada es visible sin revelar la cantidad real", () => {
  const entry = buildPublicOfferView(makeSession(), "participantB")[0];
  assert.equal(entry.quantity, 2);
  assert.equal(Object.hasOwn(entry, "realQuantity"), false);
});

test("13 la descripción pública puede inspeccionarse", () => {
  assert.equal(buildTradeItemInspectorView(buildPublicOfferView(makeSession(), "participantB")[0]).description, "Restaura energía.");
});

test("14 el inspector es estrictamente read-only", () => {
  const inspector = buildTradeItemInspectorView(buildPublicOfferView(makeSession(), "participantB")[0]);
  assert.equal(inspector.readOnly, true);
  assert.equal(inspector.editable, false);
  assert.equal(Object.hasOwn(inspector, "item"), false);
});

test("15 un Item equipado aparece deshabilitado y no comerciable", () => {
  const equippedActor = createActor("equipped-a", userA, [
    { id: "blade", name: "Hoja equipada", quantity: 1, tipoObjeto: "arma", equipped: true, slot: "manoDer" }
  ]);
  equippedActor.system.equipamiento.manoDer = "blade";
  const session = makeSession();
  session.participants.participantA.actorUuid = equippedActor.uuid;
  const view = buildPrivateInventoryView({ session, actor: equippedActor, user: userA });
  assert.equal(view.items.length, 1);
  assert.equal(view.items[0].equipped, true);
  assert.equal(view.items[0].tradeable, false);
  assert.equal(view.items[0].availableIncludingSession, 0);
});

test("31 un usuario ajeno no obtiene una vista privada", () => {
  assert.throws(() => buildPrivateInventoryView({ session: makeSession(), actor: actorA, user: intruder }), /no participa/);
});

test("32 el GM observa ambas ofertas públicas", () => {
  const view = buildGMTradeView(makeSession());
  assert.equal(view.publicOffers.participantA.length, 1);
  assert.equal(view.publicOffers.participantB.length, 1);
});

test("33 la vista GM no contiene inventarios completos", () => {
  const view = buildGMTradeView(makeSession());
  assert.equal(Object.hasOwn(view, "inventories"), false);
  assert.equal(JSON.stringify(view).includes("Objeto secreto"), false);
});

test("34 la allowlist no filtra campos privados", () => {
  const serialized = JSON.stringify(buildPublicTradeSessionView(makeSession()));
  for (const privateField of ["authority", "appliedOperations", "reservations", "ownership", "flags", "system", "equipado", "slot"]) {
    assert.equal(serialized.includes(`\"${privateField}\"`), false, privateField);
  }
});

test("35 UUID público corresponde al Actor participante", () => {
  const session = makeSession();
  for (const key of ["participantA", "participantB"]) {
    for (const entry of buildPublicOfferView(session, key)) {
      assert.equal(entry.itemUuid.startsWith(`${session.participants[key].actorUuid}.Item.`), true);
    }
  }
});
