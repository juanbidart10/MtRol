import test from "node:test";
import assert from "node:assert/strict";

globalThis.foundry = {
  utils: {
    deepClone: value => value === undefined ? undefined : structuredClone(value),
    randomID: () => "six-a"
  }
};

const users = new Map([
  ["gm", { id: "gm", isGM: true }],
  ["owner", { id: "owner", isGM: false }]
]);
const actors = new Map();
globalThis.game = {
  user: users.get("gm"),
  users,
  actors: { get: id => actors.get(`Actor.${id}`) ?? null },
  combat: null,
  combats: { get: () => null }
};
globalThis.fromUuid = async uuid => actors.get(uuid) ?? null;

function setPath(actor, path, value) {
  const parts = path.replace(/^system\./, "").split(".");
  let cursor = actor.system;
  for (const part of parts.slice(0, -1)) cursor = cursor[part] ??= {};
  cursor[parts.at(-1)] = structuredClone(value);
}

function actor(raceId = "gnomo", {
  id = raceId,
  level = 3,
  attribute = 4,
  attributePoints = 0,
  grants = [],
  selections = []
} = {}) {
  const items = [];
  items.get = itemId => items.find(item => item.id === itemId) ?? null;
  const current = {
    id,
    uuid: `Actor.${id}`,
    type: "personaje",
    documentName: "Actor",
    flags: { mtrol: {} },
    _source: { system: { awakening: { grants: structuredClone(grants), selections: structuredClone(selections) } } },
    system: {
      identidad: { raceId, raza: raceId },
      recursos: { nivel: level },
      atributos: Object.fromEntries([
        "resistencia", "carisma", "fuerza", "inteligencia", "voluntad",
        "aura", "percepcion", "destreza", "suerte"
      ].map(key => [key, attribute])),
      vitales: { hp: { value: 20, max: 20 }, mp: { value: 20, max: 20 } },
      pendingAdvancement: { attributePoints, competencePoints: 0 },
      progression: {},
      awakening: { grants: structuredClone(grants), selections: structuredClone(selections) },
      raceCreationGrant: { applied: false, sourceRaceId: "" },
      equipamiento: {}
    },
    items,
    updates: [],
    testUserPermission(user, permission) {
      return user?.id === "owner" && permission === "OWNER";
    },
    async update(changes) {
      this.updates.push(structuredClone(changes));
      for (const [path, value] of Object.entries(changes)) {
        if (path.startsWith("system.")) setPath(this, path, value);
      }
      this._source.system.awakening = structuredClone(this.system.awakening);
    },
    async setFlag(scope, key, value) {
      this.flags[scope] ??= {};
      this.flags[scope][key] = structuredClone(value);
    },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    }
  };
  actors.set(current.uuid, current);
  return current;
}

const { getRacialPassiveDefinition } = await import("../scripts/races/racial-passive-catalog.js");
const {
  resolveCompetencyProgressionGain,
  resolveProgressionGain
} = await import("../scripts/effects/progression-policy.js");
const { getAttributeCap } = await import("../scripts/progression/progression-caps.js");
const { evaluateEffectImmunity } = await import("../scripts/effects/effect-immunity-policy.js");
const {
  getAwakeningState,
  getEffectiveAwakeningCapacity,
  grantAwakeningSlotAuthoritative,
  planDerivedAwakeningGrantUpdate,
  validateAwakeningSelection
} = await import("../scripts/actors/awakening-service.js");
const {
  spendPendingAttributePointAuthoritative
} = await import("../scripts/actors/progression-advancement-service.js");
const { updateActorRaceIdentityAuthoritative } = await import("../scripts/actors/race-service.js");
const {
  planAwakeningFoundationMigration,
  migrateAwakeningFoundation
} = await import("../scripts/migrations/awakening-foundation-migration.js");
const { resetActorResourceServiceForTests } = await import("../scripts/actors/actor-resource-service.js");
const { createEffectContext } = await import("../scripts/effects/effect-context.js");
const { resolveEffects } = await import("../scripts/effects/effect-resolver.js");
const { MTROL_EFFECT_PHASES } = await import("../scripts/effects/effect-types.js");
const { validateEffectDefinition } = await import("../scripts/effects/effect-types.js");

test.beforeEach(() => {
  actors.clear();
  resetActorResourceServiceForTests();
});

test("Prodigio e Infinito resuelven policies separadas y deduplicadas", () => {
  assert.equal(resolveCompetencyProgressionGain(actor("humano"), 1).value, 2);
  assert.equal(resolveCompetencyProgressionGain(actor("gnomo"), 1).value, 1);
  assert.equal(resolveProgressionGain(actor("eterno"), 1).value, 2);
  assert.equal(resolveProgressionGain(actor("humano"), 1).value, 1);

  const prodigy = getRacialPassiveDefinition("prodigio");
  const duplicated = resolveCompetencyProgressionGain(actor("gnomo"), 1, {
    resolvePassives: () => ({ passives: [prodigy, prodigy], diagnostics: [] })
  });
  assert.equal(duplicated.value, 2);
  assert.equal(duplicated.appliedEffects.length, 1);

  const infinity = getRacialPassiveDefinition("infinito");
  const duplicatedInfinity = resolveProgressionGain(actor("gnomo", { id: "duplicate-infinity" }), 1, {
    resolvePassives: () => ({ passives: [infinity, infinity], diagnostics: [] })
  });
  assert.equal(duplicatedInfinity.value, 2);
  assert.equal(duplicatedInfinity.appliedEffects.length, 1);
});

test("AttributeCapPolicy deriva 5/10 sin depender directamente de raceId", () => {
  const normal = actor("gnomo");
  const infinity = getRacialPassiveDefinition("infinito");
  assert.equal(getAttributeCap(normal), 5);
  assert.equal(getAttributeCap(actor("eterno")), 10);
  assert.equal(getAttributeCap(normal, {
    resolvePassives: () => ({ passives: [infinity], diagnostics: [] })
  }), 10, "una futura fuente de pasivas también puede aportar Infinito");
});

test("cap controla nuevas mutaciones sin clamping histórico", async () => {
  const normal = actor("gnomo", { id: "normal-cap", attribute: 5, attributePoints: 1 });
  await assert.rejects(spendPendingAttributePointAuthoritative({
    actorUuid: normal.uuid,
    transactionId: "normal-six",
    attributeKey: "fuerza",
    expectedValue: 5,
    expectedPendingPoints: 1
  }, { requestingUserId: "owner" }), /máximo/);

  const eternal = actor("eterno", { id: "eternal-cap", attribute: 5, attributePoints: 1 });
  await spendPendingAttributePointAuthoritative({
    actorUuid: eternal.uuid,
    transactionId: "eternal-six",
    attributeKey: "fuerza",
    expectedValue: 5,
    expectedPendingPoints: 1
  }, { requestingUserId: "owner" });
  assert.equal(eternal.system.atributos.fuerza, 6);

  const former = actor("humano", { id: "former-eternal", attribute: 8, attributePoints: 1 });
  await assert.rejects(spendPendingAttributePointAuthoritative({
    actorUuid: former.uuid,
    transactionId: "former-nine",
    attributeKey: "fuerza",
    expectedValue: 8,
    expectedPendingPoints: 1
  }, { requestingUserId: "owner" }), /máximo/);
  assert.equal(former.system.atributos.fuerza, 8);
});

test("Bendición bloquea sólo target hostile externo racial/curse", () => {
  const blessed = actor("bendito");
  const base = {
    sourceActorUuid: "Actor.enemy",
    targetActorUuid: blessed.uuid,
    applicationScope: "target",
    polarity: "hostile",
    tags: []
  };
  assert.equal(evaluateEffectImmunity(blessed, { ...base, sourceCategory: "racialPassive" }).blocked, true);
  assert.equal(evaluateEffectImmunity(blessed, { ...base, sourceCategory: "spell", tags: ["curse"] }).blocked, true);
  assert.equal(evaluateEffectImmunity(blessed, { ...base, sourceCategory: "spell" }).blocked, false);
  assert.equal(evaluateEffectImmunity(blessed, {
    ...base,
    sourceActorUuid: blessed.uuid,
    sourceCategory: "racialPassive"
  }).blocked, false, "no bloquea efectos propios");
  assert.equal(evaluateEffectImmunity(blessed, {
    ...base,
    applicationScope: "self",
    polarity: "beneficial",
    sourceCategory: "racialPassive"
  }).blocked, false);
});

test("EffectResolver filtra un candidato hostil antes de ejecutar su handler", () => {
  const source = actor("gnomo", { id: "hostile-source" });
  const blessed = actor("bendito", { id: "hostile-target" });
  const hostile = {
    technicalId: "hostile-racial-test",
    tags: [],
    effects: [{
      type: "INITIATIVE_BONUS",
      value: 10,
      subject: "source",
      priority: 100,
      applicationScope: "target",
      polarity: "hostile"
    }]
  };
  const result = resolveEffects(createEffectContext({
    phase: MTROL_EFFECT_PHASES.INITIATIVE_BUILD,
    sourceActor: source,
    targetActor: blessed,
    initiative: 12
  }), {
    resolvePassives: current => current.uuid === source.uuid
      ? { passives: [hostile], diagnostics: [] }
      : { passives: [getRacialPassiveDefinition("bendicion")], diagnostics: [] },
    log: null
  });
  assert.equal(result.value, 12);
  assert.equal(result.skippedEffects[0].reason, "EFFECT_IMMUNITY");
});

test("Maldición self del atacante no es bloqueada por un Bendito objetivo", () => {
  const blessed = actor("bendito", { id: "blessed-target" });
  const cursed = actor("maldito", { id: "cursed-source" });
  const result = evaluateEffectImmunity(blessed, {
    sourceCategory: "racialPassive",
    sourcePassiveId: "maldicion",
    sourceActorUuid: cursed.uuid,
    targetActorUuid: cursed.uuid,
    applicationScope: "self",
    polarity: "beneficial",
    tags: ["curse"]
  });
  assert.equal(result.blocked, false);
});

test("Subyugador y Celestial comparten capacity 2 y un grant racial estable", () => {
  for (const raceId of ["oscuro", "iluminado"]) {
    const current = actor(raceId, { id: `capacity-${raceId}` });
    const first = getAwakeningState(current);
    const second = getAwakeningState(current);
    assert.equal(getEffectiveAwakeningCapacity(current), 2);
    assert.equal(first.granted, 1);
    assert.equal(first.availableGrantedSlots, 1);
    assert.equal(first.grants[0].grantId, second.grants[0].grantId);
  }
  const normal = getAwakeningState(actor("gnomo", { id: "normal-awakening" }));
  assert.equal(normal.capacity, 1);
  assert.equal(normal.granted, 0);
  assert.equal(normal.availableGrantedSlots, 0);
});

test("grant GM es autoritativo, idempotente y no excede capacity", async () => {
  const current = actor("gnomo", { id: "gm-grant" });
  const payload = {
    actorUuid: current.uuid,
    transactionId: "grant-normal",
    source: "normalNarrative",
    reason: "Hito narrativo"
  };
  const first = await grantAwakeningSlotAuthoritative(payload, { requestingUserId: "gm" });
  const replay = await grantAwakeningSlotAuthoritative(payload, { requestingUserId: "gm" });
  assert.equal(first.grantId, "gm:grant-normal");
  assert.equal(replay.replayed, true);
  assert.equal(current.system.awakening.grants.length, 1);
  await assert.rejects(grantAwakeningSlotAuthoritative({
    ...payload,
    transactionId: "grant-over-cap"
  }, { requestingUserId: "gm" }), /capacidad/);
  await assert.rejects(grantAwakeningSlotAuthoritative({
    ...payload,
    transactionId: "owner-forbidden"
  }, { requestingUserId: "owner" }), /GM/);
});

test("grant racial se persiste exactly-once y sobrevive al cambio de Raza", async () => {
  const current = actor("gnomo", { id: "race-grant-history" });
  await updateActorRaceIdentityAuthoritative({
    actorUuid: current.uuid,
    transactionId: "to-dark",
    expectedRaceId: "gnomo",
    raceId: "oscuro"
  }, { requestingUserId: "gm" });
  assert.equal(current.system.awakening.grants.length, 1);
  const grantId = current.system.awakening.grants[0].grantId;
  await updateActorRaceIdentityAuthoritative({
    actorUuid: current.uuid,
    transactionId: "to-human",
    expectedRaceId: "oscuro",
    raceId: "humano"
  }, { requestingUserId: "gm" });
  assert.equal(current.system.awakening.grants.length, 1);
  assert.equal(current.system.awakening.grants[0].grantId, grantId);
  assert.equal(getAwakeningState(current).overCapacity, false);
});

test("cambio de Raza conserva historial over-cap y lo reporta sin borrar", async () => {
  const current = actor("gnomo", { id: "over-cap-history" });
  await updateActorRaceIdentityAuthoritative({
    actorUuid: current.uuid, transactionId: "over-to-dark", expectedRaceId: "gnomo", raceId: "oscuro"
  }, { requestingUserId: "gm" });
  await grantAwakeningSlotAuthoritative({
    actorUuid: current.uuid, transactionId: "over-normal-grant", source: "normalNarrative"
  }, { requestingUserId: "gm" });
  assert.equal(getAwakeningState(current).granted, 2);
  await updateActorRaceIdentityAuthoritative({
    actorUuid: current.uuid, transactionId: "over-to-human", expectedRaceId: "oscuro", raceId: "humano"
  }, { requestingUserId: "gm" });
  const state = getAwakeningState(current);
  assert.equal(state.capacity, 1);
  assert.equal(state.granted, 2);
  assert.equal(state.overCapacity, true);
});

test("migración foundation es idempotente y no concede el slot normal", async () => {
  const dark = actor("oscuro", { id: "migration-dark" });
  const normal = actor("gnomo", { id: "migration-normal" });
  dark._source.system = {};
  normal._source.system = {};
  const planned = planAwakeningFoundationMigration({ actors: [dark, normal] });
  assert.equal(planned.operations.length, 2);
  const first = await migrateAwakeningFoundation({ actors: [dark, normal] });
  const second = await migrateAwakeningFoundation({ actors: [dark, normal] });
  assert.equal(first.racialGrantsAdded, 1);
  assert.equal(second.actorsMigrated, 0);
  assert.equal(dark.system.awakening.grants.length, 1);
  assert.equal(normal.system.awakening.grants.length, 0);
});

test("eligibility foundation exige nivel, grant y no duplicar la pasiva base", () => {
  const current = actor("gnomo", {
    id: "eligibility",
    level: 3,
    grants: [{
      grantId: "gm:one", source: "normalNarrative", sourcePassiveId: null,
      grantedAtLevel: 3, grantedBy: "gm", grantedAt: 1, reason: ""
    }]
  });
  assert.equal(validateAwakeningSelection(current, "elemental").eligible, false);
  assert.equal(validateAwakeningSelection(current, "virtus").eligible, true);
});

test("definitions inválidas producen diagnóstico y no corrección silenciosa", () => {
  const invalid = {
    technicalId: "invalid-policy",
    tags: [],
    effects: [{
      type: "GRANT_AWAKENING_SLOT",
      value: -1,
      subject: "source",
      priority: 100,
      applicationScope: "self"
    }]
  };
  const result = resolveEffects(createEffectContext({
    phase: MTROL_EFFECT_PHASES.AWAKENING_CAPACITY_POLICY,
    sourceActor: actor("gnomo", { id: "invalid-definition" }),
    policyValue: 1
  }), {
    resolvePassives: () => ({ passives: [invalid], diagnostics: [] }),
    log: null
  });
  assert.equal(result.value, 1);
  assert.equal(result.diagnostics[0].code, "EFFECT_DEFINITION_INVALID");
});

test("validators de las cinco policies rechazan contratos inválidos", () => {
  for (const effect of [
    { type: "COMPETENCY_PROGRESSION_MULTIPLIER", multiplier: 0 },
    { type: "PROGRESSION_MULTIPLIER", multiplier: -1 },
    { type: "GRANT_AWAKENING_SLOT", value: 1.5 },
    { type: "ATTRIBUTE_CAP_OVERRIDE", value: 4 },
    { type: "EFFECT_IMMUNITY", filters: [] }
  ]) {
    const result = validateEffectDefinition({
      ...effect,
      subject: "source",
      priority: 100,
      applicationScope: "self",
      protectedApplicationScope: "target",
      protectedPolarity: "hostile"
    });
    assert.equal(result.valid, false, effect.type);
    assert.ok(result.errors.length > 0, effect.type);
  }
});
