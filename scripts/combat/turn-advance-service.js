import { MTROL_TURN_ADVANCE_FLAG } from "./turn-state.js";
import { readCombatantFlag, writeCombatantFlag } from "./turn-state-repository.js";

// Cache reentrante; la garantía durable es el flag MTROL_TURN_ADVANCE_FLAG.
const turnAdvanceLocks = new Set();

function turnSignature(context) {
  return `${context.combatId}:${context.round}:${context.turn}:${context.combatant?.id ?? ""}`;
}

export async function advanceTurnOnce(context, {
  reason = "completed-action",
  completionId = null
} = {}) {
  if (!game.user?.isGM) throw new Error("El avance de turno requiere autoridad GM.");
  if (!context?.combat || !context.combatant) throw new Error("No hay un turno activo.");
  const signature = turnSignature(context);
  if (turnAdvanceLocks.has(signature)) return { advanced: false, duplicate: true, signature };
  const previous = readCombatantFlag(context.combatant, MTROL_TURN_ADVANCE_FLAG);
  if (previous?.signature === signature && ["advancing", "complete"].includes(previous.status)) {
    return { advanced: false, duplicate: true, signature };
  }

  turnAdvanceLocks.add(signature);
  await writeCombatantFlag(context.combatant, MTROL_TURN_ADVANCE_FLAG, {
    signature,
    status: "advancing",
    reason,
    completionId,
    requestedAt: Date.now()
  });
  try {
    await context.combat.nextTurn();
    await writeCombatantFlag(context.combatant, MTROL_TURN_ADVANCE_FLAG, {
      signature,
      status: "complete",
      reason,
      completionId,
      advancedAt: Date.now()
    });
    return { advanced: true, duplicate: false, signature };
  } catch (error) {
    await writeCombatantFlag(context.combatant, MTROL_TURN_ADVANCE_FLAG, null);
    throw error;
  } finally {
    turnAdvanceLocks.delete(signature);
  }
}

export function clearTurnAdvanceLocks() {
  turnAdvanceLocks.clear();
}

