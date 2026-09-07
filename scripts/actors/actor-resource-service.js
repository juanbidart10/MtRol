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
  "daily-reset",
  "meditate",
  "level-up",
  "pending-attribute",
  "pending-competence",
  "class-resource-update",
  "race-identity-update",
  "race-creation-grant",
  "permanent-resource-update",
  "gm-resource-set",
  "destiny-adjust",
  "dharma-spend",
  "consumable",
  "passive-effect",
  "awakening-grant"
]);

const RESTORABLE_RESOURCES = new Set(["hp", "mp"]);

const MANUAL_SPIRITUAL_RESOURCES = new Set(["karma", "dharma"]);

const completedTransactions = new Map();
const actorResourceQueues = new Map();

import {
  actorRuntimeRepository,
  transactionCoordinator
} from "../runtime/runtime-foundation.js";

function normalizeTransaction(actor, {
  transactionId,
  origin,
  allowOwnerCompatibility = false,
  metadata = {}
} = {}) {
  const actorUuid = String(
    actor?.uuid ?? (allowOwnerCompatibility && !game.users ? `compat:${actor?.name ?? "actor"}` : "")
  ).trim();
  const normalizedTransactionId = String(transactionId ?? "").trim();

  if (!game.user?.isGM && !(allowOwnerCompatibility && !game.users && actor?.isOwner)) {
    throw new Error("Solo un GM puede escribir recursos mecánicos autoritativamente.");
  }
  if (!actorUuid) throw new TypeError("Falta el Actor autoritativo.");
  if (!normalizedTransactionId) throw new TypeError("Falta transactionId.");
  if (!RESOURCE_ORIGINS.has(origin)) throw new TypeError("Origen de recurso inválido.");

  return {
    actorUuid,
    transactionId: normalizedTransactionId,
    origin,
    metadata: { ...metadata },
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
    const scope = game.combat ? { combat: game.combat, actor } : { actor };
    const persisted = transactionCoordinator.get(scope, normalized.transactionId);
    if (persisted?.command && persisted.command !== `resource.${normalized.origin}`) {
      throw new Error("El transactionId ya fue utilizado por otra operación.");
    }
    const wasCompleted = persisted?.status === "completed";
    const receipt = await transactionCoordinator.execute(scope, {
      transactionId: normalized.transactionId,
      command: `resource.${normalized.origin}`,
      metadata: {
        actorUuid: normalized.actorUuid,
        origin: normalized.origin,
        ...normalized.metadata
      },
      apply: async ({ checkpoint }) => {
        let mutationStarted = false;
        const beforeWrite = async () => {
          if (mutationStarted) return;
          mutationStarted = true;
          await checkpoint("resource-write-intent", { actorUuid: normalized.actorUuid });
        };
        let result;
        try { result = await operation(actor, { beforeWrite }); }
        catch (error) {
          // Only audited internal callers opt in; never infer safety from a
          // missing checkpoint in an arbitrary operation callback.
          if (transaction.tracksWrites === true && !mutationStarted) error.transactionNoEffects = true;
          throw error;
        }
        await checkpoint("resource-applied", result ?? {});
        return {
          ...(result ?? {}),
          actorUuid: normalized.actorUuid,
          transactionId: normalized.transactionId,
          origin: normalized.origin,
          replayed: false
        };
      },
      reconcile: async persistedReceipt => {
        const applied = persistedReceipt.checkpoints?.["resource-applied"];
        if (!applied) return { resolved: false };
        return { resolved: true, result: persistedReceipt.result ?? {
          ...applied,
          actorUuid: normalized.actorUuid,
          transactionId: normalized.transactionId,
          origin: normalized.origin,
          replayed: true
        } };
      }
    });
    const normalizedReceipt = { ...receipt, replayed: wasCompleted };
    completedTransactions.set(normalized.key, normalizedReceipt);
    return normalizedReceipt;
  });
}

export function getActorResourceTransaction(actorUuid, transactionId) {
  const cached = completedTransactions.get(`${actorUuid}:${transactionId}`);
  if (cached) return cached;
  const actorId = String(actorUuid ?? "").split(".").at(-1);
  const actor = game.actors?.get?.(actorId) ?? null;
  if (!actor) return null;
  const scope = game.combat ? { combat: game.combat } : { actor };
  return transactionCoordinator.get(scope, transactionId)?.result ?? null;
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
    origin: "damage",
    tracksWrites: true
  }, async (canonicalActor, { beforeWrite }) => {
    const hpBefore = Number(canonicalActor.system?.vitales?.hp?.value ?? 0);
    const hpAfter = Math.max(0, hpBefore - amount);

    await beforeWrite();

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

export async function restoreActorResourceAuthoritative(actor, resource, amount, {
  transactionId,
  origin = "consumable",
  parentTransactionId = null,
  commit = null,
  updateOptions = {}
} = {}) {
  const normalizedResource = String(resource ?? "").trim().toLowerCase();
  const normalizedAmount = Number(amount);

  if (!RESTORABLE_RESOURCES.has(normalizedResource)) {
    throw new TypeError("El recurso restaurable debe ser hp o mp.");
  }
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    throw new RangeError("La restauración debe ser un número positivo.");
  }
  if (commit !== null && typeof commit !== "function") {
    throw new TypeError("El commit posterior a la restauración debe ser una función.");
  }

  return runActorResourceTransaction(actor, {
    transactionId,
    origin,
    metadata: { parentTransactionId },
    tracksWrites: true
  }, async (canonicalActor, { beforeWrite }) => {
    const resourceData = canonicalActor.system?.vitales?.[normalizedResource];
    const before = Number(resourceData?.value);
    const max = Number(resourceData?.max);

    if (!Number.isFinite(before) || !Number.isFinite(max) || max < 0) {
      throw new TypeError("El Actor no posee un recurso restaurable válido.");
    }

    const after = Math.min(before + normalizedAmount, max);
    const restored = Math.max(0, after - before);
    const overflow = Math.max(0, normalizedAmount - restored);
    const resourcePath = `system.vitales.${normalizedResource}.value`;
    const result = {
      resource: normalizedResource,
      amount: normalizedAmount,
      before,
      max,
      after,
      restored,
      overflow
    };

    if (restored <= 0) {
      return { ...result, changed: false, consumed: false };
    }

    await beforeWrite();

    await canonicalActor.update({ [resourcePath]: after }, updateOptions);

    try {
      const commitResult = commit ? await commit(result) : null;
      return {
        ...result,
        ...(commitResult ?? {})
      };
    } catch (error) {
      // A failed inventory ACK is not proof that the item was untouched. Only
      // certified pre-write rejection permits compensation of our HP/MP write.
      if (error.transactionNoEffects !== true || Number(canonicalActor.system?.vitales?.[normalizedResource]?.value) !== after) throw error;
      try {
        await canonicalActor.update({
          [resourcePath]: before
        }, {
          ...updateOptions,
          mtrolConsumableRollback: true
        });
        error.transactionRolledBack = Number(canonicalActor.system?.vitales?.[normalizedResource]?.value) === before;
      } catch (rollbackError) {
        error.rollbackError = rollbackError;
      }
      throw error;
    }
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
    origin: "gm-resource-set",
    tracksWrites: true
  }, async (canonicalActor, { beforeWrite }) => {
    const valueBefore = Number(canonicalActor.system?.recursos?.[resource] ?? 0);

    await beforeWrite();

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
  actorRuntimeRepository.resetForTests();
}
