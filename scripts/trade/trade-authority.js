import {
  analyzeItemQuantity,
  getItemQuantity,
  isItemActuallyEquipped,
  isMtrolObject,
  normalizeEquippedFlag
} from "../items/item-invariants.js";

import {
  getPrimaryActiveGM,
  isPrimaryActiveGM
} from "../core/socket-requests.js";

import {
  TradeSessionStore
} from "./trade-session-service.js";

import {
  buildPublicTradeItemSnapshot
} from "./trade-item-presentation.js";

import {
  buildGMTradeView,
  buildPublicTradeSessionView
} from "./trade-view-model.js";

import {
  prepareTradeTransferPlan,
  tradeTransferCoordinator
} from "./trade-transfer-service.js";

import {
  tradeMovementLocks,
  validateTradeTokenProximity
} from "./trade-proximity-service.js";

const LOCAL_AUTHORITY_EPOCH =
  globalThis.foundry?.utils?.randomID?.() ?? crypto.randomUUID();

async function resolveTradeItem(reference = {}) {
  const actor = reference.actorUuid
    ? await fromUuid(String(reference.actorUuid))
    : null;
  if (!actor) throw new Error("No se encontró el Actor de la reserva.");

  let item = null;
  if (reference.itemUuid) item = await fromUuid(String(reference.itemUuid));
  if (!item && reference.itemId) item = actor.items?.get?.(String(reference.itemId)) ?? null;
  if (!item) throw new Error("No se encontró el Item de la reserva.");

  if (reference.itemId && String(item.id) !== String(reference.itemId)) {
    throw new Error("itemId no corresponde al Item UUID ofrecido.");
  }

  const parentUuid = String(item.parent?.uuid ?? item.actor?.uuid ?? "");
  if (parentUuid !== String(actor.uuid)) {
    throw new Error("El Item no pertenece al Actor participante.");
  }

  return { actor, item };
}

async function resolveRealTradeQuantity(reference) {
  const { item } = await resolveTradeItem(reference);
  return getItemQuantity(item);
}

async function resolveOfferTradeItem(reference) {
  const { actor, item } = await resolveTradeItem(reference);
  if (!isMtrolObject(item)) {
    throw new Error("Sólo los Items de inventario MTROL pueden ofrecerse.");
  }
  if (isItemActuallyEquipped(actor, item) || normalizeEquippedFlag(item.system?.equipado)) {
    throw new Error("El Item está equipado y debe desequiparse manualmente antes de ofrecerlo.");
  }

  const quantityAnalysis = analyzeItemQuantity(item);
  if (!quantityAnalysis.valid || !Number.isInteger(quantityAnalysis.effectiveValue)) {
    throw new Error("El Item no admite una cantidad comerciable válida.");
  }
  if (quantityAnalysis.effectiveValue <= 0) {
    throw new Error("El Item no tiene cantidad disponible para comerciar.");
  }

  return {
    realQuantity: quantityAnalysis.effectiveValue,
    publicSnapshot: buildPublicTradeItemSnapshot(item, reference.quantity)
  };
}

export const tradeSessionStore = new TradeSessionStore({
  resolveRealQuantity: resolveRealTradeQuantity,
  resolveOfferItem: resolveOfferTradeItem
});

function requirePrimaryGM() {
  if (!game.user?.isGM || !isPrimaryActiveGM()) {
    throw new Error("La operación de comercio requiere al GM primario.");
  }
  return game.user;
}

function requireUser(userId) {
  const user = game.users?.get?.(String(userId ?? "")) ?? null;
  if (!user) throw new Error("El usuario participante no existe.");
  if (user.isGM) throw new Error("El GM observa comercios, pero no participa en ellos.");
  if (!user.active) throw new Error("El usuario participante no está conectado.");
  return user;
}

async function requireOwnedActor(actorUuid, user) {
  const actor = actorUuid ? await fromUuid(String(actorUuid)) : null;
  if (!actor) throw new Error("El Actor participante no existe.");
  if (actor.testUserPermission?.(user, "OWNER") !== true) {
    throw new Error("El usuario no posee OWNER sobre el Actor participante.");
  }
  return actor;
}

async function requireParticipantToken(tokenUuid, actor) {
  const token = tokenUuid ? await fromUuid(String(tokenUuid)) : null;
  if (!token) throw new Error("El Token participante no existe.");
  if (String(token.actor?.uuid ?? token.actorUuid ?? "") !== String(actor.uuid)) {
    throw new Error("El Token participante no corresponde al Actor indicado.");
  }
  return token;
}

async function resolveSessionTokens(session) {
  const tokens = {};
  for (const [key, participant] of Object.entries(session?.participants ?? {})) {
    const actor = await fromUuid(participant.actorUuid);
    if (!actor) throw new Error("El Actor participante no existe.");
    tokens[key] = await requireParticipantToken(participant.tokenUuid, actor);
  }
  return tokens;
}

async function requireParticipantAuthorization(sessionId, participantKey, requestingUserId) {
  const session = tradeSessionStore.getSession(sessionId);
  if (!session) throw new Error("La sesión de comercio no existe.");
  const participant = session.participants?.[participantKey];
  if (!participant || participant.userId !== String(requestingUserId ?? "")) {
    throw new Error("El usuario no puede actuar como ese participante.");
  }
  const user = requireUser(requestingUserId);
  await requireOwnedActor(participant.actorUuid, user);
  return { session, participant, user };
}

function sessionUserIds(session) {
  return Object.values(session?.participants ?? {})
    .map(participant => participant.userId)
    .filter(Boolean);
}

export function publishTradeSession(session, { reason = "session-updated" } = {}) {
  if (!session) return false;
  const publicSession = buildPublicTradeSessionView(session);
  game.socket?.emit?.("system.mtrol", {
    action: "mtrolTradeSessionSync",
    targetUserIds: sessionUserIds(session),
    session: publicSession,
    reason
  });
  return true;
}

export function publishTradeAuthorityReset({ invalidated = [], authority = null } = {}) {
  game.socket?.emit?.("system.mtrol", {
    action: "mtrolTradeAuthorityReset",
    invalidatedSessionIds: invalidated.map(session => session.id),
    authority
  });
}

export function initializeTradeAuthority() {
  const primary = getPrimaryActiveGM();

  if (game.user?.isGM && primary?.id === game.user.id) {
    const invalidated = tradeSessionStore.reconcileAuthority({
      gmUserId: game.user.id,
      epoch: LOCAL_AUTHORITY_EPOCH,
      reason: "authority-runtime-reinitialized"
    });
    for (const session of invalidated) tradeMovementLocks.releaseSession(session.id);
    publishTradeAuthorityReset({
      invalidated,
      authority: { gmUserId: game.user.id, epoch: LOCAL_AUTHORITY_EPOCH }
    });
    return { primary: true, invalidated };
  }

  const invalidated = tradeSessionStore.reconcileAuthority({
    gmUserId: primary?.id ?? null,
    epoch: primary ? `remote:${primary.id}` : null,
    reason: primary ? "primary-gm-changed" : "primary-gm-lost"
  });

  for (const session of invalidated) {
    tradeMovementLocks.releaseSession(session.id);
    publishTradeSession(session, { reason: session.invalidReason });
  }
  return { primary: false, invalidated };
}

export function reconcileTradeAuthority() {
  return initializeTradeAuthority();
}

function authorityDescriptor() {
  const gm = requirePrimaryGM();
  return {
    gmUserId: gm.id,
    epoch: LOCAL_AUTHORITY_EPOCH
  };
}

export async function createTradeSessionAuthoritative(payload = {}, {
  requestingUserId
} = {}) {
  const authority = authorityDescriptor();
  const participantAUser = requireUser(requestingUserId);
  const participantBUser = requireUser(payload.participantBUserId);
  const actorA = await requireOwnedActor(payload.participantAActorUuid, participantAUser);
  const actorB = await requireOwnedActor(payload.participantBActorUuid, participantBUser);
  const tokenA = await requireParticipantToken(payload.participantATokenUuid, actorA);
  const tokenB = await requireParticipantToken(payload.participantBTokenUuid, actorB);
  validateTradeTokenProximity({ tokenA, tokenB, grid: globalThis.canvas?.grid });

  const session = await tradeSessionStore.createSession({
    participantA: {
      userId: participantAUser.id,
      actorUuid: actorA.uuid,
      actorName: String(actorA.name ?? ""),
      actorImg: String(actorA.img ?? "icons/svg/mystery-man.svg"),
      tokenUuid: payload.participantATokenUuid ?? null
    },
    participantB: {
      userId: participantBUser.id,
      actorUuid: actorB.uuid,
      actorName: String(actorB.name ?? ""),
      actorImg: String(actorB.img ?? "icons/svg/mystery-man.svg"),
      tokenUuid: payload.participantBTokenUuid ?? null
    },
    authority,
    operationId: payload.operationId
  });

  publishTradeSession(session, { reason: "session-requested" });
  return session;
}

export async function acceptTradeSessionAuthoritative(payload = {}, {
  requestingUserId
} = {}) {
  requirePrimaryGM();
  await requireParticipantAuthorization(
    payload.sessionId,
    payload.participantKey ?? "participantB",
    requestingUserId
  );
  const pending = tradeSessionStore.getSession(payload.sessionId);
  const tokens = await resolveSessionTokens(pending);
  const session = await tradeSessionStore.acceptSession({
    sessionId: payload.sessionId,
    participantKey: payload.participantKey ?? "participantB",
    requestingUserId,
    operationId: payload.operationId
  });
  try {
    tradeMovementLocks.lockSession(session, tokens);
  } catch (error) {
    const invalid = await tradeSessionStore.invalidateSession({
      sessionId: session.id,
      authorityUserId: game.user.id,
      reason: `movement-lock-failed:${error.message}`,
      operationId: `lock-failed-${payload.operationId}`
    });
    publishTradeSession(invalid, { reason: "movement-lock-failed" });
    throw error;
  }
  publishTradeSession(session, { reason: "session-accepted" });
  return session;
}

export async function setTradeOfferAuthoritative(payload = {}, {
  requestingUserId
} = {}) {
  requirePrimaryGM();
  await requireParticipantAuthorization(
    payload.sessionId,
    payload.participantKey,
    requestingUserId
  );
  const session = await tradeSessionStore.setOffer({
    sessionId: payload.sessionId,
    participantKey: payload.participantKey,
    requestingUserId,
    entries: payload.entries ?? [],
    operationId: payload.operationId
  });
  publishTradeSession(session, { reason: "offer-updated" });
  return session;
}

export async function confirmTradeSessionAuthoritative(payload = {}, {
  requestingUserId
} = {}) {
  requirePrimaryGM();
  await requireParticipantAuthorization(
    payload.sessionId,
    payload.participantKey,
    requestingUserId
  );
  const session = await tradeSessionStore.confirmSession({
    sessionId: payload.sessionId,
    participantKey: payload.participantKey,
    requestingUserId,
    revision: payload.revision,
    operationId: payload.operationId
  });
  publishTradeSession(session, { reason: "confirmation-updated" });
  if (session.state !== "READY") return session;

  return executeTradeSessionAuthoritative({
    sessionId: session.id,
    revision: session.revision,
    executionId: `trade-${session.id}-${session.revision}-${foundry.utils.randomID()}`
  });
}

async function validateExecutionParticipants(session) {
  for (const participant of Object.values(session.participants ?? {})) {
    const user = requireUser(participant.userId);
    await requireOwnedActor(participant.actorUuid, user);
  }
}

async function createTradeCompletionMessage(session, receipt) {
  if (!globalThis.ChatMessage?.create) return false;
  const names = Object.values(session.participants ?? {})
    .map(participant => participant.actorName || "Personaje")
    .join(" ↔ ");
  try {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker?.({ user: game.user }) ?? {},
      content: `<div class="mtrol-trade-chat"><strong>Intercambio completado</strong><p>${names}</p></div>`,
      flags: {
        mtrol: {
          trade: {
            sessionId: session.id,
            executionId: receipt.executionId
          }
        }
      }
    });
    return true;
  } catch (error) {
    console.error("MTROL | Comercio completado, pero falló el ChatMessage:", error);
    return false;
  }
}

export async function executeTradeSessionAuthoritative(payload = {}) {
  const gm = requirePrimaryGM();
  const session = tradeSessionStore.getSession(payload.sessionId);
  if (!session) throw new Error("La sesión de comercio no existe.");

  const executionId = String(payload.executionId ?? "").trim();
  const previousReceipt = tradeTransferCoordinator.getReceipt(executionId);
  if (previousReceipt) {
    if (
      previousReceipt.sessionId !== session.id ||
      previousReceipt.revision !== Number(payload.revision)
    ) {
      throw new Error("El executionId ya fue utilizado con otro payload.");
    }
    return tradeSessionStore.getSession(session.id);
  }
  if (session.state === "COMPLETED") {
    throw new Error("Una sesión COMPLETED no puede volver a ejecutarse.");
  }

  await validateExecutionParticipants(session);

  let plan;
  try {
    plan = await prepareTradeTransferPlan({
      session,
      executionId,
      resolveActor: actorUuid => fromUuid(actorUuid)
    });
  } catch (error) {
    const invalid = await tradeSessionStore.invalidateSession({
      sessionId: session.id,
      authorityUserId: gm.id,
      reason: `execution-prevalidation-failed:${error.message}`,
      operationId: `invalidate-${executionId}`
    });
    tradeMovementLocks.releaseSession(invalid.id);
    publishTradeSession(invalid, { reason: "execution-prevalidation-failed" });
    throw error;
  }

  const executing = await tradeSessionStore.beginExecution({
    sessionId: session.id,
    authorityUserId: gm.id,
    executionId,
    revision: payload.revision,
    operationId: `begin-${executionId}`
  });
  publishTradeSession(executing, { reason: "execution-started" });

  let receipt;
  try {
    receipt = await tradeTransferCoordinator.executePlan(plan);
  } catch (error) {
    const invalid = await tradeSessionStore.failExecution({
      sessionId: session.id,
      authorityUserId: gm.id,
      executionId,
      reason: error.rollbackSucceeded
        ? `execution-rolled-back:${error.cause?.message ?? error.message}`
        : `execution-rollback-incomplete:${error.cause?.message ?? error.message}`,
      operationId: `fail-${executionId}`
    });
    tradeMovementLocks.releaseSession(invalid.id);
    publishTradeSession(invalid, { reason: "execution-failed" });
    throw error;
  }

  const completed = await tradeSessionStore.completeSession({
    sessionId: session.id,
    authorityUserId: gm.id,
    executionId,
    operationId: `complete-${executionId}`
  });
  tradeMovementLocks.releaseSession(completed.id);
  publishTradeSession(completed, { reason: "execution-completed" });
  await createTradeCompletionMessage(completed, receipt);
  return completed;
}

export async function cancelTradeSessionAuthoritative(payload = {}, {
  requestingUserId
} = {}) {
  requirePrimaryGM();
  await requireParticipantAuthorization(
    payload.sessionId,
    payload.participantKey,
    requestingUserId
  );
  const session = await tradeSessionStore.cancelSession({
    sessionId: payload.sessionId,
    participantKey: payload.participantKey,
    requestingUserId,
    operationId: payload.operationId
  });
  tradeMovementLocks.releaseSession(session.id);
  publishTradeSession(session, { reason: "session-cancelled" });
  return session;
}

export function observeTradeSessionsAuthoritative({ activeOnly = true } = {}) {
  requirePrimaryGM();
  return tradeSessionStore.listSessions({ activeOnly }).map(buildGMTradeView);
}
