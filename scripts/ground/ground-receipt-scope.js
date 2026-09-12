import { createReceiptScope } from "../runtime/receipt-store.js";

export const GROUND_RECEIPT_SCHEMA_VERSION = 1;
export const GROUND_RECEIPT_FLAG = "groundCommandReceipts";

function clone(value) {
  if (globalThis.foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
  return value === undefined ? undefined : structuredClone(value);
}

function sceneIdFromTarget(target) {
  const sceneId = typeof target === "string" ? target : target?.id;
  if (typeof sceneId !== "string" || !/^[A-Za-z0-9_-]+$/.test(sceneId)) {
    throw new TypeError("El scope de receipts Ground requiere sceneId válido.");
  }
  return sceneId;
}

function defaultRuntime(sceneId) {
  return {
    schemaVersion: GROUND_RECEIPT_SCHEMA_VERSION,
    revision: 0,
    sceneId,
    receipts: {}
  };
}

function normalizeRuntime(value, sceneId) {
  const source = value == null ? defaultRuntime(sceneId) : clone(value);
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new TypeError("Runtime de receipts Ground corrupto.");
  }
  if (source.schemaVersion !== GROUND_RECEIPT_SCHEMA_VERSION) {
    throw new TypeError(`Schema de receipts Ground no soportado: ${source.schemaVersion}.`);
  }
  if (source.sceneId !== sceneId) throw new TypeError("Scene mismatch en receipts Ground.");
  if (!Number.isSafeInteger(source.revision) || source.revision < 0) {
    throw new TypeError("Revision de receipts Ground corrupta.");
  }
  if (!source.receipts || typeof source.receipts !== "object" || Array.isArray(source.receipts)) {
    throw new TypeError("Colección de receipts Ground corrupta.");
  }
  return {
    schemaVersion: GROUND_RECEIPT_SCHEMA_VERSION,
    revision: source.revision,
    sceneId,
    receipts: clone(source.receipts)
  };
}

export class GroundSceneReceiptRepository {
  constructor({ resolveScene = null } = {}) {
    this.resolveScene = resolveScene ?? (sceneId => globalThis.game?.scenes?.get?.(sceneId) ?? null);
    this.queues = new Map();
  }

  resolve(target) {
    const sceneId = sceneIdFromTarget(target);
    const scene = this.resolveScene(sceneId);
    if (!scene) throw new Error(`Scene Ground no encontrada: ${sceneId}.`);
    return { sceneId, scene };
  }

  read(target) {
    const { sceneId, scene } = this.resolve(target);
    const stored = scene.getFlag?.("mtrol", GROUND_RECEIPT_FLAG) ??
      scene.flags?.mtrol?.[GROUND_RECEIPT_FLAG] ?? null;
    return normalizeRuntime(stored, sceneId);
  }

  async mutate(target, mutator) {
    if (typeof mutator !== "function") throw new TypeError("La mutación de receipts Ground requiere mutator.");
    const { sceneId, scene } = this.resolve(target);
    const previous = this.queues.get(sceneId) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      const current = this.read(sceneId);
      const draft = clone(current);
      const value = await mutator(draft, { revision: current.revision });
      const next = normalizeRuntime({ ...draft, revision: current.revision + 1 }, sceneId);
      if (typeof scene.setFlag !== "function") throw new Error("Scene no permite persistir receipts Ground.");
      await scene.setFlag("mtrol", GROUND_RECEIPT_FLAG, clone(next));
      return { runtime: clone(next), value };
    });
    this.queues.set(sceneId, operation);
    try {
      return await operation;
    } finally {
      if (this.queues.get(sceneId) === operation) this.queues.delete(sceneId);
    }
  }
}

export const groundSceneReceiptRepository = new GroundSceneReceiptRepository();

export function createGroundReceiptScope(sceneId, {
  repository = groundSceneReceiptRepository
} = {}) {
  const normalizedSceneId = sceneIdFromTarget(sceneId);
  return createReceiptScope(repository, normalizedSceneId, `ground-scene:${normalizedSceneId}`);
}
