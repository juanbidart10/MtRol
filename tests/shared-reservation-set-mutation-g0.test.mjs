import test from "node:test";
import assert from "node:assert/strict";
import { SharedReservationLedger, RESERVATION_STATES } from "../scripts/runtime/shared-reservation-ledger.js";
import { TradeRuntimeRepository } from "../scripts/trade/trade-runtime-repository.js";

const real = async (_actor, item) => item === "Item.low" ? 1 : 5;
const create = (id, item, quantity, domain = "trade") => ({ type: "CREATE", operationId: id, domain, actorUuid: "Actor.a", itemUuid: item, quantity });
const replace = (id, revision, quantity) => ({ type: "REPLACE", operationId: id, expectedRevision: revision, quantity });
const release = (id, revision) => ({ type: "RELEASE", operationId: id, expectedRevision: revision });
const request = (id, operations, fingerprint = `fp-${id}`) => ({ mutationId: id, mutationFingerprint: fingerprint, operations });

async function seed(entries) {
  const repository = new TradeRuntimeRepository(); const ledger = new SharedReservationLedger({ repository });
  for (const entry of entries) await ledger.reserve(entry, { realQuantity: real });
  return { ledger, repository };
}
const state = ledger => ledger.list().sort((a, b) => a.operationId.localeCompare(b.operationId)).map(r => ({ id: r.operationId, quantity: r.quantity, revision: r.revision, state: r.state, domain: r.domain }));

test("set mutation supports CREATE, REPLACE and RELEASE individually", async () => {
  const { ledger } = await seed([{ operationId: "a", domain: "trade", actorUuid: "Actor.a", itemUuid: "Item.a", quantity: 2 }, { operationId: "b", domain: "trade", actorUuid: "Actor.a", itemUuid: "Item.b", quantity: 1 }]);
  await ledger.mutateReservationSet(request("create", [create("c", "Item.c", 2)]), { realQuantity: real });
  await ledger.mutateReservationSet(request("replace", [replace("a", 0, 3)]), { realQuantity: real });
  await ledger.mutateReservationSet(request("release", [release("b", 0)]), { realQuantity: real });
  assert.deepEqual([ledger.get("c").state, ledger.get("a").quantity, ledger.get("b").state], [RESERVATION_STATES.RESERVED, 3, RESERVATION_STATES.RELEASED]);
});

test("set mutation atomically combines CREATE + REPLACE + RELEASE", async () => {
  const { ledger } = await seed([{ operationId: "a", domain: "trade", actorUuid: "Actor.a", itemUuid: "Item.x", quantity: 3 }, { operationId: "b", domain: "trade", actorUuid: "Actor.a", itemUuid: "Item.x", quantity: 2 }]);
  await ledger.mutateReservationSet(request("all", [replace("a", 0, 4), release("b", 0), create("c", "Item.x", 1)]), { realQuantity: real });
  assert.deepEqual(state(ledger).map(r => [r.id, r.quantity, r.state]), [["a", 4, "RESERVED"], ["b", 2, "RELEASED"], ["c", 1, "RESERVED"]]);
});

test("set mutation supports each approved two-operation combination", async () => {
  const createReplace = await seed([{ operationId: "a", domain: "trade", actorUuid: "Actor.a", itemUuid: "Item.a", quantity: 2 }]);
  await createReplace.ledger.mutateReservationSet(request("cr", [create("b", "Item.b", 1), replace("a", 0, 3)]), { realQuantity: real });
  assert.deepEqual([createReplace.ledger.get("a").quantity, createReplace.ledger.get("b").quantity], [3, 1]);

  const replaceRelease = await seed([{ operationId: "a", domain: "trade", actorUuid: "Actor.a", itemUuid: "Item.a", quantity: 2 }, { operationId: "b", domain: "trade", actorUuid: "Actor.a", itemUuid: "Item.b", quantity: 1 }]);
  await replaceRelease.ledger.mutateReservationSet(request("rr", [replace("a", 0, 3), release("b", 0)]), { realQuantity: real });
  assert.deepEqual([replaceRelease.ledger.get("a").quantity, replaceRelease.ledger.get("b").state], [3, RESERVATION_STATES.RELEASED]);

  const createRelease = await seed([{ operationId: "a", domain: "trade", actorUuid: "Actor.a", itemUuid: "Item.a", quantity: 2 }]);
  await createRelease.ledger.mutateReservationSet(request("clr", [create("b", "Item.b", 1), release("a", 0)]), { realQuantity: real });
  assert.deepEqual([createRelease.ledger.get("a").state, createRelease.ledger.get("b").state], [RESERVATION_STATES.RELEASED, RESERVATION_STATES.RESERVED]);
});

test("final-state capacity permits release to fund replace independent of operation order", async () => {
  const initial = [{ operationId: "a", domain: "trade", actorUuid: "Actor.a", itemUuid: "Item.x", quantity: 3 }, { operationId: "b", domain: "trade", actorUuid: "Actor.a", itemUuid: "Item.x", quantity: 2 }];
  const first = await seed(initial); const second = await seed(initial);
  await first.ledger.mutateReservationSet(request("order", [release("b", 0), replace("a", 0, 4), create("c", "Item.x", 1)], "same-intent"), { realQuantity: real });
  await second.ledger.mutateReservationSet(request("order", [create("c", "Item.x", 1), replace("a", 0, 4), release("b", 0)], "same-intent"), { realQuantity: real });
  assert.deepEqual(state(first.ledger), state(second.ledger));
});

test("any capacity, stale, illegal release or duplicate failure preserves entire set", async () => {
  const variants = [
    request("capacity", [create("c", "Item.x", 1), replace("a", 0, 5)]),
    request("stale", [create("c", "Item.c", 1), replace("a", 9, 2)]),
    request("duplicate", [replace("a", 0, 2), release("a", 0)])
  ];
  for (const candidate of variants) {
    const { ledger } = await seed([{ operationId: "a", domain: "trade", actorUuid: "Actor.a", itemUuid: "Item.x", quantity: 3 }, { operationId: "ground", domain: "ground-test", actorUuid: "Actor.a", itemUuid: "Item.x", quantity: 1 }]);
    const before = state(ledger); await assert.rejects(() => ledger.mutateReservationSet(candidate, { realQuantity: real })); assert.deepEqual(state(ledger), before);
  }
  const { ledger } = await seed([{ operationId: "r", domain: "trade", actorUuid: "Actor.a", itemUuid: "Item.r", quantity: 1 }]);
  await ledger.recoveryRequired("r"); const before = state(ledger);
  await assert.rejects(() => ledger.mutateReservationSet(request("illegal", [create("c", "Item.c", 1), release("r", 1)]), { realQuantity: real })); assert.deepEqual(state(ledger), before);
});

test("CREATE capacity failure and terminal identity do not create or revive", async () => {
  const { ledger } = await seed([{ operationId: "taken", domain: "ground-test", actorUuid: "Actor.a", itemUuid: "Item.low", quantity: 1 }, { operationId: "terminal", domain: "trade", actorUuid: "Actor.a", itemUuid: "Item.t", quantity: 1 }]);
  await ledger.release("terminal");
  await assert.rejects(() => ledger.mutateReservationSet(request("no-cap", [create("new", "Item.low", 1)]), { realQuantity: real }));
  await assert.rejects(() => ledger.mutateReservationSet(request("no-revive", [create("terminal", "Item.t", 1)]), { realQuantity: real }));
  assert.equal(ledger.get("new"), null); assert.equal(ledger.get("terminal").state, RESERVATION_STATES.RELEASED);
});

test("set retry is idempotent before stale CAS and survives reload", async () => {
  const { ledger, repository } = await seed([{ operationId: "a", domain: "trade", actorUuid: "Actor.a", itemUuid: "Item.a", quantity: 2 }]);
  const mutation = request("retry", [replace("a", 0, 3), create("c", "Item.c", 1)]);
  await ledger.mutateReservationSet(mutation, { realQuantity: real });
  const reloaded = new SharedReservationLedger({ repository }); await reloaded.hydrateFromPersistence();
  const retry = await reloaded.mutateReservationSet(mutation, { realQuantity: real });
  assert.equal(retry.idempotent, true); assert.equal(reloaded.get("a").revision, 1); assert.equal(reloaded.get("c").revision, 0);
  const before = state(reloaded); await assert.rejects(() => reloaded.mutateReservationSet({ ...mutation, mutationFingerprint: "different" }, { realQuantity: real }), error => error.reasonCode === "RESERVATION_MUTATION_CONFLICT"); assert.deepEqual(state(reloaded), before);
});

test("cross-domain final capacity rejects entire trade-like set", async () => {
  const { ledger } = await seed([{ operationId: "ground", domain: "ground-test", actorUuid: "Actor.a", itemUuid: "Item.x", quantity: 2 }, { operationId: "trade-a", domain: "trade", actorUuid: "Actor.a", itemUuid: "Item.x", quantity: 2 }]);
  const before = state(ledger);
  await assert.rejects(() => ledger.mutateReservationSet(request("cross", [replace("trade-a", 0, 3), create("trade-b", "Item.x", 1)]), { realQuantity: real }), error => error.reasonCode === "RESERVATION_CAPACITY_CONFLICT");
  assert.deepEqual(state(ledger), before);
});

test("trade-like set winning first prevents a later ground-test overcommit", async () => {
  const { ledger } = await seed([]);
  await ledger.mutateReservationSet(request("trade-first", [create("trade", "Item.low", 1)]), { realQuantity: real });
  await assert.rejects(() => ledger.reserve({ operationId: "ground", domain: "ground-test", actorUuid: "Actor.a", itemUuid: "Item.low", quantity: 1 }, { realQuantity: real }));
  assert.equal(ledger.reservedQuantity("Actor.a", "Item.low"), 1);
});

test("multi-actor and multi-item set is all-or-nothing when one resource fails", async () => {
  const { ledger } = await seed([{ operationId: "x", domain: "trade", actorUuid: "Actor.a", itemUuid: "Item.a", quantity: 2 }, { operationId: "block", domain: "ground-test", actorUuid: "Actor.a", itemUuid: "Item.low", quantity: 1 }]);
  const before = state(ledger);
  await assert.rejects(() => ledger.mutateReservationSet(request("multi-resource", [
    replace("x", 0, 3),
    { ...create("y", "Item.y", 1), actorUuid: "Actor.b" },
    create("fails", "Item.low", 1)
  ]), { realQuantity: real }));
  assert.deepEqual(state(ledger), before);
});

test("two set mutations from the same revision admit exactly one", async () => {
  const { ledger } = await seed([{ operationId: "a", domain: "trade", actorUuid: "Actor.a", itemUuid: "Item.a", quantity: 2 }]);
  const race = await Promise.allSettled([
    ledger.mutateReservationSet(request("set-a", [replace("a", 0, 3)]), { realQuantity: real }),
    ledger.mutateReservationSet(request("set-b", [replace("a", 0, 4)]), { realQuantity: real })
  ]);
  assert.equal(race.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(ledger.get("a").revision, 1);
});

test("valid RELEASE plus capacity-conflicting CREATE changes neither identity", async () => {
  const { ledger } = await seed([{ operationId: "release-me", domain: "trade", actorUuid: "Actor.a", itemUuid: "Item.a", quantity: 1 }, { operationId: "taken", domain: "ground-test", actorUuid: "Actor.a", itemUuid: "Item.low", quantity: 1 }]);
  const before = state(ledger);
  await assert.rejects(() => ledger.mutateReservationSet(request("release-create-fail", [release("release-me", 0), create("new", "Item.low", 1)]), { realQuantity: real }));
  assert.deepEqual(state(ledger), before);
});

test("concurrent set vs reserve and set vs replace never overcommit supported repository", async () => {
  const first = await seed([]);
  const race1 = await Promise.allSettled([
    first.ledger.mutateReservationSet(request("set-create", [create("trade", "Item.low", 1)]), { realQuantity: real }),
    first.ledger.reserve({ operationId: "ground", domain: "ground-test", actorUuid: "Actor.a", itemUuid: "Item.low", quantity: 1 }, { realQuantity: real })
  ]);
  assert.equal(race1.filter(r => r.status === "fulfilled").length, 1); assert.ok(first.ledger.reservedQuantity("Actor.a", "Item.low") <= 1);

  const second = await seed([{ operationId: "a", domain: "trade", actorUuid: "Actor.a", itemUuid: "Item.x", quantity: 3 }]);
  const race2 = await Promise.allSettled([
    second.ledger.mutateReservationSet(request("set-replace", [replace("a", 0, 5)]), { realQuantity: real }),
    second.ledger.replaceReservation({ operationId: "a", expectedRevision: 0, quantity: 4, mutationId: "plain", mutationFingerprint: "plain-f" }, { realQuantity: real })
  ]);
  assert.equal(race2.filter(r => r.status === "fulfilled").length, 1); assert.ok(second.ledger.reservedQuantity("Actor.a", "Item.x") <= 5);
});

test("persistence and cooperative authority failures preserve all old durable state", async () => {
  class ToggleRepository extends TradeRuntimeRepository { fail = false; async write(...args) { if (this.fail) throw new Error("set persist failed"); return super.write(...args); } }
  const repository = new ToggleRepository(); const ledger = new SharedReservationLedger({ repository });
  await ledger.reserve({ operationId: "a", domain: "trade", actorUuid: "Actor.a", itemUuid: "Item.a", quantity: 2 }, { realQuantity: real });
  const before = repository.read(); repository.fail = true;
  await assert.rejects(() => ledger.mutateReservationSet(request("persist", [replace("a", 0, 3), create("c", "Item.c", 1)]), { realQuantity: real }), /set persist failed/); assert.deepEqual(repository.read(), before);

  let validations = 0; const guarded = new SharedReservationLedger({ authority: { validateWriteContext() { if (++validations === 2) throw new Error("authority changed"); } } });
  await guarded.reserve({ operationId: "a", domain: "trade", actorUuid: "Actor.a", itemUuid: "Item.a", quantity: 2 }, { realQuantity: real }); const guardedBefore = state(guarded); validations = 0;
  await assert.rejects(() => guarded.mutateReservationSet(request("authority", [replace("a", 0, 3), create("c", "Item.c", 1)]), { realQuantity: real, authorityContext: { generation: "old" } }), /authority changed/); assert.deepEqual(state(guarded), guardedBefore);
});
