import { MTROL_COOLDOWN_FLAG, getCooldownStatus } from "../combat/turn-state.js";

export function getActionCooldownStatus(item, context = {}) {
  const usage = item?.getFlag?.("mtrol", MTROL_COOLDOWN_FLAG) ??
    item?.flags?.mtrol?.[MTROL_COOLDOWN_FLAG] ??
    null;
  return getCooldownStatus({
    currentCombatId: context.combatId,
    currentRound: context.round,
    cooldownRounds: item?.system?.cooldown,
    usage
  });
}

export async function markActionCooldownUsed(item, context = {}) {
  const cooldownRounds = Math.max(0, Math.trunc(Number(item?.system?.cooldown) || 0));
  if (cooldownRounds <= 0 || !context.combat) {
    return { changed: false, cooldownRounds };
  }
  const usage = {
    combatId: context.combatId,
    usedAtRound: context.round,
    cooldownRounds
  };
  await item.setFlag("mtrol", MTROL_COOLDOWN_FLAG, usage);
  return { changed: true, cooldownRounds, usage };
}

