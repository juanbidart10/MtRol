import { isPrimaryActiveGM } from "../core/socket-requests.js";
import { commandRegistry } from "./runtime-foundation.js";

const SOCKET_COMMANDS = Object.freeze({
  mtrolCreatePendingAction: "opposition.create",
  mtrolAttachDefenseRoll: "opposition.respond",
  mtrolDeclareOppositionResponse: "opposition.declare-response",
  mtrolResolvePendingAction: "opposition.resolve",
  mtrolClearPendingAction: "opposition.cancel",
  mtrolRequestPendingActionsForActor: "opposition.list",
  mtrolCompleteReactionMovement: "opposition.reaction-complete"
});

let registered = false;
let actionOperations = null;

export function configureOppositionActionOperations(operations = {}) {
  const required = [
    "attachDefenseRollAuthoritative",
    "clearPendingActionAuthoritative",
    "completeReactionMovementAuthoritative",
    "createPendingActionAuthoritative",
    "declareOppositionResponseAuthoritative",
    "getPendingAction",
    "requestPendingActionsForActor",
    "resolvePendingActionAuthoritative",
    "serializePendingAction"
  ];
  for (const name of required) {
    if (typeof operations[name] !== "function") {
      throw new TypeError(`Opposition Commands requiere la operación ${name}.`);
    }
  }
  actionOperations = Object.freeze({ ...operations });
}

function actions() {
  if (!actionOperations) {
    throw new Error("Opposition Commands no fue integrado con Action Engine.");
  }
  return actionOperations;
}

function assertUserExists(_payload, context) {
  if (!game.users?.get?.(context.requestingUserId)) {
    throw new Error("El usuario solicitante no existe o ya no esta conectado al mundo.");
  }
}

export function registerOppositionCommands() {
  if (registered) return commandRegistry;
  registered = true;

  commandRegistry.register("opposition.create", async (payload, context, envelope) => {
    const pendingAction = await actions().createPendingActionAuthoritative(
      payload.pendingAction ?? {},
      {
        requestingUserId: context.requestingUserId,
        transactionId: envelope.transactionId
      }
    );
    return { pendingAction: actions().serializePendingAction(pendingAction) };
  }, { validate: assertUserExists, idempotent: false });

  commandRegistry.register("opposition.respond", async (payload, context, envelope) => {
    try {
      const result = await actions().attachDefenseRollAuthoritative({
        pendingActionId: payload.pendingActionId ?? null,
        defenderActorUuid: payload.defenderActorUuid ?? null,
        defenseItemId: payload.defenseItemId ?? null,
        defenderRoll: payload.defenderRoll ?? null,
        specialContext: payload.specialContext ?? null,
        consumeResponse: payload.consumeResponse === true,
        executeRoll: payload.executeRoll === true,
        dharmaSpend: payload.dharmaSpend ?? null,
        selectedCapability: payload.selectedCapability ?? null,
        mode: payload.mode ?? null,
        requestingUserId: context.requestingUserId,
        transactionId: envelope.transactionId
      });
      const pendingAction = actions().serializePendingAction(result.pendingAction);
      return {
        pendingAction,
        resolutionResult: pendingAction?.result ?? null
      };
    } catch (error) {
      if (!error?.eligibility) throw error;
      return {
        rejected: true,
        reasonCode: error.reasonCode ?? error.eligibility.reasonCode,
        humanReason: error.message,
        eligibility: error.eligibility,
        pendingAction: actions().serializePendingAction(actions().getPendingAction(payload.pendingActionId))
      };
    }
  }, { validate: assertUserExists, idempotent: false });

  commandRegistry.register("opposition.declare-response", async (payload, context, envelope) => {
    try {
      const pendingAction = await actions().declareOppositionResponseAuthoritative({
        pendingActionId: payload.pendingActionId ?? null,
        defenderActorUuid: payload.defenderActorUuid ?? null,
        responseItemId: payload.responseItemId ?? null,
        selectedCapability: payload.selectedCapability ?? null,
        mode: payload.mode ?? null,
        requestingUserId: context.requestingUserId,
        transactionId: envelope.transactionId
      });
      return { pendingAction: actions().serializePendingAction(pendingAction) };
    } catch (error) {
      if (!error?.eligibility) throw error;
      return {
        rejected: true,
        reasonCode: error.reasonCode ?? error.eligibility.reasonCode,
        humanReason: error.message,
        eligibility: error.eligibility,
        pendingAction: actions().serializePendingAction(actions().getPendingAction(payload.pendingActionId))
      };
    }
  }, { validate: assertUserExists });

  commandRegistry.register("opposition.resolve", async (payload, context, envelope) => {
    const result = await actions().resolvePendingActionAuthoritative(
      payload.pendingActionId,
      {
        requestingUserId: context.requestingUserId,
        transactionId: envelope.transactionId
      }
    );
    const pendingAction = actions().serializePendingAction(result.pendingAction);
    return {
      pendingAction,
      resolutionResult: pendingAction?.result ?? null
    };
  }, { validate: assertUserExists });

  commandRegistry.register("opposition.cancel", async (payload, context, envelope) => {
    await actions().clearPendingActionAuthoritative(payload.pendingActionId, {
      requestingUserId: context.requestingUserId,
      reason: payload.reason ?? "cancelled",
      transactionId: envelope.transactionId
    });
    return {
      pendingAction: actions().serializePendingAction(actions().getPendingAction(payload.pendingActionId))
    };
  }, { validate: assertUserExists });

  commandRegistry.register("opposition.list", async (payload, context) => {
    const pendingActions = await actions().requestPendingActionsForActor(payload.actorUuid, {
      requestingUserId: context.requestingUserId
    });
    return { pendingActions: pendingActions.map(actions().serializePendingAction) };
  }, { idempotent: false, validate: assertUserExists });

  commandRegistry.register("opposition.reaction-complete", async (payload, context) => {
    const result = await actions().completeReactionMovementAuthoritative(
      payload.pendingActionId,
      {
        actorUuid: payload.actorUuid ?? null,
        tokenUuid: payload.tokenUuid ?? null,
        cost: payload.cost ?? 0,
        reason: payload.reason ?? "skipped",
        requestingUserId: context.requestingUserId
      }
    );
    return {
      pendingAction: actions().serializePendingAction(result.pendingAction),
      movement: result.movement
    };
  }, { validate: assertUserExists });

  return commandRegistry;
}

export function getOppositionCommandForSocketAction(action) {
  return SOCKET_COMMANDS[action] ?? null;
}

export async function dispatchOppositionSocketCommand(data = {}) {
  const command = getOppositionCommandForSocketAction(data.action);
  if (!command) return { handled: false, result: null };

  registerOppositionCommands();
  const payload = data.payload ?? {};
  const transactionId = data.transactionId ?? payload.transactionId ??
    `legacy:${data.action}:${data.requestId ?? foundry.utils.randomID()}`;
  const combatId = data.combatId ?? payload.combatId ?? game.combat?.id ?? null;
  const requestingUserId = data.requestingUserId ?? null;
  const result = await commandRegistry.dispatch({
    command,
    transactionId,
    combatId,
    payload
  }, {
    requestingUserId,
    isPrimaryGM: isPrimaryActiveGM()
  });
  return { handled: true, result };
}
