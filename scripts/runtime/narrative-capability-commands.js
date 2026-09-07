import { commandRegistry } from "./runtime-foundation.js";
import { authorityService } from "../core/authority-service.js";
import { requestPrimaryGM } from "../core/socket-requests.js";
import {
  NARRATIVE_CAPABILITY_COMMAND,
  declareNarrativeCapabilityAuthoritative
} from "../effects/narrative-capability-service.js";

export const NARRATIVE_CAPABILITY_SOCKET_ACTION = "mtrolDeclareNarrativeCapability";

export function registerNarrativeCapabilityCommands(registry = commandRegistry) {
  if (!registry.has(NARRATIVE_CAPABILITY_COMMAND)) {
    registry.register(NARRATIVE_CAPABILITY_COMMAND, (payload, context, envelope) =>
      declareNarrativeCapabilityAuthoritative({ ...payload, transactionId: envelope.transactionId }, {
        requestingUserId: context.requestingUserId
      }), { scope: "world", idempotent: false }); // Existing domain receipt, never a second Combat receipt.
  }
  return registry;
}

export function dispatchNarrativeCapabilityCommand(request) {
  registerNarrativeCapabilityCommands();
  return commandRegistry.dispatch({
    command: NARRATIVE_CAPABILITY_COMMAND,
    transactionId: request.transactionId ?? request.payload?.transactionId ?? request.requestId,
    payload: request.payload ?? {}
  }, { requestingUserId: request.requestingUserId, isPrimaryGM: authorityService.isPrimaryGM() });
}

export async function declareNarrativeCapability(actor, capabilityId, { transactionId = foundry.utils.randomID() } = {}) {
  authorityService.assertActorOwnership(actor, game.user?.id);
  const payload = { actorUuid: actor.uuid, capabilityId, transactionId, tokenUuid: actor.token?.uuid ?? null };
  if (authorityService.isPrimaryGM()) {
    return dispatchNarrativeCapabilityCommand({ payload, transactionId, requestingUserId: game.user.id });
  }
  const response = await requestPrimaryGM(NARRATIVE_CAPABILITY_SOCKET_ACTION, payload, {
    transactionId, combatId: null
  });
  if (!response.ok) throw new Error(response.error ?? "No se pudo declarar la capacidad narrativa.");
  return response.result;
}
