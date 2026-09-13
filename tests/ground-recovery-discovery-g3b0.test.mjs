import test from "node:test";
import assert from "node:assert/strict";

import { RecoveryCoordinator } from "../scripts/runtime/recovery-coordinator.js";

function coordinator() {
  return new RecoveryCoordinator({
    repository: { resolveCombat() { return null; } },
    receiptStore: {}
  });
}

test("G3B.0 RecoveryCoordinator descubre receipts ground.drop no terminales por Scene", async () => {
  const runtimes = new Map([
    ["scene-a", { receipts: {
      a: { transactionId: "tx-applying", command: "ground.drop", status: "applying" },
      b: { transactionId: "tx-completed", command: "ground.drop", status: "completed" },
      c: { transactionId: "other", command: "ground.inspect", status: "processing" }
    } }],
    ["scene-b", { receipts: {
      d: { transactionId: "tx-recovery", command: "ground.drop", status: "recovery-required" }
    } }]
  ]);
  const calls = [];
  const result = await coordinator().recoverGroundTransactions([
    { id: "scene-a" }, { id: "scene-b" }
  ], {
    isPrimaryGM: true,
    readRuntime: scene => runtimes.get(scene.id),
    recoverTransaction: async (sceneId, transactionId) => {
      calls.push([sceneId, transactionId]);
      if (transactionId === "tx-recovery") throw new Error("still ambiguous");
      return { transactionId };
    }
  });
  assert.deepEqual(calls, [["scene-a", "tx-applying"], ["scene-b", "tx-recovery"]]);
  assert.deepEqual(result.completedIds, ["tx-applying"]);
  assert.deepEqual(result.requiredIds, ["tx-recovery"]);
});

test("G3B.0 discovery Ground no escribe ni reconcilia cuando no es Primary", async () => {
  let reads = 0;
  let calls = 0;
  const result = await coordinator().recoverGroundTransactions([{ id: "scene-a" }], {
    isPrimaryGM: false,
    readRuntime: () => { reads += 1; return { receipts: {} }; },
    recoverTransaction: async () => { calls += 1; }
  });
  assert.deepEqual(result, { recovered: false, completedIds: [], requiredIds: [] });
  assert.equal(reads, 0);
  assert.equal(calls, 0);
});
