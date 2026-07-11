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

  const tieMessages =
    result.tieBreaker
      ? `
        <p>Empate. MTROL tira 1d10 de desempate.</p>
        <p>Resultado ${result.tieBreaker.total}: gana ${result.tieBreaker.winner === "attacker" ? "atacante" : "defensor"}.</p>
      `
      : "";

  const outcomeMessage =
    result.success
      ? `${escapeHTML(attackerName)} supera la defensa de ${escapeHTML(defenderName)}. Puede ejecutar dano.`
      : pendingAction.defenseType === "shield"
        ? `${escapeHTML(defenderName)} bloquea correctamente con su escudo. Tirar 1d4 de desgaste.`
        : `${escapeHTML(defenderName)} defiende correctamente.`;

  await ChatMessage.create({
    speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
    content: `
      <div class="mtrol-chat-card">
        <h2>Resolucion enfrentada</h2>
        <p><strong>${escapeHTML(pendingAction.sourceItemName)}</strong> contra <strong>${escapeHTML(target?.name ?? "objetivo")}</strong>.</p>
        <p>Atacante: <strong>${result.attackerTotal}</strong> | Defensor: <strong>${result.defenderTotal}</strong></p>
        ${tieMessages}
        <p>${outcomeMessage}</p>
        <p>Resultado: <strong>${result.success ? "gana atacante" : "gana defensor"}</strong> (${escapeHTML(result.reason)}).</p>
      </div>
    `
  });
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
    status: data.defenderRoll ? "ready" : "waiting-defense",
    createdAt: data.createdAt ?? Date.now()
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
  attackerRoll
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
    attackerRoll
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

export function installMtrolActionsApi() {
  game.mtrol = game.mtrol || {};
  game.mtrol.actions = {
    createPendingAction,
    createPendingActionFromCompetencia,
    attachDefenseRoll,
    attachDefenseRollForActor,
    resolvePendingAction,
    listPendingActions
  };
}
