import {
  reconcileTradeAuthority
} from "./trade-authority.js";

import {
  registerTradeRuntimeHooks
} from "./trade-runtime.js";

import {
  getRuntimeTradeLock,
  isTokenMovement,
  tradeMovementLocks
} from "./trade-proximity-service.js";

import {
  isPrimaryActiveGM
} from "../core/socket-requests.js";

import {
  handleTradeActorDeleted,
  handleTradeItemMutation,
  handleTradeTokenDeleted,
  handleTradeUserConnection
} from "./trade-lifecycle-service.js";

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

export function registerTradeLifecycleHooks() {
  if (registered) return;
  registered = true;
  registerTradeRuntimeHooks();

  Hooks.on("userConnected", (user, connected) => {
    handleTradeUserConnection(user, connected)
      .catch(error => console.error("MTROL | Error de desconexión en comercio:", error));
    reconcileTradeAuthority();
  });

  Hooks.on("updateItem", (item, _changes, options) => {
    handleTradeItemMutation(item, { options })
      .catch(error => console.error("MTROL | Error al reconciliar Item ofertado:", error));
  });

  Hooks.on("deleteItem", (item, options) => {
    handleTradeItemMutation(item, { deleted: true, options })
      .catch(error => console.error("MTROL | Error al retirar Item eliminado de comercio:", error));
  });

  Hooks.on("deleteActor", actor => {
    handleTradeActorDeleted(actor)
      .catch(error => console.error("MTROL | Error al limpiar comercio por Actor eliminado:", error));
  });

  Hooks.on("deleteToken", token => {
    handleTradeTokenDeleted(token)
      .catch(error => console.error("MTROL | Error al limpiar comercio por Token eliminado:", error));
  });

  Hooks.on("preUpdateToken", (tokenDocument, changes, _options, userId) =>
    preventLockedTradeTokenMovement(tokenDocument, changes, userId)
  );

  Hooks.on("updateToken", (tokenDocument, changes, options, userId) => {
    enforceTradeTokenMovementAuthoritative(tokenDocument, changes, options, userId)
      .catch(error => console.error("MTROL | No se pudo revertir movimiento de comercio:", error));
  });
}
