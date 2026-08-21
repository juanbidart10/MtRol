import {
  MTROL_DHARMA_MAX,
  MTROL_DHARMA_MIN
} from "./dharma-engine.js";

import {
  isPrimaryActiveGM,
  requestPrimaryGM
} from "../core/socket-requests.js";

const consumedTransactions = new Map();
const actorConsumptionQueues = new Map();

function getUser(userId) {
  if (typeof game.users?.get === "function") {
    return game.users.get(userId);
  }

  return Array.from(game.users ?? [])
    .find(user => user.id === userId) ?? null;
}

function userCanSpendActorDharma(actor, userId) {
  const user = getUser(userId);
  if (!user || !actor) return false;
  if (user.isGM) return true;
  return actor.testUserPermission?.(user, "OWNER") === true;
}

function normalizePayload(payload = {}) {
  const actorUuid = String(payload.actorUuid ?? "").trim();
  const transactionId = String(payload.transactionId ?? "").trim();
  const cost = Number(payload.cost);
  const selectedIds = Array.from(payload.selectedIds ?? [])
    .map(value => String(value));
  const uniqueSelectedIds = new Set(selectedIds);

  if (!actorUuid) throw new TypeError("Falta actorUuid para consumir Dharma.");
  if (!transactionId) throw new TypeError("Falta transactionId para consumir Dharma.");

  if (
    !Number.isInteger(cost) ||
    cost < 1 ||
    cost > MTROL_DHARMA_MAX
  ) {
    throw new RangeError(`El costo debe estar entre 1 y ${MTROL_DHARMA_MAX}.`);
  }

  if (
    selectedIds.length !== cost ||
    uniqueSelectedIds.size !== cost
  ) {
    throw new TypeError("El costo no coincide con los dados seleccionados.");
  }

  return {
    actorUuid,
    transactionId,
    cost,
    selectedIds: Array.from(uniqueSelectedIds).sort()
  };
}

function getTransactionKey(payload) {
  return `${payload.actorUuid}:${payload.transactionId}`;
}

function assertReceiptMatches(receipt, payload) {
  const sameSelection =
    JSON.stringify(receipt.selectedIds) ===
    JSON.stringify(payload.selectedIds);

  if (
    receipt.actorUuid !== payload.actorUuid ||
    receipt.transactionId !== payload.transactionId ||
    receipt.cost !== payload.cost ||
    !sameSelection
  ) {
    throw new Error(
      "El transactionId ya fue utilizado con un consumo de Dharma diferente."
    );
  }
}

async function withActorConsumptionLock(actorUuid, operation) {
  const previous =
    actorConsumptionQueues.get(actorUuid) ?? Promise.resolve();

  const current = previous
    .catch(() => {})
    .then(operation);

  actorConsumptionQueues.set(actorUuid, current);

  try {
    return await current;
  } finally {
    if (actorConsumptionQueues.get(actorUuid) === current) {
      actorConsumptionQueues.delete(actorUuid);
    }
  }
}

export async function consumeDharmaSpendAuthoritative(
  payload,
  {
    requestingUserId = game.user?.id
  } = {}
) {
  if (!game.user?.isGM || !isPrimaryActiveGM()) {
    throw new Error("Solo el GM primario puede consumir Dharma autoritativamente.");
  }

  const normalized = normalizePayload(payload);
  const key = getTransactionKey(normalized);

  return withActorConsumptionLock(normalized.actorUuid, async () => {
    const existing = consumedTransactions.get(key);

    if (existing) {
      assertReceiptMatches(existing, normalized);
      return {
        ...existing,
        replayed: true
      };
    }

    const actor = await fromUuid(normalized.actorUuid);

    if (!actor) {
      throw new Error("No se encontro el Actor que debe consumir Dharma.");
    }

    if (!userCanSpendActorDharma(actor, requestingUserId)) {
      throw new Error("El usuario no puede gastar Dharma de este Actor.");
    }

    const balanceBefore =
      Number(actor.system?.recursos?.dharma);

    if (
      !Number.isInteger(balanceBefore) ||
      balanceBefore < MTROL_DHARMA_MIN ||
      balanceBefore > MTROL_DHARMA_MAX
    ) {
      throw new Error("El saldo de Dharma del Actor es invalido.");
    }

    if (balanceBefore < normalized.cost) {
      throw new Error(
        `Dharma insuficiente: disponible ${balanceBefore}, requerido ${normalized.cost}.`
      );
    }

    const balanceAfter =
      balanceBefore - normalized.cost;

    await actor.update({
      "system.recursos.dharma": balanceAfter
    });

    const receipt = {
      authorized: true,
      replayed: false,
      actorUuid: normalized.actorUuid,
      transactionId: normalized.transactionId,
      selectedIds: normalized.selectedIds,
      cost: normalized.cost,
      balanceBefore,
      balanceAfter
    };

    consumedTransactions.set(key, receipt);
    return receipt;
  });
}

export async function consumeDharmaSpend(actor, context) {
  if (!actor || context?.enabled !== true || context?.state !== "prepared") {
    throw new TypeError("No existe un consumo de Dharma preparado.");
  }

  if (actor.uuid !== context.actorUuid) {
    throw new TypeError("El contexto de Dharma pertenece a otro Actor.");
  }

  const payload = {
    actorUuid: context.actorUuid,
    transactionId: context.transactionId,
    selectedIds: context.selectedIds,
    cost: context.cost
  };

  if (game.user?.isGM && isPrimaryActiveGM()) {
    return consumeDharmaSpendAuthoritative(payload, {
      requestingUserId: game.user.id
    });
  }

  const response =
    await requestPrimaryGM("mtrolConsumeDharma", payload);

  if (!response.ok) {
    throw new Error(
      response.error ?? "No se pudo consumir Dharma."
    );
  }

  return response.result?.receipt;
}

export function resetDharmaConsumptionStateForTests() {
  consumedTransactions.clear();
  actorConsumptionQueues.clear();
}
