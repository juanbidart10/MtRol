import test from "node:test";
import assert from "node:assert/strict";

globalThis.foundry = {
  utils: {
    randomID: () => "generated-transaction"
  }
};

globalThis.game = {
  user: { id: "gm", isGM: true },
  users: [
    { id: "gm", isGM: true, active: true },
    { id: "player", isGM: false, active: true },
    { id: "stranger", isGM: false, active: true }
  ]
};

const actors = new Map();
globalThis.fromUuid = async uuid => actors.get(uuid) ?? null;

const { resetActorResourceServiceForTests } =
  await import("../scripts/actors/actor-resource-service.js");
const {
  levelUpActorAuthoritative,
  spendPendingAttributePointAuthoritative,
  spendPendingCompetencePointAuthoritative
} = await import("../scripts/actors/progression-advancement-service.js");

const ATTRIBUTES = [
  "resistencia", "carisma", "fuerza", "inteligencia", "voluntad",
  "aura", "percepcion", "destreza", "suerte"
];

function setPath(target, path, value) {
  const parts = path.replace(/^system\./, "").split(".");
  let cursor = target.system;
  for (const part of parts.slice(0, -1)) cursor = cursor[part] ??= {};
  cursor[parts.at(-1)] = value;
}

function requirementsFor(level) {
  if (level === 1) return { exp: 1000, mvp: 1, missions: 1, attrs: 0, skills: [3] };
  if (level === 2) return { exp: 15000, mvp: 20, dungeons: 1, merit: 5, attrs: 2, skills: [5, 5] };
  if (level === 3) return { exp: 30000, mvp: 30, missions: 5, approval: true, attrs: 4, skills: [5, 5, 5, 5] };
  if (level === 4) return { exp: 50000, mvp: 50, missions: 10, enemy: true, approval: true, attrs: 7, skills: [5, 5, 5, 5, 5, 5, 5] };
  return { exp: 90000, mvp: 90, attrs: 9, skills: [5, 5, 5, 5, 5, 5, 5, 5, 5] };
}

function createActor({
  level = 1,
  expExtra = 0,
  mvpExtra = 0,
  eligible = true,
  hpValue = 4,
  hpMax = 20,
  mpValue = 30,
  mpMax = 100,
  attributePoints = 0,
  competencePoints = 0,
  classId = undefined,
  raceId = ""
} = {}) {
  const req = requirementsFor(level);
  const items = (req.skills ?? []).map((nivel, index) => ({
    id: `skill-${index}`,
    uuid: `Actor.hero.Item.skill-${index}`,
    type: "competencia",
    system: { nivel, categoria: "competencia", tipo: "" },
    updates: [],
    async update(changes) {
      this.updates.push(structuredClone(changes));
      if ("system.nivel" in changes) this.system.nivel = changes["system.nivel"];
    }
  }));
  items.get = id => items.find(item => item.id === id) ?? null;

  const actor = {
    id: "hero",
    uuid: "Actor.hero",
    system: {
      identidad: classId === undefined
        ? { clase: "Mago", raceId }
        : { clase: "Mago", classId, raceId },
      recursos: {
        nivel: level,
        exp: req.exp + expExtra - (eligible ? 0 : 1),
        mvp: req.mvp + mvpExtra
      },
      vitales: {
        hp: { value: hpValue, max: hpMax },
        mp: { value: mpValue, max: mpMax }
      },
      progression: {
        missionsCompleted: req.missions ?? 0,
        dungeonsCompleted: req.dungeons ?? 0,
        meritCredits: req.merit ?? 0,
        defeatedLevel5Enemy: req.enemy ?? false,
        dmApproval: req.approval ?? false
      },
      pendingAdvancement: { attributePoints, competencePoints },
      orbs: [{ id: "orb-preserved", type: "test" }],
      alignment: { type: "tanque", unlocked: true },
      atributos: Object.fromEntries(
        ATTRIBUTES.map((key, index) => [key, index < (req.attrs ?? 0) ? 5 : 4])
      )
    },
    items,
    updates: [],
    testUserPermission(user, permission) {
      return user.id === "player" && permission === "OWNER";
    },
    async update(changes) {
      this.updates.push(structuredClone(changes));
      for (const [path, value] of Object.entries(changes)) setPath(this, path, value);
    }
  };

  actors.set(actor.uuid, actor);
  return actor;
}

function levelPayload(actor, transactionId = `level-${actor.system.recursos.nivel}`) {
  return {
    actorUuid: actor.uuid,
    transactionId,
    expectedLevel: actor.system.recursos.nivel
  };
}

test.beforeEach(() => {
  actors.clear();
  resetActorResourceServiceForTests();
  game.user = game.users[0];
});

for (const level of [1, 2, 3, 4]) {
  test(`level-up autoritativo ${level}→${level + 1} descuenta y aumenta exactamente`, async () => {
    const actor = createActor({ level, expExtra: 3750, mvpExtra: 7 });
    const before = structuredClone(actor.system);

    const receipt = await levelUpActorAuthoritative(levelPayload(actor), {
      requestingUserId: "gm"
    });

    assert.equal(actor.system.recursos.nivel, level + 1);
    assert.equal(actor.system.recursos.exp, 3750);
    assert.equal(actor.system.recursos.mvp, 7);
    assert.equal(actor.system.vitales.hp.value, before.vitales.hp.value + 10);
    assert.equal(actor.system.vitales.hp.max, before.vitales.hp.max + 10);
    assert.equal(actor.system.vitales.mp.value, before.vitales.mp.value + 10);
    assert.equal(actor.system.vitales.mp.max, before.vitales.mp.max + 10);
    assert.equal(actor.system.pendingAdvancement.attributePoints, 1);
    assert.equal(actor.system.pendingAdvancement.competencePoints, 1);
    assert.deepEqual(actor.system.progression, before.progression);
    assert.deepEqual(actor.system.orbs, before.orbs);
    assert.deepEqual(actor.system.alignment, before.alignment);
    assert.equal(actor.updates.length, 1);
    assert.equal(actor.updates[0]["system.progression.missionsCompleted"], before.progression.missionsCompleted);
    assert.equal(actor.updates[0]["system.progression.dmApproval"], before.progression.dmApproval);
    assert.equal(receipt.replayed, false);
  });
}

test("Actor no elegible no recibe escrituras parciales", async () => {
  const actor = createActor({ level: 2, eligible: false });
  const before = structuredClone(actor.system);

  await assert.rejects(levelUpActorAuthoritative(levelPayload(actor), {
    requestingUserId: "gm"
  }), /requisitos/);

  assert.deepEqual(actor.system, before);
  assert.equal(actor.updates.length, 0);
});

test("jugador no puede ejecutar level-up aunque sea Owner", async () => {
  const actor = createActor({ level: 1 });

  await assert.rejects(levelUpActorAuthoritative(levelPayload(actor), {
    requestingUserId: "player"
  }), /GM/);
  assert.equal(actor.updates.length, 0);
});

test("Nivel 5 se rechaza sin modificaciones", async () => {
  const actor = createActor({ level: 5 });

  await assert.rejects(levelUpActorAuthoritative(levelPayload(actor), {
    requestingUserId: "gm"
  }), /máximo/);
  assert.equal(actor.updates.length, 0);
});

test("misma transacción y doble click con otro ID producen un único ascenso", async () => {
  const actor = createActor({ level: 1, expExtra: 50000, mvpExtra: 50 });
  const payload = levelPayload(actor, "same-level-up");

  const first = await levelUpActorAuthoritative(payload, { requestingUserId: "gm" });
  const replay = await levelUpActorAuthoritative(payload, { requestingUserId: "gm" });
  await assert.rejects(levelUpActorAuthoritative({ ...payload, transactionId: "second-click" }, {
    requestingUserId: "gm"
  }), /cambió/);

  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(actor.system.recursos.nivel, 2);
  assert.equal(actor.updates.length, 1);
});

test("pending existente se acumula con el ascenso", async () => {
  const actor = createActor({ level: 1, attributePoints: 1, competencePoints: 1 });
  await levelUpActorAuthoritative(levelPayload(actor), { requestingUserId: "gm" });

  assert.deepEqual(actor.system.pendingAdvancement, {
    attributePoints: 2,
    competencePoints: 2
  });
});

test("Prodigio duplica sólo la ganancia pendiente de Competencia", async () => {
  const actor = createActor({ level: 1, raceId: "humano" });
  const receipt = await levelUpActorAuthoritative(levelPayload(actor, "prodigio-level"), {
    requestingUserId: "gm"
  });
  assert.equal(actor.system.pendingAdvancement.competencePoints, 2);
  assert.equal(actor.system.pendingAdvancement.attributePoints, 1);
  assert.equal(receipt.competencePointGain, 2);
  assert.ok(actor.items.every(item => item.updates.length === 0), "no aumenta directamente niveles de Competencia");
});

test("Infinito duplica sólo la ganancia pendiente de atributo", async () => {
  const actor = createActor({ level: 1, raceId: "eterno" });
  const before = structuredClone(actor.system.vitales);
  const receipt = await levelUpActorAuthoritative(levelPayload(actor, "infinito-level"), {
    requestingUserId: "gm"
  });
  assert.equal(actor.system.pendingAdvancement.attributePoints, 2);
  assert.equal(actor.system.pendingAdvancement.competencePoints, 1);
  assert.equal(receipt.attributePointGain, 2);
  assert.equal(actor.system.vitales.hp.max - before.hp.max, 10);
  assert.equal(actor.system.vitales.mp.max - before.mp.max, 10);
});

test("Actor legacy sin classId sube de nivel con un único +10/+10 sin reconstrucción de Clase", async () => {
  const actor = createActor({
    level: 2,
    hpValue: 24,
    hpMax: 40,
    mpValue: 13,
    mpMax: 30,
    classId: undefined
  });
  const before = structuredClone(actor.system.vitales);

  await levelUpActorAuthoritative(levelPayload(actor, "legacy-no-class-level-up"), {
    requestingUserId: "gm"
  });

  assert.equal(Object.hasOwn(actor.system.identidad, "classId"), false);
  assert.deepEqual(actor.system.vitales.hp, {
    value: before.hp.value + 10,
    max: before.hp.max + 10
  });
  assert.deepEqual(actor.system.vitales.mp, {
    value: before.mp.value + 10,
    max: before.mp.max + 10
  });
  assert.equal(actor.updates.length, 1);
});

test("level-up con classId activo mantiene delta global exactamente +10/+10", async () => {
  const actor = createActor({
    level: 2,
    hpValue: 24,
    hpMax: 40,
    mpValue: 13,
    mpMax: 30,
    classId: "mago"
  });
  actor.system.atributos.resistencia = 4;
  actor.system.atributos.inteligencia = 1;
  actor.system.atributos.fuerza = 5;
  const before = structuredClone(actor.system.vitales);

  await levelUpActorAuthoritative(levelPayload(actor, "active-class-level-up"), {
    requestingUserId: "gm"
  });

  assert.equal(actor.system.vitales.hp.value - before.hp.value, 10);
  assert.equal(actor.system.vitales.hp.max - before.hp.max, 10);
  assert.equal(actor.system.vitales.mp.value - before.mp.value, 10);
  assert.equal(actor.system.vitales.mp.max - before.mp.max, 10);
  assert.equal(actor.updates.length, 1);
});

test("Owner mejora Resistencia con classId activo y el GM aplica también la transición HP", async () => {
  const actor = createActor({
    attributePoints: 1,
    hpValue: 24,
    hpMax: 30,
    mpValue: 30,
    mpMax: 30,
    classId: "guerrero"
  });
  actor.system.atributos.resistencia = 2;

  await spendPendingAttributePointAuthoritative({
    actorUuid: actor.uuid,
    transactionId: "owner-resistance-transition",
    attributeKey: "resistencia",
    expectedValue: 2,
    expectedPendingPoints: 1
  }, { requestingUserId: "player" });

  assert.equal(actor.system.atributos.resistencia, 3);
  assert.deepEqual(actor.system.vitales.hp, { value: 34, max: 40 });
  assert.equal(actor.system.pendingAdvancement.attributePoints, 0);
  assert.equal(actor.updates.length, 1);
});

test("Owner mejora Inteligencia con classId activo y el GM aplica también la transición MP", async () => {
  const actor = createActor({
    attributePoints: 1,
    mpValue: 18,
    mpMax: 30,
    hpValue: 4,
    hpMax: 30,
    classId: "mago"
  });
  actor.system.atributos.inteligencia = 2;

  await spendPendingAttributePointAuthoritative({
    actorUuid: actor.uuid,
    transactionId: "owner-intelligence-transition",
    attributeKey: "inteligencia",
    expectedValue: 2,
    expectedPendingPoints: 1
  }, { requestingUserId: "player" });

  assert.equal(actor.system.atributos.inteligencia, 3);
  assert.deepEqual(actor.system.vitales.mp, { value: 28, max: 40 });
  assert.equal(actor.system.pendingAdvancement.attributePoints, 0);
  assert.equal(actor.updates.length, 1);
});

test("Owner mejora Resistencia mágica y recibe exactamente +5 HP", async () => {
  const actor = createActor({
    level: 2,
    attributePoints: 1,
    hpValue: 24,
    hpMax: 30,
    mpValue: 30,
    mpMax: 60,
    classId: "mago"
  });
  actor.system.atributos.resistencia = 2;
  actor.system.atributos.inteligencia = 4;

  await spendPendingAttributePointAuthoritative({
    actorUuid: actor.uuid,
    transactionId: "owner-magic-resistance-transition",
    attributeKey: "resistencia",
    expectedValue: 2,
    expectedPendingPoints: 1
  }, { requestingUserId: "player" });

  assert.deepEqual(actor.system.vitales.hp, { value: 29, max: 35 });
  assert.equal(actor.updates.length, 1);
});

test("Owner mejora Inteligencia física y recibe exactamente +5 MP", async () => {
  const actor = createActor({
    attributePoints: 1,
    hpValue: 24,
    hpMax: 50,
    mpValue: 18,
    mpMax: 30,
    classId: "guerrero"
  });
  actor.system.atributos.resistencia = 4;
  actor.system.atributos.inteligencia = 4;

  await spendPendingAttributePointAuthoritative({
    actorUuid: actor.uuid,
    transactionId: "owner-physical-intelligence-transition",
    attributeKey: "inteligencia",
    expectedValue: 4,
    expectedPendingPoints: 1
  }, { requestingUserId: "player" });

  assert.deepEqual(actor.system.vitales.mp, { value: 23, max: 35 });
  assert.equal(actor.updates.length, 1);
});

test("Owner mejora Resistencia e Inteligencia legacy sin classId sin recalcular HP/MP", async () => {
  const actor = createActor({
    attributePoints: 2,
    hpValue: 17,
    hpMax: 33,
    mpValue: 19,
    mpMax: 27,
    classId: undefined
  });
  const vitalsBefore = structuredClone(actor.system.vitales);

  await spendPendingAttributePointAuthoritative({
    actorUuid: actor.uuid,
    transactionId: "legacy-resistance",
    attributeKey: "resistencia",
    expectedValue: actor.system.atributos.resistencia,
    expectedPendingPoints: 2
  }, { requestingUserId: "player" });

  await spendPendingAttributePointAuthoritative({
    actorUuid: actor.uuid,
    transactionId: "legacy-intelligence",
    attributeKey: "inteligencia",
    expectedValue: actor.system.atributos.inteligencia,
    expectedPendingPoints: 1
  }, { requestingUserId: "player" });

  assert.deepEqual(actor.system.vitales, vitalsBefore);
  assert.equal(actor.system.pendingAdvancement.attributePoints, 0);
  assert.equal(actor.updates.length, 2, "una escritura por cada intención pending independiente");
});

test("Owner gasta un punto de atributo 4→5", async () => {
  const actor = createActor({ attributePoints: 1 });
  const receipt = await spendPendingAttributePointAuthoritative({
    actorUuid: actor.uuid,
    transactionId: "attribute-one",
    attributeKey: "fuerza",
    expectedValue: 4,
    expectedPendingPoints: 1
  }, { requestingUserId: "player" });

  assert.equal(actor.system.atributos.fuerza, 5);
  assert.equal(actor.system.pendingAdvancement.attributePoints, 0);
  assert.equal(actor.updates[0]["system.pendingAdvancement.competencePoints"], 0);
  assert.equal(receipt.replayed, false);
});

test("doble asignación del mismo punto de atributo se aplica una sola vez", async () => {
  const actor = createActor({ attributePoints: 1 });
  const payload = {
    actorUuid: actor.uuid,
    transactionId: "attribute-double",
    attributeKey: "fuerza",
    expectedValue: 4,
    expectedPendingPoints: 1
  };

  await spendPendingAttributePointAuthoritative(payload, { requestingUserId: "player" });
  const replay = await spendPendingAttributePointAuthoritative(payload, { requestingUserId: "player" });
  await assert.rejects(spendPendingAttributePointAuthoritative({
    ...payload,
    transactionId: "attribute-second-id"
  }, { requestingUserId: "player" }), /cambió|pendientes/);

  assert.equal(replay.replayed, true);
  assert.equal(actor.system.atributos.fuerza, 5);
  assert.equal(actor.system.pendingAdvancement.attributePoints, 0);
  assert.equal(actor.updates.length, 1);
});

test("atributo en cap conserva pending", async () => {
  const actor = createActor({ attributePoints: 1 });
  actor.system.atributos.fuerza = 5;

  await assert.rejects(spendPendingAttributePointAuthoritative({
    actorUuid: actor.uuid,
    transactionId: "attribute-cap",
    attributeKey: "fuerza",
    expectedValue: 5,
    expectedPendingPoints: 1
  }, { requestingUserId: "player" }), /máximo/);
  assert.equal(actor.system.pendingAdvancement.attributePoints, 1);
});

test("Owner gasta un punto de competencia 4→5 y canonicaliza Item", async () => {
  const actor = createActor({ competencePoints: 1 });
  actor.items[0].system.nivel = 4;
  const item = actor.items[0];

  await spendPendingCompetencePointAuthoritative({
    actorUuid: actor.uuid,
    transactionId: "competence-one",
    itemId: item.id,
    expectedValue: 4,
    expectedPendingPoints: 1
  }, { requestingUserId: "player" });

  assert.equal(item.system.nivel, 5);
  assert.equal(actor.system.pendingAdvancement.competencePoints, 0);
  assert.equal(actor.updates[0]["system.pendingAdvancement.attributePoints"], 0);
});

test("doble asignación del mismo punto de competencia se aplica una sola vez", async () => {
  const actor = createActor({ competencePoints: 1 });
  const item = actor.items[0];
  item.system.nivel = 4;
  const payload = {
    actorUuid: actor.uuid,
    transactionId: "competence-double",
    itemId: item.id,
    expectedValue: 4,
    expectedPendingPoints: 1
  };

  await spendPendingCompetencePointAuthoritative(payload, { requestingUserId: "player" });
  const replay = await spendPendingCompetencePointAuthoritative(payload, { requestingUserId: "player" });
  await assert.rejects(spendPendingCompetencePointAuthoritative({
    ...payload,
    transactionId: "competence-second-id"
  }, { requestingUserId: "player" }), /cambió|pendientes/);

  assert.equal(replay.replayed, true);
  assert.equal(item.system.nivel, 5);
  assert.equal(actor.system.pendingAdvancement.competencePoints, 0);
  assert.equal(item.updates.length, 1);
});

test("competencia en cap conserva pending", async () => {
  const actor = createActor({ competencePoints: 1 });
  const item = actor.items[0];
  item.system.nivel = 5;

  await assert.rejects(spendPendingCompetencePointAuthoritative({
    actorUuid: actor.uuid,
    transactionId: "competence-cap",
    itemId: item.id,
    expectedValue: 5,
    expectedPendingPoints: 1
  }, { requestingUserId: "player" }), /máximo/);
  assert.equal(actor.system.pendingAdvancement.competencePoints, 1);
});

for (const classification of [
  { categoria: "hechizo", tipo: "", label: "hechizo" },
  { categoria: "combate", tipo: "habilidad-combate", label: "habilidad de combate" }
]) {
  test(`pending rechaza ${classification.label} y conserva Item y punto`, async () => {
    const actor = createActor({ competencePoints: 1 });
    const item = actor.items[0];
    item.system.nivel = 4;
    item.system.categoria = classification.categoria;
    item.system.tipo = classification.tipo;

    await assert.rejects(spendPendingCompetencePointAuthoritative({
      actorUuid: actor.uuid,
      transactionId: `reject-${classification.categoria}`,
      itemId: item.id,
      expectedValue: 4,
      expectedPendingPoints: 1
    }, { requestingUserId: "player" }), /competencia.*progresión/i);

    assert.equal(item.system.nivel, 4);
    assert.equal(item.updates.length, 0);
    assert.equal(actor.system.pendingAdvancement.competencePoints, 1);
    assert.equal(actor.updates.length, 0);
  });
}

test("payloads manipulados, atributo inexistente, Item ajeno y no-Owner se rechazan", async () => {
  const actor = createActor({ attributePoints: 1, competencePoints: 1 });
  const baseAttribute = {
    actorUuid: actor.uuid,
    transactionId: "forged-attribute",
    attributeKey: "fuerza",
    expectedValue: 4,
    expectedPendingPoints: 1
  };

  await assert.rejects(spendPendingAttributePointAuthoritative({ ...baseAttribute, increment: 5 }, {
    requestingUserId: "player"
  }), /payload/i);
  await assert.rejects(spendPendingAttributePointAuthoritative({ ...baseAttribute, attributeKey: "inexistente" }, {
    requestingUserId: "player"
  }), /atributo/);
  await assert.rejects(spendPendingCompetencePointAuthoritative({
    actorUuid: actor.uuid,
    transactionId: "foreign-item",
    itemId: "not-owned",
    expectedValue: 4,
    expectedPendingPoints: 1,
    finalLevel: 10
  }, { requestingUserId: "player" }), /payload/i);
  await assert.rejects(spendPendingCompetencePointAuthoritative({
    actorUuid: actor.uuid,
    transactionId: "foreign-item-canonical",
    itemId: "not-owned",
    expectedValue: 4,
    expectedPendingPoints: 1
  }, { requestingUserId: "player" }), /pertenece/);
  await assert.rejects(spendPendingAttributePointAuthoritative(baseAttribute, {
    requestingUserId: "stranger"
  }), /permiso/);

  assert.equal(actor.system.pendingAdvancement.attributePoints, 1);
  assert.equal(actor.system.pendingAdvancement.competencePoints, 1);
});
