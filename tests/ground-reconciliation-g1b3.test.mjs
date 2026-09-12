import test from "node:test";
import assert from "node:assert/strict";

import {
  GROUND_VISIBILITY,
  GROUND_APPEARANCE_MODE,
  GROUND_LIFECYCLE
} from "../scripts/ground/ground-schema.js";
import {
  GROUND_PUBLIC_FLAG,
  GROUND_AUTHORITY_FLAG,
  GroundSceneFlagStorage,
  GroundPersistencePrimitive
} from "../scripts/ground/ground-repository.js";
import { GroundLifecycleService } from "../scripts/ground/ground-lifecycle-service.js";
import {
  GROUND_RECOVERY_CLASSIFICATION,
  GROUND_REPAIR_ACTION,
  GroundReconciliationError,
  GroundReconciliationService
} from "../scripts/ground/ground-reconciliation-service.js";
import { createItemTransferSnapshot } from "../scripts/items/item-transfer-data.js";

const GROUND_ID = "ground:world-one:AbCdEfGhIjKlMnOpQrStUvWx";

function snapshotFixture() {
  return createItemTransferSnapshot({
    uuid: "Actor.source.Item.source-item",
    toObject: () => ({
      _id: "source-item",
      name: "Llave secreta",
      type: "objeto",
      img: "items/key.webp",
      system: { cantidad: 3, formula: "1d10 + @secret" },
      flags: { mtrol: { classified: true } },
      effects: [{ _id: "effect-1", name: "Private" }]
    })
  });
}

class FakeScene {
  constructor(id, backing = {}, { failures = {}, ignored = {} } = {}) {
    this.id = id;
    this.flags = backing;
    this.failures = failures;
    this.ignored = ignored;
    this.writeCounts = new Map();
  }

  getFlag(scope, key) {
    return this.flags[scope]?.[key];
  }

  async setFlag(scope, key, value) {
    const count = (this.writeCounts.get(key) ?? 0) + 1;
    this.writeCounts.set(key, count);
    if (this.failures[key]?.has(count)) throw new Error(`forced ${key} write ${count}`);
    if (this.ignored[key]?.has(count)) return structuredClone(value);
    this.flags[scope] ??= {};
    this.flags[scope][key] = structuredClone(value);
    return structuredClone(value);
  }
}

function makeRuntime({ backing = {}, failures = {}, ignored = {} } = {}) {
  const scene = new FakeScene("scene-a", backing, { failures, ignored });
  const resolveScene = sceneId => sceneId === scene.id ? scene : null;
  const repository = new GroundPersistencePrimitive({
    publicStorage: new GroundSceneFlagStorage({
      flagKey: GROUND_PUBLIC_FLAG, recordKind: "public", resolveScene
    }),
    authorityStorage: new GroundSceneFlagStorage({
      flagKey: GROUND_AUTHORITY_FLAG, recordKind: "authority", resolveScene
    })
  });
  const lifecycle = new GroundLifecycleService({ repository, idFactory: () => GROUND_ID });
  const reconciliation = new GroundReconciliationService({ repository, lifecycleService: lifecycle });
  return { scene, repository, lifecycle, reconciliation };
}

function createInput() {
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
    }
  };
}

async function createAt(runtime, lifecycle) {
  await runtime.lifecycle.createPendingGround(createInput());
  if (lifecycle === GROUND_LIFECYCLE.PENDING) return;
  await runtime.lifecycle.activateGround("scene-a", GROUND_ID, { transactionId: "activate-1" });
  if (lifecycle === GROUND_LIFECYCLE.ACTIVE) return;
  if (lifecycle === GROUND_LIFECYCLE.PICKUP_PENDING) {
    await runtime.repository.updateAuthority("scene-a", GROUND_ID, {
      lifecycle: GROUND_LIFECYCLE.PICKUP_PENDING
    });
    return;
  }
  if (lifecycle === GROUND_LIFECYCLE.RECOVERY_REQUIRED) {
    await runtime.lifecycle.markRecoveryRequired("scene-a", GROUND_ID, {
      transactionId: "recovery-1", reasonCode: "PUBLIC_WRITE_FAILED", checkpoints: ["authority-write-verified"]
    });
    return;
  }
  await runtime.lifecycle.tombstoneGround("scene-a", GROUND_ID, { transactionId: "tombstone-1" });
}

function removeSide(backing, flagKey) {
  delete backing.mtrol[flagKey].records[GROUND_ID];
  backing.mtrol[flagKey].revision += 1;
}

function writeCount(scene) {
  return [...scene.writeCounts.values()].reduce((total, count) => total + count, 0);
}

test("G1B.3 inspection MATCHED distingue ACTIVE, PENDING, RECOVERY_REQUIRED y TOMBSTONED sin escribir", async () => {
  const expectations = [
    [GROUND_LIFECYCLE.ACTIVE, GROUND_RECOVERY_CLASSIFICATION.HEALTHY],
    [GROUND_LIFECYCLE.PENDING, GROUND_RECOVERY_CLASSIFICATION.CONSISTENT_PENDING],
    [GROUND_LIFECYCLE.RECOVERY_REQUIRED, GROUND_RECOVERY_CLASSIFICATION.RECOVERY_REQUIRED],
    [GROUND_LIFECYCLE.TOMBSTONED, GROUND_RECOVERY_CLASSIFICATION.CONSISTENT_TOMBSTONED]
  ];
  for (const [lifecycle, classification] of expectations) {
    const runtime = makeRuntime();
    await createAt(runtime, lifecycle);
    const before = writeCount(runtime.scene);
    const inspection = runtime.reconciliation.inspectGroundRecovery("scene-a", GROUND_ID);
    assert.equal(inspection.pairStatus, "MATCHED");
    assert.equal(inspection.authorityLifecycle, lifecycle);
    assert.equal(inspection.classification, classification);
    assert.equal(inspection.proposedAction, GROUND_REPAIR_ACTION.NONE);
    assert.equal(writeCount(runtime.scene), before);
    if (lifecycle === GROUND_LIFECYCLE.PENDING) assert.notEqual(classification, GROUND_RECOVERY_CLASSIFICATION.HEALTHY);
    if (lifecycle === GROUND_LIFECYCLE.RECOVERY_REQUIRED) assert.notEqual(classification, GROUND_RECOVERY_CLASSIFICATION.HEALTHY);
  }
});

test("G1B.3 AUTHORITY_ONLY ACTIVE reconstruye Public desde Authority y sobrevive reload", async () => {
  const backing = {};
  const runtime = makeRuntime({ backing });
  await createAt(runtime, GROUND_LIFECYCLE.ACTIVE);
  const authorityBefore = structuredClone(runtime.repository.read("scene-a", GROUND_ID).authorityRecord);
  removeSide(backing, GROUND_PUBLIC_FLAG);
  const inspection = runtime.reconciliation.inspectGroundRecovery("scene-a", GROUND_ID);
  assert.equal(inspection.pairStatus, "AUTHORITY_ONLY");
  assert.equal(inspection.classification, GROUND_RECOVERY_CLASSIFICATION.REPAIRABLE_FROM_AUTHORITY);
  assert.equal(inspection.proposedAction, GROUND_REPAIR_ACTION.REBUILD_PUBLIC_FROM_AUTHORITY);
  const repaired = await runtime.reconciliation.repairGround(inspection.repairPlan);
  assert.equal(repaired.outcome, "REPAIRED");
  assert.equal(repaired.state.status, "MATCHED");
  assert.deepEqual(repaired.state.authorityRecord.itemSnapshot, authorityBefore.itemSnapshot);
  assert.equal(repaired.state.authorityRecord.quantity, authorityBefore.quantity);
  assert.deepEqual(repaired.state.authorityRecord.provenance, authorityBefore.provenance);
  assert.deepEqual(makeRuntime({ backing }).repository.read("scene-a", GROUND_ID), repaired.state);
});

test("G1B.3 AUTHORITY_ONLY TOMBSTONED reconstruye sólo una proyección inerte", async () => {
  const runtime = makeRuntime();
  await createAt(runtime, GROUND_LIFECYCLE.TOMBSTONED);
  removeSide(runtime.scene.flags, GROUND_PUBLIC_FLAG);
  const inspection = runtime.reconciliation.inspectGroundRecovery("scene-a", GROUND_ID);
  assert.equal(inspection.proposedAction, GROUND_REPAIR_ACTION.REBUILD_TOMBSTONE_PUBLIC);
  const repaired = await runtime.reconciliation.repairGround(inspection.repairPlan);
  assert.equal(repaired.state.status, "MATCHED");
  assert.equal(repaired.state.authorityRecord.lifecycle, GROUND_LIFECYCLE.TOMBSTONED);
  assert.equal(repaired.state.publicProjection.visibility, GROUND_VISIBILITY.INVISIBLE);
  assert.equal(repaired.state.publicProjection.pickupEnabled, false);
});

test("G1B.3 AUTHORITY_ONLY PENDING queda bloqueado y jamás se activa", async () => {
  const runtime = makeRuntime();
  await createAt(runtime, GROUND_LIFECYCLE.PENDING);
  removeSide(runtime.scene.flags, GROUND_PUBLIC_FLAG);
  const before = structuredClone(runtime.scene.flags);
  const inspection = runtime.reconciliation.inspectGroundRecovery("scene-a", GROUND_ID);
  assert.equal(inspection.classification, GROUND_RECOVERY_CLASSIFICATION.BLOCKED_UNSAFE_LIFECYCLE);
  assert.equal(inspection.repairPlan, null);
  await assert.rejects(runtime.reconciliation.repairGround(inspection.repairPlan));
  assert.deepEqual(runtime.scene.flags, before);
  assert.equal(runtime.repository.read("scene-a", GROUND_ID).authorityRecord.lifecycle, GROUND_LIFECYCLE.PENDING);
});

for (const lifecycle of [GROUND_LIFECYCLE.RECOVERY_REQUIRED, GROUND_LIFECYCLE.PICKUP_PENDING]) {
  test(`G1B.3 AUTHORITY_ONLY ${lifecycle} repara proyección sin resolver lifecycle`, async () => {
    const runtime = makeRuntime();
    await createAt(runtime, lifecycle);
    removeSide(runtime.scene.flags, GROUND_PUBLIC_FLAG);
    const inspection = runtime.reconciliation.inspectGroundRecovery("scene-a", GROUND_ID);
    assert.equal(inspection.classification, GROUND_RECOVERY_CLASSIFICATION.REPAIRABLE_FROM_AUTHORITY);
    const repaired = await runtime.reconciliation.repairGround(inspection.repairPlan);
    assert.equal(repaired.state.status, "MATCHED");
    assert.equal(repaired.state.authorityRecord.lifecycle, lifecycle);
    assert.notEqual(repaired.inspection.classification, GROUND_RECOVERY_CLASSIFICATION.HEALTHY);
  });
}

test("G1B.3 PUBLIC_ONLY queda bloqueado, no fabrica Authority y preserva Public", async () => {
  const runtime = makeRuntime();
  await createAt(runtime, GROUND_LIFECYCLE.ACTIVE);
  removeSide(runtime.scene.flags, GROUND_AUTHORITY_FLAG);
  const publicBefore = structuredClone(runtime.scene.flags.mtrol[GROUND_PUBLIC_FLAG]);
  const inspection = runtime.reconciliation.inspectGroundRecovery("scene-a", GROUND_ID);
  assert.equal(inspection.classification, GROUND_RECOVERY_CLASSIFICATION.BLOCKED_MISSING_AUTHORITY);
  assert.equal(inspection.repairPlan, null);
  await assert.rejects(runtime.reconciliation.repairGround(null));
  assert.equal(runtime.repository.read("scene-a", GROUND_ID).authorityRecord, null);
  assert.deepEqual(runtime.scene.flags.mtrol[GROUND_PUBLIC_FLAG], publicBefore);
});

for (const [field, staleValue] of [
  ["position", { x: 999, y: 999 }],
  ["visibility", GROUND_VISIBILITY.REVEALED],
  ["pickupEnabled", false],
  ["appearance", { mode: GROUND_APPEARANCE_MODE.REAL, img: "items/wrong.webp" }]
]) {
  test(`G1B.3 MISMATCHED ${field} repara Authority → Public`, async () => {
    const runtime = makeRuntime();
    await createAt(runtime, GROUND_LIFECYCLE.ACTIVE);
    const authority = structuredClone(runtime.repository.read("scene-a", GROUND_ID).authorityRecord);
    await runtime.repository.updatePublic("scene-a", GROUND_ID, { [field]: staleValue });
    const inspection = runtime.reconciliation.inspectGroundRecovery("scene-a", GROUND_ID);
    assert.equal(inspection.pairStatus, "MISMATCHED");
    assert.equal(inspection.classification, GROUND_RECOVERY_CLASSIFICATION.REPAIRABLE_FROM_AUTHORITY);
    const repaired = await runtime.reconciliation.repairGround(inspection.repairPlan);
    assert.equal(repaired.state.status, "MATCHED");
    assert.deepEqual(repaired.state.publicProjection[field], authority[field]);
    assert.deepEqual(repaired.state.authorityRecord, authority);
  });
}

test("G1B.3 tombstone stale nunca se repara a visible ni pickup habilitado", async () => {
  const runtime = makeRuntime();
  await createAt(runtime, GROUND_LIFECYCLE.TOMBSTONED);
  await runtime.repository.updatePublic("scene-a", GROUND_ID, {
    visibility: GROUND_VISIBILITY.REVEALED,
    pickupEnabled: true
  });
  const repaired = await runtime.reconciliation.repairGround(
    runtime.reconciliation.inspectGroundRecovery("scene-a", GROUND_ID).repairPlan
  );
  assert.equal(repaired.state.status, "MATCHED");
  assert.equal(repaired.state.publicProjection.visibility, GROUND_VISIBILITY.INVISIBLE);
  assert.equal(repaired.state.publicProjection.pickupEnabled, false);
});

test("G1B.3 malformed y unsupported schema se clasifican CORRUPT sin modificar persistence", () => {
  for (const corruptEnvelope of [
    { schemaVersion: 99, revision: 1, sceneId: "scene-a", records: {} },
    { schemaVersion: 1, revision: "bad", sceneId: "scene-a", records: {} }
  ]) {
    const backing = { mtrol: { [GROUND_PUBLIC_FLAG]: structuredClone(corruptEnvelope) } };
    const runtime = makeRuntime({ backing });
    const before = structuredClone(backing);
    const inspection = runtime.reconciliation.inspectGroundRecovery("scene-a", GROUND_ID);
    assert.equal(inspection.pairStatus, "CORRUPT");
    assert.equal(inspection.classification, GROUND_RECOVERY_CLASSIFICATION.CORRUPT);
    assert.equal(inspection.repairPlan, null);
    assert.deepEqual(backing, before);
  }
});

test("G1B.3 groundId/sceneId estructuralmente inconsistentes quedan CORRUPT y preservados", async () => {
  for (const corrupt of [
    record => { record.groundId = "ground:world-one:ZbCdEfGhIjKlMnOpQrStUvWx"; },
    record => { record.sceneId = "scene-b"; }
  ]) {
    const backing = {};
    const runtime = makeRuntime({ backing });
    await createAt(runtime, GROUND_LIFECYCLE.ACTIVE);
    corrupt(backing.mtrol[GROUND_PUBLIC_FLAG].records[GROUND_ID]);
    const before = structuredClone(backing);
    const inspection = runtime.reconciliation.inspectGroundRecovery("scene-a", GROUND_ID);
    assert.equal(inspection.pairStatus, "CORRUPT");
    assert.equal(inspection.classification, GROUND_RECOVERY_CLASSIFICATION.CORRUPT);
    assert.equal(inspection.repairPlan, null);
    assert.deepEqual(backing, before);
  }
});

test("G1B.3 un repair plan stale no pisa una Authority mutation posterior", async () => {
  const runtime = makeRuntime();
  await createAt(runtime, GROUND_LIFECYCLE.ACTIVE);
  await runtime.repository.updatePublic("scene-a", GROUND_ID, { position: { x: 900, y: 900 } });
  const stalePlan = runtime.reconciliation.inspectGroundRecovery("scene-a", GROUND_ID).repairPlan;
  await runtime.repository.updateAuthority("scene-a", GROUND_ID, { position: { x: 30, y: 40 } });
  await assert.rejects(runtime.reconciliation.repairGround(stalePlan), error =>
    error instanceof GroundReconciliationError && error.reasonCode === "GROUND_REPAIR_PLAN_STALE");
  const durable = runtime.repository.read("scene-a", GROUND_ID);
  assert.deepEqual(durable.authorityRecord.position, { x: 30, y: 40 });
  assert.deepEqual(durable.publicProjection.position, { x: 900, y: 900 });
});

test("G1B.3 retry del mismo repair es no-op idempotente y no duplica evidence", async () => {
  const runtime = makeRuntime();
  await createAt(runtime, GROUND_LIFECYCLE.ACTIVE);
  await runtime.repository.updatePublic("scene-a", GROUND_ID, { pickupEnabled: false });
  const plan = runtime.reconciliation.inspectGroundRecovery("scene-a", GROUND_ID).repairPlan;
  const evidenceBefore = structuredClone(runtime.repository.read("scene-a", GROUND_ID).authorityRecord.recoveryEvidence);
  const first = await runtime.reconciliation.repairGround(plan);
  const revisionAfterFirst = runtime.repository.readWithRevisions("scene-a", GROUND_ID).revisions.public;
  const retry = await runtime.reconciliation.repairGround(plan);
  assert.equal(first.outcome, "REPAIRED");
  assert.equal(retry.outcome, "NO_OP");
  assert.equal(runtime.repository.readWithRevisions("scene-a", GROUND_ID).revisions.public, revisionAfterFirst);
  assert.deepEqual(retry.state.authorityRecord.recoveryEvidence, evidenceBefore);
});

test("G1B.3 repair write fallido no reporta éxito y conserva estado durable", async () => {
  const backing = {};
  const runtime = makeRuntime({ backing, failures: { [GROUND_PUBLIC_FLAG]: new Set([3]) } });
  await createAt(runtime, GROUND_LIFECYCLE.ACTIVE);
  await runtime.repository.updatePublic("scene-a", GROUND_ID, { position: { x: 90, y: 90 } });
  const plan = runtime.reconciliation.inspectGroundRecovery("scene-a", GROUND_ID).repairPlan;
  await assert.rejects(runtime.reconciliation.repairGround(plan), error =>
    error instanceof GroundReconciliationError && error.reasonCode === "GROUND_REPAIR_WRITE_FAILED");
  assert.equal(makeRuntime({ backing }).repository.read("scene-a", GROUND_ID).status, "MISMATCHED");
});

test("G1B.3 setFlag resuelto sin persistir falla post-write verification", async () => {
  const backing = {};
  const runtime = makeRuntime({ backing, ignored: { [GROUND_PUBLIC_FLAG]: new Set([3]) } });
  await createAt(runtime, GROUND_LIFECYCLE.ACTIVE);
  await runtime.repository.updatePublic("scene-a", GROUND_ID, { position: { x: 91, y: 91 } });
  const plan = runtime.reconciliation.inspectGroundRecovery("scene-a", GROUND_ID).repairPlan;
  await assert.rejects(runtime.reconciliation.repairGround(plan), error =>
    error instanceof GroundReconciliationError && error.reasonCode === "GROUND_REPAIR_VERIFICATION_FAILED");
  assert.equal(runtime.repository.read("scene-a", GROUND_ID).status, "MISMATCHED");
});

test("G1B.3 ABSENT es no-op diagnóstico y scene inspection no muta", () => {
  const runtime = makeRuntime();
  const before = structuredClone(runtime.scene.flags);
  const absent = runtime.reconciliation.inspectGroundRecovery("scene-a", GROUND_ID);
  assert.equal(absent.pairStatus, "ABSENT");
  assert.equal(absent.classification, GROUND_RECOVERY_CLASSIFICATION.ABSENT);
  assert.equal(absent.proposedAction, GROUND_REPAIR_ACTION.NONE);
  assert.equal(absent.repairPlan, null);
  assert.deepEqual(runtime.reconciliation.inspectSceneGround("scene-a"), []);
  assert.deepEqual(runtime.scene.flags, before);
});
