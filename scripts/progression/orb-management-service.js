import {
  getOrbDefinition,
  MTROL_ORB_IDS
} from "./orb-registry.js";

const completedTransactions = new Map();
const actorQueues = new Map();

function assertExactKeys(payload, allowed) {
  for (const key of Object.keys(payload ?? {})) {
    if (!allowed.has(key)) throw new Error(`Campo de Orbe no permitido: ${key}.`);
  }
}

function getRequestingUser(userId) {
  return game.users?.get?.(userId) ??
    Array.from(game.users ?? []).find(user => user.id === userId) ??
    null;
}

function assertGM(requestingUserId) {
  const user = getRequestingUser(requestingUserId);
  if (!user?.isGM) throw new Error("Sólo un GM puede administrar Orbes.");
}

async function getCanonicalActor(payload, trustedActor) {
  if (trustedActor?.uuid === payload.actorUuid) return trustedActor;
  return payload.actorUuid ? fromUuid(payload.actorUuid) : null;
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
  const key = `${actor.uuid}:${transactionId}`;

  return withActorLock(actor.uuid, async () => {
    const previous = completedTransactions.get(key);
    if (previous) {
      if (previous.operation !== operationName) {
        throw new Error("El transactionId ya fue utilizado por otra operación de Orbes.");
      }
      return { ...previous, replayed: true };
    }

    const result = await operation();
    const receipt = {
      ...result,
      operation: operationName,
      actorUuid: actor.uuid,
      transactionId,
      replayed: false
    };
    completedTransactions.set(key, receipt);
    return receipt;
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
    await actor.update({ "system.orbs": [...orbs, orb] });
    return { orb };
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
    await actor.update({ "system.orbs": orbs });
    return { orb };
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
    await actor.update({ "system.orbs": orbs });
    return { orb };
  });
}

function createTransactionId(prefix) {
  return `${prefix}-${foundry.utils.randomID()}`;
}

export function addActorOrb(actor, { type, level }) {
  return addActorOrbAuthoritative({
    actorUuid: actor.uuid,
    transactionId: createTransactionId("orb-add"),
    orbId: foundry.utils.randomID(),
    type,
    level,
    expectedOrbCount: Array.from(actor.system?.orbs ?? []).length
  }, { requestingUserId: game.user?.id, trustedActor: actor });
}

export function updateActorOrb(actor, orbId, { type, level }) {
  const current = Array.from(actor.system?.orbs ?? []).find(orb => orb.id === orbId);
  return updateActorOrbAuthoritative({
    actorUuid: actor.uuid,
    transactionId: createTransactionId("orb-update"),
    orbId,
    type,
    level,
    expectedType: current?.type,
    expectedLevel: current?.level
  }, { requestingUserId: game.user?.id, trustedActor: actor });
}

export function deleteActorOrb(actor, orbId) {
  const current = Array.from(actor.system?.orbs ?? []).find(orb => orb.id === orbId);
  return deleteActorOrbAuthoritative({
    actorUuid: actor.uuid,
    transactionId: createTransactionId("orb-delete"),
    orbId,
    expectedType: current?.type,
    expectedLevel: current?.level
  }, { requestingUserId: game.user?.id, trustedActor: actor });
}

export function resetOrbManagementServiceForTests() {
  completedTransactions.clear();
  actorQueues.clear();
}
