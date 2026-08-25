import test from "node:test";
import assert from "node:assert/strict";

globalThis.game = {
  user: { id: "gm", isGM: true },
  users: [
    { id: "gm", isGM: true, active: true },
    { id: "player", isGM: false, active: true }
  ]
};

globalThis.foundry = {
  utils: { randomID: () => "generated-resource-transition" }
};

const actors = new Map();
globalThis.fromUuid = async uuid => actors.get(uuid) ?? null;

const { resetActorResourceServiceForTests } =
  await import("../scripts/actors/actor-resource-service.js");

async function loadService() {
  return import("../scripts/actors/class-resource-service.js");
}

function setPath(target, path, value) {
  const parts = path.replace(/^system\./, "").split(".");
  let cursor = target.system;
  for (const part of parts.slice(0, -1)) cursor = cursor[part] ??= {};
  cursor[parts.at(-1)] = value;
}

function createActor({
  classId = "mago",
  level = 2,
  resistance = 1,
  intelligence = 2,
  hpValue = 19,
  hpMax = 25,
  mpValue = 31,
  mpMax = 40,
  hpModifier = 0,
  mpModifier = 0
} = {}) {
  const actor = {
    uuid: `Actor.phase4-${actors.size}`,
    system: {
      identidad: { clase: classId === "mago" ? "Mago" : "Guerrero", classId },
      recursos: { nivel: level },
      atributos: { resistencia: resistance, inteligencia: intelligence },
      vitales: {
        hp: { value: hpValue, max: hpMax },
        mp: { value: mpValue, max: mpMax }
      },
      resourceModifiers: {
        hp: { value: hpModifier, label: "" },
        mp: { value: mpModifier, label: "" }
      }
    },
    updates: [],
    async update(changes, options = {}) {
      this.updates.push({ changes: structuredClone(changes), options: structuredClone(options) });
      for (const [path, value] of Object.entries(changes)) setPath(this, path, value);
    }
  };
  actors.set(actor.uuid, actor);
  return actor;
}

test.beforeEach(() => {
  actors.clear();
  resetActorResourceServiceForTests();
  game.user = game.users[0];
});

test("edición GM compuesta Nivel + Resistencia + Inteligencia produce una transición y una escritura", async () => {
  const { updateActorPermanentResourcesAuthoritative } = await loadService();
  const actor = createActor();

  await updateActorPermanentResourcesAuthoritative({
    actorUuid: actor.uuid,
    transactionId: "compound-update",
    expected: { classId: "mago", level: 2, resistance: 1, intelligence: 2 },
    changes: { level: 3, resistance: 2, intelligence: 3 }
  }, { requestingUserId: "gm", trustedActor: actor });

  assert.equal(actor.updates.length, 1);
  assert.equal(actor.system.recursos.nivel, 3);
  assert.equal(actor.system.atributos.resistencia, 2);
  assert.equal(actor.system.atributos.inteligencia, 3);
  assert.deepEqual(actor.system.vitales.hp, { value: 34, max: 40 });
  assert.deepEqual(actor.system.vitales.mp, { value: 51, max: 60 });
});

test("bajas simultáneas usan un único delta reconstruido y clampa recursos", async () => {
  const { updateActorPermanentResourcesAuthoritative } = await loadService();
  const actor = createActor({
    level: 3,
    resistance: 2,
    intelligence: 3,
    hpValue: 8,
    hpMax: 40,
    mpValue: 15,
    mpMax: 60
  });

  await updateActorPermanentResourcesAuthoritative({
    actorUuid: actor.uuid,
    transactionId: "compound-decrease",
    expected: { classId: "mago", level: 3, resistance: 2, intelligence: 3 },
    changes: { level: 2, resistance: 1, intelligence: 2 }
  }, { requestingUserId: "gm", trustedActor: actor });

  assert.equal(actor.updates.length, 1);
  assert.deepEqual(actor.system.vitales.hp, { value: 0, max: 25 });
  assert.deepEqual(actor.system.vitales.mp, { value: 0, max: 40 });
});

test("modifier positivo y reversión aplican delta una vez y son idempotentes por transactionId", async () => {
  const { updateActorResourceConfigurationAuthoritative } = await loadService();
  const actor = createActor();

  const addPayload = {
    actorUuid: actor.uuid,
    transactionId: "modifier-add",
    expectedClassId: "mago",
    changes: { hpModifier: 10, mpModifier: 5 }
  };
  await updateActorResourceConfigurationAuthoritative(addPayload, {
    requestingUserId: "gm",
    trustedActor: actor
  });
  const replay = await updateActorResourceConfigurationAuthoritative(addPayload, {
    requestingUserId: "gm",
    trustedActor: actor
  });

  assert.equal(replay.replayed, true);
  assert.equal(actor.updates.length, 1);
  assert.deepEqual(actor.system.vitales.hp, { value: 29, max: 35 });
  assert.deepEqual(actor.system.vitales.mp, { value: 36, max: 45 });

  await updateActorResourceConfigurationAuthoritative({
    actorUuid: actor.uuid,
    transactionId: "modifier-remove",
    expectedClassId: "mago",
    changes: { hpModifier: 0, mpModifier: 0 }
  }, { requestingUserId: "gm", trustedActor: actor });

  assert.equal(actor.updates.length, 2);
  assert.deepEqual(actor.system.vitales.hp, { value: 19, max: 25 });
  assert.deepEqual(actor.system.vitales.mp, { value: 31, max: 40 });
});

test("cambiar sólo labels escribe metadata una vez sin incluir paths vitales", async () => {
  const { updateActorResourceConfigurationAuthoritative } = await loadService();
  const actor = createActor();

  await updateActorResourceConfigurationAuthoritative({
    actorUuid: actor.uuid,
    transactionId: "labels-only",
    expectedClassId: "mago",
    changes: {
      hpModifierLabel: "Excepción HP",
      mpModifierLabel: "Excepción MP"
    }
  }, { requestingUserId: "gm", trustedActor: actor });

  assert.equal(actor.updates.length, 1);
  const paths = Object.keys(actor.updates[0].changes);
  assert.deepEqual(paths.sort(), [
    "system.resourceModifiers.hp.label",
    "system.resourceModifiers.mp.label"
  ]);
});

test("guard elimina classId/modifiers forjados y máximos manuales de un Actor activo", async () => {
  const { guardActorClassResourceUpdate } = await loadService();
  const actor = createActor();
  const changes = {
    "system.identidad.classId": "guerrero",
    "system.resourceModifiers.hp.value": 100,
    "system.vitales.hp.max": 999,
    "system.vitales.mp.max": 999,
    "system.vitales.hp.value": 7
  };

  const allowed = guardActorClassResourceUpdate(actor, changes, {}, "player");

  assert.equal(allowed, true);
  assert.deepEqual(changes, { "system.vitales.hp.value": 7 });
});

test("guard bloquea hp.max/mp.max manuales incluso para GM cuando classId está activo", async () => {
  const { guardActorClassResourceUpdate } = await loadService();
  const actor = createActor();
  const changes = {
    "system.vitales.hp.max": 999,
    "system.vitales.mp.max": 999
  };

  assert.equal(guardActorClassResourceUpdate(actor, changes, {}, "gm"), false);
  assert.deepEqual(changes, {});

  const internal = {
    "system.vitales.hp.max": 40,
    "system.vitales.mp.max": 60
  };
  assert.equal(guardActorClassResourceUpdate(actor, internal, {
    mtrolClassResourceTransition: true
  }, "gm"), true);
  assert.equal(internal["system.vitales.hp.max"], 40);
});

test("Actor legacy sin classId conserva edición manual de máximos", async () => {
  const { guardActorClassResourceUpdate } = await loadService();
  const actor = createActor({ classId: "", hpMax: 33, mpMax: 25 });
  actor.system.identidad.clase = "Mago";
  const changes = {
    "system.vitales.hp.max": 44,
    "system.vitales.mp.max": 55
  };

  assert.equal(guardActorClassResourceUpdate(actor, changes, {}, "gm"), true);
  assert.equal(changes["system.vitales.hp.max"], 44);
  assert.equal(changes["system.vitales.mp.max"], 55);
});

test("guard preserva mapas vacíos ajenos a recursos de clase", async () => {
  const { guardActorClassResourceUpdate } = await loadService();
  const actor = createActor();
  const changes = {
    flags: {
      mtrol: {
        mpStacks: {}
      }
    }
  };

  assert.equal(guardActorClassResourceUpdate(actor, changes, {}, "gm"), true);
  assert.deepEqual(changes, {
    flags: {
      mtrol: {
        mpStacks: {}
      }
    }
  });
});

test("backend de Sheet conserva edición GM de current pero reemplaza máximos manuales por la fórmula", async () => {
  const { updateActorFromSheetAuthoritative } = await loadService();
  const actor = createActor();

  await updateActorFromSheetAuthoritative(actor, {
    "system.recursos.nivel": 2,
    "system.atributos.resistencia": 1,
    "system.atributos.inteligencia": 2,
    "system.vitales.hp.value": 7,
    "system.vitales.hp.max": 999,
    "system.vitales.mp.value": 9,
    "system.vitales.mp.max": 999
  });

  assert.equal(actor.updates.length, 1);
  assert.deepEqual(actor.system.vitales.hp, { value: 7, max: 25 });
  assert.deepEqual(actor.system.vitales.mp, { value: 9, max: 40 });
});
