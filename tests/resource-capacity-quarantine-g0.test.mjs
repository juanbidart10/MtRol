import test from "node:test";
import assert from "node:assert/strict";
import { SharedReservationLedger, RESERVATION_STATES } from "../scripts/runtime/shared-reservation-ledger.js";
import { TradeRuntimeRepository } from "../scripts/trade/trade-runtime-repository.js";

const real5 = async () => 5;
const reservation = (id, quantity = 2, domain = "trade") => ({ operationId: id, domain, actorUuid: "Actor.a", itemUuid: "Item.x", quantity });
const quarantine = (evidence = { legacyQuantity: 3, ledgerQuantity: 2, realQuantity: 5 }) => ({ actorUuid: "Actor.a", itemUuid: "Item.x", reason: "LEGACY_RESERVATION_CONFLICT", evidence });

async function fixture() {
  const repository = new TradeRuntimeRepository(); const ledger = new SharedReservationLedger({ repository });
  await ledger.reserve(reservation("trade", 2), { realQuantity: real5 });
  return { repository, ledger };
}

test("quarantine preserves conflicting evidence without inventing reservation quantity", async () => {
  const { ledger } = await fixture(); const beforeReservations = ledger.list();
  const created = await ledger.quarantineResource(quarantine());
  assert.equal(created.state, "ACTIVE"); assert.equal("quantity" in created, false);
  assert.deepEqual(ledger.list(), beforeReservations); assert.equal(ledger.get("trade").quantity, 2);
  assert.equal(ledger.list().length, 1);
});

test("same quarantine is idempotent and additional evidence is preserved non-destructively", async () => {
  const { ledger } = await fixture();
  const first = await ledger.quarantineResource(quarantine());
  const retry = await ledger.quarantineResource(quarantine());
  assert.equal(retry.revision, first.revision); assert.equal(retry.evidence.length, 1);
  const augmented = await ledger.quarantineResource(quarantine({ legacyQuantity: 4, ledgerQuantity: 2, realQuantity: 5 }));
  assert.equal(augmented.evidence.length, 2); assert.deepEqual(augmented.evidence[0].data, first.evidence[0].data);
});

test("reserve is fenced cross-domain while quarantined", async () => {
  const { ledger } = await fixture(); await ledger.quarantineResource(quarantine()); const before = ledger.list();
  for (const domain of ["trade", "ground-test", "future-domain"]) {
    await assert.rejects(() => ledger.reserve(reservation(`new-${domain}`, 1, domain), { realQuantity: real5 }), error => error.reasonCode === "CAPACITY_QUARANTINED");
  }
  assert.deepEqual(ledger.list(), before);
});

test("replace increase/decrease and release cannot alter quarantined resource", async () => {
  const { ledger } = await fixture(); await ledger.quarantineResource(quarantine()); const before = ledger.get("trade");
  for (const quantity of [3, 1]) {
    await assert.rejects(() => ledger.replaceReservation({ operationId: "trade", expectedRevision: 0, quantity, mutationId: `m-${quantity}`, mutationFingerprint: `f-${quantity}` }, { realQuantity: real5 }), error => error.reasonCode === "CAPACITY_QUARANTINED");
  }
  await assert.rejects(() => ledger.release("trade"), error => error.reasonCode === "CAPACITY_QUARANTINED");
  assert.deepEqual(ledger.get("trade"), before);
});

test("batch and set mutation remain all-or-nothing when one resource is quarantined", async () => {
  const { ledger } = await fixture();
  await ledger.reserve({ operationId: "safe", domain: "trade", actorUuid: "Actor.a", itemUuid: "Item.y", quantity: 1 }, { realQuantity: real5 });
  await ledger.quarantineResource(quarantine()); const before = ledger.list();
  await assert.rejects(() => ledger.replaceReservationsBatch({ mutationId: "batch", mutationFingerprint: "batch-f", entries: [{ operationId: "trade", expectedRevision: 0, quantity: 3 }, { operationId: "safe", expectedRevision: 0, quantity: 2 }] }, { realQuantity: real5 }), error => error.reasonCode === "CAPACITY_QUARANTINED");
  await assert.rejects(() => ledger.mutateReservationSet({ mutationId: "set", mutationFingerprint: "set-f", operations: [{ type: "CREATE", operationId: "blocked", domain: "trade", actorUuid: "Actor.a", itemUuid: "Item.x", quantity: 1 }, { type: "REPLACE", operationId: "safe", expectedRevision: 0, quantity: 2 }] }, { realQuantity: real5 }), error => error.reasonCode === "CAPACITY_QUARANTINED");
  assert.deepEqual(ledger.list(), before);
});

test("quarantine survives reload and remains the single resource identity", async () => {
  const { ledger, repository } = await fixture(); await ledger.quarantineResource(quarantine());
  const reloaded = new SharedReservationLedger({ repository }); await reloaded.hydrateFromPersistence();
  assert.equal(reloaded.getResourceQuarantine("Actor.a", "Item.x").reason, "LEGACY_RESERVATION_CONFLICT");
  await assert.rejects(() => reloaded.reserve(reservation("after-reload", 1, "ground-test"), { realQuantity: real5 }), error => error.reasonCode === "CAPACITY_QUARANTINED");
  assert.equal(reloaded.listResourceQuarantines().length, 1);
});

test("quarantine creation and reserve serialize coherently", async () => {
  const repository = new TradeRuntimeRepository(); const ledger = new SharedReservationLedger({ repository });
  const race = await Promise.allSettled([ledger.quarantineResource(quarantine()), ledger.reserve(reservation("race", 1, "ground-test"), { realQuantity: real5 })]);
  assert.equal(race.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(ledger.listResourceQuarantines().length, 1);
  const existing = ledger.get("race"); if (existing) assert.equal(existing.quantity, 1);
});

test("a reservation that wins before quarantine is preserved as evidence and later reserves are fenced", async () => {
  const repository = new TradeRuntimeRepository(); const ledger = new SharedReservationLedger({ repository });
  await ledger.reserve(reservation("winner", 1, "ground-test"), { realQuantity: real5 });
  await ledger.quarantineResource(quarantine());
  assert.equal(ledger.get("winner").quantity, 1);
  await assert.rejects(() => ledger.reserve(reservation("later", 1, "trade"), { realQuantity: real5 }), error => error.reasonCode === "CAPACITY_QUARANTINED");
  assert.equal(ledger.list().length, 1);
});

test("stale authority and persistence failure do not create RAM-only quarantine", async () => {
  const authorityLedger = new SharedReservationLedger({ authority: { validateWriteContext() { throw new Error("stale"); } } });
  await assert.rejects(() => authorityLedger.quarantineResource(quarantine(), { authorityContext: { generation: "old" } }), /stale/);
  assert.equal(authorityLedger.listResourceQuarantines().length, 0);

  class FailingRepository extends TradeRuntimeRepository { async write() { throw new Error("persist failed"); } }
  const ledger = new SharedReservationLedger({ repository: new FailingRepository() });
  await assert.rejects(() => ledger.quarantineResource(quarantine()), /persist failed/);
  assert.equal(ledger.listResourceQuarantines().length, 0);
});

test("RECOVERY_REQUIRED remains distinct from resource quarantine", async () => {
  const { ledger } = await fixture(); await ledger.quarantineResource(quarantine());
  await ledger.recoveryRequired("trade", { evidence: { reason: "operation-ambiguous" } });
  assert.equal(ledger.get("trade").state, RESERVATION_STATES.RECOVERY_REQUIRED);
  assert.equal(ledger.getResourceQuarantine("Actor.a", "Item.x").state, "ACTIVE");
});
