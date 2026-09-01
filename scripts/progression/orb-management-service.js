import {
  getOrbDefinition,
  MTROL_ORB_IDS
} from "./orb-registry.js";
import { authorityService, AuthorityBoundaryError } from "../core/authority-service.js";
import { requestPrimaryGM } from "../core/socket-requests.js";
import { actorRuntimeRepository, transactionCoordinator } from "../runtime/runtime-foundation.js";

// In-flight serialization only; completed results live in Actor receipts.
// Key Actor UUID, released in finally; safe to rebuild after F5.
const actorQueues = new Map();

function assertExactKeys(payload, allowed) {
  for (const key of Object.keys(payload ?? {})) {
    if (!allowed.has(key)) throw new Error(`Campo de Orbe no permitido: ${key}.`);
  }
}

function assertGM(requestingUserId) {
  const user = authorityService.resolveUser(requestingUserId);
  if (!user?.isGM) throw new AuthorityBoundaryError("Sólo un GM puede administrar Orbes.", "ORB_GM_REQUIRED");
  if (!authorityService.isPrimaryGM()) {
    throw new AuthorityBoundaryError("Sólo el Primary GM puede ejecutar cambios de Orbes.", "NOT_PRIMARY_GM");
  }
}

async function getCanonicalActor(payload, trustedActor) {
  const actor = trustedActor?.uuid === payload.actorUuid ? trustedActor :
    payload.actorUuid ? await fromUuid(payload.actorUuid) : null;
  if (actor?.documentName && actor.documentName !== "Actor") {
    throw new AuthorityBoundaryError("El documento objetivo no es un Actor.", "ORB_ACTOR_INVALID");
  }
  return actor;
}

function assertOrbType(type) {
  const normalized = String(type ?? "").trim().toLowerCase();
  if (!MTROL_ORB_IDS.includes(normalized)) {
    throw new Error("El tipo de Orbe no pertenece al registro canónico.");
  }
  return normalized;
}

function assertOrbLevel(level) {
  const normalized = Number(level);
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 5) {
    throw new Error("El nivel de Orbe debe ser un entero entre 1 y 5.");
  }
  return normalized;
}

function assertStableId(id) {
  const normalized = String(id ?? "").trim();
  if (!normalized) throw new Error("Falta el ID estable de instancia del Orbe.");
  return normalized;
}

function cloneOrbs(actor) {
  return structuredClone(Array.from(actor.system?.orbs ?? []));
}

async function withActorLock(actorUuid, operation) {
  const previous = actorQueues.get(actorUuid) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  actorQueues.set(actorUuid, current);
  try {
    return await current;
  } finally {
    if (actorQueues.get(actorUuid) === current) actorQueues.delete(actorUuid);
  }
}

async function runOrbTransaction(actor, payload, operationName, operation) {
  const transactionId = String(payload.transactionId ?? "").trim();
  if (!transactionId) throw new Error("Falta transactionId para administrar Orbes.");
  const scope = { actor };
  const orbIntent = JSON.stringify(Object.entries(payload).sort(([a], [b]) => a.localeCompare(b)));

  return withActorLock(actor.uuid, async () => {
    const previous = transactionCoordinator.get(scope, transactionId);
    if (previous) {
      if (previous.command !== `orb.${operationName}` || previous.orbIntent !== orbIntent) {
        throw Object.assign(new Error("El transactionId ya fue utilizado por otra operación de Orbes."), {
          reasonCode: "ORB_TRANSACTION_CONFLICT"
        });
      }
      if (previous.status === "failed" && previous.failureSafety === "no-effects") {
        throw Object.assign(new Error(previous.error), { reasonCode: "ORB_VALIDATION_FAILED" });
      }
    }

    const result = await transactionCoordinator.execute(scope, {
      transactionId,
      command: `orb.${operationName}`,
      metadata: { actorUuid: actor.uuid, operation: operationName, orbIntent },
      prepare: operation,
      apply: async ({ prepared, checkpoint }) => {
        await checkpoint("orb-write-intent", { actorUuid: actor.uuid });
        await actor.update({ "system.orbs": prepared.orbs });
        const receipt = { orb: prepared.orb, operation: operationName, actorUuid: actor.uuid, transactionId, replayed: false };
        await checkpoint("orb-applied", { result: receipt });
        return receipt;
      },
      reconcile: async receipt => {
        const result = receipt.checkpoints?.["orb-applied"]?.result;
        return result ? { resolved: true, result } : { resolved: false };
      }
    });
    return { ...result, replayed: previous != null };
  });
}

export async function addActorOrbAuthoritative(payload = {}, {
  requestingUserId = game.user?.id,
  trustedActor = null
} = {}) {
  assertExactKeys(payload, new Set([
    "actorUuid", "transactionId", "orbId", "type", "level", "expectedOrbCount"
  ]));
  assertGM(requestingUserId);
  const actor = await getCanonicalActor(payload, trustedActor);
  if (!actor) throw new Error("No se encontró el Actor para agregar el Orbe.");

  const orbId = assertStableId(payload.orbId);
  const type = assertOrbType(payload.type);
  const level = assertOrbLevel(payload.level);
  const expectedOrbCount = Number(payload.expectedOrbCount);
  if (!Number.isInteger(expectedOrbCount) || expectedOrbCount < 0) {
    throw new Error("El snapshot de cantidad de Orbes es inválido.");
  }

  return runOrbTransaction(actor, payload, "add", async () => {
    const orbs = cloneOrbs(actor);
    if (orbs.length !== expectedOrbCount) {
      throw new Error("La colección de Orbes cambió; se canceló el alta duplicada.");
    }
    if (orbs.some(orb => orb.id === orbId)) {
      throw new Error("El ID estable del Orbe ya existe.");
    }
    if (orbs.some(orb => orb.type === type)) {
      throw new Error(`El Actor ya posee un Orbe ${getOrbDefinition(type).name}.`);
    }

    const orb = { id: orbId, type, level };
    return { orbs: [...orbs, orb], orb };
  });
}

export async function updateActorOrbAuthoritative(payload = {}, {
  requestingUserId = game.user?.id,
  trustedActor = null
} = {}) {
  assertExactKeys(payload, new Set([
    "actorUuid", "transactionId", "orbId", "type", "level", "expectedType", "expectedLevel"
  ]));
  assertGM(requestingUserId);
  const actor = await getCanonicalActor(payload, trustedActor);
  if (!actor) throw new Error("No se encontró el Actor para editar el Orbe.");

  const orbId = assertStableId(payload.orbId);
  const type = assertOrbType(payload.type);
  const level = assertOrbLevel(payload.level);
  const expectedType = assertOrbType(payload.expectedType);
  const expectedLevel = assertOrbLevel(payload.expectedLevel);

  return runOrbTransaction(actor, payload, "update", async () => {
    const orbs = cloneOrbs(actor);
    const index = orbs.findIndex(orb => orb.id === orbId);
    if (index < 0) throw new Error("El Orbe solicitado ya no existe.");
    if (orbs[index].type !== expectedType || Number(orbs[index].level) !== expectedLevel) {
      throw new Error("El Orbe cambió; se canceló la edición sobre un snapshot obsoleto.");
    }
    if (orbs.some((orb, orbIndex) => orbIndex !== index && orb.type === type)) {
      throw new Error(`El Actor ya posee un Orbe ${getOrbDefinition(type).name}.`);
    }

    const orb = { id: orbId, type, level };
    orbs[index] = orb;
    return { orbs, orb };
  });
}

export async function deleteActorOrbAuthoritative(payload = {}, {
  requestingUserId = game.user?.id,
  trustedActor = null
} = {}) {
  assertExactKeys(payload, new Set([
    "actorUuid", "transactionId", "orbId", "expectedType", "expectedLevel"
  ]));
  assertGM(requestingUserId);
  const actor = await getCanonicalActor(payload, trustedActor);
  if (!actor) throw new Error("No se encontró el Actor para eliminar el Orbe.");

  const orbId = assertStableId(payload.orbId);
  const expectedType = assertOrbType(payload.expectedType);
  const expectedLevel = assertOrbLevel(payload.expectedLevel);

  return runOrbTransaction(actor, payload, "delete", async () => {
    const orbs = cloneOrbs(actor);
    const index = orbs.findIndex(orb => orb.id === orbId);
    if (index < 0) throw new Error("El Orbe solicitado ya no existe.");
    if (orbs[index].type !== expectedType || Number(orbs[index].level) !== expectedLevel) {
      throw new Error("El Orbe cambió; se canceló la eliminación sobre un snapshot obsoleto.");
    }

    const [orb] = orbs.splice(index, 1);
    return { orbs, orb };
  });
}

function createTransactionId(prefix) {
  return `${prefix}-${foundry.utils.randomID()}`;
}

async function requestOrbChange(action, payload, actor, localOperation) {
  if (!game.user?.isGM) throw new AuthorityBoundaryError("Sólo un GM puede administrar Orbes.", "ORB_GM_REQUIRED");
  if (authorityService.isPrimaryGM()) {
    return localOperation(payload, { requestingUserId: game.user.id, trustedActor: actor });
  }
  const response = await requestPrimaryGM(action, payload);
  if (!response.ok) throw Object.assign(new Error(response.error ?? "No se pudo administrar el Orbe."), {
    reasonCode: response.reasonCode ?? "ORB_REQUEST_FAILED"
  });
  return response.result;
}

export function addActorOrb(actor, { type, level }) {
  return requestOrbChange("mtrolAddActorOrb", {
    actorUuid: actor.uuid,
    transactionId: createTransactionId("orb-add"),
    orbId: foundry.utils.randomID(),
    type,
    level,
    expectedOrbCount: Array.from(actor.system?.orbs ?? []).length
  }, actor, addActorOrbAuthoritative);
}

export function updateActorOrb(actor, orbId, { type, level }) {
  const current = Array.from(actor.system?.orbs ?? []).find(orb => orb.id === orbId);
  return requestOrbChange("mtrolUpdateActorOrb", {
    actorUuid: actor.uuid,
    transactionId: createTransactionId("orb-update"),
    orbId,
    type,
    level,
    expectedType: current?.type,
    expectedLevel: current?.level
  }, actor, updateActorOrbAuthoritative);
}

export function deleteActorOrb(actor, orbId) {
  const current = Array.from(actor.system?.orbs ?? []).find(orb => orb.id === orbId);
  return requestOrbChange("mtrolDeleteActorOrb", {
    actorUuid: actor.uuid,
    transactionId: createTransactionId("orb-delete"),
    orbId,
    expectedType: current?.type,
    expectedLevel: current?.level
  }, actor, deleteActorOrbAuthoritative);
}

export function resetOrbManagementServiceForTests() {
  actorQueues.clear();
  actorRuntimeRepository.resetForTests();
}
