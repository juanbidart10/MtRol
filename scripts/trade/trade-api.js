import {
  requestPrimaryGM
} from "../core/socket-requests.js";

import {
  acceptTradeSessionAuthoritative,
  cancelTradeSessionAuthoritative,
  confirmTradeSessionAuthoritative,
  createTradeSessionAuthoritative,
  observeTradeSessionsAuthoritative,
  setTradeOfferAuthoritative
} from "./trade-authority.js";

import {
  buildParticipantTradeView,
  buildPrivateInventoryView,
  buildPublicTradeSessionView,
  buildTradeItemInspectorView,
  findPublicOfferEntry
} from "./trade-view-model.js";

const clientSessions = new Map();
const TERMINAL_SESSION_STATES = new Set(["CANCELLED", "COMPLETED", "INVALID"]);
let clientAuthorityKey = null;

function createOperationId() {
  return foundry.utils.randomID?.() ?? crypto.randomUUID();
}

function withOperationId(payload = {}) {
  return {
    ...payload,
    operationId: String(payload.operationId ?? "").trim() || createOperationId()
  };
}

async function requestTrade(action, payload, authoritativeHandler) {
  const normalized = withOperationId(payload);

  if (game.user?.isGM) {
    return authoritativeHandler(normalized, {
      requestingUserId: game.user.id
    });
  }

  const response = await requestPrimaryGM(action, normalized);
  if (!response.ok) throw new Error(response.error ?? "La operación de comercio fue rechazada.");
  const session = response.result?.session ?? null;
  if (session?.id) cacheClientSession(session, "request-response");
  return session;
}

function cacheClientSession(rawSession, reason) {
  const session = buildPublicTradeSessionView(rawSession);
  if (!session?.id) return null;
  clientSessions.set(session.id, foundry.utils.deepClone?.(session) ?? structuredClone(session));
  Hooks.callAll("mtrolTradeSessionUpdated", session, reason);
  if (TERMINAL_SESSION_STATES.has(session.state)) clientSessions.delete(session.id);
  return session;
}

export function receiveTradeSessionSync(data = {}) {
  if (!data.targetUserIds?.includes?.(game.user?.id)) return false;
  return Boolean(cacheClientSession(data.session, data.reason ?? "session-updated"));
}

export function receiveTradeAuthorityReset(data = {}) {
  const authority = data.authority ?? null;
  const nextAuthorityKey = authority?.gmUserId && authority?.epoch
    ? `${authority.gmUserId}:${authority.epoch}`
    : null;

  if (clientAuthorityKey !== nextAuthorityKey) {
    clientSessions.clear();
    clientAuthorityKey = nextAuthorityKey;
  }

  for (const sessionId of data.invalidatedSessionIds ?? []) {
    clientSessions.delete(sessionId);
  }
  Hooks.callAll("mtrolTradeAuthorityReset", authority);
  return true;
}

export function installTradeApi() {
  game.mtrol = game.mtrol || {};
  game.mtrol.trade = {
    createSession: payload => requestTrade(
      "mtrolTradeCreateSession",
      payload,
      createTradeSessionAuthoritative
    ),
    acceptSession: payload => requestTrade(
      "mtrolTradeAcceptSession",
      payload,
      acceptTradeSessionAuthoritative
    ),
    setOffer: payload => requestTrade(
      "mtrolTradeSetOffer",
      payload,
      setTradeOfferAuthoritative
    ),
    confirm: payload => requestTrade(
      "mtrolTradeConfirm",
      payload,
      confirmTradeSessionAuthoritative
    ),
    cancel: payload => requestTrade(
      "mtrolTradeCancel",
      payload,
      cancelTradeSessionAuthoritative
    ),
    getSession: sessionId => {
      const session = clientSessions.get(String(sessionId ?? ""));
      return session
        ? foundry.utils.deepClone?.(session) ?? structuredClone(session)
        : null;
    },
    listSessions: () => [...clientSessions.values()].map(session =>
      foundry.utils.deepClone?.(session) ?? structuredClone(session)
    ),
    getMyInventory: async (sessionId, actor = null) => {
      const session = clientSessions.get(String(sessionId ?? ""));
      if (!session) throw new Error("La sesión de comercio no existe en la caché local.");
      const participant = Object.values(session.participants ?? {}).find(candidate =>
        candidate.userId === game.user?.id
      );
      if (!participant) throw new Error("El usuario no participa de esta sesión.");
      const localActor = actor ?? await fromUuid(participant.actorUuid);
      return buildPrivateInventoryView({ session, actor: localActor, user: game.user });
    },
    getMyTradeView: async (sessionId, actor = null) => {
      const session = clientSessions.get(String(sessionId ?? ""));
      if (!session) throw new Error("La sesión de comercio no existe en la caché local.");
      const participant = Object.values(session.participants ?? {}).find(candidate =>
        candidate.userId === game.user?.id
      );
      if (!participant) throw new Error("El usuario no participa de esta sesión.");
      const localActor = actor ?? await fromUuid(participant.actorUuid);
      return buildParticipantTradeView({ session, actor: localActor, user: game.user });
    },
    inspectOfferItem: (sessionId, itemReference) => {
      const session = clientSessions.get(String(sessionId ?? ""));
      if (!session) throw new Error("La sesión de comercio no existe en la caché local.");
      const participant = Object.values(session.participants ?? {}).some(candidate =>
        candidate.userId === game.user?.id
      );
      if (!participant && !game.user?.isGM) {
        throw new Error("El usuario no puede inspeccionar esta sesión.");
      }
      return buildTradeItemInspectorView(findPublicOfferEntry(session, itemReference));
    },
    observeSessions: options => observeTradeSessionsAuthoritative(options)
  };
}
