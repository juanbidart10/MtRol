import {
  resolveOpposedAction
} from "./resolution-engine.js";

import {
  applyState
} from "../states/state-engine.js";

const pendingActions =
  new Map();

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

  const outcomeMessage =
    result.success
      ? `${escapeHTML(pendingAction.sourceItemName)} supera la defensa de ${escapeHTML(targetName)}.`
      : pendingAction.defenseType === "shield"
        ? `${escapeHTML(targetName)} bloquea correctamente con su escudo. Tirar 1d4 de desgaste.`
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
      <p>Resultado:<br><strong>${escapeHTML(getResolutionOutcomeLabel(result))}</strong>.</p>
      <p>${escapeHTML(resolutionDescription)}</p>
      ${damageExecutedMessage}
      ${damageErrorMessage}
      ${damageButton}
    </div>
  `;
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

async function createDefenseAttachedMessage(pendingAction, actor, item) {
  await ChatMessage.create({
    speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
    content: `
      <div class="mtrol-chat-card">
        <h2>Defensa declarada</h2>
        <p>${escapeHTML(actor?.name ?? "Defensor")} responde con <strong>${escapeHTML(item?.name ?? "defensa")}</strong>.</p>
      </div>
    `
  });
}

export function createPendingAction(data = {}) {
  const id =
    data.id ?? foundry.utils.randomID();

  const pendingAction = {
    id,
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
    effectDuration: Number(data.effectDuration ?? 1),
    effectIntensity: Number(data.effectIntensity ?? 0),
    oppositionType: data.oppositionType ?? "free",
    requiresOpposition: data.requiresOpposition === true,
    attackerRoll: rollToData(data.attackerRoll),
    defenderRoll: data.defenderRoll ? rollToData(data.defenderRoll) : null,
    damage: normalizeDamageContext(data.damage),
    status: data.defenderRoll ? "ready" : "waiting-defense",
    createdAt: data.createdAt ?? Date.now(),
    resolutionMessageId: data.resolutionMessageId ?? null
  };

  pendingActions.set(id, pendingAction);

  console.log("MTROL | Pending action created", pendingAction);
  createPendingActionMessage(pendingAction);

  return pendingAction;
}

export function createPendingActionFromCompetencia({
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

export async function attachDefenseRoll(pendingActionId, rollData = {}) {
  const pendingAction =
    pendingActions.get(pendingActionId);

  if (!pendingAction) {
    throw new Error(`No existe pendingAction: ${pendingActionId}`);
  }

  pendingAction.defenderRoll =
    rollToData(rollData);

  pendingAction.defenseType =
    rollData.defenseType ?? pendingAction.defenseType ?? "custom";

  pendingAction.defenseItemId =
    rollData.itemId ?? pendingAction.defenseItemId ?? null;

  pendingAction.defenseItemName =
    rollData.itemName ?? pendingAction.defenseItemName ?? null;

  pendingAction.status =
    "ready";

  console.log("MTROL | Defense attached", pendingAction);

  return resolvePendingAction(pendingActionId);
}

export async function attachDefenseRollForActor({
  actor,
  item,
  defenderRoll
} = {}) {
  if (!actor || !item || item.system?.actionType !== "defense") return null;

  const availableActions =
    Array.from(pendingActions.values())
      .filter(pendingAction =>
        pendingAction.status === "waiting-defense" &&
        (
          pendingAction.targetActorId === actor.id ||
          pendingAction.targetActorUuid === actor.uuid
        )
      )
      .sort((a, b) => b.createdAt - a.createdAt);

  if (!availableActions.length) return null;

  if (availableActions.length > 1) {
    console.warn(
      "MTROL | Hay varias acciones pendientes para este defensor. V1 usa la mas reciente.",
      availableActions
    );

    ui.notifications.warn(
      "MTROL | Hay varias defensas pendientes. Se usara la accion mas reciente."
    );
  }

  const pendingAction =
    availableActions[0];

  await createDefenseAttachedMessage(
    pendingAction,
    actor,
    item
  );

  return attachDefenseRoll(
    pendingAction.id,
    {
      ...defenderRoll,
      defenseType: item.system?.defenseType ?? "custom",
      itemId: item.id,
      itemName: item.name
    }
  );
}

export async function resolvePendingAction(pendingActionId) {
  const pendingAction =
    pendingActions.get(pendingActionId);

  if (!pendingAction) {
    throw new Error(`No existe pendingAction: ${pendingActionId}`);
  }

  const result =
    await resolveOpposedAction(pendingAction);

  pendingAction.status =
    "resolved";

  pendingAction.result =
    result;

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

  await createResolutionMessage(pendingAction, result);

  console.log("MTROL | Opposed action resolved", result);

  return result;
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
    createPendingActionFromCompetencia,
    attachDefenseRoll,
    attachDefenseRollForActor,
    resolvePendingAction,
    listPendingActions,
    getPendingAction
  };
}
