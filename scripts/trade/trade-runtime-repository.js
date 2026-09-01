export const TRADE_RUNTIME_SCHEMA_VERSION = 1;
export const TRADE_RUNTIME_SETTING = "tradeRuntime";

function clone(value) {
  if (globalThis.foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
  return value === undefined ? undefined : structuredClone(value);
}

export function createDefaultTradeRuntime() {
  return {
    schemaVersion: TRADE_RUNTIME_SCHEMA_VERSION,
    revision: 0,
    sessions: {},
    operationReceipts: {},
    receipts: {},
    authority: {
      gmUserId: null,
      epoch: null,
      updatedAt: null
    },
    recovery: {
      lastRunAt: null,
      lastResult: null,
      requiredTradeIds: [],
      notifiedTradeIds: []
    }
  };
}

export function normalizeTradeRuntime(value) {
  const source = value && typeof value === "object" ? clone(value) : {};
  if (source.schemaVersion !== undefined && Number(source.schemaVersion) !== TRADE_RUNTIME_SCHEMA_VERSION) {
    throw new Error(`Schema runtime Trade no soportado: ${source.schemaVersion}`);
  }
  const base = createDefaultTradeRuntime();
  return {
    ...base,
    ...source,
    schemaVersion: TRADE_RUNTIME_SCHEMA_VERSION,
    revision: Math.max(0, Math.trunc(Number(source.revision ?? 0))),
    sessions: source.sessions && typeof source.sessions === "object" ? source.sessions : {},
    operationReceipts: source.operationReceipts && typeof source.operationReceipts === "object"
      ? source.operationReceipts
      : {},
    receipts: source.receipts && typeof source.receipts === "object" ? source.receipts : {},
    authority: { ...base.authority, ...(source.authority ?? {}) },
    recovery: { ...base.recovery, ...(source.recovery ?? {}) }
  };
}

export function registerTradeRuntimeSetting() {
  if (!globalThis.game?.settings?.register) return false;
  game.settings.register("mtrol", TRADE_RUNTIME_SETTING, {
    name: "MTROL Trade Runtime",
    scope: "world",
    config: false,
    type: Object,
    default: createDefaultTradeRuntime()
  });
  return true;
}

export class TradeRuntimeRepository {
  constructor({ logger = null, maxRetries = 2 } = {}) {
    this.logger = logger;
    this.maxRetries = Math.max(0, Math.trunc(Number(maxRetries) || 0));
    this.fallback = createDefaultTradeRuntime();
    this.queue = Promise.resolve();
    this.target = Object.freeze({ id: "trade-runtime", uuid: "World.mtrol.tradeRuntime" });
  }

  read() {
    if (typeof globalThis.game?.settings?.get !== "function") {
      return normalizeTradeRuntime(this.fallback);
    }
    try {
      const stored = game.settings.get("mtrol", TRADE_RUNTIME_SETTING);
      return normalizeTradeRuntime(stored ?? this.fallback);
    } catch (error) {
      this.logger?.error?.("TRADE", "trade runtime read failed", {
        command: "trade.runtime.read",
        status: "failed",
        reasonCode: "TRADE_RUNTIME_READ_FAILED",
        error
      });
      throw error;
    }
  }

  async ensure() {
    return this.read();
  }

  async write(_target, nextRuntime, { expectedRevision } = {}) {
    const current = this.read();
    const expected = expectedRevision ?? Number(nextRuntime?.revision ?? current.revision);
    if (current.revision !== expected) {
      const error = new Error(
        `Conflicto de revision Trade: esperada ${expected}, actual ${current.revision}.`
      );
      error.name = "TradeRuntimeRevisionConflictError";
      error.expectedRevision = expected;
      error.actualRevision = current.revision;
      throw error;
    }
    const next = normalizeTradeRuntime(nextRuntime);
    next.revision = current.revision + 1;
    if (globalThis.game?.settings?.set) {
      await game.settings.set("mtrol", TRADE_RUNTIME_SETTING, clone(next));
    }
    this.fallback = clone(next);
    return normalizeTradeRuntime(next);
  }

  async mutate(_target, mutator, { maxRetries = this.maxRetries } = {}) {
    // The original caller receives the rejection; this catch only releases the
    // serialization queue so a later, independent operation is not poisoned.
    const operation = this.queue.catch(() => undefined).then(async () => {
      let lastConflict = null;
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const current = await this.ensure();
        const draft = clone(current);
        const value = await mutator(draft, { revision: current.revision, attempt });
        try {
          const runtime = await this.write(this.target, draft, { expectedRevision: current.revision });
          return { runtime, value, attempts: attempt + 1 };
        } catch (error) {
          if (error.name !== "TradeRuntimeRevisionConflictError") throw error;
          lastConflict = error;
          this.logger?.warn?.("TRADE", "trade runtime revision conflict", {
            expectedRevision: error.expectedRevision,
            actualRevision: error.actualRevision,
            attempt: attempt + 1
          });
        }
      }
      throw lastConflict;
    });
    this.queue = operation;
    return operation;
  }

  resetForTests() {
    this.fallback = createDefaultTradeRuntime();
    this.queue = Promise.resolve();
  }
}

export const tradeRuntimeRepository = new TradeRuntimeRepository({ logger });
export const tradeReceiptScope = createReceiptScope(
  tradeRuntimeRepository,
  tradeRuntimeRepository.target,
  "trade-runtime"
);
import { createReceiptScope } from "../runtime/receipt-store.js";
import { logger } from "../utils/logger.js";
