function clone(value) {
  if (globalThis.foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
  return value === undefined ? undefined : structuredClone(value);
}

export class RecoveryCoordinator {
  constructor({ repository, receiptStore, actorRepository = null, actorReceiptStore = null, logger = null } = {}) {
    if (!repository || !receiptStore) {
      throw new Error("RecoveryCoordinator requiere repository y receiptStore.");
    }
    this.repository = repository;
    this.receiptStore = receiptStore;
    this.actorRepository = actorRepository;
    this.actorReceiptStore = actorReceiptStore;
    this.logger = logger;
    this.hydrateCache = null;
    this.recoverPresentation = null;
  }

  async recoverTransactionReceipts(target, store) {
    const runtime = store.repository.read(target);
    if (!runtime) return { completedIds: [], requiredIds: [] };
    const completedIds = [];
    const requiredIds = [];
    for (const receipt of Object.values(runtime.receipts ?? {})) {
      if (!/^(damage|resource|consumable|movement|state|orb)\./.test(String(receipt?.command ?? ""))) continue;
      if (receipt.status === "applied" && receipt.result) {
        await store.complete(target, receipt.transactionId, receipt.result);
        completedIds.push(receipt.transactionId);
      } else if (["processing", "prepared", "applying"].includes(receipt.status)) {
        await store.transition(target, receipt.transactionId, "recovery-required", {
          recoveryReason: "authority-restarted-during-transaction"
        });
        requiredIds.push(receipt.transactionId);
      } else if (receipt.status === "recovery-required") {
        requiredIds.push(receipt.transactionId);
      } else if (receipt.status !== "completed" && !(receipt.status === "failed" &&
          ["no-effects", "rolled-back"].includes(receipt.failureSafety))) {
        // Report legacy/unknown evidence without rewriting or inventing it.
        requiredIds.push(receipt.transactionId);
      }
    }
    return { completedIds, requiredIds };
  }

  async recoverActorTransactions(actors = [], { isPrimaryGM = false, notify = null } = {}) {
    if (!isPrimaryGM || !this.actorReceiptStore) {
      return { recovered: false, completedIds: [], requiredIds: [] };
    }
    const completedIds = [];
    const requiredIds = [];
    for (const actor of Array.from(actors?.values?.() ?? actors ?? [])) {
      const recovered = await this.recoverTransactionReceipts(actor, this.actorReceiptStore);
      completedIds.push(...recovered.completedIds);
      requiredIds.push(...recovered.requiredIds);
      if (recovered.requiredIds.length) this.logger?.warn?.("RECOVERY", "Actor transactions require review", {
        actorUuid: actor.uuid, count: recovered.requiredIds.length
      });
    }
    if (requiredIds.length) notify?.(`MTROL | ${requiredIds.length} transacción(es) de Actor requieren revisión del GM.`);
    return { recovered: true, completedIds, requiredIds };
  }

  configure({ hydrateCache = null, recoverPresentation = null } = {}) {
    this.hydrateCache = hydrateCache;
    this.recoverPresentation = recoverPresentation;
    return this;
  }

  async recover(combatOrId, {
    authorityUserId = null,
    isPrimaryGM = false,
    notify = null
  } = {}) {
    const combat = this.repository.resolveCombat(combatOrId);
    if (!combat) return { recovered: false, reason: "no-combat", runtime: null };

    if (!isPrimaryGM) {
      const runtime = this.repository.read(combat);
      if (!runtime) {
        return { recovered: false, authoritative: false, reason: "no-runtime", runtime: null };
      }
      await this.hydrateCache?.(runtime, combat);
      return { recovered: true, authoritative: false, runtime };
    }

    let runtime = await this.repository.ensure(combat);

    const transactionRecovery = await this.recoverTransactionReceipts(combat, this.receiptStore);
    if (transactionRecovery.requiredIds.length) notify?.(
      `MTROL | ${transactionRecovery.requiredIds.length} transacción(es) de combate requieren revisión del GM.`
    );

    const recoveredIds = new Set();
    const requiredIds = new Set();
    const waitingIds = new Set();
    const mutation = await this.repository.mutate(combat, draft => {
      for (const [id, pendingAction] of Object.entries(draft.pendingActions)) {
        if (!pendingAction || typeof pendingAction !== "object") continue;
        const processingReceipts = Object.values(draft.receipts).filter(receipt =>
          receipt?.pendingActionId === id && receipt.status === "processing"
        );
        if (pendingAction.status === "waiting-defense") {
          const createReceipt = processingReceipts.find(receipt =>
            receipt.command === "opposition.create"
          );
          const ambiguousReceipt = processingReceipts.find(receipt =>
            receipt.command !== "opposition.create"
          );
          if (ambiguousReceipt) {
            pendingAction.status = "recovery-required";
            pendingAction.recoveryReason = `command-interrupted:${ambiguousReceipt.command}`;
            pendingAction.updatedAt = Date.now();
            requiredIds.add(id);
            continue;
          }
          if (createReceipt) {
            createReceipt.status = "completed";
            createReceipt.updatedAt = Date.now();
            createReceipt.completedAt = createReceipt.updatedAt;
            createReceipt.result = { pendingAction: clone(pendingAction) };
            recoveredIds.add(id);
          }
          waitingIds.add(id);
          continue;
        }
        if (pendingAction.status === "recovery-required") {
          requiredIds.add(id);
          continue;
        }
        if (["resolved", "cancelled"].includes(pendingAction.status)) {
          const interrupted = Object.values(draft.receipts).find(receipt =>
            receipt?.pendingActionId === id &&
            ["processing", "failed"].includes(receipt.status)
          ) ?? null;
          if (interrupted) {
            pendingAction.previousStatus = pendingAction.status;
            pendingAction.status = "recovery-required";
            pendingAction.recoveryReason = `terminal-command-interrupted:${interrupted.command}`;
            pendingAction.updatedAt = Date.now();
            requiredIds.add(id);
          }
          continue;
        }
        if (pendingAction.status !== "resolving") continue;

        const transactionId = pendingAction.resolutionTransactionId ?? null;
        const receipt = transactionId ? draft.receipts[transactionId] : null;
        const receiptAction = receipt?.result?.pendingAction ?? null;

        if (receipt?.status === "completed" && receiptAction?.status === "resolved") {
          draft.pendingActions[id] = clone(receiptAction);
          recoveredIds.add(id);
          continue;
        }

        pendingAction.status = "recovery-required";
        pendingAction.recoveryReason = receipt?.status === "processing"
          ? "resolution-receipt-processing"
          : "resolution-state-ambiguous";
        pendingAction.updatedAt = Date.now();
        requiredIds.add(id);
      }

      draft.authority.lastAuthorityUserId = authorityUserId;
      draft.authority.lastAuthorityAt = Date.now();
      draft.recovery.lastRunAt = Date.now();
      draft.recovery.lastResult = requiredIds.size > 0
        ? "recovery-required"
        : "recovered";
      draft.recovery.requiredPendingActionIds = Array.from(requiredIds);
    });
    runtime = mutation.runtime;

    await this.hydrateCache?.(runtime, combat);
    for (const pendingAction of Object.values(runtime.pendingActions)) {
      this.logger?.debug?.("RECOVERY", "opposition metadata restored", {
        combatId: combat.id,
        pendingActionId: pendingAction?.id ?? null,
        actionDomain: pendingAction?.actionDomain ?? null,
        allowedResponses: pendingAction?.allowedResponses ?? [],
        selectedCapability: pendingAction?.responseDeclaration?.selectedCapability ?? null,
        responseDomain: pendingAction?.responseDeclaration?.responseDomain ?? null,
        transactionId: pendingAction?.responseDeclaration?.transactionId ?? null
      });
      try {
        await this.recoverPresentation?.(pendingAction, combat);
      } catch (error) {
        this.logger?.warn?.("RECOVERY", "presentation recovery failed", {
          combatId: combat.id,
          pendingActionId: pendingAction?.id ?? null,
          error: error.message
        });
      }
    }

    const alreadyNotified = new Set(runtime.recovery.notifiedPendingActionIds ?? []);
    const toNotify = Array.from(requiredIds).filter(id => !alreadyNotified.has(id));
    if (toNotify.length > 0) {
      notify?.(
        `MTROL | ${toNotify.length} oposicion(es) requieren revision manual del GM para evitar efectos duplicados.`
      );
      const notified = await this.repository.mutate(combat, draft => {
        const ids = new Set(draft.recovery.notifiedPendingActionIds ?? []);
        toNotify.forEach(id => ids.add(id));
        draft.recovery.notifiedPendingActionIds = Array.from(ids);
      });
      runtime = notified.runtime;
      await this.hydrateCache?.(runtime, combat);
    }

    this.logger?.info?.("RECOVERY", "combat runtime recovered", {
      combatId: combat.id,
      authorityUserId,
      waiting: waitingIds.size,
      recovered: recoveredIds.size,
      recoveryRequired: requiredIds.size
    });

    return {
      recovered: true,
      authoritative: true,
      runtime,
      waitingIds: Array.from(waitingIds),
      recoveredIds: Array.from(recoveredIds),
      requiredIds: Array.from(requiredIds)
    };
  }
}
