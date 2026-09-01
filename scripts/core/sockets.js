// =========================
// MTROL - SOCKETS
// =========================

import {
  dispatchStateSocketCommand
} from "../runtime/state-commands.js";

import {
  receivePendingActionCleared,
  receivePendingActionSync
} from "../actions/action-engine.js";

import {
  dispatchActionSocketCommand,
  getActionCommandForSocketAction
} from "../runtime/action-commands.js";
import {
  dispatchProgressionSocketCommand,
  getProgressionCommandForSocketAction
} from "../runtime/progression-commands.js";

import {
  receiveTradeAuthorityReset,
  receiveTradeGMSessionSync,
  receiveTradeSessionSync
} from "../trade/trade-api.js";

import {
  handleSocketResponse,
  isPrimaryActiveGM,
  respondToSocketRequest
} from "./socket-requests.js";

import {
  dispatchOppositionSocketCommand,
  getOppositionCommandForSocketAction
} from "../runtime/opposition-commands.js";

import {
  dispatchTransactionSocketCommand,
  getTransactionCommandForSocketAction
} from "../runtime/transaction-commands.js";
import {
  dispatchTradeSocketCommand,
  getTradeCommandForSocketAction
} from "../runtime/trade-commands.js";

import { logger } from "../utils/logger.js";
import { dispatchOrbSocketCommand, getOrbCommandForSocketAction } from "../runtime/orb-commands.js";
import { authorityService } from "./authority-service.js";
import { integrationObservability } from "./integration-observability.js";

let socketsRegistered = false;

async function respondWithResult(request, operation) {
  try {
    const result =
      await operation();

    respondToSocketRequest(request, {
      ok: true,
      result
    });
  } catch (error) {
    logger.errorOnce("COMMAND", "authoritative request rejected", {
      command: request.action, userId: request.requestingUserId,
      transactionId: request.transactionId ?? request.payload?.transactionId ?? null,
      reasonCode: error.reasonCode ?? "COMMAND_REJECTED", error: error.message
    }, { key: `socket-command:${request.action}:${request.transactionId ?? request.requestId ?? "unknown"}` });

    respondToSocketRequest(request, {
      ok: false,
      error: error.message,
      reasonCode: error.reasonCode ?? "COMMAND_REJECTED",
      result: null
    });
  }
}

export function registerMtrolSockets() {
  if (socketsRegistered) return false;
  game.socket.on("system.mtrol", async (data, senderUserId) => {
    if (!data) return;
    integrationObservability.record("socket", data.action ?? "unknown", {
      userId: senderUserId ?? null,
      transactionId: data.transactionId ?? data.payload?.transactionId ?? null
    });

    if (handleSocketResponse(data, { senderUserId })) return;

    if (data.action === "mtrolTradeSessionSync") {
      if (senderUserId && !authorityService.isPrimaryGMSender(senderUserId)) return;
      receiveTradeSessionSync(data);
      return;
    }

    if (data.action === "mtrolTradeGMSessionSync") {
      if (senderUserId && !authorityService.isPrimaryGMSender(senderUserId)) return;
      receiveTradeGMSessionSync(data);
      return;
    }

    if (data.action === "mtrolTradeAuthorityReset") {
      if (senderUserId && !authorityService.isPrimaryGMSender(senderUserId)) return;
      receiveTradeAuthorityReset(data);
      return;
    }

    if (data.action === "mtrolPendingActionSync") {
      if (senderUserId && !authorityService.isPrimaryGMSender(senderUserId)) return;
      receivePendingActionSync(data.pendingAction);
      return;
    }

    if (data.action === "mtrolPendingActionCleared") {
      if (senderUserId && !authorityService.isPrimaryGMSender(senderUserId)) return;
      receivePendingActionCleared(data.pendingActionId);
      return;
    }

    if (!isPrimaryActiveGM()) return;
    let authority;
    try {
      authority = authorityService.authenticateSocketRequest(data, { senderUserId });
    } catch (error) {
      logger.warnOnce("AUTHORITY", "socket request rejected", {
        command: data.action ?? null,
        transactionId: data.transactionId ?? data.payload?.transactionId ?? null,
        userId: senderUserId ?? null,
        reasonCode: error.reasonCode ?? "AUTHORITY_REJECTED",
        error: error.message
      }, { key: `socket-authority:${data.action ?? "unknown"}:${data.transactionId ?? data.requestId ?? "unknown"}` });
      if (data.requestId && senderUserId) {
        respondToSocketRequest({ ...data, requestingUserId: senderUserId }, {
          ok: false,
          error: error.message,
          reasonCode: error.reasonCode ?? "AUTHORITY_REJECTED",
          result: null
        });
      }
      return;
    }
    const request = { ...data, requestingUserId: authority.requestingUserId };

    if (getOppositionCommandForSocketAction(request.action)) {
      await respondWithResult(request, async () => {
        const dispatched = await dispatchOppositionSocketCommand(request);
        return dispatched.result;
      });
      return;
    }

    if (getTransactionCommandForSocketAction(request.action)) {
      await respondWithResult(request, async () => {
        const dispatched = await dispatchTransactionSocketCommand(request);
        return dispatched.result;
      });
      return;
    }

    if (getTradeCommandForSocketAction(request.action)) {
      await respondWithResult(request, async () => {
        const dispatched = await dispatchTradeSocketCommand(request);
        return dispatched.result;
      });
      return;
    }

    if (getOrbCommandForSocketAction(request.action)) {
      await respondWithResult(request, async () => (await dispatchOrbSocketCommand(request)).result);
      return;
    }

    if (getProgressionCommandForSocketAction(request.action)) {
      await respondWithResult(request, async () => {
        const dispatched = await dispatchProgressionSocketCommand(request);
        return dispatched.result;
      });
      return;
    }

    if (getActionCommandForSocketAction(request.action)) {
      await respondWithResult(request, async () => {
        const dispatched = await dispatchActionSocketCommand(request);
        return dispatched.result;
      });
      return;
    }

    if (request.action === "mtrolApplyState") {
      await respondWithResult(request, () => dispatchStateSocketCommand(request));
      return;
    }

    logger.warn("SOCKET", "socket action desconocida", {
      command: request.action ?? null,
      transactionId: request.transactionId ?? request.payload?.transactionId ?? null,
      userId: request.requestingUserId ?? null
    });
  });

  socketsRegistered = true;
  logger.info("SOCKET", "socket transport registered", { namespace: "system.mtrol" });
  return true;
}
