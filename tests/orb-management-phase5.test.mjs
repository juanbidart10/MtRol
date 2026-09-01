import test from "node:test";
import assert from "node:assert/strict";

const users = new Map([
  ["gm", { id: "gm", isGM: true, active: true }],
  ["player", { id: "player", isGM: false, active: true }]
]);

globalThis.game = {
  user: users.get("gm"),
  users
};
globalThis.foundry = {
  utils: {
    randomID: () => "generated-orb-id"
  }
};
globalThis.fromUuid = async () => null;

const {
  addActorOrbAuthoritative,
  deleteActorOrbAuthoritative,
  resetOrbManagementServiceForTests,
  updateActorOrbAuthoritative
} = await import("../scripts/progression/orb-management-service.js");

const {
  guardActorOrbUpdate,
  guardCompetenciaOrbUpdate
} = await import("../scripts/progression/orb-authority.js");

function applyPath(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) cursor = cursor[part] ??= {};
  cursor[parts.at(-1)] = structuredClone(value);
}

function createActor(orbs = []) {
  const actor = {
    id: "actor",
    uuid: "Actor.actor",
    system: { orbs: structuredClone(orbs) },
    updates: [],
    async update(changes) {
      actor.updates.push(structuredClone(changes));
      for (const [path, value] of Object.entries(changes)) {
        applyPath(actor, path, value);
      }
      return actor;
    }
  };
  return actor;
}

test.beforeEach(() => {
  game.user = users.get("gm");
  resetOrbManagementServiceForTests();
});

test("agrega primer y segundo Orbe sin sobrescribir ni cambiar IDs", async () => {
  const actor = createActor();

  await addActorOrbAuthoritative({
    actorUuid: actor.uuid,
    transactionId: "add-ignis",
    orbId: "orb-ignis",
    type: "ignis",
    level: 5,
    expectedOrbCount: 0
  }, { requestingUserId: "gm", trustedActor: actor });

  await addActorOrbAuthoritative({
    actorUuid: actor.uuid,
    transactionId: "add-aqua",
    orbId: "orb-aqua",
    type: "aqua",
    level: 4,
    expectedOrbCount: 1
  }, { requestingUserId: "gm", trustedActor: actor });

  assert.deepEqual(actor.system.orbs, [
    { id: "orb-ignis", type: "ignis", level: 5 },
    { id: "orb-aqua", type: "aqua", level: 4 }
  ]);
});

test("edita un Orbe por ID estable sin tocar el otro", async () => {
  const actor = createActor([
    { id: "orb-ignis", type: "ignis", level: 3 },
    { id: "orb-aqua", type: "aqua", level: 4 }
  ]);

  await updateActorOrbAuthoritative({
    actorUuid: actor.uuid,
    transactionId: "edit-ignis",
    orbId: "orb-ignis",
    type: "ignis",
    level: 5,
    expectedType: "ignis",
    expectedLevel: 3
  }, { requestingUserId: "gm", trustedActor: actor });

  assert.deepEqual(actor.system.orbs, [
    { id: "orb-ignis", type: "ignis", level: 5 },
    { id: "orb-aqua", type: "aqua", level: 4 }
  ]);
});

test("elimina por ID estable y el replay no produce una segunda escritura", async () => {
  const actor = createActor([
    { id: "orb-ignis", type: "ignis", level: 5 },
    { id: "orb-aqua", type: "aqua", level: 4 }
  ]);
  const payload = {
    actorUuid: actor.uuid,
    transactionId: "delete-ignis",
    orbId: "orb-ignis",
    expectedType: "ignis",
    expectedLevel: 5
  };

  const first = await deleteActorOrbAuthoritative(payload, {
    requestingUserId: "gm",
    trustedActor: actor
  });
  const replay = await deleteActorOrbAuthoritative(payload, {
    requestingUserId: "gm",
    trustedActor: actor
  });

  assert.deepEqual(actor.system.orbs, [
    { id: "orb-aqua", type: "aqua", level: 4 }
  ]);
  assert.equal(actor.updates.length, 1);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
});

test("doble alta no duplica tipo y sólo el GM administra", async () => {
  const actor = createActor([
    { id: "orb-ignis", type: "ignis", level: 5 }
  ]);

  await assert.rejects(
    addActorOrbAuthoritative({
      actorUuid: actor.uuid,
      transactionId: "duplicate-type",
      orbId: "another-id",
      type: "ignis",
      level: 1,
      expectedOrbCount: 1
    }, { requestingUserId: "gm", trustedActor: actor }),
    /ya posee un Orbe Ignis/i
  );

  await assert.rejects(
    updateActorOrbAuthoritative({
      actorUuid: actor.uuid,
      transactionId: "player-edit",
      orbId: "orb-ignis",
      type: "ignis",
      level: 4,
      expectedType: "ignis",
      expectedLevel: 5
    }, { requestingUserId: "player", trustedActor: actor }),
    /Sólo un GM/i
  );

  assert.equal(actor.updates.length, 0);
});

test("rechaza tipos arbitrarios, niveles fuera de 1–5 y snapshots alterados", async () => {
  const actor = createActor([
    { id: "orb-ignis", type: "ignis", level: 5 }
  ]);

  await assert.rejects(
    addActorOrbAuthoritative({
      actorUuid: actor.uuid,
      transactionId: "bad-type",
      orbId: "bad",
      type: "fuego",
      level: 1,
      expectedOrbCount: 1
    }, { requestingUserId: "gm", trustedActor: actor }),
    /tipo de Orbe/i
  );
  await assert.rejects(
    addActorOrbAuthoritative({
      actorUuid: actor.uuid,
      transactionId: "bad-level",
      orbId: "bad-level",
      type: "aqua",
      level: 6,
      expectedOrbCount: 1
    }, { requestingUserId: "gm", trustedActor: actor }),
    /nivel de Orbe/i
  );
  await assert.rejects(
    deleteActorOrbAuthoritative({
      actorUuid: actor.uuid,
      transactionId: "stale-delete",
      orbId: "orb-ignis",
      expectedType: "ignis",
      expectedLevel: 4
    }, { requestingUserId: "gm", trustedActor: actor }),
    /cambió/i
  );
  assert.equal(actor.updates.length, 0);
});

test("guards de documento bloquean mutación directa de Orbes y orbType al jugador", () => {
  assert.equal(
    guardActorOrbUpdate({ "system.orbs": [] }, { requestingUserId: "player" }),
    false
  );
  assert.equal(
    guardActorOrbUpdate({ system: { orbs: [] } }, { requestingUserId: "player" }),
    false
  );
  assert.equal(
    guardCompetenciaOrbUpdate(
      { type: "competencia" },
      { "system.orbType": "ignis" },
      { requestingUserId: "player" }
    ),
    false
  );
  assert.equal(
    guardActorOrbUpdate({
      "system.orbs": [{ id: "stable", type: "ignis", level: 5 }]
    }, { requestingUserId: "gm" }),
    true
  );
  assert.equal(
    guardActorOrbUpdate({
      "system.orbs": [
        { id: "one", type: "ignis", level: 5 },
        { id: "two", type: "ignis", level: 4 }
      ]
    }, { requestingUserId: "gm" }),
    false
  );
  assert.equal(
    guardCompetenciaOrbUpdate(
      { type: "competencia" },
      { "system.orbType": "fuego" },
      { requestingUserId: "gm" }
    ),
    false
  );
  assert.equal(
    guardActorOrbUpdate({ "system.orbs.0.level": 6 }, { requestingUserId: "player" }),
    false
  );
  assert.equal(
    guardCompetenciaOrbUpdate(
      { type: "competencia" },
      { "system.-=orbType": null },
      { requestingUserId: "player" }
    ),
    false
  );
});
