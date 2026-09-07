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
    items: [],
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
    async createEmbeddedDocuments(_type, entries) {
      const start = this.items.length;
      return entries.map((entry, index) => {
        const item = {
          ...structuredClone(entry),
          id: `class-item-${start + index + 1}`,
          uuid: `${this.uuid}.Item.class-item-${start + index + 1}`
        };
        this.items.push(item);
        return item;
      });
    },
    async deleteEmbeddedDocuments(_type, ids) {
      this.items = this.items.filter(item => !ids.includes(item.id));
    },
    async update(changes) {
      this.updates.push(structuredClone(changes));
      for (const [path, value] of Object.entries(changes)) {
        const parts = path.split(".");
        let cursor = this;
        for (const part of parts.slice(0, -1)) cursor = cursor[part] ??= {};
        cursor[parts.at(-1)] = structuredClone(value);
      }
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
  assert.deepEqual(
    actor.items.map(item => item.system.technicalId),
    ["magia", "simbologia", "meditar"]
  );
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

test("aplicar la misma Clase otra vez no duplica ni aumenta Competencias", async () => {
  const { updateActorResourceConfigurationAuthoritative } = await loadAuthority();
  const actor = createActor();

  await updateActorResourceConfigurationAuthoritative({
    actorUuid: actor.uuid,
    transactionId: "mago-first-application",
    expectedClassId: "",
    changes: { classId: "mago" }
  }, { requestingUserId: "gm", trustedActor: actor });
  actor.items.find(item => item.system.technicalId === "magia").system.nivel = 3;

  const second = await updateActorResourceConfigurationAuthoritative({
    actorUuid: actor.uuid,
    transactionId: "mago-second-application",
    expectedClassId: "mago",
    changes: { classId: "mago" }
  }, { requestingUserId: "gm", trustedActor: actor });

  assert.equal(actor.items.length, 3);
  assert.equal(actor.items.find(item => item.system.technicalId === "magia").system.nivel, 3);
  assert.deepEqual(second.classGrant.created, []);
});

test("cambiar de Mago a Guerrero conserva el historial y crea sólo faltantes", async () => {
  const { updateActorResourceConfigurationAuthoritative } = await loadAuthority();
  const actor = createActor();

  await updateActorResourceConfigurationAuthoritative({
    actorUuid: actor.uuid,
    transactionId: "history-mage",
    expectedClassId: "",
    changes: { classId: "mago" }
  }, { requestingUserId: "gm", trustedActor: actor });
  await updateActorResourceConfigurationAuthoritative({
    actorUuid: actor.uuid,
    transactionId: "history-warrior",
    expectedClassId: "mago",
    changes: { classId: "guerrero" }
  }, { requestingUserId: "gm", trustedActor: actor });

  assert.deepEqual(
    actor.items.map(item => item.system.technicalId),
    ["magia", "simbologia", "meditar", "combate_con_armas", "defensa_con_escudos", "supervivencia"]
  );
});

test("Aprendiz persiste domain explícito y tres elecciones canónicas", async () => {
  const { updateActorResourceConfigurationAuthoritative } = await loadAuthority();
  const actor = createActor();

  const result = await updateActorResourceConfigurationAuthoritative({
    actorUuid: actor.uuid,
    transactionId: "apprentice-application",
    expectedClassId: "",
    changes: {
      classId: "aprendiz",
      classDomain: "hybrid",
      competencySelections: ["magia", "medicina", "evasion"]
    }
  }, { requestingUserId: "gm", trustedActor: actor });

  assert.equal(actor.system.identidad.classId, "aprendiz");
  assert.equal(actor.system.identidad.classDomain, "hybrid");
  assert.deepEqual(result.classGrant.created, ["magia", "medicina", "evasion"]);
  assert.ok(actor.items.every(item => item.system.nivel === 1));
});

test("Aprendiz rechaza domain o selección inválidos antes de escribir", async () => {
  const { updateActorResourceConfigurationAuthoritative } = await loadAuthority();
  for (const changes of [
    { classId: "aprendiz", classDomain: "elemental", competencySelections: ["magia", "medicina", "evasion"] },
    { classId: "aprendiz", classDomain: "physical", competencySelections: ["magia", "magia", "evasion"] },
    { classId: "aprendiz", classDomain: "physical", competencySelections: ["magia", "medicina"] },
    { classId: "aprendiz", classDomain: "physical", competencySelections: ["magia", "medicina", "inexistente"] }
  ]) {
    const actor = createActor();
    await assert.rejects(updateActorResourceConfigurationAuthoritative({
      actorUuid: actor.uuid,
      transactionId: `invalid-apprentice-${JSON.stringify(changes)}`,
      expectedClassId: "",
      changes
    }, { requestingUserId: "gm", trustedActor: actor }));
    assert.equal(actor.items.length, 0);
    assert.equal(actor.updates.length, 0);
  }
});

test("si falla la persistencia de Clase revierte únicamente las Competencias recién creadas", async () => {
  const { updateActorResourceConfigurationAuthoritative } = await loadAuthority();
  const actor = createActor();
  actor.update = async () => {
    throw new Error("fallo de Actor.update");
  };

  await assert.rejects(updateActorResourceConfigurationAuthoritative({
    actorUuid: actor.uuid,
    transactionId: "class-update-rollback",
    expectedClassId: "",
    changes: { classId: "mago" }
  }, { requestingUserId: "gm", trustedActor: actor }), /fallo de Actor\.update/);

  assert.equal(actor.items.length, 0);
  assert.equal(actor.system.identidad.classId, "");
});
