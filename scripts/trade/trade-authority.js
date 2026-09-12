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
import { authorityService } from "../core/authority-service.js";
import { logger } from "../utils/logger.js";

import {
  TradeSessionStore
} from "./trade-session-service.js";
import {
  tradeRuntimeRepository,
  sharedReservationLedger
} from "./trade-runtime-repository.js";
import { configureTradeReservationBoundary } from "./trade-reservation-boundary.js";

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

import {
  tradeAuditService
} from "./trade-audit-service.js";

import {
  buildGMTradeMonitorView
} from "./trade-gm-view-model.js";

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
    itemUuid: item.uuid,
    itemId: item.id,
    publicSnapshot: buildPublicTradeItemSnapshot(item, reference.quantity)
  };
}

export const tradeSessionStore = new TradeSessionStore({
  resolveRealQuantity: resolveRealTradeQuantity,
  resolveOfferItem: resolveOfferTradeItem,
  repository: tradeRuntimeRepository,
  reservationLedger: sharedReservationLedger,
  authorityService
});

sharedReservationLedger.setAuthorityService(authorityService);

configureTradeReservationBoundary({
  getGlobalReservedQuantity: (actorUuid, itemReference) =>
    sharedReservationLedger.reservedQuantity(actorUuid, itemReference?.itemUuid ?? itemReference?.itemId)
});

function requirePrimaryGM() {
  if (!authorityService.isPrimaryGM()) {
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
  try {
    authorityService.assertActorOwnership(actor, user);
  } catch (_error) {
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

function activeGMUserIds() {
  return Array.from(game.users ?? []).filter(user => user.isGM && user.active).map(user => user.id);
}

function auditEvent(session, type, details = {}) {
  tradeAuditService.recordEvent(session, type, details);
}

async function persistTerminalAudit(session, options = {}) {
  try {
    return await tradeAuditService.persistTerminal(session, options);
  } catch (error) {
    logger.error("HISTORY", "trade terminal audit failed", {
      tradeId: session?.id ?? null,
      status: session?.state ?? null,
      error: error.message
    });
    return null;
  }
}

export function publishTradeSession(session, { reason = "session-updated" } = {}) {
  if (!session) return false;
  const publicSession = buildPublicTradeSessionView(session);
  const targetGMUserIds = activeGMUserIds();
  if (targetGMUserIds.length) game.socket?.emit?.("system.mtrol", {
    action: "mtrolTradeGMSessionSync",
    targetGMUserIds,
    session: publicSession,
    reason
  });
  game.socket?.emit?.("system.mtrol", {
    action: "mtrolTradeSessionSync",
    targetUserIds: sessionUserIds(session),
    session: publicSession,
    reason
  });
  if (game.user?.isGM) globalThis.Hooks?.callAll?.("mtrolTradeGMSessionUpdated", publicSession, reason);
  return true;
}

export function publishTradeAuthorityReset({ invalidated = [], authority = null } = {}) {
  game.socket?.emit?.("system.mtrol", {
    action: "mtrolTradeAuthorityReset",
    invalidatedSessionIds: invalidated.map(session => session.id),
    authority
  });
}

export async function initializeTradeAuthority() {
  const primary = getPrimaryActiveGM();

  if (game.user?.isGM && primary?.id === game.user.id) {
    await tradeSessionStore.hydrateFromPersistence();
    const recovered = await tradeSessionStore.adoptAuthority({
      gmUserId: game.user.id,
      epoch: LOCAL_AUTHORITY_EPOCH
    });
    for (const session of recovered) {
      try {
        const tokens = await resolveSessionTokens(session);
        tradeMovementLocks.releaseSession(session.id);
        tradeMovementLocks.lockSession(session, tokens);
        publishTradeSession(session, { reason: "authority-recovered" });
      } catch (error) {
        logger.warn("RECOVERY", "trade movement lock could not be rebuilt", {
          tradeId: session.id,
          status: session.state,
          error: error.message
        });
      }
    }
    publishTradeAuthorityReset({
      invalidated: [],
      authority: { gmUserId: game.user.id, epoch: LOCAL_AUTHORITY_EPOCH }
    });
    return { primary: true, invalidated: [], recovered };
  }

  publishTradeAuthorityReset({
    invalidated: [],
    authority: primary ? { gmUserId: primary.id, epoch: `remote:${primary.id}` } : null
  });
  return { primary: false, invalidated: [], recovered: [] };
}

export async function reconcileTradeAuthority() {
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
  auditEvent(session, "create", { message: "Solicitud creada" });
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
    auditEvent(invalid, "invalidation", { message: error.message });
    await persistTerminalAudit(invalid);
    throw error;
  }
  publishTradeSession(session, { reason: "session-accepted" });
  auditEvent(session, "accept", { participantKey: payload.participantKey ?? "participantB", message: "Solicitud aceptada" });
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
    revision: payload.revision ?? null,
    operationId: payload.operationId
  });
  publishTradeSession(session, { reason: "offer-updated" });
  await tradeAuditService.captureCanonicalOffers(session);
  auditEvent(session, "setOffer", {
    participantKey: payload.participantKey,
    message: `Oferta actualizada (${(payload.entries ?? []).length} entradas)`
  });
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
  auditEvent(session, "confirm", {
    participantKey: payload.participantKey,
    message: `Confirmó revisión ${session.revision}`
  });
  if (session.state !== "READY") return session;

  return executeTradeSessionAuthoritative({
    sessionId: session.id,
    revision: session.revision,
    executionId: `trade:${session.id}:${session.revision}`
  });
}

async function validateExecutionParticipants(session) {
  for (const participant of Object.values(session.participants ?? {})) {
    const user = requireUser(participant.userId);
    await requireOwnedActor(participant.actorUuid, user);
  }
  const tokens = await resolveSessionTokens(session);
  validateTradeTokenProximity({
    tokenA: tokens.participantA,
    tokenB: tokens.participantB,
    grid: globalThis.canvas?.grid
  });
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
    logger.error("TRADE", "Comercio completado, pero falló el ChatMessage", {
      sessionId: session.id,
      executionId: receipt.executionId,
      error: error?.message ?? String(error)
    });
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
    if (["EXECUTING", "RECOVERY_REQUIRED"].includes(session.state)) {
      const completed = await tradeSessionStore.completeSession({
        sessionId: session.id,
        authorityUserId: gm.id,
        executionId,
        operationId: `complete-${executionId}`
      });
      tradeMovementLocks.releaseSession(completed.id);
      publishTradeSession(completed, { reason: "execution-recovered-completed" });
      await persistTerminalAudit(completed, { executionResult: previousReceipt });
      return completed;
    }
    return tradeSessionStore.getSession(session.id);
  }
  if (session.state === "COMPLETED") {
    throw new Error("Una sesión COMPLETED no puede volver a ejecutarse.");
  }

  await validateExecutionParticipants(session);

  let plan;
  try {
    await tradeAuditService.captureCanonicalOffers(session);
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
    auditEvent(invalid, "invalidation", { message: error.message });
    await persistTerminalAudit(invalid, {
      executionResult: { success: false, error: String(error.message ?? "prevalidation-failed").slice(0, 500) }
    });
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
  auditEvent(executing, "execute", { message: `Ejecución ${executionId} iniciada` });

  let receipt;
  try {
    receipt = await tradeTransferCoordinator.executePlan(plan);
  } catch (error) {
    if (error.transactionRolledBack !== true) {
      const recoveryRequired = await tradeSessionStore.markRecoveryRequired({
        sessionId: session.id,
        authorityUserId: gm.id,
        reasonCode: error.reasonCode ?? "TRADE_COMMIT_INTERRUPTED",
        operationId: `recovery-required-${executionId}`
      });
      publishTradeSession(recoveryRequired, { reason: "execution-recovery-required" });
      logger.error("RECOVERY", "trade commit requires recovery", {
        tradeId: session.id,
        transactionId: executionId,
        status: recoveryRequired.state,
        reasonCode: recoveryRequired.recovery?.reasonCode ?? null,
        error: error.message
      });
      throw error;
    }
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
    auditEvent(invalid, "rollback", {
      message: error.rollbackSucceeded ? "Rollback completado" : "Rollback incompleto"
    });
    await persistTerminalAudit(invalid, {
      executionResult: { success: false, error: String(error.cause?.message ?? error.message).slice(0, 500) },
      rollback: {
        attempted: true,
        succeeded: error.rollbackSucceeded === true,
        error: error.rollbackError?.message ?? null
      }
    });
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
  auditEvent(completed, "complete", { message: "Transferencia completada" });
  await persistTerminalAudit(completed, { executionResult: receipt });
  await createTradeCompletionMessage(completed, receipt);
  return completed;
}

export async function recoverTradeTransactionsAuthoritative() {
  const gm = requirePrimaryGM();
  const recovered = [];
  const required = [];
  for (const session of tradeSessionStore.listSessions({ activeOnly: true })) {
    if (session.state === "READY") {
      required.push(session.id);
      continue;
    }
    if (!["EXECUTING", "RECOVERY_REQUIRED"].includes(session.state)) continue;
    const executionId = session.execution?.executionId;
    if (!executionId) {
      required.push(session.id);
      continue;
    }
    try {
      const receipt = await tradeTransferCoordinator.recoverExecution(executionId);
      const completed = await tradeSessionStore.completeSession({
        sessionId: session.id,
        authorityUserId: gm.id,
        executionId,
        operationId: `complete-${executionId}`
      });
      tradeMovementLocks.releaseSession(completed.id);
      publishTradeSession(completed, { reason: "execution-recovered" });
      await persistTerminalAudit(completed, { executionResult: receipt });
      recovered.push(session.id);
    } catch (error) {
      required.push(session.id);
      logger.error("RECOVERY", "trade recovery remains required", {
        tradeId: session.id,
        transactionId: executionId,
        status: session.state,
        reasonCode: error.reasonCode ?? "TRADE_RECOVERY_REQUIRED",
        error: error.message
      });
    }
  }
  await tradeRuntimeRepository.mutate(tradeRuntimeRepository.target, draft => {
    draft.recovery.lastRunAt = Date.now();
    draft.recovery.lastResult = required.length ? "recovery-required" : "recovered";
    draft.recovery.requiredTradeIds = required;
  });
  return { recovered, required };
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
  auditEvent(session, "cancel", { participantKey: payload.participantKey, message: "Cancelado por participante" });
  await persistTerminalAudit(session);
  return session;
}

export async function cancelTradeSessionByGMAuthoritative(payload = {}, {
  requestingUserId
} = {}) {
  const authority = requirePrimaryGM();
  const requestingGM = game.users?.get?.(String(requestingUserId ?? ""));
  if (!requestingGM?.isGM || !requestingGM.active) {
    throw new Error("Sólo un GM activo puede cancelar un comercio desde supervisión.");
  }
  const current = tradeSessionStore.getSession(payload.sessionId);
  if (!current) throw new Error("La sesión de comercio no existe.");
  await tradeAuditService.captureCanonicalOffers(current);
  const session = await tradeSessionStore.cancelSessionByGM({
    sessionId: payload.sessionId,
    authorityUserId: authority.id,
    requestingUserId: requestingGM.id,
    reason: payload.reason,
    operationId: payload.operationId
  });
  tradeMovementLocks.releaseSession(session.id);
  publishTradeSession(session, { reason: "session-cancelled-by-gm" });
  auditEvent(session, "cancel", { message: `Cancelado por GM: ${session.cancelReason}` });
  await persistTerminalAudit(session);
  return session;
}

function requireRequestingGM(requestingUserId) {
  const authority = requirePrimaryGM();
  const requestingGM = game.users?.get?.(String(requestingUserId ?? ""));
  if (!requestingGM?.isGM || !requestingGM.active) {
    throw new Error("La intervención de comercio es exclusiva para un GM activo.");
  }
  return { authority, requestingGM };
}

export async function pauseTradeSessionAuthoritative(payload = {}, { requestingUserId } = {}) {
  const { authority, requestingGM } = requireRequestingGM(requestingUserId);
  const session = await tradeSessionStore.pauseSession({
    sessionId: payload.sessionId,
    authorityUserId: authority.id,
    requestingUserId: requestingGM.id,
    operationId: payload.operationId
  });
  publishTradeSession(session, { reason: "session-paused" });
  auditEvent(session, "pause", { message: `Pausado por GM ${requestingGM.id}` });
  return session;
}

export async function resumeTradeSessionAuthoritative(payload = {}, { requestingUserId } = {}) {
  const { authority, requestingGM } = requireRequestingGM(requestingUserId);
  const session = await tradeSessionStore.resumeSession({
    sessionId: payload.sessionId,
    authorityUserId: authority.id,
    requestingUserId: requestingGM.id,
    operationId: payload.operationId
  });
  publishTradeSession(session, { reason: "session-resumed" });
  auditEvent(session, "resume", { message: `Reanudado por GM ${requestingGM.id}` });
  return session;
}

export async function getGMTradeMonitorViewAuthoritative(sessionId, {
  requestingUserId = game.user?.id
} = {}) {
  const user = game.users?.get?.(String(requestingUserId ?? ""));
  if (!user?.isGM) throw new Error("La supervisión de comercio es exclusiva para GM.");
  const session = tradeSessionStore.getSession(sessionId);
  if (!session) throw new Error("La sesión de comercio no existe en la autoridad actual.");
  return buildGMTradeMonitorView({
    session,
    user,
    reservations: tradeSessionStore.getReservationsForSession(session.id),
    timeline: tradeAuditService.getTimeline(session.id, user)
  });
}

export function observeTradeSessionsAuthoritative({ activeOnly = true } = {}) {
  requirePrimaryGM();
  return tradeSessionStore.listSessions({ activeOnly }).map(buildGMTradeView);
}
