import { authorityService } from "../core/authority-service.js";
import { createLevel1GroundPersistence } from "../ground/ground-repository.js";
import { createGroundReceiptScope } from "../ground/ground-receipt-scope.js";
import { GroundReconciliationService } from "../ground/ground-reconciliation-service.js";
import { GroundLifecycleService } from "../ground/ground-lifecycle-service.js";
import {
  GROUND_APPEARANCE_MODE,
  GROUND_LIFECYCLE,
  GROUND_VISIBILITY,
  createGroundId,
  validateGroundPublicProjection
} from "../ground/ground-schema.js";
import {
  analyzeItemQuantity,
  isItemActuallyEquipped,
  isMtrolObject,
  normalizeEquippedFlag
} from "../items/item-invariants.js";
import { createItemTransferSnapshot } from "../items/item-transfer-data.js";
import { logger } from "../utils/logger.js";
import { createReceiptFingerprint } from "./receipt-store.js";
import { commandRegistry, transactionCoordinator } from "./runtime-foundation.js";

export const GROUND_COMMAND = Object.freeze({
  DROP: "ground.drop",
  INSPECT: "ground.inspect",
  RECONCILE: "ground.reconcile"
});

export const GROUND_SOCKET_ACTION = Object.freeze({
  DROP: "mtrolGroundDrop",
  INSPECT: "mtrolGroundInspect",
  RECONCILE: "mtrolGroundReconcile"
});

const SOCKET_COMMANDS = Object.freeze({
  [GROUND_SOCKET_ACTION.DROP]: GROUND_COMMAND.DROP,
  [GROUND_SOCKET_ACTION.INSPECT]: GROUND_COMMAND.INSPECT,
  [GROUND_SOCKET_ACTION.RECONCILE]: GROUND_COMMAND.RECONCILE
});

const INSPECT_FIELDS = Object.freeze(["sceneId", "groundId"]);
const DROP_FIELDS = Object.freeze(["sourceActorUuid", "sourceItemUuid", "sceneId", "position"]);
const POSITION_FIELDS = Object.freeze(["x", "y"]);
const RECONCILE_FIELDS = Object.freeze(["sceneId", "groundId", "repairPlan"]);
const REPAIR_PLAN_FIELDS = Object.freeze([
  "sceneId", "groundId", "pairStatus", "authorityLifecycle", "issues", "publicRevision",
  "authorityRevision", "authorityFingerprint", "projection"
]);

function clone(value) {
  if (globalThis.foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
  return value === undefined ? undefined : structuredClone(value);
}

export class GroundCommandError extends Error {
  constructor(message, reasonCode = "GROUND_COMMAND_REJECTED", { cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "GroundCommandError";
    this.reasonCode = reasonCode;
  }
}

function rejectUnknown(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GroundCommandError(`${label} debe ser un objeto.`, "GROUND_COMMAND_PAYLOAD_INVALID");
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new GroundCommandError(`${label}.${key} no está permitido.`, "GROUND_COMMAND_PAYLOAD_INVALID");
    }
  }
  for (const key of allowed) {
    if (!Object.hasOwn(value, key)) {
      throw new GroundCommandError(`Falta ${label}.${key}.`, "GROUND_COMMAND_PAYLOAD_INVALID");
    }
  }
}

function validateSceneId(sceneId) {
  if (typeof sceneId !== "string" || !/^[A-Za-z0-9_-]+$/.test(sceneId)) {
    throw new GroundCommandError("sceneId Ground inválido.", "GROUND_COMMAND_PAYLOAD_INVALID");
  }
  return sceneId;
}

function validateDrop(payload, context, dependencies) {
  rejectUnknown(payload, DROP_FIELDS, "ground.drop payload");
  const sceneId = validateSceneId(payload.sceneId);
  for (const field of ["sourceActorUuid", "sourceItemUuid"]) {
    if (typeof payload[field] !== "string" || !payload[field].trim()) {
      throw new GroundCommandError(`${field} inválido.`, "GROUND_COMMAND_PAYLOAD_INVALID");
    }
  }
  rejectUnknown(payload.position, POSITION_FIELDS, "ground.drop payload.position");
  if (POSITION_FIELDS.some(axis => typeof payload.position[axis] !== "number" || !Number.isFinite(payload.position[axis]))) {
    throw new GroundCommandError("position Ground inválida.", "GROUND_COMMAND_PAYLOAD_INVALID");
  }
  if (!dependencies.resolveScene(sceneId)) {
    throw new GroundCommandError(`Scene Ground no encontrada: ${sceneId}.`, "GROUND_SCENE_NOT_FOUND");
  }
  const user = dependencies.authorityService.resolveUser(context.requestingUserId);
  if (!user || user.viewedScene !== sceneId) {
    throw new GroundCommandError("La Scene activa del solicitante cambió.", "GROUND_DROP_SCENE_STALE");
  }
}

function validateGroundId(groundId) {
  if (typeof groundId !== "string" || !/^ground:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16,64}$/.test(groundId)) {
    throw new GroundCommandError("groundId inválido.", "GROUND_COMMAND_PAYLOAD_INVALID");
  }
  return groundId;
}

function requireGM(context, dependencies, command) {
  const user = dependencies.authorityService.resolveUser(context.requestingUserId);
  if (!user?.isGM) {
    dependencies.logger?.warn?.("GROUND", "Ground GM-only command rejected", {
      command,
      userId: context.requestingUserId ?? null,
      reasonCode: "GROUND_GM_REQUIRED"
    });
    throw new GroundCommandError("La operación Ground requiere GM.", "GROUND_GM_REQUIRED");
  }
  return user;
}

function validateTarget(payload, dependencies, fields, label) {
  rejectUnknown(payload, fields, label);
  const sceneId = validateSceneId(payload.sceneId);
  const groundId = validateGroundId(payload.groundId);
  if (!dependencies.resolveScene(sceneId)) {
    throw new GroundCommandError(`Scene Ground no encontrada: ${sceneId}.`, "GROUND_SCENE_NOT_FOUND");
  }
  return { sceneId, groundId };
}

function validateRepairPlan(repairPlan, sceneId, groundId) {
  rejectUnknown(repairPlan, REPAIR_PLAN_FIELDS, "repairPlan");
  if (repairPlan.sceneId !== sceneId || repairPlan.groundId !== groundId) {
    throw new GroundCommandError("El repair plan no corresponde al Ground solicitado.", "GROUND_REPAIR_PLAN_TARGET_MISMATCH");
  }
  if (typeof repairPlan.pairStatus !== "string" || typeof repairPlan.authorityLifecycle !== "string" ||
      typeof repairPlan.authorityFingerprint !== "string" || !repairPlan.authorityFingerprint) {
    throw new GroundCommandError("Identidad del repair plan inválida.", "GROUND_COMMAND_PAYLOAD_INVALID");
  }
  if (!Array.isArray(repairPlan.issues) || repairPlan.issues.some(issue => typeof issue !== "string")) {
    throw new GroundCommandError("Issues del repair plan inválidos.", "GROUND_COMMAND_PAYLOAD_INVALID");
  }
  if (!Number.isSafeInteger(repairPlan.publicRevision) || repairPlan.publicRevision < 0 ||
      !Number.isSafeInteger(repairPlan.authorityRevision) || repairPlan.authorityRevision < 0) {
    throw new GroundCommandError("Revisiones del repair plan inválidas.", "GROUND_COMMAND_PAYLOAD_INVALID");
  }
  try {
    validateGroundPublicProjection(repairPlan.projection);
  } catch (error) {
    throw new GroundCommandError("Proyección del repair plan inválida.", "GROUND_COMMAND_PAYLOAD_INVALID", { cause: error });
  }
  return clone(repairPlan);
}

function projectInspection(inspection) {
  return {
    sceneId: inspection.sceneId,
    groundId: inspection.groundId,
    pairStatus: inspection.pairStatus,
    authorityLifecycle: inspection.authorityLifecycle,
    classification: inspection.classification,
    issues: clone(inspection.issues ?? []),
    recoverability: inspection.recoverability,
    proposedAction: inspection.proposedAction
  };
}

function normalizeError(error) {
  if (error?.reasonCode) return error;
  const reasonCode = error?.code ?? (error?.name === "GroundSchemaError"
    ? "GROUND_SCHEMA_INVALID"
    : error instanceof TypeError
      ? "GROUND_COMMAND_PAYLOAD_INVALID"
      : "GROUND_COMMAND_FAILED");
  return new GroundCommandError(error?.message ?? "Ground command rechazado.", reasonCode, { cause: error });
}

const defaultRepository = createLevel1GroundPersistence();
const defaultReconciliation = new GroundReconciliationService({ repository: defaultRepository });

const DEFAULT_DEPENDENCIES = Object.freeze({
  authorityService,
  repository: defaultRepository,
  reconciliation: defaultReconciliation,
  resolveScene: sceneId => globalThis.game?.scenes?.get?.(sceneId) ?? null,
  resolveUuid: uuid => globalThis.fromUuid?.(uuid) ?? null,
  createLifecycle: assertAuthority => new GroundLifecycleService({ repository: defaultRepository, assertAuthority }),
  createSnapshot: createItemTransferSnapshot,
  analyzeQuantity: analyzeItemQuantity,
  now: () => Date.now(),
  createReceiptTarget: sceneId => createGroundReceiptScope(sceneId),
  transactionCoordinator,
  createGroundId,
  logger
});

function dependenciesWith(overrides = {}) {
  return { ...DEFAULT_DEPENDENCIES, ...overrides };
}

function inspectValidation(dependencies) {
  return (payload, context) => {
    requireGM(context, dependencies, GROUND_COMMAND.INSPECT);
    validateTarget(payload, dependencies, INSPECT_FIELDS, "ground.inspect payload");
  };
}

function dropValidation(dependencies) {
  return (payload, context) => validateDrop(payload, context, dependencies);
}

async function dropGround(payload, context, envelope, dependencies) {
  const writeContext = dependencies.authorityService.createWriteContext();
  const fingerprint = await createReceiptFingerprint(payload);
  const receiptScope = dependencies.createReceiptTarget(payload.sceneId);
  const candidateGroundId = dependencies.createGroundId();
  dependencies.logger?.info?.("GROUND", "Ground drop command started", {
    transactionId: envelope.transactionId,
    groundId: null,
    sourceActorUuid: payload.sourceActorUuid,
    sourceItemUuid: payload.sourceItemUuid,
    sceneId: payload.sceneId,
    callerUserId: context.requestingUserId,
    checkpoint: "source-resolution",
    outcome: "started",
    reasonCode: null
  });
  try {
    const result = await dependencies.transactionCoordinator.execute({ receiptScope }, {
      transactionId: envelope.transactionId,
      command: GROUND_COMMAND.DROP,
      fingerprint,
      authorityContext: writeContext,
      serializationKey: `ground-source:${payload.sourceItemUuid}`,
      metadata: {
        sourceActorUuid: payload.sourceActorUuid,
        sourceItemUuid: payload.sourceItemUuid,
        sceneId: payload.sceneId
      },
      prepare: async () => ({
        fingerprint,
        groundId: candidateGroundId,
        sourceActorUuid: payload.sourceActorUuid,
        sourceItemUuid: payload.sourceItemUuid,
        sceneId: payload.sceneId,
        position: clone(payload.position),
        intendedVisibility: GROUND_VISIBILITY.REVEALED
      }),
      apply: async ({ prepared, checkpoint, assertAuthority }) => {
        const actor = await dependencies.resolveUuid(payload.sourceActorUuid);
        if (actor?.documentName !== "Actor") {
          throw new GroundCommandError("Actor fuente no encontrado.", "GROUND_SOURCE_ACTOR_NOT_FOUND");
        }
        if (actor.isToken === true) {
          throw new GroundCommandError(
            "Ground Drop MVP no admite Actors synthetic/unlinked.",
            "GROUND_SYNTHETIC_SOURCE_UNSUPPORTED"
          );
        }
        dependencies.authorityService.assertActorOwnership(actor, context.requestingUserId);
        const item = await dependencies.resolveUuid(payload.sourceItemUuid);
        if (item?.documentName !== "Item") {
          throw new GroundCommandError("Item fuente no encontrado.", "GROUND_SOURCE_ITEM_NOT_FOUND");
        }
        if (item.parent !== actor || actor.items?.get?.(item.id) !== item || item.uuid !== payload.sourceItemUuid) {
          throw new GroundCommandError("El Item no pertenece exactamente al Actor fuente.", "GROUND_SOURCE_ITEM_MISMATCH");
        }
        if (normalizeEquippedFlag(item.system?.equipado) || isItemActuallyEquipped(actor, item)) {
          throw new GroundCommandError(
            "Un Item equipado no puede dropearse en Ground durante el MVP.",
            "GROUND_SOURCE_ITEM_EQUIPPED"
          );
        }
        const quantity = dependencies.analyzeQuantity(item);
        if (!isMtrolObject(item) || quantity.valid !== true || !Number.isFinite(quantity.effectiveValue) ||
            quantity.effectiveValue < 1) {
          throw new GroundCommandError("Item fuente no soportado o sin cantidad disponible.", "GROUND_SOURCE_ITEM_UNSUPPORTED");
        }
        const lifecycle = dependencies.createLifecycle(assertAuthority);
        const itemSnapshot = dependencies.createSnapshot(item);
        assertAuthority();
        const pending = await lifecycle.createPendingGround({
          groundId: prepared.groundId,
          sceneId: payload.sceneId,
          position: clone(payload.position),
          visibility: GROUND_VISIBILITY.INVISIBLE,
          pickupEnabled: false,
          appearance: { mode: GROUND_APPEARANCE_MODE.REAL, img: item.img },
          quantity: 1,
          itemSnapshot,
          provenance: {
            sourceActorUuid: actor.uuid,
            sourceItemUuid: item.uuid,
            createdBy: context.requestingUserId,
            createdAt: dependencies.now(),
            operationId: envelope.transactionId
          }
        });
        await checkpoint("ground-pending", { groundId: pending.authorityRecord.groundId });
        assertAuthority();
        await lifecycle.activateGround(payload.sceneId, prepared.groundId, { transactionId: envelope.transactionId });
        await checkpoint("ground-active", { groundId: prepared.groundId });
        assertAuthority();
        const revealed = await lifecycle.updateGroundPublicState(
          payload.sceneId,
          prepared.groundId,
          { visibility: prepared.intendedVisibility, pickupEnabled: false },
          { transactionId: envelope.transactionId }
        );
        await checkpoint("ground-published", { groundId: prepared.groundId });
        return groundDropResult(envelope.transactionId, payload.sceneId, revealed);
      },
      reconcile: (receipt, recovery) => reconcileGroundDropReceipt(receipt, recovery, dependencies)
    });
    dependencies.logger?.info?.("GROUND", "Ground drop command completed", {
      transactionId: envelope.transactionId,
      groundId: result.groundId,
      sourceActorUuid: payload.sourceActorUuid,
      sourceItemUuid: payload.sourceItemUuid,
      sceneId: payload.sceneId,
      callerUserId: context.requestingUserId,
      checkpoint: "ground-active",
      outcome: "completed",
      reasonCode: null
    });
    return result;
  } catch (error) {
    const normalized = normalizeError(error);
    dependencies.logger?.error?.("GROUND", "Ground drop command failed", {
      transactionId: envelope.transactionId,
      groundId: error?.groundId ?? null,
      sourceActorUuid: payload.sourceActorUuid,
      sourceItemUuid: payload.sourceItemUuid,
      sceneId: payload.sceneId,
      callerUserId: context.requestingUserId,
      checkpoint: error?.lastCheckpoint ?? "ground-drop",
      outcome: "failed",
      reasonCode: normalized.reasonCode
    });
    throw normalized;
  }
}

function groundDropResult(transactionId, sceneId, pair) {
  return {
    transactionId,
    groundId: pair.authorityRecord.groundId,
    sceneId,
    lifecycle: pair.authorityRecord.lifecycle,
    publicProjection: validateGroundPublicProjection(pair.publicProjection)
  };
}

async function reconcileGroundDropReceipt(receipt, { assertAuthority, transactionId }, dependencies) {
  const prepared = receipt?.prepared;
  if (!prepared?.sceneId || !prepared?.groundId) return { resolved: false };
  let pair = dependencies.repository.read(prepared.sceneId, prepared.groundId);
  if (pair.status !== "MATCHED" || !pair.authorityRecord || !pair.publicProjection) {
    return { resolved: false };
  }
  const lifecycle = dependencies.createLifecycle(assertAuthority);
  if (pair.authorityRecord.lifecycle === GROUND_LIFECYCLE.PENDING &&
      pair.authorityRecord.visibility === GROUND_VISIBILITY.INVISIBLE) {
    assertAuthority();
    pair = await lifecycle.activateGround(prepared.sceneId, prepared.groundId, { transactionId });
  }
  if (pair.authorityRecord.lifecycle === GROUND_LIFECYCLE.ACTIVE &&
      pair.authorityRecord.visibility === GROUND_VISIBILITY.INVISIBLE) {
    assertAuthority();
    pair = await lifecycle.updateGroundPublicState(
      prepared.sceneId,
      prepared.groundId,
      { visibility: prepared.intendedVisibility ?? GROUND_VISIBILITY.REVEALED, pickupEnabled: false },
      { transactionId }
    );
  }
  const resolved = pair.status === "MATCHED" &&
    pair.authorityRecord?.lifecycle === GROUND_LIFECYCLE.ACTIVE &&
    pair.publicProjection?.visibility === (prepared.intendedVisibility ?? GROUND_VISIBILITY.REVEALED) &&
    pair.publicProjection?.pickupEnabled === false;
  return resolved
    ? { resolved: true, result: groundDropResult(transactionId, prepared.sceneId, pair) }
    : { resolved: false };
}

function reconcileValidation(dependencies) {
  return (payload, context) => {
    requireGM(context, dependencies, GROUND_COMMAND.RECONCILE);
    const { sceneId, groundId } = validateTarget(
      payload,
      dependencies,
      RECONCILE_FIELDS,
      "ground.reconcile payload"
    );
    validateRepairPlan(payload.repairPlan, sceneId, groundId);
  };
}

async function inspectGround(payload, dependencies) {
  try {
    return projectInspection(dependencies.reconciliation.inspectGroundRecovery(payload.sceneId, payload.groundId));
  } catch (error) {
    throw normalizeError(error);
  }
}

async function reconcileGround(payload, context, envelope, dependencies) {
  const writeContext = dependencies.authorityService.createWriteContext();
  const assertAuthority = () => dependencies.authorityService.validateWriteContext(writeContext);
  try {
    const repaired = await dependencies.reconciliation.repairGround(clone(payload.repairPlan), { assertAuthority });
    const inspection = dependencies.reconciliation.inspectGroundRecovery(payload.sceneId, payload.groundId);
    return {
      transactionId: envelope.transactionId,
      outcome: repaired.outcome,
      ...projectInspection(inspection)
    };
  } catch (error) {
    const normalized = normalizeError(error);
    dependencies.logger?.error?.("GROUND", "Ground reconciliation command failed", {
      command: GROUND_COMMAND.RECONCILE,
      transactionId: envelope.transactionId,
      sceneId: payload.sceneId,
      groundId: payload.groundId,
      userId: context.requestingUserId,
      reasonCode: normalized.reasonCode
    });
    throw normalized;
  }
}

export function registerGroundCommands(registry = commandRegistry, dependencyOverrides = {}) {
  const dependencies = dependenciesWith(dependencyOverrides);
  if (!registry.has(GROUND_COMMAND.DROP)) {
    registry.register(
      GROUND_COMMAND.DROP,
      (payload, context, envelope) => dropGround(payload, context, envelope, dependencies),
      {
        scope: "world",
        idempotent: false,
        validate: dropValidation(dependencies),
        receiptTarget: null
      }
    );
  }
  if (!registry.has(GROUND_COMMAND.INSPECT)) {
    registry.register(
      GROUND_COMMAND.INSPECT,
      payload => inspectGround(payload, dependencies),
      { scope: "world", idempotent: false, validate: inspectValidation(dependencies) }
    );
  }
  if (!registry.has(GROUND_COMMAND.RECONCILE)) {
    registry.register(
      GROUND_COMMAND.RECONCILE,
      (payload, context, envelope) => reconcileGround(payload, context, envelope, dependencies),
      {
        scope: "world",
        idempotent: true,
        validate: reconcileValidation(dependencies),
        receiptTarget: payload => dependencies.createReceiptTarget(payload.sceneId)
      }
    );
  }
  return registry;
}

export function getGroundCommandForSocketAction(action) {
  return Object.hasOwn(SOCKET_COMMANDS, action) ? SOCKET_COMMANDS[action] : null;
}

export async function recoverGroundDropTransaction(sceneId, transactionId, dependencyOverrides = {}) {
  const dependencies = dependenciesWith(dependencyOverrides);
  const receiptScope = dependencies.createReceiptTarget(validateSceneId(sceneId));
  const receipt = dependencies.transactionCoordinator.get({ receiptScope }, transactionId);
  if (!receipt || receipt.command !== GROUND_COMMAND.DROP) {
    throw new GroundCommandError("Receipt Ground Drop no encontrado.", "GROUND_RECEIPT_NOT_FOUND");
  }
  if (receipt.status === "completed") return clone(receipt.result);
  const writeContext = dependencies.authorityService.createWriteContext();
  return dependencies.transactionCoordinator.execute({ receiptScope }, {
    transactionId,
    command: GROUND_COMMAND.DROP,
    fingerprint: receipt.fingerprint ?? null,
    authorityContext: writeContext,
    serializationKey: `ground-source:${receipt.sourceItemUuid ?? receipt.prepared?.sourceItemUuid ?? "unknown"}`,
    apply: async () => {
      throw new GroundCommandError(
        "Recovery Ground no inicia efectos sin evidencia preparada.",
        "RECOVERY_REQUIRED"
      );
    },
    reconcile: (current, recovery) => reconcileGroundDropReceipt(current, recovery, dependencies)
  });
}

export async function dispatchGroundSocketCommand(request = {}, {
  registry = commandRegistry,
  dependencies = {},
  isPrimaryGM = () => authorityService.isPrimaryGM()
} = {}) {
  const command = getGroundCommandForSocketAction(request.action);
  if (!command) return { handled: false, result: null };
  registerGroundCommands(registry, dependencies);
  const payload = request.payload ?? {};
  const result = await registry.dispatch({
    command,
    transactionId: request.transactionId ?? payload.transactionId ?? request.requestId,
    payload
  }, {
    requestingUserId: request.requestingUserId,
    isPrimaryGM: isPrimaryGM()
  });
  return { handled: true, result };
}

export async function dispatchGroundCommandLocal(action, payload = {}, requestingUserId = globalThis.game?.user?.id) {
  return (await dispatchGroundSocketCommand({
    action,
    transactionId: payload.transactionId,
    requestingUserId,
    payload
  })).result;
}
