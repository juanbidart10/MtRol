import test from "node:test";
import assert from "node:assert/strict";

class UserCollection extends Map {
  [Symbol.iterator]() { return this.values(); }
}

class Combatants extends Array {
  get(id) { return this.find(value => value.id === id) ?? null; }
}

const users = new UserCollection([
  ["gm", { id: "gm", isGM: true, active: true }],
  ["owner", { id: "owner", isGM: false, active: true }]
]);
const documents = new Map();
const warnings = [];
let id = 0;
let reactionMovement = null;

globalThis.foundry = { utils: {
  deepClone: value => value === undefined ? undefined : structuredClone(value),
  randomID: () => `test-${++id}`
} };
globalThis.CONST = { GRID_TYPES: { SQUARE: 1 } };
globalThis.game = {
  user: users.get("gm"),
  users,
  combat: null,
  combats: new Map(),
  mtrol: { actions: {
    getPendingOppositionForActor: () => null,
    getReactionMovementForActor: actor => reactionMovement?.actorUuid === actor?.uuid ? reactionMovement : null,
    async completeReactionMovementAuthoritative(pendingActionId, payload) {
      if (reactionMovement?.pendingActionId !== pendingActionId) return null;
      reactionMovement = null;
      return { pendingActionId, ...payload };
    }
  } }
};
globalThis.canvas = { grid: { size: 100 }, scene: { grid: { type: 1, size: 100, distance: 1 } } };
globalThis.ui = { notifications: { warn: message => warnings.push(message), error() {} } };
globalThis.Hooks = { on() {}, callAll() {} };
globalThis.fromUuid = async uuid => documents.get(uuid) ?? null;

const {
  executeMovementRenounceTransaction,
  executeMovementTransaction,
  recoverMovementTransactions
} = await import("../scripts/combat/movement-service.js");
const {
  commitTurnMovement,
  configureTurnActionIntegration,
  validateTurnMovement
} = await import("../scripts/combat/turn-system.js");
configureTurnActionIntegration(game.mtrol.actions);
const { transactionCoordinator } = await import("../scripts/runtime/runtime-foundation.js");
const {
  getTransactionCommandForSocketAction,
  registerTransactionCommands
} = await import("../scripts/runtime/transaction-commands.js");

test("los sockets legacy de turno y movimiento son adapters del Command Registry", () => {
  const registry = registerTransactionCommands();
  const expected = new Map([
    ["mtrolEndTurn", "turn.end"],
    ["mtrolGrantTurnMovement", "turn.movement-grant"],
    ["mtrolCompleteTurnAction", "turn.action-complete"],
    ["mtrolCommitTurnMovement", "movement.commit"],
    ["mtrolCommitGrantedMovement", "movement.commit"],
    ["mtrolCommitReactionMovement", "movement.commit"]
  ]);
  for (const [socketAction, command] of expected) {
    assert.equal(getTransactionCommandForSocketAction(socketAction), command);
    assert.equal(registry.has(command), true);
  }
});

function makeActor() {
  const actor = {
    id: `actor-${++id}`,
    uuid: `Actor.actor-${id}`,
    ownership: { owner: 3 },
    testUserPermission(user) { return user?.id === "owner" || user?.isGM; }
  };
  documents.set(actor.uuid, actor);
  return actor;
}

function makeCombatant(actor, combatId, turn = 0) {
  return {
    id: `combatant-${++id}`,
    actor,
    flags: { mtrol: { turnState: {
      combatId,
      round: 1,
      turn,
      baseMovementRemaining: 1,
      extraMovementRemaining: 1,
      movementSpent: 0,
      actionConsumed: false
    } } },
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
    async setFlag(scope, key, value) {
      this.flags[scope] ??= {};
      this.flags[scope][key] = structuredClone(value);
      return value;
    }
  };
}

function fixture() {
  reactionMovement = null;
  const actor = makeActor();
  const other = makeActor();
  const combatId = `combat-${++id}`;
  const first = makeCombatant(actor, combatId, 0);
  const second = makeCombatant(other, combatId, 1);
  const combatants = new Combatants(first, second);
  const combat = {
    id: combatId,
    uuid: `Combat.${combatId}`,
    started: true,
    round: 1,
    turn: 0,
    combatant: first,
    combatants,
    turns: combatants,
    flags: { mtrol: {} },
    nextTurnCalls: 0,
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
    async update(changes) {
      if (Object.hasOwn(changes, "flags.mtrol.runtime")) {
        this.flags.mtrol.runtime = structuredClone(changes["flags.mtrol.runtime"]);
      }
      return this;
    },
    async nextTurn() {
      this.nextTurnCalls += 1;
      this.turn = 1;
      this.combatant = second;
    }
  };
  const token = {
    id: `token-${++id}`,
    uuid: `Scene.scene.Token.token-${id}`,
    actor,
    parent: { grid: { type: 1, size: 100, distance: 1 } },
    x: 0,
    y: 0,
    updateCalls: [],
    async update(changes, options = {}) {
      this.updateCalls.push({ changes: structuredClone(changes), options: structuredClone(options) });
      Object.assign(this, changes);
      return this;
    }
  };
  documents.set(token.uuid, token);
  game.combat = combat;
  game.combats.set(combat.id, combat);
  return { actor, other, first, second, combat, token };
}

function movementPayload(fx, transactionId, from = { x: 0, y: 0 }, to = { x: 100, y: 0 }) {
  return {
    transactionId,
    source: "TURN",
    combatId: fx.combat.id,
    combatantId: fx.first.id,
    tokenUuid: fx.token.uuid,
    from,
    to,
    movement: {
      transactionId,
      source: "TURN",
      combatId: fx.combat.id,
      combatantId: fx.first.id,
      round: 1,
      turn: 0,
      from,
      to
    }
  };
}

async function seedApplying(fx, payload, { before = 2, after = 1 } = {}) {
  const store = transactionCoordinator.combatReceiptStore;
  await store.begin(fx.combat, payload.transactionId, { command: "movement.commit" });
  await store.transition(fx.combat, payload.transactionId, "prepared", {
    combatId: fx.combat.id,
    combatantId: fx.first.id,
    tokenUuid: fx.token.uuid,
    source: "TURN",
    from: payload.from,
    to: payload.to,
    requestingUserId: "owner"
  });
  await store.transition(fx.combat, payload.transactionId, "applying", {
    prepared: {
      source: "TURN",
      from: payload.from,
      to: payload.to,
      measuredDistance: 1,
      movementBefore: before,
      movementAfter: after,
      stateId: null,
      pendingActionId: null,
      combatantId: fx.first.id
    },
    checkpoints: { "position-applied": { at: Date.now() } }
  });
}

test("TURN movement se confirma una vez y el replay devuelve el mismo receipt", async () => {
  const fx = fixture();
  const options = {};
  assert.equal(validateTurnMovement(fx.token, { x: 100 }, options, "owner"), true);
  fx.token.x = 100;
  const payload = { tokenUuid: fx.token.uuid, movement: options.mtrolTurnMovement };
  const first = await executeMovementTransaction(payload, { requestingUserId: "owner" });
  const replay = await executeMovementTransaction(payload, { requestingUserId: "owner" });
  assert.deepEqual(replay, first);
  assert.equal(fx.first.flags.mtrol.turnState.baseMovementRemaining, 0);
  assert.equal(fx.first.flags.mtrol.turnState.extraMovementRemaining, 1);
  assert.equal(fx.first.flags.mtrol.turnState.movementSpent, 1);
  assert.equal(fx.combat.flags.mtrol.runtime.receipts[options.mtrolTurnMovement.transactionId].status, "completed");
});

test("el hook del Primary GM confirma aunque el jugador cierre antes de enviar su socket", async () => {
  const fx = fixture();
  const options = {};
  assert.equal(validateTurnMovement(fx.token, { x: 100 }, options, "owner"), true);
  fx.token.x = 100;
  await commitTurnMovement(fx.token, options, "owner");
  assert.equal(fx.first.flags.mtrol.turnState.movementSpent, 1);
  assert.equal(fx.combat.flags.mtrol.runtime.receipts[options.mtrolTurnMovement.transactionId].status, "completed");
});

test("updateToken confirma desde la reserva existente si Foundry no conserva metadata", async () => {
  const fx = fixture();
  fx.first.flags.mtrol.turnState.extraMovementRemaining = 0;
  const preUpdateOptions = {};
  assert.equal(validateTurnMovement(fx.token, { x: 100 }, preUpdateOptions, "owner"), true);
  const transactionId = preUpdateOptions.mtrolTurnMovement.transactionId;
  fx.token.x = 100;

  await commitTurnMovement(fx.token, {}, "owner", { x: 100 });

  assert.equal(fx.first.flags.mtrol.turnState.baseMovementRemaining, 0);
  assert.equal(fx.first.flags.mtrol.turnState.movementSpent, 1);
  assert.equal(fx.combat.flags.mtrol.runtime.receipts[transactionId].status, "completed");
  assert.equal(validateTurnMovement(fx.token, { x: 200 }, {}, "owner"), false);
});

test("el Primary GM espera de forma acotada a que su Token converja con la posición persistida", async () => {
  const fx = fixture();
  const payload = movementPayload(fx, "movement:late-token-sync");
  fx.token.x = 50;
  const synchronize = globalThis.setTimeout(() => { fx.token.x = 100; }, 10);

  try {
    const result = await executeMovementTransaction(payload, {
      requestingUserId: "owner",
      positionSyncTimeoutMs: 100
    });
    assert.equal(result.ok, true);
    assert.equal(fx.first.flags.mtrol.turnState.movementSpent, 1);
    assert.equal(fx.combat.flags.mtrol.runtime.receipts[payload.transactionId].status, "completed");
  } finally {
    globalThis.clearTimeout(synchronize);
  }
});

test("timeout de sincronización aborta sin consumo ni recovery ambiguo", async () => {
  const fx = fixture();
  const payload = movementPayload(fx, "movement:token-sync-timeout");

  await assert.rejects(
    executeMovementTransaction(payload, {
      requestingUserId: "owner",
      positionSyncTimeoutMs: 15
    }),
    error => error.reasonCode === "POSITION_SYNC_TIMEOUT" && error.transactionNoEffects === true
  );

  assert.equal(fx.first.flags.mtrol.turnState.movementSpent, 0);
  assert.equal(fx.token.x, 0);
  assert.equal(fx.combat.flags.mtrol.runtime.receipts[payload.transactionId].status, "failed");
  assert.equal(fx.combat.flags.mtrol.runtime.receipts[payload.transactionId].failureSafety, "no-effects");
});

test("una intención adulterada se rechaza, revierte posición y no consume movimiento", async () => {
  const fx = fixture();
  fx.first.flags.mtrol.turnState.extraMovementRemaining = 0;
  fx.token.x = 200;
  const payload = movementPayload(fx, "movement:forged", { x: 0, y: 0 }, { x: 200, y: 0 });
  await assert.rejects(executeMovementTransaction(payload, { requestingUserId: "owner" }), /insuficiente/);
  assert.equal(fx.token.x, 0);
  assert.equal(fx.first.flags.mtrol.turnState.baseMovementRemaining, 1);
  assert.equal(fx.token.updateCalls.at(-1).options.mtrolMovementOperation, "rollback");
  assert.equal(fx.combat.flags.mtrol.runtime.receipts[payload.transactionId].status, "failed");
});

test("metadata de turno obsoleta se rechaza antes del consumo y revierte posición", async () => {
  const fx = fixture();
  fx.token.x = 100;
  const payload = movementPayload(fx, "movement:stale-turn");
  payload.movement.turn = 99;
  await assert.rejects(executeMovementTransaction(payload, { requestingUserId: "owner" }), /turno.*no está activo/i);
  assert.equal(fx.token.x, 0);
  assert.equal(fx.first.flags.mtrol.turnState.movementSpent, 0);
  assert.equal(fx.combat.flags.mtrol.runtime.receipts[payload.transactionId].status, "failed");
});

test("un movimiento aplicado sobre grid no soportada revierte aunque aún no exista receipt", async () => {
  const fx = fixture();
  fx.token.parent.grid.type = 0;
  fx.token.x = 100;
  const payload = movementPayload(fx, "movement:gridless-rejected");
  await assert.rejects(executeMovementTransaction(payload, { requestingUserId: "owner" }), /grid cuadrada/);
  assert.equal(fx.token.x, 0);
  assert.equal(fx.first.flags.mtrol.turnState.movementSpent, 0);
  assert.equal(fx.token.updateCalls.at(-1).options.mtrolMovementOperation, "rollback");
  assert.equal(fx.combat.flags.mtrol.runtime?.receipts?.[payload.transactionId], undefined);
});

test("recovery completa consumo faltante cuando la posición ya fue aplicada", async () => {
  const fx = fixture();
  const payload = movementPayload(fx, "movement:recover-consumption");
  fx.token.x = 100;
  await seedApplying(fx, payload);
  const result = await executeMovementTransaction(payload, { requestingUserId: "owner" });
  assert.equal(result.result.reconciled, "consumption-completed");
  assert.equal(fx.first.flags.mtrol.turnState.baseMovementRemaining, 0);
  assert.equal(fx.first.flags.mtrol.turnState.extraMovementRemaining, 1);
});

test("recovery completa posición faltante sin consumir dos veces", async () => {
  const fx = fixture();
  const payload = movementPayload(fx, "movement:recover-position");
  fx.first.flags.mtrol.turnState.baseMovementRemaining = 0;
  fx.first.flags.mtrol.turnState.extraMovementRemaining = 1;
  fx.first.flags.mtrol.turnState.movementSpent = 1;
  await seedApplying(fx, payload);
  const result = await executeMovementTransaction(payload, { requestingUserId: "owner" });
  assert.equal(result.result.reconciled, "position-completed");
  assert.equal(fx.token.x, 100);
  assert.equal(fx.first.flags.mtrol.turnState.movementSpent, 1);
  assert.equal(fx.token.updateCalls.at(-1).options.mtrolMovementOperation, "reconcile-position");
});

test("recovery reconoce posición y consumo ya aplicados con receipt incompleto", async () => {
  const fx = fixture();
  const payload = movementPayload(fx, "movement:recover-already-applied");
  fx.token.x = 100;
  fx.first.flags.mtrol.turnState.baseMovementRemaining = 0;
  fx.first.flags.mtrol.turnState.extraMovementRemaining = 1;
  fx.first.flags.mtrol.turnState.movementSpent = 1;
  await seedApplying(fx, payload);
  const result = await executeMovementTransaction(payload, { requestingUserId: "owner" });
  assert.equal(result.result.reconciled, "already-applied");
  assert.equal(fx.token.updateCalls.length, 0);
  assert.equal(fx.first.flags.mtrol.turnState.movementSpent, 1);
});

test("recovery completa posición y consumo si ninguno llegó a persistirse", async () => {
  const fx = fixture();
  const payload = movementPayload(fx, "movement:recover-both");
  await seedApplying(fx, payload);
  const result = await executeMovementTransaction(payload, { requestingUserId: "owner" });
  assert.equal(result.result.reconciled, "position-and-consumption-completed");
  assert.equal(fx.token.x, 100);
  assert.equal(fx.first.flags.mtrol.turnState.movementSpent, 1);
});

test("recovery ambiguo queda marcado para intervención y no muta estado", async () => {
  const fx = fixture();
  const payload = movementPayload(fx, "movement:recover-ambiguous");
  fx.token.x = 300;
  await seedApplying(fx, payload);
  await assert.rejects(executeMovementTransaction(payload, { requestingUserId: "owner" }), /requiere reconciliación manual/);
  assert.equal(fx.token.x, 300);
  assert.equal(fx.first.flags.mtrol.turnState.movementSpent, 0);
  assert.equal(fx.combat.flags.mtrol.runtime.receipts[payload.transactionId].status, "recovery-required");
  const warningCount = warnings.length;
  assert.deepEqual(await recoverMovementTransactions(fx.combat), {
    recoveredIds: [],
    requiredIds: [payload.transactionId]
  });
  assert.equal(warnings.length, warningCount + 1);
  await recoverMovementTransactions(fx.combat);
  assert.equal(warnings.length, warningCount + 1, "la misma alerta persistida no se repite");
});

test("renunciar GRANTED movement cierra y avanza exactamente una vez", async () => {
  const fx = fixture();
  const movementId = "grant:one";
  fx.first.flags.mtrol.grantedMovement = {
    id: movementId,
    status: "available",
    combatId: fx.combat.id,
    sourceCombatantId: fx.first.id,
    targetActorUuid: fx.actor.uuid,
    round: 1,
    turn: 0,
    remaining: 2,
    spent: 0
  };
  const payload = {
    transactionId: "movement-renounce:one",
    combatId: fx.combat.id,
    movementId,
    reason: "skipped"
  };
  const first = await executeMovementRenounceTransaction(payload, { requestingUserId: "owner" });
  const replay = await executeMovementRenounceTransaction(payload, { requestingUserId: "owner" });
  assert.deepEqual(replay, first);
  assert.equal(fx.first.flags.mtrol.grantedMovement, null);
  assert.equal(fx.combat.nextTurnCalls, 1);
});

test("ATTRIBUTE, GRANTED y REACTION usan el mismo commit transaccional tipado", async () => {
  const attribute = fixture();
  attribute.first.flags.mtrol.turnState.movementSource = "attribute";
  attribute.token.x = 100;
  await executeMovementTransaction({
    ...movementPayload(attribute, "movement:attribute"),
    source: "ATTRIBUTE",
    movement: { ...movementPayload(attribute, "movement:attribute").movement, source: "ATTRIBUTE" }
  }, { requestingUserId: "owner" });
  assert.equal(attribute.first.flags.mtrol.turnState.movementSpent, 1);

  const granted = fixture();
  const targetToken = { ...granted.token, actor: granted.other, uuid: `${granted.token.uuid}.granted`, updateCalls: [] };
  documents.set(targetToken.uuid, targetToken);
  granted.first.flags.mtrol.grantedMovement = {
    id: "grant:typed",
    status: "available",
    combatId: granted.combat.id,
    sourceCombatantId: granted.first.id,
    targetActorUuid: granted.other.uuid,
    targetTokenUuid: targetToken.uuid,
    round: 1,
    turn: 0,
    remaining: 2,
    spent: 0
  };
  targetToken.x = 100;
  await executeMovementTransaction({
    transactionId: "movement:granted",
    source: "GRANTED",
    combatId: granted.combat.id,
    tokenUuid: targetToken.uuid,
    from: { x: 0, y: 0 },
    to: { x: 100, y: 0 },
    movement: {
      id: "grant:typed",
      combatId: granted.combat.id,
      sourceCombatantId: granted.first.id,
      round: 1,
      turn: 0
    }
  }, { requestingUserId: "owner" });
  assert.equal(granted.first.flags.mtrol.grantedMovement.remaining, 1);

  const reaction = fixture();
  reactionMovement = {
    pendingActionId: "reaction:typed",
    actorUuid: reaction.actor.uuid,
    tokenUuid: reaction.token.uuid,
    allowance: 1,
    remaining: 1
  };
  reaction.token.x = 100;
  await executeMovementTransaction({
    transactionId: "movement:reaction",
    source: "REACTION",
    combatId: reaction.combat.id,
    tokenUuid: reaction.token.uuid,
    from: { x: 0, y: 0 },
    to: { x: 100, y: 0 },
    movement: { pendingActionId: "reaction:typed" }
  }, { requestingUserId: "owner" });
  assert.equal(reactionMovement, null);
  assert.equal(reaction.combat.nextTurnCalls, 0);
});

test("un GM secundario no puede confirmar ni recuperar transacciones", async () => {
  const fx = fixture();
  users.set("gm-2", { id: "gm-2", isGM: true, active: true });
  game.user = users.get("gm-2");
  const payload = movementPayload(fx, "movement:secondary-gm");
  fx.token.x = 100;
  await assert.rejects(executeMovementTransaction(payload, { requestingUserId: "owner" }), /Primary GM/);
  game.user = users.get("gm");
  users.delete("gm-2");
});

test("transacciones distintas y secuenciales consumen sólo sus desplazamientos reales", async () => {
  const fx = fixture();
  fx.token.x = 100;
  await executeMovementTransaction(movementPayload(fx, "movement:first"), { requestingUserId: "owner" });
  fx.token.x = 200;
  await executeMovementTransaction(
    movementPayload(fx, "movement:second", { x: 100, y: 0 }, { x: 200, y: 0 }),
    { requestingUserId: "owner" }
  );
  assert.equal(fx.first.flags.mtrol.turnState.movementSpent, 2);
  assert.equal(fx.first.flags.mtrol.turnState.baseMovementRemaining, 0);
  assert.equal(fx.first.flags.mtrol.turnState.extraMovementRemaining, 0);
});

test("transacciones distintas concurrentes sobre la misma reserva se serializan", async () => {
  const fx = fixture();
  fx.first.flags.mtrol.turnState.extraMovementRemaining = 0;
  fx.first.flags.mtrol.turnState.actionConsumed = true;
  fx.token.x = 100;
  const first = movementPayload(fx, "movement:concurrent-first");
  const second = movementPayload(fx, "movement:concurrent-second");
  const results = await Promise.allSettled([
    executeMovementTransaction(first, { requestingUserId: "owner" }),
    executeMovementTransaction(second, { requestingUserId: "owner" })
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(fx.first.flags.mtrol.turnState.movementSpent, 1);
  assert.equal(fx.combat.nextTurnCalls, 1);
  assert.equal(fx.token.x, 100, "el rechazo duplicado no revierte la posición ya confirmada");
  const receipts = fx.combat.flags.mtrol.runtime.receipts;
  assert.equal(receipts[first.transactionId].status, "completed");
  assert.equal(receipts[second.transactionId].status, "failed");
});

test("recovery limpia una reserva optimista zombie y permite revalidar", async () => {
  const fx = fixture();
  const abandoned = {};
  assert.equal(validateTurnMovement(fx.token, { x: 100 }, abandoned, "owner"), true);
  const blockedByReservation = {};
  assert.equal(validateTurnMovement(fx.token, { x: 200 }, blockedByReservation, "owner"), false);
  await recoverMovementTransactions(fx.combat);
  const afterRecovery = {};
  assert.equal(validateTurnMovement(fx.token, { x: 200 }, afterRecovery, "owner"), true);
});
