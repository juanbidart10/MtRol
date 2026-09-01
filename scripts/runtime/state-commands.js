import { commandRegistry } from "./runtime-foundation.js";
import { authorityService } from "../core/authority-service.js";
import { applyManualStateAuthoritative } from "../states/state-engine.js";

export function registerStateCommands() {
  if (!commandRegistry.has("state.manual-apply")) {
    commandRegistry.register("state.manual-apply", (payload, context, envelope) =>
      applyManualStateAuthoritative({ ...payload, transactionId: envelope.transactionId }, context),
    // The domain owns the persistent Actor receipt; no second idempotency layer.
    { scope: "world", idempotent: false });
  }
  return commandRegistry;
}

/** Transport translation only. No socket command accepts mechanical authorization. */
export async function dispatchStateSocketCommand(request) {
  registerStateCommands();
  const payload = request.payload ?? {
    actorUuid: request.actorUuid, tokenUuid: request.tokenUuid,
    state: request.state, options: request.options
  };
  return commandRegistry.dispatch({
    command: "state.manual-apply",
    transactionId: request.transactionId ?? payload.transactionId ?? request.requestId,
    payload
  }, {
    requestingUserId: request.requestingUserId,
    isPrimaryGM: authorityService.isPrimaryGM()
  });
}
