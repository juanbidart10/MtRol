import { replayCompactReceipt } from "./receipt-store.js";

function clone(value) {
  if (globalThis.foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
  return value === undefined ? undefined : structuredClone(value);
}

export class TransactionRecoveryRequiredError extends Error {
  constructor(transactionId, reason = "transaction-state-ambiguous") {
    super(`La transacción ${transactionId} requiere reconciliación manual: ${reason}.`);
    this.name = "TransactionRecoveryRequiredError";
    this.transactionId = transactionId;
    this.reason = reason;
    this.reasonCode = "RECOVERY_REQUIRED";
  }
}

export class TransactionCoordinator {
  constructor({ combatReceiptStore, actorReceiptStore, logger = null, relatedScopes = () => [], notify = null, authority = null } = {}) {
    this.combatReceiptStore = combatReceiptStore;
    this.actorReceiptStore = actorReceiptStore;
    this.logger = logger;
    this.relatedScopes = relatedScopes;
    this.notify = notify;
    this.authority = authority;
    this.inFlight = new Map();
    this.operationQueues = new Map();
  }

  resolveStore(scope = {}) {
    const { combat = null, actor = null, receiptScope = null } = scope;
    if (combat) return { store: this.combatReceiptStore, target: combat };
    if (actor) return { store: this.actorReceiptStore, target: actor };
    if (receiptScope) {
      return { store: this.combatReceiptStore, target: receiptScope };
    }
    throw new Error("La transacción requiere Combat o Actor como scope persistente.");
  }

  get(scope, transactionId) {
    const { store, target } = this.resolveStore(scope);
    return store.get(target, transactionId);
  }

  // Damage and resources share the affected Actor, not the attacker. Orbs use
  // the same Actor write boundary. No gameplay state is stored in this queue.
  recoveryKey(scope, command, metadata = {}) {
    if (!/^(resource|damage|orb)\./.test(String(command ?? ""))) return null;
    const actorUuid = metadata.targetActorUuid ?? metadata.actorUuid ?? scope.actor?.uuid;
    return actorUuid ? `actor:${actorUuid}` : null;
  }

  assertNoBlockingTransaction(scope, { transactionId, command, metadata }) {
    const key = this.recoveryKey(scope, command, metadata);
    if (!key) return;
    for (const candidateScope of [scope, ...this.relatedScopes(scope)]) {
      const { store, target } = this.resolveStore(candidateScope);
      const resolved = store.resolve(target);
      const receipts = resolved.repository.read(resolved.target)?.receipts ?? {};
      for (const receipt of Object.values(receipts)) {
        if (receipt.transactionId === transactionId && candidateScope === scope) continue;
        if (receipt.status === "completed" || (receipt.status === "failed" &&
            ["no-effects", "rolled-back"].includes(receipt.failureSafety))) continue;
        if (this.recoveryKey(candidateScope, receipt.command, receipt) !== key) continue;
        this.logger?.warn?.("RECOVERY", "mutation blocked by unresolved transaction", {
          command, transactionId, blockingTransactionId: receipt.transactionId, resourceKey: key
        });
        throw new TransactionRecoveryRequiredError(receipt.transactionId, "conflicting-actor-transaction");
      }
    }
  }

  async amendCompletedResult(scope, transactionId, mutator) {
    const { store, target } = this.resolveStore(scope);
    return store.update(target, transactionId, receipt => {
      if (receipt.status !== "completed") {
        throw new Error(`La transacción ${transactionId} aún no está completada.`);
      }
      receipt.result = clone(mutator(clone(receipt.result)));
      return receipt.result;
    });
  }

  async execute(scope, {
    transactionId,
    command,
    metadata = {},
    prepare = null,
    apply,
    reconcile = null,
    serializationKey = null
    ,authorityContext = null
  } = {}) {
    if (!transactionId || typeof apply !== "function") {
      throw new TypeError("TransactionCoordinator requiere transactionId y apply.");
    }
    const { store, target } = this.resolveStore(scope);
    const scopeKey = `${target.uuid ?? target.id ?? target.scopeId ?? "runtime"}:${transactionId}`;
    const resourceKey = this.recoveryKey(scope, command, metadata);
    const pending = this.inFlight.get(scopeKey);
    if (pending) {
      if (pending.command !== command || pending.resourceKey !== resourceKey) {
        throw Object.assign(new Error("El transactionId pertenece a otra operación en curso."), { reasonCode: "TRANSACTION_CONFLICT" });
      }
      return pending.operation;
    }

    const run = async () => {
      const existing = store.get(target, transactionId);
      if (existing?.command && existing.command !== command) {
        throw Object.assign(new Error("El transactionId pertenece a otro command."), { reasonCode: "TRANSACTION_CONFLICT" });
      }
      if (existing && this.recoveryKey(scope, existing.command, existing) !== resourceKey) {
        throw Object.assign(new Error("El transactionId pertenece a otro Actor."), { reasonCode: "TRANSACTION_CONFLICT" });
      }
      const compactReplay = replayCompactReceipt(existing);
      if (compactReplay.handled) return clone(compactReplay.result);
      if (existing?.status === "completed") return clone(existing.result);
      if (existing && !(existing.status === "failed" &&
          ["no-effects", "rolled-back"].includes(existing.failureSafety))) {
        if (existing.status === "applied" && existing.result != null) {
          await store.complete(target, transactionId, existing.result);
          return clone(existing.result);
        }
        if (typeof reconcile === "function") {
          const recoveryInput = clone(existing);
          // An error envelope is not the domain's completed result. Reconcilers
          // must reconstruct success from their durable evidence instead.
          if (recoveryInput.result?.reasonCode === "RECOVERY_REQUIRED" &&
              recoveryInput.result?.status === "recovery-required") recoveryInput.result = null;
          const recovered = await reconcile(recoveryInput);
          if (recovered?.resolved) {
            await store.complete(target, transactionId, recovered.result);
            return clone(recovered.result);
          }
        }
        await store.transition(target, transactionId, "recovery-required", {
          recoveryReason: existing.recoveryReason ?? "interrupted-or-ambiguous"
        });
        throw new TransactionRecoveryRequiredError(transactionId);
      }
      if (existing?.status === "failed") return clone(existing.result);

      this.assertNoBlockingTransaction(scope, { transactionId, command, metadata });
      const assertAuthority = () => authorityContext
        ? this.authority?.validateWriteContext(authorityContext)
        : true;
      assertAuthority();
      await store.begin(target, transactionId, { command, authorityContext: clone(authorityContext) });
      await store.transition(target, transactionId, "prepared", clone(metadata));
      let applyEntered = false;
      try {
        const prepared = prepare ? await prepare() : null;
        await store.transition(target, transactionId, "applying", {
          prepared: clone(prepared),
          checkpoints: {}
        });
        const checkpoint = async (name, data = {}) => { assertAuthority(); return store.update(target, transactionId, receipt => {
          receipt.checkpoints ??= {};
          receipt.checkpoints[name] = { at: Date.now(), ...clone(data) };
          return receipt;
        }); };
        applyEntered = true;
        const result = await apply({ prepared, checkpoint, transactionId, assertAuthority });
        assertAuthority();
        await store.transition(target, transactionId, "applied", { result: clone(result) });
        await store.complete(target, transactionId, result);
        return clone(result);
      } catch (error) {
        if (store.get(target, transactionId)?.status === "completed") {
          return clone(store.get(target, transactionId).result);
        }
        let needsRecovery = applyEntered && error?.transactionNoEffects !== true && error?.transactionRolledBack !== true;
        try {
          await store.update(target, transactionId, receipt => {
          const hasCheckpoint = Object.keys(receipt.checkpoints ?? {}).length > 0;
          const safelyRolledBack = error?.transactionRolledBack === true;
          needsRecovery ||= hasCheckpoint && !safelyRolledBack;
          // A durable applied result is sufficient evidence for receipt-only
          // completion. Never destroy it just because the final ACK failed.
          if (receipt.status === "applied" && receipt.result != null) return receipt;
          receipt.status = needsRecovery ? "recovery-required" : "failed";
          receipt.failureSafety = needsRecovery ? null : safelyRolledBack ? "rolled-back" : "no-effects";
          receipt.recoveryReason = needsRecovery ? error.message : null;
          receipt.error = error.message;
          receipt.result = {
            ok: false,
            transactionId,
            status: receipt.status,
            changed: needsRecovery,
            result: null,
            reasonCode: needsRecovery ? "RECOVERY_REQUIRED" : "TRANSACTION_FAILED"
          };
          return receipt;
          });
        } catch (persistenceError) {
          needsRecovery = true;
          (this.logger?.errorOnce ?? this.logger?.error)?.call(this.logger, "RECOVERY", "failed to persist transaction failure", {
            command, transactionId, error: persistenceError.message
          }, { key: `failure-persistence:${transactionId}` });
        }
        if (needsRecovery) {
          error.reasonCode ??= "RECOVERY_REQUIRED";
          (this.logger?.errorOnce ?? this.logger?.error)?.call(this.logger, "RECOVERY", "transaction requires review", {
            command, transactionId, resourceKey: this.recoveryKey(scope, command, metadata), error: error.message
          }, { key: `recovery-required:${transactionId}` });
          try {
            this.notify?.(`MTROL | La transacción ${transactionId} requiere revisión; no se repetirá automáticamente.`);
          } catch (notificationError) {
            (this.logger?.warnOnce ?? this.logger?.warn)?.call(this.logger, "RECOVERY", "recovery notification failed", {
              command, transactionId, error: notificationError.message
            }, { key: `recovery-notification:${transactionId}` });
          }
        }
        throw error;
      }
    };
    const queueKey = this.recoveryKey(scope, command, metadata) ?? (serializationKey
      ? `${target.uuid ?? target.id ?? target.scopeId ?? "runtime"}:${serializationKey}`
      : null);
    const previous = queueKey ? this.operationQueues.get(queueKey) ?? Promise.resolve() : Promise.resolve();
    const operation = previous.catch(() => undefined).then(run);
    this.inFlight.set(scopeKey, { operation, command, resourceKey });
    if (queueKey) this.operationQueues.set(queueKey, operation);
    try {
      return await operation;
    } finally {
      this.inFlight.delete(scopeKey);
      if (queueKey && this.operationQueues.get(queueKey) === operation) {
        this.operationQueues.delete(queueKey);
      }
      await store.compactAfterOperation?.(target, {
        isTransactionInFlight: candidateId => {
          const candidateKey = `${target.uuid ?? target.id ?? target.scopeId ?? "runtime"}:${candidateId}`;
          return this.inFlight.has(candidateKey);
        }
      });
    }
  }
}
