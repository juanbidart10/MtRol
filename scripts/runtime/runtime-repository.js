export const MTROL_RUNTIME_SCHEMA_VERSION = 1;
export const MTROL_RUNTIME_FLAG_PATH = "flags.mtrol.runtime";

function deepClone(value) {
  if (globalThis.foundry?.utils?.deepClone) {
    return foundry.utils.deepClone(value);
  }
  return value === undefined ? undefined : structuredClone(value);
}

function now() {
  return Date.now();
}

export function createDefaultRuntime() {
  return {
    schemaVersion: MTROL_RUNTIME_SCHEMA_VERSION,
    revision: 0,
    pendingActions: {},
    receipts: {},
    recovery: {
      lastRunAt: null,
      lastResult: null,
      requiredPendingActionIds: [],
      notifiedPendingActionIds: [],
      requiredTransactionIds: [],
      notifiedTransactionIds: [],
      lastMovementRunAt: null
    },
    authority: {
      lastAuthorityUserId: null,
      lastAuthorityAt: null
    }
  };
}

export function normalizeRuntime(value) {
  const source = value && typeof value === "object" ? deepClone(value) : {};
  if (
    source.schemaVersion !== undefined &&
    Number(source.schemaVersion) !== MTROL_RUNTIME_SCHEMA_VERSION
  ) {
    throw new Error(
      `Schema runtime MTROL no soportado: ${source.schemaVersion}`
    );
  }

  const base = createDefaultRuntime();
  return {
    ...base,
    ...source,
    schemaVersion: MTROL_RUNTIME_SCHEMA_VERSION,
    revision: Math.max(0, Math.trunc(Number(source.revision ?? 0))),
    pendingActions: source.pendingActions && typeof source.pendingActions === "object"
      ? source.pendingActions
      : {},
    receipts: source.receipts && typeof source.receipts === "object"
      ? source.receipts
      : {},
    recovery: {
      ...base.recovery,
      ...(source.recovery ?? {})
    },
    authority: {
      ...base.authority,
      ...(source.authority ?? {})
    }
  };
}

function getRuntimeFromCombat(combat) {
  return combat?.flags?.mtrol?.runtime ??
    combat?.getFlag?.("mtrol", "runtime") ??
    null;
}

export class RuntimeRevisionConflictError extends Error {
  constructor({ combatId = null, expectedRevision, actualRevision } = {}) {
    super(
      `Conflicto de revision runtime en Combat ${combatId ?? "desconocido"}: ` +
      `esperada ${expectedRevision}, actual ${actualRevision}.`
    );
    this.name = "RuntimeRevisionConflictError";
    this.combatId = combatId;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class RuntimeRepository {
  constructor({ maxRetries = 2, logger = null } = {}) {
    this.maxRetries = Math.max(0, Math.trunc(Number(maxRetries) || 0));
    this.logger = logger;
    this.mutationQueues = new Map();
  }

  resolveCombat(combatOrId = null) {
    if (combatOrId && typeof combatOrId === "object") return combatOrId;
    if (combatOrId) return game.combats?.get?.(combatOrId) ?? null;
    return game.combat ?? null;
  }

  read(combatOrId = null) {
    const combat = this.resolveCombat(combatOrId);
    if (!combat) return null;
    const stored = getRuntimeFromCombat(combat);
    return stored ? normalizeRuntime(stored) : null;
  }

  async ensure(combatOrId = null) {
    const combat = this.resolveCombat(combatOrId);
    if (!combat) return null;
    const existing = this.read(combat);
    if (existing) return existing;
    const runtime = createDefaultRuntime();
    await combat.update({ [MTROL_RUNTIME_FLAG_PATH]: runtime });
    return normalizeRuntime(getRuntimeFromCombat(combat) ?? runtime);
  }

  async write(combatOrId, nextRuntime, { expectedRevision } = {}) {
    const combat = this.resolveCombat(combatOrId);
    if (!combat) throw new Error("No existe un Combat para persistir runtime MTROL.");
    const current = this.read(combat) ?? createDefaultRuntime();
    const expected = expectedRevision ?? Number(nextRuntime?.revision ?? current.revision);
    if (current.revision !== expected) {
      throw new RuntimeRevisionConflictError({
        combatId: combat.id,
        expectedRevision: expected,
        actualRevision: current.revision
      });
    }

    const next = normalizeRuntime(nextRuntime);
    next.revision = current.revision + 1;
    await combat.update({ [MTROL_RUNTIME_FLAG_PATH]: next });
    return normalizeRuntime(getRuntimeFromCombat(combat) ?? next);
  }

  async mutate(combatOrId, mutator, options = {}) {
    const combat = this.resolveCombat(combatOrId);
    if (!combat) throw new Error("No existe un Combat activo para mutar runtime MTROL.");

    const key = combat.id ?? combat;
    const previous = this.mutationQueues.get(key) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(() => this.mutateWithRetry(combat, mutator, options));
    this.mutationQueues.set(key, operation);
    try {
      return await operation;
    } finally {
      if (this.mutationQueues.get(key) === operation) {
        this.mutationQueues.delete(key);
      }
    }
  }

  async mutateWithRetry(combat, mutator, { maxRetries = this.maxRetries } = {}) {

    let lastConflict = null;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const current = await this.ensure(combat);
      const draft = deepClone(current);
      const value = await mutator(draft, {
        revision: current.revision,
        attempt
      });
      try {
        const runtime = await this.write(combat, draft, {
          expectedRevision: current.revision
        });
        return { runtime, value, attempts: attempt + 1 };
      } catch (error) {
        if (!(error instanceof RuntimeRevisionConflictError)) throw error;
        lastConflict = error;
        this.logger?.warn?.("COMBAT", "runtime revision conflict", {
          combatId: combat.id,
          expectedRevision: error.expectedRevision,
          actualRevision: error.actualRevision,
          attempt: attempt + 1
        });
      }
    }

    this.logger?.error?.("RECOVERY", "runtime mutation aborted after revision conflicts", {
      combatId: combat.id,
      maxRetries
    });
    throw lastConflict;
  }

  async markAuthority(combatOrId, userId) {
    return this.mutate(combatOrId, draft => {
      draft.authority.lastAuthorityUserId = userId ?? null;
      draft.authority.lastAuthorityAt = now();
    });
  }
}
