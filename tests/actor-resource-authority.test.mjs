import test from "node:test";
import assert from "node:assert/strict";

globalThis.foundry = {
  utils: {
    duplicate: value => structuredClone(value),
    randomID: () => "transaction-generated"
  }
};

globalThis.game = {
  user: { id: "gm", isGM: true },
  users: [
    { id: "gm", isGM: true, active: true },
    { id: "player", isGM: false, active: true }
  ],
  system: { id: "mtrol" }
};

globalThis.ui = { notifications: { warn() {} } };

const actors = new Map();
globalThis.fromUuid = async uuid => actors.get(uuid) ?? null;

const {
  applyDamageToHpAuthoritative,
  resetActorResourceServiceForTests,
  runActorResourceTransaction
} = await import("../scripts/actors/actor-resource-service.js");

const {
  aplicarConsumoMPAuthoritative,
  reembolsarCostoMPAuthoritative,
  restaurarMPMeditacionAuthoritative
} = await import("../scripts/combat/mp-engine.js");

function createActor({ hp = 20, mp = 10 } = {}) {
  const items = [];
  items.get = id => items.find(item => item.id === id) ?? null;
  const flags = {};
  const actor = {
    uuid: "Actor.hero",
    system: {
      vitales: {
        hp: { value: hp, max: hp },
        mp: { value: mp, max: mp }
      }
    },
    items,
    updates: [],
    testUserPermission(user, level) {
      return user.id === "player" && level === "OWNER";
    },
    getFlag(_scope, key) {
      return key === "mpStacks" ? flags : null;
    },
    async setFlag(_scope, key, value) {
      if (key === "mpStacks") Object.assign(flags, structuredClone(value));
    },
    async update(changes, options) {
      this.updates.push({ changes: structuredClone(changes), options });
      if ("system.vitales.hp.value" in changes) {
        this.system.vitales.hp.value = changes["system.vitales.hp.value"];
      }
      if ("system.vitales.mp.value" in changes) {
        this.system.vitales.mp.value = changes["system.vitales.mp.value"];
      }
    }
  };

  actors.set(actor.uuid, actor);
  return actor;
}

function addItem(actor, {
  id = "spell",
  name = "Hechizo",
  categoria = "hechizo",
  nivel = 2
} = {}) {
  const item = {
    id,
    uuid: `${actor.uuid}.Item.${id}`,
    name,
    system: { categoria, nivel }
  };
  actor.items.push(item);
  return item;
}

test.beforeEach(() => {
  actors.clear();
  resetActorResourceServiceForTests();
  game.user = game.users[0];
});

test("una transacción de recurso repetida ejecuta una sola escritura", async () => {
  const actor = createActor();
  let executions = 0;
  const operation = async () => {
    executions += 1;
    await actor.update({ "system.vitales.mp.value": 9 });
    return { balanceAfter: 9 };
  };

  const first = await runActorResourceTransaction(actor, {
    transactionId: "same-cost",
    origin: "mp-cost"
  }, operation);
  const replay = await runActorResourceTransaction(actor, {
    transactionId: "same-cost",
    origin: "mp-cost"
  }, operation);

  assert.equal(executions, 1);
  assert.equal(actor.updates.length, 1);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
});

test("el writer final de daño calcula HP desde el Actor real y conserva opciones", async () => {
  const actor = createActor({ hp: 20 });
  const result = await applyDamageToHpAuthoritative(actor, 7, {
    transactionId: "damage-one",
    updateOptions: { mtrolDeathTargetTokenUuid: "Scene.s.Token.t" }
  });

  assert.equal(result.hpBefore, 20);
  assert.equal(result.hpAfter, 13);
  assert.equal(actor.system.vitales.hp.value, 13);
  assert.deepEqual(actor.updates[0].options, {
    mtrolDeathTargetTokenUuid: "Scene.s.Token.t"
  });
});

test("un jugador no puede invocar directamente el writer autoritativo", async () => {
  const actor = createActor({ hp: 20 });
  game.user = game.users[1];

  await assert.rejects(
    applyDamageToHpAuthoritative(actor, 7, { transactionId: "forged" }),
    /GM/
  );
  assert.equal(actor.updates.length, 0);
  assert.equal(actor.system.vitales.hp.value, 20);
});

test("el GM recalcula el coste MP desde el Item canónico e ignora saldos finales forjados", async () => {
  const actor = createActor({ mp: 10 });
  addItem(actor, { id: "fire", categoria: "hechizo", nivel: 2 });
  const payload = {
    actorUuid: actor.uuid,
    transactionId: "spell-cost",
    intent: { kind: "item-cost", itemId: "fire" },
    newMP: 0,
    authorized: true,
    source: "gm"
  };

  const first = await aplicarConsumoMPAuthoritative(payload, {
    requestingUserId: "player"
  });
  const replay = await aplicarConsumoMPAuthoritative(payload, {
    requestingUserId: "player"
  });

  assert.equal(first.costoTotal, 2);
  assert.equal(first.mpAnterior, 10);
  assert.equal(first.mpNuevo, 8);
  assert.equal(replay.replayed, true);
  assert.equal(actor.system.vitales.mp.value, 8);
  assert.equal(actor.updates.length, 1);
});

test("MP insuficiente no produce saldo negativo ni escritura parcial", async () => {
  const actor = createActor({ mp: 1 });
  addItem(actor, { id: "fire", categoria: "hechizo", nivel: 2 });

  await assert.rejects(
    aplicarConsumoMPAuthoritative({
      actorUuid: actor.uuid,
      transactionId: "insufficient",
      intent: { kind: "item-cost", itemId: "fire" }
    }, { requestingUserId: "player" }),
    /MP insuficiente/
  );

  assert.equal(actor.system.vitales.mp.value, 1);
  assert.equal(actor.updates.length, 0);
});

test("reembolso devuelve exactamente el coste aplicado y es idempotente", async () => {
  const actor = createActor({ mp: 10 });
  addItem(actor, { id: "fire", categoria: "hechizo", nivel: 2 });
  await aplicarConsumoMPAuthoritative({
    actorUuid: actor.uuid,
    transactionId: "cost-to-refund",
    intent: { kind: "item-cost", itemId: "fire" }
  }, { requestingUserId: "player" });

  const refundPayload = {
    actorUuid: actor.uuid,
    originalTransactionId: "cost-to-refund",
    transactionId: "cost-to-refund:refund"
  };
  const first = await reembolsarCostoMPAuthoritative(refundPayload, {
    requestingUserId: "player"
  });
  const replay = await reembolsarCostoMPAuthoritative(refundPayload, {
    requestingUserId: "player"
  });

  assert.equal(first.costoTotal, 2);
  assert.equal(replay.replayed, true);
  assert.equal(actor.system.vitales.mp.value, 10);
  assert.equal(actor.updates.length, 2);
});

test("Meditar restaura el doble del coste, respeta máximo y no restaura en fallo", async () => {
  const actor = createActor({ mp: 10 });
  actor.system.vitales.mp.value = 9;
  const meditateItem = addItem(actor, { id: "meditar", name: "Concentración", categoria: "basico", nivel: 1 });
  meditateItem.system.executionModes = [
    { modeId: "RECOVER_MP", label: "Recuperar MP", strategy: "recover-mp" },
    { modeId: "ASTRAL_PROJECTION", label: "Proyección astral", strategy: "narrative" }
  ];
  await aplicarConsumoMPAuthoritative({
    actorUuid: actor.uuid,
    transactionId: "meditate-success-cost",
    intent: { kind: "item-cost", itemId: "meditar" }
  }, { requestingUserId: "player" });

  const success = await restaurarMPMeditacionAuthoritative({
    actorUuid: actor.uuid,
    originalTransactionId: "meditate-success-cost",
    transactionId: "meditate-success-cost:meditate",
    total: 6,
    fumble: false,
    modeId: "RECOVER_MP"
  }, { requestingUserId: "player" });

  assert.equal(success.restoration, 2);
  assert.equal(success.restored, 2);
  assert.equal(actor.system.vitales.mp.value, 10);

  actor.system.vitales.mp.value = 9;
  await aplicarConsumoMPAuthoritative({
    actorUuid: actor.uuid,
    transactionId: "meditate-fail-cost",
    intent: { kind: "item-cost", itemId: "meditar" }
  }, { requestingUserId: "player" });
  const writesBeforeFailure = actor.updates.length;
  const failure = await restaurarMPMeditacionAuthoritative({
    actorUuid: actor.uuid,
    originalTransactionId: "meditate-fail-cost",
    transactionId: "meditate-fail-cost:meditate",
    total: 5,
    fumble: false,
    modeId: "RECOVER_MP"
  }, { requestingUserId: "player" });

  assert.equal(failure.success, false);
  assert.equal(failure.restored, 0);
  assert.equal(actor.system.vitales.mp.value, 8);
  assert.equal(actor.updates.length, writesBeforeFailure);
});
