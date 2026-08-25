import {
  getItemQuantity,
  isItemActuallyEquipped,
  normalizeEquippedFlag
} from "../items/item-invariants.js";

import {
  isPrimaryActiveGM
} from "../core/socket-requests.js";

import {
  publishTradeSession,
  tradeSessionStore
} from "./trade-authority.js";

import {
  tradeMovementLocks
} from "./trade-proximity-service.js";

function isOwnTradeMutation(options) {
  return Boolean(options?.mtrolTradeExecutionId || options?.mtrolTradeRollback);
}

function participantKeyForActor(session, actorUuid) {
  return Object.entries(session?.participants ?? {}).find(([, participant]) =>
    participant.actorUuid === String(actorUuid ?? "")
  )?.[0] ?? null;
}

function offerForItem(session, participantKey, item) {
  return (session?.offers?.[participantKey] ?? []).find(entry =>
    entry.itemUuid === String(item?.uuid ?? "") || entry.itemId === String(item?.id ?? "")
  ) ?? null;
}

function sessionForActor(actorUuid) {
  const sessionId = tradeSessionStore.getActiveSessionIdForActor(actorUuid);
  return sessionId ? tradeSessionStore.getSession(sessionId) : null;
}

async function invalidateOfferedItem(session, participantKey, offer, reason) {
  const updated = await tradeSessionStore.invalidateOfferEntry({
    sessionId: session.id,
    authorityUserId: game.user.id,
    participantKey,
    itemUuid: offer.itemUuid,
    itemId: offer.itemId,
    reason,
    operationId: `external-${session.id}-${session.revision}-${offer.itemId}-${reason}`
  });
  publishTradeSession(updated, { reason: "offer-entry-invalidated" });
  return updated;
}

export async function handleTradeItemMutation(item, {
  deleted = false,
  options = {}
} = {}) {
  if (!game.user?.isGM || !isPrimaryActiveGM() || isOwnTradeMutation(options)) return null;
  const actorUuid = String(item?.parent?.uuid ?? item?.actor?.uuid ?? "");
  const session = sessionForActor(actorUuid);
  if (!session || session.state === "EXECUTING") return null;
  const participantKey = participantKeyForActor(session, actorUuid);
  const offer = participantKey ? offerForItem(session, participantKey, item) : null;
  if (!offer) return null;

  if (deleted) return invalidateOfferedItem(session, participantKey, offer, "Objeto eliminado");
  const actor = item.parent ?? item.actor;
  if (isItemActuallyEquipped(actor, item) || normalizeEquippedFlag(item.system?.equipado)) {
    return invalidateOfferedItem(session, participantKey, offer, "Objeto equipado");
  }
  if (getItemQuantity(item) < offer.quantity) {
    return invalidateOfferedItem(session, participantKey, offer, "Cantidad insuficiente");
  }
  return null;
}

async function finishLifecycleSession(session, state, reason, operationId) {
  if (!session || session.state === "EXECUTING") return null;
  const terminal = await tradeSessionStore.finishForLifecycle({
    sessionId: session.id,
    authorityUserId: game.user.id,
    state,
    reason,
    operationId
  });
  tradeMovementLocks.releaseSession(terminal.id);
  publishTradeSession(terminal, { reason });
  return terminal;
}

export async function handleTradeUserConnection(user, connected) {
  if (connected !== false || !game.user?.isGM || !isPrimaryActiveGM()) return [];
  const affected = tradeSessionStore.listSessions({ activeOnly: true }).filter(session =>
    Object.values(session.participants ?? {}).some(participant => participant.userId === user?.id)
  );
  const results = [];
  for (const session of affected) {
    const result = await finishLifecycleSession(
      session,
      "CANCELLED",
      "participant-disconnected",
      `disconnect-${session.id}-${user.id}-${session.revision}`
    );
    if (result) results.push(result);
  }
  return results;
}

export async function handleTradeActorDeleted(actor) {
  if (!game.user?.isGM || !isPrimaryActiveGM()) return null;
  const session = sessionForActor(actor?.uuid);
  return finishLifecycleSession(
    session,
    "INVALID",
    "participant-actor-deleted",
    `actor-deleted-${session?.id ?? "none"}-${actor?.id ?? "unknown"}`
  );
}

export async function handleTradeTokenDeleted(token) {
  if (!game.user?.isGM || !isPrimaryActiveGM()) return null;
  const session = tradeSessionStore.listSessions({ activeOnly: true }).find(candidate =>
    Object.values(candidate.participants ?? {}).some(participant =>
      participant.tokenUuid === String(token?.uuid ?? "")
    )
  );
  return finishLifecycleSession(
    session,
    "INVALID",
    "participant-token-deleted",
    `token-deleted-${session?.id ?? "none"}-${token?.id ?? "unknown"}`
  );
}
