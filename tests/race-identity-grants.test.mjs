import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

globalThis.game = {
  user: { id: "gm", isGM: true },
  users: [
    { id: "gm", isGM: true, active: true },
    { id: "owner", isGM: false, active: true }
  ],
  combat: null
};
globalThis.foundry = { utils: { randomID: () => "race-test-id" } };

const actors = new Map();
globalThis.fromUuid = async uuid => actors.get(uuid) ?? null;

function createActor({ raceId = "gnomo", grant = null, attributes = {} } = {}) {
  const actor = {
    id: `race-${actors.size + 1}`,
    uuid: `Actor.race-${actors.size + 1}`,
    system: {
      identidad: { raceId, raza: raceId ? "Gnomo" : "" },
      atributos: {
        resistencia: 2, carisma: 2, fuerza: 2, inteligencia: 2, voluntad: 2,
        aura: 2, percepcion: 2, destreza: 2, suerte: 2,
        ...attributes
      },
      raceCreationGrant: grant ?? { applied: false, sourceRaceId: "" }
    },
    updates: [],
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

const {
  applyRaceCreationBenefitsAuthoritative,
  guardActorRaceUpdate,
  updateActorRaceIdentityAuthoritative
} = await import("../scripts/actors/race-service.js");

test("Gnomo aplica sus tres atributos exactamente una vez aun con transactionId nuevo", async () => {
  const actor = createActor();
  const first = await applyRaceCreationBenefitsAuthoritative({
    actorUuid: actor.uuid, transactionId: "gnome-first", expectedRaceId: "gnomo"
  }, { requestingUserId: "gm", trustedActor: actor });
  const second = await applyRaceCreationBenefitsAuthoritative({
    actorUuid: actor.uuid, transactionId: "gnome-second", expectedRaceId: "gnomo"
  }, { requestingUserId: "gm", trustedActor: actor });

  assert.equal(first.applied, true);
  assert.equal(second.alreadyApplied, true);
  assert.equal(actor.system.atributos.aura, 3);
  assert.equal(actor.system.atributos.percepcion, 3);
  assert.equal(actor.system.atributos.inteligencia, 3);
  assert.equal(actor.system.raceCreationGrant.sourceRaceId, "gnomo");
  assert.equal(actor.updates.length, 1);
});

test("cambiar Gnomo → Elfo → Gnomo sólo modifica identidad y conserva el grant histórico", async () => {
  const actor = createActor();
  await applyRaceCreationBenefitsAuthoritative({
    actorUuid: actor.uuid, transactionId: "history-grant", expectedRaceId: "gnomo"
  }, { requestingUserId: "gm", trustedActor: actor });
  await updateActorRaceIdentityAuthoritative({
    actorUuid: actor.uuid, transactionId: "to-elf", expectedRaceId: "gnomo", raceId: "elfo"
  }, { requestingUserId: "gm", trustedActor: actor });
  await updateActorRaceIdentityAuthoritative({
    actorUuid: actor.uuid, transactionId: "back-gnome", expectedRaceId: "elfo", raceId: "gnomo"
  }, { requestingUserId: "gm", trustedActor: actor });

  assert.equal(actor.system.atributos.aura, 3);
  assert.equal(actor.system.atributos.percepcion, 3);
  assert.equal(actor.system.atributos.inteligencia, 3);
  assert.equal(actor.system.raceCreationGrant.sourceRaceId, "gnomo");
  assert.equal(actor.system.identidad.raceId, "gnomo");
  assert.equal(actor.updates.length, 3);
});

test("Orco que llevaría Fuerza 4→6 rechaza toda la operación sin clamp ni aplicación parcial", async () => {
  const actor = createActor({ raceId: "orco", attributes: { fuerza: 4, resistencia: 2 } });
  actor.system.identidad.raza = "Orco";
  await assert.rejects(applyRaceCreationBenefitsAuthoritative({
    actorUuid: actor.uuid, transactionId: "orc-cap", expectedRaceId: "orco"
  }, { requestingUserId: "gm", trustedActor: actor }), error => {
    assert.equal(error.reasonCode, "RACE_CREATION_ATTRIBUTE_CAP_EXCEEDED");
    return true;
  });
  assert.equal(actor.system.atributos.fuerza, 4);
  assert.equal(actor.system.atributos.resistencia, 2);
  assert.equal(actor.system.raceCreationGrant.applied, false);
  assert.equal(actor.updates.length, 0);
});

test("Eterno usa cap efectivo 10 durante sus beneficios raciales", async () => {
  const actor = createActor({
    raceId: "eterno",
    attributes: { resistencia: 4, inteligencia: 4, voluntad: 4 }
  });
  actor.system.identidad.raza = "Eterno";
  await applyRaceCreationBenefitsAuthoritative({
    actorUuid: actor.uuid,
    transactionId: "eternal-creation-cap",
    expectedRaceId: "eterno"
  }, { requestingUserId: "gm", trustedActor: actor });
  assert.equal(actor.system.atributos.resistencia, 6);
  assert.equal(actor.system.atributos.inteligencia, 6);
  assert.equal(actor.system.atributos.voluntad, 6);
});

test("Owner no puede cambiar Raza ni aplicar grants; GM sí", async () => {
  const actor = createActor({ raceId: "" });
  await assert.rejects(updateActorRaceIdentityAuthoritative({
    actorUuid: actor.uuid, transactionId: "owner-race", expectedRaceId: "", raceId: "elfo"
  }, { requestingUserId: "owner", trustedActor: actor }), /GM/);
  await assert.rejects(applyRaceCreationBenefitsAuthoritative({
    actorUuid: actor.uuid, transactionId: "owner-grant", expectedRaceId: ""
  }, { requestingUserId: "owner", trustedActor: actor }), /GM/);
  await updateActorRaceIdentityAuthoritative({
    actorUuid: actor.uuid, transactionId: "gm-race", expectedRaceId: "", raceId: "elfo"
  }, { requestingUserId: "gm", trustedActor: actor });
  assert.equal(actor.system.identidad.raceId, "elfo");
});

test("el guard elimina mutaciones directas de identidad/marker y la Sheet sólo delega", async () => {
  const changes = {
    "system.identidad.raceId": "eterno",
    "system.identidad.raza": "Eterno",
    "system.raceCreationGrant.applied": true,
    "system.identidad.titulo": "Permitido"
  };
  assert.equal(guardActorRaceUpdate(null, changes, {}), true);
  assert.deepEqual(changes, { "system.identidad.titulo": "Permitido" });

  const sheet = await readFile(new URL("../scripts/sheets/actors/personaje-sheet.js", import.meta.url), "utf8");
  assert.match(sheet, /updateActorRaceIdentityAuthoritative/);
  assert.match(sheet, /applyRaceCreationBenefitsAuthoritative/);
  assert.doesNotMatch(sheet, /system\.atributos\.\$\{attribute\}/);
});
