export const MTROL_TURN_FLAG = "turnState";
export const MTROL_COOLDOWN_FLAG = "cooldown";
export const MTROL_PREPARATION_FLAG = "preparation";
export const MTROL_PREPARATION_RESERVATION_FLAG = "preparationReservation";
export const MTROL_TURN_ADVANCE_FLAG = "turnAdvance";
export const MTROL_TURN_RESOLUTION_FLAG = "turnResolution";
export const MTROL_PREPARATION_MAX = 5;

const OFFENSIVE_ACTION_TYPES = new Set([
  "attack",
  "basicAttack",
  "combatSkill",
  "control",
  "damage"
]);

function integer(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function nonNegativeInteger(value, fallback = 0) {
  return Math.max(0, integer(value, fallback));
}

export function createTurnState({
  combatId = null,
  round = 0,
  turn = 0
} = {}) {
  return {
    combatId,
    round: nonNegativeInteger(round),
    turn: nonNegativeInteger(turn),
    baseMovementRemaining: 1,
    extraMovementRemaining: 0,
    movementSpent: 0,
    actionConsumed: false
  };
}

export function normalizeTurnState(state = {}) {
  return {
    combatId: state?.combatId ?? null,
    round: nonNegativeInteger(state?.round),
    turn: nonNegativeInteger(state?.turn),
    baseMovementRemaining: nonNegativeInteger(state?.baseMovementRemaining),
    extraMovementRemaining: nonNegativeInteger(state?.extraMovementRemaining),
    movementSpent: nonNegativeInteger(state?.movementSpent),
    actionConsumed: state?.actionConsumed === true
  };
}

export function movementRemaining(state = {}) {
  const normalized = normalizeTurnState(state);
  return normalized.baseMovementRemaining + normalized.extraMovementRemaining;
}

export function spendMovement(state, spaces) {
  const cost = nonNegativeInteger(spaces);
  const current = normalizeTurnState(state);

  if (cost > movementRemaining(current)) {
    return { allowed: false, state: current };
  }

  const baseSpent = Math.min(current.baseMovementRemaining, cost);
  const extraSpent = cost - baseSpent;

  return {
    allowed: true,
    state: {
      ...current,
      baseMovementRemaining: current.baseMovementRemaining - baseSpent,
      extraMovementRemaining: current.extraMovementRemaining - extraSpent,
      movementSpent: current.movementSpent + cost
    }
  };
}

export function movementFromFinalResult(resolution = {}) {
  if (
    resolution?.pifia === true ||
    resolution?.fumble === true ||
    resolution?.failed === true ||
    resolution?.success === false
  ) return 0;

  const finalResult = Number(
    resolution?.finalResult ??
    resolution?.total ??
    0
  );

  if (!Number.isFinite(finalResult)) return 0;
  return Math.max(0, Math.floor(finalResult / 10));
}

export function grantExtraMovement(state, resolution = {}, {
  fullAction = false
} = {}) {
  const current = normalizeTurnState(state);
  const granted = movementFromFinalResult(resolution);

  return {
    granted,
    state: {
      ...current,
      baseMovementRemaining: fullAction ? 0 : current.baseMovementRemaining,
      extraMovementRemaining: current.extraMovementRemaining + granted,
      actionConsumed: fullAction ? true : current.actionConsumed
    }
  };
}

export function consumeOffensiveAction(state = {}) {
  return {
    ...normalizeTurnState(state),
    baseMovementRemaining: 0,
    extraMovementRemaining: 0,
    actionConsumed: true
  };
}

export function sanitizePreparation(value) {
  return Math.min(MTROL_PREPARATION_MAX, nonNegativeInteger(value));
}

export function consumeTurnForPreparation(state = {}) {
  return {
    ...normalizeTurnState(state),
    baseMovementRemaining: 0,
    extraMovementRemaining: 0,
    actionConsumed: true
  };
}

export function classifyTurnAction(item = {}) {
  const actionType = String(item?.system?.actionType ?? "utility");

  if (actionType === "defense") return "reaction";
  if (actionType === "movement") return "movement";
  if (OFFENSIVE_ACTION_TYPES.has(actionType)) return "offensive";

  const hasDamage = String(item?.system?.danio ?? "").trim().length > 0;
  const requiresOpposition = item?.system?.requiresOpposition === true ||
    item?.system?.requiresOpposition === "true";

  return hasDamage || requiresOpposition ? "offensive" : "normal";
}

export function getCooldownStatus({
  currentCombatId = null,
  currentRound = 0,
  cooldownRounds = 0,
  usage = null
} = {}) {
  const configured = nonNegativeInteger(cooldownRounds);
  const usedAtRound = nonNegativeInteger(usage?.usedAtRound);
  const applies = configured > 0 &&
    usage?.combatId === currentCombatId &&
    usedAtRound > 0;
  const availableAtRound = applies
    ? usedAtRound + configured + 1
    : nonNegativeInteger(currentRound);
  const available = !applies || nonNegativeInteger(currentRound) >= availableAtRound;

  return {
    configured,
    usedAtRound: applies ? usedAtRound : null,
    availableAtRound,
    available,
    roundsRemaining: available
      ? 0
      : Math.max(0, availableAtRound - nonNegativeInteger(currentRound))
  };
}

export function measureGridSpaces({
  fromX = 0,
  fromY = 0,
  toX = 0,
  toY = 0,
  gridSize = 1
} = {}) {
  const size = Math.max(1, Number(gridSize) || 1);
  const horizontal = Math.ceil(Math.abs(Number(toX) - Number(fromX)) / size);
  const vertical = Math.ceil(Math.abs(Number(toY) - Number(fromY)) / size);

  return Math.max(horizontal, vertical);
}
