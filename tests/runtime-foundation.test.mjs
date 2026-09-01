import test from "node:test";
import assert from "node:assert/strict";

import {
  MTROL_RUNTIME_SCHEMA_VERSION,
  RuntimeRepository,
  RuntimeRevisionConflictError,
  createDefaultRuntime
} from "../scripts/runtime/runtime-repository.js";
import {
  ReceiptFailedError,
  ReceiptInProgressError,
  ReceiptStore
} from "../scripts/runtime/receipt-store.js";
import {
  CommandBoundaryError,
  CommandRegistry
} from "../scripts/runtime/command-registry.js";
import { MtrolLogger, installMtrolLoggerApi } from "../scripts/utils/logger.js";
import { RecoveryCoordinator } from "../scripts/runtime/recovery-coordinator.js";

function clone(value) {
  return structuredClone(value);
}

function createCombat({ id = "combat-1", runtime = null, beforeUpdate = null } = {}) {
  return {
    id,
    flags: runtime ? { mtrol: { runtime: clone(runtime) } } : {},
    updates: [],
    async update(change) {
      await beforeUpdate?.(this, change);
      this.updates.push(clone(change));
      this.flags.mtrol ??= {};
      this.flags.mtrol.runtime = clone(change["flags.mtrol.runtime"]);
      return this;
    }
  };
}

test("RuntimeRepository inicializa lazy un aggregate versionado", async () => {
  const combat = createCombat();
  const repository = new RuntimeRepository();
  const runtime = await repository.ensure(combat);

  assert.equal(runtime.schemaVersion, MTROL_RUNTIME_SCHEMA_VERSION);
  assert.equal(runtime.revision, 0);
  assert.deepEqual(runtime.pendingActions, {});
  assert.deepEqual(runtime.receipts, {});
  assert.equal(combat.updates.length, 1);
});

test("RuntimeRepository incrementa revision monotonicamente", async () => {
  const combat = createCombat({ runtime: createDefaultRuntime() });
  const repository = new RuntimeRepository();

  const first = await repository.mutate(combat, draft => {
    draft.pendingActions.one = { id: "one" };
  });
  const second = await repository.mutate(combat, draft => {
    draft.pendingActions.two = { id: "two" };
  });

  assert.equal(first.runtime.revision, 1);
  assert.equal(second.runtime.revision, 2);
  assert.deepEqual(Object.keys(second.runtime.pendingActions), ["one", "two"]);
});

test("runtime base reserva metadata de recovery transaccional de movimiento", () => {
  const runtime = createDefaultRuntime();
  assert.deepEqual(runtime.recovery.requiredTransactionIds, []);
  assert.deepEqual(runtime.recovery.notifiedTransactionIds, []);
  assert.equal(runtime.recovery.lastMovementRunAt, null);
});

test("RuntimeRepository detecta una escritura con revision obsoleta", async () => {
  const runtime = createDefaultRuntime();
  runtime.revision = 10;
  const combat = createCombat({ runtime });
  const repository = new RuntimeRepository();
  const stale = repository.read(combat);
  combat.flags.mtrol.runtime.revision = 11;

  await assert.rejects(
    repository.write(combat, stale, { expectedRevision: 10 }),
    error => error instanceof RuntimeRevisionConflictError &&
      error.expectedRevision === 10 && error.actualRevision === 11
  );
});

test("RuntimeRepository relee y reintenta un conflicto acotado", async () => {
  const combat = createCombat({ runtime: createDefaultRuntime() });
  class ConflictOnceRepository extends RuntimeRepository {
    async write(combatOrId, nextRuntime, options) {
      if (!this.injected) {
        this.injected = true;
        combat.flags.mtrol.runtime.revision += 1;
      }
      return super.write(combatOrId, nextRuntime, options);
    }
  }
  const repository = new ConflictOnceRepository({ maxRetries: 2 });
  let mutations = 0;

  const result = await repository.mutate(combat, draft => {
    mutations += 1;
    draft.pendingActions.action = { id: "action" };
  });

  assert.equal(result.attempts, 2);
  assert.equal(mutations, 2);
  assert.equal(result.runtime.revision, 2);
});

test("RuntimeRepository aborta cuando se agotan los reintentos", async () => {
  const combat = createCombat({ runtime: createDefaultRuntime() });
  class AlwaysConflictRepository extends RuntimeRepository {
    async write(combatOrId, nextRuntime, options) {
      combat.flags.mtrol.runtime.revision += 1;
      return super.write(combatOrId, nextRuntime, options);
    }
  }
  const repository = new AlwaysConflictRepository({ maxRetries: 1 });

  await assert.rejects(
    repository.mutate(combat, draft => {
      draft.pendingActions.action = { id: "action" };
    }),
    RuntimeRevisionConflictError
  );
  assert.equal(combat.updates.length, 0);
});

test("ReceiptStore devuelve el resultado previo sin repetir side effects", async () => {
  const combat = createCombat({ runtime: createDefaultRuntime() });
  const repository = new RuntimeRepository();
  const receipts = new ReceiptStore({ repository });
  let sideEffects = 0;

  const first = await receipts.execute(combat, {
    transactionId: "transaction-X",
    command: "opposition.respond"
  }, async () => ({ mutation: ++sideEffects }));
  const second = await receipts.execute(combat, {
    transactionId: "transaction-X",
    command: "opposition.respond"
  }, async () => ({ mutation: ++sideEffects }));

  assert.deepEqual(first, { mutation: 1 });
  assert.deepEqual(second, first);
  assert.equal(sideEffects, 1);
  assert.equal(receipts.get(combat, "transaction-X").status, "completed");
});

test("ReceiptStore identifica un receipt processing despues de perder RAM", async () => {
  const runtime = createDefaultRuntime();
  runtime.receipts.processing = {
    transactionId: "processing",
    command: "opposition.resolve",
    status: "processing"
  };
  const combat = createCombat({ runtime });
  const receipts = new ReceiptStore({ repository: new RuntimeRepository() });

  await assert.rejects(
    receipts.execute(combat, {
      transactionId: "processing",
      command: "opposition.resolve"
    }, async () => null),
    ReceiptInProgressError
  );
});

test("ReceiptStore no reejecuta automaticamente una transaccion fallida", async () => {
  const combat = createCombat({ runtime: createDefaultRuntime() });
  const receipts = new ReceiptStore({ repository: new RuntimeRepository() });
  let calls = 0;
  await assert.rejects(
    receipts.execute(combat, {
      transactionId: "failed-once",
      command: "opposition.respond"
    }, async () => {
      calls += 1;
      throw new Error("fallo persistido");
    }),
    /fallo persistido/
  );
  await assert.rejects(
    receipts.execute(combat, {
      transactionId: "failed-once",
      command: "opposition.respond"
    }, async () => {
      calls += 1;
      return null;
    }),
    ReceiptFailedError
  );
  assert.equal(calls, 1);
});

test("CommandRegistry valida boundary y aplica idempotencia", async () => {
  const combat = createCombat({ runtime: createDefaultRuntime() });
  globalThis.game = {
    combat,
    combats: new Map([[combat.id, combat]])
  };
  const repository = new RuntimeRepository();
  const receipts = new ReceiptStore({ repository });
  const registry = new CommandRegistry({ receiptStore: receipts });
  let calls = 0;
  registry.register("opposition.create", async payload => ({
    id: payload.id,
    calls: ++calls
  }));
  const envelope = {
    command: "opposition.create",
    transactionId: "create-one",
    combatId: combat.id,
    payload: { id: "one" }
  };
  const context = { isPrimaryGM: true, requestingUserId: "user-1" };

  assert.deepEqual(await registry.dispatch(envelope, context), { id: "one", calls: 1 });
  assert.deepEqual(await registry.dispatch(envelope, context), { id: "one", calls: 1 });
  assert.equal(calls, 1);

  await assert.rejects(
    registry.dispatch({ ...envelope, transactionId: "" }, context),
    CommandBoundaryError
  );
});

test("response y resolve duplicados no repiten daño, recursos, cooldown ni nextTurn", async () => {
  const combat = createCombat({ id: "combat-exactly-once", runtime: createDefaultRuntime() });
  globalThis.game = {
    combat,
    combats: new Map([[combat.id, combat]])
  };
  const repository = new RuntimeRepository();
  const registry = new CommandRegistry({
    receiptStore: new ReceiptStore({ repository })
  });
  const effects = { damage: 0, resource: 0, cooldown: 0, nextTurn: 0 };
  registry.register("opposition.respond", async () => {
    effects.resource += 1;
    effects.cooldown += 1;
    return { accepted: true };
  });
  registry.register("opposition.resolve", async () => {
    effects.damage += 1;
    effects.nextTurn += 1;
    return { resolved: true };
  });
  const context = { isPrimaryGM: true, requestingUserId: "defender" };
  const responseEnvelope = {
    command: "opposition.respond",
    transactionId: "same-response",
    combatId: combat.id,
    payload: { pendingActionId: "action" }
  };
  const resolveEnvelope = {
    command: "opposition.resolve",
    transactionId: "same-resolve",
    combatId: combat.id,
    payload: { pendingActionId: "action" }
  };

  await registry.dispatch(responseEnvelope, context);
  await registry.dispatch(responseEnvelope, context);
  await registry.dispatch(resolveEnvelope, context);
  await registry.dispatch(resolveEnvelope, context);

  assert.deepEqual(effects, {
    damage: 1,
    resource: 1,
    cooldown: 1,
    nextTurn: 1
  });
});

test("rechazo mecánico completado produce receipt estable e idempotente", async () => {
  const combat = createCombat();
  globalThis.game = {
    combat,
    combats: new Map([[combat.id, combat]])
  };
  const repository = new RuntimeRepository();
  const registry = new CommandRegistry({
    receiptStore: new ReceiptStore({ repository }),
    resolveCombat: id => game.combats.get(id)
  });
  let evaluations = 0;
  registry.register("opposition.respond", async () => {
    evaluations += 1;
    return {
      rejected: true,
      reasonCode: "COUNTERATTACK_DOMAIN_MISMATCH",
      humanReason: "Dominio incompatible."
    };
  });
  const envelope = {
    command: "opposition.respond",
    transactionId: "rejected-response",
    combatId: combat.id,
    payload: { pendingActionId: "pending" }
  };
  const context = { isPrimaryGM: true, requestingUserId: "player" };
  const first = await registry.dispatch(envelope, context);
  const retry = await registry.dispatch(envelope, context);

  assert.deepEqual(retry, first);
  assert.equal(evaluations, 1);
  assert.equal(repository.read(combat).receipts[envelope.transactionId].status, "completed");
});

test("MtrolLogger usa warn por defecto y permite channels de debug", () => {
  const entries = [];
  const sink = {
    debug: (...args) => entries.push(["debug", ...args]),
    info: (...args) => entries.push(["info", ...args]),
    warn: (...args) => entries.push(["warn", ...args]),
    error: (...args) => entries.push(["error", ...args])
  };
  const logger = new MtrolLogger({ sink });
  logger.debug("OPPOSITION", "oculto");
  logger.warn("RECOVERY", "visible", { combatId: "combat-1" });
  logger.enableChannel("OPPOSITION");
  logger.debug("OPPOSITION", "visible debug");

  assert.equal(entries.length, 2);
  assert.equal(entries[0][0], "warn");
  assert.match(entries[0][1], /RECOVERY/);
  assert.equal(entries[1][0], "debug");
});

test("logger deduplica por key y sanitiza Errors/Documents", () => {
  const entries = [];
  const sink = { warn: (...args) => entries.push(args) };
  const log = new MtrolLogger({ sink });
  const actor = { uuid: "Actor.safe", id: "safe", documentName: "Actor", async update() {} };
  const context = { transactionId: "tx-log", actor, error: new Error("fallo controlado") };
  assert.equal(log.warnOnce("COMMAND", "rejected", context, { key: "same-tx" }), true);
  assert.equal(log.warnOnce("COMMAND", "rejected", context, { key: "same-tx" }), false);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0][1].actor, { uuid: "Actor.safe", id: "safe", documentName: "Actor" });
  assert.equal(entries[0][1].error, "fallo controlado");
});

test("logger expira cada key según su propia window sin colapsar errores distintos", () => {
  const entries = [];
  const sink = { warn: (...args) => entries.push(args) };
  const log = new MtrolLogger({ sink });
  const originalNow = Date.now;
  let now = 100000;
  Date.now = () => now;
  try {
    assert.equal(log.warnOnce("COMMAND", "same", { error: new Error("uno") }, {
      key: "short", windowMs: 100
    }), true);
    assert.equal(log.warnOnce("COMMAND", "same", { error: new Error("uno") }, {
      key: "short", windowMs: 100
    }), false);
    assert.equal(log.warnOnce("COMMAND", "same", { error: new Error("dos") }, {
      key: "long", windowMs: 1000
    }), true);
    now += 101;
    assert.equal(log.warnOnce("COMMAND", "same", { error: new Error("uno") }, {
      key: "short", windowMs: 100
    }), true);
    assert.equal(log.recentKeys.has("long"), true);
    assert.equal(entries.length, 3);
    assert.equal(entries[0][1].error, "uno");
    assert.equal(entries[1][1].error, "dos");
  } finally {
    Date.now = originalNow;
  }
});

test("logger libera 1000 keys vencidas mediante cleanup oportunista", () => {
  const log = new MtrolLogger({ sink: { warn() {} } });
  const originalNow = Date.now;
  let now = 200000;
  Date.now = () => now;
  try {
    for (let index = 0; index < 1000; index += 1) {
      log.warnOnce("STRESS", "burst", { transactionId: `tx-${index}` }, {
        key: `tx-${index}`,
        windowMs: 50
      });
    }
    assert.equal(log.recentKeys.size, 1000);
    now += 51;
    log.warnOnce("STRESS", "cleanup", {}, { key: "cleanup", windowMs: 50 });
    assert.equal(log.recentKeys.size, 1);
  } finally {
    Date.now = originalNow;
  }
});

test("Command Registry rechaza resultados undefined con reasonCode estable", async () => {
  const registry = new CommandRegistry();
  registry.register("test.undefined", () => undefined, { idempotent: false, scope: "world" });
  await assert.rejects(
    () => registry.dispatch({
      command: "test.undefined",
      transactionId: "undefined-result",
      payload: {}
    }, { isPrimaryGM: true, requestingUserId: "gm" }),
    error => error instanceof CommandBoundaryError && error.reasonCode === "COMMAND_RESULT_UNDEFINED"
  );
});

test("logger expone una facade debug estable sin borrar APIs existentes", () => {
  globalThis.game = {
    mtrol: {
      debug: {
        existingAudit: () => true
      }
    }
  };
  installMtrolLoggerApi();

  assert.equal(game.mtrol.debug.existingAudit(), true);
  assert.equal(typeof game.mtrol.debug.setLevel, "function");
  assert.equal(typeof game.mtrol.debug.enableChannel, "function");
  assert.equal(typeof game.mtrol.debug.disableChannel, "function");
});

test("pendingAction persiste en la coleccion canonica del Combat", async () => {
  const combat = createCombat({ runtime: createDefaultRuntime() });
  const repository = new RuntimeRepository();
  await repository.mutate(combat, draft => {
    draft.pendingActions["pending-1"] = {
      id: "pending-1",
      combatId: combat.id,
      status: "waiting-defense"
    };
  });

  const reloadedRepository = new RuntimeRepository();
  assert.equal(
    reloadedRepository.read(combat).pendingActions["pending-1"].status,
    "waiting-defense"
  );
});

test("Recovery reconstruye cache y presentacion de waiting-defense sin crear otra accion", async () => {
  const runtime = createDefaultRuntime();
  runtime.pendingActions.waiting = {
    id: "waiting",
    combatId: "combat-recovery",
    status: "waiting-defense",
    pendingMessageId: "message-existing",
    actionDomain: "MAGICAL",
    allowedResponses: ["DODGE"],
    responseDeclaration: {
      itemUuid: "Actor.defender.Item.auric",
      actionType: "spell",
      selectedCapability: "DODGE",
      responseDomain: null,
      mode: "auric"
    }
  };
  const combat = createCombat({ id: "combat-recovery", runtime });
  const repository = new RuntimeRepository();
  const receipts = new ReceiptStore({ repository });
  const coordinator = new RecoveryCoordinator({ repository, receiptStore: receipts });
  let hydrated = null;
  let presentations = 0;
  coordinator.configure({
    hydrateCache: value => { hydrated = clone(value.pendingActions); },
    recoverPresentation: async pendingAction => {
      presentations += 1;
      assert.equal(pendingAction.id, "waiting");
      return { id: pendingAction.pendingMessageId };
    }
  });

  const result = await coordinator.recover(combat, {
    authorityUserId: "gm-b",
    isPrimaryGM: true
  });

  assert.deepEqual(Object.keys(hydrated), ["waiting"]);
  assert.equal(presentations, 1);
  assert.deepEqual(result.waitingIds, ["waiting"]);
  assert.equal(result.runtime.pendingActions.waiting.id, "waiting");
  assert.equal(result.runtime.pendingActions.waiting.actionDomain, "MAGICAL");
  assert.deepEqual(result.runtime.pendingActions.waiting.allowedResponses, ["DODGE"]);
  assert.equal(result.runtime.pendingActions.waiting.responseDeclaration.selectedCapability, "DODGE");
  assert.equal(result.runtime.pendingActions.waiting.responseDeclaration.mode, "auric");
  assert.equal(result.runtime.authority.lastAuthorityUserId, "gm-b");
});

test("Recovery coherencia resolving completado desde receipt sin repetir efectos", async () => {
  const runtime = createDefaultRuntime();
  runtime.pendingActions.action = {
    id: "action",
    status: "resolving",
    resolutionTransactionId: "resolve-action"
  };
  runtime.receipts["resolve-action"] = {
    transactionId: "resolve-action",
    command: "opposition.resolve",
    pendingActionId: "action",
    status: "completed",
    result: {
      pendingAction: {
        id: "action",
        status: "resolved",
        result: { success: true }
      }
    }
  };
  const combat = createCombat({ runtime });
  const repository = new RuntimeRepository();
  const coordinator = new RecoveryCoordinator({
    repository,
    receiptStore: new ReceiptStore({ repository })
  });

  const result = await coordinator.recover(combat, {
    authorityUserId: "gm-new",
    isPrimaryGM: true
  });

  assert.equal(result.runtime.pendingActions.action.status, "resolved");
  assert.deepEqual(result.recoveredIds, ["action"]);
  assert.deepEqual(result.requiredIds, []);
});

test("Recovery marca resolving ambiguo y avisa al GM una sola vez", async () => {
  const runtime = createDefaultRuntime();
  runtime.pendingActions.action = {
    id: "action",
    status: "resolving",
    resolutionTransactionId: "respond-action"
  };
  runtime.receipts["respond-action"] = {
    transactionId: "respond-action",
    command: "opposition.respond",
    pendingActionId: "action",
    status: "processing"
  };
  const combat = createCombat({ runtime });
  const repository = new RuntimeRepository();
  const coordinator = new RecoveryCoordinator({
    repository,
    receiptStore: new ReceiptStore({ repository })
  });
  let warnings = 0;
  const options = {
    authorityUserId: "gm-new",
    isPrimaryGM: true,
    notify: () => { warnings += 1; }
  };

  const first = await coordinator.recover(combat, options);
  const second = await coordinator.recover(combat, options);

  assert.equal(first.runtime.pendingActions.action.status, "recovery-required");
  assert.deepEqual(first.requiredIds, ["action"]);
  assert.equal(warnings, 1);
  assert.deepEqual(second.runtime.recovery.notifiedPendingActionIds, ["action"]);
});

test("Recovery completa create interrumpido si la pendingAction mecanica ya existe", async () => {
  const runtime = createDefaultRuntime();
  runtime.pendingActions.action = {
    id: "action",
    status: "waiting-defense"
  };
  runtime.receipts.create = {
    transactionId: "create",
    command: "opposition.create",
    pendingActionId: "action",
    status: "processing"
  };
  const combat = createCombat({ runtime });
  const repository = new RuntimeRepository();
  const coordinator = new RecoveryCoordinator({
    repository,
    receiptStore: new ReceiptStore({ repository })
  });

  const result = await coordinator.recover(combat, {
    authorityUserId: "gm-b",
    isPrimaryGM: true
  });

  assert.equal(result.runtime.pendingActions.action.status, "waiting-defense");
  assert.equal(result.runtime.receipts.create.status, "completed");
  assert.equal(result.runtime.receipts.create.result.pendingAction.id, "action");
});

test("un cliente no autoritativo solo hidrata y nunca escribe recovery", async () => {
  const runtime = createDefaultRuntime();
  runtime.pendingActions.action = { id: "action", status: "waiting-defense" };
  const combat = createCombat({ runtime });
  const repository = new RuntimeRepository();
  const coordinator = new RecoveryCoordinator({
    repository,
    receiptStore: new ReceiptStore({ repository })
  });
  let hydrated = false;
  coordinator.configure({ hydrateCache: () => { hydrated = true; } });

  const result = await coordinator.recover(combat, { isPrimaryGM: false });

  assert.equal(result.authoritative, false);
  assert.equal(hydrated, true);
  assert.equal(combat.updates.length, 0);
});
