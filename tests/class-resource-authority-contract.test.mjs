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
  utils: { randomID: () => "resource-config-transaction" }
};

const actors = new Map();
globalThis.fromUuid = async uuid => actors.get(uuid) ?? null;

function createActor() {
  const actor = {
    uuid: "Actor.class-resource-contract",
    system: {
      identidad: { clase: "Mago", classId: "" },
      recursos: { nivel: 3 },
      atributos: { resistencia: 2, inteligencia: 4 },
      vitales: {
        hp: { value: 27, max: 30 },
        mp: { value: 19, max: 25 }
      },
      resourceModifiers: {
        hp: { value: 0, label: "" },
        mp: { value: 0, label: "" }
      }
    },
    updates: [],
    async update(changes) {
      this.updates.push(structuredClone(changes));
    }
  };
  actors.set(actor.uuid, actor);
  return actor;
}

async function loadAuthority() {
  return import("../scripts/actors/class-resource-service.js");
}

test("GM puede seleccionar classId y la operación produce una sola Actor.update", async () => {
  const { updateActorResourceConfigurationAuthoritative } = await loadAuthority();
  const actor = createActor();
  const payload = {
    actorUuid: actor.uuid,
    transactionId: "gm-select-class",
    expectedClassId: "",
    changes: { classId: "mago" }
  };

  await updateActorResourceConfigurationAuthoritative(payload, { requestingUserId: "gm" });
  const replay = await updateActorResourceConfigurationAuthoritative(payload, {
    requestingUserId: "gm"
  });

  assert.equal(replay.replayed, true);
  assert.equal(actor.updates.length, 1);
  assert.equal(actor.updates[0]["system.identidad.classId"], "mago");
  assert.equal(actor.updates[0]["system.vitales.hp.value"], 37);
  assert.equal(actor.updates[0]["system.vitales.hp.max"], 40);
  assert.equal(actor.updates[0]["system.vitales.mp.value"], 64);
  assert.equal(actor.updates[0]["system.vitales.mp.max"], 70);
});

test("no-GM no puede forzar classId mediante payload directo", async () => {
  const { updateActorResourceConfigurationAuthoritative } = await loadAuthority();
  const actor = createActor();

  await assert.rejects(updateActorResourceConfigurationAuthoritative({
    actorUuid: actor.uuid,
    transactionId: "forged-class",
    expectedClassId: "",
    changes: { classId: "mago" }
  }, { requestingUserId: "player" }), /GM/);
  assert.equal(actor.updates.length, 0);
});

test("GM puede editar modifiers y labels; no-GM no puede forzarlos", async () => {
  const { updateActorResourceConfigurationAuthoritative } = await loadAuthority();
  const actor = createActor();
  actor.system.identidad.classId = "mago";

  await updateActorResourceConfigurationAuthoritative({
    actorUuid: actor.uuid,
    transactionId: "gm-modifiers",
    expectedClassId: "mago",
    changes: {
      hpModifier: 10,
      hpModifierLabel: "Excepción narrativa",
      mpModifier: -5,
      mpModifierLabel: "Otra excepción"
    }
  }, { requestingUserId: "gm" });
  assert.equal(actor.updates.length, 1);

  await assert.rejects(updateActorResourceConfigurationAuthoritative({
    actorUuid: actor.uuid,
    transactionId: "forged-modifiers",
    expectedClassId: "mago",
    changes: { hpModifier: 999, mpModifier: 999 }
  }, { requestingUserId: "player" }), /GM/);
  assert.equal(actor.updates.length, 1);
});

test("GM persiste múltiples modificadores y aplica la suma de HP/MP en una sola transición", async () => {
  const { updateActorResourceConfigurationAuthoritative } = await loadAuthority();
  const actor = createActor();
  actor.system.identidad.classId = "mago";

  await updateActorResourceConfigurationAuthoritative({
    actorUuid: actor.uuid,
    transactionId: "gm-multiple-modifiers",
    expectedClassId: "mago",
    changes: {
      resourceModifierEntries: [
        {
          id: "shield",
          hp: { value: -10, label: "Escudo de vida" },
          mp: { value: 100, label: "Reserva arcana" }
        },
        {
          id: "blessing",
          hp: { value: 15, label: "Bendición" },
          mp: { value: -90, label: "Coste permanente" }
        }
      ]
    }
  }, { requestingUserId: "gm" });

  assert.equal(actor.updates.length, 1);
  assert.equal(actor.updates[0]["system.resourceModifiers.hp.value"], 5);
  assert.equal(actor.updates[0]["system.resourceModifiers.mp.value"], 10);
  assert.equal(actor.updates[0]["system.resourceModifiers.hp.label"], "Escudo de vida; Bendición");
  assert.equal(actor.updates[0]["system.vitales.hp.max"], 45);
  assert.equal(actor.updates[0]["system.vitales.mp.max"], 80);
});
