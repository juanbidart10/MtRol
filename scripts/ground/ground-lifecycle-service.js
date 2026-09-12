import {
  GROUND_SCHEMA_VERSION,
  GROUND_LIFECYCLE,
  GROUND_VISIBILITY,
  createGroundAuthorityRecord,
  createGroundId,
  projectGroundPublicState
} from "./ground-schema.js";

export const GROUND_MUTATION_REASON = Object.freeze({
  PUBLIC_WRITE_FAILED: "GROUND_PUBLIC_WRITE_FAILED",
  POST_WRITE_VERIFICATION_FAILED: "GROUND_POST_WRITE_VERIFICATION_FAILED",
  RECOVERY_WRITE_FAILED: "GROUND_RECOVERY_WRITE_FAILED"
});

const CREATE_FIELDS = Object.freeze([
  "worldId", "groundId", "sceneId", "position", "visibility", "pickupEnabled", "appearance",
  "quantity", "itemSnapshot", "provenance"
]);
const PUBLIC_MUTATION_FIELDS = Object.freeze(["position", "visibility", "pickupEnabled", "appearance"]);

function clone(value) {
  if (globalThis.foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
  return value === undefined ? undefined : structuredClone(value);
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} debe ser un objeto.`);
  }
}

function rejectUnknown(value, allowed, label) {
  assertObject(value, label);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new TypeError(`${label}.${key} no está permitido.`);
  }
}

function requireTransactionId(transactionId) {
  if (typeof transactionId !== "string" || !transactionId.trim()) {
    throw new TypeError("La mutación Ground requiere transactionId.");
  }
  return transactionId;
}

function mergeCheckpoints(...groups) {
  return [...new Set(groups.flat().filter(checkpoint => typeof checkpoint === "string" && checkpoint.trim()))];
}

export class GroundLifecycleMutationError extends Error {
  constructor(message, {
    reasonCode,
    sceneId,
    groundId,
    transactionId,
    lastCheckpoint = null,
    pairState = null,
    cause = null,
    recoveryError = null
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "GroundLifecycleMutationError";
    this.reasonCode = reasonCode;
    this.sceneId = sceneId;
    this.groundId = groundId;
    this.transactionId = transactionId;
    this.lastCheckpoint = lastCheckpoint;
    this.pairState = clone(pairState);
    this.recoveryError = recoveryError;
  }
}

export class GroundLifecycleService {
  constructor({ repository, idFactory = createGroundId, assertAuthority = null } = {}) {
    if (!repository || typeof repository.read !== "function" || typeof repository.create !== "function" ||
        typeof repository.updatePublic !== "function" || typeof repository.updateAuthority !== "function") {
      throw new TypeError("GroundLifecycleService requiere GroundPersistencePrimitive compatible.");
    }
    if (typeof idFactory !== "function") throw new TypeError("GroundLifecycleService requiere idFactory válido.");
    if (assertAuthority !== null && typeof assertAuthority !== "function") {
      throw new TypeError("GroundLifecycleService requiere assertAuthority válido.");
    }
    this.repository = repository;
    this.idFactory = idFactory;
    this.assertAuthority = assertAuthority;
  }

  async createPendingGround(input = {}) {
    rejectUnknown(input, CREATE_FIELDS, "createPendingGround");
    const transactionId = requireTransactionId(input.provenance?.operationId);
    const groundId = input.groundId ?? this.idFactory({ worldId: input.worldId });
    const authorityRecord = createGroundAuthorityRecord({
      schemaVersion: GROUND_SCHEMA_VERSION,
      groundId,
      sceneId: input.sceneId,
      lifecycle: GROUND_LIFECYCLE.PENDING,
      position: clone(input.position),
      visibility: input.visibility,
      pickupEnabled: input.pickupEnabled,
      appearance: clone(input.appearance),
      quantity: input.quantity,
      itemSnapshot: clone(input.itemSnapshot),
      provenance: clone(input.provenance),
      recoveryEvidence: {
        transactionId,
        checkpoints: ["authority-record-persisted"],
        reasonCode: null
      }
    });
    const publicProjection = projectGroundPublicState(authorityRecord);
    try {
      const result = await this.repository.create(
        { publicProjection, authorityRecord },
        { assertAuthority: this.assertAuthority }
      );
      return await this.#verify(result, {
        sceneId: input.sceneId,
        groundId,
        transactionId,
        lifecycle: GROUND_LIFECYCLE.PENDING,
        lastCheckpoint: "authority-record-persisted"
      });
    } catch (error) {
      if (error?.reasonCode === "AUTHORITY_CONTEXT_STALE" || error?.reasonCode === "WRITE_CONTEXT_MISSING") {
        throw error;
      }
      if (error?.code === "GROUND_DUPLICATE") throw error;
      const pairState = this.#safeRead(input.sceneId, groundId);
      if (pairState?.authorityRecord && !pairState.publicProjection) {
        return this.#failAfterPublicWrite({
          sceneId: input.sceneId,
          groundId,
          transactionId,
          lastCheckpoint: "authority-record-persisted",
          cause: error
        });
      }
      throw new GroundLifecycleMutationError(`No se pudo crear Ground ${groundId}.`, {
        reasonCode: error?.reasonCode ?? "GROUND_CREATE_FAILED",
        sceneId: input.sceneId,
        groundId,
        transactionId,
        pairState,
        cause: error
      });
    }
  }

  async activateGround(sceneId, groundId, { transactionId } = {}) {
    requireTransactionId(transactionId);
    const current = this.#requireMatched(sceneId, groundId);
    if (current.authorityRecord.lifecycle !== GROUND_LIFECYCLE.PENDING) {
      throw new GroundLifecycleMutationError("Sólo un Ground PENDING puede activarse.", {
        reasonCode: "GROUND_ACTIVATE_STATE_INVALID", sceneId, groundId, transactionId, pairState: current
      });
    }
    const checkpoint = "authority-activated";
    const authority = await this.repository.updateAuthority(sceneId, groundId, {
      lifecycle: GROUND_LIFECYCLE.ACTIVE,
      recoveryEvidence: this.#evidence(current.authorityRecord, transactionId, [checkpoint], null)
    }, { assertAuthority: this.assertAuthority });
    return this.#verify(this.repository.read(sceneId, groundId), {
      sceneId, groundId, transactionId, lifecycle: GROUND_LIFECYCLE.ACTIVE, lastCheckpoint: checkpoint,
      authorityRecord: authority
    });
  }

  async updateGroundPublicState(sceneId, groundId, patch = {}, { transactionId } = {}) {
    requireTransactionId(transactionId);
    rejectUnknown(patch, PUBLIC_MUTATION_FIELDS, "publicStatePatch");
    if (Object.keys(patch).length === 0) throw new TypeError("publicStatePatch no puede estar vacío.");
    const current = this.#requireMatched(sceneId, groundId);
    if (current.authorityRecord.lifecycle !== GROUND_LIFECYCLE.ACTIVE) {
      throw new GroundLifecycleMutationError("La mutación pública requiere Ground ACTIVE.", {
        reasonCode: "GROUND_PUBLIC_MUTATION_STATE_INVALID", sceneId, groundId, transactionId, pairState: current
      });
    }
    const checkpoint = "authority-public-state-persisted";
    const authority = await this.repository.updateAuthority(sceneId, groundId, {
      ...clone(patch),
      recoveryEvidence: this.#evidence(current.authorityRecord, transactionId, [checkpoint], null)
    }, { assertAuthority: this.assertAuthority });
    return this.#publishAuthority(authority, { transactionId, lastCheckpoint: checkpoint });
  }

  async markRecoveryRequired(sceneId, groundId, {
    transactionId,
    reasonCode,
    checkpoints = []
  } = {}) {
    requireTransactionId(transactionId);
    if (typeof reasonCode !== "string" || !reasonCode.trim()) {
      throw new TypeError("markRecoveryRequired requiere reasonCode.");
    }
    if (!Array.isArray(checkpoints)) throw new TypeError("checkpoints debe ser un array.");
    const current = this.repository.read(sceneId, groundId);
    if (!current.authorityRecord) {
      throw new GroundLifecycleMutationError("No existe AuthorityRecord para marcar recovery.", {
        reasonCode: "GROUND_AUTHORITY_NOT_FOUND", sceneId, groundId, transactionId, pairState: current
      });
    }
    await this.repository.updateAuthority(sceneId, groundId, {
      lifecycle: GROUND_LIFECYCLE.RECOVERY_REQUIRED,
      recoveryEvidence: this.#evidence(current.authorityRecord, transactionId, checkpoints, reasonCode)
    }, { assertAuthority: this.assertAuthority });
    const result = this.repository.read(sceneId, groundId);
    if (result.authorityRecord?.lifecycle !== GROUND_LIFECYCLE.RECOVERY_REQUIRED) {
      throw new GroundLifecycleMutationError("No pudo verificarse RECOVERY_REQUIRED durable.", {
        reasonCode: GROUND_MUTATION_REASON.POST_WRITE_VERIFICATION_FAILED,
        sceneId, groundId, transactionId,
        lastCheckpoint: checkpoints.at(-1) ?? null,
        pairState: result
      });
    }
    return result;
  }

  async tombstoneGround(sceneId, groundId, { transactionId } = {}) {
    requireTransactionId(transactionId);
    const current = this.#requireMatched(sceneId, groundId);
    const checkpoint = "authority-tombstoned";
    const authority = await this.repository.updateAuthority(sceneId, groundId, {
      lifecycle: GROUND_LIFECYCLE.TOMBSTONED,
      visibility: GROUND_VISIBILITY.INVISIBLE,
      pickupEnabled: false,
      recoveryEvidence: this.#evidence(current.authorityRecord, transactionId, [checkpoint], null)
    }, { assertAuthority: this.assertAuthority });
    return this.#publishAuthority(authority, {
      transactionId,
      lastCheckpoint: checkpoint,
      recoveryAllowed: false
    });
  }

  #evidence(authorityRecord, transactionId, checkpoints, reasonCode) {
    return {
      transactionId,
      checkpoints: mergeCheckpoints(authorityRecord.recoveryEvidence?.checkpoints ?? [], checkpoints),
      reasonCode
    };
  }

  #requireMatched(sceneId, groundId) {
    const current = this.repository.read(sceneId, groundId);
    if (current.status !== "MATCHED" || !current.authorityRecord) {
      throw new GroundLifecycleMutationError("Ground no posee un par MATCHED.", {
        reasonCode: "GROUND_PAIR_NOT_MATCHED", sceneId, groundId, pairState: current
      });
    }
    return current;
  }

  async #publishAuthority(authorityRecord, {
    transactionId,
    lastCheckpoint,
    recoveryAllowed = true
  }) {
    const { sceneId, groundId } = authorityRecord;
    try {
      await this.repository.updatePublic(
        sceneId,
        groundId,
        projectGroundPublicState(authorityRecord),
        { assertAuthority: this.assertAuthority }
      );
    } catch (error) {
      if (error?.reasonCode === "AUTHORITY_CONTEXT_STALE" || error?.reasonCode === "WRITE_CONTEXT_MISSING") {
        throw error;
      }
      return this.#failAfterPublicWrite({
        sceneId, groundId, transactionId, lastCheckpoint, cause: error, recoveryAllowed
      });
    }
    const result = this.repository.read(sceneId, groundId);
    if (result.status !== "MATCHED") {
      return this.#failAfterPublicWrite({
        sceneId,
        groundId,
        transactionId,
        lastCheckpoint,
        cause: new Error("La verificación posterior no produjo MATCHED."),
        reasonCode: GROUND_MUTATION_REASON.POST_WRITE_VERIFICATION_FAILED,
        recoveryAllowed
      });
    }
    return result;
  }

  async #failAfterPublicWrite({
    sceneId,
    groundId,
    transactionId,
    lastCheckpoint,
    cause,
    reasonCode = GROUND_MUTATION_REASON.PUBLIC_WRITE_FAILED,
    recoveryAllowed = true
  }) {
    if (recoveryAllowed) {
      try {
        await this.markRecoveryRequired(sceneId, groundId, {
          transactionId,
          reasonCode,
          checkpoints: [lastCheckpoint, reasonCode === GROUND_MUTATION_REASON.PUBLIC_WRITE_FAILED
            ? "public-write-failed"
            : "post-write-verification-failed"]
        });
      } catch (recoveryError) {
        if (recoveryError?.reasonCode === "AUTHORITY_CONTEXT_STALE" ||
            recoveryError?.reasonCode === "WRITE_CONTEXT_MISSING") {
          throw recoveryError;
        }
        const pairState = this.#safeRead(sceneId, groundId);
        throw new GroundLifecycleMutationError("La publicación Ground falló y no pudo persistirse recovery.", {
          reasonCode: GROUND_MUTATION_REASON.RECOVERY_WRITE_FAILED,
          sceneId,
          groundId,
          transactionId,
          lastCheckpoint,
          pairState,
          cause,
          recoveryError: recoveryError?.message ?? String(recoveryError)
        });
      }
    }
    const pairState = this.#safeRead(sceneId, groundId);
    throw new GroundLifecycleMutationError("La escritura pública Ground falló después de persistir Authority.", {
      reasonCode,
      sceneId,
      groundId,
      transactionId,
      lastCheckpoint,
      pairState,
      cause
    });
  }

  async #verify(result, {
    sceneId,
    groundId,
    transactionId,
    lifecycle,
    lastCheckpoint
  }) {
    const durable = this.repository.read(sceneId, groundId);
    if (result?.status === "MATCHED" && durable.status === "MATCHED" &&
        durable.authorityRecord?.lifecycle === lifecycle) return durable;
    return this.#failAfterPublicWrite({
      sceneId,
      groundId,
      transactionId,
      lastCheckpoint,
      cause: new Error("No pudo verificarse el estado Ground durable."),
      reasonCode: GROUND_MUTATION_REASON.POST_WRITE_VERIFICATION_FAILED,
      recoveryAllowed: lifecycle !== GROUND_LIFECYCLE.TOMBSTONED
    });
  }

  #safeRead(sceneId, groundId) {
    try {
      return this.repository.read(sceneId, groundId);
    } catch (error) {
      return { status: "UNREADABLE", issues: [error?.code ?? error?.message ?? "read-failed"] };
    }
  }
}
