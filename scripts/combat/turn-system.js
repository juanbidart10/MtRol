import {
  MTROL_GRANTED_MOVEMENT_FLAG,
  MTROL_PREPARATION_FLAG,
  MTROL_PREPARATION_MAX,
  MTROL_PREPARATION_RESERVATION_FLAG,
  MTROL_TURN_FLAG,
  MTROL_TURN_RESOLUTION_FLAG,
  classifyTurnAction,
  consumeOffensiveAction,
  consumeTurnForPreparation,
  createTurnState,
  grantExtraMovement,
  measureGridSpaces,
  movementFromFinalResult,
  movementRemaining,
  normalizeTurnState,
  sanitizePreparation,
  spendMovement
} from "./turn-state.js";

import {
  getActionCooldownStatus,
  markActionCooldownUsed
} from "../actions/action-cooldown-service.js";

export { getActionCooldownStatus as getItemCooldownStatus } from "../actions/action-cooldown-service.js";

import {
  getPrimaryActiveGM,
  isPrimaryActiveGM,
  requestPrimaryGM
} from "../core/socket-requests.js";

import {
  findSpecialAbilitySlotForItem,
  MTROL_ORB_CONTEXTUAL_HANDLER,
  validateSpecialAbilityExecution
} from "./special-ability-service.js";

import {
  evaluateAttributeFollowUpTarget,
  getActorTurnToken,
  getEnemiesInAttackRange as resolveEnemiesInAttackRange,
  isAttributeFollowUpAttack,
  resolveAttributeMovementFollowUp,
  tokenDocument
} from "./follow-up-policy.js";

import { logger } from "../utils/logger.js";
import { installCombatTracker } from "./turn-tracker-adapter.js";
import { advanceTurnOnce, clearTurnAdvanceLocks } from "./turn-advance-service.js";
import {
  readCombatantFlag,
  readTurnState,
  writeCombatantFlag,
  writeTurnState
} from "./turn-state-repository.js";
import {
  preUpdateActorDispatcher,
  preUpdateTokenDispatcher,
  updateActorDispatcher,
  updateItemDispatcher,
  updateTokenDispatcher
} from "../core/hook-dispatcher.js";

const localMovementReservations = new Map();
const localGrantedMovementReservations = new Map();
const movementWarningReceipts = new Map();
const preparationOperationLocks = new Set();
const PREPARATION_RESERVATION_TTL_MS = 120000;
const PREPARATION_LAST_CONSUMPTION_FLAG = "preparationLastConsumption";
const MOVEMENT_WARNING_DEDUP_MS = 750;
let actionIntegration = Object.freeze({
  getPendingOppositionForActor: () => null,
  getReactionMovementForActor: () => null,
  completeReactionMovementAuthoritative: async () => null
});
let movementTransactionIntegration = Object.freeze({
  execute: null,
  renounce: null
});

export function configureTurnActionIntegration(adapter = {}) {
  actionIntegration = Object.freeze({ ...actionIntegration, ...adapter });
  return actionIntegration;
}

export function configureMovementTransactionIntegration({ execute, renounce } = {}) {
  if (typeof execute !== "function" || typeof renounce !== "function") {
    throw new TypeError("La integración transaccional de movimiento requiere execute y renounce.");
  }
  movementTransactionIntegration = Object.freeze({ execute, renounce });
}

function requireMovementTransaction(operation) {
  const executor = movementTransactionIntegration[operation];
  if (typeof executor !== "function") {
    throw new Error("La integración transaccional de movimiento no fue configurada durante init.");
  }
  return executor;
}

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
  return readTurnState(combatant);
}

function isCurrentState(context, combatant, state) {
  return context.combatant?.id === combatant?.id &&
    state.combatId === context.combatId &&
    state.round === context.round &&
    state.turn === context.turn;
}

function actorFlag(actor, key) {
  return actor?.getFlag?.("mtrol", key) ?? actor?.flags?.mtrol?.[key] ?? null;
}

function combatantFlag(combatant, key) {
  return readCombatantFlag(combatant, key);
}

function getReactiveOpposition(actor) {
  if (!actor) return null;
  return actionIntegration.getPendingOppositionForActor(actor) ?? null;
}

function getReactionMovement(actor) {
  if (!actor) return null;
  return actionIntegration.getReactionMovementForActor(actor) ?? null;
}

function sameActor(actor, actorUuid) {
  return Boolean(actor && actorUuid && (actor.uuid === actorUuid || actor.id === actorUuid));
}

function isTransferableMovementBuff(item) {
  return item?.system?.categoria === "hechizo" &&
    item?.system?.rol === "mobility" &&
    item?.system?.actionType === "movement" &&
    item?.system?.effect === "buff";
}

function isGrantedMovementCurrent(movement, context = getTurnContext()) {
  return movement?.status === "available" &&
    movement.combatId === context.combatId &&
    Number(movement.round) === context.round &&
    Number(movement.turn) === context.turn &&
    movement.sourceCombatantId === context.combatant?.id &&
    Number(movement.remaining ?? 0) > 0;
}

export function getGrantedMovement(actor = null, context = getTurnContext()) {
  const movement = combatantFlag(context.combatant, MTROL_GRANTED_MOVEMENT_FLAG);
  if (!isGrantedMovementCurrent(movement, context)) return null;
  if (actor && !sameActor(actor, movement.targetActorUuid)) return null;
  return movement;
}

export function getEnemiesInAttackRange(actor, token = null, context = getTurnContext()) {
  return resolveEnemiesInAttackRange(actor, token, context);
}

export function getAvailableMovement(actor, token = null, {
  context = getTurnContext(),
  includeLocalReservation = false,
  includeGmBypass = false
} = {}) {
  if (includeGmBypass && game.user?.isGM) {
    return { kind: "gm", remaining: Infinity, state: null };
  }
  if (!context.combat) return { kind: "free", remaining: Infinity, state: null };
  const granted = getGrantedMovement(actor, context);
  if (granted && (!token || !granted.targetTokenUuid || granted.targetTokenUuid === tokenDocument(token)?.uuid)) {
    const state = includeLocalReservation
      ? localGrantedMovementReservations.get(granted.id) ?? granted
      : granted;
    return { kind: "granted", remaining: Math.max(0, Number(state.remaining ?? 0)), state };
  }
  const reaction = getReactionMovement(actor);
  if (reaction && (!token || !reaction.tokenUuid || reaction.tokenUuid === tokenDocument(token)?.uuid)) {
    return {
      kind: "reaction",
      remaining: Math.max(0, Number(reaction.remaining ?? reaction.allowance ?? 0)),
      state: reaction
    };
  }
  const combatant = getCombatantForActor(actor, context.combat);
  if (combatant?.id === context.combatant?.id) {
    const reservation = includeLocalReservation
      ? localMovementReservations.get(combatant.id)
      : null;
    const state = includeLocalReservation
      ? reservation?.state ?? reservation ?? getCombatantTurnState(combatant)
      : getCombatantTurnState(combatant);
    if (isCurrentState(context, combatant, state)) {
      return { kind: "turn", remaining: movementRemaining(state), state, combatant };
    }
    return { kind: "sync", remaining: 0, state, combatant };
  }
  return { kind: "none", remaining: 0, state: null };
}

async function setGrantedMovement(combatant, movement) {
  return writeCombatantFlag(combatant, MTROL_GRANTED_MOVEMENT_FLAG, movement);
}

function warnMovementOnce(tokenDocument, userId, code, message) {
  const key = `${userId ?? ""}:${tokenDocument?.uuid ?? tokenDocument?.id ?? ""}:${code}`;
  const now = Date.now();
  const previous = Number(movementWarningReceipts.get(key) ?? 0);
  if (now - previous < MOVEMENT_WARNING_DEDUP_MS) return;
  movementWarningReceipts.set(key, now);
  ui.notifications.warn(message);
}

export function getTurnResolutionState(combatant = getTurnContext().combatant) {
  const value = combatantFlag(combatant, MTROL_TURN_RESOLUTION_FLAG);
  return value && typeof value === "object" ? value : null;
}

async function setTurnResolutionState(combatant, value) {
  return writeCombatantFlag(combatant, MTROL_TURN_RESOLUTION_FLAG, value);
}

async function advanceCurrentTurnOnce(context, {
  reason = "completed-action",
  completionId = null
} = {}) {
  return advanceTurnOnce(context, { reason, completionId });
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
      logger.error("TURN", "preparation reservation release failed", { error: cancelError });
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
  localGrantedMovementReservations.clear();
  await setGrantedMovement(combatant, null);
  await setTurnResolutionState(combatant, null);
  return writeTurnState(combatant, state);
}

export function getActionGuard(actor, item = null, { kindOverride = null } = {}) {
  const context = getTurnContext();
  const kind = ["offensive", "movement"].includes(kindOverride)
    ? kindOverride
    : item ? classifyTurnAction(item) : "normal";

  if (!context.combat) return { allowed: true, kind, reason: null, reactive: false };

  const isActiveActor = context.actor?.uuid === actor?.uuid || context.actor?.id === actor?.id;
  const opposition = isActiveActor ? null : getReactiveOpposition(actor);
  const reactive = Boolean(opposition);

  if (!isActiveActor && !reactive) {
    return {
      allowed: false,
      kind,
      reason: "No es tu turno ni estás respondiendo una oposición.",
      reactive: false
    };
  }

  const cooldown = getItemCooldownStatus(item, context);
  if (!cooldown.available) {
    return {
      allowed: false,
      kind,
      reason: `En cooldown hasta la ronda ${cooldown.availableAtRound}.`,
      reactive,
      opposition
    };
  }

  if (reactive) {
    return { allowed: true, kind, reason: null, reactive: true, opposition };
  }

  const state = getCombatantTurnState(context.combatant);
  if (!isCurrentState(context, context.combatant, state)) {
    return { allowed: false, kind, reason: "El estado del turno todavía se está sincronizando." };
  }

  if (state.actionConsumed) {
    if (
      state.followUpAttackAvailable &&
      kind === "offensive" &&
      !state.followUpAttackConsumed &&
      isAttributeFollowUpAttack(item)
    ) {
      return {
        allowed: true,
        kind,
        reason: null,
        reactive: false,
        attributeFollowUp: true
      };
    }
    if (state.followUpAttackAvailable) {
      return {
        allowed: false,
        kind,
        reason: "El movimiento por atributo sólo habilita un ataque físico posterior.",
        reactive: false
      };
    }
    return { allowed: false, kind, reason: "La acción de este turno ya fue consumida." };
  }

  return { allowed: true, kind, reason: null, reactive: false };
}

export const canAct = actor => getActionGuard(actor).allowed;
export const canAttack = actor => getActionGuard(actor, { system: { actionType: "attack" } }).allowed;
export const canUseFullAction = actor => getActionGuard(actor, { system: { actionType: "movement" } }).allowed;
export const canUseMovementRoll = actor => getActionGuard(actor).allowed;

export function canMove(actor) {
  return getAvailableMovement(actor, null, {
    includeLocalReservation: true,
    includeGmBypass: true
  }).remaining > 0;
}

export function getAttributeFollowUpTargetGuard(actor, targetToken) {
  const context = getTurnContext();
  const state = getCombatantTurnState(context.combatant);
  return evaluateAttributeFollowUpTarget({ actor, targetToken, context, state });
}

const getItemCooldownStatus = (item, context = getTurnContext()) =>
  getActionCooldownStatus(item, context);

function resolveActorByUuid(actorUuid) {
  return fromUuid(actorUuid);
}

async function finalizeTurnUseAuthoritative({
  actorUuid,
  itemId,
  resolution,
  specialContext = null,
  pendingResolutionId = null,
  pendingResolutionIds = [],
  targetActorUuid = null,
  targetTokenUuid = null
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
  await markActionCooldownUsed(item, context);

  if (guard.reactive || !context.combat) {
    return {
      kind: guard.kind,
      reactive: guard.reactive === true,
      resolutionId: guard.opposition?.id ?? null
    };
  }

  const combatant = context.combatant;
  const state = getCombatantTurnState(combatant);
  if (guard.kind === "movement") {
    const targetIsSelf = !isTransferableMovementBuff(item) ||
      !targetActorUuid || sameActor(actor, targetActorUuid);
    const grantedAmount = movementFromFinalResult(resolution);
    const movementSource = specialContext?.mode === "movement"
      ? "orb"
      : isTransferableMovementBuff(item) ? "spell" : "movement-action";
    const nextState = targetIsSelf
      ? grantExtraMovement(state, resolution, { fullAction: true, source: movementSource }).state
      : { ...normalizeTurnState(state), actionConsumed: true, movementSource };
    await writeTurnState(combatant, nextState);
    if (!targetIsSelf && grantedAmount > 0) {
      await setGrantedMovement(combatant, {
        id: `movement:${item.uuid}:${context.combatId}:${context.round}:${context.turn}`,
        sourceActorUuid: actor.uuid,
        sourceCombatantId: combatant.id,
        targetActorUuid,
        targetTokenUuid,
        sourceItemUuid: item.uuid,
        sourceType: "movement-buff",
        combatId: context.combatId,
        round: context.round,
        turn: context.turn,
        granted: grantedAmount,
        remaining: grantedAmount,
        spent: 0,
        status: "available",
        grantedAt: Date.now()
      });
    } else {
      await setGrantedMovement(combatant, null);
    }
    const ended = grantedAmount === 0;
    if (ended) await advanceCurrentTurnOnce(context, {
      reason: "movement-action-empty",
      completionId: `movement:${item.uuid}:${context.round}:${context.turn}`
    });
    return {
      kind: guard.kind,
      granted: grantedAmount,
      grantedTo: targetIsSelf ? actor.uuid : targetActorUuid,
      grantType: targetIsSelf ? "turn" : "granted",
      state: nextState,
      ended
    };
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
  pendingResolutionIds = [],
  targetActorUuid = null,
  targetTokenUuid = null
} = {}) {
  if (!activeCombat()) return null;
  if (game.user?.isGM) {
    return finalizeTurnUseAuthoritative({
      actorUuid: actor.uuid,
      itemId: item.id,
      resolution,
      specialContext,
      pendingResolutionId,
      pendingResolutionIds,
      targetActorUuid,
      targetTokenUuid
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
    pendingResolutionIds,
    targetActorUuid,
    targetTokenUuid
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
  if (getGrantedMovement(null, context)) {
    return { advanced: false, duplicate: false, pending: true, reason: "granted-movement-pending" };
  }
  if (movementRemaining(state) > 0) {
    return { advanced: false, duplicate: false, pending: true, reason: "turn-movement-pending" };
  }
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
  const attributeMovementFollowUp = resolveAttributeMovementFollowUp(actor);
  const result = grantExtraMovement(getCombatantTurnState(context.combatant), resolution, {
    source: "attribute",
    attributeMovementFollowUp
  });
  const state = result.granted > 0
    ? result.state
    : {
        ...result.state,
        baseMovementRemaining: 0,
        extraMovementRemaining: 0,
        followUpAttackAvailable: false,
        followUpAttackConsumed: false
      };
  await writeTurnState(context.combatant, state);
  if (result.granted === 0) {
    const advance = await advanceCurrentTurnOnce(context, {
      reason: "attribute-movement-empty",
      completionId: `attribute:${actor.uuid}:${context.combatId}:${context.round}:${context.turn}`
    });
    return { ...result, state, attributeMovementFollowUp, ended: true, ...advance };
  }
  return { ...result, state, attributeMovementFollowUp, ended: false };
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
    logger.warn("MOVEMENT", "Foundry movement collision check failed", { error });
    return false;
  }
}

export function validateTurnMovement(tokenDocument, changes, options = {}, userId = game.user?.id) {
  if (options?.mtrolMovementInternal === true && getUser(userId)?.isGM) return true;
  const cost = movementCost(tokenDocument, changes);
  if (cost <= 0) return true;
  if (getUser(userId)?.isGM) return true;

  if (movementCollides(tokenDocument, changes)) {
    warnMovementOnce(tokenDocument, userId, "collision", "El recorrido está bloqueado por una pared o columna.");
    return false;
  }

  const context = getTurnContext();
  if (!context.combat) return true;
  if (!userOwnsActor(tokenDocument?.actor, userId)) {
    warnMovementOnce(tokenDocument, userId, "wrong-owner", "El usuario no controla la ficha desplazada.");
    return false;
  }
  const available = getAvailableMovement(tokenDocument?.actor, tokenDocument, {
    context,
    includeLocalReservation: true
  });
  if (available.kind === "granted") {
    if (cost > available.remaining) {
      warnMovementOnce(tokenDocument, userId, "granted-insufficient",
        `Movimiento concedido insuficiente: quedan ${available.remaining} cuadro(s).`);
      return false;
    }
    localGrantedMovementReservations.set(available.state.id, {
      ...available.state,
      remaining: available.remaining - cost,
      spent: Number(available.state.spent ?? 0) + cost
    });
    options.mtrolGrantedMovement = {
      transactionId: `movement:${globalThis.foundry?.utils?.randomID?.() ?? crypto.randomUUID()}`,
      source: "GRANTED",
      id: available.state.id,
      combatId: context.combatId,
      sourceCombatantId: context.combatant?.id,
      round: context.round,
      turn: context.turn,
      actorUuid: tokenDocument.actor.uuid,
      tokenUuid: tokenDocument.uuid,
      from: { x: Number(tokenDocument.x), y: Number(tokenDocument.y) },
      to: { x: Number(changes.x ?? tokenDocument.x), y: Number(changes.y ?? tokenDocument.y) },
      cost
    };
    return true;
  }
  if (available.kind === "reaction") {
    if (cost > available.remaining) {
      warnMovementOnce(tokenDocument, userId, "reaction-insufficient", "La Esquiva permite mover como máximo 1 cuadro.");
      return false;
    }
    options.mtrolReactionMovement = {
      transactionId: `movement:${globalThis.foundry?.utils?.randomID?.() ?? crypto.randomUUID()}`,
      source: "REACTION",
      combatId: context.combatId,
      pendingActionId: available.state.pendingActionId,
      actorUuid: tokenDocument.actor.uuid,
      tokenUuid: tokenDocument.uuid,
      from: { x: Number(tokenDocument.x), y: Number(tokenDocument.y) },
      to: { x: Number(changes.x ?? tokenDocument.x), y: Number(changes.y ?? tokenDocument.y) },
      cost
    };
    return true;
  }
  if (available.kind === "sync") {
    warnMovementOnce(tokenDocument, userId, "turn-sync", "El movimiento del turno todavía se está sincronizando.");
    return false;
  }
  if (available.kind !== "turn") {
    warnMovementOnce(tokenDocument, userId, "wrong-actor", "Sólo puedes mover la ficha de tu turno activo.");
    return false;
  }
  const spent = spendMovement(available.state, cost);
  if (!spent.allowed) {
    logger.warnOnce("MOVEMENT", "movement validation rejected", {
      tokenUuid: tokenDocument?.uuid ?? null,
      userId,
      source: available.state?.movementSource === "attribute" ? "ATTRIBUTE" : "TURN",
      command: "movement.validate",
      cost,
      remaining: Number(available.remaining ?? 0),
      status: "rejected",
      reasonCode: "MOVEMENT_INSUFFICIENT"
    }, { key: `movement-validation:${tokenDocument?.uuid ?? "unknown"}:${userId}` });
    warnMovementOnce(tokenDocument, userId, "turn-insufficient",
      `Movimiento insuficiente: quedan ${available.remaining} cuadro(s).`);
    return false;
  }

  const movement = {
    transactionId: `movement:${globalThis.foundry?.utils?.randomID?.() ?? crypto.randomUUID()}`,
    source: available.state?.movementSource === "attribute" ? "ATTRIBUTE" : "TURN",
    combatId: context.combatId,
    combatantId: available.combatant.id,
    round: context.round,
    turn: context.turn,
    from: { x: Number(tokenDocument.x), y: Number(tokenDocument.y) },
    to: { x: Number(changes.x ?? tokenDocument.x), y: Number(changes.y ?? tokenDocument.y) },
    cost
  };
  localMovementReservations.set(available.combatant.id, {
    state: spent.state,
    movement,
    tokenUuid: tokenDocument.uuid,
    userId
  });
  options.mtrolTurnMovement = movement;
  return true;
}

function getReservedTurnMovement(tokenDocument, changes = {}, userId = game.user?.id) {
  if (!Object.prototype.hasOwnProperty.call(changes ?? {}, "x") &&
      !Object.prototype.hasOwnProperty.call(changes ?? {}, "y")) return null;
  const context = getTurnContext();
  const combatant = getCombatantForToken(tokenDocument, context.combat);
  const reservation = combatant?.id ? localMovementReservations.get(combatant.id) : null;
  const movement = reservation?.movement;
  if (!movement || reservation.tokenUuid !== tokenDocument?.uuid || reservation.userId !== userId) return null;
  if (movement.combatId !== context.combatId || movement.combatantId !== combatant.id ||
      movement.round !== context.round || movement.turn !== context.turn) return null;
  const destinationX = Number(changes.x ?? tokenDocument?.x);
  const destinationY = Number(changes.y ?? tokenDocument?.y);
  if (destinationX !== Number(movement.to?.x) || destinationY !== Number(movement.to?.y)) return null;
  return movement;
}

async function resolveAttributeMovementEndAuthoritative({
  context,
  actor,
  token,
  state,
  reason = "exhausted"
} = {}) {
  const closedMovement = {
    ...normalizeTurnState(state),
    baseMovementRemaining: 0,
    extraMovementRemaining: 0,
    followUpAttackAvailable: false
  };
  const canFollowUp = closedMovement.attributeMovementFollowUp === "attack-if-in-range" &&
    getEnemiesInAttackRange(actor, token, context).length > 0;
  if (canFollowUp) {
    const followUpState = {
      ...closedMovement,
      followUpAttackAvailable: true,
      followUpAttackConsumed: false
    };
    await writeTurnState(context.combatant, followUpState);
    return { advanced: false, followUpAttackAvailable: true, state: followUpState };
  }
  const persisted = await writeTurnState(context.combatant, closedMovement);
  const advance = await advanceCurrentTurnOnce(context, {
    reason: `attribute-movement-${reason}`,
    completionId: `attribute:${actor.uuid}:${context.combatId}:${context.round}:${context.turn}`
  });
  return { ...advance, followUpAttackAvailable: false, state: persisted };
}

async function completeAttributeMovementAuthoritative({ actorUuid, tokenUuid = null } = {}, {
  requestingUserId = game.user?.id
} = {}) {
  if (!game.user?.isGM) throw new Error("Cerrar movimiento por atributo requiere autoridad GM.");
  const actor = await resolveActorByUuid(actorUuid);
  if (!actor || !userOwnsActor(actor, requestingUserId)) {
    throw new Error("El usuario no controla al Actor.");
  }
  const context = getTurnContext();
  if (!sameActor(context.actor, actor.uuid)) {
    return { advanced: false, duplicate: true, reason: "turn-already-changed" };
  }
  const state = getCombatantTurnState(context.combatant);
  if (state.movementSource !== "attribute" || state.followUpAttackAvailable) {
    return { advanced: false, duplicate: true, reason: "attribute-movement-already-closed" };
  }
  const token = tokenUuid ? await fromUuid(tokenUuid) : getActorTurnToken(actor, context);
  return resolveAttributeMovementEndAuthoritative({
    context,
    actor,
    token,
    state,
    reason: "finished"
  });
}

export async function completeAttributeMovement(actor) {
  if (!actor || !activeCombat()) return null;
  const token = getActorTurnToken(actor);
  if (game.user?.isGM && isPrimaryActiveGM()) {
    return completeAttributeMovementAuthoritative({
      actorUuid: actor.uuid,
      tokenUuid: token?.uuid ?? null
    });
  }
  const response = await requestPrimaryGM("mtrolCompleteAttributeMovement", {
    actorUuid: actor.uuid,
    tokenUuid: token?.uuid ?? null
  });
  if (!response.ok) throw new Error(response.error ?? "No se pudo cerrar el movimiento por atributo.");
  return response.result;
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
  if (persisted.actionConsumed && movementRemaining(persisted) === 0 && !getGrantedMovement(null, context)) {
    if (persisted.movementSource === "attribute") {
      return resolveAttributeMovementEndAuthoritative({
        context,
        actor: tokenDocument.actor,
        token: tokenDocument,
        state: persisted,
        reason: "exhausted"
      });
    }
    await advanceCurrentTurnOnce(context, {
      reason: "movement-exhausted",
      completionId: `movement:${tokenDocument.uuid}:${movement.round}:${movement.turn}`
    });
  }
  return persisted;
}

async function commitGrantedMovementAuthoritative({ tokenUuid, movement } = {}, {
  requestingUserId = game.user?.id
} = {}) {
  if (!game.user?.isGM) throw new Error("El movimiento concedido requiere autoridad GM.");
  if (!movement) return null;
  const tokenDocument = await fromUuid(tokenUuid);
  if (!tokenDocument || !userOwnsActor(tokenDocument.actor, requestingUserId)) {
    throw new Error("El usuario no controla el Token con movimiento concedido.");
  }
  const context = getTurnContext();
  const current = getGrantedMovement(tokenDocument.actor, context);
  if (!current || current.id !== movement.id ||
      movement.combatId !== context.combatId || movement.round !== context.round ||
      movement.turn !== context.turn || movement.sourceCombatantId !== context.combatant?.id) {
    throw new Error("La concesión de movimiento ya no está disponible.");
  }
  if (current.targetTokenUuid && current.targetTokenUuid !== tokenDocument.uuid) {
    throw new Error("El Token no coincide con la concesión de movimiento.");
  }
  const cost = Math.max(0, Math.trunc(Number(movement.cost) || 0));
  if (cost > Number(current.remaining ?? 0)) {
    throw new Error("El movimiento supera los cuadros concedidos restantes.");
  }
  const remaining = Number(current.remaining) - cost;
  const next = {
    ...current,
    remaining,
    spent: Number(current.spent ?? 0) + cost,
    updatedAt: Date.now()
  };
  if (remaining > 0) {
    await setGrantedMovement(context.combatant, next);
    return next;
  }
  next.status = "used";
  next.closedAt = Date.now();
  await setGrantedMovement(context.combatant, null);
  await advanceCurrentTurnOnce(context, {
    reason: "granted-movement-exhausted",
    completionId: current.id
  });
  return next;
}

export async function completeGrantedMovementAuthoritative({ movementId = null, reason = "skipped" } = {}, {
  requestingUserId = game.user?.id
} = {}) {
  if (!game.user?.isGM) throw new Error("Cerrar movimiento concedido requiere autoridad GM.");
  const context = getTurnContext();
  const current = getGrantedMovement(null, context);
  if (!current || (movementId && current.id !== movementId)) {
    return { advanced: false, duplicate: true, reason: "grant-already-closed" };
  }
  const targetActor = await resolveActorByUuid(current.targetActorUuid);
  if (!getUser(requestingUserId)?.isGM && !userOwnsActor(targetActor, requestingUserId)) {
    throw new Error("Sólo el Actor autorizado o el GM pueden cerrar este movimiento.");
  }
  await setGrantedMovement(context.combatant, null);
  localGrantedMovementReservations.delete(current.id);
  return advanceCurrentTurnOnce(context, {
    reason: `granted-movement-${reason}`,
    completionId: current.id
  });
}

export async function ensureGrantedMovementAdvanceAuthoritative({ movementId, reason = "skipped" } = {}) {
  if (!game.user?.isGM) throw new Error("El avance de movimiento concedido requiere autoridad GM.");
  if (!movementId) throw new Error("El cierre requiere movementId.");
  const context = getTurnContext();
  return advanceCurrentTurnOnce(context, {
    reason: `granted-movement-${reason}`,
    completionId: movementId
  });
}

export async function completeGrantedMovement(options = {}) {
  const current = getGrantedMovement();
  if (!current) return null;
  const transactionId = options.transactionId ?? `movement-renounce:${current.id}:${foundry.utils.randomID()}`;
  if (game.user?.isGM && isPrimaryActiveGM()) {
    return requireMovementTransaction("renounce")({
      transactionId,
      combatId: current.combatId,
      movementId: current.id,
      reason: options.reason ?? "skipped"
    }, { requestingUserId: game.user.id });
  }
  const response = await requestPrimaryGM("mtrolCompleteGrantedMovement", {
    transactionId,
    combatId: current.combatId,
    movementId: current.id,
    reason: options.reason ?? "skipped"
  });
  if (!response.ok || response.result?.commandResult?.ok === false) {
    throw new Error(response.error ?? response.result?.commandResult?.humanReason ?? "No se pudo cerrar el movimiento concedido.");
  }
  return response.result?.commandResult ?? response.result;
}

async function commitReactionMovementAuthoritative({ tokenUuid, movement } = {}, {
  requestingUserId = game.user?.id
} = {}) {
  if (!game.user?.isGM) throw new Error("El movimiento reactivo requiere autoridad GM.");
  if (!movement) return null;
  const tokenDocument = await fromUuid(tokenUuid);
  if (!tokenDocument || !userOwnsActor(tokenDocument.actor, requestingUserId)) {
    throw new Error("El usuario no controla el Token desplazado.");
  }
  return actionIntegration.completeReactionMovementAuthoritative(
    movement.pendingActionId,
    {
      actorUuid: tokenDocument.actor.uuid,
      tokenUuid: tokenDocument.uuid,
      cost: movement.cost,
      requestingUserId,
      reason: "used"
    }
  ) ?? null;
}

export async function applyMovementConsumptionAuthoritative({
  tokenUuid,
  source,
  movement,
  transactionId = null
} = {}, options = {}) {
  if (source === "GRANTED") return commitGrantedMovementAuthoritative({ tokenUuid, movement }, options);
  if (source === "REACTION") return commitReactionMovementAuthoritative({ tokenUuid, movement }, options);
  if (["TURN", "ATTRIBUTE"].includes(source)) {
    return commitTurnMovementAuthoritative({ tokenUuid, movement, transactionId }, options);
  }
  throw new Error(`Origen de movimiento no soportado: ${source}.`);
}

export async function commitTurnMovement(tokenDocument, options = {}, userId = game.user?.id, changes = {}) {
  if (options?.mtrolMovementInternal === true && getUser(userId)?.isGM) return null;
  const grantedMovement = options?.mtrolGrantedMovement;
  if (grantedMovement) {
    if (game.user?.isGM && isPrimaryActiveGM()) {
      return requireMovementTransaction("execute")({ tokenUuid: tokenDocument.uuid, movement: grantedMovement }, {
        requestingUserId: userId
      });
    }
    if (game.user?.id !== userId) return null;
    try {
      const response = await requestPrimaryGM("mtrolCommitGrantedMovement", {
        tokenUuid: tokenDocument.uuid,
        movement: grantedMovement
      });
      if (!response.ok || response.result?.commandResult?.ok === false) {
        throw new Error(response.error ?? response.result?.commandResult?.humanReason ?? "No se pudo persistir el movimiento concedido.");
      }
      return response.result?.commandResult ?? response.result;
    } catch (error) {
      localGrantedMovementReservations.delete(grantedMovement.id);
      throw error;
    }
  }
  const reactionMovement = options?.mtrolReactionMovement;
  if (reactionMovement) {
    try {
      if (game.user?.isGM && isPrimaryActiveGM()) {
        return await requireMovementTransaction("execute")({ tokenUuid: tokenDocument.uuid, movement: reactionMovement }, {
          requestingUserId: userId
        });
      }
      if (game.user?.id !== userId) return null;
      const response = await requestPrimaryGM("mtrolCommitReactionMovement", {
        tokenUuid: tokenDocument.uuid,
        movement: reactionMovement
      });
      if (!response.ok || response.result?.commandResult?.ok === false) {
        throw new Error(response.error ?? response.result?.commandResult?.humanReason ?? "No se pudo cerrar el movimiento reactivo.");
      }
      return response.result?.commandResult ?? response.result;
    } finally {
      localGrantedMovementReservations.delete(reactionMovement.id);
    }
  }
  const movement = options?.mtrolTurnMovement ?? getReservedTurnMovement(tokenDocument, changes, userId);
  if (!movement || getUser(userId)?.isGM) return null;
  try {
    if (game.user?.isGM && isPrimaryActiveGM()) {
      return await requireMovementTransaction("execute")({ tokenUuid: tokenDocument.uuid, movement }, {
        requestingUserId: userId
      });
    }
    if (game.user?.id !== userId) return null;
    const response = await requestPrimaryGM("mtrolCommitTurnMovement", {
      tokenUuid: tokenDocument.uuid,
      movement
    });
    if (!response.ok || response.result?.commandResult?.ok === false) {
      throw new Error(response.error ?? response.result?.commandResult?.humanReason ?? "No se pudo persistir el movimiento.");
    }
    return response.result?.commandResult ?? response.result;
  } finally {
    localMovementReservations.delete(movement.combatantId);
  }
}

export function clearLocalMovementReservations() {
  localMovementReservations.clear();
  localGrantedMovementReservations.clear();
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
  await setGrantedMovement(context.combatant, null);
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

function installCombatTrackerButton(_app, html) {
  return installCombatTracker(_app, html, {
    getTurnContext,
    getCombatantTurnState,
    getGrantedMovement,
    getAvailableMovement,
    getItemCooldownStatus,
    getPreparation,
    setPreparation,
    sameActor,
    userCanControl: actor => game.user?.isGM || userOwnsActor(actor, game.user?.id),
    completeAttributeMovement,
    completeGrantedMovement,
    endTurn
  });
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
      logger.error("TURN", "combat transition synchronization failed", { error }));
  });
  Hooks.on("deleteCombat", combat => {
    localMovementReservations.clear();
    localGrantedMovementReservations.clear();
    movementWarningReceipts.clear();
    clearTurnAdvanceLocks();
    Hooks.callAll("mtrolCombatEnd", { combat });
  });
  preUpdateActorDispatcher.subscribe("turn.preparation-guard", (_actor, changes, _options, userId) => {
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
  }, { priority: 40, critical: true });
  updateActorDispatcher.subscribe("turn.preparation-render", (actor, changes) => {
    const dottedKey = `flags.mtrol.${MTROL_PREPARATION_FLAG}`;
    const preparationChanged = Object.prototype.hasOwnProperty.call(changes ?? {}, dottedKey) ||
      Object.prototype.hasOwnProperty.call(changes?.flags?.mtrol ?? {}, MTROL_PREPARATION_FLAG);
    if (preparationChanged && actor?.sheet?.rendered) actor.sheet.render(false);
    if (preparationChanged) refreshCombatTracker();
  }, { priority: 150, critical: false });
  Hooks.on("updateCombatant", (combatant, changes) => {
    const dottedKey = `flags.mtrol.${MTROL_TURN_FLAG}`;
    const turnStateChanged = Object.prototype.hasOwnProperty.call(changes ?? {}, dottedKey) ||
      Object.prototype.hasOwnProperty.call(changes?.flags?.mtrol ?? {}, MTROL_TURN_FLAG);
    if (turnStateChanged && combatant?.actor?.sheet?.rendered) {
      combatant.actor.sheet.render(false);
    }
    const grantedKey = `flags.mtrol.${MTROL_GRANTED_MOVEMENT_FLAG}`;
    const grantedChanged = Object.prototype.hasOwnProperty.call(changes ?? {}, grantedKey) ||
      Object.prototype.hasOwnProperty.call(changes?.flags?.mtrol ?? {}, MTROL_GRANTED_MOVEMENT_FLAG);
    if (turnStateChanged) localMovementReservations.delete(combatant.id);
    if (grantedChanged) localGrantedMovementReservations.clear();
    if (turnStateChanged || grantedChanged) refreshCombatTracker();
  });
  updateItemDispatcher.subscribe("turn.item-render", item => {
    if (item?.parent?.type === "personaje" || item?.parent?.type === "character") refreshCombatTracker();
  }, { priority: 150, critical: false });
  preUpdateTokenDispatcher.subscribe("turn.movement-guard", (token, changes, options, userId) =>
    validateTurnMovement(token, changes, options, userId), { priority: 20, critical: true });
  updateTokenDispatcher.subscribe("turn.movement-commit", (token, changes, options, userId) =>
    commitTurnMovement(token, options, userId, changes), { priority: 20, critical: true });
  Hooks.on("renderCombatTracker", installCombatTrackerButton);
}

export function installMtrolTurnApi() {
  game.mtrol = game.mtrol || {};
  game.mtrol.turns = {
    getTurnContext,
    getCombatantTurnState,
    getGrantedMovement,
    getAvailableMovement,
    getEnemiesInAttackRange,
    getAttributeFollowUpTargetGuard,
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
    completeAttributeMovement,
    completeGrantedMovement,
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
  completeAttributeMovementAuthoritative,
  commitGrantedMovementAuthoritative,
  completeGrantedMovementAuthoritative,
  commitReactionMovementAuthoritative,
  endTurnAuthoritative
};
