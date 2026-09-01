import { measureGridSpaces } from "./turn-state.js";
import {
  applyMovementConsumptionAuthoritative,
  clearLocalMovementReservations,
  completeGrantedMovementAuthoritative,
  configureMovementTransactionIntegration,
  ensureGrantedMovementAdvanceAuthoritative,
  getAvailableMovement,
  getGrantedMovement,
  getTurnContext
} from "./turn-system.js";
import { transactionCoordinator } from "../runtime/runtime-foundation.js";
import { isPrimaryActiveGM } from "../core/socket-requests.js";
import { logger } from "../utils/logger.js";

export const MOVEMENT_SOURCES = Object.freeze({
  TURN: "TURN",
  ATTRIBUTE: "ATTRIBUTE",
  GRANTED: "GRANTED",
  REACTION: "REACTION",
  GM_BYPASS: "GM_BYPASS",
  SYSTEM_MOVE: "SYSTEM_MOVE",
  SYSTEM_TELEPORT: "SYSTEM_TELEPORT"
});

const RULED_SOURCES = new Set([
  MOVEMENT_SOURCES.TURN,
  MOVEMENT_SOURCES.ATTRIBUTE,
  MOVEMENT_SOURCES.GRANTED,
  MOVEMENT_SOURCES.REACTION
]);

const POSITION_SYNC_TIMEOUT_MS = 1000;
const POSITION_SYNC_MAX_TIMEOUT_MS = 5000;
const POSITION_SYNC_POLL_MS = 20;

function getUser(userId) {
  return game.users?.get?.(userId) ?? Array.from(game.users ?? []).find(user => user.id === userId) ?? null;
}

function owns(actor, user) {
  if (user?.isGM) return true;
  return Boolean(actor && user && (
    actor.testUserPermission?.(user, "OWNER") === true ||
    Number(actor.ownership?.[user.id] ?? 0) >= 3
  ));
}

function point(value, label) {
  const x = Number(value?.x);
  const y = Number(value?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`Posición ${label} inválida.`);
  return { x, y };
}

function at(token, position) {
  return Number(token?.x) === Number(position?.x) && Number(token?.y) === Number(position?.y);
}

function onReservedPath(token, from, to) {
  const fromX = Number(from?.x);
  const fromY = Number(from?.y);
  const toX = Number(to?.x);
  const toY = Number(to?.y);
  const tokenX = Number(token?.x);
  const tokenY = Number(token?.y);
  if (![fromX, fromY, toX, toY, tokenX, tokenY].every(Number.isFinite)) return false;
  const dx = toX - fromX;
  const dy = toY - fromY;
  const px = tokenX - fromX;
  const py = tokenY - fromY;
  const cross = (dx * py) - (dy * px);
  if (Math.abs(cross) > 0.001) return false;
  const dot = (px * dx) + (py * dy);
  const lengthSquared = (dx * dx) + (dy * dy);
  return dot >= 0 && dot <= lengthSquared;
}

async function waitForAuthoritativeTokenPosition(token, { from, to, transactionId, source, timeoutMs }) {
  if (at(token, to)) return { status: "already-synchronized", waitedMs: 0 };
  if (!onReservedPath(token, from, to)) return { status: "unexpected-position", waitedMs: 0 };
  const boundedTimeoutMs = Math.min(
    POSITION_SYNC_MAX_TIMEOUT_MS,
    Math.max(0, Number(timeoutMs) || 0)
  );
  const startedAt = Date.now();
  logger.info("MOVEMENT", "waiting for authoritative Token synchronization", {
    transactionId,
    command: "movement.commit",
    tokenUuid: token?.uuid ?? null,
    source,
    status: "waiting",
    reasonCode: "POSITION_SYNC_PENDING",
    startedAtReservedOrigin: at(token, from),
    timeoutMs: boundedTimeoutMs
  });
  while (Date.now() - startedAt < boundedTimeoutMs) {
    const remainingMs = boundedTimeoutMs - (Date.now() - startedAt);
    await new Promise(resolve => globalThis.setTimeout(resolve, Math.min(POSITION_SYNC_POLL_MS, remainingMs)));
    if (at(token, to)) {
      const waitedMs = Date.now() - startedAt;
      logger.info("MOVEMENT", "authoritative Token synchronization completed", {
        transactionId,
        command: "movement.commit",
        tokenUuid: token?.uuid ?? null,
        source,
        status: "synchronized",
        reasonCode: "POSITION_SYNC_COMPLETED",
        waitedMs
      });
      return { status: "synchronized", waitedMs };
    }
    if (!onReservedPath(token, from, to)) return { status: "unexpected-position", waitedMs: Date.now() - startedAt };
  }
  const waitedMs = Date.now() - startedAt;
  return { status: "timeout", waitedMs, timeoutMs: boundedTimeoutMs };
}

function movementKindForSource(source) {
  if (source === MOVEMENT_SOURCES.GRANTED) return "granted";
  if (source === MOVEMENT_SOURCES.REACTION) return "reaction";
  return "turn";
}

function assertSourceMatches(source, available) {
  if (available.kind !== movementKindForSource(source)) {
    throw new Error("El origen no coincide con el movimiento disponible.");
  }
  if (source === MOVEMENT_SOURCES.ATTRIBUTE && available.state?.movementSource !== "attribute") {
    throw new Error("El movimiento no proviene de una tirada de atributo.");
  }
  if (source === MOVEMENT_SOURCES.TURN && available.state?.movementSource === "attribute") {
    throw new Error("El movimiento de atributo requiere origen ATTRIBUTE explícito.");
  }
}

function assertMovementContext(source, available, movement, context) {
  if (movement?.combatId && movement.combatId !== context.combatId) {
    throw new Error("El Combat del movimiento ya no está activo.");
  }
  if (movement?.round != null && Number(movement.round) !== Number(context.round)) {
    throw new Error("La ronda del movimiento ya no está activa.");
  }
  if (movement?.turn != null && Number(movement.turn) !== Number(context.turn)) {
    throw new Error("El turno del movimiento ya no está activo.");
  }
  if ([MOVEMENT_SOURCES.TURN, MOVEMENT_SOURCES.ATTRIBUTE].includes(source) &&
      movement?.combatantId && movement.combatantId !== available.combatant?.id) {
    throw new Error("El Combatant del movimiento ya no está activo.");
  }
  if (source === MOVEMENT_SOURCES.GRANTED) {
    if (movement?.id && movement.id !== available.state?.id) {
      throw new Error("La concesión de movimiento ya no está disponible.");
    }
    if (movement?.sourceCombatantId && movement.sourceCombatantId !== context.combatant?.id) {
      throw new Error("El turno que concedió el movimiento ya no está activo.");
    }
  }
  if (source === MOVEMENT_SOURCES.REACTION && movement?.pendingActionId &&
      movement.pendingActionId !== available.state?.pendingActionId) {
    throw new Error("La reacción de movimiento ya no está disponible.");
  }
}

function movementSerializationKey(source, payload, context, token) {
  const movement = payload.movement ?? {};
  if ([MOVEMENT_SOURCES.TURN, MOVEMENT_SOURCES.ATTRIBUTE].includes(source)) {
    return `turn:${movement.combatantId ?? payload.combatantId ?? context.combatant?.id ?? token.uuid}`;
  }
  if (source === MOVEMENT_SOURCES.GRANTED) return `grant:${movement.id ?? token.uuid}`;
  if (source === MOVEMENT_SOURCES.REACTION) return `reaction:${movement.pendingActionId ?? token.uuid}`;
  return `token:${token.uuid}`;
}

function hasCompletedPositionReceipt(scope, tokenUuid, position, transactionId) {
  const repository = transactionCoordinator.combatReceiptStore?.repository;
  const runtime = repository?.read?.(scope.combat);
  return Object.values(runtime?.receipts ?? {}).some(receipt => {
    if (receipt?.transactionId === transactionId || receipt?.command !== "movement.commit" ||
        receipt?.status !== "completed" || receipt?.tokenUuid !== tokenUuid) return false;
    const confirmed = receipt.prepared?.to ?? receipt.to ?? receipt.result?.result?.to;
    return Number(confirmed?.x) === Number(position?.x) && Number(confirmed?.y) === Number(position?.y);
  });
}

function uniform(transactionId, result, changed = true, reasonCode = null) {
  return { ok: reasonCode === null, transactionId, status: "completed", changed, result, reasonCode };
}

async function rollbackToken(token, from, transactionId) {
  if (!token || at(token, from)) return false;
  await token.update({ x: from.x, y: from.y }, {
    mtrolMovementInternal: true,
    mtrolMovementOperation: "rollback",
    mtrolMovementTransactionId: transactionId
  });
  return true;
}

export async function executeMovementTransaction(payload = {}, {
  requestingUserId = game.user?.id,
  positionSyncTimeoutMs = POSITION_SYNC_TIMEOUT_MS
} = {}) {
  if (!isPrimaryActiveGM()) throw new Error("Sólo el Primary GM puede confirmar movimiento.");
  const transactionId = String(payload.transactionId ?? payload.movement?.transactionId ?? "").trim();
  if (!transactionId) throw new Error("El movimiento requiere transactionId.");
  const source = String(payload.source ?? payload.movement?.source ?? "").toUpperCase();
  if (!RULED_SOURCES.has(source)) throw new Error(`Origen de movimiento inválido: ${source || "ausente"}.`);
  const token = await fromUuid(String(payload.tokenUuid ?? ""));
  const user = getUser(requestingUserId);
  if (!token || !owns(token.actor, user)) throw new Error("El usuario no controla el Token desplazado.");
  const context = getTurnContext();
  const requestedCombatId = payload.combatId ?? payload.movement?.combatId ?? null;
  if (!context.combat || context.combatId !== requestedCombatId) throw new Error("El Combat del movimiento ya no está activo.");
  const from = point(payload.from ?? payload.movement?.from, "inicial");
  const to = point(payload.to ?? payload.movement?.to, "final");
  const grid = token.parent?.grid ?? globalThis.canvas?.scene?.grid ?? {};
  const squareType = globalThis.CONST?.GRID_TYPES?.SQUARE ?? 1;
  let measuredDistance = 0;
  const scope = { combat: context.combat };

  try {
    if (Number(grid.type ?? squareType) !== squareType) {
      throw new Error("Fase 3 sólo admite grid cuadrada.");
    }
    measuredDistance = measureGridSpaces({
      fromX: from.x,
      fromY: from.y,
      toX: to.x,
      toY: to.y,
      gridSize: grid.size ?? globalThis.canvas?.grid?.size ?? 1
    });
    if (measuredDistance <= 0) return uniform(transactionId, { source, from, to, measuredDistance }, false);
    return await transactionCoordinator.execute(scope, {
      transactionId,
      command: "movement.commit",
      serializationKey: movementSerializationKey(source, payload, context, token),
      metadata: {
        combatId: context.combatId,
        combatantId: payload.combatantId ?? payload.movement?.combatantId ?? context.combatant?.id ?? null,
        actorUuid: token.actor?.uuid ?? null,
        tokenUuid: token.uuid,
        source,
        from,
        to,
        measuredDistance,
        requestingUserId
      },
      prepare: async () => {
        let currentContext = getTurnContext();
        if (currentContext.combatId !== context.combatId || currentContext.combatant?.id !== context.combatant?.id ||
            Number(currentContext.round) !== Number(context.round) || Number(currentContext.turn) !== Number(context.turn)) {
          throw new Error("El turno del movimiento ya no está activo.");
        }
        const synchronization = await waitForAuthoritativeTokenPosition(token, {
          from,
          to,
          transactionId,
          source,
          timeoutMs: positionSyncTimeoutMs
        });
        if (synchronization.status === "timeout") {
          throw Object.assign(
            new Error("La posición aplicada no se sincronizó en el Primary GM dentro del plazo permitido."),
            {
              reasonCode: "POSITION_SYNC_TIMEOUT",
              transactionNoEffects: true,
              synchronizationWaitedMs: synchronization.waitedMs,
              synchronizationTimeoutMs: synchronization.timeoutMs
            }
          );
        }
        if (!at(token, to)) {
          throw Object.assign(
            new Error("La posición aplicada no coincide con la intención."),
            { reasonCode: "MOVEMENT_POSITION_MISMATCH", transactionNoEffects: true }
          );
        }
        currentContext = getTurnContext();
        if (currentContext.combatId !== context.combatId || currentContext.combatant?.id !== context.combatant?.id ||
            Number(currentContext.round) !== Number(context.round) || Number(currentContext.turn) !== Number(context.turn)) {
          throw new Error("El turno del movimiento ya no está activo.");
        }
        const available = getAvailableMovement(token.actor, token, { context: currentContext });
        assertSourceMatches(source, available);
        assertMovementContext(source, available, payload.movement ?? payload, currentContext);
        if (measuredDistance > Number(available.remaining ?? 0)) {
          throw new Error(`Movimiento insuficiente: quedan ${available.remaining} cuadro(s).`);
        }
        return {
          source,
          from,
          to,
          measuredDistance,
          movementBefore: Number(available.remaining),
          movementAfter: Number(available.remaining) - measuredDistance,
          stateId: available.state?.id ?? null,
          pendingActionId: available.state?.pendingActionId ?? payload.movement?.pendingActionId ?? null,
          combatantId: available.combatant?.id ?? payload.combatantId ?? payload.movement?.combatantId ?? context.combatant?.id
        };
      },
      apply: async ({ prepared, checkpoint }) => {
        await checkpoint("position-applied", { to: prepared.to });
        const domainResult = await applyMovementConsumptionAuthoritative({
          tokenUuid: token.uuid,
          source,
          transactionId,
          movement: {
            ...(payload.movement ?? {}),
            id: prepared.stateId ?? payload.movement?.id,
            pendingActionId: prepared.pendingActionId,
            combatId: context.combatId,
            combatantId: prepared.combatantId,
            sourceCombatantId: payload.movement?.sourceCombatantId ?? context.combatant?.id,
            round: context.round,
            turn: context.turn,
            cost: measuredDistance
          }
        }, { requestingUserId });
        if (domainResult == null) {
          throw new Error("El estado autoritativo cambió antes de confirmar el consumo de movimiento.");
        }
        await checkpoint("consumption-applied", { movementAfter: prepared.movementAfter });
        const result = uniform(transactionId, {
          source,
          tokenUuid: token.uuid,
          from,
          to,
          measuredDistance,
          movementBefore: prepared.movementBefore,
          movementAfter: prepared.movementAfter,
          domainResult
        });
        logger.info("MOVEMENT", "movement transaction completed", result.result);
        return result;
      },
      reconcile: async receipt => {
        const prepared = receipt.prepared;
        if (!prepared) return { resolved: false };
        const available = getAvailableMovement(token.actor, token, { context: getTurnContext() });
        const remaining = Number(available.remaining ?? 0);
        if (at(token, prepared.to) && remaining === prepared.movementAfter) {
          return { resolved: true, result: receipt.result ?? uniform(transactionId, {
            source, tokenUuid: token.uuid, ...prepared, reconciled: "already-applied"
          }) };
        }
        if (at(token, prepared.to) && remaining === prepared.movementBefore) {
          const domainResult = await applyMovementConsumptionAuthoritative({
            tokenUuid: token.uuid,
            source,
            transactionId,
            movement: {
              ...(payload.movement ?? {}),
              id: prepared.stateId,
              pendingActionId: prepared.pendingActionId,
              combatId: context.combatId,
              combatantId: prepared.combatantId,
              sourceCombatantId: payload.movement?.sourceCombatantId ?? context.combatant?.id,
              round: context.round,
              turn: context.turn,
              cost: prepared.measuredDistance
            }
          }, { requestingUserId });
          return { resolved: true, result: uniform(transactionId, {
            source, tokenUuid: token.uuid, ...prepared, domainResult, reconciled: "consumption-completed"
          }) };
        }
        if (at(token, prepared.from) && remaining === prepared.movementAfter) {
          await token.update({ x: prepared.to.x, y: prepared.to.y }, {
            mtrolMovementInternal: true,
            mtrolMovementOperation: "reconcile-position",
            mtrolMovementTransactionId: transactionId
          });
          return { resolved: true, result: uniform(transactionId, {
            source, tokenUuid: token.uuid, ...prepared, reconciled: "position-completed"
          }) };
        }
        if (at(token, prepared.from) && remaining === prepared.movementBefore) {
          await token.update({ x: prepared.to.x, y: prepared.to.y }, {
            mtrolMovementInternal: true,
            mtrolMovementOperation: "reconcile-both",
            mtrolMovementTransactionId: transactionId
          });
          const domainResult = await applyMovementConsumptionAuthoritative({
            tokenUuid: token.uuid,
            source,
            transactionId,
            movement: {
              ...(payload.movement ?? {}),
              id: prepared.stateId,
              pendingActionId: prepared.pendingActionId,
              combatId: context.combatId,
              combatantId: prepared.combatantId,
              sourceCombatantId: payload.movement?.sourceCombatantId ?? context.combatant?.id,
              round: context.round,
              turn: context.turn,
              cost: prepared.measuredDistance
            }
          }, { requestingUserId });
          return { resolved: true, result: uniform(transactionId, {
            source, tokenUuid: token.uuid, ...prepared, domainResult, reconciled: "position-and-consumption-completed"
          }) };
        }
        return { resolved: false };
      }
    });
  } catch (error) {
    const receipt = transactionCoordinator.get(scope, transactionId);
    const positionAlreadyConfirmed = hasCompletedPositionReceipt(scope, token.uuid, to, transactionId);
    if ((!receipt || receipt.status === "failed") && !positionAlreadyConfirmed) {
      await rollbackToken(token, from, transactionId);
    }
    logger.warnOnce("MOVEMENT", "movement transaction rejected", {
      transactionId,
      command: "movement.commit",
      tokenUuid: token.uuid,
      source,
      measuredDistance,
      status: error.reasonCode === "RECOVERY_REQUIRED" ? "recovery-required" : "rejected",
      reasonCode: error.reasonCode ?? "MOVEMENT_REJECTED",
      synchronizationWaitedMs: error.synchronizationWaitedMs ?? null,
      synchronizationTimeoutMs: error.synchronizationTimeoutMs ?? null,
      error: error.message
    }, { key: `movement-rejected:${transactionId}` });
    throw error;
  }
}

export async function executeMovementRenounceTransaction(payload = {}, {
  requestingUserId = game.user?.id
} = {}) {
  if (!isPrimaryActiveGM()) throw new Error("Sólo el Primary GM puede cerrar movimiento concedido.");
  const transactionId = String(payload.transactionId ?? "").trim();
  const movementId = String(payload.movementId ?? "").trim();
  if (!transactionId || !movementId) throw new Error("La renuncia requiere transactionId y movementId.");
  const context = getTurnContext();
  if (!context.combat || context.combatId !== payload.combatId) {
    throw new Error("El Combat de la renuncia ya no está activo.");
  }
  const scope = { combat: context.combat };
  return transactionCoordinator.execute(scope, {
    transactionId,
    command: "movement.renounce",
    metadata: {
      combatId: context.combatId,
      combatantId: context.combatant?.id ?? null,
      round: context.round,
      turn: context.turn,
      movementId,
      reason: payload.reason ?? "skipped",
      requestingUserId
    },
    prepare: async () => {
      const current = getGrantedMovement(null, context);
      if (!current || current.id !== movementId) throw new Error("La concesión ya no está disponible.");
      return {
        combatantId: context.combatant.id,
        round: context.round,
        turn: context.turn,
        movementId,
        reason: payload.reason ?? "skipped"
      };
    },
    apply: async ({ prepared, checkpoint }) => {
      await checkpoint("renounce-requested", { movementId });
      const domainResult = await completeGrantedMovementAuthoritative({
        movementId,
        reason: prepared.reason
      }, { requestingUserId });
      await checkpoint("grant-closed-and-turn-advanced", { movementId });
      return uniform(transactionId, { movementId, domainResult });
    },
    reconcile: async receipt => {
      const prepared = receipt.prepared;
      if (!prepared) return { resolved: false };
      const currentContext = getTurnContext();
      if (currentContext.combatId !== receipt.combatId) return { resolved: false };
      if (currentContext.combatant?.id !== prepared.combatantId ||
          currentContext.round !== prepared.round || currentContext.turn !== prepared.turn) {
        return { resolved: true, result: receipt.result ?? uniform(transactionId, {
          movementId, reconciled: "turn-already-advanced"
        }) };
      }
      const current = getGrantedMovement(null, currentContext);
      if (current?.id === movementId) {
        const domainResult = await completeGrantedMovementAuthoritative({
          movementId,
          reason: prepared.reason
        }, { requestingUserId });
        return { resolved: true, result: uniform(transactionId, {
          movementId, domainResult, reconciled: "renounce-completed"
        }) };
      }
      if (!current) {
        const domainResult = await ensureGrantedMovementAdvanceAuthoritative({
          movementId,
          reason: prepared.reason
        });
        return { resolved: true, result: uniform(transactionId, {
          movementId, domainResult, reconciled: "advance-completed"
        }) };
      }
      return { resolved: false };
    }
  });
}

export async function recoverMovementTransactions(combat = game.combat) {
  if (!isPrimaryActiveGM() || !combat) return { recoveredIds: [], requiredIds: [] };
  const repository = transactionCoordinator.combatReceiptStore?.repository;
  const runtime = repository?.read?.(combat);
  const recoveredIds = [];
  const requiredIds = [];
  for (const receipt of Object.values(runtime?.receipts ?? {})) {
    if (!["movement.commit", "movement.renounce"].includes(receipt?.command) ||
        !["processing", "prepared", "applying", "applied", "recovery-required"].includes(receipt.status)) continue;
    const prepared = receipt.prepared ?? {};
    try {
      if (receipt.command === "movement.renounce") {
        await executeMovementRenounceTransaction({
          transactionId: receipt.transactionId,
          combatId: receipt.combatId ?? combat.id,
          movementId: receipt.movementId ?? prepared.movementId,
          reason: receipt.reason ?? prepared.reason
        }, { requestingUserId: receipt.requestingUserId ?? game.user.id });
      } else await executeMovementTransaction({
        transactionId: receipt.transactionId,
        combatId: receipt.combatId ?? combat.id,
        combatantId: receipt.combatantId ?? prepared.combatantId,
        tokenUuid: receipt.tokenUuid,
        source: receipt.source ?? prepared.source,
        from: receipt.from ?? prepared.from,
        to: receipt.to ?? prepared.to,
        movement: {
          transactionId: receipt.transactionId,
          combatId: receipt.combatId ?? combat.id,
          combatantId: receipt.combatantId ?? prepared.combatantId,
          id: prepared.stateId,
          pendingActionId: prepared.pendingActionId,
          from: receipt.from ?? prepared.from,
          to: receipt.to ?? prepared.to,
          source: receipt.source ?? prepared.source
        }
      }, { requestingUserId: receipt.requestingUserId ?? game.user.id });
      recoveredIds.push(receipt.transactionId);
    } catch (error) {
      logger.warnOnce("RECOVERY", "movement recovery failed", {
        transactionId: receipt.transactionId,
        command: receipt.command,
        tokenUuid: receipt.tokenUuid ?? null,
        status: "recovery-required",
        reasonCode: error?.reasonCode ?? "MOVEMENT_RECOVERY_FAILED",
        error
      }, { key: `movement-recovery:${receipt.transactionId}` });
      requiredIds.push(receipt.transactionId);
    }
  }
  clearLocalMovementReservations();
  if (requiredIds.length > 0 || (runtime?.recovery?.requiredTransactionIds?.length ?? 0) > 0) {
    const newlyRequired = [];
    await repository.mutate(combat, draft => {
      const notified = new Set(draft.recovery.notifiedTransactionIds ?? []);
      for (const transactionId of requiredIds) {
        if (!notified.has(transactionId)) newlyRequired.push(transactionId);
        notified.add(transactionId);
      }
      draft.recovery.requiredTransactionIds = [...new Set(requiredIds)];
      draft.recovery.notifiedTransactionIds = [...notified];
      draft.recovery.lastMovementRunAt = Date.now();
    });
    if (newlyRequired.length > 0) {
      ui.notifications.warn(
        `${newlyRequired.length} movimiento(s) requieren revisión manual del GM. ` +
        "No se aplicaron cambios ambiguos."
      );
    }
  }
  return { recoveredIds, requiredIds };
}

configureMovementTransactionIntegration({
  execute: executeMovementTransaction,
  renounce: executeMovementRenounceTransaction
});
