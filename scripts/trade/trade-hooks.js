import {
  reconcileTradeAuthority
} from "./trade-authority.js";

import {
  configureTradeRuntimeApi,
  registerTradeRuntimeHooks
} from "./trade-runtime.js";

import {
  configureTradeGMRuntimeApi,
  registerTradeGMRuntimeHooks
} from "./trade-gm-runtime.js";

import {
  configureTradeProximityApi,
  getRuntimeTradeLock,
  isTokenMovement,
  tradeMovementLocks
} from "./trade-proximity-service.js";

import { tradeClientApi } from "./trade-api.js";

import {
  isPrimaryActiveGM
} from "../core/socket-requests.js";

import {
  handleTradeActorDeleted,
  handleTradeItemMutation,
  handleTradeTokenDeleted,
  handleTradeUserConnection
} from "./trade-lifecycle-service.js";
import {
  preUpdateItemDispatcher,
  preUpdateTokenDispatcher,
  updateItemDispatcher,
  updateTokenDispatcher
} from "../core/hook-dispatcher.js";
import { getTradeReservedQuantity } from "./trade-reservation-boundary.js";
import { logger } from "../utils/logger.js";

let registered = false;

function userIsGM(userId) {
  return game.users?.get?.(String(userId ?? ""))?.isGM === true;
}

function hasMovementFields(changes) {
  return ["x", "y", "elevation"].some(key =>
    Object.prototype.hasOwnProperty.call(changes ?? {}, key)
  );
}

export function preventLockedTradeTokenMovement(tokenDocument, changes, userId) {
  if (!isTokenMovement(tokenDocument, changes) || userIsGM(userId)) return true;
  const lock = getRuntimeTradeLock(tokenDocument?.uuid);
  if (!lock) return true;
  if (game.user?.id === userId) {
    ui.notifications.warn("El Token no puede moverse mientras el comercio está activo.");
  }
  return false;
}

export async function enforceTradeTokenMovementAuthoritative(tokenDocument, changes, options, userId) {
  if (!game.user?.isGM || !isPrimaryActiveGM()) return false;
  if (options?.mtrolTradeMovementRevert || !hasMovementFields(changes)) return false;
  const lock = tradeMovementLocks.getLock(tokenDocument?.uuid);
  if (!lock) return false;
  if (userIsGM(userId)) {
    tradeMovementLocks.updateAuthorizedPosition(tokenDocument.uuid, tokenDocument);
    return false;
  }
  await tokenDocument.update(lock.position, {
    render: false,
    mtrolTradeMovementRevert: true
  });
  return true;
}

function isTradeMutation(options = {}) {
  return Boolean(options.mtrolTradeExecutionId || options.mtrolTradeRollback);
}

export function preventReservedTradeItemMutation(item, changes = {}, options = {}) {
  if (isTradeMutation(options)) return true;
  const actorUuid = item?.parent?.uuid ?? item?.actor?.uuid ?? null;
  if (!actorUuid) return true;
  const itemReference = {
    itemUuid: item?.uuid ?? null,
    itemId: item?.id ?? null
  };
  const reserved = getTradeReservedQuantity(actorUuid, itemReference);
  if (reserved <= 0) return true;
  const equipped = changes["system.equipado"] ?? changes.system?.equipado;
  if (equipped === true) return false;
  const quantity = changes["system.cantidad"] ?? changes.system?.cantidad;
  if (quantity !== undefined && Number(quantity) < reserved) return false;
  return true;
}

export function preventReservedTradeItemDeletion(item, options = {}) {
  if (isTradeMutation(options)) return true;
  const actorUuid = item?.parent?.uuid ?? item?.actor?.uuid ?? null;
  const itemReference = {
    itemUuid: item?.uuid ?? null,
    itemId: item?.id ?? null
  };
  return !actorUuid || getTradeReservedQuantity(actorUuid, itemReference) <= 0;
}

export function registerTradeLifecycleHooks() {
  if (registered) return;
  registered = true;
  configureTradeRuntimeApi(tradeClientApi);
  configureTradeGMRuntimeApi(tradeClientApi);
  configureTradeProximityApi(tradeClientApi);
  registerTradeRuntimeHooks();
  registerTradeGMRuntimeHooks();

  Hooks.on("userConnected", (user, connected) => {
    handleTradeUserConnection(user, connected)
      .catch(error => logger.error("TRADE", "trade disconnect adapter failed", {
        userId: user?.id ?? null,
        error: error.message
      }));
    reconcileTradeAuthority().catch(error => logger.error("AUTHORITY", "trade authority reconciliation failed", {
      error: error.message
    }));
  });

  preUpdateItemDispatcher.subscribe("trade.reservation-guard", preventReservedTradeItemMutation, {
    priority: 5,
    critical: true
  });
  updateItemDispatcher.subscribe("trade.item-reconcile", (item, _changes, options) =>
    handleTradeItemMutation(item, { options }), {
    priority: 50,
    critical: false
  });

  Hooks.on("deleteItem", (item, options) => {
    handleTradeItemMutation(item, { deleted: true, options })
      .catch(error => logger.error("TRADE", "deleted trade Item reconciliation failed", {
        itemUuid: item?.uuid ?? null,
        error: error.message
      }));
  });

  Hooks.on("preDeleteItem", preventReservedTradeItemDeletion);

  Hooks.on("deleteActor", actor => {
    handleTradeActorDeleted(actor)
      .catch(error => logger.error("TRADE", "deleted trade Actor reconciliation failed", {
        actorUuid: actor?.uuid ?? null,
        error: error.message
      }));
  });

  Hooks.on("deleteToken", token => {
    handleTradeTokenDeleted(token)
      .catch(error => logger.error("TRADE", "deleted trade Token reconciliation failed", {
        tokenUuid: token?.uuid ?? null,
        error: error.message
      }));
  });

  preUpdateTokenDispatcher.subscribe("trade.movement-lock", (tokenDocument, changes, _options, userId) =>
    preventLockedTradeTokenMovement(tokenDocument, changes, userId), {
    priority: 15,
    critical: true
  });
  updateTokenDispatcher.subscribe("trade.movement-reconcile", async (...args) =>
    !(await enforceTradeTokenMovementAuthoritative(...args)), {
    priority: 15,
    critical: true
  });
}
