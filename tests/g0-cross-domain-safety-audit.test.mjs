import test from "node:test";
import assert from "node:assert/strict";
import { TradeSessionStore } from "../scripts/trade/trade-session-service.js";
import { TradeRuntimeRepository } from "../scripts/trade/trade-runtime-repository.js";
import { SharedReservationLedger } from "../scripts/runtime/shared-reservation-ledger.js";

const participant = (suffix) => ({
  userId: `user-${suffix}`,
  actorUuid: `Actor.${suffix}`,
  actorName: suffix
});

test("P0 FIXED / REGRESSION GUARANTEE: Trade and ground cannot both claim the last unit", async () => {
  const repository = new TradeRuntimeRepository();
  const ledger = new SharedReservationLedger({ repository });
  let releaseTradeQuantityRead;
  const tradeQuantityRead = new Promise(resolve => { releaseTradeQuantityRead = resolve; });
  let tradeReachedQuantityRead;
  const tradeAtQuantityRead = new Promise(resolve => { tradeReachedQuantityRead = resolve; });
  const store = new TradeSessionStore({
    idFactory: () => "trade-race",
    repository,
    reservationLedger: ledger,
    resolveRealQuantity: async () => {
      tradeReachedQuantityRead();
      await tradeQuantityRead;
      return 1;
    }
  });
  store.reconcileAuthority({ gmUserId: "gm", epoch: "epoch" });
  const created = await store.createSession({
    participantA: participant("a"), participantB: participant("b"),
    authority: { gmUserId: "gm", epoch: "epoch" }, operationId: "create"
  });
  await store.acceptSession({ sessionId: created.id, requestingUserId: "user-b", operationId: "accept" });

  const offer = store.setOffer({
    sessionId: created.id, participantKey: "participantA", requestingUserId: "user-a",
    entries: [{ itemUuid: "Item.x", itemId: "x", quantity: 1 }], operationId: "offer"
  });
  await tradeAtQuantityRead;
  const ground = ledger.reserve({
    operationId: "ground-race", domain: "ground-test", actorUuid: "Actor.a",
    itemUuid: "Item.x", quantity: 1
  }, { realQuantity: async () => 1 });
  await ground;
  releaseTradeQuantityRead();
  const outcome = await Promise.allSettled([offer]);

  assert.equal(outcome[0].status, "rejected");
  assert.equal(store.getReservedQuantity("Actor.a", { itemUuid: "Item.x" }), 0);
  assert.equal(ledger.reservedQuantity("Actor.a", "Item.x"), 1);
  assert.equal(store.getReservedQuantity("Actor.a", { itemUuid: "Item.x" }) +
    ledger.reservedQuantity("Actor.a", "Item.x"), 1);
});
