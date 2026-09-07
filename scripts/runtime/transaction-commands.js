import { aplicarDanioCanonicoAutorizado } from "../combat/damage-authorized.js";
import {
  aplicarConsumoMPAuthoritative,
  reembolsarCostoMPAuthoritative,
  restaurarAcumuladoresDia,
  restaurarMPMeditacionAuthoritative
} from "../combat/mp-engine.js";
import { consumeDharmaSpendAuthoritative } from "../rolls/dharma-spend-service.js";
import { mtrolAplicarDharmaKarma } from "../rolls/mtrol-dharma-karma.js";
import { useConsumableAuthoritative } from "../items/consumable-service.js";
import { persistCompetenceModeIntentAuthoritative } from "../actions/competence-mode-service.js";
import {
  executeMovementRenounceTransaction,
  executeMovementTransaction
} from "../combat/movement-service.js";
import { isPrimaryActiveGM } from "../core/socket-requests.js";
import { commandRegistry } from "./runtime-foundation.js";
import { turnSocketOperations } from "../combat/turn-system.js";
import { logger } from "../utils/logger.js";

const SOCKET_COMMANDS = Object.freeze({
  mtrolAplicarDanio: "damage.apply",
  mtrolAplicarDanioLocalizado: "damage.apply",
  mtrolSpendMP: "resource.mp-spend",
  mtrolRefundMP: "resource.mp-refund",
  mtrolRestoreMeditationMP: "resource.meditate",
  mtrolConsumeDharma: "resource.dharma-spend",
  mtrolAdjustDestiny: "resource.destiny-adjust",
  mtrolSelectCompetenceMode: "resource.competence-mode-intent",
  mtrolUseConsumable: "consumable.use",
  mtrolCommitTurnMovement: "movement.commit",
  mtrolCommitGrantedMovement: "movement.commit",
  mtrolCommitReactionMovement: "movement.commit",
  mtrolCompleteGrantedMovement: "movement.renounce",
  mtrolPrepareTurn: "turn.prepare",
  mtrolSetPreparation: "turn.preparation-set",
  mtrolReservePreparation: "turn.preparation-reserve",
  mtrolCompletePreparation: "turn.preparation-complete",
  mtrolCancelPreparationReservation: "turn.preparation-cancel",
  mtrolEndTurn: "turn.end",
  mtrolGrantTurnMovement: "turn.movement-grant",
  mtrolCompleteAttributeMovement: "turn.attribute-movement-complete",
  mtrolFinalizeTurnUse: "turn.use-finalize",
  mtrolCompleteTurnAction: "turn.action-complete"
});

const LEGACY_DIRECT_RESULT_COMMANDS = new Set([
  "turn.prepare",
  "turn.preparation-set",
  "turn.preparation-reserve",
  "turn.preparation-complete",
  "turn.preparation-cancel",
  "turn.end",
  "turn.movement-grant",
  "turn.attribute-movement-complete",
  "turn.use-finalize",
  "turn.action-complete"
]);

let registered = false;

function result(transactionId, domainResult, reasonCode = null) {
  if (domainResult?.ok === false && domainResult?.transactionId) return domainResult;
  return {
    ok: reasonCode === null,
    transactionId,
    status: "completed",
    changed: domainResult?.changed !== false,
    result: domainResult,
    reasonCode: reasonCode ?? domainResult?.reasonCode ?? null
  };
}

function options(context) {
  return { requestingUserId: context.requestingUserId };
}

export function registerTransactionCommands() {
  if (registered) return commandRegistry;
  registered = true;
  const registration = { idempotent: false, scope: "either" };

  commandRegistry.register("damage.apply", async (payload, context, envelope) => {
    const attackerActor = payload.attackerUuid ? await fromUuid(payload.attackerUuid) : null;
    const targetTokenDocument = payload.targetTokenUuid ? await fromUuid(payload.targetTokenUuid) : null;
    const targetActor = targetTokenDocument?.actor ??
      (payload.targetActorUuid ? await fromUuid(payload.targetActorUuid) : null);
    const requestingUser = game.users?.get?.(context.requestingUserId);
    if (!requestingUser || (!requestingUser.isGM && attackerActor?.testUserPermission?.(requestingUser, "OWNER") !== true)) {
      throw new Error("El usuario no puede aplicar daño desde este Actor.");
    }
    return aplicarDanioCanonicoAutorizado({
      attackerActor,
      targetActor,
      targetTokenDocument,
      payload: {
        ...(payload.damage ?? payload),
        combatId: (payload.damage ?? payload).combatId ?? envelope.combatId ?? null
      },
      transactionId: envelope.transactionId
    });
  }, registration);

  commandRegistry.register("resource.mp-spend", async (payload, context, envelope) =>
    result(envelope.transactionId, await aplicarConsumoMPAuthoritative(payload, options(context))), registration);
  commandRegistry.register("resource.mp-refund", async (payload, context, envelope) =>
    result(envelope.transactionId, await reembolsarCostoMPAuthoritative(payload, options(context))), registration);
  commandRegistry.register("resource.meditate", async (payload, context, envelope) =>
    result(envelope.transactionId, await restaurarMPMeditacionAuthoritative(payload, options(context))), registration);
  commandRegistry.register("resource.dharma-spend", async (payload, context, envelope) =>
    result(envelope.transactionId, await consumeDharmaSpendAuthoritative(payload, options(context))), registration);
  commandRegistry.register("resource.destiny-adjust", async (payload, context, envelope) => {
    const actor = await fromUuid(payload.actorUuid);
    const requestingUser = game.users?.get?.(context.requestingUserId);
    if (!actor || !requestingUser || (!requestingUser.isGM && actor.testUserPermission?.(requestingUser, "OWNER") !== true)) {
      throw new Error("El usuario no puede modificar Karma/Dharma de este Actor.");
    }
    return result(envelope.transactionId, await mtrolAplicarDharmaKarma(
      actor,
      Number(payload.cantidadDharma ?? 0),
      Number(payload.cantidadKarma ?? 0),
      { transactionId: envelope.transactionId }
    ));
  }, registration);
  commandRegistry.register("resource.competence-mode-intent", async (payload, context, envelope) =>
    result(envelope.transactionId, await persistCompetenceModeIntentAuthoritative(payload, options(context))), registration);
  commandRegistry.register("resource.daily-reset", async (payload, _context, envelope) => {
    const actor = await fromUuid(payload.actorUuid);
    return result(envelope.transactionId, await restaurarAcumuladoresDia(actor, {
      transactionId: envelope.transactionId
    }));
  }, registration);
  commandRegistry.register("consumable.use", async (payload, context, envelope) =>
    result(envelope.transactionId, await useConsumableAuthoritative(payload, options(context))), registration);
  commandRegistry.register("movement.commit", async (payload, context, envelope) =>
    executeMovementTransaction({ ...payload, transactionId: envelope.transactionId }, options(context)), registration);
  commandRegistry.register("movement.renounce", async (payload, context, envelope) =>
    executeMovementRenounceTransaction({ ...payload, transactionId: envelope.transactionId }, options(context)), registration);
  const turnRegistration = { idempotent: false, scope: "combat" };
  commandRegistry.register("turn.prepare", (payload, context) =>
    turnSocketOperations.prepareAuthoritative(payload, options(context)), turnRegistration);
  commandRegistry.register("turn.preparation-set", (payload, context) =>
    turnSocketOperations.setPreparationAuthoritative(payload, options(context)), turnRegistration);
  commandRegistry.register("turn.preparation-reserve", (payload, context) =>
    turnSocketOperations.reservePreparationAuthoritative(payload, options(context)), turnRegistration);
  commandRegistry.register("turn.preparation-complete", (payload, context) =>
    turnSocketOperations.completePreparationAuthoritative(payload, options(context)), turnRegistration);
  commandRegistry.register("turn.preparation-cancel", (payload, context) =>
    turnSocketOperations.cancelPreparationReservationAuthoritative(payload, options(context)), turnRegistration);
  commandRegistry.register("turn.end", (payload, context) =>
    turnSocketOperations.endTurnAuthoritative(payload, options(context)), turnRegistration);
  commandRegistry.register("turn.movement-grant", (payload, context) =>
    turnSocketOperations.grantMovementAuthoritative(payload, options(context)), turnRegistration);
  commandRegistry.register("turn.attribute-movement-complete", (payload, context) =>
    turnSocketOperations.completeAttributeMovementAuthoritative(payload, options(context)), turnRegistration);
  commandRegistry.register("turn.use-finalize", (payload, context) =>
    turnSocketOperations.finalizeTurnUseAuthoritative(payload, options(context)), turnRegistration);
  commandRegistry.register("turn.action-complete", (payload, context) =>
    turnSocketOperations.completeResolvedTurnActionAuthoritative(payload, options(context)), turnRegistration);
  return commandRegistry;
}

export function getTransactionCommandForSocketAction(action) {
  return SOCKET_COMMANDS[action] ?? null;
}

export async function dispatchTransactionSocketCommand(data = {}) {
  const command = getTransactionCommandForSocketAction(data.action);
  if (!command) return { handled: false, result: null };
  registerTransactionCommands();
  const payload = { ...(data.payload ?? {}) };
  if (command === "damage.apply") {
    payload.attackerUuid = data.attackerUuid ?? payload.attackerUuid;
    payload.targetActorUuid = data.targetActorUuid ?? payload.targetActorUuid;
    payload.targetTokenUuid = data.targetTokenUuid ?? payload.targetTokenUuid;
    payload.damage = data.payload ?? {};
  }
  const transactionId = String(data.transactionId ?? payload.transactionId ?? payload.movement?.transactionId ??
    `legacy:${data.action}:${data.requestId ?? foundry.utils.randomID()}`);
  payload.transactionId ??= transactionId;
  const actorId = String(payload.actorUuid ?? payload.targetActorUuid ?? "").split(".").at(-1);
  let commandResult;
  try {
    commandResult = await commandRegistry.dispatch({
      command,
      transactionId,
      combatId: data.combatId ?? payload.combatId ?? game.combat?.id ?? undefined,
      actorId: actorId || undefined,
      payload
    }, {
      requestingUserId: data.requestingUserId,
      isPrimaryGM: isPrimaryActiveGM()
    });
  } catch (error) {
    const message = String(error?.message ?? "Transacción rechazada.");
    commandResult = {
      ok: false,
      transactionId,
      status: error.reasonCode === "RECOVERY_REQUIRED" ? "recovery-required" : "failed",
      changed: error.reasonCode === "RECOVERY_REQUIRED",
      result: null,
      reasonCode: error.reasonCode ?? (/MP insuficiente/i.test(message)
        ? "MP_INSUFFICIENT"
        : /máximo|maximum/i.test(message)
          ? "RESOURCE_AT_MAXIMUM"
          : "TRANSACTION_REJECTED"),
      humanReason: message
    };
    logger.warnOnce("COMMAND", "transaction command rejected", {
      transactionId,
      command,
      actorUuid: payload.actorUuid ?? payload.targetActorUuid ?? null,
      tokenUuid: payload.tokenUuid ?? payload.targetTokenUuid ?? null,
      status: commandResult.status,
      reasonCode: commandResult.reasonCode,
      error: message
    }, { key: `transaction-command:${command}:${transactionId}` });
  }
  return {
    handled: true,
    result: LEGACY_DIRECT_RESULT_COMMANDS.has(command) || command === "damage.apply"
      ? commandResult
      : { receipt: commandResult.result, commandResult }
  };
}
