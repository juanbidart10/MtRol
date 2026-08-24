// =========================
// MTROL - ACTOR RESOURCE SERVICE
// =========================
// Frontera interna de escritura para HP/MP mecánicos. Los payloads de socket
// se canonicalizan en sus engines; este módulo sólo acepta operaciones desde
// código que ya se está ejecutando en el cliente GM autoritativo.

const RESOURCE_ORIGINS = new Set([
  "damage",
  "mp-cost",
  "mp-refund",
  "meditate",
  "level-up",
  "pending-attribute",
  "pending-competence",
  "class-resource-update",
  "permanent-resource-update",
  "gm-resource-set"
]);

const MANUAL_SPIRITUAL_RESOURCES = new Set(["karma", "dharma"]);

const completedTransactions = new Map();
const actorResourceQueues = new Map();

function normalizeTransaction(actor, { transactionId, origin } = {}) {
  const actorUuid = String(actor?.uuid ?? "").trim();
  const normalizedTransactionId = String(transactionId ?? "").trim();

  if (!game.user?.isGM) {
    throw new Error("Solo un GM puede escribir recursos mecánicos autoritativamente.");
  }
  if (!actorUuid) throw new TypeError("Falta el Actor autoritativo.");
  if (!normalizedTransactionId) throw new TypeError("Falta transactionId.");
  if (!RESOURCE_ORIGINS.has(origin)) throw new TypeError("Origen de recurso inválido.");

  return {
    actorUuid,
    transactionId: normalizedTransactionId,
    origin,
    key: `${actorUuid}:${normalizedTransactionId}`
  };
}

async function withActorResourceLock(actorUuid, operation) {
  const previous = actorResourceQueues.get(actorUuid) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  actorResourceQueues.set(actorUuid, current);

  try {
    return await current;
  } finally {
    if (actorResourceQueues.get(actorUuid) === current) {
      actorResourceQueues.delete(actorUuid);
    }
  }
}

export async function runActorResourceTransaction(
  actor,
  transaction,
  operation
) {
  if (typeof operation !== "function") {
    throw new TypeError("Falta la operación autoritativa de recurso.");
  }

  const normalized = normalizeTransaction(actor, transaction);

  return withActorResourceLock(normalized.actorUuid, async () => {
    const existing = completedTransactions.get(normalized.key);

    if (existing) {
      if (existing.origin !== normalized.origin) {
        throw new Error("El transactionId ya fue utilizado por otra operación.");
      }

      return { ...existing, replayed: true };
    }

    const result = await operation(actor);
    const receipt = {
      ...(result ?? {}),
      actorUuid: normalized.actorUuid,
      transactionId: normalized.transactionId,
      origin: normalized.origin,
      replayed: false
    };

    completedTransactions.set(normalized.key, receipt);
    return receipt;
  });
}

export function getActorResourceTransaction(actorUuid, transactionId) {
  return completedTransactions.get(`${actorUuid}:${transactionId}`) ?? null;
}

export async function applyDamageToHpAuthoritative(actor, damage, {
  transactionId,
  updateOptions = {}
} = {}) {
  const amount = Number(damage);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new RangeError("El daño final debe ser un número no negativo.");
  }

  return runActorResourceTransaction(actor, {
    transactionId,
    origin: "damage"
  }, async canonicalActor => {
    const hpBefore = Number(canonicalActor.system?.vitales?.hp?.value ?? 0);
    const hpAfter = Math.max(0, hpBefore - amount);

    await canonicalActor.update({
      "system.vitales.hp.value": hpAfter
    }, updateOptions);

    return {
      amount,
      hpBefore,
      hpAfter
    };
  });
}

function createResourceTransactionId() {
  return foundry.utils.randomID?.() ?? crypto.randomUUID();
}

function getRequestingUser(userId) {
  if (typeof game.users?.get === "function") return game.users.get(userId);
  return Array.from(game.users ?? []).find(user => user.id === userId) ?? null;
}

async function getCanonicalActor(payload, trustedActor = null) {
  if (trustedActor?.uuid === payload.actorUuid) return trustedActor;
  return fromUuid(String(payload.actorUuid ?? ""));
}

export async function setActorSpiritualResourceAuthoritative(payload = {}, {
  requestingUserId = game.user?.id,
  trustedActor = null
} = {}) {
  const allowedKeys = new Set(["actorUuid", "transactionId", "resource", "value"]);
  const unexpected = Object.keys(payload).filter(key => !allowedKeys.has(key));
  if (unexpected.length > 0) {
    throw new Error(`Payload de recurso manual inválido: ${unexpected.join(", ")}.`);
  }

  const requestingUser = getRequestingUser(requestingUserId);
  if (!game.user?.isGM || !requestingUser?.isGM) {
    throw new Error("Sólo un GM puede fijar Karma o Dharma manualmente.");
  }

  const resource = String(payload.resource ?? "").trim().toLowerCase();
  if (!MANUAL_SPIRITUAL_RESOURCES.has(resource)) {
    throw new TypeError("El recurso manual debe ser karma o dharma.");
  }

  const value = Number(payload.value);
  if (!Number.isInteger(value) || value < 0 || value > 5) {
    throw new RangeError("Karma y Dharma deben ser enteros entre 0 y 5.");
  }

  const actor = await getCanonicalActor(payload, trustedActor);
  if (!actor) throw new Error("No se encontró el Actor autoritativo.");

  return runActorResourceTransaction(actor, {
    transactionId: payload.transactionId,
    origin: "gm-resource-set"
  }, async canonicalActor => {
    const valueBefore = Number(canonicalActor.system?.recursos?.[resource] ?? 0);

    await canonicalActor.update({
      [`system.recursos.${resource}`]: value
    }, { mtrolResourceOrigin: "gm-resource-set" });

    return {
      authorized: true,
      resource,
      valueBefore,
      valueAfter: value
    };
  });
}

export async function setActorSpiritualResource(actor, resource, value) {
  if (!game.user?.isGM) {
    throw new Error("Sólo un GM puede fijar Karma o Dharma manualmente.");
  }

  return setActorSpiritualResourceAuthoritative({
    actorUuid: actor?.uuid,
    transactionId: createResourceTransactionId(),
    resource,
    value
  }, {
    requestingUserId: game.user.id,
    trustedActor: actor
  });
}

export function resetActorResourceServiceForTests() {
  completedTransactions.clear();
  actorResourceQueues.clear();
}
