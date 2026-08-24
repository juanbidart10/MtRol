import test from "node:test";
import assert from "node:assert/strict";

const warnings = [];

globalThis.game = {
  user: { id: "gm", isGM: true }
};

globalThis.ui = {
  notifications: {
    warn(message) { warnings.push(message); },
    error() {}
  }
};

const {
  canUserManageEquipment,
  desequiparObjeto,
  equiparObjeto
} = await import("../scripts/items/equipment-engine.js");

const {
  buildInventoryViewModel
} = await import("../scripts/items/inventory-view-model.js");

const {
  calcularCargaActor
} = await import("../scripts/core/mtrol-carry-weight.js");

const {
  mtrolPrepararRollData
} = await import("../scripts/rolls/formula-parser.js");

const USERS = Object.freeze({
  gm: Object.freeze({ id: "gm", isGM: true }),
  owner: Object.freeze({ id: "owner", isGM: false }),
  observer: Object.freeze({ id: "observer", isGM: false })
});

const SLOT_IDS = [
  "cabeza",
  "cuello",
  "hombros",
  "brazos",
  "pecho",
  "piernas",
  "pies",
  "manoIzq",
  "manoDer",
  "extra"
];

function createCollection(items) {
  const collection = [...items];
  collection.get = id => collection.find(item => item.id === id) ?? null;
  return collection;
}

function createItem(id, {
  name = id,
  tipoObjeto = "general",
  slot = "cabeza",
  equipable = true,
  equipado = false,
  danio = 0,
  peso = 1,
  cantidad = 1
} = {}) {
  return {
    id,
    uuid: `Actor.permissions.Item.${id}`,
    name,
    type: "objeto",
    system: {
      tipoObjeto,
      slot,
      equipable,
      equipado,
      danio,
      peso,
      cantidad
    }
  };
}

function createActor(items = [], equipamiento = {}, ownerIds = ["owner"]) {
  const collection = createCollection(items);

  return {
    id: "permissions",
    uuid: "Actor.permissions",
    name: "Permissions",
    type: "personaje",
    ownerIds: new Set(ownerIds),
    system: {
      atributos: { fuerza: 3 },
      equipamiento: Object.fromEntries(
        SLOT_IDS.map(slot => [slot, equipamiento[slot] ?? ""])
      )
    },
    items: collection,
    actorUpdates: [],
    embeddedUpdates: [],
    testUserPermission(user, permission) {
      return permission === "OWNER" && this.ownerIds.has(user?.id);
    },
    async update(changes) {
      this.actorUpdates.push(structuredClone(changes));
      for (const [path, value] of Object.entries(changes)) {
        if (!path.startsWith("system.equipamiento.")) continue;
        this.system.equipamiento[path.replace("system.equipamiento.", "")] = value;
      }
    },
    async updateEmbeddedDocuments(_type, updates) {
      this.embeddedUpdates.push(structuredClone(updates));
      for (const update of updates) {
        const item = collection.get(update._id);
        if (item && Object.hasOwn(update, "system.equipado")) {
          item.system.equipado = update["system.equipado"];
        }
      }
    }
  };
}

function setUser(user) {
  game.user = { ...user };
  warnings.length = 0;
}

function snapshot(actor) {
  return {
    equipment: structuredClone(actor.system.equipamiento),
    flags: actor.items.map(item => [item.id, item.system.equipado]),
    actorWrites: actor.actorUpdates.length,
    itemWrites: actor.embeddedUpdates.length
  };
}

test("la política reconoce GM y Owner, pero rechaza Observer", () => {
  const actor = createActor();

  assert.equal(canUserManageEquipment(actor, USERS.gm), true);
  assert.equal(canUserManageEquipment(actor, USERS.owner), true);
  assert.equal(canUserManageEquipment(actor, USERS.observer), false);
});

for (const [role, user] of [["GM", USERS.gm], ["Owner", USERS.owner]]) {
  test(`${role} puede equipar, reemplazar y desequipar`, async () => {
    setUser(user);
    const previous = createItem("previous", { equipado: true });
    const next = createItem("next");
    const actor = createActor([previous, next], { cabeza: previous.id });

    assert.equal(await equiparObjeto(actor, next), true);
    assert.equal(actor.system.equipamiento.cabeza, next.id);
    assert.equal(previous.system.equipado, false);
    assert.equal(next.system.equipado, true);

    assert.equal(await desequiparObjeto(actor, next), true);
    assert.equal(actor.system.equipamiento.cabeza, "");
    assert.equal(next.system.equipado, false);
  });
}

test("Observer no puede equipar, reemplazar ni desequipar y deja cero estado parcial", async () => {
  setUser(USERS.observer);
  const previous = createItem("previous", { equipado: true });
  const next = createItem("next");
  const actor = createActor([previous, next], { cabeza: previous.id });
  const before = snapshot(actor);

  assert.equal(await equiparObjeto(actor, next), false);
  assert.deepEqual(snapshot(actor), before);
  assert.equal(actor.system.equipamiento.cabeza, previous.id);
  assert.equal(previous.system.equipado, true);
  assert.equal(next.system.equipado, false);

  assert.equal(await desequiparObjeto(actor, previous), false);
  assert.deepEqual(snapshot(actor), before);
  assert.equal(warnings.length, 2);
});

test("ownership no permite equipar un Item perteneciente a otro Actor", async () => {
  setUser(USERS.owner);
  const local = createItem("local");
  const foreign = createItem("foreign");
  const actor = createActor([local]);
  const before = snapshot(actor);

  assert.equal(await equiparObjeto(actor, foreign), false);
  assert.deepEqual(snapshot(actor), before);
});

test("Owner conserva las invariantes de mover y normalizar referencias múltiples", async () => {
  setUser(USERS.owner);
  const weapon = createItem("weapon", {
    tipoObjeto: "arma",
    slot: "manoIzq",
    equipado: false,
    danio: 4
  });
  const actor = createActor([weapon], {
    manoDer: weapon.id,
    extra: weapon.id
  });

  assert.equal(await equiparObjeto(actor, weapon), true);
  assert.equal(actor.system.equipamiento.manoDer, "");
  assert.equal(actor.system.equipamiento.extra, "");
  assert.equal(actor.system.equipamiento.manoIzq, weapon.id);
  assert.equal(weapon.system.equipado, true);
});

test("los cambios de Owner alimentan @mano y no alteran el peso", async () => {
  setUser(USERS.owner);
  const right = createItem("right", {
    tipoObjeto: "arma",
    slot: "manoDer",
    danio: 3,
    peso: 2
  });
  const left = createItem("left", {
    tipoObjeto: "arma",
    slot: "manoIzq",
    danio: 4,
    peso: 3
  });
  const actor = createActor([right, left]);
  const weightBefore = calcularCargaActor(actor);

  assert.equal(await equiparObjeto(actor, right), true);
  assert.equal(await equiparObjeto(actor, left), true);
  assert.deepEqual(calcularCargaActor(actor), weightBefore);

  const rollData = mtrolPrepararRollData(actor).data;
  assert.equal(rollData.manoDer, 3);
  assert.equal(rollData.manoIzq, 4);
  assert.equal(rollData.mano, 7);

  assert.equal(await desequiparObjeto(actor, left), true);
  assert.deepEqual(calcularCargaActor(actor), weightBefore);
});

test("ViewModel entrega los mismos datos a GM, Owner y Observer", () => {
  const weapon = createItem("weapon", {
    name: "Espada",
    tipoObjeto: "arma",
    slot: "manoDer",
    equipado: true,
    peso: 2
  });
  const material = createItem("material", {
    name: "Hierro",
    tipoObjeto: "material",
    peso: 3
  });
  const actor = createActor([weapon, material], { manoDer: weapon.id });
  const projections = [];

  for (const user of [USERS.gm, USERS.owner, USERS.observer]) {
    setUser(user);
    const viewModel = buildInventoryViewModel(actor);
    projections.push({
      equipped: viewModel.equipment.manoDer?.id ?? null,
      weapons: viewModel.categories.armas.map(item => item.id),
      materials: viewModel.categories.materiales.map(item => item.id),
      weight: viewModel.weight
    });
  }

  assert.deepEqual(projections[1], projections[0]);
  assert.deepEqual(projections[2], projections[0]);
  assert.equal(projections[0].equipped, weapon.id);
  assert.deepEqual(projections[0].materials, [material.id]);
});
