import {
  spendPendingAttributePointAuthoritative,
  spendPendingCompetencePointAuthoritative
} from "../actors/progression-advancement-service.js";
import { commandRegistry } from "./runtime-foundation.js";
import { authorityService } from "../core/authority-service.js";
import { grantAwakeningSlotAuthoritative } from "../actors/awakening-service.js";

const SOCKET_COMMANDS = Object.freeze({
  mtrolSpendPendingAttribute: "progression.spend-attribute",
  mtrolSpendPendingCompetence: "progression.spend-competence",
  mtrolGrantAwakening: "progression.awakening-grant"
});
const SERVICES = Object.freeze({
  spendAttribute: spendPendingAttributePointAuthoritative,
  spendCompetence: spendPendingCompetencePointAuthoritative,
  grantAwakening: grantAwakeningSlotAuthoritative
});

export function registerProgressionCommands(registry = commandRegistry, services = SERVICES) {
  // Document resolution (including synthetic Actors), ownership, snapshots and receipts
  // stay in the existing domain service. No second receipt or Combat requirement.
  const options = { scope: "world", idempotent: false };
  if (!registry.has("progression.spend-attribute")) {
    registry.register("progression.spend-attribute", async (payload, context) => ({
      receipt: await services.spendAttribute(payload, { requestingUserId: context.requestingUserId })
    }), options);
  }
  if (!registry.has("progression.spend-competence")) {
    registry.register("progression.spend-competence", async (payload, context) => ({
      receipt: await services.spendCompetence(payload, { requestingUserId: context.requestingUserId })
    }), options);
  }
  if (!registry.has("progression.awakening-grant")) {
    registry.register("progression.awakening-grant", async (payload, context) => ({
      receipt: await services.grantAwakening(payload, { requestingUserId: context.requestingUserId })
    }), options);
  }
  return registry;
}

export function getProgressionCommandForSocketAction(action) {
  return Object.hasOwn(SOCKET_COMMANDS, action) ? SOCKET_COMMANDS[action] : null;
}

export async function dispatchProgressionSocketCommand(request = {}) {
  const command = getProgressionCommandForSocketAction(request.action);
  if (!command) return { handled: false, result: null };
  registerProgressionCommands();
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
