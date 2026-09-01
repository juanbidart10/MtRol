export const MTROL_ACTOR_RUNTIME_SCHEMA_VERSION = 1;
export const MTROL_ACTOR_RUNTIME_FLAG_PATH = "flags.mtrol.transactionRuntime";
export const NON_COMBAT_RECEIPT_MAX_COUNT = 128;
export const NON_COMBAT_RECEIPT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function clone(value) {
  if (globalThis.foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
  return value === undefined ? undefined : structuredClone(value);
}

function defaultRuntime() {
  return { schemaVersion: MTROL_ACTOR_RUNTIME_SCHEMA_VERSION, revision: 0, receipts: {} };
}

function normalize(value) {
  const source = value && typeof value === "object" ? clone(value) : {};
  return {
    ...defaultRuntime(),
    ...source,
    schemaVersion: MTROL_ACTOR_RUNTIME_SCHEMA_VERSION,
    revision: Math.max(0, Math.trunc(Number(source.revision ?? 0))),
    receipts: source.receipts && typeof source.receipts === "object" ? source.receipts : {}
  };
}

function prune(receipts, now = Date.now()) {
  const cutoff = now - NON_COMBAT_RECEIPT_MAX_AGE_MS;
  // Only unequivocally terminal receipts are eligible. Unknown/legacy statuses
  // and interrupted operations are evidence, not expendable history.
  const entries = Object.entries(receipts ?? {});
  const terminal = receipt => receipt?.status === "completed" ||
    (receipt?.status === "failed" &&
      ["no-effects", "rolled-back"].includes(receipt.failureSafety));
  const protectedEntries = entries.filter(([, receipt]) => !terminal(receipt));
  const retained = entries.filter(([, receipt]) => terminal(receipt))
    .filter(([, receipt]) => Number(receipt?.updatedAt ?? receipt?.createdAt ?? 0) >= cutoff)
    .sort((a, b) => Number(b[1]?.updatedAt ?? 0) - Number(a[1]?.updatedAt ?? 0))
    .slice(0, NON_COMBAT_RECEIPT_MAX_COUNT);
  return Object.fromEntries([...protectedEntries, ...retained]);
}

export class ActorRuntimeRepository {
  constructor({ logger = null } = {}) {
    this.logger = logger;
    this.mutationQueues = new Map();
    this.cache = new Map();
  }

  resolveActor(actorOrId) {
    if (actorOrId && typeof actorOrId === "object") return actorOrId;
    return game.actors?.get?.(actorOrId) ?? null;
  }

  read(actorOrId) {
    const actor = this.resolveActor(actorOrId);
    if (!actor) return null;
    const key = actor.uuid ?? actor.id;
    const isFoundryDocument = actor.documentName === "Actor" ||
      actor.constructor?.metadata?.name === "Actor";
    const stored = actor.flags?.mtrol?.transactionRuntime ??
      (isFoundryDocument ? actor.getFlag?.("mtrol", "transactionRuntime") : null) ??
      this.cache.get(key) ?? null;
    return stored ? normalize(stored) : null;
  }

  async ensure(actorOrId) {
    const actor = this.resolveActor(actorOrId);
    if (!actor) return null;
    return this.read(actor) ?? defaultRuntime();
  }

  async mutate(actorOrId, mutator) {
    const actor = this.resolveActor(actorOrId);
    if (!actor) throw new Error("No existe Actor para persistir receipts MTROL.");
    const key = actor.uuid ?? actor.id;
    const previous = this.mutationQueues.get(key) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      const current = await this.ensure(actor);
      const draft = clone(current);
      const value = await mutator(draft, { revision: current.revision });
      draft.revision = current.revision + 1;
      draft.receipts = prune(draft.receipts);
      const isFoundryDocument = actor.documentName === "Actor" ||
        actor.constructor?.metadata?.name === "Actor";
      if (isFoundryDocument && typeof actor.setFlag === "function") {
        await actor.setFlag("mtrol", "transactionRuntime", draft);
      } else if (isFoundryDocument) {
        await actor.update({ [MTROL_ACTOR_RUNTIME_FLAG_PATH]: draft });
      }
      this.cache.set(key, clone(draft));
      return { runtime: normalize(draft), value, attempts: 1 };
    });
    this.mutationQueues.set(key, operation);
    try {
      return await operation;
    } finally {
      if (this.mutationQueues.get(key) === operation) this.mutationQueues.delete(key);
    }
  }

  async evict(actorOrId) {
    const actor = actorOrId && typeof actorOrId === "object"
      ? actorOrId
      : this.resolveActor(actorOrId);
    const key = actor?.uuid ?? actor?.id ?? (actorOrId ? String(actorOrId) : null);
    if (!key) return false;

    // Lifecycle eviction must never invalidate data while the Actor queue can
    // still read or replace this entry. A later mutation is observed in the
    // loop and awaited as well; no second lock/tracker is introduced.
    while (this.mutationQueues.has(key)) {
      const pending = this.mutationQueues.get(key);
      await pending.catch(() => undefined);
    }
    return this.cache.delete(key);
  }

  resetForTests() {
    this.cache.clear();
    this.mutationQueues.clear();
  }
}

export function pruneActorReceiptsForTests(receipts, now) {
  return prune(receipts, now);
}
