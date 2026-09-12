import test from "node:test";
import assert from "node:assert/strict";
import { SharedReservationLedger, RESERVATION_STATES } from "../scripts/runtime/shared-reservation-ledger.js";
import { TradeRuntimeRepository } from "../scripts/trade/trade-runtime-repository.js";

const base = (operationId, itemUuid, quantity, domain = "trade") => ({ operationId, domain, actorUuid: "Actor.a", itemUuid, quantity });
const replacement = (operationId, expectedRevision, quantity, mutationId, mutationFingerprint) => ({ operationId, expectedRevision, quantity, mutationId, mutationFingerprint });
const real5 = async () => 5;

async function seeded(repository = new TradeRuntimeRepository()) {
  const ledger = new SharedReservationLedger({ repository });
  await ledger.reserve(base("trade:s:a:Item.a", "Item.a", 3), { realQuantity: real5 });
  return { ledger, repository };
}

test("replaceReservation increases and decreases without changing identity", async () => {
  const { ledger } = await seeded();
  const increased = await ledger.replaceReservation(replacement("trade:s:a:Item.a", 0, 5, "m1", "f1"), { realQuantity: real5 });
  assert.equal(increased.reservation.quantity, 5); assert.equal(increased.reservation.revision, 1);
  const decreased = await ledger.replaceReservation(replacement("trade:s:a:Item.a", 1, 2, "m2", "f2"), { realQuantity: real5 });
  assert.equal(decreased.reservation.quantity, 2); assert.equal(decreased.reservation.revision, 2);
  assert.equal(ledger.list().length, 1);
});

test("failed increase preserves own and other reservations exactly", async () => {
  const { ledger } = await seeded();
  await ledger.reserve(base("ground", "Item.a", 1, "ground-test"), { realQuantity: real5 });
  const before = ledger.list();
  await assert.rejects(() => ledger.replaceReservation(replacement("trade:s:a:Item.a", 0, 5, "m1", "f1"), { realQuantity: real5 }), error => error.reasonCode === "RESERVATION_CAPACITY_CONFLICT");
  assert.deepEqual(ledger.list(), before);
  const ok = await ledger.replaceReservation(replacement("trade:s:a:Item.a", 0, 4, "m2", "f2"), { realQuantity: real5 });
  assert.equal(ok.reservation.quantity, 4);
});

test("retry wins before stale revision and fingerprint conflict changes nothing", async () => {
  const { ledger } = await seeded();
  const request = replacement("trade:s:a:Item.a", 0, 4, "m1", "f1");
  const first = await ledger.replaceReservation(request, { realQuantity: real5 });
  const retry = await ledger.replaceReservation(request, { realQuantity: real5 });
  assert.equal(retry.idempotent, true); assert.equal(retry.reservation.revision, 1);
  await assert.rejects(() => ledger.replaceReservation({ ...request, mutationFingerprint: "different" }, { realQuantity: real5 }), error => error.reasonCode === "RESERVATION_MUTATION_CONFLICT");
  assert.equal(ledger.get(request.operationId).revision, 1);
});

test("new mutation with stale revision and replacement in illegal states are rejected", async () => {
  for (const state of [RESERVATION_STATES.COMMITTING, RESERVATION_STATES.RECOVERY_REQUIRED, RESERVATION_STATES.COMMITTED, RESERVATION_STATES.ROLLED_BACK, RESERVATION_STATES.RELEASED]) {
    const { ledger } = await seeded();
    if ([RESERVATION_STATES.COMMITTED, RESERVATION_STATES.ROLLED_BACK].includes(state)) {
      await ledger.transition("trade:s:a:Item.a", RESERVATION_STATES.COMMITTING);
    }
    await ledger.transition("trade:s:a:Item.a", state);
    const before = ledger.get("trade:s:a:Item.a");
    await assert.rejects(() => ledger.replaceReservation(replacement(before.operationId, before.revision, 2, `m-${state}`, `f-${state}`), { realQuantity: real5 }));
    assert.deepEqual(ledger.get(before.operationId), before);
  }
  const { ledger } = await seeded();
  await assert.rejects(() => ledger.replaceReservation(replacement("trade:s:a:Item.a", 99, 2, "stale", "stale-f"), { realQuantity: real5 }), error => error.reasonCode === "RESERVATION_STALE_REVISION");
});

test("replace idempotence survives reload", async () => {
  const { ledger, repository } = await seeded();
  const request = replacement("trade:s:a:Item.a", 0, 4, "m1", "f1");
  await ledger.replaceReservation(request, { realQuantity: real5 });
  const reloaded = new SharedReservationLedger({ repository }); await reloaded.hydrateFromPersistence();
  const retry = await reloaded.replaceReservation(request, { realQuantity: real5 });
  assert.equal(retry.idempotent, true); assert.equal(retry.reservation.quantity, 4); assert.equal(retry.reservation.revision, 1);
});

test("batch succeeds atomically and retry survives reload", async () => {
  const repository = new TradeRuntimeRepository(); const ledger = new SharedReservationLedger({ repository });
  await ledger.reserve(base("a", "Item.a", 2), { realQuantity: real5 }); await ledger.reserve(base("b", "Item.b", 1), { realQuantity: real5 });
  const request = { mutationId: "batch-1", mutationFingerprint: "batch-f1", entries: [replacement("a", 0, 3), replacement("b", 0, 2)] };
  const first = await ledger.replaceReservationsBatch(request, { realQuantity: real5 });
  assert.deepEqual(first.reservations.map(r => [r.quantity, r.revision]), [[3, 1], [2, 1]]);
  const reloaded = new SharedReservationLedger({ repository }); await reloaded.hydrateFromPersistence();
  const retry = await reloaded.replaceReservationsBatch(request, { realQuantity: real5 });
  assert.equal(retry.idempotent, true); assert.deepEqual(retry.reservations.map(r => r.revision), [1, 1]);
});

test("batch capacity failure, stale entry, duplicate identity and fingerprint conflict change nothing", async () => {
  const cases = [
    { id: "capacity", entries: [replacement("a", 0, 3), replacement("b", 0, 6)] },
    { id: "stale", entries: [replacement("a", 0, 3), replacement("b", 9, 2)] },
    { id: "duplicate", entries: [replacement("a", 0, 3), replacement("a", 0, 2)] }
  ];
  for (const candidate of cases) {
    const repository = new TradeRuntimeRepository(); const ledger = new SharedReservationLedger({ repository });
    await ledger.reserve(base("a", "Item.a", 2), { realQuantity: real5 }); await ledger.reserve(base("b", "Item.b", 1), { realQuantity: real5 });
    const before = ledger.list();
    await assert.rejects(() => ledger.replaceReservationsBatch({ mutationId: candidate.id, mutationFingerprint: `f-${candidate.id}`, entries: candidate.entries }, { realQuantity: real5 }));
    assert.deepEqual(ledger.list(), before);
  }
  const { ledger } = await seeded(); const req = { mutationId: "batch", mutationFingerprint: "one", entries: [replacement("trade:s:a:Item.a", 0, 2)] };
  await ledger.replaceReservationsBatch(req, { realQuantity: real5 });
  await assert.rejects(() => ledger.replaceReservationsBatch({ ...req, mutationFingerprint: "two" }, { realQuantity: real5 }), error => error.reasonCode === "RESERVATION_MUTATION_CONFLICT");
});

test("mixed batch uses final joint capacity and concurrent contenders cannot overcommit", async () => {
  const repository = new TradeRuntimeRepository(); const ledger = new SharedReservationLedger({ repository });
  await ledger.reserve(base("a", "Item.x", 3), { realQuantity: real5 }); await ledger.reserve(base("b", "Item.x", 2), { realQuantity: real5 });
  await ledger.replaceReservationsBatch({ mutationId: "mixed", mutationFingerprint: "mixed-f", entries: [replacement("a", 0, 2), replacement("b", 0, 3)] }, { realQuantity: real5 });
  assert.equal(ledger.reservedQuantity("Actor.a", "Item.x"), 5);
  await ledger.replaceReservation(replacement("b", 1, 2, "free-one", "free-one-f"), { realQuantity: real5 });
  const race = await Promise.allSettled([
    ledger.replaceReservation(replacement("a", 1, 3, "race-a", "race-fa"), { realQuantity: real5 }),
    ledger.reserve(base("c", "Item.x", 1, "ground-test"), { realQuantity: real5 })
  ]);
  assert.equal(race.filter(r => r.status === "fulfilled").length, 1);
  assert.ok(ledger.reservedQuantity("Actor.a", "Item.x") <= 5);
});

test("concurrent replacements from one revision admit one and winner retry is idempotent", async () => {
  const { ledger } = await seeded();
  const requests = [replacement("trade:s:a:Item.a", 0, 4, "r1", "rf1"), replacement("trade:s:a:Item.a", 0, 2, "r2", "rf2")];
  const race = await Promise.allSettled(requests.map(request => ledger.replaceReservation(request, { realQuantity: real5 })));
  assert.equal(race.filter(r => r.status === "fulfilled").length, 1);
  const winner = requests[race.findIndex(r => r.status === "fulfilled")];
  const retry = await ledger.replaceReservation(winner, { realQuantity: real5 });
  assert.equal(retry.idempotent, true); assert.equal(ledger.get(winner.operationId).revision, 1);
});

test("persistence and stale authority failures preserve durable state", async () => {
  class FailingRepository extends TradeRuntimeRepository { async write() { throw new Error("persist failed"); } }
  const repository = new FailingRepository(); const ledger = new SharedReservationLedger();
  await ledger.reserve(base("a", "Item.a", 3), { realQuantity: real5 });
  ledger.repository = repository; repository.fallback.reservations = Object.fromEntries(ledger.list().map(r => [r.operationId, r])); await ledger.hydrateFromPersistence();
  const before = ledger.get("a"); await assert.rejects(() => ledger.replaceReservation(replacement("a", 0, 4, "m", "f"), { realQuantity: real5 }), /persist failed/); assert.deepEqual(ledger.get("a"), before);
  let valid = false; const authorityLedger = new SharedReservationLedger({ authority: { validateWriteContext() { if (!valid) throw new Error("stale authority"); } } });
  await authorityLedger.reserve(base("b", "Item.b", 2), { realQuantity: real5 }); const authorityBefore = authorityLedger.get("b");
  await assert.rejects(() => authorityLedger.replaceReservation(replacement("b", 0, 3, "m", "f"), { realQuantity: real5, authorityContext: { generation: "old" } }), /stale authority/); assert.deepEqual(authorityLedger.get("b"), authorityBefore);
});

test("batch persistence failure leaves every durable entry unchanged", async () => {
  class ToggleRepository extends TradeRuntimeRepository {
    fail = false;
    async write(...args) { if (this.fail) throw new Error("batch persist failed"); return super.write(...args); }
  }
  const repository = new ToggleRepository(); const ledger = new SharedReservationLedger({ repository });
  await ledger.reserve(base("a", "Item.a", 2), { realQuantity: real5 }); await ledger.reserve(base("b", "Item.b", 1), { realQuantity: real5 });
  const before = repository.read(); repository.fail = true;
  await assert.rejects(() => ledger.replaceReservationsBatch({ mutationId: "batch-fail", mutationFingerprint: "batch-fail-f", entries: [replacement("a", 0, 3), replacement("b", 0, 2)] }, { realQuantity: real5 }), /batch persist failed/);
  assert.deepEqual(repository.read(), before); assert.equal(ledger.get("a").quantity, 2); assert.equal(ledger.get("b").quantity, 1);
});

test("authority loss at the cooperative pre-persist boundary leaves reservation unchanged", async () => {
  let validations = 0;
  const authority = { validateWriteContext() { validations += 1; if (validations === 2) throw new Error("authority changed"); } };
  const ledger = new SharedReservationLedger({ authority }); await ledger.reserve(base("a", "Item.a", 2), { realQuantity: real5 });
  validations = 0; const before = ledger.get("a");
  await assert.rejects(() => ledger.replaceReservation(replacement("a", 0, 3, "m", "f"), { realQuantity: real5, authorityContext: { generation: "old" } }), /authority changed/);
  assert.deepEqual(ledger.get("a"), before);
});
