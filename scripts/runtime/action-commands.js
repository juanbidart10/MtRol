import {
  createReadyDamageActionAuthoritative,
  getPendingAction,
  serializePendingAction
} from "../actions/action-engine.js";
import {
  cancelResolvedDamageAuthoritative,
  executeResolvedDamageAuthoritative
} from "../actions/action-damage-engine.js";
import { commandRegistry } from "./runtime-foundation.js";
import { authorityService } from "../core/authority-service.js";

const SOCKET_COMMANDS = Object.freeze({
  mtrolCreateReadyDamageAction: "action.ready-damage-create",
  mtrolExecuteResolvedDamage: "action.resolved-damage-execute",
  mtrolCancelResolvedDamage: "action.resolved-damage-cancel"
});
const SERVICES = Object.freeze({
  createReady: createReadyDamageActionAuthoritative,
  executeDamage: executeResolvedDamageAuthoritative,
  cancelDamage: cancelResolvedDamageAuthoritative,
  getPending: getPendingAction,
  serialize: serializePendingAction
});

/** Wire projection formerly in sockets.js. Preserve the public response exactly. */
export function serializeResolvedDamageResult(result) {
  return {
    success: result?.success === true,
    fumble: result?.fumble === true,
    totalBaseDanio: Number(result?.totalBaseDanio ?? 0),
    totalFinalDanio: Number(result?.totalFinalDanio ?? 0),
    resultadoDanio: result?.resultadoDanio
      ? {
          numeroLocalizacion: Number(result.resultadoDanio.numeroLocalizacion ?? 0),
          slot: result.resultadoDanio.slot ?? null,
          zona: result.resultadoDanio.zona ?? null,
          item: result.resultadoDanio.item ?? null,
          defensaInicial: Number(result.resultadoDanio.defensaInicial ?? 0),
          defensaFinal: Number(result.resultadoDanio.defensaFinal ?? 0),
          danioOriginal: Number(result.resultadoDanio.danioOriginal ?? 0),
          danioAbsorbido: Number(result.resultadoDanio.danioAbsorbido ?? 0),
          hpPerdido: Number(result.resultadoDanio.hpPerdido ?? 0),
          hpAnterior: Number(result.resultadoDanio.hpAnterior ?? 0),
          hpNuevo: Number(result.resultadoDanio.hpNuevo ?? 0),
          itemDestruido: result.resultadoDanio.itemDestruido === true,
          aplicacion: result.resultadoDanio.aplicacion ?? null
        }
      : null
  };
}

export function registerActionCommands(registry = commandRegistry, services = SERVICES) {
  // Domain keeps its existing Combat lookup, guards and damage/resource receipts.
  // Routing cleanup does not add a second idempotency layer or change roll timing.
  const options = { scope: "world", idempotent: false };
  if (!registry.has("action.ready-damage-create")) {
    registry.register("action.ready-damage-create", async (payload, context) => ({
      pendingAction: services.serialize(await services.createReady(payload.pendingAction ?? {}, {
        requestingUserId: context.requestingUserId
      }))
    }), options);
  }
  if (!registry.has("action.resolved-damage-execute")) {
    registry.register("action.resolved-damage-execute", async (payload, context) => {
      const result = await services.executeDamage(payload.pendingActionId, {
        requestingUserId: context.requestingUserId
      });
      return {
        pendingAction: services.serialize(services.getPending(payload.pendingActionId)),
        damageResult: serializeResolvedDamageResult(result)
      };
    }, options);
  }
  if (typeof services.cancelDamage === "function" && !registry.has("action.resolved-damage-cancel")) {
    registry.register("action.resolved-damage-cancel", async (payload, context) => ({
      pendingAction: services.serialize(await services.cancelDamage(payload.pendingActionId, {
        requestingUserId: context.requestingUserId
      }))
    }), options);
  }
  return registry;
}

export function getActionCommandForSocketAction(action) {
  return Object.hasOwn(SOCKET_COMMANDS, action) ? SOCKET_COMMANDS[action] : null;
}

export async function dispatchActionSocketCommand(request = {}) {
  const command = getActionCommandForSocketAction(request.action);
  if (!command) return { handled: false, result: null };
  registerActionCommands();
  const payload = request.payload ?? {};
  const result = await commandRegistry.dispatch({
    command,
    transactionId: request.transactionId ?? payload.transactionId ?? request.requestId,
    payload
  }, {
    requestingUserId: request.requestingUserId,
    isPrimaryGM: authorityService.isPrimaryGM()
  });
  return { handled: true, result };
}
