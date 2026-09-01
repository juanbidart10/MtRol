import { MTROL_TURN_FLAG, normalizeTurnState } from "./turn-state.js";

export function readCombatantFlag(combatant, key) {
  return combatant?.getFlag?.("mtrol", key) ?? combatant?.flags?.mtrol?.[key] ?? null;
}

export async function writeCombatantFlag(combatant, key, value) {
  if (!combatant?.setFlag) throw new Error("Combatant inválido para persistir estado de turno.");
  await combatant.setFlag("mtrol", key, value);
  return value;
}

export function readTurnState(combatant) {
  return normalizeTurnState(readCombatantFlag(combatant, MTROL_TURN_FLAG) ?? {});
}

export async function writeTurnState(combatant, state) {
  const normalized = normalizeTurnState(state);
  await writeCombatantFlag(combatant, MTROL_TURN_FLAG, normalized);
  return readTurnState(combatant);
}

