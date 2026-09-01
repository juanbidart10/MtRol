import test from "node:test";
import assert from "node:assert/strict";

const gm = {
  id: "gm-a",
  isGM: true,
  active: true
};

const player = {
  id: "player-a",
  isGM: false,
  active: true
};

const outsider = {
  id: "player-b",
  isGM: false,
  active: true
};

const usersById = new Map([
  [gm.id, gm],
  [player.id, player],
  [outsider.id, outsider]
]);

globalThis.game = {
  user: gm,
  users: {
    get: id => usersById.get(id),
    [Symbol.iterator]: () => usersById.values()
  }
};

globalThis.ui = {
  notifications: {
    warn() {}
  }
};

globalThis.foundry = {
  utils: {
    randomID: () => "random-id"
  }
};

const actorsByUuid = new Map();
globalThis.fromUuid = async uuid => actorsByUuid.get(uuid) ?? null;

const service = await import("../scripts/rolls/dharma-spend-service.js");

function buildActor({
  uuid = "Actor.hero",
  balance = 5,
  ownerIds = [player.id],
  updateDelay = 0
} = {}) {
  let updateCount = 0;

  const actor = {
    uuid,
    system: {
      recursos: {
        dharma: balance
      }
    },
    testUserPermission(user, permission) {
      return permission === "OWNER" && ownerIds.includes(user.id);
    },
    async update(change) {
      updateCount += 1;
      if (updateDelay) {
        await new Promise(resolve => setTimeout(resolve, updateDelay));
      }
      this.system.recursos.dharma = change["system.recursos.dharma"];
    },
    get updateCount() {
      return updateCount;
    }
  };

  actorsByUuid.set(uuid, actor);
  return actor;
}

function payload(overrides = {}) {
  return {
    actorUuid: "Actor.hero",
    transactionId: "tx-1",
    selectedIds: ["initial:0:0"],
    cost: 1,
    ...overrides
  };
}

test.beforeEach(() => {
  game.user = gm;
  actorsByUuid.clear();
  service.resetDharmaConsumptionStateForTests();
});

test("dos solicitudes simultaneas con el mismo transactionId consumen una sola vez", async () => {
  const actor = buildActor({ balance: 3, updateDelay: 5 });

  const [first, second] = await Promise.all([
    service.consumeDharmaSpendAuthoritative(payload(), {
      requestingUserId: player.id
    }),
    service.consumeDharmaSpendAuthoritative(payload(), {
      requestingUserId: player.id
    })
  ]);

  assert.equal(actor.updateCount, 1);
  assert.equal(actor.system.recursos.dharma, 2);
  assert.deepEqual(
    [first.replayed, second.replayed].sort(),
    [false, true]
  );
  assert.equal(first.balanceBefore, 3);
  assert.equal(first.balanceAfter, 2);
});

test("dos transacciones concurrentes se serializan y nunca llevan el saldo bajo cero", async () => {
  const actor = buildActor({ balance: 1, updateDelay: 5 });

  const outcomes = await Promise.allSettled([
    service.consumeDharmaSpendAuthoritative(payload({ transactionId: "tx-a" }), {
      requestingUserId: player.id
    }),
    service.consumeDharmaSpendAuthoritative(payload({ transactionId: "tx-b" }), {
      requestingUserId: player.id
    })
  ]);

  assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter(result => result.status === "rejected").length, 1);
  assert.match(
    outcomes.find(result => result.status === "rejected").reason.message,
    /Dharma insuficiente/
  );
  assert.equal(actor.updateCount, 1);
  assert.equal(actor.system.recursos.dharma, 0);
});

test("saldo insuficiente, usuario ajeno y reutilizacion alterada no modifican el Actor", async () => {
  const actor = buildActor({ balance: 1 });

  await assert.rejects(
    service.consumeDharmaSpendAuthoritative(payload({ cost: 2, selectedIds: ["initial:0:0", "initial:0:1"] }), {
      requestingUserId: player.id
    }),
    /Dharma insuficiente/
  );

  await assert.rejects(
    service.consumeDharmaSpendAuthoritative(payload({ transactionId: "tx-outsider" }), {
      requestingUserId: outsider.id
    }),
    /no puede gastar Dharma/
  );

  const receipt = await service.consumeDharmaSpendAuthoritative(payload({ transactionId: "tx-valid" }), {
    requestingUserId: player.id
  });

  assert.equal(receipt.balanceAfter, 0);
  assert.equal(actor.updateCount, 1);

  await assert.rejects(
    service.consumeDharmaSpendAuthoritative(payload({
      transactionId: "tx-valid",
      selectedIds: ["initial:0:1"]
    }), {
      requestingUserId: player.id
    }),
    /transactionId ya fue utilizado/
  );

  assert.equal(actor.updateCount, 1);
  assert.equal(actor.system.recursos.dharma, 0);
});
