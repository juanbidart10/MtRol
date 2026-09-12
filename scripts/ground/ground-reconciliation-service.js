import {
  GROUND_LIFECYCLE,
  GROUND_VISIBILITY,
  cloneGroundValue,
  projectGroundPublicState
} from "./ground-schema.js";

export const GROUND_RECOVERY_CLASSIFICATION = Object.freeze({
  ABSENT: "ABSENT",
  HEALTHY: "HEALTHY",
  CONSISTENT_PENDING: "CONSISTENT_PENDING",
  CONSISTENT_TOMBSTONED: "CONSISTENT_TOMBSTONED",
  RECOVERY_REQUIRED: "RECOVERY_REQUIRED",
  MANUAL_REVIEW_REQUIRED: "MANUAL_REVIEW_REQUIRED",
  REPAIRABLE_FROM_AUTHORITY: "REPAIRABLE_FROM_AUTHORITY",
  BLOCKED_MISSING_AUTHORITY: "BLOCKED_MISSING_AUTHORITY",
  BLOCKED_UNSAFE_LIFECYCLE: "BLOCKED_UNSAFE_LIFECYCLE",
  BLOCKED_IDENTITY_MISMATCH: "BLOCKED_IDENTITY_MISMATCH",
  CORRUPT: "CORRUPT"
});

export const GROUND_REPAIR_ACTION = Object.freeze({
  NONE: "NONE",
  REBUILD_PUBLIC_FROM_AUTHORITY: "REBUILD_PUBLIC_FROM_AUTHORITY",
  REBUILD_TOMBSTONE_PUBLIC: "REBUILD_TOMBSTONE_PUBLIC"
});

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
}

function fingerprint(value) {
  return JSON.stringify(canonicalize(value));
}

function tombstoneInvariant(authorityRecord) {
  return authorityRecord.visibility === GROUND_VISIBILITY.INVISIBLE && authorityRecord.pickupEnabled === false;
}

function baseInspection(sceneId, groundId, pairStatus, issues = []) {
  return {
    sceneId,
    groundId,
    pairStatus,
    authorityLifecycle: null,
    issues: cloneGroundValue(issues),
    classification: GROUND_RECOVERY_CLASSIFICATION.CORRUPT,
    recoverability: "BLOCKED",
    proposedAction: GROUND_REPAIR_ACTION.NONE,
    repairPlan: null
  };
}

export class GroundReconciliationError extends Error {
  constructor(message, {
    reasonCode,
    sceneId = null,
    groundId = null,
    inspection = null,
    cause = null
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "GroundReconciliationError";
    this.reasonCode = reasonCode;
    this.sceneId = sceneId;
    this.groundId = groundId;
    this.inspection = cloneGroundValue(inspection);
  }
}

export class GroundReconciliationService {
  constructor({ repository } = {}) {
    if (!repository || typeof repository.readWithRevisions !== "function" ||
        typeof repository.replacePublicProjection !== "function") {
      throw new TypeError("GroundReconciliationService requiere un repository Ground revisionado.");
    }
    this.repository = repository;
  }

  inspectGroundRecovery(sceneId, groundId) {
    let state;
    try {
      state = this.repository.readWithRevisions(sceneId, groundId);
    } catch (error) {
      const inspection = baseInspection(sceneId, groundId, "CORRUPT", [error?.code ?? error?.message ?? "corrupt"]);
      inspection.errorCode = error?.code ?? null;
      return inspection;
    }

    const inspection = baseInspection(sceneId, groundId, state.status, state.issues);
    const authority = state.authorityRecord;
    inspection.authorityLifecycle = authority?.lifecycle ?? null;

    if (state.status === "ABSENT") {
      inspection.classification = GROUND_RECOVERY_CLASSIFICATION.ABSENT;
      inspection.recoverability = "NO_ACTION";
      return inspection;
    }
    if (state.status === "PUBLIC_ONLY") {
      inspection.classification = GROUND_RECOVERY_CLASSIFICATION.BLOCKED_MISSING_AUTHORITY;
      return inspection;
    }
    if (!authority) return inspection;

    const lifecycle = authority.lifecycle;
    const isTombstoneSafe = lifecycle !== GROUND_LIFECYCLE.TOMBSTONED || tombstoneInvariant(authority);
    if (!isTombstoneSafe) {
      inspection.classification = GROUND_RECOVERY_CLASSIFICATION.BLOCKED_UNSAFE_LIFECYCLE;
      inspection.issues = [...inspection.issues, "tombstone-authority-invariant"];
      return inspection;
    }

    if (state.status === "MATCHED") {
      inspection.recoverability = "NO_ACTION";
      inspection.classification = {
        [GROUND_LIFECYCLE.ACTIVE]: GROUND_RECOVERY_CLASSIFICATION.HEALTHY,
        [GROUND_LIFECYCLE.PENDING]: GROUND_RECOVERY_CLASSIFICATION.CONSISTENT_PENDING,
        [GROUND_LIFECYCLE.PICKUP_PENDING]: GROUND_RECOVERY_CLASSIFICATION.MANUAL_REVIEW_REQUIRED,
        [GROUND_LIFECYCLE.RECOVERY_REQUIRED]: GROUND_RECOVERY_CLASSIFICATION.RECOVERY_REQUIRED,
        [GROUND_LIFECYCLE.TOMBSTONED]: GROUND_RECOVERY_CLASSIFICATION.CONSISTENT_TOMBSTONED
      }[lifecycle];
      return inspection;
    }

    if (state.issues.some(issue => ["ground-id-mismatch", "scene-id-mismatch"].includes(issue))) {
      inspection.classification = GROUND_RECOVERY_CLASSIFICATION.BLOCKED_IDENTITY_MISMATCH;
      return inspection;
    }
    if (lifecycle === GROUND_LIFECYCLE.PENDING) {
      inspection.classification = GROUND_RECOVERY_CLASSIFICATION.BLOCKED_UNSAFE_LIFECYCLE;
      return inspection;
    }
    if (!["AUTHORITY_ONLY", "MISMATCHED"].includes(state.status)) return inspection;

    const projection = projectGroundPublicState(authority);
    inspection.classification = GROUND_RECOVERY_CLASSIFICATION.REPAIRABLE_FROM_AUTHORITY;
    inspection.recoverability = "REPAIRABLE";
    inspection.proposedAction = lifecycle === GROUND_LIFECYCLE.TOMBSTONED
      ? GROUND_REPAIR_ACTION.REBUILD_TOMBSTONE_PUBLIC
      : GROUND_REPAIR_ACTION.REBUILD_PUBLIC_FROM_AUTHORITY;
    inspection.repairPlan = {
      sceneId,
      groundId,
      pairStatus: state.status,
      authorityLifecycle: lifecycle,
      issues: cloneGroundValue(state.issues),
      publicRevision: state.revisions.public,
      authorityRevision: state.revisions.authority,
      authorityFingerprint: fingerprint(authority),
      projection
    };
    return inspection;
  }

  inspectSceneGround(sceneId) {
    let grounds;
    try {
      grounds = this.repository.getGroundForScene(sceneId);
    } catch (error) {
      const inspection = baseInspection(sceneId, null, "CORRUPT", [error?.code ?? error?.message ?? "corrupt"]);
      inspection.errorCode = error?.code ?? null;
      return [inspection];
    }
    return grounds.map(state => this.inspectGroundRecovery(
      sceneId,
      state.authorityRecord?.groundId ?? state.publicProjection?.groundId
    ));
  }

  async repairGround(repairPlan, { assertAuthority = null } = {}) {
    if (assertAuthority !== null && typeof assertAuthority !== "function") {
      throw new GroundReconciliationError("Repair Ground requiere assertAuthority válido.", {
        reasonCode: "GROUND_REPAIR_AUTHORITY_INVALID"
      });
    }
    if (!repairPlan || typeof repairPlan !== "object" || Array.isArray(repairPlan)) {
      throw new GroundReconciliationError("Repair Ground requiere un plan explícito.", {
        reasonCode: "GROUND_REPAIR_PLAN_REQUIRED"
      });
    }
    const { sceneId, groundId } = repairPlan;
    const current = this.inspectGroundRecovery(sceneId, groundId);
    if (current.pairStatus === "CORRUPT") {
      throw new GroundReconciliationError("Persistence Ground corrupta; repair bloqueado.", {
        reasonCode: "GROUND_REPAIR_CORRUPT", sceneId, groundId, inspection: current
      });
    }

    const state = this.repository.readWithRevisions(sceneId, groundId);
    const currentFingerprint = state.authorityRecord ? fingerprint(state.authorityRecord) : null;
    if (state.status === "MATCHED" && currentFingerprint === repairPlan.authorityFingerprint) {
      return { outcome: "NO_OP", state: this.repository.read(sceneId, groundId), inspection: current };
    }

    const stale = state.revisions.public !== repairPlan.publicRevision ||
      state.revisions.authority !== repairPlan.authorityRevision ||
      state.status !== repairPlan.pairStatus ||
      state.authorityRecord?.lifecycle !== repairPlan.authorityLifecycle ||
      currentFingerprint !== repairPlan.authorityFingerprint;
    if (stale) {
      throw new GroundReconciliationError("El repair plan Ground quedó stale.", {
        reasonCode: "GROUND_REPAIR_PLAN_STALE", sceneId, groundId, inspection: current
      });
    }
    if (current.recoverability !== "REPAIRABLE" || !current.repairPlan) {
      throw new GroundReconciliationError("El estado Ground no es auto-reparable.", {
        reasonCode: "GROUND_REPAIR_BLOCKED", sceneId, groundId, inspection: current
      });
    }

    const projection = projectGroundPublicState(state.authorityRecord);
    try {
      await this.repository.replacePublicProjection(sceneId, groundId, projection, {
        expectedPublicRevision: repairPlan.publicRevision,
        expectedAuthorityRevision: repairPlan.authorityRevision,
        assertAuthority
      });
    } catch (error) {
      if (error?.reasonCode === "AUTHORITY_CONTEXT_STALE" || error?.reasonCode === "WRITE_CONTEXT_MISSING") {
        throw error;
      }
      const reasonCode = error?.code === "GROUND_REVISION_CONFLICT"
        ? "GROUND_REPAIR_PLAN_STALE"
        : "GROUND_REPAIR_WRITE_FAILED";
      throw new GroundReconciliationError("No se pudo persistir la reparación Ground.", {
        reasonCode, sceneId, groundId,
        inspection: this.inspectGroundRecovery(sceneId, groundId),
        cause: error
      });
    }

    const verifiedState = this.repository.readWithRevisions(sceneId, groundId);
    const verifiedFingerprint = verifiedState.authorityRecord ? fingerprint(verifiedState.authorityRecord) : null;
    if (verifiedState.status !== "MATCHED" || verifiedFingerprint !== repairPlan.authorityFingerprint) {
      throw new GroundReconciliationError("La reparación Ground no pudo verificarse durablemente.", {
        reasonCode: "GROUND_REPAIR_VERIFICATION_FAILED",
        sceneId,
        groundId,
        inspection: this.inspectGroundRecovery(sceneId, groundId)
      });
    }
    return {
      outcome: "REPAIRED",
      state: this.repository.read(sceneId, groundId),
      inspection: this.inspectGroundRecovery(sceneId, groundId)
    };
  }
}
