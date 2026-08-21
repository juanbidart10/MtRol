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
  "pending-competence"
]);

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

export function resetActorResourceServiceForTests() {
  completedTransactions.clear();
  actorResourceQueues.clear();
}
