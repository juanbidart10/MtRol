import { logger } from "../utils/logger.js";

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export const MTROL_TIE_BREAK_DELAY_MS = 450;

export async function showTieBreakerOverlay({ delayMs = MTROL_TIE_BREAK_DELAY_MS } = {}) {
  let label = null;
  try {
    const stage = globalThis.canvas?.stage;
    const TextClass = globalThis.PIXI?.Text;
    if (stage?.addChild && TextClass) {
      label = new TextClass({
        text: "DADO DE DESEMPATE",
        style: {
          fill: "#f4d27a",
          fontFamily: "Cinzel, serif",
          fontSize: 44,
          fontWeight: "700",
          stroke: { color: "#160b05", width: 6 }
        }
      });
      label.anchor?.set?.(0.5);
      label.position?.set?.(
        Number(globalThis.canvas?.dimensions?.width ?? 0) / 2,
        Number(globalThis.canvas?.dimensions?.height ?? 0) / 2
      );
      label.zIndex = 100000;
      stage.addChild(label);
    }
  } catch (error) {
    logger.debug("OPPOSITION", "tie overlay unavailable", { error: error.message });
  }
  await new Promise(resolve => setTimeout(resolve, Math.max(0, delayMs)));
  return () => {
    try {
      label?.parent?.removeChild?.(label);
      label?.destroy?.();
    } catch (_error) {
      // El overlay es sólo visual; su desmontaje nunca afecta la resolución.
    }
  };
}

function isFumble(rollData) {
  return rollData?.isFumble === true || rollData?.pifia === true;
}

function getTotal(rollData) {
  return toNumber(rollData?.total, 0);
}

export async function rollMtrolTieBreaker({ delayMs = MTROL_TIE_BREAK_DELAY_MS } = {}) {
  const removeOverlay = await showTieBreakerOverlay({ delayMs });
  let roll;
  try {
    roll = await new Roll("1d10").evaluate();
  } finally {
    removeOverlay();
  }

  const total =
    toNumber(roll.total, 0);

  const result = {
    total,
    winner: total <= 5 ? "attacker" : "defender",
    roll
  };

  logger.debug("OPPOSITION", "tie breaker rolled", {
    total: result.total,
    winner: result.winner
  });

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
