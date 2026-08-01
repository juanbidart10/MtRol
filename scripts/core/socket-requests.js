const pendingSocketRequests = new Map();

const DEFAULT_SOCKET_TIMEOUT_MS = 30000;

export const MTROL_GM_REQUIRED_MESSAGE =
  "Se requiere un GM conectado para resolver esta acción.";

export function getPrimaryActiveGM() {
  return Array.from(game.users ?? [])
    .filter(user => user.isGM && user.active)
    .sort((a, b) => a.id.localeCompare(b.id))[0] ?? null;
}

export function isPrimaryActiveGM() {
  return getPrimaryActiveGM()?.id === game.user?.id;
}

function notifyGMRequired() {
  ui.notifications.warn(MTROL_GM_REQUIRED_MESSAGE);
}

export function requestPrimaryGM(action, payload = {}, {
  timeoutMs = DEFAULT_SOCKET_TIMEOUT_MS
} = {}) {
  const primaryGM =
    getPrimaryActiveGM();

  if (!primaryGM) {
    notifyGMRequired();
    return Promise.resolve({
      ok: false,
      error: MTROL_GM_REQUIRED_MESSAGE,
      result: null
    });
  }

  const requestId =
    foundry.utils.randomID();

  return new Promise(resolve => {
    const timeoutId =
      setTimeout(() => {
        pendingSocketRequests.delete(requestId);

        const error =
          "El GM no respondió a tiempo. La acción no fue resuelta.";

        ui.notifications.warn(error);

        resolve({
          ok: false,
          error,
          result: null
        });
      }, timeoutMs);

    pendingSocketRequests.set(requestId, {
      resolve,
      timeoutId
    });

    game.socket.emit("system.mtrol", {
      action,
      requestId,
      requestingUserId: game.user.id,
      targetGMId: primaryGM.id,
      payload
    });
  });
}

export function handleSocketResponse(data = {}) {
  if (data.action !== "mtrolSocketResponse") return false;
  if (data.targetUserId !== game.user?.id) return true;

  const pending =
    pendingSocketRequests.get(data.requestId);

  if (!pending) return true;

  clearTimeout(pending.timeoutId);
  pendingSocketRequests.delete(data.requestId);

  pending.resolve({
    ok: data.ok === true,
    error: data.error ?? null,
    result: data.result ?? null
  });

  return true;
}

export function respondToSocketRequest(request, {
  ok,
  result = null,
  error = null
} = {}) {
  if (!request?.requestId || !request?.requestingUserId) return false;

  game.socket.emit("system.mtrol", {
    action: "mtrolSocketResponse",
    requestId: request.requestId,
    targetUserId: request.requestingUserId,
    ok: ok === true,
    result,
    error
  });

  return true;
}
