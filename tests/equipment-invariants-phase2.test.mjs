import test from "node:test";
import assert from "node:assert/strict";

globalThis.ui = {
  notifications: {
    warn() {},
    error() {}
  }
};

globalThis.game = {
  user: { id: "gm", isGM: true }
};

const {
  desequiparObjeto,
  equiparObjeto,
  getEquippedShields
} = await import("../scripts/items/equipment-engine.js");

const {
  buildInventoryViewModel
} = await import("../scripts/items/inventory-view-model.js");

const {
  mtrolObtenerDanioManos
} = await import("../scripts/rolls/roll-helpers.js");

const {
  mtrolPrepararRollData
} = await import("../scripts/rolls/formula-parser.js");

const {
  destroyEquippedItem
} = await import("../scripts/items/item-destruction-engine.js");

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
  equipable = true,
  equipado = false,
  slot = "cabeza",
  danio = 0,
  peso = 1,
  cantidad = 1
} = {}) {
  return {
    id,
    uuid: `Actor.phase2.Item.${id}`,
    name,
    type: "objeto",
    system: {
      tipoObjeto,
      equipable,
      equipado,
      slot,
      danio,
      peso,
      cantidad
    },
    updateCalls: [],
    async update(changes) {
      this.updateCalls.push({ ...changes });
      if (Object.hasOwn(changes, "system.equipado")) {
        this.system.equipado = changes["system.equipado"];
      }
      return this;
    }
  };
}

function createActor(items = [], equipamiento = {}) {
  const collection = createCollection(items);
  const actor = {
    id: "phase2",
    uuid: "Actor.phase2",
    name: "Phase 2",
    type: "personaje",
    system: {
      atributos: { fuerza: 5 },
      equipamiento: Object.fromEntries(
        SLOT_IDS.map(slot => [slot, equipamiento[slot] ?? ""])
      )
    },
    items: collection,
    actorUpdateCalls: [],
    embeddedUpdateCalls: [],
    createCalls: 0,
    deleteCalls: 0,
    async update(changes) {
      this.actorUpdateCalls.push({ ...changes });
      for (const [path, value] of Object.entries(changes)) {
        if (!path.startsWith("system.equipamiento.")) continue;
        this.system.equipamiento[path.replace("system.equipamiento.", "")] = value;
      }
      return this;
    },
    async updateEmbeddedDocuments(_type, updates) {
      this.embeddedUpdateCalls.push(updates.map(update => ({ ...update })));
      for (const update of updates) {
        const item = collection.get(update._id);
        if (item && Object.hasOwn(update, "system.equipado")) {
          item.system.equipado = update["system.equipado"];
        }
      }
      return updates;
    },
    async createEmbeddedDocuments() {
      this.createCalls += 1;
      throw new Error("El motor de equipamiento no debe crear Items.");
    },
    async deleteEmbeddedDocuments(_type, ids) {
      this.deleteCalls += 1;
      for (const id of ids) {
        const index = collection.findIndex(item => item.id === id);
        if (index >= 0) collection.splice(index, 1);
      }
      return ids;
    }
  };

  return actor;
}

function equipmentSnapshot(actor) {
  return structuredClone(actor.system.equipamiento);
}

test("equipa en slot vacio sin crear ni eliminar documentos", async () => {
  const helmet = createItem("helmet", { slot: "cabeza" });
  const actor = createActor([helmet]);

  assert.equal(await equiparObjeto(actor, helmet), true);
  assert.equal(actor.system.equipamiento.cabeza, helmet.id);
  assert.equal(helmet.system.equipado, true);
  assert.equal(actor.createCalls, 0);
  assert.equal(actor.deleteCalls, 0);
  assert.equal(actor.items.get(helmet.id), helmet);
});

test("reemplaza el Item del slot y devuelve el desplazado al inventario", async () => {
  const previous = createItem("previous", { equipado: true });
  const next = createItem("next");
  const actor = createActor([previous, next], { cabeza: previous.id });

  assert.equal(await equiparObjeto(actor, next), true);
  assert.equal(actor.system.equipamiento.cabeza, next.id);
  assert.equal(previous.system.equipado, false);
  assert.equal(next.system.equipado, true);
  assert.equal(actor.items.get(previous.id), previous);
  assert.equal(actor.items.length, 2);
  assert.equal(actor.createCalls, 0);
  assert.equal(actor.deleteCalls, 0);
});

test("mueve un Item ya equipado y limpia su referencia anterior", async () => {
  const weapon = createItem("weapon", {
    tipoObjeto: "arma",
    slot: "manoDer",
    equipado: true
  });
  const actor = createActor([weapon], { manoDer: weapon.id });
  weapon.system.slot = "manoIzq";

  assert.equal(await equiparObjeto(actor, weapon), true);
  assert.equal(actor.system.equipamiento.manoDer, "");
  assert.equal(actor.system.equipamiento.manoIzq, weapon.id);
  assert.equal(weapon.system.equipado, true);
});

test("normaliza una referencia multiple preexistente al slot declarativo", async () => {
  const item = createItem("duplicated", {
    slot: "cabeza",
    equipado: false
  });
  const actor = createActor([item], {
    cabeza: item.id,
    cuello: item.id,
    extra: item.id
  });

  assert.equal(await equiparObjeto(actor, item), true);
  assert.equal(actor.system.equipamiento.cabeza, item.id);
  assert.equal(actor.system.equipamiento.cuello, "");
  assert.equal(actor.system.equipamiento.extra, "");
  assert.equal(item.system.equipado, true);
});

test("desequipa desde un slot y limpia tambien estados historicos multiples", async () => {
  const single = createItem("single", { equipado: true });
  const duplicated = createItem("duplicated", {
    equipado: true,
    slot: "manoDer"
  });
  const actor = createActor([single, duplicated], {
    cabeza: single.id,
    manoDer: duplicated.id,
    manoIzq: duplicated.id,
    extra: duplicated.id
  });

  assert.equal(await desequiparObjeto(actor, single), true);
  assert.equal(actor.system.equipamiento.cabeza, "");
  assert.equal(single.system.equipado, false);

  assert.equal(await desequiparObjeto(actor, duplicated), true);
  assert.equal(actor.system.equipamiento.manoDer, "");
  assert.equal(actor.system.equipamiento.manoIzq, "");
  assert.equal(actor.system.equipamiento.extra, "");
  assert.equal(duplicated.system.equipado, false);
});

test("rechaza Item no equipable, slots invalidos e Item ajeno sin mutaciones", async () => {
  const notEquipable = createItem("not-equipable", { equipable: false });
  const emptySlot = createItem("empty-slot", { slot: "" });
  const invalidSlot = createItem("invalid-slot", { slot: "arma1" });
  const local = createItem("local");
  const foreign = createItem("foreign");
  const actor = createActor([notEquipable, emptySlot, invalidSlot, local]);

  for (const item of [notEquipable, emptySlot, invalidSlot, foreign]) {
    const beforeEquipment = equipmentSnapshot(actor);
    const beforeFlags = actor.items.map(candidate => candidate.system.equipado);

    assert.equal(await equiparObjeto(actor, item), false);
    assert.deepEqual(actor.system.equipamiento, beforeEquipment);
    assert.deepEqual(
      actor.items.map(candidate => candidate.system.equipado),
      beforeFlags
    );
  }

  assert.equal(actor.actorUpdateCalls.length, 0);
  assert.equal(actor.embeddedUpdateCalls.length, 0);
});

test("sincroniza flags falsos referenciados y verdaderos huerfanos desde la autoridad", async () => {
  const referenced = createItem("referenced", {
    equipado: false,
    slot: "cabeza"
  });
  const orphan = createItem("orphan", {
    equipado: true,
    slot: "cuello"
  });
  const actor = createActor([referenced, orphan], { cabeza: referenced.id });

  assert.equal(await equiparObjeto(actor, referenced), true);
  assert.equal(referenced.system.equipado, true);
  assert.equal(orphan.system.equipado, false);

  assert.equal(await desequiparObjeto(actor, referenced), true);
  assert.equal(referenced.system.equipado, false);

  assert.equal(await equiparObjeto(actor, orphan), true);
  assert.equal(actor.system.equipamiento.cuello, orphan.id);
  assert.equal(orphan.system.equipado, true);

  assert.equal(await desequiparObjeto(actor, orphan), true);
  assert.equal(actor.system.equipamiento.cuello, "");
  assert.equal(orphan.system.equipado, false);
});

test("sobrescribe una referencia fantasma sin reconstruir documentos", async () => {
  const helmet = createItem("helmet");
  const actor = createActor([helmet], { cabeza: "missing-item" });

  assert.equal(await equiparObjeto(actor, helmet), true);
  assert.equal(actor.system.equipamiento.cabeza, helmet.id);
  assert.equal(actor.items.length, 1);
  assert.equal(actor.createCalls, 0);
  assert.equal(actor.deleteCalls, 0);
});

test("Inventory ViewModel refleja equipar y desequipar sin duplicar", async () => {
  const sword = createItem("sword", {
    name: "Espada",
    tipoObjeto: "arma",
    slot: "manoDer"
  });
  const actor = createActor([sword]);

  let viewModel = buildInventoryViewModel(actor);
  assert.deepEqual(viewModel.categories.armas, [sword]);
  assert.equal(viewModel.equipment.manoDer, null);

  assert.equal(await equiparObjeto(actor, sword), true);
  viewModel = buildInventoryViewModel(actor);
  assert.deepEqual(viewModel.categories.armas, []);
  assert.equal(viewModel.equipment.manoDer, sword);

  assert.equal(await desequiparObjeto(actor, sword), true);
  viewModel = buildInventoryViewModel(actor);
  assert.deepEqual(viewModel.categories.armas, [sword]);
  assert.equal(viewModel.equipment.manoDer, null);
});

test("escudos siguen siendo validos en manos y no aportan dano de @mano", async () => {
  const shield = createItem("shield", {
    tipoObjeto: "escudo",
    slot: "manoIzq",
    danio: 99
  });
  const actor = createActor([shield]);

  assert.equal(await equiparObjeto(actor, shield), true);
  assert.deepEqual(getEquippedShields(actor), [{ slot: "manoIzq", item: shield }]);
  assert.deepEqual(mtrolObtenerDanioManos(actor), {
    manoDer: 0,
    manoIzq: 0,
    total: 0,
    nombresDer: [],
    nombresIzq: []
  });
});

test("@manoDer, @manoIzq y @mano conservan ambas armas equipadas", async () => {
  const right = createItem("right", {
    name: "Espada",
    tipoObjeto: "arma",
    slot: "manoDer",
    danio: 3
  });
  const left = createItem("left", {
    name: "Daga",
    tipoObjeto: "arma",
    slot: "manoIzq",
    danio: 4
  });
  const actor = createActor([right, left]);

  assert.equal(await equiparObjeto(actor, right), true);
  assert.equal(await equiparObjeto(actor, left), true);

  const hands = mtrolObtenerDanioManos(actor);
  const rollData = mtrolPrepararRollData(actor).data;

  assert.equal(hands.manoDer, 3);
  assert.equal(hands.manoIzq, 4);
  assert.equal(hands.total, 7);
  assert.equal(rollData.manoDer, 3);
  assert.equal(rollData.manoIzq, 4);
  assert.equal(rollData.mano, 7);
});

test("destruccion del Item equipado sigue limpiando el slot y el documento", async () => {
  const helmet = createItem("helmet", { equipado: true });
  const actor = createActor([helmet], { cabeza: helmet.id });

  const result = await destroyEquippedItem({
    actor,
    item: helmet,
    slot: "cabeza"
  });

  assert.equal(result.destroyed, true);
  assert.deepEqual(result.clearedSlots, ["cabeza"]);
  assert.equal(actor.system.equipamiento.cabeza, "");
  assert.equal(actor.items.get(helmet.id), null);
  assert.equal(actor.deleteCalls, 1);
});
