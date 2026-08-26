import {
  restoreActorResourceAuthoritative
} from "../actors/actor-resource-service.js";

import {
  requestPrimaryGM
} from "../core/socket-requests.js";

import {
  analyzeItemQuantity,
  getDocumentById,
  isMtrolObject
} from "./item-invariants.js";

import {
  destroyEquippedItem
} from "./item-destruction-engine.js";

import {
  createConsumableChatCard
} from "../ui/consumable-chat-card.js";

const CONSUMABLE_OPERATIONS = new Set(["restore"]);
const CONSUMABLE_RESOURCES = new Set(["hp", "mp"]);
const authoritativeUsesInProgress = new Map();
const clientUsesInProgress = new Map();
const completedUses = new Map();

function createTransactionId() {
  return foundry.utils.randomID?.() ?? crypto.randomUUID();
}

function getUseKey(actor, item) {
  return `${actor?.uuid ?? actor?.id ?? "actor"}:${item?.id ?? "item"}`;
}

function getUser(userId) {
  if (typeof game.users?.get === "function") return game.users.get(userId);
  return Array.from(game.users ?? []).find(user => user.id === userId) ?? null;
}

function getCanonicalItem(actor, itemId) {
  return getDocumentById(actor?.items, String(itemId ?? "").trim());
}

export function canUserUseConsumable(actor, user = globalThis.game?.user) {
  if (!actor || !user) return false;
  if (user.isGM === true) return true;
  if (typeof actor.testUserPermission === "function") {
    return actor.testUserPermission(user, "OWNER") === true;
  }
  return actor.isOwner === true;
}

export function getConsumableConfiguration(item) {
  const operation = String(item?.system?.consumible?.operacion ?? "")
    .trim()
    .toLowerCase();
  const resource = String(item?.system?.consumible?.recurso ?? "")
    .trim()
    .toLowerCase();
  const amount = Number(item?.system?.consumible?.valor);
  const quantity = analyzeItemQuantity(item);
  const errors = [];

  if (!isMtrolObject(item)) errors.push("El documento no es un objeto MTROL.");
  if (String(item?.system?.tipoObjeto ?? "").trim().toLowerCase() !== "consumible") {
    errors.push("El objeto no está marcado como consumible.");
  }
  if (!CONSUMABLE_OPERATIONS.has(operation)) {
    errors.push("La operación del consumible no es válida.");
  }
  if (!CONSUMABLE_RESOURCES.has(resource)) {
    errors.push("El recurso del consumible no es válido.");
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    errors.push("El valor del consumible debe ser positivo.");
  }
  if (
    quantity.existence === "absent" ||
    !quantity.valid ||
    !Number.isInteger(quantity.normalized) ||
    quantity.normalized <= 0
  ) {
    errors.push("El consumible no posee una cantidad válida disponible.");
  }

  return {
    valid: errors.length === 0,
    errors,
    effect: { operation, resource, amount },
    quantity: quantity.normalized
  };
}

function validateConsumableUse(actor, item, user) {
  if (!actor) throw new Error("No se encontró el Actor propietario del consumible.");
  if (!canUserUseConsumable(actor, user)) {
    throw new Error("El usuario no posee OWNER sobre el Actor del consumible.");
  }

  const actorItem = getCanonicalItem(actor, item?.id);
  if (!actorItem || actorItem !== item) {
    throw new Error("El consumible no pertenece al inventario del Actor.");
  }

  const configuration = getConsumableConfiguration(actorItem);
  if (!configuration.valid) throw new Error(configuration.errors[0]);
  return configuration;
}

async function consumeOneUnit(actor, item, expectedConfiguration) {
  const currentItem = getCanonicalItem(actor, item.id);
  if (!currentItem || currentItem !== item) {
    throw new Error("El consumible dejó de existir antes de completar el uso.");
  }

  const currentConfiguration = getConsumableConfiguration(currentItem);
  if (!currentConfiguration.valid) {
    throw new Error(currentConfiguration.errors[0]);
  }
  if (
    currentConfiguration.effect.operation !== expectedConfiguration.effect.operation ||
    currentConfiguration.effect.resource !== expectedConfiguration.effect.resource ||
    currentConfiguration.effect.amount !== expectedConfiguration.effect.amount
  ) {
    throw new Error("La configuración del consumible cambió durante el uso.");
  }

  const remainingQuantity = currentConfiguration.quantity - 1;
  if (remainingQuantity === 0) {
    await destroyEquippedItem({
      actor,
      item: currentItem,
      reason: "última unidad consumida",
      createChatMessage: false
    });
  } else {
    await currentItem.update({
      "system.cantidad": remainingQuantity
    });
  }

  return {
    remainingQuantity,
    itemDeleted: remainingQuantity === 0
  };
}

async function useConsumableAuthoritativeInternal(payload, {
  requestingUserId,
  trustedActor = null,
  trustedItem = null
} = {}) {
  const allowedKeys = new Set(["actorUuid", "itemId", "transactionId"]);
  const unexpected = Object.keys(payload ?? {}).filter(key => !allowedKeys.has(key));
  if (unexpected.length > 0) {
    throw new Error(`Payload de consumible inválido: ${unexpected.join(", ")}.`);
  }
  if (!game.user?.isGM) {
    throw new Error("Solo un GM puede resolver consumibles autoritativamente.");
  }

  const actorUuid = String(payload?.actorUuid ?? "").trim();
  const itemId = String(payload?.itemId ?? "").trim();
  const transactionId = String(payload?.transactionId ?? "").trim();
  if (!actorUuid || !itemId || !transactionId) {
    throw new Error("La solicitud de consumible está incompleta.");
  }

  const actor = trustedActor?.uuid === actorUuid
    ? trustedActor
    : await fromUuid(actorUuid);
  if (!actor) throw new Error("No se encontró el Actor autoritativo.");

  const user = getUser(requestingUserId);
  if (!user) throw new Error("No se encontró el usuario solicitante.");

  const item = trustedItem?.id === itemId && trustedItem?.parent === actor
    ? trustedItem
    : getCanonicalItem(actor, itemId);
  const configuration = validateConsumableUse(actor, item, user);
  const actorName = String(actor.name ?? "Actor");
  const itemName = String(item.name ?? "Consumible");
  const itemImg = String(item.img ?? "icons/svg/item-bag.svg");

  const resourceResult = await restoreActorResourceAuthoritative(
    actor,
    configuration.effect.resource,
    configuration.effect.amount,
    {
      transactionId,
      updateOptions: { mtrolResourceOrigin: "consumable" },
      commit: async () => consumeOneUnit(actor, item, configuration)
    }
  );

  const result = {
    ...resourceResult,
    actorId: actor.id ?? null,
    actorUuid: actor.uuid,
    actorName,
    itemId,
    itemName,
    itemImg,
    operation: configuration.effect.operation
  };

  const message = await createConsumableChatCard(actor, result);
  return {
    ...result,
    cardMessageId: message?.id ?? null
  };
}

export async function useConsumableAuthoritative(payload = {}, options = {}) {
  const actorUuid = String(payload?.actorUuid ?? "").trim();
  const transactionId = String(payload?.transactionId ?? "").trim();
  const transactionKey = `${actorUuid}:${transactionId}`;
  if (completedUses.has(transactionKey)) return completedUses.get(transactionKey);

  const actor = options.trustedActor?.uuid === actorUuid
    ? options.trustedActor
    : await fromUuid(actorUuid);
  const item = options.trustedItem?.id === payload?.itemId
    ? options.trustedItem
    : getCanonicalItem(actor, payload?.itemId);
  const useKey = getUseKey(actor, item ?? { id: payload?.itemId });
  if (authoritativeUsesInProgress.has(useKey)) {
    return authoritativeUsesInProgress.get(useKey);
  }

  const operation = useConsumableAuthoritativeInternal(payload, {
    ...options,
    trustedActor: actor,
    trustedItem: item
  }).then(result => {
    completedUses.set(transactionKey, result);
    return result;
  }).finally(() => {
    authoritativeUsesInProgress.delete(useKey);
  });

  authoritativeUsesInProgress.set(useKey, operation);
  return operation;
}

export async function useConsumable(actor, item) {
  const user = globalThis.game?.user;
  validateConsumableUse(actor, item, user);
  const useKey = getUseKey(actor, item);
  if (clientUsesInProgress.has(useKey)) return clientUsesInProgress.get(useKey);

  const payload = {
    actorUuid: actor.uuid,
    itemId: item.id,
    transactionId: createTransactionId()
  };

  const operation = (async () => {
    if (user?.isGM) {
      return useConsumableAuthoritative(payload, {
        requestingUserId: user.id,
        trustedActor: actor,
        trustedItem: item
      });
    }

    const response = await requestPrimaryGM("mtrolUseConsumable", payload);
    if (!response.ok) throw new Error(response.error ?? "No se pudo usar el consumible.");
    return response.result?.receipt ?? null;
  })().finally(() => {
    clientUsesInProgress.delete(useKey);
  });

  clientUsesInProgress.set(useKey, operation);
  return operation;
}

export function resetConsumableServiceForTests() {
  authoritativeUsesInProgress.clear();
  clientUsesInProgress.clear();
  completedUses.clear();
}
