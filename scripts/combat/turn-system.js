import {
  MTROL_COOLDOWN_FLAG,
  MTROL_PREPARATION_FLAG,
  MTROL_PREPARATION_MAX,
  MTROL_PREPARATION_RESERVATION_FLAG,
  MTROL_TURN_ADVANCE_FLAG,
  MTROL_TURN_FLAG,
  MTROL_TURN_RESOLUTION_FLAG,
  classifyTurnAction,
  consumeOffensiveAction,
  consumeTurnForPreparation,
  createTurnState,
  getCooldownStatus,
  grantExtraMovement,
  measureGridSpaces,
  movementRemaining,
  normalizeTurnState,
  sanitizePreparation,
  spendMovement
} from "./turn-state.js";

import {
  getPrimaryActiveGM,
  isPrimaryActiveGM,
  requestPrimaryGM
} from "../core/socket-requests.js";

import {
  buildSpecialAbilitySlotView,
  findSpecialAbilitySlotForItem,
  MTROL_ORB_CONTEXTUAL_HANDLER,
  resolveSpecialAbilitySlot,
  updateSpecialAbilitySlot,
  validateSpecialAbilityExecution
} from "./special-ability-service.js";

const localMovementReservations = new Map();
const preparationOperationLocks = new Set();
const turnAdvanceLocks = new Set();
const PREPARATION_RESERVATION_TTL_MS = 120000;
const PREPARATION_LAST_CONSUMPTION_FLAG = "preparationLastConsumption";

function getUsers() {
  return Array.from(game.users ?? []);
}

function getUser(userId) {
  return game.users?.get?.(userId) ??
    getUsers().find(user => user.id === userId) ??
    null;
}

function userOwnsActor(actor, userId) {
  const user = getUser(userId);
  if (user?.isGM) return true;
  if (!actor || !user) return false;
  if (typeof actor.testUserPermission === "function") {
    return actor.testUserPermission(user, "OWNER");
  }
  return Number(actor.ownership?.[userId] ?? 0) >= 3;
}

function activeCombat(combat = game.combat) {
  return combat?.started || Number(combat?.round ?? 0) > 0 ? combat : null;
}

export function getTurnContext(combat = game.combat) {
  const current = activeCombat(combat);
  const combatant = current?.combatant ??
    current?.turns?.[Number(current?.turn ?? -1)] ??
    null;

  return {
    combat: current,
    combatId: current?.id ?? null,
    round: Number(current?.round ?? 0),
    turn: Number(current?.turn ?? -1),
    combatant,
    actor: combatant?.actor ?? null
  };
}

export function getCombatantForActor(actor, combat = game.combat) {
  if (!actor || !activeCombat(combat)) return null;
  const current = combat.combatant;
  if (current?.actor?.uuid === actor.uuid || current?.actor?.id === actor.id) return current;
  return Array.from(combat.combatants ?? combat.turns ?? []).find(combatant =>
    combatant?.actor?.uuid === actor.uuid || combatant?.actor?.id === actor.id
  ) ?? null;
}

function getCombatantForToken(tokenDocument, combat = game.combat) {
  const combatants = Array.from(combat?.combatants ?? combat?.turns ?? []);
  return combatants.find(combatant =>
    (tokenDocument?.id && combatant?.tokenId === tokenDocument.id) ||
    (tokenDocument?.uuid && combatant?.token?.uuid === tokenDocument.uuid)
  ) ?? getCombatantForActor(tokenDocument?.actor, combat);
}

export function getCombatantTurnState(combatant) {
  return normalizeTurnState(
    combatant?.getFlag?.("mtrol", MTROL_TURN_FLAG) ??
    combatant?.flags?.mtrol?.[MTROL_TURN_FLAG] ??
    {}
  );
}

function isCurrentState(context, combatant, state) {
  return context.combatant?.id === combatant?.id &&
    state.combatId === context.combatId &&
    state.round === context.round &&
    state.turn === context.turn;
}

async function writeTurnState(combatant, state) {
  await combatant.setFlag("mtrol", MTROL_TURN_FLAG, normalizeTurnState(state));
  return getCombatantTurnState(combatant);
}

function actorFlag(actor, key) {
  return actor?.getFlag?.("mtrol", key) ?? actor?.flags?.mtrol?.[key] ?? null;
}

function combatantFlag(combatant, key) {
  return combatant?.getFlag?.("mtrol", key) ?? combatant?.flags?.mtrol?.[key] ?? null;
}

function turnSignature(context) {
  return `${context.combatId}:${context.round}:${context.turn}:${context.combatant?.id ?? ""}`;
}

export function getTurnResolutionState(combatant = getTurnContext().combatant) {
  const value = combatantFlag(combatant, MTROL_TURN_RESOLUTION_FLAG);
  return value && typeof value === "object" ? value : null;
}

async function setTurnResolutionState(combatant, value) {
  await combatant.setFlag("mtrol", MTROL_TURN_RESOLUTION_FLAG, value);
  return value;
}

async function advanceCurrentTurnOnce(context, {
  reason = "completed-action",
  completionId = null
} = {}) {
  if (!game.user?.isGM) throw new Error("El avance de turno requiere autoridad GM.");
  if (!context?.combat || !context.combatant) throw new Error("No hay un turno activo.");
  const signature = turnSignature(context);
  if (turnAdvanceLocks.has(signature)) return { advanced: false, duplicate: true, signature };
  const previous = combatantFlag(context.combatant, MTROL_TURN_ADVANCE_FLAG);
  if (previous?.signature === signature && ["advancing", "complete"].includes(previous.status)) {
    return { advanced: false, duplicate: true, signature };
  }

  turnAdvanceLocks.add(signature);
  await context.combatant.setFlag("mtrol", MTROL_TURN_ADVANCE_FLAG, {
    signature,
    status: "advancing",
    reason,
    completionId,
    requestedAt: Date.now()
  });
  try {
    await context.combat.nextTurn();
    await context.combatant.setFlag("mtrol", MTROL_TURN_ADVANCE_FLAG, {
      signature,
      status: "complete",
      reason,
      completionId,
      advancedAt: Date.now()
    });
    return { advanced: true, duplicate: false, signature };
  } catch (error) {
    await context.combatant.setFlag("mtrol", MTROL_TURN_ADVANCE_FLAG, null);
    throw error;
  } finally {
    turnAdvanceLocks.delete(signature);
  }
}

export function getPreparation(actor) {
  return sanitizePreparation(actorFlag(actor, MTROL_PREPARATION_FLAG));
}

function getPreparationReservation(actor) {
  const reservation = actorFlag(actor, MTROL_PREPARATION_RESERVATION_FLAG);
  return reservation && typeof reservation === "object" ? reservation : null;
}

async function updatePreparationFlags(actor, changes) {
  const update = {};
  for (const [key, value] of Object.entries(changes)) {
    update[`flags.mtrol.${key}`] = value;
  }
  await actor.update(update);
}

export function getPrepareGuard(actor, userId = game.user?.id) {
  const context = getTurnContext();
  if (!context.combat || !context.combatant) {
    return { allowed: false, reason: "Prepararse sólo puede usarse durante un turno de combate." };
  }
  if (!userOwnsActor(actor, userId)) {
    return { allowed: false, reason: "El usuario no controla al Actor." };
  }
  if (context.actor?.uuid !== actor?.uuid && context.actor?.id !== actor?.id) {
    return { allowed: false, reason: "No es el turno de este personaje." };
  }
  const state = getCombatantTurnState(context.combatant);
  if (!isCurrentState(context, context.combatant, state)) {
    return { allowed: false, reason: "El estado del turno todavía se está sincronizando." };
  }
  if (state.actionConsumed) {
    return { allowed: false, reason: "La acción de este turno ya fue consumida." };
  }
  if (state.movementSpent > 0) {
    return { allowed: false, reason: "No puedes Prepararte después de haberte movido." };
  }
  if (getPreparation(actor) >= MTROL_PREPARATION_MAX) {
    return { allowed: false, reason: "La Preparación ya alcanzó su máximo de +5." };
  }
  if (getPreparationReservation(actor)) {
    return { allowed: false, reason: "La Preparación está siendo aplicada a una fórmula." };
  }
  return { allowed: true, reason: null };
}

export function canPrepare(actor, userId = game.user?.id) {
  return getPrepareGuard(actor, userId).allowed;
}

async function prepareAuthoritative({ actorUuid } = {}, {
  requestingUserId = game.user?.id
} = {}) {
  if (!game.user?.isGM) throw new Error("Prepararse requiere autoridad GM.");
  const actor = await resolveActorByUuid(actorUuid);
  if (!actor) throw new Error("No se encontró el Actor.");
  const lockKey = actor.uuid;
  if (preparationOperationLocks.has(lockKey)) throw new Error("Prepararse ya está en curso.");
  preparationOperationLocks.add(lockKey);
  try {
    const guard = getPrepareGuard(actor, requestingUserId);
    if (!guard.allowed) throw new Error(guard.reason);
    const context = getTurnContext();
    const previous = getPreparation(actor);
    const next = sanitizePreparation(previous + 1);
    await updatePreparationFlags(actor, { [MTROL_PREPARATION_FLAG]: next });
    try {
      await writeTurnState(context.combatant,
        consumeTurnForPreparation(getCombatantTurnState(context.combatant)));
    } catch (error) {
      await updatePreparationFlags(actor, { [MTROL_PREPARATION_FLAG]: previous });
      throw error;
    }
    await advanceCurrentTurnOnce(context, {
      reason: "prepare",
      completionId: `prepare:${actor.uuid}:${context.round}:${context.turn}`
    });
    return { previous, value: next, combatId: context.combatId };
  } finally {
    preparationOperationLocks.delete(lockKey);
  }
}

export async function prepare(actor) {
  if (!actor) throw new Error("No se encontró el Actor.");
  if (game.user?.isGM && isPrimaryActiveGM()) {
    return prepareAuthoritative({ actorUuid: actor.uuid });
  }
  const response = await requestPrimaryGM("mtrolPrepareTurn", { actorUuid: actor.uuid });
  if (!response.ok) throw new Error(response.error ?? "No se pudo Preparar al personaje.");
  return response.result;
}

async function setPreparationAuthoritative({ actorUuid, value } = {}, {
  requestingUserId = game.user?.id
} = {}) {
  if (!game.user?.isGM || !getUser(requestingUserId)?.isGM) {
    throw new Error("Sólo el GM puede modificar Preparación manualmente.");
  }
  const actor = await resolveActorByUuid(actorUuid);
  if (!actor) throw new Error("No se encontró el Actor.");
  const sanitized = sanitizePreparation(value);
  await updatePreparationFlags(actor, {
    [MTROL_PREPARATION_FLAG]: sanitized,
    [MTROL_PREPARATION_RESERVATION_FLAG]: null
  });
  return { value: sanitized };
}

export async function setPreparation(actor, value) {
  if (!actor) throw new Error("No se encontró el Actor.");
  if (game.user?.isGM && isPrimaryActiveGM()) {
    return setPreparationAuthoritative({ actorUuid: actor.uuid, value });
  }
  const response = await requestPrimaryGM("mtrolSetPreparation", { actorUuid: actor.uuid, value });
  if (!response.ok) throw new Error(response.error ?? "No se pudo modificar Preparación.");
  return response.result;
}

async function reservePreparationAuthoritative({ actorUuid, consumptionId } = {}, {
  requestingUserId = game.user?.id
} = {}) {
  if (!game.user?.isGM) throw new Error("Consumir Preparación requiere autoridad GM.");
  const actor = await resolveActorByUuid(actorUuid);
  if (!actor || !userOwnsActor(actor, requestingUserId)) throw new Error("El usuario no controla al Actor.");
  const lockKey = actor.uuid;
  if (preparationOperationLocks.has(lockKey)) throw new Error("La Preparación ya está siendo modificada.");
  preparationOperationLocks.add(lockKey);
  try {
    const last = actorFlag(actor, PREPARATION_LAST_CONSUMPTION_FLAG);
    if (last?.id === consumptionId) return { bonus: 0, duplicate: true, consumptionId };
    const existing = getPreparationReservation(actor);
    if (existing) {
      const stale = Date.now() - Number(existing.createdAt ?? 0) > PREPARATION_RESERVATION_TTL_MS;
      if (!stale) throw new Error("La Preparación ya está reservada por otra fórmula.");
      await updatePreparationFlags(actor, {
        [MTROL_PREPARATION_FLAG]: 0,
        [MTROL_PREPARATION_RESERVATION_FLAG]: null,
        [PREPARATION_LAST_CONSUMPTION_FLAG]: {
          id: existing.id,
          value: sanitizePreparation(existing.value),
          completedAt: Date.now(),
          recoveredAsConsumed: true
        }
      });
      return { bonus: 0, duplicate: false, consumptionId: null };
    }
    const bonus = getPreparation(actor);
    if (bonus <= 0) return { bonus: 0, duplicate: false, consumptionId: null };
    const reservation = {
      id: String(consumptionId),
      value: bonus,
      createdAt: Date.now(),
      requestingUserId
    };
    await updatePreparationFlags(actor, {
      [MTROL_PREPARATION_RESERVATION_FLAG]: reservation
    });
    return { bonus, duplicate: false, consumptionId: reservation.id };
  } finally {
    preparationOperationLocks.delete(lockKey);
  }
}

async function completePreparationAuthoritative({ actorUuid, consumptionId } = {}, {
  requestingUserId = game.user?.id
} = {}) {
  if (!game.user?.isGM) throw new Error("Consumir Preparación requiere autoridad GM.");
  const actor = await resolveActorByUuid(actorUuid);
  if (!actor || !userOwnsActor(actor, requestingUserId)) throw new Error("El usuario no controla al Actor.");
  const reservation = getPreparationReservation(actor);
  const last = actorFlag(actor, PREPARATION_LAST_CONSUMPTION_FLAG);
  if (!reservation) return { consumed: last?.id === consumptionId, value: 0 };
  if (reservation.id !== consumptionId) throw new Error("La reserva de Preparación no coincide con esta fórmula.");
  const value = sanitizePreparation(reservation.value);
  await updatePreparationFlags(actor, {
    [MTROL_PREPARATION_FLAG]: 0,
    [MTROL_PREPARATION_RESERVATION_FLAG]: null,
    [PREPARATION_LAST_CONSUMPTION_FLAG]: {
      id: reservation.id,
      value,
      completedAt: Date.now()
    }
  });
  return { consumed: true, value };
}

async function cancelPreparationReservationAuthoritative({ actorUuid, consumptionId } = {}, {
  requestingUserId = game.user?.id
} = {}) {
  if (!game.user?.isGM) throw new Error("Cancelar la reserva requiere autoridad GM.");
  const actor = await resolveActorByUuid(actorUuid);
  if (!actor || !userOwnsActor(actor, requestingUserId)) throw new Error("El usuario no controla al Actor.");
  const reservation = getPreparationReservation(actor);
  if (!reservation || reservation.id !== consumptionId) return { cancelled: false };
  await updatePreparationFlags(actor, { [MTROL_PREPARATION_RESERVATION_FLAG]: null });
  return { cancelled: true };
}

function randomConsumptionId() {
  return globalThis.foundry?.utils?.randomID?.() ??
    globalThis.crypto?.randomUUID?.() ??
    `prep-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function requestPreparationOperation(action, authoritative, actor, payload = {}) {
  if (game.user?.isGM && isPrimaryActiveGM()) {
    return authoritative({ actorUuid: actor.uuid, ...payload });
  }
  const response = await requestPrimaryGM(action, { actorUuid: actor.uuid, ...payload });
  if (!response.ok) throw new Error(response.error ?? "No se pudo actualizar Preparación.");
  return response.result;
}

export async function consumePreparation(actor, executeFormula) {
  if (typeof executeFormula !== "function") throw new TypeError("La fórmula a ejecutar es obligatoria.");
  if (!getPrimaryActiveGM()) {
    if (getPreparation(actor) > 0) {
      throw new Error("Se requiere un GM conectado para aplicar Preparación.");
    }
    return { result: await executeFormula(0), preparationBonus: 0 };
  }
  const consumptionId = randomConsumptionId();
  const reservation = await requestPreparationOperation(
    "mtrolReservePreparation",
    reservePreparationAuthoritative,
    actor,
    { consumptionId }
  );
  const bonus = sanitizePreparation(reservation?.bonus);
  if (!reservation?.consumptionId) {
    return { result: await executeFormula(0), preparationBonus: 0 };
  }
  try {
    const result = await executeFormula(bonus);
    await requestPreparationOperation(
      "mtrolCompletePreparation",
      completePreparationAuthoritative,
      actor,
      { consumptionId }
    );
    return { result, preparationBonus: bonus };
  } catch (error) {
    try {
      await requestPreparationOperation(
        "mtrolCancelPreparationReservation",
        cancelPreparationReservationAuthoritative,
        actor,
        { consumptionId }
      );
    } catch (cancelError) {
      console.error("MTROL | No se pudo liberar la reserva de Preparación.", cancelError);
    }
    throw error;
  }
}

export async function startCombatantTurnAuthoritative(combatant, context = getTurnContext()) {
  if (!game.user?.isGM || !combatant) return null;
  const state = createTurnState({
    combatId: context.combatId,
    round: context.round,
    turn: context.turn
  });
  localMovementReservations.delete(combatant.id);
  await setTurnResolutionState(combatant, null);
  return writeTurnState(combatant, state);
}

export function getActionGuard(actor, item = null, { kindOverride = null } = {}) {
  const context = getTurnContext();
  const kind = ["offensive", "movement"].includes(kindOverride)
    ? kindOverride
    : item ? classifyTurnAction(item) : "normal";

  if (!context.combat) return { allowed: true, kind, reason: null };
  if (kind === "reaction") {
    const cooldown = getItemCooldownStatus(item, context);
    return cooldown.available
      ? { allowed: true, kind, reason: null }
      : { allowed: false, kind, reason: `En cooldown hasta la ronda ${cooldown.availableAtRound}.` };
  }

  if (context.actor?.uuid !== actor?.uuid && context.actor?.id !== actor?.id) {
    return { allowed: false, kind, reason: "No es tu turno." };
  }

  const state = getCombatantTurnState(context.combatant);
  if (!isCurrentState(context, context.combatant, state)) {
    return { allowed: false, kind, reason: "El estado del turno todavía se está sincronizando." };
  }

  if (state.actionConsumed) {
    return { allowed: false, kind, reason: "La acción de este turno ya fue consumida." };
  }

  const cooldown = getItemCooldownStatus(item, context);
  if (!cooldown.available) {
    return { allowed: false, kind, reason: `En cooldown hasta la ronda ${cooldown.availableAtRound}.` };
  }

  return { allowed: true, kind, reason: null };
}

export const canAct = actor => getActionGuard(actor).allowed;
export const canAttack = actor => getActionGuard(actor, { system: { actionType: "attack" } }).allowed;
export const canUseFullAction = actor => getActionGuard(actor, { system: { actionType: "movement" } }).allowed;
export const canUseMovementRoll = actor => getActionGuard(actor).allowed;

export function canMove(actor) {
  const context = getTurnContext();
  if (!context.combat) return true;
  const combatant = getCombatantForActor(actor, context.combat);
  if (!combatant || context.combatant?.id !== combatant.id) return false;
  const reserved = localMovementReservations.get(combatant.id);
  const state = reserved ?? getCombatantTurnState(combatant);
  return isCurrentState(context, combatant, state) && movementRemaining(state) > 0;
}

export function getItemCooldownStatus(item, context = getTurnContext()) {
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

function resolveActorByUuid(actorUuid) {
  return fromUuid(actorUuid);
}

async function finalizeTurnUseAuthoritative({
  actorUuid,
  itemId,
  resolution,
  specialContext = null,
  pendingResolutionId = null,
  pendingResolutionIds = []
} = {}, {
  requestingUserId = game.user?.id
} = {}) {
  if (!game.user?.isGM) throw new Error("La operación de turno requiere autoridad GM.");
  const actor = await resolveActorByUuid(actorUuid);
  if (!actor || !userOwnsActor(actor, requestingUserId)) throw new Error("El usuario no controla al Actor.");
  const item = actor.items?.get?.(itemId) ?? null;
  if (!item) throw new Error("No se encontró la acción usada.");

  let kindOverride = null;
  if (specialContext) {
    validateSpecialAbilityExecution(actor, item, specialContext);
    kindOverride = specialContext.mode === "movement"
      ? "movement"
      : specialContext.mode === "attack" ? "offensive" : null;
  } else {
    const assignedSpecial = findSpecialAbilitySlotForItem(actor, item);
    if (assignedSpecial?.locked) throw new Error(`${assignedSpecial.label} está bloqueada.`);
    if (assignedSpecial?.handler === MTROL_ORB_CONTEXTUAL_HANDLER) {
      throw new Error(`${item.name} debe ejecutarse desde su slot de Habilidad Especial.`);
    }
  }

  const guard = getActionGuard(actor, item, { kindOverride });
  if (!guard.allowed) throw new Error(guard.reason);

  const context = getTurnContext();
  const cooldownRounds = Math.max(0, Math.trunc(Number(item.system?.cooldown) || 0));
  if (cooldownRounds > 0 && context.combat) {
    await item.setFlag("mtrol", MTROL_COOLDOWN_FLAG, {
      combatId: context.combatId,
      usedAtRound: context.round,
      cooldownRounds
    });
  }

  if (guard.kind === "reaction" || !context.combat) return { kind: guard.kind };

  const combatant = context.combatant;
  const state = getCombatantTurnState(combatant);
  if (guard.kind === "movement") {
    const granted = grantExtraMovement(state, resolution, { fullAction: true });
    await writeTurnState(combatant, granted.state);
    const ended = movementRemaining(granted.state) === 0;
    if (ended) await advanceCurrentTurnOnce(context, {
      reason: "movement-action-empty",
      completionId: `movement:${item.uuid}:${context.round}:${context.turn}`
    });
    return { kind: guard.kind, granted: granted.granted, state: granted.state, ended };
  }

  if (guard.kind === "offensive" || guard.kind === "normal") {
    const next = consumeOffensiveAction(state);
    await writeTurnState(combatant, next);
    const resolutionIds = [pendingResolutionId, ...pendingResolutionIds]
      .filter(Boolean)
      .map(String)
      .filter((value, index, values) => values.indexOf(value) === index);
    await setTurnResolutionState(combatant, resolutionIds.length
      ? {
          ids: resolutionIds,
          actorUuid: actor.uuid,
          itemUuid: item.uuid,
          combatId: context.combatId,
          round: context.round,
          turn: context.turn,
          pending: true
        }
      : null);
    return { kind: guard.kind, state: next };
  }

  return { kind: guard.kind, state };
}

export async function finalizeResolvedCompetenciaUse(actor, item, resolution, {
  specialContext = null,
  pendingResolutionId = null,
  pendingResolutionIds = []
} = {}) {
  if (!activeCombat()) return null;
  if (game.user?.isGM) {
    return finalizeTurnUseAuthoritative({
      actorUuid: actor.uuid,
      itemId: item.id,
      resolution,
      specialContext,
      pendingResolutionId,
      pendingResolutionIds
    });
  }
  const response = await requestPrimaryGM("mtrolFinalizeTurnUse", {
    actorUuid: actor.uuid,
    itemId: item.id,
    resolution: {
      finalResult: Number(resolution?.total ?? resolution?.finalResult ?? 0),
      pifia: resolution?.pifia === true,
      failed: resolution?.failed === true,
      success: resolution?.success
    },
    specialContext,
    pendingResolutionId,
    pendingResolutionIds
  });
  if (!response.ok) throw new Error(response.error ?? "No se pudo registrar la acción del turno.");
  return response.result;
}

async function completeResolvedTurnActionAuthoritative({
  actorUuid,
  resolutionId = null,
  completionId = null
} = {}, {
  requestingUserId = game.user?.id
} = {}) {
  if (!game.user?.isGM) throw new Error("Cerrar una acción requiere autoridad GM.");
  const actor = await resolveActorByUuid(actorUuid);
  if (!actor || !userOwnsActor(actor, requestingUserId)) throw new Error("El usuario no controla al Actor.");
  const context = getTurnContext();
  if (context.actor?.uuid !== actor.uuid && context.actor?.id !== actor.id) {
    return { advanced: false, duplicate: true, reason: "turn-already-changed" };
  }
  const state = getCombatantTurnState(context.combatant);
  if (!isCurrentState(context, context.combatant, state)) {
    throw new Error("El estado del turno todavía se está sincronizando.");
  }
  if (!state.actionConsumed) throw new Error("La acción todavía no fue consumida.");
  const pending = getTurnResolutionState(context.combatant);
  const pendingIds = Array.isArray(pending?.ids)
    ? pending.ids.map(String)
    : pending?.id ? [String(pending.id)] : [];
  if (pending?.pending && !resolutionId) throw new Error("La resolución de la acción todavía está pendiente.");
  if (pending?.pending && !pendingIds.includes(String(resolutionId))) {
    throw new Error("La resolución cerrada no coincide con la acción pendiente.");
  }
  const remainingIds = pendingIds.filter(id => id !== String(resolutionId));
  if (remainingIds.length > 0) {
    await setTurnResolutionState(context.combatant, { ...pending, ids: remainingIds });
    return { advanced: false, duplicate: false, pending: true, remainingIds };
  }
  await setTurnResolutionState(context.combatant, null);
  return advanceCurrentTurnOnce(context, {
    reason: "resolved-action",
    completionId: completionId ?? resolutionId ?? `action:${actor.uuid}:${context.round}:${context.turn}`
  });
}

export async function completeResolvedTurnAction(actor, options = {}) {
  if (!actor || !activeCombat()) return null;
  if (game.user?.isGM && isPrimaryActiveGM()) {
    return completeResolvedTurnActionAuthoritative({ actorUuid: actor.uuid, ...options });
  }
  const response = await requestPrimaryGM("mtrolCompleteTurnAction", {
    actorUuid: actor.uuid,
    resolutionId: options.resolutionId ?? null,
    completionId: options.completionId ?? null
  });
  if (!response.ok) throw new Error(response.error ?? "No se pudo avanzar el turno.");
  return response.result;
}

async function grantMovementAuthoritative({ actorUuid, resolution } = {}, {
  requestingUserId = game.user?.id
} = {}) {
  if (!game.user?.isGM) throw new Error("La operación de movimiento requiere autoridad GM.");
  const actor = await resolveActorByUuid(actorUuid);
  if (!actor || !userOwnsActor(actor, requestingUserId)) throw new Error("El usuario no controla al Actor.");
  const guard = getActionGuard(actor);
  if (!guard.allowed) throw new Error(guard.reason);
  const context = getTurnContext();
  const result = grantExtraMovement(getCombatantTurnState(context.combatant), resolution);
  await writeTurnState(context.combatant, result.state);
  return result;
}

export async function grantMovementFromResolvedRoll(actor, resolution) {
  if (!activeCombat() || getTurnContext().actor?.uuid !== actor?.uuid) return null;
  if (game.user?.isGM) return grantMovementAuthoritative({ actorUuid: actor.uuid, resolution });
  const response = await requestPrimaryGM("mtrolGrantTurnMovement", {
    actorUuid: actor.uuid,
    resolution: {
      finalResult: Number(resolution?.total ?? resolution?.finalResult ?? 0),
      pifia: resolution?.pifia === true,
      failed: resolution?.failed === true,
      success: resolution?.success
    }
  });
  if (!response.ok) throw new Error(response.error ?? "No se pudo otorgar movimiento.");
  return response.result;
}

function movementCost(tokenDocument, changes = {}) {
  const grid = tokenDocument?.parent?.grid ?? globalThis.canvas?.scene?.grid ?? {};
  return measureGridSpaces({
    fromX: tokenDocument?.x,
    fromY: tokenDocument?.y,
    toX: changes.x ?? tokenDocument?.x,
    toY: changes.y ?? tokenDocument?.y,
    gridSize: grid.size ?? globalThis.canvas?.grid?.size ?? 1
  });
}

function movementCollides(tokenDocument, changes = {}) {
  const token = tokenDocument?.object;
  if (!token?.checkCollision || !token?.center) return false;
  const destination = {
    x: Number(token.center.x) + Number(changes.x ?? tokenDocument.x) - Number(tokenDocument.x),
    y: Number(token.center.y) + Number(changes.y ?? tokenDocument.y) - Number(tokenDocument.y)
  };
  try {
    return token.checkCollision(destination, { type: "move", mode: "any" }) === true;
  } catch (error) {
    console.warn("MTROL | Foundry no pudo comprobar la colisión del movimiento.", error);
    return false;
  }
}

export function validateTurnMovement(tokenDocument, changes, options = {}, userId = game.user?.id) {
  const cost = movementCost(tokenDocument, changes);
  if (cost <= 0) return true;
  if (getUser(userId)?.isGM) return true;

  if (movementCollides(tokenDocument, changes)) {
    ui.notifications.warn("El recorrido está bloqueado por una pared o columna.");
    return false;
  }

  const context = getTurnContext();
  if (!context.combat) return true;
  const combatant = getCombatantForToken(tokenDocument, context.combat);
  if (!combatant || combatant.id !== context.combatant?.id || !userOwnsActor(tokenDocument?.actor, userId)) {
    ui.notifications.warn("Sólo puedes mover la ficha de tu turno activo.");
    return false;
  }

  const current = localMovementReservations.get(combatant.id) ?? getCombatantTurnState(combatant);
  if (!isCurrentState(context, combatant, current)) {
    ui.notifications.warn("El movimiento del turno todavía se está sincronizando.");
    return false;
  }
  const spent = spendMovement(current, cost);
  if (!spent.allowed) {
    ui.notifications.warn(`Movimiento insuficiente: quedan ${movementRemaining(current)} cuadro(s).`);
    return false;
  }

  localMovementReservations.set(combatant.id, spent.state);
  options.mtrolTurnMovement = {
    combatId: context.combatId,
    combatantId: combatant.id,
    round: context.round,
    turn: context.turn,
    cost
  };
  return true;
}

async function commitTurnMovementAuthoritative({ tokenUuid, movement } = {}, {
  requestingUserId = game.user?.id
} = {}) {
  if (!game.user?.isGM) throw new Error("La operación de movimiento requiere autoridad GM.");
  if (!movement || getUser(requestingUserId)?.isGM) return null;
  const tokenDocument = await fromUuid(tokenUuid);
  if (!tokenDocument || !userOwnsActor(tokenDocument.actor, requestingUserId)) {
    throw new Error("El usuario no controla el Token desplazado.");
  }
  const context = getTurnContext();
  const combatant = context.combat?.combatants?.get?.(movement.combatantId) ??
    Array.from(context.combat?.combatants ?? []).find(value => value.id === movement.combatantId);
  if (!combatant || combatant.actor?.uuid !== tokenDocument?.actor?.uuid ||
      movement.combatId !== context.combatId || movement.round !== context.round || movement.turn !== context.turn) {
    return null;
  }
  const spent = spendMovement(getCombatantTurnState(combatant), movement.cost);
  if (!spent.allowed) throw new Error("El movimiento supera los cuadros restantes.");
  const persisted = await writeTurnState(combatant, spent.state);
  if (persisted.actionConsumed && movementRemaining(persisted) === 0) {
    await advanceCurrentTurnOnce(context, {
      reason: "movement-exhausted",
      completionId: `movement:${tokenDocument.uuid}:${movement.round}:${movement.turn}`
    });
  }
  return persisted;
}

export async function commitTurnMovement(tokenDocument, options = {}, userId = game.user?.id) {
  const movement = options?.mtrolTurnMovement;
  if (!movement || getUser(userId)?.isGM || game.user?.id !== userId) return null;
  const response = await requestPrimaryGM("mtrolCommitTurnMovement", {
    tokenUuid: tokenDocument.uuid,
    movement
  });
  if (!response.ok) throw new Error(response.error ?? "No se pudo persistir el movimiento.");
  return response.result;
}

export async function endTurnAuthoritative({ combatId = null } = {}, {
  requestingUserId = game.user?.id
} = {}) {
  if (!game.user?.isGM) throw new Error("Sólo el GM puede avanzar el Combat.");
  const context = getTurnContext();
  if (!context.combat || (combatId && combatId !== context.combatId)) throw new Error("No hay un combate activo.");
  if (!getUser(requestingUserId)?.isGM && !userOwnsActor(context.actor, requestingUserId)) {
    throw new Error("Sólo puedes finalizar tu propio turno activo.");
  }
  if (getTurnResolutionState(context.combatant)?.pending) {
    throw new Error("La resolución de la acción todavía está pendiente.");
  }
  const receipt = await advanceCurrentTurnOnce(context, {
    reason: "manual-end",
    completionId: `manual:${context.combatId}:${context.round}:${context.turn}`
  });
  return { combatId: context.combatId, ...receipt };
}

export async function endTurn() {
  const context = getTurnContext();
  if (!context.combat) return null;
  if (game.user?.isGM && isPrimaryActiveGM()) return endTurnAuthoritative({ combatId: context.combatId });
  const response = await requestPrimaryGM("mtrolEndTurn", { combatId: context.combatId });
  if (!response.ok) throw new Error(response.error ?? "No se pudo finalizar el turno.");
  return response.result;
}

function emitSemanticEvent(name, context, combatant) {
  Hooks.callAll(`mtrol${name}`, {
    combat: context.combat,
    combatant,
    actor: combatant?.actor ?? null,
    round: context.round,
    turn: context.turn
  });
}

async function handleCombatTransition(combat, changes, options = {}) {
  if (!game.user?.isGM || !isPrimaryActiveGM()) return;
  if (!("round" in changes) && !("turn" in changes) && !("active" in changes)) return;
  const previous = options.mtrolPreviousCombat ?? {};
  const context = getTurnContext(combat);
  const oldTurn = Number(previous.turn ?? -1);
  const oldRound = Number(previous.round ?? 0);
  const oldCombatant = combat.turns?.[oldTurn] ?? null;
  const changedTurn = oldTurn !== context.turn || oldRound !== context.round;
  if (!changedTurn || !context.combatant) return;

  if (oldCombatant) emitSemanticEvent("TurnEnd", { ...context, round: oldRound, turn: oldTurn }, oldCombatant);
  if (oldRound > 0 && oldRound !== context.round) emitSemanticEvent("RoundEnd", { ...context, round: oldRound }, oldCombatant);
  if (oldRound !== context.round) emitSemanticEvent("RoundStart", context, context.combatant);
  await startCombatantTurnAuthoritative(context.combatant, context);
  emitSemanticEvent("TurnStart", context, context.combatant);
}

function collectionValues(collection) {
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection?.contents)) return collection.contents;
  if (typeof collection?.values === "function") return Array.from(collection.values());
  return Array.from(collection ?? []);
}

function escapeTrackerText(value) {
  return globalThis.foundry?.utils?.escapeHTML?.(String(value ?? "")) ?? String(value ?? "");
}

function getActorStatusLabels(actor) {
  return collectionValues(actor?.effects)
    .filter(effect => effect?.disabled !== true)
    .map(effect => effect.name ?? effect.label)
    .filter(Boolean)
    .slice(0, 3);
}

function buildGMCombatStatePanel(context) {
  const cards = collectionValues(context.combat?.combatants ?? context.combat?.turns).map(combatant => {
    const actor = combatant.actor;
    const state = getCombatantTurnState(combatant);
    const active = combatant.id === context.combatant?.id;
    const specials = [1, 2].map(slot => buildSpecialAbilitySlotView(actor, slot, {
      getCooldownStatus: getItemCooldownStatus,
      getActionGuard: () => ({ allowed: true, reason: null }),
      viewerIsGM: true
    }));
    const specialHTML = specials.map(special => `
      <div class="mtrol-gm-special ${special.locked ? "is-locked" : ""}">
        <span>${escapeTrackerText(special.label)}</span>
        <strong>${escapeTrackerText(special.name)}</strong>
        <em>${escapeTrackerText(special.status)}</em>
        <button type="button" data-mtrol-gm-special-lock data-actor-uuid="${escapeTrackerText(actor?.uuid)}" data-special-slot="${special.slot}">
          ${special.unlocked ? "Bloquear" : "Desbloquear"}
        </button>
      </div>
    `).join("");
    const statuses = getActorStatusLabels(actor);
    return `
      <article class="mtrol-gm-combatant ${active ? "is-active" : ""}">
        <header>
          <strong>${escapeTrackerText(actor?.name ?? combatant.name ?? "Combatant")}</strong>
          ${active ? "<span>TURNO ACTIVO</span>" : ""}
        </header>
        <div class="mtrol-gm-turn-metrics">
          <span>Movimiento <strong>${movementRemaining(state)}</strong></span>
          <span>Preparación <strong>+${getPreparation(actor)}</strong></span>
          <span>Acción <strong>${state.actionConsumed ? "Consumida" : "Disponible"}</strong></span>
        </div>
        <div class="mtrol-gm-preparation-controls">
          <button type="button" data-mtrol-gm-preparation data-actor-uuid="${escapeTrackerText(actor?.uuid)}" data-delta="-1">− Prep.</button>
          <button type="button" data-mtrol-gm-preparation data-actor-uuid="${escapeTrackerText(actor?.uuid)}" data-delta="1">+ Prep.</button>
        </div>
        <div class="mtrol-gm-specials">${specialHTML}</div>
        ${statuses.length ? `<div class="mtrol-gm-statuses">${statuses.map(status => `<span>${escapeTrackerText(status)}</span>`).join("")}</div>` : ""}
      </article>
    `;
  }).join("");
  return `
    <details class="mtrol-gm-combat-state" open>
      <summary>Estado de combate MTROL</summary>
      <div class="mtrol-gm-combat-state-grid">${cards}</div>
    </details>
  `;
}

function decorateCombatTracker(root, context) {
  root.querySelectorAll("[data-combatant-id]").forEach(row => {
    row.classList.remove("mtrol-active-combatant");
    row.querySelectorAll(".mtrol-turn-indicator, .mtrol-movement-indicator").forEach(node => node.remove());
    if (row.dataset.combatantId !== context.combatant?.id) return;
    row.classList.add("mtrol-active-combatant");
    const target = row.querySelector(".combatant-name, .token-name") ?? row;
    const active = document.createElement("span");
    active.className = "mtrol-turn-indicator";
    active.textContent = "TURNO ACTIVO";
    const movement = document.createElement("span");
    movement.className = "mtrol-movement-indicator";
    movement.textContent = `Movimiento: ${movementRemaining(getCombatantTurnState(context.combatant))}`;
    target.append(active, movement);
  });
}

function installCombatTrackerButton(_app, html) {
  const root = html?.[0] ?? html;
  if (!root?.querySelector) return;
  const context = getTurnContext();
  if (!context.combat) return;
  decorateCombatTracker(root, context);

  root.querySelector(".mtrol-gm-combat-state")?.remove();
  if (game.user?.isGM) {
    const panelHost = root.querySelector("footer") ?? root;
    panelHost.insertAdjacentHTML("beforeend", buildGMCombatStatePanel(context));
    panelHost.querySelectorAll("[data-mtrol-gm-special-lock]").forEach(control => {
      control.addEventListener("click", async () => {
        const actor = await fromUuid(control.dataset.actorUuid);
        const slot = Number(control.dataset.specialSlot);
        if (!actor) return;
        control.disabled = true;
        try {
          const state = resolveSpecialAbilitySlot(actor, slot);
          await updateSpecialAbilitySlot(actor, slot, { unlocked: !state.unlocked });
        } catch (error) {
          ui.notifications.warn(error.message);
          control.disabled = false;
        }
      });
    });
    panelHost.querySelectorAll("[data-mtrol-gm-preparation]").forEach(control => {
      control.addEventListener("click", async () => {
        const actor = await fromUuid(control.dataset.actorUuid);
        if (!actor) return;
        control.disabled = true;
        try {
          await setPreparation(actor, getPreparation(actor) + Number(control.dataset.delta ?? 0));
        } catch (error) {
          ui.notifications.warn(error.message);
          control.disabled = false;
        }
      });
    });
  }

  const allowed = game.user?.isGM || userOwnsActor(context.actor, game.user?.id);
  if (!allowed || root.querySelector("[data-mtrol-end-turn]")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.mtrolEndTurn = "true";
  button.className = "mtrol-end-turn";
  button.innerHTML = '<i class="fas fa-forward-step" aria-hidden="true"></i> Finalizar turno';
  button.addEventListener("click", async () => {
    button.disabled = true;
    try { await endTurn(); }
    catch (error) { ui.notifications.warn(error.message); button.disabled = false; }
  });
  (root.querySelector("footer") ?? root.querySelector(".combat-tracker-header") ?? root).append(button);
}

export function registerMtrolTurnHooks() {
  const refreshCombatTracker = () => ui.combat?.render?.({ force: true });
  Hooks.on("createCombat", combat => {
    Hooks.callAll("mtrolCombatCreated", { combat });
  });
  Hooks.on("preUpdateCombat", (combat, _changes, options) => {
    options.mtrolPreviousCombat = { round: combat.round, turn: combat.turn };
  });
  Hooks.on("updateCombat", (combat, changes, options) => {
    handleCombatTransition(combat, changes, options).catch(error =>
      console.error("MTROL | Error al sincronizar el cambio de turno.", error));
  });
  Hooks.on("deleteCombat", combat => {
    localMovementReservations.clear();
    Hooks.callAll("mtrolCombatEnd", { combat });
  });
  Hooks.on("preUpdateActor", (_actor, changes, _options, userId) => {
    const dottedKey = `flags.mtrol.${MTROL_PREPARATION_FLAG}`;
    const hasDotted = Object.prototype.hasOwnProperty.call(changes ?? {}, dottedKey);
    const hasNested = Object.prototype.hasOwnProperty.call(
      changes?.flags?.mtrol ?? {},
      MTROL_PREPARATION_FLAG
    );
    if (!hasDotted && !hasNested) return true;
    if (!getUser(userId)?.isGM) {
      ui.notifications.warn("Sólo el GM puede modificar Preparación manualmente.");
      return false;
    }
    if (hasDotted) changes[dottedKey] = sanitizePreparation(changes[dottedKey]);
    if (hasNested) {
      changes.flags.mtrol[MTROL_PREPARATION_FLAG] =
        sanitizePreparation(changes.flags.mtrol[MTROL_PREPARATION_FLAG]);
    }
    return true;
  });
  Hooks.on("updateActor", (actor, changes) => {
    const dottedKey = `flags.mtrol.${MTROL_PREPARATION_FLAG}`;
    const preparationChanged = Object.prototype.hasOwnProperty.call(changes ?? {}, dottedKey) ||
      Object.prototype.hasOwnProperty.call(changes?.flags?.mtrol ?? {}, MTROL_PREPARATION_FLAG);
    if (preparationChanged && actor?.sheet?.rendered) actor.sheet.render(false);
    if (preparationChanged) refreshCombatTracker();
  });
  Hooks.on("updateCombatant", (combatant, changes) => {
    const dottedKey = `flags.mtrol.${MTROL_TURN_FLAG}`;
    const turnStateChanged = Object.prototype.hasOwnProperty.call(changes ?? {}, dottedKey) ||
      Object.prototype.hasOwnProperty.call(changes?.flags?.mtrol ?? {}, MTROL_TURN_FLAG);
    if (turnStateChanged && combatant?.actor?.sheet?.rendered) {
      combatant.actor.sheet.render(false);
    }
    if (turnStateChanged) refreshCombatTracker();
  });
  Hooks.on("updateItem", item => {
    if (item?.parent?.type === "personaje" || item?.parent?.type === "character") refreshCombatTracker();
  });
  Hooks.on("preUpdateToken", (token, changes, options, userId) =>
    validateTurnMovement(token, changes, options, userId));
  Hooks.on("updateToken", (token, _changes, options, userId) => {
    commitTurnMovement(token, options, userId).catch(error =>
      console.error("MTROL | No se pudo persistir el movimiento del turno.", error));
  });
  Hooks.on("renderCombatTracker", installCombatTrackerButton);
}

export function installMtrolTurnApi() {
  game.mtrol = game.mtrol || {};
  game.mtrol.turns = {
    getTurnContext,
    getCombatantTurnState,
    canAct,
    canMove,
    canAttack,
    canUseMovementRoll,
    canUseFullAction,
    getActionGuard,
    getItemCooldownStatus,
    getPreparation,
    getPrepareGuard,
    canPrepare,
    prepare,
    setPreparation,
    consumePreparation,
    completeResolvedTurnAction,
    grantMovementFromResolvedRoll,
    endTurn
  };
}

export async function reconcileActiveTurn() {
  if (!game.user?.isGM || !isPrimaryActiveGM()) return null;
  const context = getTurnContext();
  if (!context.combatant) return null;
  const state = getCombatantTurnState(context.combatant);
  if (isCurrentState(context, context.combatant, state)) return state;
  return startCombatantTurnAuthoritative(context.combatant, context);
}

export const turnSocketOperations = {
  prepareAuthoritative,
  setPreparationAuthoritative,
  reservePreparationAuthoritative,
  completePreparationAuthoritative,
  completeResolvedTurnActionAuthoritative,
  cancelPreparationReservationAuthoritative,
  finalizeTurnUseAuthoritative,
  grantMovementAuthoritative,
  commitTurnMovementAuthoritative,
  endTurnAuthoritative
};
