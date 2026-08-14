import test from "node:test";
import assert from "node:assert/strict";

globalThis.game = {
  user: { id: "gm", isGM: true }
};

globalThis.ChatMessage = {
  getSpeaker() { return {}; },
  async create() { return {}; }
};

const destruction =
  await import("../scripts/items/item-destruction-engine.js");
const equipment =
  await import("../scripts/items/equipment-engine.js");
const rolls =
  await import("../scripts/rolls/roll-helpers.js");
const damageAuthorized =
  await import("../scripts/combat/damage-authorized.js");

function collection(items) {
  const result = [...items];
  result.get = id => result.find(item => item.id === id) ?? null;
  return result;
}

function createItem(id, system = {}) {
  return {
    id,
    uuid: `Actor.validation.Item.${id}`,
    name: id,
    type: "objeto",
    system: { ...system },
    updateCount: 0,
    async update(changes) {
      this.updateCount += 1;
      for (const [path, value] of Object.entries(changes)) {
        if (path === "system.defensa") this.system.defensa = value;
      }
      return this;
    }
  };
}

function createActor(items, equipamiento = {}) {
  const actor = {
    id: "validation",
    uuid: "Actor.validation",
    name: "Validation",
    type: "personaje",
    system: {
      equipamiento: { ...equipamiento },
      vitales: { hp: { value: 10 } }
    },
    items: collection(items),
    updatedPaths: [],
    deletedIds: [],
    async update(changes) {
      this.updatedPaths.push(...Object.keys(changes));
      for (const [path, value] of Object.entries(changes)) {
        if (path.startsWith("system.equipamiento.")) {
          const slot = path.replace("system.equipamiento.", "");
          this.system.equipamiento[slot] = value;
        }
        if (path === "system.vitales.hp.value") {
          this.system.vitales.hp.value = value;
        }
      }
      return this;
    },
    async deleteEmbeddedDocuments(_type, ids) {
      this.deletedIds.push(...ids);
      for (const id of ids) {
        const index = this.items.findIndex(item => item.id === id);
        if (index >= 0) this.items.splice(index, 1);
      }
      return ids;
    }
  };

  return actor;
}

test("destruccion limpia solo slots que apuntan al documento aunque item.system.slot este desactualizado", async () => {
  const destroyed = createItem("destroyed", {
    slot: "pies",
    equipado: true,
    defensa: 1
  });
  const other = createItem("other", {
    slot: "pies",
    equipado: true,
    defensa: 5
  });
  const actor = createActor(
    [destroyed, other],
    { cabeza: "destroyed", cuello: "destroyed", pies: "other" }
  );
  const otherSnapshot = structuredClone(other.system);

  const result = await destruction.destroyEquippedItem({
    actor,
    item: destroyed,
    slot: "pies"
  });

  assert.equal(result.destroyed, true);
  assert.deepEqual(result.clearedSlots, ["cabeza", "cuello"]);
  assert.equal(actor.system.equipamiento.cabeza, "");
  assert.equal(actor.system.equipamiento.cuello, "");
  assert.equal(actor.system.equipamiento.pies, "other");
  assert.deepEqual(actor.deletedIds, ["destroyed"]);
  assert.equal(actor.items.get("destroyed"), null);
  assert.equal(actor.items.get("other"), other);
  assert.deepEqual(other.system, otherSnapshot);
  assert.equal(other.updateCount, 0);
});

test("helper funcional central reconoce referencia con flag falso y rechaza huerfano con flag verdadero", () => {
  const referenced = createItem("referenced", {
    tipoObjeto: "arma",
    slot: "manoDer",
    equipado: false,
    danio: 4
  });
  const orphan = createItem("orphan", {
    tipoObjeto: "arma",
    slot: "manoIzq",
    equipado: true,
    danio: 7
  });
  const actor = createActor(
    [referenced, orphan],
    { manoDer: "referenced", manoIzq: "" }
  );

  const hands = equipment.getEquippedHandItems(actor);

  assert.equal(hands.manoDer, referenced);
  assert.equal(hands.manoIzq, null);
});

test("roll-helpers reconoce la referencia con flag falso e ignora el arma huerfana", () => {
  const referenced = createItem("referenced", {
    tipoObjeto: "arma",
    slot: "manoDer",
    equipado: false,
    danio: 4
  });
  const orphan = createItem("orphan", {
    tipoObjeto: "arma",
    slot: "manoIzq",
    equipado: true,
    danio: 7
  });
  const actor = createActor(
    [referenced, orphan],
    { manoDer: "referenced", manoIzq: "" }
  );

  const result = rolls.mtrolObtenerDanioManos(actor);

  assert.equal(result.manoDer, 4);
  assert.equal(result.manoIzq, 0);
  assert.equal(result.total, 4);
});

test("dano simple reconoce la armadura referenciada aunque su flag sea falso", async () => {
  const referencedArmor = createItem("armor", {
    slot: "pecho",
    equipado: false,
    defensa: 5
  });
  const actor = createActor([referencedArmor], { pecho: "armor" });

  await damageAuthorized.aplicarDanioAutorizado({
    attackerActor: { name: "Attacker" },
    targetActor: actor,
    targetTokenDocument: null,
    payload: { danio: 2, slot: "pecho" }
  });

  assert.equal(actor.system.vitales.hp.value, 10);
  assert.equal(referencedArmor.system.defensa, 3);
  assert.equal(referencedArmor.updateCount, 1);
});

test("dano simple ignora una armadura huerfana aunque su flag sea verdadero", async () => {
  const orphanArmor = createItem("orphan-armor", {
    slot: "pecho",
    equipado: true,
    defensa: 5
  });
  const actor = createActor([orphanArmor], { pecho: "" });

  await damageAuthorized.aplicarDanioAutorizado({
    attackerActor: { name: "Attacker" },
    targetActor: actor,
    targetTokenDocument: null,
    payload: { danio: 2, slot: "pecho" }
  });

  assert.equal(actor.system.vitales.hp.value, 8);
  assert.equal(orphanArmor.system.defensa, 5);
  assert.equal(orphanArmor.updateCount, 0);
});
