import {
  acceptTradeSessionAuthoritative,
  cancelTradeSessionAuthoritative,
  cancelTradeSessionByGMAuthoritative,
  confirmTradeSessionAuthoritative,
  createTradeSessionAuthoritative,
  pauseTradeSessionAuthoritative,
  resumeTradeSessionAuthoritative,
  setTradeOfferAuthoritative
} from "../trade/trade-authority.js";
import { buildPublicTradeSessionView } from "../trade/trade-view-model.js";
import { tradeReceiptScope } from "../trade/trade-runtime-repository.js";
import { isPrimaryActiveGM } from "../core/socket-requests.js";
import { commandRegistry } from "./runtime-foundation.js";

const SOCKET_COMMANDS = Object.freeze({
  mtrolTradeCreateSession: "trade.create",
  mtrolTradeAcceptSession: "trade.accept",
  mtrolTradeSetOffer: "trade.offer-set",
  mtrolTradeConfirm: "trade.confirm",
  mtrolTradeCancel: "trade.cancel",
  mtrolTradeGMCancel: "trade.gm-cancel",
  mtrolTradePause: "trade.pause",
  mtrolTradeResume: "trade.resume"
});

let registered = false;

function registration({ idempotent = true } = {}) {
  return {
    idempotent,
    scope: "world",
    receiptTarget: tradeReceiptScope
  };
}

function wrap(handler) {
  return async (payload, context, envelope) => {
    const session = buildPublicTradeSessionView(await handler(payload, {
      requestingUserId: context.requestingUserId
    }));
    return {
      ok: true,
      transactionId: envelope.transactionId,
      status: "completed",
      changed: true,
      reasonCode: null,
      session,
      result: { session }
    };
  };
}

export function registerTradeCommands() {
  if (registered) return commandRegistry;
  registered = true;
  commandRegistry.register("trade.create", wrap(createTradeSessionAuthoritative), registration());
  commandRegistry.register("trade.accept", wrap(acceptTradeSessionAuthoritative), registration());
  commandRegistry.register("trade.offer-set", wrap(setTradeOfferAuthoritative), registration());
  commandRegistry.register("trade.confirm", wrap(confirmTradeSessionAuthoritative), registration());
  commandRegistry.register("trade.cancel", wrap(cancelTradeSessionAuthoritative), registration());
  commandRegistry.register("trade.gm-cancel", wrap(cancelTradeSessionByGMAuthoritative), registration());
  commandRegistry.register("trade.pause", wrap(pauseTradeSessionAuthoritative), registration());
  commandRegistry.register("trade.resume", wrap(resumeTradeSessionAuthoritative), registration());
  return commandRegistry;
}

export function getTradeCommandForSocketAction(action) {
  return SOCKET_COMMANDS[action] ?? null;
}

export async function dispatchTradeSocketCommand(data = {}) {
  const command = getTradeCommandForSocketAction(data.action);
  if (!command) return { handled: false, result: null };
  registerTradeCommands();
  const payload = { ...(data.payload ?? {}) };
  const transactionId = String(
    data.transactionId ?? payload.transactionId ?? payload.operationId ??
    `legacy:${data.action}:${data.requestId ?? foundry.utils.randomID()}`
  );
  const result = await commandRegistry.dispatch({ command, transactionId, payload }, {
    requestingUserId: data.requestingUserId,
    isPrimaryGM: isPrimaryActiveGM()
  });
  return { handled: true, result };
}

export async function dispatchTradeCommandLocal(action, payload = {}, requestingUserId = game.user?.id) {
  return (await dispatchTradeSocketCommand({
    action,
    transactionId: payload.transactionId ?? payload.operationId,
    requestingUserId,
    payload
  })).result;
}
