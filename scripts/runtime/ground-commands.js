import { authorityService } from "../core/authority-service.js";
import { createLevel1GroundPersistence } from "../ground/ground-repository.js";
import { createGroundReceiptScope } from "../ground/ground-receipt-scope.js";
import { GroundReconciliationService } from "../ground/ground-reconciliation-service.js";
import { validateGroundPublicProjection } from "../ground/ground-schema.js";
import { logger } from "../utils/logger.js";
import { commandRegistry } from "./runtime-foundation.js";

export const GROUND_COMMAND = Object.freeze({
  INSPECT: "ground.inspect",
  RECONCILE: "ground.reconcile"
});

export const GROUND_SOCKET_ACTION = Object.freeze({
  INSPECT: "mtrolGroundInspect",
  RECONCILE: "mtrolGroundReconcile"
});

const SOCKET_COMMANDS = Object.freeze({
  [GROUND_SOCKET_ACTION.INSPECT]: GROUND_COMMAND.INSPECT,
  [GROUND_SOCKET_ACTION.RECONCILE]: GROUND_COMMAND.RECONCILE
});

const INSPECT_FIELDS = Object.freeze(["sceneId", "groundId"]);
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
  createReceiptTarget: sceneId => createGroundReceiptScope(sceneId),
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
