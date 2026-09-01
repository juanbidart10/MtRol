import { addActorOrbAuthoritative, updateActorOrbAuthoritative, deleteActorOrbAuthoritative } from "../progression/orb-management-service.js";
import { commandRegistry } from "./runtime-foundation.js";
import { authorityService } from "../core/authority-service.js";

const ROUTES = Object.freeze({
  mtrolAddActorOrb: ["orb.add", addActorOrbAuthoritative],
  mtrolUpdateActorOrb: ["orb.update", updateActorOrbAuthoritative],
  mtrolDeleteActorOrb: ["orb.delete", deleteActorOrbAuthoritative]
});

export function registerOrbCommands() {
  for (const [command, operation] of Object.values(ROUTES)) {
    if (!commandRegistry.has(command)) commandRegistry.register(command,
      (payload, context, envelope) => operation({ ...payload, transactionId: envelope.transactionId }, {
        requestingUserId: context.requestingUserId
      }), { scope: "world", idempotent: false });
  }
  return commandRegistry;
}

export function getOrbCommandForSocketAction(action) {
  return Object.hasOwn(ROUTES, action) ? ROUTES[action][0] : null;
}

export async function dispatchOrbSocketCommand(request = {}) {
  const command = getOrbCommandForSocketAction(request.action);
  if (!command) return { handled: false, result: null };
  registerOrbCommands();
  const payload = request.payload ?? {};
  const result = await commandRegistry.dispatch({
    command, payload, transactionId: request.transactionId ?? payload.transactionId
  }, { requestingUserId: request.requestingUserId, isPrimaryGM: authorityService.isPrimaryGM() });
  return { handled: true, result };
}
