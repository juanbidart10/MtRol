import {
  resolveOpposedAction
} from "./resolution-engine.js";

import {
  applyResolvedActionStateAuthoritative
} from "../states/state-engine.js";

import {
  getEquippedShields
} from "../items/equipment-engine.js";

import {
  applyShieldWear
} from "../items/shield-wear-engine.js";

import {
  isPrimaryActiveGM,
  requestPrimaryGM
} from "../core/socket-requests.js";

import {
  mtrolSerializeRoll,
  mtrolSerializeRolls
} from "../rolls/chat-rolls.js";

import {
  buildResolutionContent,
  createInvalidDefenseMessage,
  createPendingActionMessage,
  createResolutionMessage,
  escapeHTML,
  findPendingActionMessage,
  prepareResolutionChatRolls,
  REACTION_MOVEMENT_ACTION
} from "./pending-action-presentation.js";

import {
  resolveActionDefinition as getActionDefinitionFromItem,
  resolveCanonicalDamageContext as getCanonicalDamageContext
} from "./action-definition-resolver.js";

export { resolveActionDefinition as getActionDefinitionFromItem } from "./action-definition-resolver.js";

import {
  completeResolvedTurnAction,
  finalizeResolvedCompetenciaUse,
  getActionGuard
} from "../combat/turn-system.js";

import {
  aplicarConsumoMP,
  validarConsumoMP
} from "../combat/mp-engine.js";

import {
  commandRegistry,
  runtimeRepository
} from "../runtime/runtime-foundation.js";

import {
  logger
} from "../utils/logger.js";

import {
  evaluateOppositionResponseEligibility,
  OPPOSITION_CAPABILITIES
} from "./opposition-policy.js";

import { pendingActionCache } from "./pending-action-cache.js";
import {
  assertCanonicalOffensiveConfiguration,
  normalizeContextualModifiers
} from "./combat-ability-policy.js";

import {
  configureActionDamageDependencies
} from "./action-damage-engine.js";

import {
  configureOppositionActionOperations,
  registerOppositionCommands
} from "../runtime/opposition-commands.js";

// Aliases de compatibilidad interna; caches reconstruibles desde RuntimeRepository.
const pendingActions = pendingActionCache.actions;
const resolvingActions = pendingActionCache.resolving;
const attachingDefenseActions = pendingActionCache.attachingDefense;

const PENDING_ACTION_TERMINAL_RETENTION_MS =
  10 * 60 * 1000;

let pendingActionsCleanupTimer =
  null;

let oppositionChatHandlerRegistered =
  false;

function createOperationId(prefix, stableId = null) {
  const id = stableId ?? foundry.utils.randomID();
  return `${prefix}:${id}`;
}

function getRuntimeCombat(combatId = null) {
  return runtimeRepository.resolveCombat(combatId ?? game.combat?.id ?? null);
}

async function dispatchLocalOppositionCommand(
  command,
  transactionId,
  payload,
  requestingUserId = game.user?.id ?? null
) {
  if (!commandRegistry.has(command)) {
    registerOppositionCommands();
  }
  const combatId = payload?.combatId ?? game.combat?.id ?? null;
  return commandRegistry.dispatch({
    command,
    transactionId,
    combatId,
    payload
  }, {
    requestingUserId,
    isPrimaryGM: isPrimaryActiveGM()
  });
}

async function ensurePendingActionCache(combatId = null) {
  const combat = getRuntimeCombat(combatId);
  if (!combat) return null;
  const runtime = await runtimeRepository.ensure(combat);
  await hydratePendingActionsFromRuntime(runtime, combat);
  return { combat, runtime };
}

async function persistPendingAction(pendingAction) {
  if (!pendingAction?.id) throw new Error("PendingAction sin ID estable.");
  const combat = getRuntimeCombat(pendingAction.combatId);
  if (!combat) throw new Error("No existe Combat activo para persistir pendingAction.");
  pendingAction.combatId = combat.id;
  const serialized = serializePendingAction(pendingAction);
  const mutation = await runtimeRepository.mutate(combat, draft => {
    draft.pendingActions[pendingAction.id] = serialized;
  });
  pendingActions.set(pendingAction.id, pendingAction);
  return mutation.runtime.pendingActions[pendingAction.id];
}

export async function persistPendingActionRuntime(pendingAction) {
  return persistPendingAction(pendingAction);
}

export async function hydratePendingActionsFromRuntime(runtime = null, combat = null) {
  const combatId = combat?.id ?? null;
  const runtimeIds = new Set(Object.keys(runtime?.pendingActions ?? {}));
  if (combatId) {
    for (const [id, pendingAction] of pendingActions.entries()) {
      if (
        (pendingAction.combatId === combatId || !pendingAction.combatId) &&
        !runtimeIds.has(id)
      ) {
        pendingActions.delete(id);
      }
    }
  } else {
    pendingActions.clear();
  }
  for (const value of Object.values(runtime?.pendingActions ?? {})) {
    if (!value?.id) continue;
    const incoming = foundry.utils.deepClone(value);
    const existing = pendingActions.get(value.id);
    if (existing) Object.assign(existing, incoming);
    else pendingActions.set(value.id, incoming);
  }
  return Array.from(pendingActions.values());
}

function getTokenId(token) {
  return token?.document?.id ?? token?.id ?? null;
}

function getTokenUuid(token) {
  return token?.document?.uuid ?? token?.uuid ?? null;
}

function rollToData(rollData = {}) {
  const roll =
    rollData.roll ?? null;

  const rolls =
    Array.isArray(rollData.rolls) && rollData.rolls.length
      ? rollData.rolls
      : roll
        ? [roll]
        : [];

  return {
    total: Number(rollData.total ?? roll?.total ?? 0),
    isFumble: rollData.isFumble === true || rollData.pifia === true,
    isCritical: rollData.isCritical === true || rollData.critico === true,
    formula: rollData.formula ?? roll?.formula ?? "",
    chatMessageId: rollData.chatMessageId ?? null,
    rolls: mtrolSerializeRolls(rolls)
  };
}

function isValidRollData(rollData = {}) {
  const normalized =
    rollToData(rollData);

  return (
    Number.isFinite(normalized.total) &&
    typeof normalized.isFumble === "boolean"
  );
}

export function userCanControlActor(actor, userId) {
  const user =
    game.users.get(userId);

  if (!user || !actor) return false;
  if (user.isGM) return true;

  return actor.testUserPermission?.(user, "OWNER") === true;
}

function serializeResolutionResult(result = null) {
  if (!result) return null;

  return {
    success: result.success === true,
    reason: result.reason ?? null,
    attackerTotal: Number(result.attackerTotal ?? 0),
    defenderTotal: Number(result.defenderTotal ?? 0),
    tieBreaker: result.tieBreaker
      ? {
          total: Number(result.tieBreaker.total ?? 0),
          winner: result.tieBreaker.winner ?? null,
          rollData:
            mtrolSerializeRoll(result.tieBreaker.roll) ??
            result.tieBreaker.rollData ??
            null
        }
      : null
  };
}

function serializeShieldWear(shieldWear = null) {
  if (!shieldWear) return null;

  const {
    wearRoll,
    ...serializable
  } = shieldWear;

  return foundry.utils.deepClone({
    ...serializable,
    wearRollData:
      mtrolSerializeRoll(wearRoll) ??
      serializable.wearRollData ??
      null
  });
}

export function serializePendingAction(pendingAction) {
  if (!pendingAction) return null;

  const {
    result,
    shieldWear,
    ...plainPendingAction
  } = pendingAction;

  return {
    ...foundry.utils.deepClone(plainPendingAction),
    result: serializeResolutionResult(result),
    shieldWear: serializeShieldWear(shieldWear)
  };
}

export function broadcastPendingAction(pendingAction) {
  if (!game.user?.isGM || !pendingAction) return;

  const targetActor = game.actors?.get?.(pendingAction.targetActorId) ?? null;
  if (targetActor?.sheet?.rendered) targetActor.sheet.render(false);

  game.socket.emit("system.mtrol", {
    action: "mtrolPendingActionSync",
    pendingAction: serializePendingAction(pendingAction)
  });
}

function broadcastPendingActionCleared(pendingActionId) {
  if (!game.user?.isGM || !pendingActionId) return;

  game.socket.emit("system.mtrol", {
    action: "mtrolPendingActionCleared",
    pendingActionId
  });
}

async function cleanupExpiredPendingActions() {
  if (!game.user?.isGM) return;
  const now =
    Date.now();

  for (const [id, pendingAction] of pendingActions.entries()) {
    const terminal =
      ["resolved", "cancelled"].includes(pendingAction.status);

    if (!terminal) continue;
    if (
      pendingAction.winnerResolutionResult === "damage" &&
      pendingAction.damage?.status === "available"
    ) continue;
    const expiresAt = Number(pendingAction.resolvedAt ?? pendingAction.cancelledAt ?? 0) +
      PENDING_ACTION_TERMINAL_RETENTION_MS;

    if (!expiresAt || expiresAt > now || pendingAction.terminalHandledAt) continue;

    if (pendingAction.reactionMovement?.status === "available") {
      pendingAction.reactionMovement.status = "skipped";
      pendingAction.reactionMovement.reason = "timeout";
      pendingAction.reactionMovement.closedAt = now;
      pendingAction.updatedAt = now;
    }

    pendingAction.terminalHandledAt = now;
    await persistPendingAction(pendingAction);
    broadcastPendingAction(pendingAction);

    if (game.user?.isGM && pendingAction.sourceActorUuid) {
      try {
        const sourceActor = await fromUuid(pendingAction.sourceActorUuid);
        if (sourceActor) await completeResolvedTurnAction(sourceActor, {
          resolutionId: pendingAction.id,
          completionId: `opposition-expired:${pendingAction.id}`
        });
      } catch (error) {
        logger.error("OPPOSITION", "expired opposition could not close turn", {
          pendingActionId: pendingAction.id,
          error: error.message
        });
      }
    }
  }
}

export function receivePendingActionSync(serializedPendingAction) {
  if (!serializedPendingAction?.id) return null;

  const existing =
    pendingActions.get(serializedPendingAction.id);

  const incomingUpdatedAt =
    Number(serializedPendingAction.updatedAt ?? serializedPendingAction.createdAt ?? 0);

  const existingUpdatedAt =
    Number(existing?.updatedAt ?? existing?.createdAt ?? 0);

  if (existing && existingUpdatedAt > incomingUpdatedAt) {
    return existing;
  }

  const pendingAction = existing ?? {};
  Object.assign(pendingAction, foundry.utils.deepClone(serializedPendingAction));
  pendingActions.set(pendingAction.id, pendingAction);

  const targetActor = game.actors?.get?.(pendingAction.targetActorId) ?? null;
  if (targetActor?.sheet?.rendered) targetActor.sheet.render(false);

  return pendingAction;
}

export function receivePendingActionCleared(pendingActionId) {
  if (!pendingActionId) return false;
  const pendingAction = pendingActions.get(pendingActionId);
  const removed = pendingActions.delete(pendingActionId);
  const targetActor = game.actors?.get?.(pendingAction?.targetActorId) ?? null;
  if (targetActor?.sheet?.rendered) targetActor.sheet.render(false);
  return removed;
}

function normalizeDamageContext(data = {}) {
  data =
    data ?? {};

  const formula =
    typeof data.formula === "string"
      ? data.formula.trim()
      : "";

  const flatValue =
    data.flatValue ?? null;

  const hasFlatValue =
    flatValue !== null &&
    flatValue !== undefined &&
    flatValue !== "" &&
    Number.isFinite(Number(flatValue));

  const available =
    Boolean(data.available) &&
    (formula.length > 0 || hasFlatValue);

  return {
    id: data.id ?? null,
    available,
    rolled: false,
    status: available ? "available" : "unavailable",
    formula,
    damageFormula: data.damageFormula ?? formula,
    flatValue: hasFlatValue ? Number(flatValue) : null,
    damageSourceAttribute: data.damageSourceAttribute ?? null,
    sourceActorUuid: data.sourceActorUuid ?? null,
    sourceTokenUuid: data.sourceTokenUuid ?? null,
    targetActorUuid: data.targetActorUuid ?? null,
    targetTokenUuid: data.targetTokenUuid ?? null,
    competenciaUuid: data.competenciaUuid ?? null,
    competenciaId: data.competenciaId ?? null,
    competenciaName: data.competenciaName ?? null,
    title: data.title ?? data.competenciaName ?? null,
    icon: data.icon ?? "",
    localized: data.localized !== false,
    costoTotal: Number(data.costoTotal ?? 0),
    resolution: data.resolution ?? "onOppositionWin",
    mode: data.mode ?? "enabled",
    costType: data.costType ?? "none",
    basicCostIncludedInActivation:
      data.basicCostIncludedInActivation === true,
    additionalMpCost:
      data.costType === "basic" &&
      data.basicCostIncludedInActivation !== true
        ? 1
        : 0,
    additionalCostApplied: false,
    rollData: foundry.utils.deepClone(data.rollData ?? {}),
    modifiers: foundry.utils.deepClone(data.modifiers ?? []),
    declaredMode: data.declaredMode ?? null,
    actionModifiers: Array.from(data.actionModifiers ?? []),
    createdFromPendingActionId: data.createdFromPendingActionId ?? null,
    receiptLinkage: data.receiptLinkage ?? null,
    total: null,
    fumble: false,
    error: null,
    rolledAt: null,
    lastUserId: null
  };
}

export async function recoverPendingActionPresentation(pendingAction) {
  if (!pendingAction) return null;
  const waiting = pendingAction.status === "waiting-defense";
  const resolvedInteraction = pendingAction.status === "resolved" &&
    pendingAction.result &&
    (
      (
        pendingAction.damage?.available === true &&
        pendingAction.damage?.rolled !== true &&
        pendingAction.damage?.mode === "enabled"
      ) ||
      pendingAction.reactionMovement?.status === "available"
    );
  if (!waiting && !resolvedInteraction) return null;

  const messageId = waiting
    ? pendingAction.pendingMessageId
    : pendingAction.resolutionMessageId;
  const presentationType = waiting
    ? "opposition-pending"
    : "opposition-resolution";
  const existing = (
    messageId
      ? game.messages?.get?.(messageId) ?? null
      : null
  ) ?? findPendingActionMessage(pendingAction.id, presentationType);
  if (existing) {
    if (messageId !== existing.id) {
      if (waiting) pendingAction.pendingMessageId = existing.id;
      else pendingAction.resolutionMessageId = existing.id;
      pendingAction.updatedAt = Date.now();
      await persistPendingAction(pendingAction);
    }
    return existing;
  }

  const message = waiting
    ? await createPendingActionMessage(pendingAction)
    : await createResolutionMessage(pendingAction, pendingAction.result);
  if (waiting) pendingAction.pendingMessageId = message?.id ?? null;
  pendingAction.presentationRecoveredAt = Date.now();
  pendingAction.updatedAt = pendingAction.presentationRecoveredAt;
  await persistPendingAction(pendingAction);
  logger.warn("RECOVERY", "opposition presentation recreated", {
    combatId: pendingAction.combatId,
    pendingActionId: pendingAction.id,
    messageId: waiting
      ? pendingAction.pendingMessageId
      : pendingAction.resolutionMessageId,
    presentationType
  });
  return message;
}

function buildPendingAction(data = {}) {
  const now =
    Date.now();

  const id =
    data.id ?? foundry.utils.randomID();

  const pendingAction = {
    id,
    combatId: data.combatId ?? game.combat?.id ?? null,
    createTransactionId: data.createTransactionId ?? null,
    resolutionTransactionId: data.resolutionTransactionId ?? null,
    sourceUserId: data.sourceUserId ?? null,
    sourceActorId: data.sourceActorId ?? null,
    sourceActorUuid: data.sourceActorUuid ?? null,
    sourceActorName: data.sourceActorName ?? null,
    sourceTokenId: data.sourceTokenId ?? null,
    sourceTokenUuid: data.sourceTokenUuid ?? null,
    targetActorId: data.targetActorId ?? null,
    targetActorUuid: data.targetActorUuid ?? null,
    targetActorName: data.targetActorName ?? null,
    targetTokenId: data.targetTokenId ?? null,
    targetTokenUuid: data.targetTokenUuid ?? null,
    sourceItemId: data.sourceItemId ?? null,
    sourceItemName: data.sourceItemName ?? "Accion",
    actionType: data.actionType ?? "opposed",
    actionBehavior: data.actionBehavior ?? null,
    resolutionResult: data.resolutionResult ?? "utility",
    declaredMode: data.declaredMode ?? null,
    capabilities: Array.from(data.capabilities ?? []),
    actionDomain: data.actionDomain ?? null,
    allowedResponses: Array.from(data.allowedResponses ?? []),
    effect: data.effect ?? "none",
    defenseType: data.defenseType ?? "custom",
    defenseItemId: data.defenseItemId ?? null,
    defenseItemName: data.defenseItemName ?? null,
    defenseActionType: data.defenseActionType ?? null,
    defenseEffect: data.defenseEffect ?? null,
    responseItemId: data.responseItemId ?? null,
    responseItemName: data.responseItemName ?? null,
    responseActionType: data.responseActionType ?? null,
    responseEffect: data.responseEffect ?? null,
    responseResolutionResult: data.responseResolutionResult ?? null,
    responseDamage: data.responseDamage ?? null,
    responseDeclaration: data.responseDeclaration ?? null,
    reactionMovement: data.reactionMovement ?? null,
    shieldItemId: data.shieldItemId ?? null,
    shieldItemUuid: data.shieldItemUuid ?? null,
    shieldSlot: data.shieldSlot ?? null,
    effectDuration: Number(data.effectDuration ?? 1),
    effectIntensity: Number(data.effectIntensity ?? 0),
    oppositionType: data.oppositionType ?? "free",
    requiresOpposition: data.requiresOpposition === true,
    attackerRoll: rollToData(data.attackerRoll),
    defenderRoll: data.defenderRoll ? rollToData(data.defenderRoll) : null,
    damage: normalizeDamageContext(data.damage),
    damageEntitlements: [],
    status: "waiting-defense",
    createdAt: data.createdAt ?? now,
    updatedAt: data.updatedAt ?? now,
    expiresAt: null,
    resolvedAt: data.resolvedAt ?? null,
    cancelledAt: data.cancelledAt ?? null,
    cancellationReason: data.cancellationReason ?? null,
    recoveryReason: data.recoveryReason ?? null,
    pendingMessageId: data.pendingMessageId ?? null,
    resolutionMessageId: data.resolutionMessageId ?? null,
    result: data.result ?? null,
    shieldWear: data.shieldWear ?? null
  };
  if (pendingAction.damage.available) {
    pendingAction.damage.id ??= `damage:${id}:1`;
    pendingAction.damage.createdFromPendingActionId = id;
    pendingAction.damageEntitlements = [pendingAction.damage];
  }
  return pendingAction;
}

async function canonicalizePendingActionData(data, requestingUserId) {
  const sourceActor =
    data.sourceActorUuid
      ? await fromUuid(data.sourceActorUuid)
      : game.actors?.get?.(data.sourceActorId) ?? null;

  const targetActor =
    data.targetActorUuid
      ? await fromUuid(data.targetActorUuid)
      : game.actors?.get?.(data.targetActorId) ?? null;

  if (!sourceActor || !targetActor) {
    throw new Error("La acción enfrentada no contiene actores válidos.");
  }

  if (!userCanControlActor(sourceActor, requestingUserId)) {
    throw new Error("El usuario no controla al actor atacante.");
  }

  const sourceItem =
    sourceActor.items.get(data.sourceItemId);

  if (!sourceItem || sourceItem.type !== "competencia") {
    throw new Error("La competencia atacante ya no existe.");
  }

  const turnGuard = getActionGuard(sourceActor, sourceItem);
  if (!turnGuard.allowed) throw new Error(turnGuard.reason);

  const definition =
    getActionDefinitionFromItem(sourceItem, { declaredMode: data.declaredMode ?? null });

  if (!definition.requiresOpposition) {
    throw new Error("La competencia no requiere una resolución enfrentada.");
  }

  if (!definition.capabilities.includes(OPPOSITION_CAPABILITIES.OFFENSIVE)) {
    throw new Error("La acción enfrentada no declara capability OFFENSIVE.");
  }

  if (!definition.actionDomain) {
    ui.notifications?.warn?.(
      `MTROL | Configuración inválida: ${sourceItem.name} requiere un dominio PHYSICAL o MAGICAL.`
    );
    throw new Error("La acción ofensiva enfrentada no tiene actionDomain válido.");
  }

  assertCanonicalOffensiveConfiguration({
    item: sourceItem,
    targetActor,
    definition,
    declaredMode: data.declaredMode ?? null
  });

  if (!isValidRollData(data.attackerRoll)) {
    throw new Error("La tirada atacante no es válida.");
  }

  const requestingUser = game.users?.get?.(requestingUserId);
  const suppliedModifiers = requestingUser?.isGM === true
    ? normalizeContextualModifiers(data.damage?.modifiers ?? [], { allowGmOnly: true })
    : [];
  const pendingAction = {
    ...data,
    sourceUserId: requestingUserId,
    sourceActorId: sourceActor.id,
    sourceActorUuid: sourceActor.uuid,
    sourceActorName: sourceActor.name,
    targetActorId: targetActor.id,
    targetActorUuid: targetActor.uuid,
    targetActorName: targetActor.name,
    sourceItemId: sourceItem.id,
    sourceItemName: sourceItem.name,
    actionType: definition.actionType,
    actionBehavior: definition.actionBehavior,
    resolutionResult: definition.resolutionResult,
    declaredMode: data.declaredMode ?? null,
    actionModifiers: requestingUser?.isGM === true
      ? normalizeContextualModifiers(data.actionModifiers ?? [], { allowGmOnly: true })
      : [],
    capabilities: definition.capabilities,
    actionDomain: definition.actionDomain,
    allowedResponses: definition.allowedResponses,
    effect: definition.effect,
    defenseType: definition.defenseType,
    effectDuration: definition.effectDuration,
    effectIntensity: definition.effectIntensity,
    oppositionType: definition.oppositionType,
    requiresOpposition: true,
    damage: getCanonicalDamageContext({
      sourceActor,
      sourceItem,
      targetActor,
      requiresOpposition: true,
      data: {
        ...(data.damage ?? {}),
        declaredMode: data.declaredMode ?? null,
        modifiers: suppliedModifiers
      }
    })
  };
  return pendingAction;
}

export async function createPendingActionAuthoritative(
  data = {},
  {
    requestingUserId = game.user?.id,
    transactionId = null
  } = {}
) {
  if (!game.user?.isGM) {
    throw new Error("Solo el GM autoritativo puede registrar acciones pendientes.");
  }

  const runtimeContext = await ensurePendingActionCache(data.combatId ?? null);
  if (!runtimeContext) throw new Error("No existe Combat activo para crear la oposicion.");
  await cleanupExpiredPendingActions();

  const stableId = data.id ?? foundry.utils.randomID();
  transactionId = transactionId ?? createOperationId("opposition.create", stableId);
  data = {
    ...data,
    id: stableId,
    combatId: runtimeContext.combat.id,
    createTransactionId: transactionId
  };

  if (data.id && pendingActions.has(data.id)) {
    const existing =
      pendingActions.get(data.id);

    const existingSourceActor =
      existing.sourceActorUuid
        ? await fromUuid(existing.sourceActorUuid)
        : null;

    if (!userCanControlActor(existingSourceActor, requestingUserId)) {
      throw new Error("El usuario no controla la acción pendiente existente.");
    }

    return existing;
  }

  const canonicalData =
    await canonicalizePendingActionData(
      data,
      requestingUserId
    );

  const pendingAction =
    buildPendingAction(canonicalData);

  pendingActions.set(
    pendingAction.id,
    pendingAction
  );

  await persistPendingAction(pendingAction);
  logger.info("OPPOSITION", "pending action created", {
    combatId: pendingAction.combatId,
    pendingActionId: pendingAction.id,
    transactionId,
    actionDomain: pendingAction.actionDomain,
    allowedResponses: pendingAction.allowedResponses
  });

  try {
    const message = await createPendingActionMessage(pendingAction);
    pendingAction.pendingMessageId = message?.id ?? null;
    pendingAction.updatedAt = Date.now();
    await persistPendingAction(pendingAction);
  } catch (error) {
    logger.warn("RECOVERY", "pending action persisted without presentation", {
      combatId: pendingAction.combatId,
      pendingActionId: pendingAction.id,
      transactionId,
      error: error.message
    });
  }
  broadcastPendingAction(pendingAction);

  return pendingAction;
}

export async function createPendingAction(data = {}) {
  const id = data.id ?? foundry.utils.randomID();
  const transactionId = data.transactionId ?? createOperationId("opposition.create", id);
  data = { ...data, id, combatId: data.combatId ?? game.combat?.id ?? null };
  if (game.user?.isGM && isPrimaryActiveGM()) {
    const result = await dispatchLocalOppositionCommand(
      "opposition.create",
      transactionId,
      { transactionId, combatId: data.combatId, pendingAction: data }
    );
    return receivePendingActionSync(result?.pendingAction);
  }

  const response =
    await requestPrimaryGM(
      "mtrolCreatePendingAction",
      {
        transactionId,
        pendingAction: {
          ...data,
          attackerRoll: rollToData(data.attackerRoll)
        }
      }
    );

  if (!response.ok) return null;

  return receivePendingActionSync(
    response.result?.pendingAction
  );
}

export async function createPendingActionFromCompetencia({
  actor,
  item,
  targetToken,
  attackerRoll,
  damage = null,
    declaredMode = null,
    actionModifiers = []
} = {}) {
  const definition =
    getActionDefinitionFromItem(item, { declaredMode });

  if (!definition.requiresOpposition) return null;

  if (!targetToken?.actor) {
    ui.notifications.warn("MTROL | La accion enfrentada necesita un objetivo.");
    return null;
  }

  return createPendingAction({
    sourceActorId: actor?.id ?? null,
    sourceActorUuid: actor?.uuid ?? null,
    sourceTokenId: getTokenId(actor?.getActiveTokens?.()[0]),
    sourceTokenUuid: getTokenUuid(actor?.getActiveTokens?.()[0]),
    targetActorId: targetToken.actor.id,
    targetActorUuid: targetToken.actor.uuid,
    targetTokenId: getTokenId(targetToken),
    targetTokenUuid: getTokenUuid(targetToken),
    sourceItemId: item?.id ?? null,
    sourceItemName: item?.name ?? "Accion",
    actionType: definition.actionType,
    actionBehavior: definition.actionBehavior,
    resolutionResult: definition.resolutionResult,
    declaredMode,
    actionModifiers,
    capabilities: definition.capabilities,
    actionDomain: definition.actionDomain,
    allowedResponses: definition.allowedResponses,
    effect: definition.effect,
    defenseType: definition.defenseType,
    effectDuration: definition.effectDuration,
    effectIntensity: definition.effectIntensity,
    oppositionType: definition.oppositionType,
    requiresOpposition: true,
    attackerRoll,
    damage: damage
      ? {
          ...damage,
          sourceActorUuid: actor?.uuid ?? damage.sourceActorUuid ?? null,
          sourceTokenUuid: getTokenUuid(actor?.getActiveTokens?.()[0]) ?? damage.sourceTokenUuid ?? null,
          targetActorUuid: targetToken.actor.uuid,
          targetTokenUuid: getTokenUuid(targetToken),
          competenciaUuid: item?.uuid ?? null,
          competenciaId: item?.id ?? null,
          competenciaName: item?.name ?? null
        }
      : null
  });
}

export async function createReadyDamageActionAuthoritative(data = {}, {
  requestingUserId = game.user?.id
} = {}) {
  void data;
  void requestingUserId;
  throw new Error("El daño directo está deshabilitado: toda acción ofensiva debe resolver una oposición.");
}

export async function createReadyDamageAction(data = {}) {
  if (game.user?.isGM) return createReadyDamageActionAuthoritative(data);

  const response = await requestPrimaryGM("mtrolCreateReadyDamageAction", {
    pendingAction: {
      ...data,
      attackerRoll: rollToData(data.attackerRoll)
    }
  });

  if (!response.ok) return null;
  return receivePendingActionSync(response.result?.pendingAction);
}

export async function createReadyDamageActionFromCompetencia({
  actor,
  item,
  targetToken,
  attackerRoll,
  damage = null
} = {}) {
  if (!targetToken?.actor) {
    ui.notifications.warn("MTROL | La resolución de daño necesita un objetivo.");
    return null;
  }

  return createReadyDamageAction({
    sourceActorId: actor?.id ?? null,
    sourceActorUuid: actor?.uuid ?? null,
    sourceTokenUuid: getTokenUuid(actor?.getActiveTokens?.()[0]),
    targetActorId: targetToken.actor.id,
    targetActorUuid: targetToken.actor.uuid,
    targetTokenUuid: getTokenUuid(targetToken),
    sourceItemId: item?.id ?? null,
    sourceItemName: item?.name ?? "Acción",
    attackerRoll,
    damage: damage
      ? {
          ...damage,
          sourceActorUuid: actor?.uuid ?? null,
          targetActorUuid: targetToken.actor.uuid,
          targetTokenUuid: getTokenUuid(targetToken)
        }
      : null
  });
}

function getAvailableActionsForActor(actor) {
  if (!actor) return [];

  return Array.from(pendingActions.values())
    .filter(pendingAction =>
      pendingAction.status === "waiting-defense" &&
      (
        pendingAction.targetActorId === actor.id ||
        pendingAction.targetActorUuid === actor.uuid
      )
    )
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function getPendingOppositionForActor(actor) {
  return getAvailableActionsForActor(actor)[0] ?? null;
}

export function getReactionMovementForActor(actor) {
  if (!actor) return null;
  const pendingAction = Array.from(pendingActions.values()).find(value =>
    value.status === "resolved" &&
    value.reactionMovement?.status === "available" &&
    (
      value.targetActorId === actor.id ||
      value.targetActorUuid === actor.uuid
    )
  );
  if (!pendingAction) return null;
  return {
    pendingActionId: pendingAction.id,
    allowance: Number(pendingAction.reactionMovement.allowance ?? 0),
    tokenUuid: pendingAction.reactionMovement.tokenUuid ?? pendingAction.targetTokenUuid ?? null
  };
}

export async function declareOppositionResponseAuthoritative({
  pendingActionId = null,
  defenderActorUuid = null,
  responseItemId = null,
  selectedCapability = null,
  mode = null,
  requestingUserId = game.user?.id,
  transactionId = null
} = {}) {
  if (!game.user?.isGM) {
    throw new Error("Solo el GM autoritativo puede declarar una respuesta.");
  }
  await ensurePendingActionCache();
  const pendingAction = pendingActions.get(pendingActionId);
  const actor = await resolveDefenderActor(pendingAction, defenderActorUuid);
  const responseItem = actor?.items?.get?.(responseItemId) ?? null;
  const guard = actor && responseItem ? getActionGuard(actor, responseItem) : null;
  if (responseItem) {
    const responseDefinition = getActionDefinitionFromItem(responseItem, { declaredMode: mode });
    const initiatorActor = pendingAction?.sourceActorUuid
      ? await fromUuid(pendingAction.sourceActorUuid)
      : null;
    assertCanonicalOffensiveConfiguration({
      item: responseItem,
      targetActor: null,
      definition: responseDefinition
    });
  }
  const eligibility = evaluateOppositionResponseEligibility({
    pendingAction,
    actor,
    item: responseItem,
    selectedCapability,
    mode,
    guard,
    logger
  });
  if (!userCanControlActor(actor, requestingUserId)) {
    eligibility.valid = false;
    eligibility.reasonCode = "ACTOR_NOT_CONTROLLED";
    eligibility.humanReason = "El usuario no controla al actor defensor.";
  }
  if (!eligibility.valid) {
    logger.warn("OPPOSITION", "response declaration rejected", {
      combatId: pendingAction?.combatId ?? null,
      pendingActionId: pendingAction?.id ?? pendingActionId,
      transactionId,
      actionDomain: pendingAction?.actionDomain ?? null,
      selectedCapability: eligibility.selectedCapability,
      responseDomain: eligibility.metadata?.responseDomain ?? null,
      reasonCode: eligibility.reasonCode
    });
    const error = new Error(eligibility.humanReason);
    error.reasonCode = eligibility.reasonCode;
    error.eligibility = eligibility;
    throw error;
  }

  const existing = pendingAction.responseDeclaration;
  if (existing && (
    existing.itemId !== responseItem.id ||
    existing.selectedCapability !== eligibility.selectedCapability ||
    (existing.mode ?? null) !== (eligibility.metadata.mode ?? null)
  )) {
    const error = new Error("La respuesta ya fue declarada y no puede cambiarse durante esta oposición.");
    error.reasonCode = "RESPONSE_ALREADY_DECLARED";
    error.eligibility = {
      ...eligibility,
      valid: false,
      reasonCode: error.reasonCode,
      humanReason: error.message
    };
    throw error;
  }
  if (!existing) {
    pendingAction.responseDeclaration = {
      itemUuid: responseItem.uuid ?? null,
      itemId: responseItem.id,
      actionType: eligibility.metadata.actionType,
      selectedCapability: eligibility.selectedCapability,
      responseDomain: eligibility.metadata.responseDomain,
      mode: eligibility.metadata.mode,
      capabilities: eligibility.metadata.capabilities,
      legacyMapped: eligibility.metadata.legacyMapped,
      declaredAt: Date.now(),
      transactionId
    };
    pendingAction.updatedAt = Date.now();
    await persistPendingAction(pendingAction);
    broadcastPendingAction(pendingAction);
    logger.info("OPPOSITION", "response declared", {
      combatId: pendingAction.combatId,
      pendingActionId: pendingAction.id,
      transactionId,
      selectedCapability: eligibility.selectedCapability,
      responseDomain: eligibility.metadata.responseDomain
    });
  }
  return pendingAction;
}

export async function declareOppositionResponse({
  pendingActionId,
  actor,
  item,
  selectedCapability = null,
  mode = null
} = {}) {
  const transactionId = createOperationId(
    "opposition.declare-response",
    `${pendingActionId}:${item?.id ?? "response"}`
  );
  const payload = {
    pendingActionId,
    defenderActorUuid: actor?.uuid ?? null,
    responseItemId: item?.id ?? null,
    selectedCapability,
    mode,
    transactionId,
    combatId: game.combat?.id ?? null
  };
  if (game.user?.isGM && isPrimaryActiveGM()) {
    const result = await dispatchLocalOppositionCommand(
      "opposition.declare-response",
      transactionId,
      payload
    );
    if (result?.pendingAction) receivePendingActionSync(result.pendingAction);
    if (result?.rejected) {
      ui.notifications.warn(result.humanReason);
      return null;
    }
    return result?.pendingAction ?? null;
  }
  const response = await requestPrimaryGM("mtrolDeclareOppositionResponse", payload);
  if (!response.ok) {
    ui.notifications.warn(response.error);
    return null;
  }
  if (response.result?.pendingAction) receivePendingActionSync(response.result.pendingAction);
  if (response.result?.rejected) {
    ui.notifications.warn(response.result.humanReason);
    return null;
  }
  return response.result?.pendingAction ?? null;
}

async function resolveDefenderActor(pendingAction, defenderActorUuid = null) {
  const actorUuid =
    defenderActorUuid ??
    pendingAction?.targetActorUuid ??
    null;

  return actorUuid
    ? await fromUuid(actorUuid)
    : null;
}

async function validateShieldDefense(actor, defenseItem) {
  const definition = getActionDefinitionFromItem(defenseItem);
  const isShieldBlock =
    definition.capabilities.includes(OPPOSITION_CAPABILITIES.DEFENSE) &&
    defenseItem.system?.defenseType === "shield" &&
    defenseItem.system?.effect === "block";

  if (!isShieldBlock) {
    return {
      isShieldBlock: false,
      shield: null
    };
  }

  const shields =
    getEquippedShields(actor);

  if (shields.length === 0) {
    const message =
      `${actor.name} no tiene un escudo equipado para ejecutar Defensa con escudos.`;

    await createInvalidDefenseMessage(actor, message);
    throw new Error(message);
  }

  if (shields.length > 1) {
    const message =
      `${actor.name} tiene más de un escudo equipado. Debe seleccionar cuál utilizar.`;

    await createInvalidDefenseMessage(actor, message);
    throw new Error(message);
  }

  return {
    isShieldBlock: true,
    shield: shields[0]
  };
}

export async function attachDefenseRollAuthoritative({
  pendingActionId = null,
  defenderActorUuid = null,
  defenseItemId = null,
  defenderRoll = null,
  specialContext = null,
  consumeResponse = false,
  selectedCapability = null,
  mode = null,
  requestingUserId = game.user?.id,
  transactionId = null
} = {}) {
  if (!game.user?.isGM) {
    throw new Error("Solo el GM autoritativo puede asociar una defensa.");
  }

  await ensurePendingActionCache();
  await cleanupExpiredPendingActions();

  let pendingAction =
    pendingActionId
      ? pendingActions.get(pendingActionId)
      : null;

  if (!pendingAction && defenderActorUuid) {
    const defenderActor =
      await fromUuid(defenderActorUuid);

    if (defenderActor) {
      pendingAction =
        getAvailableActionsForActor(defenderActor)[0] ?? null;
    }
  }

  if (!pendingAction) {
    throw new Error("No hay acciones pendientes para este defensor.");
  }

  if (pendingAction.status !== "waiting-defense") {
    throw new Error("La acción pendiente ya está siendo resuelta o fue finalizada.");
  }

  if (attachingDefenseActions.has(pendingAction.id)) {
    throw new Error("La acción pendiente ya está recibiendo una defensa.");
  }

  attachingDefenseActions.add(pendingAction.id);

  try {
  const actor =
    await resolveDefenderActor(
      pendingAction,
      defenderActorUuid
    );

  if (!actor) {
    throw new Error("No se encontró el actor defensor.");
  }

  if (
    pendingAction.targetActorId !== actor.id &&
    pendingAction.targetActorUuid !== actor.uuid
  ) {
    throw new Error("El defensor no coincide con la acción pendiente.");
  }

  if (!userCanControlActor(actor, requestingUserId)) {
    throw new Error("El usuario no controla al actor defensor.");
  }

  const defenseItem =
    actor.items.get(defenseItemId);

  if (!defenseItem || defenseItem.type !== "competencia") {
    throw new Error("La acción de oposición no es válida.");
  }
  const declaredResponse = pendingAction.responseDeclaration ?? null;
  const responseDefinition = getActionDefinitionFromItem(defenseItem, {
    declaredMode: declaredResponse?.mode ?? mode
  });
  const initiatorActor = pendingAction.sourceActorUuid
    ? await fromUuid(pendingAction.sourceActorUuid)
    : null;
  assertCanonicalOffensiveConfiguration({
    item: defenseItem,
    targetActor: null,
    definition: responseDefinition
  });

  const responseGuard = getActionGuard(actor, defenseItem);
  if (declaredResponse && declaredResponse.itemId !== defenseItem.id) {
    throw new Error("La tirada no corresponde al Item de respuesta declarado.");
  }
  if (
    declaredResponse &&
    selectedCapability &&
    declaredResponse.selectedCapability !== String(selectedCapability).toUpperCase()
  ) {
    throw new Error("La capability seleccionada no coincide con la respuesta declarada.");
  }
  const eligibility = evaluateOppositionResponseEligibility({
    pendingAction,
    actor,
    item: defenseItem,
    selectedCapability: declaredResponse?.selectedCapability ?? selectedCapability,
    mode: declaredResponse?.mode ?? mode,
    guard: responseGuard,
    logger
  });
  if (!eligibility.valid) {
    logger.warn("OPPOSITION", "response rejected", {
      combatId: pendingAction.combatId,
      pendingActionId: pendingAction.id,
      transactionId,
      selectedCapability: eligibility.selectedCapability,
      actionDomain: pendingAction.actionDomain,
      responseDomain: eligibility.metadata.responseDomain,
      classPolicy: eligibility.metadata.classPolicy ?? null,
      reasonCode: eligibility.reasonCode
    });
    const error = new Error(eligibility.humanReason);
    error.reasonCode = eligibility.reasonCode;
    error.eligibility = eligibility;
    throw error;
  }

  if (!isValidRollData(defenderRoll)) {
    throw new Error("La tirada defensiva no es válida.");
  }

  const shieldValidation =
    await validateShieldDefense(
      actor,
      defenseItem
    );

  if (consumeResponse) {
    const consumoMP = validarConsumoMP(actor, defenseItem);
    if (!consumoMP?.exito) {
      throw new Error(consumoMP?.motivo ?? "No hay MP suficiente para responder la oposición.");
    }

    await finalizeResolvedCompetenciaUse(actor, defenseItem, defenderRoll, {
      specialContext
    });
    await aplicarConsumoMP(actor, consumoMP, { item: defenseItem });
  }

  pendingAction.defenderRoll =
    rollToData(defenderRoll);

  pendingAction.defenseActionType =
    defenseItem.system?.actionType ?? null;

  pendingAction.defenseEffect =
    defenseItem.system?.effect ?? null;

  pendingAction.defenseType =
    defenseItem.system?.defenseType ?? "custom";

  pendingAction.defenseItemId =
    defenseItem.id;

  pendingAction.defenseItemName =
    defenseItem.name;

  pendingAction.responseItemId =
    defenseItem.id;

  pendingAction.responseItemName =
    defenseItem.name;

  pendingAction.responseActionType =
    eligibility.metadata.actionType;

  pendingAction.responseEffect =
    defenseItem.system?.effect ?? "none";

  pendingAction.responseResolutionResult = responseDefinition.resolutionResult;

  pendingAction.responseDeclaration = {
    ...(declaredResponse ?? {}),
    itemUuid: defenseItem.uuid ?? null,
    itemId: defenseItem.id,
    actionType: eligibility.metadata.actionType,
    selectedCapability: eligibility.selectedCapability,
    responseDomain: eligibility.metadata.responseDomain,
    mode: eligibility.metadata.mode,
    capabilities: eligibility.metadata.capabilities,
    legacyMapped: eligibility.metadata.legacyMapped,
    declaredAt: declaredResponse?.declaredAt ?? Date.now()
  };

  pendingAction.responseDamage =
    getCanonicalDamageContext({
      sourceActor: actor,
      sourceItem: defenseItem,
      targetActor: initiatorActor,
      requiresOpposition: true,
      data: {
        declaredMode: declaredResponse?.mode ?? mode,
        sourceTokenUuid: pendingAction.targetTokenUuid,
        targetTokenUuid: pendingAction.sourceTokenUuid
      }
    });

  pendingAction.shieldItemId =
    shieldValidation.shield?.item?.id ?? null;

  pendingAction.shieldItemUuid =
    shieldValidation.shield?.item?.uuid ?? null;

  pendingAction.shieldSlot =
    shieldValidation.shield?.slot ?? null;

  pendingAction.status =
    "resolving";

  pendingAction.resolutionTransactionId =
    transactionId ?? createOperationId("opposition.respond", pendingAction.id);

  pendingAction.updatedAt =
    Date.now();

  await persistPendingAction(pendingAction);
  broadcastPendingAction(pendingAction);

  logger.info("OPPOSITION", "defense attached", {
    combatId: pendingAction.combatId,
    pendingActionId: pendingAction.id,
    transactionId: pendingAction.resolutionTransactionId,
    actionDomain: pendingAction.actionDomain,
    allowedResponses: pendingAction.allowedResponses,
    selectedCapability: pendingAction.responseDeclaration.selectedCapability,
    responseDomain: pendingAction.responseDeclaration.responseDomain
  });

  return await resolvePendingActionAuthoritative(
    pendingAction.id,
    {
      requestingUserId
    }
  );
  } finally {
    attachingDefenseActions.delete(pendingAction.id);
  }
}

function processAuthoritativeResponse(response) {
  if (!response.ok) {
    if (response.error) {
      ui.notifications.warn(response.error);
    }

    return null;
  }

  receivePendingActionSync(
    response.result?.pendingAction
  );

  if (response.result?.rejected) {
    ui.notifications.warn(response.result.humanReason);
    return null;
  }

  return response.result?.resolutionResult ?? null;
}

export async function attachDefenseRoll(pendingActionId, rollData = {}, options = {}) {
  const pendingAction =
    pendingActions.get(pendingActionId);

  if (!pendingAction) {
    throw new Error(`No existe pendingAction local: ${pendingActionId}`);
  }

  if (game.user?.isGM && isPrimaryActiveGM()) {
    const transactionId = options.transactionId ?? createOperationId(
      "opposition.respond",
      `${pendingActionId}:${rollData.itemId ?? "defense"}:${rollData.chatMessageId ?? rollData.total ?? "roll"}`
    );
    const result = await dispatchLocalOppositionCommand(
      "opposition.respond",
      transactionId,
      {
        pendingActionId,
        defenderActorUuid: pendingAction.targetActorUuid,
        defenseItemId: rollData.itemId,
        defenderRoll: rollData,
        specialContext: options.specialContext ?? null,
        consumeResponse: options.consumeResponse === true,
        selectedCapability: options.selectedCapability ?? null,
        mode: options.mode ?? null,
        transactionId,
        combatId: pendingAction.combatId ?? game.combat?.id ?? null
      }
    );
    receivePendingActionSync(result?.pendingAction);
    if (result?.rejected) {
      ui.notifications.warn(result.humanReason);
      return null;
    }
    return result?.resolutionResult ?? null;
  }

  const response =
    await requestPrimaryGM(
      "mtrolAttachDefenseRoll",
      {
        transactionId: options.transactionId ?? createOperationId(
          "opposition.respond",
          `${pendingActionId}:${rollData.itemId ?? "defense"}:${rollData.chatMessageId ?? rollData.total ?? "roll"}`
        ),
        pendingActionId,
        defenderActorUuid: pendingAction.targetActorUuid,
        defenseItemId: rollData.itemId,
        defenderRoll: rollToData(rollData),
        specialContext: options.specialContext ?? null,
        consumeResponse: options.consumeResponse === true,
        selectedCapability: options.selectedCapability ?? null,
        mode: options.mode ?? null
      }
    );

  return processAuthoritativeResponse(response);
}

async function selectPendingActionForDefense(pendingForActor = []) {
  if (pendingForActor.length <= 1) {
    return pendingForActor[0]?.id ?? null;
  }

  if (typeof Dialog !== "function") {
    throw new Error(
      "Hay varias acciones pendientes; debe indicarse cuál se está defendiendo."
    );
  }

  const options = pendingForActor
    .map(pendingAction => `
      <option value="${escapeHTML(pendingAction.id)}">
        ${escapeHTML(pendingAction.sourceActorName ?? "Atacante")} ·
        ${escapeHTML(pendingAction.sourceItemName ?? "Acción")} ·
        ${escapeHTML(pendingAction.attackerRoll?.total ?? "-")}
      </option>
    `)
    .join("");

  return new Promise(resolve => {
    let settled = false;

    const finish = value => {
      if (settled) return;
      settled = true;
      resolve(value || null);
    };

    new Dialog({
      title: "Seleccionar ataque a defender",
      content: `
        <form class="mtrol-defense-selection">
          <p>Hay varias acciones pendientes para este defensor.</p>
          <label>
            Ataque
            <select name="pendingActionId">${options}</select>
          </label>
        </form>
      `,
      buttons: {
        confirm: {
          label: "Defender",
          callback: html => {
            const selected =
              typeof html?.find === "function"
                ? html.find('[name="pendingActionId"]').val()
                : html?.querySelector?.('[name="pendingActionId"]')?.value;

            finish(selected);
          }
        },
        cancel: {
          label: "Cancelar",
          callback: () => finish(null)
        }
      },
      default: "confirm",
      close: () => finish(null)
    }).render(true);
  });
}

export async function attachDefenseRollForActor({
  actor,
  item,
  defenderRoll,
  pendingActionId = null,
  specialContext = null,
  consumeResponse = false,
  selectedCapability = null,
  mode = null
} = {}) {
  if (!actor || !item || item.type !== "competencia") return null;

  let selectedPendingActionId =
    pendingActionId;

  if (!selectedPendingActionId) {
    const pendingForActor =
      await requestPendingActionsForActor(actor);

    selectedPendingActionId =
      await selectPendingActionForDefense(pendingForActor);
  }

  if (!selectedPendingActionId) return null;

  return attachDefenseRoll(
    selectedPendingActionId,
    {
      ...defenderRoll,
      itemId: item.id
    },
    { specialContext, consumeResponse, selectedCapability, mode }
  );
}

export async function resolvePendingActionAuthoritative(
  pendingActionId,
  {
    requestingUserId = game.user?.id,
    transactionId = null
  } = {}
) {
  if (!game.user?.isGM) {
    throw new Error("Solo el GM autoritativo puede resolver acciones pendientes.");
  }

  await ensurePendingActionCache();
  const pendingAction =
    pendingActions.get(pendingActionId);

  if (!pendingAction) {
    throw new Error(`No existe pendingAction: ${pendingActionId}`);
  }

  if (pendingAction.status === "resolved") {
    throw new Error("La acción pendiente ya fue resuelta.");
  }

  if (
    pendingAction.status !== "resolving" ||
    !pendingAction.attackerRoll ||
    !pendingAction.defenderRoll
  ) {
    throw new Error("La acción pendiente no está lista para resolver.");
  }

  if (resolvingActions.has(pendingActionId)) {
    throw new Error("La acción pendiente ya está siendo resuelta.");
  }

  resolvingActions.add(pendingActionId);
  pendingAction.resolutionTransactionId = transactionId ??
    pendingAction.resolutionTransactionId ??
    createOperationId("opposition.resolve", pendingAction.id);

  try {
    const defenderActorForPermission =
      pendingAction.targetActorUuid
        ? await fromUuid(pendingAction.targetActorUuid)
        : null;

    if (!userCanControlActor(defenderActorForPermission, requestingUserId)) {
      throw new Error("El usuario no controla al actor defensor.");
    }
  } catch (error) {
    resolvingActions.delete(pendingActionId);
    throw error;
  }

  let result =
    null;

  try {
    result =
      await resolveOpposedAction(pendingAction);

    pendingAction.result =
      result;

    if (
      (
        pendingAction.responseDeclaration?.selectedCapability === OPPOSITION_CAPABILITIES.DEFENSE ||
        pendingAction.defenseActionType === "defense"
      ) &&
      pendingAction.defenseType === "shield" &&
      pendingAction.defenseEffect === "block" &&
      ["defender-higher", "tie-defender"].includes(result.reason)
    ) {
      const defenderActor =
        await fromUuid(pendingAction.targetActorUuid);

      const defenderToken =
        pendingAction.targetTokenUuid
          ? await fromUuid(pendingAction.targetTokenUuid)
          : null;

      pendingAction.shieldWear =
        await applyShieldWear({
          defenderActor,
          defenderToken,
          shieldItemId: pendingAction.shieldItemId,
          shieldItemUuid: pendingAction.shieldItemUuid,
          shieldSlot: pendingAction.shieldSlot,
          pendingAction,
          resolutionResult: result
        });
    }

    if (result.success && pendingAction.effect === "stunned") {
      await applyResolvedActionStateAuthoritative({
        combatId: pendingAction.combatId, pendingActionId,
        resolutionResult: result, requestingUserId
      });
    }

    if (!result.success && pendingAction.responseEffect === "stunned") {
      await applyResolvedActionStateAuthoritative({
        combatId: pendingAction.combatId, pendingActionId,
        resolutionResult: result, requestingUserId
      });
    }

    if (
      !result.success &&
      pendingAction.responseResolutionResult === "movement"
    ) {
      pendingAction.reactionMovement = {
        resolutionId: pendingAction.id,
        actorUuid: pendingAction.targetActorUuid,
        tokenUuid: pendingAction.targetTokenUuid,
        allowance: Math.max(0, Math.floor(Number(pendingAction.defenderRoll?.total ?? 0) / 10)),
        status: "available",
        grantedAt: Date.now()
      };
    }

    const winnerResolutionResult = result.success
      ? pendingAction.resolutionResult
      : pendingAction.responseResolutionResult ?? "defense";
    pendingAction.winnerResolutionResult = winnerResolutionResult;
    const entitlement = result.success ? pendingAction.damage : pendingAction.responseDamage;
    if (winnerResolutionResult === "damage" && entitlement?.available === true) {
      entitlement.id ??= `damage:${pendingAction.id}:${pendingAction.damageEntitlements.length + 1}`;
      entitlement.createdFromPendingActionId = pendingAction.id;
      entitlement.status = "available";
      entitlement.rolled = false;
      pendingAction.damage = entitlement;
      pendingAction.damageEntitlements = [entitlement];
    } else {
      pendingAction.damage = normalizeDamageContext({ available: false });
      pendingAction.damageEntitlements = [];
    }
  } catch (error) {
    pendingAction.result =
      null;

    pendingAction.shieldWear =
      null;

    pendingAction.status =
      "cancelled";

    pendingAction.cancelledAt =
      Date.now();

    pendingAction.updatedAt =
      pendingAction.cancelledAt;

    pendingAction.cancellationReason =
      error.message;

    await persistPendingAction(pendingAction);
    broadcastPendingAction(pendingAction);

    try {
      const defenderActor =
        pendingAction.targetActorUuid
          ? await fromUuid(pendingAction.targetActorUuid)
          : null;

      await createInvalidDefenseMessage(
        defenderActor,
        `La acción fue cancelada: ${error.message}`
      );
    } catch (messageError) {
      logger.error("OPPOSITION", "action cancellation notification failed", {
        error: messageError
      });
    } finally {
      resolvingActions.delete(pendingActionId);
    }

    throw error;
  }

  pendingAction.status =
    "resolved";

  pendingAction.resolvedAt =
    Date.now();

  pendingAction.updatedAt =
    pendingAction.resolvedAt;

  await persistPendingAction(pendingAction);
  broadcastPendingAction(pendingAction);

  try {
    await createResolutionMessage(
      pendingAction,
      result
    );
    await persistPendingAction(pendingAction);
  } catch (error) {
    logger.error("OPPOSITION", "resolved action presentation failed", { error });
  }

  broadcastPendingAction(pendingAction);

  logger.info("OPPOSITION", "opposed action resolved", {
    combatId: pendingAction.combatId,
    pendingActionId,
    transactionId: pendingAction.resolutionTransactionId,
    success: result.success === true,
    reason: result.reason
  });

  const waitsForManualDamage = pendingAction.winnerResolutionResult === "damage" &&
    pendingAction.damage?.available === true &&
    pendingAction.damage?.mode === "enabled" &&
    pendingAction.damage?.status === "available";
  const waitsForReactionMovement =
    pendingAction.reactionMovement?.status === "available";
  if (!waitsForManualDamage && !waitsForReactionMovement) {
    const sourceActor = pendingAction.sourceActorUuid
      ? await fromUuid(pendingAction.sourceActorUuid)
      : null;
    if (sourceActor) {
      try {
        await completeResolvedTurnAction(sourceActor, {
          resolutionId: pendingAction.id,
          completionId: `opposition:${pendingAction.id}`
        });
      } catch (error) {
        logger.error("TURN", "turn advance after opposition failed", { error });
      }
    }
  }

  resolvingActions.delete(pendingActionId);

  await persistPendingAction(pendingAction);

  return {
    pendingAction,
    resolutionResult: result
  };
}

export async function resolvePendingAction(pendingActionId) {
  const transactionId = createOperationId("opposition.resolve", pendingActionId);
  if (game.user?.isGM && isPrimaryActiveGM()) {
    const result = await dispatchLocalOppositionCommand(
      "opposition.resolve",
      transactionId,
      { pendingActionId, transactionId, combatId: game.combat?.id ?? null }
    );
    receivePendingActionSync(result?.pendingAction);
    return result?.resolutionResult ?? null;
  }

  const response =
    await requestPrimaryGM(
      "mtrolResolvePendingAction",
      {
        pendingActionId,
        transactionId
      }
    );

  return processAuthoritativeResponse(response);
}

export async function requestPendingActionsForActor(
  actorOrUuid,
  {
    requestingUserId = game.user?.id
  } = {}
) {
  const actorUuid =
    typeof actorOrUuid === "string"
      ? actorOrUuid
      : actorOrUuid?.uuid;

  if (!actorUuid) return [];

  if (game.user?.isGM) {
    await ensurePendingActionCache();
    const actor =
      typeof actorOrUuid === "string"
        ? await fromUuid(actorUuid)
        : actorOrUuid;

    if (!userCanControlActor(actor, requestingUserId)) {
      throw new Error("El usuario no controla al actor defensor.");
    }

    return getAvailableActionsForActor(actor);
  }

  const response =
    await requestPrimaryGM(
      "mtrolRequestPendingActionsForActor",
      {
        actorUuid
      }
    );

  if (!response.ok) return [];

  return (response.result?.pendingActions ?? [])
    .map(receivePendingActionSync)
    .filter(Boolean);
}

export async function clearPendingActionAuthoritative(
  pendingActionId,
  {
    requestingUserId = game.user?.id,
    reason = "cancelled",
    transactionId = null
  } = {}
) {
  if (!game.user?.isGM) {
    throw new Error("Solo el GM autoritativo puede limpiar acciones pendientes.");
  }

  await ensurePendingActionCache();
  const pendingAction =
    pendingActions.get(pendingActionId);

  if (!pendingAction) return false;

  const sourceActor =
    pendingAction.sourceActorUuid
      ? await fromUuid(pendingAction.sourceActorUuid)
      : null;

  if (!userCanControlActor(sourceActor, requestingUserId)) {
    throw new Error("El usuario no puede cancelar esta acción.");
  }

  if (pendingAction.status === "resolving") {
    throw new Error("No se puede cancelar una acción que está resolviéndose.");
  }

  pendingAction.status =
    "cancelled";

  pendingAction.cancelledAt =
    Date.now();

  pendingAction.updatedAt =
    pendingAction.cancelledAt;

  pendingAction.cancellationReason =
    reason;

  pendingAction.cancelTransactionId = transactionId ??
    createOperationId("opposition.cancel", pendingAction.id);
  await persistPendingAction(pendingAction);
  broadcastPendingAction(pendingAction);

  if (sourceActor) {
    await completeResolvedTurnAction(sourceActor, {
      resolutionId: pendingAction.id,
      completionId: `opposition-cancelled:${pendingAction.id}`
    });
  }

  return true;
}

export async function clearPendingAction(pendingActionId, reason = "cancelled") {
  const transactionId = createOperationId("opposition.cancel", pendingActionId);
  if (game.user?.isGM && isPrimaryActiveGM()) {
    const result = await dispatchLocalOppositionCommand(
      "opposition.cancel",
      transactionId,
      { pendingActionId, reason, transactionId, combatId: game.combat?.id ?? null }
    );
    if (result?.pendingAction) receivePendingActionSync(result.pendingAction);
    return true;
  }

  const response =
    await requestPrimaryGM(
      "mtrolClearPendingAction",
      {
        pendingActionId,
        reason,
        transactionId
      }
    );

  if (!response.ok) {
    if (response.error) ui.notifications.warn(response.error);
    return false;
  }

  if (response.result?.pendingAction) {
    receivePendingActionSync(
      response.result.pendingAction
    );
  }

  return true;
}

export async function completeReactionMovementAuthoritative(
  pendingActionId,
  {
    actorUuid = null,
    tokenUuid = null,
    cost = 0,
    requestingUserId = game.user?.id,
    reason = "skipped"
  } = {}
) {
  if (!game.user?.isGM) {
    throw new Error("Sólo el GM autoritativo puede cerrar el movimiento reactivo.");
  }
  await ensurePendingActionCache();
  const pendingAction = pendingActions.get(pendingActionId);
  const movement = pendingAction?.reactionMovement;
  if (!pendingAction || pendingAction.status !== "resolved" || movement?.status !== "available") {
    throw new Error("El movimiento reactivo ya no está disponible.");
  }
  const actor = movement.actorUuid ? await fromUuid(movement.actorUuid) : null;
  if (!actor || !userCanControlActor(actor, requestingUserId)) {
    throw new Error("El usuario no controla al Actor que obtuvo la Esquiva.");
  }
  if (actorUuid && actor.uuid !== actorUuid) {
    throw new Error("El Actor no coincide con esta Esquiva.");
  }
  if (tokenUuid && movement.tokenUuid && tokenUuid !== movement.tokenUuid) {
    throw new Error("El Token no coincide con esta Esquiva.");
  }
  const spent = Math.max(0, Math.trunc(Number(cost) || 0));
  if (spent > Number(movement.allowance ?? 0)) {
    throw new Error("El movimiento supera el cuadro concedido por Esquiva.");
  }
  movement.status = spent > 0 ? "used" : "skipped";
  movement.spent = spent;
  movement.closedAt = Date.now();
  movement.reason = reason;
  pendingAction.updatedAt = movement.closedAt;
  await persistPendingAction(pendingAction);
  broadcastPendingAction(pendingAction);
  await updateResolutionMessage(pendingAction);

  const sourceActor = pendingAction.sourceActorUuid
    ? await fromUuid(pendingAction.sourceActorUuid)
    : null;
  if (sourceActor) {
    await completeResolvedTurnAction(sourceActor, {
      resolutionId: pendingAction.id,
      completionId: `reaction-movement:${pendingAction.id}`
    });
  }
  return { pendingAction, movement: foundry.utils.deepClone(movement) };
}

export async function completeReactionMovement(pendingActionId, options = {}) {
  const transactionId = options.transactionId ??
    createOperationId("opposition.reaction-complete", pendingActionId);
  if (game.user?.isGM && isPrimaryActiveGM()) {
    const result = await dispatchLocalOppositionCommand(
      "opposition.reaction-complete",
      transactionId,
      {
        pendingActionId,
        actorUuid: options.actorUuid ?? null,
        tokenUuid: options.tokenUuid ?? null,
        cost: options.cost ?? 0,
        reason: options.reason ?? "skipped",
        transactionId,
        combatId: game.combat?.id ?? null
      }
    );
    if (result?.pendingAction) receivePendingActionSync(result.pendingAction);
    return result;
  }
  const response = await requestPrimaryGM("mtrolCompleteReactionMovement", {
    pendingActionId,
    actorUuid: options.actorUuid ?? null,
    tokenUuid: options.tokenUuid ?? null,
    cost: options.cost ?? 0,
    reason: options.reason ?? "skipped",
    transactionId
  });
  if (!response.ok) throw new Error(response.error ?? "No se pudo cerrar el movimiento reactivo.");
  if (response.result?.pendingAction) receivePendingActionSync(response.result.pendingAction);
  return response.result;
}

async function onReactionMovementClick(event) {
  const button = event.target.closest?.(`[data-action="${REACTION_MOVEMENT_ACTION}"]`);
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  button.disabled = true;
  try {
    await completeReactionMovement(button.dataset.pendingActionId, { reason: "skipped" });
  } catch (error) {
    ui.notifications.warn(error.message ?? "No se pudo omitir el movimiento reactivo.");
    button.disabled = false;
  }
}

export function registerOppositionChatHandler() {
  if (oppositionChatHandlerRegistered) return;
  oppositionChatHandlerRegistered = true;
  Hooks.on("renderChatMessage", (_message, html) => {
    const selector = `[data-action="${REACTION_MOVEMENT_ACTION}"]`;
    if (typeof html?.find === "function") {
      html.find(selector)
        .off("click.mtrolReactionMovement")
        .on("click.mtrolReactionMovement", onReactionMovementClick);
      return;
    }
    html?.querySelectorAll?.(selector).forEach(button => {
      button.removeEventListener("click", onReactionMovementClick);
      button.addEventListener("click", onReactionMovementClick);
    });
  });
}

export function listPendingActions() {
  return Array.from(pendingActions.values());
}

export function getPendingAction(pendingActionId) {
  return pendingActions.get(pendingActionId) ?? null;
}

export async function updateResolutionMessage(pendingAction) {
  if (!pendingAction?.resolutionMessageId || !pendingAction.result) return null;

  const message =
    game.messages?.get(pendingAction.resolutionMessageId) ?? null;

  if (!message) return null;

  const chatRolls =
    await prepareResolutionChatRolls(
      pendingAction,
      pendingAction.result
    );

  return message.update({
    content: buildResolutionContent(
      pendingAction,
      pendingAction.result,
      chatRolls.html
    ),
    flags: {
      ...(message.flags ?? {}),
      mtrol: {
        ...(message.flags?.mtrol ?? {}),
        pendingActionId: pendingAction.id,
        damageStatus: pendingAction.damage?.status ?? "unavailable",
        damageRolled: pendingAction.damage?.rolled === true
      }
    }
  });
}

async function createPendingActionAuthoritativeFacade(data = {}, options = {}) {
  const id = data.id ?? foundry.utils.randomID();
  const transactionId = options.transactionId ??
    createOperationId("opposition.create", id);
  const result = await dispatchLocalOppositionCommand(
    "opposition.create",
    transactionId,
    {
      pendingAction: { ...data, id },
      transactionId,
      combatId: data.combatId ?? game.combat?.id ?? null
    },
    options.requestingUserId ?? game.user?.id ?? null
  );
  return receivePendingActionSync(result?.pendingAction);
}

async function attachDefenseRollAuthoritativeFacade(data = {}) {
  const transactionId = data.transactionId ?? createOperationId(
    "opposition.respond",
    `${data.pendingActionId ?? "unknown"}:${data.defenseItemId ?? "defense"}:` +
    `${data.defenderRoll?.chatMessageId ?? data.defenderRoll?.total ?? foundry.utils.randomID()}`
  );
  const result = await dispatchLocalOppositionCommand(
    "opposition.respond",
    transactionId,
    { ...data, transactionId, combatId: data.combatId ?? game.combat?.id ?? null },
    data.requestingUserId ?? game.user?.id ?? null
  );
  const pendingAction = receivePendingActionSync(result?.pendingAction);
  return {
    pendingAction,
    resolutionResult: result?.resolutionResult ?? null
  };
}

async function resolvePendingActionAuthoritativeFacade(pendingActionId, options = {}) {
  const transactionId = options.transactionId ??
    createOperationId("opposition.resolve", pendingActionId);
  const result = await dispatchLocalOppositionCommand(
    "opposition.resolve",
    transactionId,
    {
      pendingActionId,
      transactionId,
      combatId: options.combatId ?? game.combat?.id ?? null
    },
    options.requestingUserId ?? game.user?.id ?? null
  );
  const pendingAction = receivePendingActionSync(result?.pendingAction);
  return {
    pendingAction,
    resolutionResult: result?.resolutionResult ?? null
  };
}

async function clearPendingActionAuthoritativeFacade(pendingActionId, options = {}) {
  const transactionId = options.transactionId ??
    createOperationId("opposition.cancel", pendingActionId);
  const result = await dispatchLocalOppositionCommand(
    "opposition.cancel",
    transactionId,
    {
      pendingActionId,
      reason: options.reason ?? "cancelled",
      transactionId,
      combatId: options.combatId ?? game.combat?.id ?? null
    },
    options.requestingUserId ?? game.user?.id ?? null
  );
  if (result?.pendingAction) receivePendingActionSync(result.pendingAction);
  return true;
}

async function completeReactionMovementAuthoritativeFacade(pendingActionId, options = {}) {
  const transactionId = options.transactionId ??
    createOperationId("opposition.reaction-complete", pendingActionId);
  const result = await dispatchLocalOppositionCommand(
    "opposition.reaction-complete",
    transactionId,
    {
      pendingActionId,
      actorUuid: options.actorUuid ?? null,
      tokenUuid: options.tokenUuid ?? null,
      cost: options.cost ?? 0,
      reason: options.reason ?? "skipped",
      transactionId,
      combatId: options.combatId ?? game.combat?.id ?? null
    },
    options.requestingUserId ?? game.user?.id ?? null
  );
  if (result?.pendingAction) receivePendingActionSync(result.pendingAction);
  return result;
}

export function installMtrolActionsApi() {
  game.mtrol = game.mtrol || {};
  game.mtrol.actions = {
    createPendingAction,
    createPendingActionAuthoritative: createPendingActionAuthoritativeFacade,
    createPendingActionFromCompetencia,
    createReadyDamageAction,
    createReadyDamageActionAuthoritative,
    createReadyDamageActionFromCompetencia,
    attachDefenseRoll,
    attachDefenseRollAuthoritative: attachDefenseRollAuthoritativeFacade,
    attachDefenseRollForActor,
    resolvePendingAction,
    resolvePendingActionAuthoritative: resolvePendingActionAuthoritativeFacade,
    requestPendingActionsForActor,
    getPendingOppositionForActor,
    getReactionMovementForActor,
    completeReactionMovement,
    completeReactionMovementAuthoritative: completeReactionMovementAuthoritativeFacade,
    clearPendingAction,
    clearPendingActionAuthoritative: clearPendingActionAuthoritativeFacade,
    listPendingActions,
    getPendingAction,
    serializePendingAction,
    receivePendingActionSync,
    receivePendingActionCleared
  };

  if (!pendingActionsCleanupTimer) {
    pendingActionsCleanupTimer =
      setInterval(
        () => cleanupExpiredPendingActions().catch(error =>
          logger.error("OPPOSITION", "pending action cleanup failed", {
            error: error.message
          })
        ),
        60 * 1000
      );
  }
}

configureActionDamageDependencies({
  broadcastPendingAction,
  getPendingAction,
  persistPendingActionRuntime,
  receivePendingActionSync,
  updateResolutionMessage,
  userCanControlActor
});

configureOppositionActionOperations({
  attachDefenseRollAuthoritative,
  clearPendingActionAuthoritative,
  completeReactionMovementAuthoritative,
  createPendingActionAuthoritative,
  declareOppositionResponseAuthoritative,
  getPendingAction,
  requestPendingActionsForActor,
  resolvePendingActionAuthoritative,
  serializePendingAction
});
