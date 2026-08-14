import test from "node:test";
import assert from "node:assert/strict";

globalThis.game = {
  user: { id: "gm", isGM: true },
  system: { version: "1.2.3" },
  actors: [],
  scenes: []
};

const auditModule =
  await import("../scripts/core/world-item-audit.js");

let writeAttempts = 0;

function forbiddenWrite() {
  writeAttempts += 1;
  throw new Error("La auditoria no debe escribir documentos.");
}

function collection(documents) {
  const result = [...documents];
  result.get = id => result.find(document => document.id === id) ?? null;
  return result;
}

function createItem({
  id,
  name = id,
  type = "objeto",
  system = {},
  sourceSystem,
  includeSource = true,
  img = "icons/item.webp"
}) {
  const item = {
    id,
    uuid: `Item.${id}`,
    name,
    type,
    img,
    system: { ...system },
    update: forbiddenWrite,
    delete: forbiddenWrite
  };

  if (includeSource) {
    item._source = {
      system: { ...(sourceSystem ?? system) }
    };
  }

  return item;
}

function createActor({
  id,
  uuid = `Actor.${id}`,
  name = id,
  type = "personaje",
  items = [],
  equipamiento = {},
  synthetic = false
}) {
  const actor = {
    id,
    uuid,
    name,
    type,
    isToken: synthetic,
    system: { equipamiento: { ...equipamiento } },
    items: collection(items),
    update: forbiddenWrite,
    createEmbeddedDocuments: forbiddenWrite,
    updateEmbeddedDocuments: forbiddenWrite,
    deleteEmbeddedDocuments: forbiddenWrite
  };

  for (const item of actor.items) {
    item.uuid = `${uuid}.Item.${item.id}`;
    item.parent = actor;
  }

  return actor;
}

function createToken({
  id,
  actor,
  baseActor = {},
  actorLink = false,
  uuid = `Scene.scene.Token.${id}`
}) {
  return {
    id,
    uuid,
    name: id,
    actor,
    baseActor,
    actorLink,
    isLinked: actorLink,
    update: forbiddenWrite
  };
}

function installWorld({ actors = [], scenes = [] } = {}) {
  globalThis.game.actors = collection(actors);
  globalThis.game.scenes = collection(scenes);
  globalThis.game.user.isGM = true;
  writeAttempts = 0;
}

test("auditWorldItems recorre el mundo y clasifica datos sin realizar escrituras", () => {
  class MockObjetoDataModel {
    constructor(source) {
      Object.assign(this, source);
      this._source = { ...source };
    }
  }

  const materializedZero = createItem({
    id: "materialized-zero",
    system: { peso: 0, slots: 5, cantidad: 1, equipado: false, slot: "" }
  });
  materializedZero.system = new MockObjetoDataModel(materializedZero.system);

  const items = [
    createItem({
      id: "zero",
      system: { peso: 0, slots: 1, cantidad: 7, equipado: false, slot: "" }
    }),
    createItem({
      id: "legacy",
      system: { peso: 0, slots: 2, cantidad: 1, equipado: false, slot: "" },
      sourceSystem: { slots: 2, cantidad: 1, equipado: false, slot: "" }
    }),
    createItem({
      id: "indeterminate",
      system: { peso: 0, slots: 3, cantidad: 1, equipado: false, slot: "" },
      includeSource: false
    }),
    materializedZero,
    createItem({
      id: "invalid-weight",
      system: { peso: "no", slots: 4, cantidad: 1, equipado: false, slot: "" }
    }),
    createItem({
      id: "orphan",
      system: { peso: 1, slots: 0, cantidad: 1, equipado: true, slot: "pies" }
    }),
    createItem({
      id: "referenced-false",
      system: { peso: 1, slots: 0, cantidad: 1, equipado: false, slot: "manoDer" }
    }),
    createItem({
      id: "conflict",
      system: { peso: 1, slots: 0, cantidad: 1, equipado: true, slot: "cabeza" }
    }),
    createItem({
      id: "quantity-null",
      system: { peso: 1, slots: 0, cantidad: null, equipado: false, slot: "" }
    }),
    createItem({
      id: "quantity-empty",
      system: { peso: 1, slots: 0, cantidad: "", equipado: false, slot: "" }
    }),
    createItem({
      id: "quantity-negative",
      system: { peso: 1, slots: 0, cantidad: -1, equipado: false, slot: "" }
    }),
    createItem({
      id: "quantity-invalid",
      system: { peso: 1, slots: 0, cantidad: "x", equipado: false, slot: "" }
    }),
    createItem({
      id: "quantity-absent",
      system: { peso: 1, slots: 0, cantidad: 1, equipado: false, slot: "" },
      sourceSystem: { peso: 1, slots: 0, equipado: false, slot: "" }
    }),
    createItem({
      id: "duplicate-a",
      name: "Objeto repetido",
      system: { peso: 2, slots: 0, cantidad: 1, equipado: false, slot: "" }
    }),
    createItem({
      id: "duplicate-b",
      name: "Objeto repetido",
      system: { peso: 2, slots: 0, cantidad: 1, equipado: false, slot: "" }
    }),
    createItem({
      id: "skill",
      type: "competencia",
      system: { categoria: "competencia" }
    })
  ];

  const actor = createActor({
    id: "world",
    items,
    equipamiento: {
      manoDer: "referenced-false",
      cabeza: "conflict",
      cuello: "conflict",
      pies: "missing-item"
    }
  });

  const synthetic = createActor({
    id: "synthetic-base",
    uuid: "Scene.scene.Token.synthetic.Actor.synthetic-base",
    synthetic: true,
    items: [
      createItem({
        id: "synthetic-item",
        system: { peso: 3, slots: 0, cantidad: 1, equipado: false, slot: "" }
      })
    ]
  });

  const unknown = createActor({
    id: "unknown",
    type: "npc-custom",
    items: [
      createItem({
        id: "unknown-item",
        system: { peso: 1, cantidad: 1 }
      })
    ]
  });

  const compendiumActor = createActor({
    id: "compendium",
    items: [
      createItem({
        id: "compendium-item",
        system: { peso: 99, cantidad: 1 }
      })
    ]
  });
  compendiumActor.pack = "mtrol.test-pack";

  const scene = {
    id: "scene",
    uuid: "Scene.scene",
    name: "Escena",
    tokens: collection([
      createToken({ id: "synthetic", actor: synthetic }),
      createToken({ id: "synthetic-copy", actor: synthetic }),
      createToken({ id: "linked", actor, baseActor: actor, actorLink: true }),
      createToken({ id: "missing", actor: null, baseActor: null })
    ]),
    update: forbiddenWrite
  };

  installWorld({ actors: [actor, unknown, compendiumActor], scenes: [scene] });

  const report = auditModule.auditWorldItems({
    includeWorldActors: true,
    includeUnlinkedTokens: true,
    dryRun: true
  });

  assert.equal(report.audit.readOnly, true);
  assert.equal(report.audit.dryRun, true);
  assert.equal(report.audit.systemVersion, "1.2.3");
  assert.equal(report.summary.actorsScanned, 1);
  assert.equal(report.summary.syntheticActorsScanned, 1);
  assert.equal(report.summary.unknownCompatibleStructures, 1);
  assert.equal(report.summary.modernZeroWeightItems, 1);
  assert.equal(report.summary.migratableLegacyItems, 1);
  assert.equal(report.summary.indeterminateLegacyItems, 2);
  assert.equal(report.summary.invalidWeightItems, 1);
  assert.equal(report.summary.invalidQuantityItems, 4);
  assert.equal(report.summary.orphanEquippedItems, 1);
  assert.equal(report.summary.referencedButUnequippedItems, 1);
  assert.equal(report.summary.brokenSlotReferences, 1);
  assert.equal(report.summary.slotConflicts, 1);
  assert.equal(report.summary.possibleDuplicates, 1);
  assert.equal(report.possibleDuplicates[0].classification, "similar-document-candidate");
  assert.equal(report.possibleDuplicates[0].duplicateConclusion, "not-determined");
  assert.equal(report.possibleDuplicates[0].repairEligible, false);
  assert.equal(report.possibleDuplicates[0].proposedFutureRepair, null);
  assert.equal(report.summary.projectedTotalWeight, null);
  assert.equal(report.unknownCompatibleStructures[0].type, "npc-custom");
  assert.equal(report.warnings[0].classification, "unlinked-token-without-base-actor");

  const worldItems = report.actors.find(entry => entry.actor.id === "world").items;
  assert.equal(
    worldItems.find(item => item.itemId === "quantity-null").quantityClassification,
    "quantity-invalid"
  );
  assert.equal(
    worldItems.find(item => item.itemId === "quantity-empty").quantityClassification,
    "quantity-invalid"
  );
  assert.equal(
    worldItems.find(item => item.itemId === "quantity-negative").quantityClassification,
    "quantity-negative"
  );
  assert.equal(
    worldItems.find(item => item.itemId === "quantity-absent").quantityClassification,
    "quantity-absent"
  );
  assert.equal(
    worldItems.find(item => item.itemId === "indeterminate").weight.existence,
    "indeterminate"
  );
  assert.equal(
    worldItems.find(item => item.itemId === "materialized-zero").weight.existence,
    "indeterminate"
  );
  assert.equal(
    worldItems.find(item => item.itemId === "zero").proposedFutureRepair,
    null
  );
  assert.equal(
    report.actors.some(entry => entry.actor.id === "compendium"),
    false
  );
  assert.equal(writeAttempts, 0);

  const serialized = auditModule.serializeWorldItemsAudit(report);
  assert.doesNotThrow(() => JSON.parse(serialized));
  assert.equal(JSON.parse(serialized).summary.actorsScanned, 1);
});

test("peso moderno cero informa la diferencia frente a la regla legacy anterior", () => {
  const actor = createActor({
    id: "keys",
    items: [
      createItem({
        id: "keys-item",
        name: "Llaves",
        system: { peso: 0, slots: 1, cantidad: 7, equipado: false, slot: "" }
      })
    ]
  });

  installWorld({ actors: [actor] });

  const report = auditModule.auditWorldItems({ dryRun: true });
  const item = report.actors[0].items[0];

  assert.equal(item.currentContribution, 0);
  assert.equal(item.previousLegacyContribution, 7);
  assert.equal(item.expectedContribution, 0);
  assert.equal(item.classification.includes("correct-item"), true);
  assert.equal(report.summary.currentTotalWeight, 0);
  assert.equal(report.summary.previousLegacyTotalWeight, 7);
  assert.equal(report.summary.projectedTotalWeight, 0);
  assert.equal(report.summary.modernZeroWeightItems, 1);
  assert.equal(writeAttempts, 0);
});

test("una cantidad elevada no se clasifica como duplicacion", () => {
  const actor = createActor({
    id: "stack",
    items: [
      createItem({
        id: "potions",
        name: "Pocion de vida",
        system: { peso: 1, slots: 0, cantidad: 10, equipado: false, slot: "" }
      })
    ]
  });

  installWorld({ actors: [actor] });
  const report = auditModule.auditWorldItems({ dryRun: true });

  assert.equal(report.summary.possibleDuplicates, 0);
  assert.deepEqual(report.possibleDuplicates, []);
  assert.equal(report.actors[0].items[0].currentQuantity, 10);
});

test("la auditoria exige GM y dryRun true", () => {
  installWorld();

  assert.throws(
    () => auditModule.auditWorldItems({ dryRun: false }),
    /requiere dryRun: true/
  );

  globalThis.game.user.isGM = false;

  assert.throws(
    () => auditModule.auditWorldItems({ dryRun: true }),
    /Solo el GM/
  );

  globalThis.game.user.isGM = true;
  assert.equal(writeAttempts, 0);
});

test("la API nueva se instala sin retirar las funciones de debug existentes", async () => {
  const actorDebug =
    await import("../scripts/core/actor-data-debug.js");
  const api = {};

  actorDebug.installActorDataDebugApi(api);

  for (const name of [
    "auditActor",
    "auditItems",
    "findGhostItems",
    "compareWeight",
    "auditCollections",
    "auditWorldItems",
    "serializeWorldItemsAudit"
  ]) {
    assert.equal(typeof api[name], "function");
  }
});
