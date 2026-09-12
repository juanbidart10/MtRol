import test from "node:test";
import assert from "node:assert/strict";
import { SharedReservationLedger, RESERVATION_STATES } from "../scripts/runtime/shared-reservation-ledger.js";
import { TradeRuntimeRepository } from "../scripts/trade/trade-runtime-repository.js";

const real = async () => 5;
const record = (id, item = "Item.x", quantity = 2, domain = "trade") => ({ operationId: id, domain, actorUuid: "Actor.a", itemUuid: item, quantity });
const reacquire = (id, revision, quantity, mutationId = `reacquire-${id}`, mutationFingerprint = `fp-${id}-${revision}-${quantity}`) => ({ operationId: id, expectedRevision: revision, quantity, mutationId, mutationFingerprint });
const reacquireOp = (id, revision, quantity) => ({ type: "REACQUIRE", operationId: id, expectedRevision: revision, quantity });

async function released({ repository = new TradeRuntimeRepository(), id = "a", item = "Item.x", quantity = 2 } = {}) {
  const ledger = new SharedReservationLedger({ repository }); await ledger.reserve(record(id, item, quantity), { realQuantity: real }); await ledger.release(id); return { ledger, repository };
}

test("REACQUIRE explicitly moves RELEASED to RESERVED with new quantity and same identity", async () => {
  const { ledger } = await released(); const result = await ledger.reacquireReservation(reacquire("a", 1, 3), { realQuantity: real });
  assert.equal(result.reservation.operationId, "a"); assert.equal(result.reservation.state, RESERVATION_STATES.RESERVED); assert.equal(result.reservation.quantity, 3); assert.equal(result.reservation.revision, 2); assert.equal(ledger.list().length, 1);
});

test("insufficient capacity and stale revision preserve RELEASED exactly", async () => {
  const { ledger } = await released(); await ledger.reserve(record("other", "Item.x", 4, "ground-test"), { realQuantity: real }); const before = ledger.get("a");
  await assert.rejects(() => ledger.reacquireReservation(reacquire("a", 1, 2), { realQuantity: real }), error => error.reasonCode === "RESERVATION_CAPACITY_CONFLICT"); assert.deepEqual(ledger.get("a"), before);
  await assert.rejects(() => ledger.reacquireReservation(reacquire("a", 0, 1, "stale", "stale-f"), { realQuantity: real }), error => error.reasonCode === "RESERVATION_STALE_REVISION"); assert.deepEqual(ledger.get("a"), before);
});

test("REACQUIRE retry precedes stale CAS, survives reload and detects fingerprint conflict", async () => {
  const { ledger, repository } = await released(); const intent = reacquire("a", 1, 3, "m", "f"); await ledger.reacquireReservation(intent, { realQuantity: real });
  const reloaded = new SharedReservationLedger({ repository }); await reloaded.hydrateFromPersistence(); const retry = await reloaded.reacquireReservation(intent, { realQuantity: real });
  assert.equal(retry.idempotent, true); assert.equal(reloaded.get("a").revision, 2);
  await assert.rejects(() => reloaded.reacquireReservation({ ...intent, mutationFingerprint: "different" }, { realQuantity: real }), error => error.reasonCode === "RESERVATION_MUTATION_CONFLICT"); assert.equal(reloaded.get("a").revision, 2);
});

test("quarantine fences REACQUIRE without changing reservation or evidence", async () => {
  const { ledger } = await released(); await ledger.quarantineResource({ actorUuid: "Actor.a", itemUuid: "Item.x", reason: "LEGACY_RESERVATION_CONFLICT", evidence: { legacy: 3, ledger: 2 } }); const before = ledger.get("a"); const quarantineBefore = ledger.getResourceQuarantine("Actor.a", "Item.x");
  await assert.rejects(() => ledger.reacquireReservation(reacquire("a", 1, 1), { realQuantity: real }), error => error.reasonCode === "CAPACITY_QUARANTINED"); assert.deepEqual(ledger.get("a"), before); assert.deepEqual(ledger.getResourceQuarantine("Actor.a", "Item.x"), quarantineBefore);
});

test("REACQUIRE rejects every state except RELEASED", async () => {
  for (const target of [RESERVATION_STATES.RESERVED, RESERVATION_STATES.COMMITTING, RESERVATION_STATES.RECOVERY_REQUIRED, RESERVATION_STATES.COMMITTED, RESERVATION_STATES.ROLLED_BACK]) {
    const ledger = new SharedReservationLedger(); await ledger.reserve(record("a"), { realQuantity: real });
    if ([RESERVATION_STATES.COMMITTED, RESERVATION_STATES.ROLLED_BACK].includes(target)) await ledger.transition("a", RESERVATION_STATES.COMMITTING);
    if (target !== RESERVATION_STATES.RESERVED) await ledger.transition("a", target);
    const before = ledger.get("a"); await assert.rejects(() => ledger.reacquireReservation(reacquire("a", before.revision, 1, `m-${target}`, `f-${target}`), { realQuantity: real }), error => error.reasonCode === "RESERVATION_STATE_CONFLICT"); assert.deepEqual(ledger.get("a"), before);
  }
});

test("mixed set REACQUIRE + REPLACE + RELEASE is atomic", async () => {
  const ledger = new SharedReservationLedger();
  await ledger.reserve(record("a", "Item.a", 2), { realQuantity: real }); await ledger.release("a");
  await ledger.reserve(record("b", "Item.b", 1), { realQuantity: real }); await ledger.reserve(record("c", "Item.c", 2), { realQuantity: real });
  const result = await ledger.mutateReservationSet({ mutationId: "mixed", mutationFingerprint: "mixed-f", operations: [reacquireOp("a", 1, 2), { type: "REPLACE", operationId: "b", expectedRevision: 0, quantity: 2 }, { type: "RELEASE", operationId: "c", expectedRevision: 0 }] }, { realQuantity: real });
  assert.equal(result.reservations.length, 3); assert.deepEqual([ledger.get("a").state, ledger.get("b").quantity, ledger.get("c").state], [RESERVATION_STATES.RESERVED, 2, RESERVATION_STATES.RELEASED]);
});

test("failed REACQUIRE in mixed set preserves every entry", async () => {
  const { ledger } = await released(); await ledger.reserve(record("other", "Item.x", 4, "ground-test"), { realQuantity: real }); await ledger.reserve(record("b", "Item.b", 1), { realQuantity: real }); const before = ledger.list();
  await assert.rejects(() => ledger.mutateReservationSet({ mutationId: "mixed-fail", mutationFingerprint: "mixed-fail-f", operations: [reacquireOp("a", 1, 2), { type: "REPLACE", operationId: "b", expectedRevision: 0, quantity: 2 }] }, { realQuantity: real })); assert.deepEqual(ledger.list(), before);
});

test("final-state RELEASE funds REACQUIRE independent of operation order", async () => {
  async function run(operations) { const ledger = new SharedReservationLedger(); await ledger.reserve(record("a", "Item.x", 1), { realQuantity: real }); await ledger.release("a"); await ledger.reserve(record("b", "Item.x", 5), { realQuantity: real }); await ledger.mutateReservationSet({ mutationId: "swap", mutationFingerprint: "swap-f", operations }, { realQuantity: real }); return [ledger.get("a").state, ledger.get("a").quantity, ledger.get("b").state]; }
  assert.deepEqual(await run([{ type: "RELEASE", operationId: "b", expectedRevision: 0 }, reacquireOp("a", 1, 5)]), await run([reacquireOp("a", 1, 5), { type: "RELEASE", operationId: "b", expectedRevision: 0 }]));
});

test("REACQUIRE vs ground reserve and two REACQUIRE intents have one winner", async () => {
  const first = await released({ item: "Item.x", quantity: 1 });
  const race = await Promise.allSettled([first.ledger.reacquireReservation(reacquire("a", 1, 1, "r", "rf"), { realQuantity: async () => 1 }), first.ledger.reserve(record("ground", "Item.x", 1, "ground-test"), { realQuantity: async () => 1 })]);
  assert.equal(race.filter(result => result.status === "fulfilled").length, 1); assert.ok(first.ledger.reservedQuantity("Actor.a", "Item.x") <= 1);
  const second = await released(); const two = await Promise.allSettled([second.ledger.reacquireReservation(reacquire("a", 1, 2, "r1", "rf1"), { realQuantity: real }), second.ledger.reacquireReservation(reacquire("a", 1, 3, "r2", "rf2"), { realQuantity: real })]);
  assert.equal(two.filter(result => result.status === "fulfilled").length, 1); assert.equal(second.ledger.get("a").revision, 2);
});

test("persistence and cooperative authority failure preserve exact RELEASED state", async () => {
  class ToggleRepository extends TradeRuntimeRepository { fail = false; async write(...args) { if (this.fail) throw new Error("persist failed"); return super.write(...args); } }
  const repository = new ToggleRepository(); const persisted = await released({ repository }); const before = persisted.repository.read(); repository.fail = true;
  await assert.rejects(() => persisted.ledger.reacquireReservation(reacquire("a", 1, 3), { realQuantity: real }), /persist failed/); assert.deepEqual(repository.read(), before); assert.equal(persisted.ledger.get("a").state, RESERVATION_STATES.RELEASED);
  let checks = 0; const guarded = new SharedReservationLedger({ authority: { validateWriteContext() { if (++checks === 2) throw new Error("authority changed"); } } }); await guarded.reserve(record("a"), { realQuantity: real }); await guarded.release("a"); checks = 0;
  await assert.rejects(() => guarded.reacquireReservation(reacquire("a", 1, 3), { realQuantity: real, authorityContext: { generation: "old" } }), /authority changed/); assert.equal(guarded.get("a").state, RESERVATION_STATES.RELEASED);
});
