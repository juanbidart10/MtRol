import {
  GROUND_SCHEMA_VERSION,
  assertGroundLifecycleTransition,
  cloneGroundValue,
  detectGroundPairState,
  validateGroundAuthorityRecord,
  validateGroundPublicProjection
} from "./ground-schema.js";

export const GROUND_PUBLIC_FLAG = "groundPublicProjections";
export const GROUND_AUTHORITY_FLAG = "groundAuthorityRecords";

const ENVELOPE_FIELDS = Object.freeze(["schemaVersion", "revision", "sceneId", "records"]);

export class GroundPersistenceError extends Error {
  constructor(message, { code = "GROUND_PERSISTENCE_ERROR", cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "GroundPersistenceError";
    this.code = code;
  }
}

export class GroundDuplicateError extends GroundPersistenceError {
  constructor(groundId) {
    super(`Ground ${groundId} ya existe.`, { code: "GROUND_DUPLICATE" });
    this.name = "GroundDuplicateError";
    this.groundId = groundId;
  }
}

export class GroundRevisionConflictError extends GroundPersistenceError {
  constructor({ sceneId, expectedRevision, actualRevision }) {
    super(`Conflicto de revisión Ground en Scene ${sceneId}: esperada ${expectedRevision}, actual ${actualRevision}.`, {
      code: "GROUND_REVISION_CONFLICT"
    });
    this.name = "GroundRevisionConflictError";
    this.sceneId = sceneId;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

function validateSceneId(sceneId) {
  if (typeof sceneId !== "string" || !/^[A-Za-z0-9_-]+$/.test(sceneId)) {
    throw new GroundPersistenceError("sceneId Ground inválido.", { code: "GROUND_SCENE_INVALID" });
  }
  return sceneId;
}

function createEnvelope(sceneId) {
  return { schemaVersion: GROUND_SCHEMA_VERSION, revision: 0, sceneId, records: {} };
}

function validateEnvelope(value, { sceneId, recordKind }) {
  const source = cloneGroundValue(value ?? createEnvelope(sceneId));
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new GroundPersistenceError("Envelope Ground corrupto.", { code: "GROUND_CORRUPT" });
  }
  for (const key of Object.keys(source)) {
    if (!ENVELOPE_FIELDS.includes(key)) {
      throw new GroundPersistenceError(`Campo desconocido en envelope Ground: ${key}.`, { code: "GROUND_CORRUPT" });
    }
  }
  for (const key of ENVELOPE_FIELDS) {
    if (!Object.hasOwn(source, key)) {
      throw new GroundPersistenceError(`Falta ${key} en envelope Ground.`, { code: "GROUND_CORRUPT" });
    }
  }
  if (source.schemaVersion !== GROUND_SCHEMA_VERSION) {
    throw new GroundPersistenceError(`Schema de persistence Ground no soportado: ${source.schemaVersion}.`, {
      code: "GROUND_SCHEMA_UNSUPPORTED"
    });
  }
  if (!Number.isSafeInteger(source.revision) || source.revision < 0) {
    throw new GroundPersistenceError("Revision Ground corrupta.", { code: "GROUND_CORRUPT" });
  }
  if (source.sceneId !== sceneId) {
    throw new GroundPersistenceError(`Scene mismatch en persistence Ground: ${source.sceneId} != ${sceneId}.`, {
      code: "GROUND_SCENE_MISMATCH"
    });
  }
  if (!source.records || typeof source.records !== "object" || Array.isArray(source.records)) {
    throw new GroundPersistenceError("Records Ground corruptos.", { code: "GROUND_CORRUPT" });
  }
  const validateRecord = recordKind === "public"
    ? validateGroundPublicProjection
    : validateGroundAuthorityRecord;
  const records = {};
  for (const [groundId, record] of Object.entries(source.records)) {
    const normalized = validateRecord(record);
    if (normalized.groundId !== groundId) {
      throw new GroundPersistenceError(`GroundId mismatch en persistence: ${groundId}.`, {
        code: "GROUND_ID_MISMATCH"
      });
    }
    if (normalized.sceneId !== sceneId) {
      throw new GroundPersistenceError(`Scene mismatch para Ground ${groundId}.`, {
        code: "GROUND_SCENE_MISMATCH"
      });
    }
    records[groundId] = normalized;
  }
  return { ...source, records };
}

/**
 * Level 1 adapter. Both flags are distributed to Players by Foundry; this is an
 * authority persistence boundary, never a confidentiality boundary.
 */
export class GroundSceneFlagStorage {
  constructor({ flagKey, recordKind, resolveScene = null } = {}) {
    if (!flagKey) throw new GroundPersistenceError("GroundSceneFlagStorage requiere flagKey.");
    if (!["public", "authority"].includes(recordKind)) {
      throw new GroundPersistenceError("GroundSceneFlagStorage requiere recordKind válido.");
    }
    this.flagKey = flagKey;
    this.recordKind = recordKind;
    this.resolveScene = resolveScene ?? (sceneId => globalThis.game?.scenes?.get?.(sceneId) ?? null);
    this.playerDistributable = true;
  }

  resolve(sceneId) {
    validateSceneId(sceneId);
    const scene = this.resolveScene(sceneId);
    if (!scene) {
      throw new GroundPersistenceError(`Scene Ground no encontrada: ${sceneId}.`, {
        code: "GROUND_SCENE_NOT_FOUND"
      });
    }
    return scene;
  }

  read(sceneId) {
    const scene = this.resolve(sceneId);
    const stored = scene.getFlag?.("mtrol", this.flagKey) ?? scene.flags?.mtrol?.[this.flagKey] ?? null;
    return validateEnvelope(stored, { sceneId, recordKind: this.recordKind });
  }

  async write(sceneId, envelope, { expectedRevision } = {}) {
    const scene = this.resolve(sceneId);
    const current = this.read(sceneId);
    if (current.revision !== expectedRevision) {
      throw new GroundRevisionConflictError({
        sceneId,
        expectedRevision,
        actualRevision: current.revision
      });
    }
    const next = validateEnvelope({
      ...cloneGroundValue(envelope),
      schemaVersion: GROUND_SCHEMA_VERSION,
      revision: current.revision + 1,
      sceneId
    }, { sceneId, recordKind: this.recordKind });
    if (typeof scene.setFlag !== "function") {
      throw new GroundPersistenceError("Scene no permite persistir flags Ground.", {
        code: "GROUND_SCENE_NOT_WRITABLE"
      });
    }
    await scene.setFlag("mtrol", this.flagKey, cloneGroundValue(next));
    return validateEnvelope(next, { sceneId, recordKind: this.recordKind });
  }
}

function assertStorage(storage, expectedKind) {
  if (!storage || typeof storage.read !== "function" || typeof storage.write !== "function") {
    throw new GroundPersistenceError(`Storage Ground ${expectedKind} inválido.`);
  }
}

function readEnvelope(storage, sceneId, recordKind) {
  return validateEnvelope(storage.read(sceneId), { sceneId, recordKind });
}

function readPublicGroundForScene(storage, sceneId) {
  const envelope = readEnvelope(storage, sceneId, "public");
  return Object.values(envelope.records).map(cloneGroundValue);
}

export class GroundPublicProjectionReader {
  #publicStorage;

  constructor({ publicStorage } = {}) {
    assertStorage(publicStorage, "public");
    this.#publicStorage = publicStorage;
  }

  getPublicGroundForScene(sceneId) {
    return readPublicGroundForScene(this.#publicStorage, sceneId);
  }
}

function assertPair(publicProjection, authorityRecord) {
  const status = detectGroundPairState(publicProjection, authorityRecord);
  if (status.status !== "MATCHED") {
    throw new GroundPersistenceError(`PublicProjection y AuthorityRecord no coinciden: ${status.issues.join(", ")}.`, {
      code: "GROUND_PAIR_MISMATCH"
    });
  }
}

/**
 * Ground domain persistence depends only on this two-store contract. Replacing
 * authorityStorage with a future Level 2 adapter must not change Ground records,
 * public projection, identity, or callers.
 */
export class GroundPersistencePrimitive {
  constructor({ publicStorage, authorityStorage } = {}) {
    assertStorage(publicStorage, "public");
    assertStorage(authorityStorage, "authority");
    this.publicStorage = publicStorage;
    this.authorityStorage = authorityStorage;
    this.queues = new Map();
  }

  read(sceneId, groundId) {
    const publicEnvelope = readEnvelope(this.publicStorage, sceneId, "public");
    const authorityEnvelope = readEnvelope(this.authorityStorage, sceneId, "authority");
    const publicProjection = cloneGroundValue(publicEnvelope.records[groundId] ?? null);
    const authorityRecord = cloneGroundValue(authorityEnvelope.records[groundId] ?? null);
    return {
      publicProjection,
      authorityRecord,
      ...detectGroundPairState(publicProjection, authorityRecord)
    };
  }

  readWithRevisions(sceneId, groundId) {
    const publicEnvelope = readEnvelope(this.publicStorage, sceneId, "public");
    const authorityEnvelope = readEnvelope(this.authorityStorage, sceneId, "authority");
    const publicProjection = cloneGroundValue(publicEnvelope.records[groundId] ?? null);
    const authorityRecord = cloneGroundValue(authorityEnvelope.records[groundId] ?? null);
    return {
      publicProjection,
      authorityRecord,
      ...detectGroundPairState(publicProjection, authorityRecord),
      revisions: {
        public: publicEnvelope.revision,
        authority: authorityEnvelope.revision
      }
    };
  }

  getGroundForScene(sceneId) {
    const publicEnvelope = readEnvelope(this.publicStorage, sceneId, "public");
    const authorityEnvelope = readEnvelope(this.authorityStorage, sceneId, "authority");
    const ids = new Set([...Object.keys(publicEnvelope.records), ...Object.keys(authorityEnvelope.records)]);
    return Array.from(ids, groundId => this.read(sceneId, groundId));
  }

  getPublicGroundForScene(sceneId) {
    return readPublicGroundForScene(this.publicStorage, sceneId);
  }

  async create({ publicProjection, authorityRecord } = {}, { assertAuthority = null } = {}) {
    const publicValue = validateGroundPublicProjection(publicProjection);
    const authorityValue = validateGroundAuthorityRecord(authorityRecord);
    assertPair(publicValue, authorityValue);
    return this.#queue(publicValue.sceneId, async () => {
      const publicEnvelope = readEnvelope(this.publicStorage, publicValue.sceneId, "public");
      const authorityEnvelope = readEnvelope(this.authorityStorage, publicValue.sceneId, "authority");
      if (publicEnvelope.records[publicValue.groundId] || authorityEnvelope.records[publicValue.groundId]) {
        throw new GroundDuplicateError(publicValue.groundId);
      }
      authorityEnvelope.records[authorityValue.groundId] = cloneGroundValue(authorityValue);
      if (assertAuthority) await assertAuthority();
      await this.authorityStorage.write(publicValue.sceneId, authorityEnvelope, {
        expectedRevision: authorityEnvelope.revision
      });
      publicEnvelope.records[publicValue.groundId] = cloneGroundValue(publicValue);
      if (assertAuthority) await assertAuthority();
      await this.publicStorage.write(publicValue.sceneId, publicEnvelope, {
        expectedRevision: publicEnvelope.revision
      });
      return this.read(publicValue.sceneId, publicValue.groundId);
    });
  }

  async updatePublic(sceneId, groundId, patch = {}, { assertAuthority = null } = {}) {
    return this.#queue(sceneId, async () => {
      const envelope = readEnvelope(this.publicStorage, sceneId, "public");
      const current = envelope.records[groundId];
      if (!current) throw new GroundPersistenceError(`Public Ground no existe: ${groundId}.`, {
        code: "GROUND_PUBLIC_NOT_FOUND"
      });
      if (Object.hasOwn(patch, "groundId") && patch.groundId !== groundId) {
        throw new GroundPersistenceError("groundId público es inmutable.", { code: "GROUND_ID_IMMUTABLE" });
      }
      if (Object.hasOwn(patch, "sceneId") && patch.sceneId !== sceneId) {
        throw new GroundPersistenceError("sceneId público es inmutable.", { code: "GROUND_SCENE_IMMUTABLE" });
      }
      const next = validateGroundPublicProjection({ ...cloneGroundValue(current), ...cloneGroundValue(patch) });
      envelope.records[groundId] = next;
      if (assertAuthority) await assertAuthority();
      await this.publicStorage.write(sceneId, envelope, { expectedRevision: envelope.revision });
      return cloneGroundValue(next);
    });
  }

  async updateAuthority(sceneId, groundId, patch = {}, { assertAuthority = null } = {}) {
    return this.#queue(sceneId, async () => {
      const envelope = readEnvelope(this.authorityStorage, sceneId, "authority");
      const current = envelope.records[groundId];
      if (!current) throw new GroundPersistenceError(`Authority Ground no existe: ${groundId}.`, {
        code: "GROUND_AUTHORITY_NOT_FOUND"
      });
      for (const immutable of ["groundId", "sceneId", "itemSnapshot", "quantity", "provenance", "schemaVersion"]) {
        if (!Object.hasOwn(patch, immutable)) continue;
        throw new GroundPersistenceError(`${immutable} del AuthorityRecord es inmutable.`, {
          code: "GROUND_AUTHORITY_IMMUTABLE"
        });
      }
      const next = validateGroundAuthorityRecord({ ...cloneGroundValue(current), ...cloneGroundValue(patch) });
      assertGroundLifecycleTransition(current.lifecycle, next.lifecycle);
      envelope.records[groundId] = next;
      if (assertAuthority) await assertAuthority();
      await this.authorityStorage.write(sceneId, envelope, { expectedRevision: envelope.revision });
      return cloneGroundValue(next);
    });
  }

  async replacePublicProjection(sceneId, groundId, publicProjection, {
    expectedPublicRevision,
    expectedAuthorityRevision,
    assertAuthority = null
  } = {}) {
    const replacement = validateGroundPublicProjection(publicProjection);
    if (replacement.groundId !== groundId || replacement.sceneId !== sceneId) {
      throw new GroundPersistenceError("La proyección de recovery no coincide con Ground/Scene.", {
        code: "GROUND_PAIR_MISMATCH"
      });
    }
    return this.#queue(sceneId, async () => {
      const publicEnvelope = readEnvelope(this.publicStorage, sceneId, "public");
      const authorityEnvelope = readEnvelope(this.authorityStorage, sceneId, "authority");
      if (publicEnvelope.revision !== expectedPublicRevision) {
        throw new GroundRevisionConflictError({
          sceneId,
          expectedRevision: expectedPublicRevision,
          actualRevision: publicEnvelope.revision
        });
      }
      if (authorityEnvelope.revision !== expectedAuthorityRevision) {
        throw new GroundRevisionConflictError({
          sceneId,
          expectedRevision: expectedAuthorityRevision,
          actualRevision: authorityEnvelope.revision
        });
      }
      const authorityRecord = authorityEnvelope.records[groundId] ?? null;
      if (!authorityRecord) {
        throw new GroundPersistenceError(`Authority Ground no existe: ${groundId}.`, {
          code: "GROUND_AUTHORITY_NOT_FOUND"
        });
      }
      assertPair(replacement, authorityRecord);
      publicEnvelope.records[groundId] = cloneGroundValue(replacement);
      if (assertAuthority) await assertAuthority();
      await this.publicStorage.write(sceneId, publicEnvelope, {
        expectedRevision: publicEnvelope.revision
      });
      return cloneGroundValue(replacement);
    });
  }

  async #queue(sceneId, operation) {
    validateSceneId(sceneId);
    const previous = this.queues.get(sceneId) ?? Promise.resolve();
    const running = previous.catch(() => undefined).then(operation);
    this.queues.set(sceneId, running);
    try {
      return await running;
    } finally {
      if (this.queues.get(sceneId) === running) this.queues.delete(sceneId);
    }
  }
}

export function createLevel1GroundPersistence({ resolveScene = null } = {}) {
  return new GroundPersistencePrimitive({
    publicStorage: new GroundSceneFlagStorage({
      flagKey: GROUND_PUBLIC_FLAG,
      recordKind: "public",
      resolveScene
    }),
    authorityStorage: new GroundSceneFlagStorage({
      flagKey: GROUND_AUTHORITY_FLAG,
      recordKind: "authority",
      resolveScene
    })
  });
}

export function createLevel1GroundPublicReader({ resolveScene = null } = {}) {
  return new GroundPublicProjectionReader({
    publicStorage: new GroundSceneFlagStorage({
      flagKey: GROUND_PUBLIC_FLAG,
      recordKind: "public",
      resolveScene
    })
  });
}
