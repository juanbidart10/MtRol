import test from "node:test";
import assert from "node:assert/strict";

import {
  GROUND_SCHEMA_VERSION,
  GROUND_VISIBILITY,
  GROUND_APPEARANCE_MODE,
  GROUND_LIFECYCLE,
  createGroundId,
  createGroundPublicProjection,
  createGroundAuthorityRecord,
  validateGroundPublicProjection,
  validateGroundAuthorityRecord,
  detectGroundPairState
} from "../scripts/ground/ground-schema.js";
import {
  GROUND_PUBLIC_FLAG,
  GROUND_AUTHORITY_FLAG,
  GroundSceneFlagStorage,
  GroundPersistencePrimitive
} from "../scripts/ground/ground-repository.js";
import {
  createItemTransferSnapshot,
  reconstructItemTransferData
} from "../scripts/items/item-transfer-data.js";

function itemFixture(name = "Reliquia secreta") {
  return {
    _id: "source-item",
    name,
    type: "objeto",
    img: "items/relic.webp",
    system: {
      cantidad: 5,
      equipado: true,
      damageFormula: "4d10 + @secreto",
      nested: { preserved: [1, 2, 3] }
    },
    flags: { mtrol: { classified: true } },
    effects: [{ _id: "effect-1", name: "Aura", changes: [{ key: "system.secret", value: "7" }] }]
  };
}

function snapshotFixture(name) {
  return createItemTransferSnapshot({
    uuid: "Actor.source.Item.source-item",
    toObject: () => itemFixture(name)
  });
}

const idToken = "AbCdEfGhIjKlMnOpQrStUvWx";

function groundId() {
  return createGroundId({ worldId: "world-one", idGenerator: length => idToken.slice(0, length) });
}

function publicFixture(overrides = {}) {
  return {
    schemaVersion: GROUND_SCHEMA_VERSION,
    groundId: groundId(),
    sceneId: "scene-a",
    position: { x: 100, y: 200 },
    visibility: GROUND_VISIBILITY.HIDDEN,
    pickupEnabled: true,
    appearance: { mode: GROUND_APPEARANCE_MODE.GENERIC, img: "systems/mtrol/assets/item.svg" },
    ...overrides
  };
}

function authorityFixture(overrides = {}) {
  return {
    schemaVersion: GROUND_SCHEMA_VERSION,
    groundId: groundId(),
    sceneId: "scene-a",
    lifecycle: GROUND_LIFECYCLE.PENDING,
    position: { x: 100, y: 200 },
    visibility: GROUND_VISIBILITY.HIDDEN,
    pickupEnabled: true,
    appearance: { mode: GROUND_APPEARANCE_MODE.GENERIC, img: "systems/mtrol/assets/item.svg" },
    quantity: 3,
    itemSnapshot: snapshotFixture(),
    provenance: {
      sourceActorUuid: "Actor.source",
      sourceItemUuid: "Actor.source.Item.source-item",
      createdBy: "gm-a",
      createdAt: 123456,
      operationId: "drop-operation-1"
    },
    recoveryEvidence: { transactionId: null, checkpoints: [], reasonCode: null },
    ...overrides
  };
}

class FakeScene {
  constructor(id, backing = {}) {
    this.id = id;
    this.flags = backing;
  }

  getFlag(scope, key) {
    return this.flags[scope]?.[key];
  }

  async setFlag(scope, key, value) {
    this.flags[scope] ??= {};
    this.flags[scope][key] = structuredClone(value);
    return this.flags[scope][key];
  }
}

function scenePersistence(backing = {}) {
  const scene = new FakeScene("scene-a", backing);
  const resolveScene = sceneId => sceneId === scene.id ? scene : null;
  return {
    scene,
    repository: new GroundPersistencePrimitive({
      publicStorage: new GroundSceneFlagStorage({
        flagKey: GROUND_PUBLIC_FLAG,
        recordKind: "public",
        resolveScene
      }),
      authorityStorage: new GroundSceneFlagStorage({
        flagKey: GROUND_AUTHORITY_FLAG,
        recordKind: "authority",
        resolveScene
      })
    })
  };
}

test("G1B.1 groundId es opaco, namespaced y no deriva del Item", () => {
  const first = createGroundId({ worldId: "world-one", idGenerator: () => idToken });
  const renamed = itemFixture("Otro nombre");
  const moved = { x: 999, y: -200, quantity: 99, actor: "Actor.other", img: renamed.img };
  assert.equal(first, `ground:world-one:${idToken}`);
  assert.equal(groundId(), first);
  assert.doesNotMatch(first, /Reliquia|Otro nombre|Actor|999|relic/i);
  assert.ok(renamed && moved);
  assert.throws(() => createGroundId({ worldId: "bad:world", idGenerator: () => idToken }));
});

test("G1B.1 PublicProjection es mínima y rechaza datos privados y unknown fields", () => {
  const projection = createGroundPublicProjection(publicFixture());
  assert.deepEqual(projection, publicFixture());
  for (const forbidden of ["itemSnapshot", "system", "flags", "effects", "description", "damageFormula",
    "sourceActorUuid", "sourceItemUuid", "provenance", "recoveryEvidence"]) {
    assert.throws(() => validateGroundPublicProjection({ ...publicFixture(), [forbidden]: {} }), /desconocido/i);
  }
  assert.throws(() => validateGroundPublicProjection({ ...publicFixture(), appearance: {
    ...publicFixture().appearance, flags: { leaked: true }
  } }), /desconocido/i);
  assert.equal(Object.hasOwn(projection, "lifecycle"), false);
  assert.equal(Object.hasOwn(projection, "quantity"), false);
});

test("G1B.1 visibility, appearance, pickup y position usan vocabulario canónico", () => {
  for (const visibility of Object.values(GROUND_VISIBILITY)) {
    assert.equal(createGroundPublicProjection(publicFixture({ visibility })).visibility, visibility);
  }
  assert.equal(createGroundPublicProjection(publicFixture({ pickupEnabled: true })).pickupEnabled, true);
  assert.equal(createGroundPublicProjection(publicFixture({ visibility: GROUND_VISIBILITY.HIDDEN,
    pickupEnabled: true })).pickupEnabled, true);
  for (const invalid of [NaN, Infinity, "1", null]) {
    assert.throws(() => createGroundPublicProjection(publicFixture({ position: { x: invalid, y: 2 } })));
  }
  assert.throws(() => createGroundPublicProjection(publicFixture({ position: { x: 1, y: 2, elevation: 0 } })),
    /desconocido/i);
  assert.throws(() => createGroundPublicProjection(publicFixture({ appearance: { mode: "UNKNOWN", img: "x" } })));
});

test("G1B.1 AuthorityRecord conserva y reconstruye Universal Item Transfer Data", () => {
  const input = authorityFixture();
  const record = createGroundAuthorityRecord(input);
  assert.deepEqual(record.itemSnapshot, input.itemSnapshot);
  assert.deepEqual(record.itemSnapshot.item.flags, itemFixture().flags);
  assert.deepEqual(record.itemSnapshot.item.effects, itemFixture().effects);
  assert.equal(record.itemSnapshot.item.system.damageFormula, "4d10 + @secreto");
  const reconstructed = reconstructItemTransferData(record.itemSnapshot, { quantity: record.quantity });
  assert.equal(reconstructed.data.system.cantidad, 3);
  assert.deepEqual(reconstructed.data.flags, itemFixture().flags);
  assert.deepEqual(reconstructed.data.effects, itemFixture().effects);
});

test("G1B.1 AuthorityRecord valida schema, quantity, lifecycle y unknown fields", () => {
  assert.equal(validateGroundAuthorityRecord(authorityFixture()).schemaVersion, 1);
  for (const quantity of [0, -1, 1.5, NaN, Infinity, "2", 6]) {
    assert.throws(() => validateGroundAuthorityRecord(authorityFixture({ quantity })));
  }
  assert.throws(() => validateGroundAuthorityRecord(authorityFixture({ schemaVersion: 99 })), /schema/i);
  assert.throws(() => validateGroundAuthorityRecord(authorityFixture({ lifecycle: "RESERVED" })), /lifecycle/i);
  assert.throws(() => validateGroundAuthorityRecord({ ...authorityFixture(), surprise: true }), /desconocido/i);
});

test("G1B.1 create/read persiste lados separados con copy safety", async () => {
  const backing = {};
  const { repository } = scenePersistence(backing);
  const publicInput = publicFixture();
  const authorityInput = authorityFixture();
  await repository.create({ publicProjection: publicInput, authorityRecord: authorityInput });

  publicInput.position.x = -500;
  authorityInput.itemSnapshot.item.name = "MUTATED INPUT";
  const first = repository.read("scene-a", groundId());
  assert.equal(first.publicProjection.position.x, 100);
  assert.equal(first.authorityRecord.itemSnapshot.item.name, "Reliquia secreta");
  assert.equal(first.status, "MATCHED");
  assert.notStrictEqual(backing.mtrol[GROUND_PUBLIC_FLAG], backing.mtrol[GROUND_AUTHORITY_FLAG]);

  first.publicProjection.position.x = -900;
  first.authorityRecord.itemSnapshot.item.flags.mtrol.classified = false;
  const second = repository.read("scene-a", groundId());
  assert.equal(second.publicProjection.position.x, 100);
  assert.equal(second.authorityRecord.itemSnapshot.item.flags.mtrol.classified, true);
});

test("G1B.1 reload usa persistence y no el objeto repository anterior", async () => {
  const backing = {};
  await scenePersistence(backing).repository.create({
    publicProjection: publicFixture(), authorityRecord: authorityFixture()
  });
  const reloaded = scenePersistence(backing).repository;
  const result = reloaded.read("scene-a", groundId());
  assert.equal(result.status, "MATCHED");
  assert.deepEqual(result.publicProjection, publicFixture());
  assert.deepEqual(result.authorityRecord, authorityFixture());
});

test("G1B.1 comparación de pares es estructural e independiente del orden de claves", () => {
  const projection = publicFixture({
    position: { y: 200, x: 100 },
    appearance: { img: "systems/mtrol/assets/item.svg", mode: GROUND_APPEARANCE_MODE.GENERIC }
  });
  assert.equal(detectGroundPairState(projection, authorityFixture()).status, "MATCHED");
});

test("G1B.1 duplicate groundId falla sin overwrite", async () => {
  const { repository } = scenePersistence();
  await repository.create({ publicProjection: publicFixture(), authorityRecord: authorityFixture() });
  await assert.rejects(repository.create({
    publicProjection: publicFixture({ position: { x: 9, y: 9 } }),
    authorityRecord: authorityFixture({ position: { x: 9, y: 9 }, quantity: 2 })
  }), /existe/i);
  const stored = repository.read("scene-a", groundId());
  assert.deepEqual(stored.publicProjection.position, { x: 100, y: 200 });
  assert.equal(stored.authorityRecord.quantity, 3);
});

test("G1B.1 updates permitidos conservan identidad y snapshot inmutable", async () => {
  const { repository } = scenePersistence();
  await repository.create({ publicProjection: publicFixture(), authorityRecord: authorityFixture() });
  await repository.updatePublic("scene-a", groundId(), { position: { x: 5, y: 6 }, pickupEnabled: false });
  await repository.updateAuthority("scene-a", groundId(), {
    lifecycle: GROUND_LIFECYCLE.ACTIVE,
    position: { x: 5, y: 6 },
    pickupEnabled: false,
    recoveryEvidence: { transactionId: "tx-1", checkpoints: ["persisted"], reasonCode: null }
  });
  const updated = repository.read("scene-a", groundId());
  assert.equal(updated.status, "MATCHED");
  assert.equal(updated.authorityRecord.lifecycle, GROUND_LIFECYCLE.ACTIVE);
  assert.equal(updated.authorityRecord.itemSnapshot.item.name, "Reliquia secreta");

  await assert.rejects(repository.updateAuthority("scene-a", groundId(), {
    itemSnapshot: snapshotFixture("Replacement")
  }), /inmutable/i);
  await assert.rejects(repository.updateAuthority("scene-a", groundId(), {
    lifecycle: GROUND_LIFECYCLE.PENDING
  }), /transici/i);
  await assert.rejects(repository.updatePublic("scene-a", groundId(), { sceneId: "scene-b" }), /scene/i);
});

test("G1B.1 detecta orphans, scene mismatch y diferencias autoritativas sin reparar", () => {
  assert.equal(detectGroundPairState(null, null).status, "ABSENT");
  assert.equal(detectGroundPairState(publicFixture(), null).status, "PUBLIC_ONLY");
  assert.equal(detectGroundPairState(null, authorityFixture()).status, "AUTHORITY_ONLY");
  assert.equal(detectGroundPairState(publicFixture(), authorityFixture()).status, "MATCHED");
  const mismatchedId = authorityFixture({ groundId: createGroundId({
    worldId: "world-one", idGenerator: () => "ZbCdEfGhIjKlMnOpQrStUvWx"
  }) });
  assert.equal(detectGroundPairState(publicFixture(), mismatchedId).status, "MISMATCHED");
  const mismatchedScene = authorityFixture({ sceneId: "scene-b" });
  assert.equal(detectGroundPairState(publicFixture(), mismatchedScene).status, "MISMATCHED");
  const mismatchedPosition = authorityFixture({ position: { x: 101, y: 200 } });
  assert.equal(detectGroundPairState(publicFixture(), mismatchedPosition).status, "MISMATCHED");
});

test("G1B.1 persistence corrupta falla cerrado y conserva bytes", () => {
  const malformed = {
    mtrol: {
      [GROUND_PUBLIC_FLAG]: {
        schemaVersion: 99,
        revision: 1,
        sceneId: "scene-a",
        records: { [groundId()]: publicFixture() }
      }
    }
  };
  const before = structuredClone(malformed);
  const { repository } = scenePersistence(malformed);
  assert.throws(() => repository.read("scene-a", groundId()), /schema/i);
  assert.deepEqual(malformed, before);
});

test("G1B.1 dominio opera sobre contrato inyectado sin conocer Scene flags", async () => {
  class ContractStorage {
    constructor(kind) { this.kind = kind; this.values = new Map(); }
    read(sceneId) { return structuredClone(this.values.get(sceneId) ?? {
      schemaVersion: 1, revision: 0, sceneId, records: {}
    }); }
    async write(sceneId, envelope, { expectedRevision }) {
      const current = this.read(sceneId);
      assert.equal(current.revision, expectedRevision);
      const stored = structuredClone({ ...envelope, revision: expectedRevision + 1 });
      this.values.set(sceneId, stored);
      return structuredClone(stored);
    }
  }
  const repository = new GroundPersistencePrimitive({
    publicStorage: new ContractStorage("public"),
    authorityStorage: new ContractStorage("authority")
  });
  await repository.create({ publicProjection: publicFixture(), authorityRecord: authorityFixture() });
  assert.equal(repository.read("scene-a", groundId()).status, "MATCHED");
});
