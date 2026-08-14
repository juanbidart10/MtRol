import test from "node:test";
import assert from "node:assert/strict";

const originalConsole = {
  groupCollapsed: console.groupCollapsed,
  groupEnd: console.groupEnd,
  table: console.table,
  info: console.info,
  warn: console.warn,
  error: console.error
};

for (const name of Object.keys(originalConsole)) console[name] = () => {};

let writeAttempts = 0;
let settingWrites = 0;
let flagWrites = 0;

function forbiddenWrite() {
  writeAttempts += 1;
  throw new Error("El dryRun no debe escribir.");
}

function forbiddenSettingWrite() {
  settingWrites += 1;
  throw new Error("El dryRun no debe modificar Settings.");
}

function forbiddenFlagWrite() {
  flagWrites += 1;
  throw new Error("El dryRun no debe modificar flags.");
}

function collection(documents = []) {
  const result = [...documents];
  result.get = id => result.find(document => document.id === id) ?? null;
  return result;
}

function createItem({
  id,
  name = id,
  type = "objeto",
  system = {},
  sourceSystem = system,
  includeSource = true,
  img = "icons/item.webp"
}) {
  const item = {
    __mtrolRepairFixture: true,
    id,
    uuid: `Item.${id}`,
    name,
    type,
    img,
    system: structuredClone(system),
    update: forbiddenWrite,
    delete: forbiddenWrite,
    setFlag: forbiddenFlagWrite,
    unsetFlag: forbiddenFlagWrite,
    toObject() {
      return {
        _id: this.id,
        name: this.name,
        type: this.type,
        img: this.img,
        system: structuredClone(this._source?.system ?? this.system)
      };
    }
  };

  if (includeSource) item._source = { system: structuredClone(sourceSystem) };
  return item;
}

function createActor({
  id,
  name = id,
  type = "personaje",
  items = [],
  equipamiento = {},
  synthetic = false,
  pack = null
}) {
  const actor = {
    __mtrolRepairFixture: true,
    id,
    uuid: synthetic
      ? `Scene.scene.Token.${id}.Actor.${id}`
      : `Actor.${id}`,
    name,
    type,
    isToken: synthetic,
    pack,
    system: { equipamiento: structuredClone(equipamiento) },
    items: collection(items),
    update: forbiddenWrite,
    updateEmbeddedDocuments: forbiddenWrite,
    createEmbeddedDocuments: forbiddenWrite,
    deleteEmbeddedDocuments: forbiddenWrite,
    setFlag: forbiddenFlagWrite,
    unsetFlag: forbiddenFlagWrite,
    toObject() {
      return {
        _id: this.id,
        name: this.name,
        type: this.type,
        system: structuredClone(this._source.system),
        items: this.items.map(item => item.toObject())
      };
    }
  };

  actor._source = {
    system: { equipamiento: structuredClone(equipamiento) }
  };

  for (const item of actor.items) {
    item.uuid = `${actor.uuid}.Item.${item.id}`;
    item.parent = actor;
  }

  return actor;
}

function createToken({ id, actor, actorLink = false, baseActor = actor }) {
  return {
    id,
    uuid: `Scene.scene.Token.${id}`,
    name: id,
    actor,
    actorId: baseActor?.id ?? null,
    baseActor,
    actorLink,
    isLinked: actorLink,
    update: forbiddenWrite
  };
}

function baseSystem(overrides = {}) {
  return {
    peso: 1,
    slots: 0,
    cantidad: 1,
    equipado: false,
    equipable: true,
    slot: "",
    material: "",
    ...overrides
  };
}

function installWorld({ actors = [], scenes = [], packs = [] } = {}) {
  globalThis.game = {
    user: { id: "gm", isGM: true },
    world: { id: "test-world", title: "Test World" },
    version: "14.321",
    system: { id: "mtrol", version: "1.2.3" },
    actors: collection(actors),
    scenes: collection(scenes),
    packs: collection(packs),
    settings: {
      set: forbiddenSettingWrite
    }
  };

  writeAttempts = 0;
  settingWrites = 0;
  flagWrites = 0;
}

function installComprehensiveWorld() {
  const items = [
    createItem({ id: "orphan-true", system: baseSystem({ equipado: true, slot: "pies" }) }),
    createItem({ id: "inventory-false", system: baseSystem({ equipado: false }) }),
    createItem({ id: "referenced-false", system: baseSystem({ equipado: false, slot: "manoDer" }) }),
    createItem({ id: "referenced-true", system: baseSystem({ equipado: true, slot: "manoIzq" }) }),
    createItem({ id: "multi", system: baseSystem({ equipado: true, slot: "cabeza" }) }),
    createItem({ id: "weight-zero", system: baseSystem({ peso: 0, slots: 7 }) }),
    createItem({ id: "weight-string-zero", system: baseSystem({ peso: "0" }) }),
    createItem({ id: "weight-string-two", system: baseSystem({ peso: "2" }) }),
    createItem({
      id: "legacy-weight",
      system: baseSystem({ slots: 2 }),
      sourceSystem: baseSystem({ slots: 2 })
    }),
    createItem({
      id: "indeterminate-weight",
      system: baseSystem({ peso: 0, slots: 4 }),
      includeSource: false
    }),
    createItem({ id: "invalid-weight", system: baseSystem({ peso: "no", slots: 9 }) }),
    createItem({ id: "negative-weight", system: baseSystem({ peso: -1, slots: 9 }) }),
    createItem({ id: "quantity-string", system: baseSystem({ cantidad: "3" }) }),
    createItem({ id: "quantity-negative", system: baseSystem({ cantidad: -1 }) }),
    createItem({ id: "quantity-invalid", system: baseSystem({ cantidad: "x" }) }),
    createItem({
      id: "potion-stack",
      name: "Pocion de vida",
      system: baseSystem({ cantidad: 10 })
    }),
    createItem({
      id: "duplicate-a",
      name: "Objeto semejante",
      system: baseSystem()
    }),
    createItem({
      id: "duplicate-b",
      name: "Objeto semejante",
      system: baseSystem()
    }),
    createItem({
      id: "material-zero",
      system: baseSystem({ peso: 0, slots: 8, cantidad: 5, material: "papiro" })
    })
  ];

  // La ausencia debe existir tanto en el documento materializado como en _source.
  delete items.find(item => item.id === "legacy-weight").system.peso;
  delete items.find(item => item.id === "legacy-weight")._source.system.peso;

  const actor = createActor({
    id: "personaje",
    name: "Personaje",
    items,
    equipamiento: {
      cabeza: "multi",
      cuello: "multi",
      pecho: "missing-item",
      pies: "referenced-false",
      manoIzq: "referenced-true",
      manoDer: "",
      hombros: "",
      brazos: "",
      piernas: "",
      extra: ""
    }
  });

  const character = createActor({
    id: "character",
    type: "character",
    items: [createItem({ id: "character-item", system: baseSystem() })],
    equipamiento: {}
  });

  const synthetic = createActor({
    id: "synthetic",
    synthetic: true,
    items: [createItem({ id: "synthetic-orphan", system: baseSystem({ equipado: true }) })],
    equipamiento: {}
  });

  const compendiumActor = createActor({
    id: "compendium",
    items: [createItem({ id: "pack-item", system: baseSystem({ equipado: true }) })],
    pack: "mtrol.test-pack"
  });

  const scene = {
    id: "scene",
    uuid: "Scene.scene",
    name: "Escena",
    tokens: collection([
      createToken({ id: "linked", actor, actorLink: true }),
      createToken({ id: "synthetic", actor: synthetic, actorLink: false, baseActor: actor })
    ]),
    update: forbiddenWrite
  };

  installWorld({
    actors: [actor, character, compendiumActor],
    scenes: [scene],
    packs: [{
      collection: "mtrol.test-pack",
      documentName: "Actor",
      metadata: { id: "mtrol.test-pack", label: "Test Pack", type: "Actor" }
    }]
  });

  return { actor, character, synthetic, compendiumActor, scene };
}

const repair = await import("../scripts/core/item-data-repair.js");
const actorDebug = await import("../scripts/core/actor-data-debug.js");

function operation(report, category, itemId = null) {
  return report.operations.find(entry =>
    entry.category === category && (itemId === null || entry.itemId === itemId)
  );
}

function conflicts(report, category) {
  return report.conflicts.filter(entry => entry.category === category);
}

test("dryRun produce plan y respaldo serializables con cero escrituras", () => {
  installComprehensiveWorld();

  const report = repair.generateItemDataRepairPlan({ dryRun: true });
  const backup = repair.getItemDataRepairBackup(report);

  assert.equal(report.migrationId, "mtrol-item-data-repair-v1");
  assert.equal(report.migrationVersion, 1);
  assert.equal(report.dryRun, true);
  assert.equal(report.systemVersion, "1.2.3");
  assert.equal(report.worldId, "test-world");
  assert.equal(report.foundryVersion, "14.321");
  assert.equal(report.summary.writesPerformed, 0);
  assert.equal(report.summary.documentsCreated, 0);
  assert.equal(report.summary.documentsDeleted, 0);
  assert.equal(report.summary.documentsTransferred, 0);
  assert.equal(report.summary.settingsModified, 0);
  assert.equal(report.summary.flagsModified, 0);
  assert.equal(report.summary.backupComplete, true);
  assert.equal(writeAttempts, 0);
  assert.equal(settingWrites, 0);
  assert.equal(flagWrites, 0);
  assert.doesNotThrow(() => JSON.parse(repair.serializeItemDataRepairReport(report)));
  assert.doesNotThrow(() => JSON.parse(repair.serializeItemDataRepairBackup(backup)));
  assert.equal(repair.verifyItemDataRepairDryRun(report).valid, true);
  assert.equal(backup.readOnly, true);
  assert.equal(backup.persistedToWorld, false);
  assert.equal(backup.complete, true);
  assert.match(backup.checksum, /^fnv1a32:/);
});

test("el bloqueo rechaza dryRun false antes de cualquier escritura", () => {
  installComprehensiveWorld();

  assert.throws(
    () => repair.generateItemDataRepairPlan({ dryRun: false }),
    /Escrituras bloqueadas/
  );
  assert.equal(writeAttempts, 0);
  assert.equal(settingWrites, 0);
  assert.equal(flagWrites, 0);
});

test("equipamiento legacy propone solo sincronizaciones deterministas", () => {
  const { actor } = installComprehensiveWorld();
  const report = repair.generateItemDataRepairPlan({ dryRun: true });

  assert.equal(operation(report, "sync-equipped-false", "orphan-true").after.value, false);
  assert.equal(operation(report, "sync-equipped-false", "inventory-false"), undefined);
  assert.equal(operation(report, "sync-equipped-true", "referenced-false").after.value, true);
  assert.equal(operation(report, "sync-equipped-true", "referenced-true"), undefined);

  const slotSync = operation(report, "sync-declared-slot", "referenced-false");
  assert.equal(slotSync.after.value, "pies");
  assert.equal(slotSync.before.value, "manoDer");
  assert.equal(operation(report, "sync-declared-slot", "orphan-true"), undefined);

  const broken = operation(report, "clear-broken-slot-reference");
  assert.equal(broken.fieldsChanged[0], "system.equipamiento.pecho");
  assert.equal(broken.before.value, "missing-item");
  assert.equal(broken.after.value, "");
  assert.equal(broken.itemId, null);

  assert.equal(conflicts(report, "multiple-slot-references").length, 1);
  assert.equal(operation(report, "sync-equipped-true", "multi"), undefined);
  assert.equal(operation(report, "sync-declared-slot", "multi"), undefined);

  const uniqueFields = new Set(report.operations.map(entry =>
    `${entry.actorUuid}:${entry.itemId}:${entry.fieldsChanged[0]}`
  ));
  assert.equal(uniqueFields.size, report.operations.length);
  assert.equal(report.operations.some(entry =>
    ["create", "delete", "merge", "transfer"].some(word => entry.category.includes(word))
  ), false);
  assert.equal(
    report.backup.actors.find(entry => entry.id === actor.id).items.length,
    actor.items.length
  );
});

test("peso y cantidad conservan cero y solo normalizan representaciones inequívocas", () => {
  const { actor } = installComprehensiveWorld();
  const report = repair.generateItemDataRepairPlan({ dryRun: true });

  assert.equal(operation(report, "normalize-weight-string", "weight-zero"), undefined);
  assert.equal(operation(report, "normalize-weight-string", "weight-string-zero").after.value, 0);
  assert.equal(operation(report, "normalize-weight-string", "weight-string-two").after.value, 2);

  const legacy = operation(report, "migrate-legacy-weight", "legacy-weight");
  assert.equal(legacy.before.exists, false);
  assert.equal(legacy.before.state, "absent");
  assert.equal(legacy.after.value, 2);
  assert.equal(operation(report, "migrate-legacy-weight", "indeterminate-weight"), undefined);
  assert.equal(conflicts(report, "indeterminate-weight-origin").length >= 1, true);
  assert.equal(operation(report, "migrate-legacy-weight", "invalid-weight"), undefined);
  assert.equal(operation(report, "migrate-legacy-weight", "negative-weight"), undefined);

  assert.equal(operation(report, "normalize-quantity-string", "quantity-string").after.value, 3);
  assert.equal(operation(report, "normalize-quantity-string", "potion-stack"), undefined);
  assert.equal(conflicts(report, "negative-quantity").length, 1);
  assert.equal(conflicts(report, "invalid-quantity").length >= 1, true);

  const material = actor.items.get("material-zero");
  const materialBackup = report.backup.actors
    .find(entry => entry.id === actor.id).items
    .find(entry => entry.id === material.id);
  assert.equal(materialBackup.fields.peso.value, 0);
  assert.equal(report.auditSummary.currentTotalWeight >= 0, true);
});

test("duplicados, cantidades altas y documentos existentes permanecen solo informativos", () => {
  const { actor } = installComprehensiveWorld();
  const initialIds = actor.items.map(item => item.id);
  const report = repair.generateItemDataRepairPlan({ dryRun: true });

  assert.equal(conflicts(report, "similar-document-candidate").length, 1);
  assert.equal(report.operations.some(entry =>
    ["duplicate-a", "duplicate-b", "potion-stack"].includes(entry.itemId) &&
    entry.fieldsChanged.includes("system.cantidad")
  ), false);
  assert.deepEqual(actor.items.map(item => item.id), initialIds);
  assert.equal(actor.items.get("potion-stack").system.cantidad, 10);
  assert.equal(writeAttempts, 0);
});

test("el respaldo conserva fuente completa y distingue ausencia, undefined, null, vacio y ceros", () => {
  const specialItems = [
    createItem({ id: "absent", system: baseSystem(), sourceSystem: baseSystem() }),
    createItem({ id: "undefined", system: baseSystem({ peso: undefined }) }),
    createItem({ id: "null", system: baseSystem({ peso: null }) }),
    createItem({ id: "empty", system: baseSystem({ peso: "" }) }),
    createItem({ id: "zero-number", system: baseSystem({ peso: 0 }) }),
    createItem({ id: "zero-string", system: baseSystem({ peso: "0" }) }),
    createItem({ id: "numeric", system: baseSystem({ peso: 2 }) }),
    createItem({ id: "numeric-string", system: baseSystem({ peso: "2" }) }),
    createItem({ id: "invalid", system: baseSystem({ peso: "x" }) })
  ];
  delete specialItems[0].system.peso;
  delete specialItems[0]._source.system.peso;
  const actor = createActor({ id: "states", items: specialItems });
  installWorld({ actors: [actor] });

  const report = repair.generateItemDataRepairPlan({ dryRun: true });
  const entries = new Map(report.backup.actors[0].items.map(item => [item.id, item]));

  assert.equal(entries.get("absent").fields.peso.state, "absent");
  assert.equal(entries.get("undefined").fields.peso.state, "undefined");
  assert.equal(entries.get("null").fields.peso.state, "null");
  assert.equal(entries.get("empty").fields.peso.state, "empty-string");
  assert.equal(entries.get("zero-number").fields.peso.state, "number-zero");
  assert.equal(entries.get("zero-string").fields.peso.state, "string-zero");
  assert.equal(entries.get("numeric").fields.peso.state, "number");
  assert.equal(entries.get("numeric-string").fields.peso.state, "numeric-string");
  assert.equal(entries.get("invalid").fields.peso.state, "string");
  assert.equal(entries.get("undefined").fields.peso.value.__mtrolSerializedType, "undefined");
  assert.equal(entries.get("numeric").sourceDataAvailable, true);
  assert.doesNotThrow(() => JSON.stringify(report.backup));
});

test("dos dryRun sobre el mismo estado generan el mismo plan y checksum", () => {
  installComprehensiveWorld();
  const first = repair.generateItemDataRepairPlan({ dryRun: true });
  const second = repair.generateItemDataRepairPlan({ dryRun: true });

  assert.deepEqual(first.operations, second.operations);
  assert.deepEqual(first.conflicts, second.conflicts);
  assert.equal(first.backup.checksum, second.backup.checksum);
  assert.equal(first.backup.backupId, second.backup.backupId);
  assert.equal(writeAttempts, 0);
});

function installRollbackWorld() {
  const legacy = createItem({
    id: "a-legacy",
    system: baseSystem({ slots: 2 }),
    sourceSystem: baseSystem({ slots: 2 })
  });
  delete legacy.system.peso;
  delete legacy._source.system.peso;
  const orphan = createItem({
    id: "b-orphan",
    system: baseSystem({ equipado: true })
  });
  const later = createItem({
    id: "c-later",
    system: baseSystem({ cantidad: "4" })
  });
  const actor = createActor({ id: "rollback", items: [legacy, orphan, later] });
  installWorld({ actors: [actor] });
  const report = repair.generateItemDataRepairPlan({ dryRun: true });
  return { actor, legacy, orphan, later, report };
}

test("rollback simulado restaura valores y vuelve a eliminar propiedades originalmente ausentes", () => {
  const { actor, legacy, orphan, later, report } = installRollbackWorld();
  const fail = operation(report, "sync-equipped-false", orphan.id);
  const result = repair.simulateItemDataRepairForFixtures({
    report,
    actors: [actor],
    failOperationId: fail.operationId
  });

  assert.equal(result.atomic, false);
  assert.equal(result.actors[0].status, "failed");
  assert.equal(result.actors[0].compensation.attempted, true);
  assert.equal(result.actors[0].compensation.success, true);
  assert.equal(Object.hasOwn(legacy.system, "peso"), false);
  assert.equal(Object.hasOwn(legacy._source.system, "peso"), false);
  assert.equal(orphan.system.equipado, true);
  assert.equal(later.system.cantidad, "4");
  assert.match(result.errors[0].message, /Fallo intermedio simulado/);
});

test("fallo de compensacion se informa expresamente y no se presenta como atomico", () => {
  const { actor, legacy, orphan, report } = installRollbackWorld();
  const legacyOperation = operation(report, "migrate-legacy-weight", legacy.id);
  const fail = operation(report, "sync-equipped-false", orphan.id);
  const result = repair.simulateItemDataRepairForFixtures({
    report,
    actors: [actor],
    failOperationId: fail.operationId,
    failCompensationOperationId: legacyOperation.operationId
  });

  assert.equal(result.atomic, false);
  assert.equal(result.compensations[0].success, false);
  assert.match(result.compensations[0].errors[0].message, /Fallo de compensacion simulado/);
  assert.equal(legacy.system.peso, 2);
});

test("estado distinto a before bloquea la simulacion y una aplicacion completa es idempotente", () => {
  {
    const { actor, orphan, later, report } = installRollbackWorld();
    orphan.system.equipado = false;
    const result = repair.simulateItemDataRepairForFixtures({ report, actors: [actor] });
    assert.equal(result.actors[0].status, "failed");
    assert.match(result.actors[0].error, /no coincide con before/);
    assert.equal(later.system.cantidad, "4");
  }

  {
    const { actor, report } = installRollbackWorld();
    const result = repair.simulateItemDataRepairForFixtures({ report, actors: [actor] });
    assert.equal(result.actors[0].status, "applied");

    const secondPlan = repair.generateItemDataRepairPlan({ dryRun: true });
    assert.equal(repair.getEligibleItemDataRepairOperations(secondPlan).length, 0);
    assert.equal(actor.items.length, 3);
  }
});

test("actores, tokens, sinteticos y compendios quedan separados por alcance", () => {
  const { compendiumActor } = installComprehensiveWorld();
  const packSnapshot = structuredClone(compendiumActor.items[0].system);
  const report = repair.generateItemDataRepairPlan({ dryRun: true });

  assert.equal(report.summary.worldActorsAudited, 2);
  assert.equal(report.actors.some(entry => entry.actor.type === "personaje"), true);
  assert.equal(report.actors.some(entry => entry.actor.type === "character"), true);
  assert.equal(report.linkedTokens.length, 1);
  assert.equal(report.linkedTokens[0].separateRepairRequired, false);
  assert.equal(report.syntheticActors.length, 1);
  assert.equal(report.syntheticActors[0].actor.writeEligible, false);
  assert.equal(report.operations.some(entry =>
    entry.actorUuid === report.syntheticActors[0].actor.uuid && entry.repairEligible
  ), false);
  assert.equal(report.compendiums.opened, false);
  assert.equal(report.compendiums.modified, false);
  assert.equal(report.compendiums.discovered.length, 1);
  assert.deepEqual(compendiumActor.items[0].system, packSnapshot);
  assert.equal(writeAttempts, 0);
});

test("la API debug preserva funciones previas y no expone aplicacion real", () => {
  installComprehensiveWorld();
  const api = {};
  actorDebug.installActorDataDebugApi(api);

  for (const name of [
    "auditActor",
    "auditItems",
    "findGhostItems",
    "compareWeight",
    "auditCollections",
    "auditWorldItems",
    "serializeWorldItemsAudit",
    "planItemDataRepair",
    "getItemDataRepairReport",
    "getItemDataRepairBackup",
    "getEligibleItemDataRepairOperations",
    "getItemDataRepairConflicts",
    "verifyItemDataRepairDryRun",
    "serializeItemDataRepairReport",
    "serializeItemDataRepairBackup",
    "exportItemDataRepairReport",
    "exportItemDataRepairBackup"
  ]) {
    assert.equal(typeof api[name], "function", name);
  }

  assert.equal("applyItemDataRepair" in api, false);
  assert.equal("rollbackItemDataRepair" in api, false);
});

test.after(() => {
  Object.assign(console, originalConsole);
});
