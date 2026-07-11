function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function isFumble(rollData) {
  return rollData?.isFumble === true || rollData?.pifia === true;
}

function getTotal(rollData) {
  return toNumber(rollData?.total, 0);
}

export async function rollMtrolTieBreaker() {
  const roll =
    await new Roll("1d10").evaluate();

  const total =
    toNumber(roll.total, 0);

  const result = {
    total,
    winner: total <= 5 ? "attacker" : "defender",
    roll
  };

  console.log("MTROL | Tie breaker rolled", result);

  return result;
}

export async function resolveOpposedAction(pendingAction) {
  const attackerRoll =
    pendingAction?.attackerRoll ?? null;

  const defenderRoll =
    pendingAction?.defenderRoll ?? null;

  if (!pendingAction || !attackerRoll || !defenderRoll) {
    throw new Error("Resolucion enfrentada incompleta.");
  }

  const attackerTotal =
    getTotal(attackerRoll);

  const defenderTotal =
    getTotal(defenderRoll);

  if (isFumble(attackerRoll)) {
    return {
      success: false,
      reason: "attacker-fumble",
      attackerTotal,
      defenderTotal,
      tieBreaker: null
    };
  }

  if (isFumble(defenderRoll)) {
    return {
      success: true,
      reason: "defender-fumble",
      attackerTotal,
      defenderTotal,
      tieBreaker: null
    };
  }

  if (attackerTotal > defenderTotal) {
    return {
      success: true,
      reason: "attacker-higher",
      attackerTotal,
      defenderTotal,
      tieBreaker: null
    };
  }

  if (defenderTotal > attackerTotal) {
    return {
      success: false,
      reason: "defender-higher",
      attackerTotal,
      defenderTotal,
      tieBreaker: null
    };
  }

  const tieBreaker =
    await rollMtrolTieBreaker();

  return {
    success: tieBreaker.winner === "attacker",
    reason: tieBreaker.winner === "attacker" ? "tie-attacker" : "tie-defender",
    attackerTotal,
    defenderTotal,
    tieBreaker
  };
}
