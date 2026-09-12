import test from "node:test";
import assert from "node:assert/strict";

import {
  GROUND_SCHEMA_VERSION,
  GROUND_VISIBILITY,
  GROUND_APPEARANCE_MODE,
  GROUND_LIFECYCLE
} from "../scripts/ground/ground-schema.js";
import {
  GROUND_PUBLIC_FLAG,
  GROUND_AUTHORITY_FLAG,
  GroundSceneFlagStorage,
  GroundPersistencePrimitive,
  GroundRevisionConflictError
} from "../scripts/ground/ground-repository.js";
import {
  GroundLifecycleService,
  GroundLifecycleMutationError
} from "../scripts/ground/ground-lifecycle-service.js";
import { createItemTransferSnapshot } from "../scripts/items/item-transfer-data.js";

const GROUND_ID = "ground:world-one:AbCdEfGhIjKlMnOpQrStUvWx";

function snapshotFixture() {
  return createItemTransferSnapshot({
    uuid: "Actor.source.Item.source-item",
    toObject: () => ({
      _id: "source-item",
      name: "Mapa secreto",
      type: "objeto",
      img: "items/map.webp",
      system: { cantidad: 4, formula: "2d10 + @secret" },
      flags: { mtrol: { private: true } },
      effects: [{ _id: "effect-1", name: "Secret effect" }]
    })
  });
}

class FakeScene {
  constructor(id, backing = {}, failures = {}) {
    this.id = id;
    this.flags = backing;
    this.failures = failures;
    this.writeCounts = new Map();
  }

  getFlag(scope, key) {
    return this.flags[scope]?.[key];
  }

  async setFlag(scope, key, value) {
    const count = (this.writeCounts.get(key) ?? 0) + 1;
    this.writeCounts.set(key, count);
    if (this.failures[key]?.has(count)) throw new Error(`forced ${key} write ${count}`);
    this.flags[scope] ??= {};
    this.flags[scope][key] = structuredClone(value);
    return structuredClone(value);
  }
}

function makeRuntime({ backing = {}, failures = {}, idFactory = () => GROUND_ID } = {}) {
  const scene = new FakeScene("scene-a", backing, failures);
  const resolveScene = sceneId => sceneId === scene.id ? scene : null;
  const repository = new GroundPersistencePrimitive({
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
  });
  return { scene, repository, service: new GroundLifecycleService({ repository, idFactory }) };
}

function createInput(overrides = {}) {
  return {
    worldId: "world-one",
    sceneId: "scene-a",
    position: { x: 10, y: 20 },
    visibility: GROUND_VISIBILITY.HIDDEN,
    pickupEnabled: true,
    appearance: { mode: GROUND_APPEARANCE_MODE.GENERIC, img: "systems/mtrol/assets/item.svg" },
    quantity: 2,
    itemSnapshot: snapshotFixture(),
    provenance: {
      sourceActorUuid: "Actor.source",
      sourceItemUuid: "Actor.source.Item.source-item",
      createdBy: "gm-a",
      createdAt: 1000,
      operationId: "ground-create-1"
    },
    ...overrides
  };
}

async function createActive(runtime) {
  await runtime.service.createPendingGround(createInput());
  return runtime.service.activateGround("scene-a", GROUND_ID, { transactionId: "activate-1" });
}

test("G1B.2 createPendingGround crea un par PENDING durable, aislado y sin overwrite", async () => {
  const backing = {};
  const runtime = makeRuntime({ backing });
  const input = createInput();
  const created = await runtime.service.createPendingGround(input);
  assert.equal(created.status, "MATCHED");
  assert.equal(created.authorityRecord.lifecycle, GROUND_LIFECYCLE.PENDING);
  assert.equal(created.publicProjection.groundId, created.authorityRecord.groundId);
  assert.equal(created.authorityRecord.recoveryEvidence.transactionId, "ground-create-1");
  assert.deepEqual(created.authorityRecord.recoveryEvidence.checkpoints, ["authority-record-persisted"]);

  input.position.x = 999;
  input.itemSnapshot.item.name = "mutated input";
  assert.deepEqual(runtime.repository.read("scene-a", GROUND_ID).authorityRecord.position, { x: 10, y: 20 });
  assert.equal(runtime.repository.read("scene-a", GROUND_ID).authorityRecord.itemSnapshot.item.name, "Mapa secreto");

  await assert.rejects(runtime.service.createPendingGround(createInput({ groundId: GROUND_ID })), /existe/i);
  const reloaded = makeRuntime({ backing });
  const durable = reloaded.repository.read("scene-a", GROUND_ID);
  assert.equal(durable.status, "MATCHED");
  assert.equal(durable.authorityRecord.lifecycle, GROUND_LIFECYCLE.PENDING);
});

test("G1B.2 create PENDING con Public write fallido conserva Authority y recovery durable", async () => {
  const backing = {};
  const runtime = makeRuntime({ backing, failures: { [GROUND_PUBLIC_FLAG]: new Set([1]) } });
  await assert.rejects(runtime.service.createPendingGround(createInput()), error =>
    error instanceof GroundLifecycleMutationError &&
    error.reasonCode === "GROUND_PUBLIC_WRITE_FAILED" &&
    error.pairState.status === "AUTHORITY_ONLY");
  const durable = makeRuntime({ backing }).repository.read("scene-a", GROUND_ID);
  assert.equal(durable.status, "AUTHORITY_ONLY");
  assert.equal(durable.authorityRecord.lifecycle, GROUND_LIFECYCLE.RECOVERY_REQUIRED);
  assert.equal(durable.authorityRecord.recoveryEvidence.transactionId, "ground-create-1");
  assert.ok(durable.authorityRecord.recoveryEvidence.checkpoints.includes("authority-record-persisted"));
  assert.ok(durable.authorityRecord.recoveryEvidence.checkpoints.includes("public-write-failed"));
});

test("G1B.2 activate expresa PENDING → ACTIVE y verifica estado durable MATCHED", async () => {
  const backing = {};
  const runtime = makeRuntime({ backing });
  await runtime.service.createPendingGround(createInput());
  const activated = await runtime.service.activateGround("scene-a", GROUND_ID, { transactionId: "activate-1" });
  assert.equal(activated.status, "MATCHED");
  assert.equal(activated.authorityRecord.lifecycle, GROUND_LIFECYCLE.ACTIVE);
  assert.deepEqual(activated.publicProjection.position, activated.authorityRecord.position);
  assert.equal(makeRuntime({ backing }).repository.read("scene-a", GROUND_ID).authorityRecord.lifecycle,
    GROUND_LIFECYCLE.ACTIVE);
});

test("G1B.2 mutación pública escribe Authority primero y proyecta todos los campos permitidos", async () => {
  const backing = {};
  const runtime = makeRuntime({ backing });
  await createActive(runtime);
  const patch = {
    visibility: GROUND_VISIBILITY.REVEALED,
    pickupEnabled: false,
    appearance: { mode: GROUND_APPEARANCE_MODE.REAL, img: "items/map.webp" },
    position: { x: 30, y: 40 }
  };
  const updated = await runtime.service.updateGroundPublicState("scene-a", GROUND_ID, patch, {
    transactionId: "public-mutation-1"
  });
  assert.equal(updated.status, "MATCHED");
  for (const field of ["visibility", "pickupEnabled", "appearance", "position"]) {
    assert.deepEqual(updated.publicProjection[field], patch[field]);
    assert.deepEqual(updated.authorityRecord[field], patch[field]);
  }
  patch.position.x = 999;
  updated.publicProjection.position.y = 999;
  assert.deepEqual(makeRuntime({ backing }).repository.read("scene-a", GROUND_ID).publicProjection.position,
    { x: 30, y: 40 });
});

test("G1B.2 mutación pública rechaza campos fuera de la allowlist", async () => {
  const runtime = makeRuntime();
  await createActive(runtime);
  for (const field of ["groundId", "sceneId", "itemSnapshot", "quantity", "provenance", "lifecycle"]) {
    await assert.rejects(runtime.service.updateGroundPublicState("scene-a", GROUND_ID, {
      [field]: field === "quantity" ? 3 : "evil"
    }, { transactionId: `reject-${field}` }), /permitido|patch/i);
  }
  assert.equal(runtime.repository.read("scene-a", GROUND_ID).status, "MATCHED");
});

test("G1B.2 fallo de Public write no retorna éxito, no revierte Authority y persiste RECOVERY_REQUIRED", async () => {
  const backing = {};
  const failures = { [GROUND_PUBLIC_FLAG]: new Set([2]) };
  const runtime = makeRuntime({ backing, failures });
  await createActive(runtime);
  let failure;
  try {
    await runtime.service.updateGroundPublicState("scene-a", GROUND_ID, {
      position: { x: 70, y: 80 }
    }, { transactionId: "partial-1" });
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof GroundLifecycleMutationError);
  assert.equal(failure.reasonCode, "GROUND_PUBLIC_WRITE_FAILED");
  assert.equal(failure.sceneId, "scene-a");
  assert.equal(failure.groundId, GROUND_ID);
  assert.equal(failure.transactionId, "partial-1");
  assert.equal(failure.pairState.status, "MISMATCHED");

  const durable = makeRuntime({ backing }).repository.read("scene-a", GROUND_ID);
  assert.equal(durable.status, "MISMATCHED");
  assert.deepEqual(durable.authorityRecord.position, { x: 70, y: 80 });
  assert.deepEqual(durable.publicProjection.position, { x: 10, y: 20 });
  assert.equal(durable.authorityRecord.lifecycle, GROUND_LIFECYCLE.RECOVERY_REQUIRED);
  assert.equal(durable.authorityRecord.recoveryEvidence.reasonCode, "GROUND_PUBLIC_WRITE_FAILED");
  assert.ok(durable.authorityRecord.recoveryEvidence.checkpoints.includes("authority-public-state-persisted"));
  assert.ok(durable.authorityRecord.recoveryEvidence.checkpoints.includes("public-write-failed"));
});

test("G1B.2 si también falla recovery conserva la primera escritura y reporta estado parcial durable", async () => {
  const backing = {};
  const failures = {
    [GROUND_PUBLIC_FLAG]: new Set([2]),
    [GROUND_AUTHORITY_FLAG]: new Set([4])
  };
  const runtime = makeRuntime({ backing, failures });
  await createActive(runtime);
  let failure;
  try {
    await runtime.service.updateGroundPublicState("scene-a", GROUND_ID, {
      pickupEnabled: false
    }, { transactionId: "partial-recovery-fails" });
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof GroundLifecycleMutationError);
  assert.equal(failure.reasonCode, "GROUND_RECOVERY_WRITE_FAILED");
  assert.equal(failure.lastCheckpoint, "authority-public-state-persisted");
  assert.equal(failure.pairState.status, "MISMATCHED");

  const durable = makeRuntime({ backing }).repository.read("scene-a", GROUND_ID);
  assert.equal(durable.status, "MISMATCHED");
  assert.equal(durable.authorityRecord.lifecycle, GROUND_LIFECYCLE.ACTIVE);
  assert.equal(durable.authorityRecord.pickupEnabled, false);
  assert.equal(durable.publicProjection.pickupEnabled, true);
  assert.equal(durable.authorityRecord.recoveryEvidence.transactionId, "partial-recovery-fails");
  assert.deepEqual(durable.authorityRecord.recoveryEvidence.checkpoints,
    ["authority-record-persisted", "authority-activated", "authority-public-state-persisted"]);
});

test("G1B.2 markRecoveryRequired preserva snapshot, quantity y provenance", async () => {
  const runtime = makeRuntime();
  await createActive(runtime);
  const before = runtime.repository.read("scene-a", GROUND_ID).authorityRecord;
  const recovered = await runtime.service.markRecoveryRequired("scene-a", GROUND_ID, {
    transactionId: "recovery-1",
    reasonCode: "EXTERNAL_AMBIGUITY",
    checkpoints: ["external-effect-observed"]
  });
  assert.equal(recovered.status, "MATCHED");
  assert.equal(recovered.authorityRecord.lifecycle, GROUND_LIFECYCLE.RECOVERY_REQUIRED);
  assert.equal(recovered.authorityRecord.recoveryEvidence.reasonCode, "EXTERNAL_AMBIGUITY");
  assert.deepEqual(recovered.authorityRecord.itemSnapshot, before.itemSnapshot);
  assert.equal(recovered.authorityRecord.quantity, before.quantity);
  assert.deepEqual(recovered.authorityRecord.provenance, before.provenance);
});

test("G1B.2 tombstone conserva Authority y publica una proyección inerte MATCHED", async () => {
  const backing = {};
  const runtime = makeRuntime({ backing });
  await createActive(runtime);
  const tombstoned = await runtime.service.tombstoneGround("scene-a", GROUND_ID, {
    transactionId: "tombstone-1"
  });
  assert.equal(tombstoned.status, "MATCHED");
  assert.equal(tombstoned.authorityRecord.lifecycle, GROUND_LIFECYCLE.TOMBSTONED);
  assert.equal(tombstoned.authorityRecord.visibility, GROUND_VISIBILITY.INVISIBLE);
  assert.equal(tombstoned.authorityRecord.pickupEnabled, false);
  assert.equal(tombstoned.publicProjection.visibility, GROUND_VISIBILITY.INVISIBLE);
  assert.equal(tombstoned.publicProjection.pickupEnabled, false);
  assert.ok(backing.mtrol[GROUND_AUTHORITY_FLAG].records[GROUND_ID]);
  assert.ok(backing.mtrol[GROUND_PUBLIC_FLAG].records[GROUND_ID]);
  assert.deepEqual(makeRuntime({ backing }).repository.read("scene-a", GROUND_ID), tombstoned);
});

test("G1B.2 tombstone con Public write fallido conserva tombstone detectable y no borra evidencia", async () => {
  const backing = {};
  const runtime = makeRuntime({ backing, failures: { [GROUND_PUBLIC_FLAG]: new Set([2]) } });
  await createActive(runtime);
  await assert.rejects(runtime.service.tombstoneGround("scene-a", GROUND_ID, {
    transactionId: "tombstone-partial"
  }), error => error instanceof GroundLifecycleMutationError &&
    error.reasonCode === "GROUND_PUBLIC_WRITE_FAILED" && error.pairState.status === "MISMATCHED");
  const durable = makeRuntime({ backing }).repository.read("scene-a", GROUND_ID);
  assert.equal(durable.authorityRecord.lifecycle, GROUND_LIFECYCLE.TOMBSTONED);
  assert.equal(durable.authorityRecord.recoveryEvidence.transactionId, "tombstone-partial");
  assert.ok(backing.mtrol[GROUND_AUTHORITY_FLAG].records[GROUND_ID]);
});

test("G1B.2 flujo completo recarga un estado canónico idéntico", async () => {
  const backing = {};
  const runtime = makeRuntime({ backing });
  await runtime.service.createPendingGround(createInput());
  await runtime.service.activateGround("scene-a", GROUND_ID, { transactionId: "chain-activate" });
  await runtime.service.updateGroundPublicState("scene-a", GROUND_ID, {
    visibility: GROUND_VISIBILITY.REVEALED,
    appearance: { mode: GROUND_APPEARANCE_MODE.REAL, img: "items/map.webp" },
    position: { x: 50, y: 60 },
    pickupEnabled: false
  }, { transactionId: "chain-public" });
  await runtime.service.markRecoveryRequired("scene-a", GROUND_ID, {
    transactionId: "chain-recovery",
    reasonCode: "CHAIN_REVIEW",
    checkpoints: ["chain-observed"]
  });
  const finalState = await runtime.service.tombstoneGround("scene-a", GROUND_ID, {
    transactionId: "chain-tombstone"
  });
  const reloadedState = makeRuntime({ backing }).repository.read("scene-a", GROUND_ID);
  assert.deepEqual(reloadedState, finalState);
  assert.equal(reloadedState.status, "MATCHED");
  assert.equal(reloadedState.authorityRecord.lifecycle, GROUND_LIFECYCLE.TOMBSTONED);
});

test("G1B.2 dos escrituras competidoras con la misma revision admiten una dentro del boundary local", async () => {
  const backing = {};
  const runtime = makeRuntime({ backing });
  await runtime.service.createPendingGround(createInput());
  const storage = runtime.repository.authorityStorage;
  const first = storage.read("scene-a");
  const stale = storage.read("scene-a");
  const results = await Promise.allSettled([
    storage.write("scene-a", first, { expectedRevision: first.revision }),
    storage.write("scene-a", stale, { expectedRevision: stale.revision })
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result => result.status === "rejected").length, 1);
  assert.ok(results.find(result => result.status === "rejected").reason instanceof GroundRevisionConflictError);
});

test("G1B.2 la facade serializa la operación Authority→Public completa por Ground", async () => {
  const runtime = makeRuntime();
  await createActive(runtime);
  const results = await Promise.allSettled([
    runtime.service.updateGroundPublicState("scene-a", GROUND_ID, {
      position: { x: 101, y: 201 }
    }, { transactionId: "competing-1" }),
    runtime.service.updateGroundPublicState("scene-a", GROUND_ID, {
      position: { x: 102, y: 202 }
    }, { transactionId: "competing-2" })
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 2);
  const durable = runtime.repository.read("scene-a", GROUND_ID);
  assert.equal(durable.status, "MATCHED");
  assert.equal(durable.authorityRecord.lifecycle, GROUND_LIFECYCLE.ACTIVE);
  assert.deepEqual(durable.authorityRecord.position, { x: 102, y: 202 });
  assert.deepEqual(durable.publicProjection.position, { x: 102, y: 202 });
});
