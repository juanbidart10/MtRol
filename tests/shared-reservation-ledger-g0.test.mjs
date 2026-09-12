import test from "node:test";
import assert from "node:assert/strict";
import { SharedReservationLedger, RESERVATION_STATES } from "../scripts/runtime/shared-reservation-ledger.js";
import { TradeRuntimeRepository } from "../scripts/trade/trade-runtime-repository.js";

const real = async () => 1;
const input = (id, quantity = 1, extra = {}) => ({ operationId: id, domain: "trade", actorUuid: "Actor.a", itemUuid: "Item.a", quantity, ...extra });

test("shared ledger reserves, reloads, and enforces persisted availability", async () => {
  const repository = new TradeRuntimeRepository();
  const ledger = new SharedReservationLedger({ repository });
  await ledger.reserve(input("op-1"), { realQuantity: real });
  assert.equal(ledger.reservedQuantity("Actor.a", "Item.a"), 1);
  const reloaded = new SharedReservationLedger({ repository });
  await reloaded.hydrateFromPersistence();
  assert.equal(reloaded.get("op-1").state, RESERVATION_STATES.RESERVED);
  await assert.rejects(() => reloaded.reserve(input("op-2"), { realQuantity: real }));
});

test("concurrent distinct operations yield exactly one reservation", async () => {
  const repository = new TradeRuntimeRepository();
  const ledger = new SharedReservationLedger({ repository });
  const results = await Promise.allSettled(["a", "b"].map(id => ledger.reserve(input(id), { realQuantity: real })));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(Object.keys(repository.read().reservations).length, 1);
});

test("retry is idempotent and fingerprint conflicts are rejected", async () => {
  const ledger = new SharedReservationLedger();
  const first = await ledger.reserve(input("same"), { realQuantity: async () => 3 });
  const retry = await ledger.reserve(input("same"), { realQuantity: async () => 3 });
  assert.deepEqual(retry, first);
  await assert.rejects(() => ledger.reserve(input("same", 2), { realQuantity: async () => 3 }), /fingerprint/);
});

test("terminal transitions retain evidence and recovery never expires", async () => {
  const ledger = new SharedReservationLedger();
  await ledger.reserve(input("op"), { realQuantity: real });
  await ledger.recoveryRequired("op", { evidence: { checkpoint: "before-effect" } });
  assert.equal(ledger.get("op").state, RESERVATION_STATES.RECOVERY_REQUIRED);
  assert.equal(ledger.get("op").evidence.checkpoint, "before-effect");
  await assert.rejects(() => ledger.release("op"), error => error.reasonCode === "RESERVATION_STATE_CONFLICT");
  assert.equal(ledger.get("op").state, RESERVATION_STATES.RECOVERY_REQUIRED);
});

test("authority context is revalidated before reservation transition", async () => {
  let valid = true;
  const authority = { validateWriteContext() { if (!valid) throw Object.assign(new Error("stale"), { reasonCode: "AUTHORITY_CONTEXT_STALE" }); } };
  const ledger = new SharedReservationLedger({ authority });
  await ledger.reserve(input("op"), { realQuantity: real, authorityContext: { generation: "1" } });
  valid = false;
  await assert.rejects(() => ledger.commit("op", { authorityContext: { generation: "1" } }), /stale/);
  assert.equal(ledger.get("op").state, RESERVATION_STATES.RESERVED);
});
