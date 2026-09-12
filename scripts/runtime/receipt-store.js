function clone(value) {
  if (globalThis.foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
  return value === undefined ? undefined : structuredClone(value);
}

function canonicalize(value, seen = new Set(), { arrayEntry = false } = {}) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (["undefined", "function", "symbol"].includes(typeof value)) return arrayEntry ? null : undefined;
  if (typeof value === "bigint") throw new TypeError("El payload del receipt no admite BigInt.");
  if (typeof value !== "object") return value;
  if (seen.has(value)) throw new TypeError("El payload del receipt no puede contener referencias circulares.");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map(entry => canonicalize(entry, seen, { arrayEntry: true }));
    }
    const normalized = {};
    for (const key of Object.keys(value).sort()) {
      const child = canonicalize(value[key], seen);
      if (child !== undefined) normalized[key] = child;
    }
    return normalized;
  } finally {
    seen.delete(value);
  }
}

export function canonicalizeReceiptPayload(payload) {
  return JSON.stringify(canonicalize(payload));
}

export async function createReceiptFingerprint(payload) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle?.digest) throw new Error("SHA-256 no está disponible para identificar el receipt.");
  const bytes = new TextEncoder().encode(canonicalizeReceiptPayload(payload));
  const digest = new Uint8Array(await subtle.digest("SHA-256", bytes));
  return `sha256:${Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

const RECEIPT_KEY_PREFIX = "rk1_";

export function encodeReceiptKey(transactionId) {
  if (typeof transactionId !== "string" || !transactionId) {
    throw new TypeError("El ID lógico del receipt debe ser un string no vacío.");
  }
  const bytes = new TextEncoder().encode(transactionId);
  return RECEIPT_KEY_PREFIX + Array.from(bytes, byte =>
    byte.toString(16).padStart(2, "0")).join("");
}

export function decodeReceiptKey(persistentKey) {
  if (typeof persistentKey !== "string" || !persistentKey.startsWith(RECEIPT_KEY_PREFIX)) {
    throw new TypeError("La clave persistente del receipt no usa el codec soportado.");
  }
  const encoded = persistentKey.slice(RECEIPT_KEY_PREFIX.length);
  if (encoded.length % 2 !== 0 || !/^[0-9a-f]*$/.test(encoded)) {
    throw new TypeError("La clave persistente del receipt está dañada.");
  }
  const bytes = new Uint8Array(encoded.match(/.{2}/g)?.map(value => Number.parseInt(value, 16)) ?? []);
  return new TextDecoder().decode(bytes);
}

export function getReceiptFromRuntime(runtime, transactionId) {
  if (!runtime || !transactionId) return null;
  return runtime.receipts?.[encodeReceiptKey(transactionId)] ?? null;
}

export function setReceiptInRuntime(runtime, transactionId, receipt) {
  if (!runtime || typeof runtime !== "object") {
    throw new TypeError("El runtime del receipt es obligatorio.");
  }
  runtime.receipts ??= {};
  runtime.receipts[encodeReceiptKey(transactionId)] = receipt;
  return receipt;
}

export const COMBAT_RECEIPT_SCHEMA_VERSION = 1;
export const RECEIPT_KIND_FULL = "full";
export const RECEIPT_KIND_COMPACT = "compact";

const REPLAYABLE_TRANSACTION_PREFIXES = Object.freeze([
  "damage.",
  "resource.",
  "movement."
]);

const OPPOSITION_COMMANDS = new Set([
  "opposition.create",
  "opposition.respond",
  "opposition.declare-response",
  "opposition.resolve",
  "opposition.cancel",
  "opposition.reaction-complete"
]);

function isReplayableTransaction(command) {
  return REPLAYABLE_TRANSACTION_PREFIXES.some(prefix =>
    String(command ?? "").startsWith(prefix));
}

function hasClosedPendingAction(receipt, pendingActions = {}) {
  if (!receipt.pendingActionId) return true;
  const pendingAction = pendingActions?.[receipt.pendingActionId];
  if (!pendingAction || !["resolved", "cancelled"].includes(pendingAction.status)) return false;
  if (!pendingAction.terminalHandledAt) return false;
  if (pendingAction.reactionMovement?.status === "available") return false;
  return pendingAction.status !== "recovery-required";
}

function isSafelyTerminal(receipt) {
  return receipt?.status === "completed" ||
    (receipt?.status === "failed" &&
      ["no-effects", "rolled-back"].includes(receipt.failureSafety));
}

export function canCompactReceipt(receipt, {
  pendingActions = {},
  isTransactionInFlight = () => false
} = {}) {
  if (!receipt || typeof receipt !== "object") return false;
  if (receipt.receiptSchemaVersion !== COMBAT_RECEIPT_SCHEMA_VERSION ||
      receipt.kind !== RECEIPT_KIND_FULL) return false;
  if (!receipt.transactionId || !receipt.command || !isSafelyTerminal(receipt)) return false;
  if (isTransactionInFlight(receipt.transactionId)) return false;
  if (!hasClosedPendingAction(receipt, pendingActions)) return false;
  if (isReplayableTransaction(receipt.command)) return true;
  return OPPOSITION_COMMANDS.has(receipt.command) && Boolean(receipt.pendingActionId);
}

function compactIdentity(receipt) {
  const identity = {};
  for (const key of [
    "actorUuid",
    "targetActorUuid",
    "sourceActorUuid",
    "tokenUuid",
    "combatantId"
  ]) {
    if (receipt[key] !== undefined && receipt[key] !== null) identity[key] = receipt[key];
  }
  return identity;
}

export function compactReceipt(receipt) {
  if (receipt?.kind === RECEIPT_KIND_COMPACT) return clone(receipt);
  const resultAvailable = isReplayableTransaction(receipt?.command);
  const result = resultAvailable ? clone(receipt.result ?? null) : null;
  const terminalAt = Number(
    receipt.completedAt ?? receipt.failedAt ?? receipt.updatedAt ?? receipt.createdAt ?? 0
  ) || null;
  return {
    receiptSchemaVersion: COMBAT_RECEIPT_SCHEMA_VERSION,
    kind: RECEIPT_KIND_COMPACT,
    transactionId: receipt.transactionId,
    command: receipt.command,
    ...(receipt.fingerprint ? { fingerprint: receipt.fingerprint } : {}),
    pendingActionId: receipt.pendingActionId ?? null,
    status: receipt.status,
    createdAt: Number(receipt.createdAt ?? 0) || null,
    updatedAt: terminalAt,
    ...(receipt.status === "completed" ? { completedAt: terminalAt } : {}),
    ...(receipt.status === "failed" ? {
      failedAt: terminalAt,
      failureSafety: receipt.failureSafety,
      error: receipt.error ?? null
    } : {}),
    ...compactIdentity(receipt),
    resultAvailable,
    result,
    changed: typeof receipt.result?.changed === "boolean" ? receipt.result.changed : null,
    reasonCode: receipt.result?.reasonCode ?? null
  };
}

export class TransactionResultExpiredError extends Error {
  constructor(transactionId) {
    super(`El resultado de la transacción ${transactionId} expiró; sus efectos no se repetirán.`);
    this.name = "TransactionResultExpiredError";
    this.transactionId = transactionId;
    this.reasonCode = "TRANSACTION_RESULT_EXPIRED";
    this.ok = false;
    this.changed = false;
  }
}

export function replayCompactReceipt(receipt) {
  if (receipt?.kind !== RECEIPT_KIND_COMPACT) return { handled: false, result: null };
  if (receipt.resultAvailable === true) return { handled: true, result: clone(receipt.result) };
  throw new TransactionResultExpiredError(receipt.transactionId);
}

function estimateJsonBytes(value) {
  const serialized = JSON.stringify(value ?? null);
  if (typeof TextEncoder === "function") return new TextEncoder().encode(serialized).length;
  return serialized.length;
}

export function createReceiptScope(repository, target, id = null) {
  if (!repository) throw new Error("El scope de receipt requiere repository.");
  return {
    __mtrolReceiptScope: true,
    repository,
    target,
    id: id ?? target?.uuid ?? target?.id ?? "custom-runtime"
  };
}

export class ReceiptInProgressError extends Error {
  constructor(transactionId) {
    super(`La transaccion ${transactionId} esta en proceso y requiere reconciliacion.`);
    this.name = "ReceiptInProgressError";
    this.transactionId = transactionId;
  }
}

export class ReceiptFailedError extends Error {
  constructor(transactionId, previousError = null) {
    super(previousError ?? `La transaccion ${transactionId} fallo y no se reintentara automaticamente.`);
    this.name = "ReceiptFailedError";
    this.transactionId = transactionId;
    this.previousError = previousError;
  }
}

export class ReceiptIdentityConflictError extends Error {
  constructor(transactionId, {
    expectedCommand = null,
    receivedCommand = null,
    conflict = "identity"
  } = {}) {
    super(`La identidad del receipt ${transactionId} no coincide con la operación persistida.`);
    this.name = "ReceiptIdentityConflictError";
    this.reasonCode = "RECEIPT_IDENTITY_CONFLICT";
    this.transactionId = transactionId;
    this.expectedCommand = expectedCommand;
    this.receivedCommand = receivedCommand;
    this.conflict = conflict;
  }
}

export class ReceiptStore {
  constructor({ repository, logger = null, compactCompletedReceipts = false } = {}) {
    if (!repository) throw new Error("ReceiptStore requiere RuntimeRepository.");
    this.repository = repository;
    this.logger = logger;
    this.compactCompletedReceipts = compactCompletedReceipts === true;
    this.inFlight = new Map();
  }

  assertIdentity(receipt, { transactionId, command, fingerprint } = {}) {
    if (!receipt) return;
    if (receipt.command && command && receipt.command !== command) {
      this.logger?.warn?.("RECEIPT", "receipt command identity conflict", {
        command,
        transactionId,
        reasonCode: "RECEIPT_IDENTITY_CONFLICT"
      });
      throw new ReceiptIdentityConflictError(transactionId, {
        expectedCommand: receipt.command,
        receivedCommand: command,
        conflict: "command"
      });
    }
    if (receipt.fingerprint && receipt.fingerprint !== fingerprint) {
      this.logger?.warn?.("RECEIPT", "receipt payload identity conflict", {
        command,
        transactionId,
        reasonCode: "RECEIPT_IDENTITY_CONFLICT"
      });
      throw new ReceiptIdentityConflictError(transactionId, {
        expectedCommand: receipt.command ?? null,
        receivedCommand: command ?? null,
        conflict: "fingerprint"
      });
    }
    if (!receipt.fingerprint && fingerprint) {
      this.logger?.warnOnce?.("RECEIPT", "legacy receipt replay without payload fingerprint", {
        command,
        transactionId,
        reasonCode: "RECEIPT_LEGACY_IDENTITY"
      });
    }
  }

  resolve(target) {
    if (target?.__mtrolReceiptScope === true) {
      return { repository: target.repository, target: target.target, scopeId: target.id };
    }
    return {
      repository: this.repository,
      target,
      scopeId: target?.uuid ?? target?.id ?? String(target ?? "runtime")
    };
  }

  get(combatOrId, transactionId) {
    if (!transactionId) return null;
    const { repository, target } = this.resolve(combatOrId);
    const runtime = repository.read(target);
    return clone(getReceiptFromRuntime(runtime, transactionId));
  }

  async compactEligible(combatOrId, { isTransactionInFlight = () => false } = {}) {
    if (!this.compactCompletedReceipts) {
      return { changed: false, full: 0, compact: 0, beforeBytes: 0, afterBytes: 0 };
    }
    const resolved = this.resolve(combatOrId);
    const ownInFlight = transactionId =>
      this.inFlight.has(`${resolved.scopeId}:${transactionId}`);
    const protectedByFlight = transactionId =>
      ownInFlight(transactionId) || isTransactionInFlight(transactionId);
    const current = resolved.repository.read(resolved.target);
    const currentReceipts = current?.receipts ?? {};
    if (!Object.values(currentReceipts).some(receipt => canCompactReceipt(receipt, {
      pendingActions: current?.pendingActions ?? {},
      isTransactionInFlight: protectedByFlight
    }))) {
      return {
        changed: false,
        full: Object.values(currentReceipts).filter(receipt => receipt?.kind !== RECEIPT_KIND_COMPACT).length,
        compact: Object.values(currentReceipts).filter(receipt => receipt?.kind === RECEIPT_KIND_COMPACT).length,
        beforeBytes: estimateJsonBytes(currentReceipts),
        afterBytes: estimateJsonBytes(currentReceipts)
      };
    }

    const mutation = await resolved.repository.mutate(resolved.target, draft => {
      const beforeBytes = estimateJsonBytes(draft.receipts);
      let compacted = 0;
      for (const [persistentKey, receipt] of Object.entries(draft.receipts ?? {})) {
        if (!canCompactReceipt(receipt, {
          pendingActions: draft.pendingActions ?? {},
          isTransactionInFlight: protectedByFlight
        })) continue;
        draft.receipts[persistentKey] = compactReceipt(receipt);
        compacted += 1;
      }
      const values = Object.values(draft.receipts ?? {});
      return {
        changed: compacted > 0,
        compacted,
        full: values.filter(receipt => receipt?.kind !== RECEIPT_KIND_COMPACT).length,
        compact: values.filter(receipt => receipt?.kind === RECEIPT_KIND_COMPACT).length,
        beforeBytes,
        afterBytes: estimateJsonBytes(draft.receipts)
      };
    });
    return mutation.value;
  }

  async compactAfterOperation(combatOrId, options = {}) {
    try {
      return await this.compactEligible(combatOrId, options);
    } catch (error) {
      this.logger?.warn?.("RECEIPT", "combat receipt compaction failed", {
        command: "receipt.compact",
        status: "isolated",
        reasonCode: "RECEIPT_COMPACTION_FAILED",
        error
      });
      return { changed: false, error: error.message };
    }
  }

  async begin(combatOrId, transactionId, metadata = {}) {
    if (!transactionId) throw new Error("transactionId es obligatorio.");
    const existing = this.get(combatOrId, transactionId);
    if (existing) return { created: false, receipt: existing };

    const createdAt = Date.now();
    const persistentKey = encodeReceiptKey(transactionId);
    const { repository, target } = this.resolve(combatOrId);
    const mutation = await repository.mutate(target, draft => {
      const concurrent = draft.receipts[persistentKey];
      if (concurrent) return { created: false, receipt: clone(concurrent) };
      const receipt = {
        receiptSchemaVersion: COMBAT_RECEIPT_SCHEMA_VERSION,
        kind: RECEIPT_KIND_FULL,
        transactionId,
        command: metadata.command ?? null,
        ...(metadata.fingerprint ? { fingerprint: metadata.fingerprint } : {}),
        pendingActionId: metadata.pendingActionId ?? null,
        status: "processing",
        createdAt,
        updatedAt: createdAt,
        result: null,
        error: null
      };
      draft.receipts[persistentKey] = receipt;
      return { created: true, receipt: clone(receipt) };
    });
    return mutation.value;
  }

  async complete(combatOrId, transactionId, result) {
    const completedAt = Date.now();
    const persistentKey = encodeReceiptKey(transactionId);
    const { repository, target } = this.resolve(combatOrId);
    const mutation = await repository.mutate(target, draft => {
      const receipt = draft.receipts[persistentKey];
      if (!receipt) throw new Error(`No existe receipt para ${transactionId}.`);
      if (receipt.status === "completed") return clone(receipt);
      receipt.status = "completed";
      receipt.updatedAt = completedAt;
      receipt.completedAt = completedAt;
      receipt.result = clone(result ?? null);
      receipt.error = null;
      return clone(receipt);
    });
    return mutation.value;
  }

  async update(target, transactionId, mutator) {
    if (!transactionId) throw new Error("transactionId es obligatorio.");
    if (typeof mutator !== "function") throw new TypeError("ReceiptStore.update requiere mutator.");
    const resolved = this.resolve(target);
    const persistentKey = encodeReceiptKey(transactionId);
    const mutation = await resolved.repository.mutate(resolved.target, draft => {
      const receipt = draft.receipts[persistentKey];
      if (!receipt) throw new Error(`No existe receipt para ${transactionId}.`);
      const value = mutator(receipt, draft);
      receipt.updatedAt = Date.now();
      return clone(value ?? receipt);
    });
    return mutation.value;
  }

  async transition(target, transactionId, status, patch = {}) {
    return this.update(target, transactionId, receipt => {
      if (receipt.status === "completed") return receipt;
      Object.assign(receipt, clone(patch), { status });
      return receipt;
    });
  }

  async fail(combatOrId, transactionId, error) {
    const failedAt = Date.now();
    const persistentKey = encodeReceiptKey(transactionId);
    const { repository, target } = this.resolve(combatOrId);
    const mutation = await repository.mutate(target, draft => {
      const receipt = draft.receipts[persistentKey];
      if (!receipt || receipt.status === "completed") return clone(receipt ?? null);
      receipt.status = "failed";
      receipt.updatedAt = failedAt;
      receipt.failedAt = failedAt;
      receipt.error = error?.message ?? String(error ?? "Error desconocido");
      return clone(receipt);
    });
    return mutation.value;
  }

  async execute(combatOrId, {
    transactionId,
    command,
    fingerprint = null,
    pendingActionId = null
  } = {}, operation) {
    if (!transactionId) throw new Error("transactionId es obligatorio.");
    const resolved = this.resolve(combatOrId);
    const inFlightKey = `${resolved.scopeId}:${transactionId}`;
    if (this.inFlight.has(inFlightKey)) {
      const pending = this.inFlight.get(inFlightKey);
      this.assertIdentity(pending, { transactionId, command, fingerprint });
      return pending.task;
    }

    const task = (async () => {
      const existing = this.get(combatOrId, transactionId);
      this.assertIdentity(existing, { transactionId, command, fingerprint });
      const compactReplay = replayCompactReceipt(existing);
      if (compactReplay.handled) return compactReplay.result;
      if (existing?.status === "completed") {
        this.logger?.debug?.("COMMAND", "receipt replay", { command, transactionId });
        return clone(existing.result);
      }
      if (existing?.status === "processing") {
        throw new ReceiptInProgressError(transactionId);
      }
      if (existing?.status === "failed") {
        throw new ReceiptFailedError(transactionId, existing.error);
      }

      const begun = await this.begin(combatOrId, transactionId, {
        command,
        fingerprint,
        pendingActionId
      });
      if (!begun.created) {
        this.assertIdentity(begun.receipt, { transactionId, command, fingerprint });
        if (begun.receipt?.status === "completed") return clone(begun.receipt.result);
        if (begun.receipt?.status === "processing") {
          throw new ReceiptInProgressError(transactionId);
        }
        if (begun.receipt?.status === "failed") {
          throw new ReceiptFailedError(transactionId, begun.receipt.error);
        }
      }

      try {
        const result = await operation();
        await this.complete(combatOrId, transactionId, result);
        return result;
      } catch (error) {
        await this.fail(combatOrId, transactionId, error);
        throw error;
      }
    })();

    this.inFlight.set(inFlightKey, { task, command, fingerprint });
    try {
      return await task;
    } finally {
      this.inFlight.delete(inFlightKey);
      await this.compactAfterOperation(combatOrId);
    }
  }
}
