import { isPrimaryActiveGM } from "../core/socket-requests.js";

export function movementTraceEnabled() {
  return globalThis.CONFIG?.debug?.mtrolMovementTrace === true;
}

export function traceMovement(stage, data = {}) {
  if (!movementTraceEnabled()) return;
  const combat = globalThis.game?.combat;
  const context = {
    traceId: data.traceId ?? data.transactionId ?? data.receiptId ?? null,
    transactionId: data.transactionId ?? null,
    receiptId: data.receiptId ?? data.transactionId ?? null,
    localUserId: globalThis.game?.user?.id ?? null,
    initiatingUserId: data.initiatingUserId ?? data.userId ?? data.requestingUserId ?? null,
    isPrimaryGM: isPrimaryActiveGM(),
    actorUuid: data.actorUuid ?? null,
    tokenUuid: data.tokenUuid ?? null,
    combatId: data.combatId ?? combat?.id ?? null,
    round: data.round ?? Number(combat?.round ?? 0),
    turn: data.turn ?? Number(combat?.turn ?? -1),
    activeCombatantId: data.activeCombatantId ?? combat?.combatant?.id ?? null,
    stage,
    timestamp: new Date().toISOString()
  };
  console.info("[MTROL][MOVEMENT-TRACE]", JSON.stringify({
    ...context,
    ...data,
    stage: context.stage,
    timestamp: context.timestamp
  }));
}
