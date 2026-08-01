import {
  resolveOpposedAction
} from "./resolution-engine.js";

import {
  applyState
} from "../states/state-engine.js";

import {
  getEquippedShields
} from "../items/equipment-engine.js";

import {
  applyShieldWear
} from "../items/shield-wear-engine.js";

import {
  requestPrimaryGM
} from "../core/socket-requests.js";

const pendingActions =
  new Map();

const resolvingActions =
  new Set();

const attachingDefenseActions =
  new Set();

const PENDING_ACTION_TTL_MS =
  30 * 60 * 1000;

const PENDING_ACTION_TERMINAL_RETENTION_MS =
  10 * 60 * 1000;

let pendingActionsCleanupTimer =
  null;

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
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

  return {
    total: Number(rollData.total ?? roll?.total ?? 0),
    isFumble: rollData.isFumble === true || rollData.pifia === true,
    isCritical: rollData.isCritical === true || rollData.critico === true,
    formula: rollData.formula ?? roll?.formula ?? "",
    chatMessageId: rollData.chatMessageId ?? null
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

function userCanControlActor(actor, userId) {
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
          winner: result.tieBreaker.winner ?? null
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

  return foundry.utils.deepClone(serializable);
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

function broadcastPendingAction(pendingAction) {
  if (!game.user?.isGM || !pendingAction) return;

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

function cleanupExpiredPendingActions() {
  const now =
    Date.now();

  for (const [id, pendingAction] of pendingActions.entries()) {
    const terminal =
      ["resolved", "cancelled"].includes(pendingAction.status);

    const expiresAt =
      terminal
        ? Number(pendingAction.resolvedAt ?? pendingAction.cancelledAt ?? pendingAction.expiresAt ?? 0) +
          PENDING_ACTION_TERMINAL_RETENTION_MS
        : Number(pendingAction.expiresAt ?? 0);

    if (!expiresAt || expiresAt > now) continue;

    if (!terminal) {
      pendingAction.status =
        "cancelled";

      pendingAction.cancelledAt =
        now;

      pendingAction.updatedAt =
        now;

      pendingAction.cancellationReason =
        "timeout";

      broadcastPendingAction(pendingAction);
    }

    pendingActions.delete(id);
    broadcastPendingActionCleared(id);
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

  const pendingAction =
    foundry.utils.deepClone(serializedPendingAction);

  pendingActions.set(
    pendingAction.id,
    pendingAction
  );

  return pendingAction;
}

export function receivePendingActionCleared(pendingActionId) {
  if (!pendingActionId) return false;
  return pendingActions.delete(pendingActionId);
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
    available,
    rolled: false,
    status: available ? "available" : "unavailable",
    formula,
    flatValue: hasFlatValue ? Number(flatValue) : null,
    sourceActorUuid: data.sourceActorUuid ?? null,
    sourceTokenUuid: data.sourceTokenUuid ?? null,
    targetActorUuid: data.targetActorUuid ?? null,
    targetTokenUuid: data.targetTokenUuid ?? null,
    competenciaUuid: data.competenciaUuid ?? null,
    competenciaId: data.competenciaId ?? null,
    competenciaName: data.competenciaName ?? null,
    localized: data.localized !== false,
    costoTotal: Number(data.costoTotal ?? 0),
    rollData: foundry.utils.deepClone(data.rollData ?? {}),
    total: null,
    fumble: false,
    error: null,
    rolledAt: null,
    lastUserId: null
  };
}

function escapeHTML(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function isTrue(value) {
  return value === true || value === "true";
}

function hasConfiguredActionDefinition(system = {}) {
  return (
    system.actionType !== undefined ||
    system.effect !== undefined ||
    system.defenseType !== undefined ||
    system.requiresTarget !== undefined ||
    system.requiresOpposition !== undefined ||
    system.oppositionType !== undefined
  );
}

function getActionDefinitionFromItem(item) {
  const system =
    item?.system ?? {};

  if (isTrue(system.requiresOpposition)) {
    return {
      actionType: system.actionType ?? "utility",
      effect: system.effect ?? "none",
      defenseType: system.defenseType ?? "custom",
      effectDuration: Number(system.effectDuration ?? 1),
      effectIntensity: Number(system.effectIntensity ?? 0),
      oppositionType: system.oppositionType ?? "free",
      requiresOpposition: true
    };
  }

  if (!hasConfiguredActionDefinition(system) && normalizeText(item?.name) === "cadenas infernales") {
    // Legacy fallback temporal: Cadenas Infernales debe migrarse a actionType/effect/requiresOpposition.
    return {
      actionType: "control",
      effect: "stunned",
      defenseType: "custom",
      effectDuration: 1,
      effectIntensity: 0,
      oppositionType: "free",
      requiresOpposition: true
    };
  }

  return {
    actionType: system.actionType ?? "utility",
    effect: system.effect ?? "none",
    defenseType: system.defenseType ?? "custom",
    effectDuration: Number(system.effectDuration ?? 1),
    effectIntensity: Number(system.effectIntensity ?? 0),
    oppositionType: system.oppositionType ?? "free",
    requiresOpposition: false
  };
}

async function createPendingActionMessage(pendingAction) {
  const actor =
    pendingAction.sourceActorUuid
      ? await fromUuid(pendingAction.sourceActorUuid)
      : null;

  await ChatMessage.create({
    user: pendingAction.sourceUserId ?? game.user?.id,
    speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
    content: `
      <div class="mtrol-chat-card">
        <h2>Accion enfrentada pendiente</h2>
        <p><strong>${foundry.utils.escapeHTML(pendingAction.sourceItemName)}</strong> espera una defensa manual.</p>
      </div>
    `
  });
}

function canShowDamageButton(pendingAction, result) {
  return (
    pendingAction.status === "resolved" &&
    result?.success === true &&
    pendingAction.damage?.available === true &&
    pendingAction.damage?.rolled !== true &&
    pendingAction.damage?.status === "available" &&
    (
      pendingAction.targetActorUuid ||
      pendingAction.targetTokenUuid
    )
  );
}

function getResolutionDescription(result = {}) {
  switch (result.reason) {
    case "attacker-higher":
      return "El ataque supera la defensa.";
    case "defender-higher":
      return "La defensa bloquea el ataque.";
    case "attacker-critical":
      return "El atacante obtiene un resultado crítico.";
    case "defender-critical":
      return "La defensa obtiene un resultado crítico.";
    case "attacker-fumble":
      return "El atacante falla de forma crítica.";
    case "defender-fumble":
      return "La defensa falla de forma crítica.";
    case "tie":
    case "tie-attacker":
    case "tie-defender":
      return "Las tiradas terminan en empate.";
    case "cancelled":
      return "La resolución fue cancelada.";
    case "timeout":
      return "La defensa no respondió a tiempo.";
    case "no-defense":
      return "No se recibió una defensa.";
    default:
      return "La resolución fue procesada.";
  }
}

function getResolutionOutcomeLabel(result = {}) {
  return result.success ? "Gana atacante" : "Gana defensor";
}

function buildResolutionContent(pendingAction, result) {
  const damageStatus =
    pendingAction.damage?.status ?? "unavailable";

  const damageTotal =
    pendingAction.damage?.total;

  const damageExecutedMessage =
    pendingAction.damage?.rolled === true
      ? `<p>Daño ejecutado: <strong>${escapeHTML(damageTotal ?? "-")}</strong>.</p>`
      : "";

  const damageErrorMessage =
    pendingAction.damage?.error && damageStatus === "available"
      ? `<p class="mtrol-chat-warning">Último intento de daño: ${escapeHTML(pendingAction.damage.error)}</p>`
      : "";

  const damageButton =
    canShowDamageButton(pendingAction, result)
      ? `
        <button type="button"
                data-action="mtrol-resolved-damage"
                data-pending-action-id="${escapeHTML(pendingAction.id)}">
          TIRAR DAÑO
        </button>
      `
      : "";

  const targetName =
    pendingAction.targetActorName ?? "Defensor";

  const tieMessages =
    result.tieBreaker
      ? `
        <p>Empate. MTROL tira 1d10 de desempate.</p>
        <p>Resultado ${result.tieBreaker.total}: gana ${result.tieBreaker.winner === "attacker" ? "atacante" : "defensor"}.</p>
      `
      : "";

  const shieldWear =
    pendingAction.shieldWear ?? null;

  const shieldWearMessages =
    shieldWear?.applied
      ? `
        <p>MTROL tira 1d4 de desgaste: <strong>${escapeHTML(shieldWear.wear)}</strong>.</p>
        <p>Defensa restante de ${escapeHTML(shieldWear.shieldName)}: <strong>${escapeHTML(shieldWear.remainingDefense)}</strong>.</p>
        ${
          shieldWear.destroyed
            ? `<p><strong>${escapeHTML(shieldWear.shieldName)}</strong> se rompe y queda destruido.</p>`
            : ""
        }
      `
      : "";

  const outcomeMessage =
    result.success
      ? `${escapeHTML(pendingAction.sourceActorName ?? pendingAction.sourceItemName)} supera la defensa de ${escapeHTML(targetName)}. Puede ejecutar daño.`
      : shieldWear?.applied
        ? `${escapeHTML(targetName)} bloquea correctamente con ${escapeHTML(shieldWear.shieldName)}.`
        : `${escapeHTML(targetName)} defiende correctamente.`;

  const resolutionDescription =
    getResolutionDescription(result);

  return `
    <div class="mtrol-chat-card">
      <h2>RESOLUCIÓN ENFRENTADA</h2>
      <p><strong>${escapeHTML(pendingAction.sourceItemName)}</strong> contra <strong>${escapeHTML(targetName)}</strong>.</p>
      <p>Atacante: <strong>${result.attackerTotal}</strong> | Defensor: <strong>${result.defenderTotal}</strong></p>
      ${tieMessages}
      <p>${outcomeMessage}</p>
      ${shieldWearMessages}
      <p>Resultado:<br><strong>${escapeHTML(getResolutionOutcomeLabel(result))}</strong>.</p>
      <p>${escapeHTML(resolutionDescription)}</p>
      ${damageExecutedMessage}
      ${damageErrorMessage}
      ${damageButton}
    </div>
  `;
}

async function createInvalidDefenseMessage(actor, message) {
  await ChatMessage.create({
    speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
    content: `
      <div class="mtrol-chat-card mtrol-chat-warning">
        <h2>Defensa con escudos rechazada</h2>
        <p>${escapeHTML(message)}</p>
      </div>
    `
  });
}

async function createResolutionMessage(pendingAction, result) {
  const actor =
    pendingAction.sourceActorUuid
      ? await fromUuid(pendingAction.sourceActorUuid)
      : null;

  const target =
    pendingAction.targetActorUuid
      ? await fromUuid(pendingAction.targetActorUuid)
      : null;

  const attackerName =
    actor?.name ?? "Atacante";

  const defenderName =
    target?.name ?? "Defensor";

  pendingAction.sourceActorName =
    attackerName;

  pendingAction.targetActorName =
    defenderName;

  const message =
    await ChatMessage.create({
    user: pendingAction.sourceUserId ?? game.user?.id,
    speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
    content: buildResolutionContent(
      pendingAction,
      result
    ),
    flags: {
      mtrol: {
        pendingActionId: pendingAction.id,
        damageStatus: pendingAction.damage?.status ?? "unavailable"
      }
    }
  });

  pendingAction.resolutionMessageId =
    message?.id ?? null;
}

function buildPendingAction(data = {}) {
  const now =
    Date.now();

  const id =
    data.id ?? foundry.utils.randomID();

  return {
    id,
    sourceUserId: data.sourceUserId ?? null,
    sourceActorId: data.sourceActorId ?? null,
    sourceActorUuid: data.sourceActorUuid ?? null,
    sourceTokenId: data.sourceTokenId ?? null,
    sourceTokenUuid: data.sourceTokenUuid ?? null,
    targetActorId: data.targetActorId ?? null,
    targetActorUuid: data.targetActorUuid ?? null,
    targetTokenId: data.targetTokenId ?? null,
    targetTokenUuid: data.targetTokenUuid ?? null,
    sourceItemId: data.sourceItemId ?? null,
    sourceItemName: data.sourceItemName ?? "Accion",
    actionType: data.actionType ?? "opposed",
    effect: data.effect ?? "none",
    defenseType: data.defenseType ?? "custom",
    defenseItemId: data.defenseItemId ?? null,
    defenseItemName: data.defenseItemName ?? null,
    defenseActionType: data.defenseActionType ?? null,
    defenseEffect: data.defenseEffect ?? null,
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
    status: "waiting-defense",
    createdAt: data.createdAt ?? now,
    updatedAt: data.updatedAt ?? now,
    expiresAt: data.expiresAt ?? (now + PENDING_ACTION_TTL_MS),
    resolvedAt: data.resolvedAt ?? null,
    cancelledAt: data.cancelledAt ?? null,
    cancellationReason: data.cancellationReason ?? null,
    resolutionMessageId: data.resolutionMessageId ?? null,
    result: data.result ?? null,
    shieldWear: data.shieldWear ?? null
  };
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

  const definition =
    getActionDefinitionFromItem(sourceItem);

  if (!definition.requiresOpposition) {
    throw new Error("La competencia no requiere una resolución enfrentada.");
  }

  if (!isValidRollData(data.attackerRoll)) {
    throw new Error("La tirada atacante no es válida.");
  }

  return {
    ...data,
    sourceUserId: requestingUserId,
    sourceActorId: sourceActor.id,
    sourceActorUuid: sourceActor.uuid,
    targetActorId: targetActor.id,
    targetActorUuid: targetActor.uuid,
    sourceItemId: sourceItem.id,
    sourceItemName: sourceItem.name,
    actionType: definition.actionType,
    effect: definition.effect,
    defenseType: definition.defenseType,
    effectDuration: definition.effectDuration,
    effectIntensity: definition.effectIntensity,
    oppositionType: definition.oppositionType,
    requiresOpposition: true
  };
}

export async function createPendingActionAuthoritative(
  data = {},
  {
    requestingUserId = game.user?.id
  } = {}
) {
  if (!game.user?.isGM) {
    throw new Error("Solo el GM autoritativo puede registrar acciones pendientes.");
  }

  cleanupExpiredPendingActions();

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

  console.log("MTROL | Pending action created", pendingAction);

  try {
    await createPendingActionMessage(pendingAction);
    broadcastPendingAction(pendingAction);
  } catch (error) {
    pendingActions.delete(pendingAction.id);
    throw error;
  }

  return pendingAction;
}

export async function createPendingAction(data = {}) {
  if (game.user?.isGM) {
    return createPendingActionAuthoritative(data);
  }

  const response =
    await requestPrimaryGM(
      "mtrolCreatePendingAction",
      {
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
  damage = null
} = {}) {
  const definition =
    getActionDefinitionFromItem(item);

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

function getAvailableActionsForActor(actor) {
  cleanupExpiredPendingActions();

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
  const isShieldBlock =
    defenseItem.system?.actionType === "defense" &&
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
  requestingUserId = game.user?.id
} = {}) {
  if (!game.user?.isGM) {
    throw new Error("Solo el GM autoritativo puede asociar una defensa.");
  }

  cleanupExpiredPendingActions();

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

  if (
    !defenseItem ||
    defenseItem.type !== "competencia" ||
    defenseItem.system?.actionType !== "defense"
  ) {
    throw new Error("La competencia defensiva no es válida.");
  }

  if (!isValidRollData(defenderRoll)) {
    throw new Error("La tirada defensiva no es válida.");
  }

  const shieldValidation =
    await validateShieldDefense(
      actor,
      defenseItem
    );

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

  pendingAction.shieldItemId =
    shieldValidation.shield?.item?.id ?? null;

  pendingAction.shieldItemUuid =
    shieldValidation.shield?.item?.uuid ?? null;

  pendingAction.shieldSlot =
    shieldValidation.shield?.slot ?? null;

  pendingAction.status =
    "resolving";

  pendingAction.updatedAt =
    Date.now();

  broadcastPendingAction(pendingAction);

  console.log("MTROL | Defense attached authoritatively", pendingAction);

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

  return response.result?.resolutionResult ?? null;
}

export async function attachDefenseRoll(pendingActionId, rollData = {}) {
  const pendingAction =
    pendingActions.get(pendingActionId);

  if (!pendingAction) {
    throw new Error(`No existe pendingAction local: ${pendingActionId}`);
  }

  if (game.user?.isGM) {
    const result =
      await attachDefenseRollAuthoritative({
        pendingActionId,
        defenderActorUuid: pendingAction.targetActorUuid,
        defenseItemId: rollData.itemId,
        defenderRoll: rollData,
        requestingUserId: game.user.id
      });

    return result.resolutionResult;
  }

  const response =
    await requestPrimaryGM(
      "mtrolAttachDefenseRoll",
      {
        pendingActionId,
        defenderActorUuid: pendingAction.targetActorUuid,
        defenseItemId: rollData.itemId,
        defenderRoll: rollToData(rollData)
      }
    );

  return processAuthoritativeResponse(response);
}

export async function attachDefenseRollForActor({
  actor,
  item,
  defenderRoll
} = {}) {
  if (!actor || !item || item.system?.actionType !== "defense") return null;

  if (game.user?.isGM) {
    const result =
      await attachDefenseRollAuthoritative({
        defenderActorUuid: actor.uuid,
        defenseItemId: item.id,
        defenderRoll,
        requestingUserId: game.user.id
      });

    return result.resolutionResult;
  }

  const response =
    await requestPrimaryGM(
      "mtrolAttachDefenseRoll",
      {
        pendingActionId: null,
        defenderActorUuid: actor.uuid,
        defenseItemId: item.id,
        defenderRoll: rollToData(defenderRoll)
      }
    );

  return processAuthoritativeResponse(response);
}

export async function resolvePendingActionAuthoritative(
  pendingActionId,
  {
    requestingUserId = game.user?.id
  } = {}
) {
  if (!game.user?.isGM) {
    throw new Error("Solo el GM autoritativo puede resolver acciones pendientes.");
  }

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
      pendingAction.defenseActionType === "defense" &&
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
      const target =
        pendingAction.targetTokenUuid
          ? await fromUuid(pendingAction.targetTokenUuid)
          : await fromUuid(pendingAction.targetActorUuid);

      await applyState(target, pendingAction.effect, {
        source: pendingAction.sourceItemName,
        pendingActionId,
        duration: pendingAction.effectDuration,
        intensity: pendingAction.effectIntensity
      });
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
      console.error(
        "MTROL | No se pudo informar la cancelación de la acción.",
        messageError
      );
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

  broadcastPendingAction(pendingAction);

  try {
    await createResolutionMessage(
      pendingAction,
      result
    );
  } catch (error) {
    console.error(
      "MTROL | La acción fue resuelta, pero no se pudo crear el mensaje de resolución.",
      error
    );
  }

  broadcastPendingAction(pendingAction);

  console.log("MTROL | Opposed action resolved authoritatively", result);

  resolvingActions.delete(pendingActionId);

  return {
    pendingAction,
    resolutionResult: result
  };
}

export async function resolvePendingAction(pendingActionId) {
  if (game.user?.isGM) {
    const result =
      await resolvePendingActionAuthoritative(
        pendingActionId,
        {
          requestingUserId: game.user.id
        }
      );

    return result.resolutionResult;
  }

  const response =
    await requestPrimaryGM(
      "mtrolResolvePendingAction",
      {
        pendingActionId
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
    reason = "cancelled"
  } = {}
) {
  if (!game.user?.isGM) {
    throw new Error("Solo el GM autoritativo puede limpiar acciones pendientes.");
  }

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

  broadcastPendingAction(pendingAction);

  return true;
}

export async function clearPendingAction(pendingActionId, reason = "cancelled") {
  if (game.user?.isGM) {
    return clearPendingActionAuthoritative(
      pendingActionId,
      {
        reason
      }
    );
  }

  const response =
    await requestPrimaryGM(
      "mtrolClearPendingAction",
      {
        pendingActionId,
        reason
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

export function listPendingActions() {
  cleanupExpiredPendingActions();
  return Array.from(pendingActions.values());
}

export function getPendingAction(pendingActionId) {
  cleanupExpiredPendingActions();
  return pendingActions.get(pendingActionId) ?? null;
}

export async function updateResolutionMessage(pendingAction) {
  if (!pendingAction?.resolutionMessageId || !pendingAction.result) return null;

  const message =
    game.messages?.get(pendingAction.resolutionMessageId) ?? null;

  if (!message) return null;

  return message.update({
    content: buildResolutionContent(
      pendingAction,
      pendingAction.result
    ),
    flags: {
      mtrol: {
        pendingActionId: pendingAction.id,
        damageStatus: pendingAction.damage?.status ?? "unavailable",
        damageRolled: pendingAction.damage?.rolled === true
      }
    }
  });
}

export function installMtrolActionsApi() {
  game.mtrol = game.mtrol || {};
  game.mtrol.actions = {
    createPendingAction,
    createPendingActionAuthoritative,
    createPendingActionFromCompetencia,
    attachDefenseRoll,
    attachDefenseRollAuthoritative,
    attachDefenseRollForActor,
    resolvePendingAction,
    resolvePendingActionAuthoritative,
    requestPendingActionsForActor,
    clearPendingAction,
    clearPendingActionAuthoritative,
    listPendingActions,
    getPendingAction,
    serializePendingAction,
    receivePendingActionSync,
    receivePendingActionCleared
  };

  if (!pendingActionsCleanupTimer) {
    pendingActionsCleanupTimer =
      setInterval(
        cleanupExpiredPendingActions,
        60 * 1000
      );
  }
}
