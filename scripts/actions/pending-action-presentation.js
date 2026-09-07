import {
  mtrolCreateRollMessage,
  mtrolPrepareChatRolls,
  mtrolRestoreRolls
} from "../rolls/chat-rolls.js";

export const REACTION_MOVEMENT_ACTION = "mtrol-close-reaction-movement";

export function escapeHTML(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

export async function createPendingActionMessage(pendingAction) {
  const actor = pendingAction.sourceActorUuid
    ? await fromUuid(pendingAction.sourceActorUuid)
    : null;
  return ChatMessage.create({
    user: pendingAction.sourceUserId ?? game.user?.id,
    speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
    content: `
      <div class="mtrol-chat-card">
        <h2>Accion enfrentada pendiente</h2>
        <p><strong>${foundry.utils.escapeHTML(pendingAction.sourceItemName)}</strong> espera una defensa manual.</p>
      </div>
    `,
    flags: { mtrol: {
      pendingActionId: pendingAction.id,
      transactionId: pendingAction.createTransactionId ?? null,
      presentationType: "opposition-pending"
    } }
  });
}

export function findPendingActionMessage(pendingActionId, presentationType) {
  if (!pendingActionId) return null;
  return Array.from(game.messages ?? []).find(message =>
    message.flags?.mtrol?.pendingActionId === pendingActionId &&
    message.flags?.mtrol?.presentationType === presentationType
  ) ?? null;
}

function canShowDamageButton(pendingAction, result) {
  return pendingAction.status === "resolved" &&
    pendingAction.winnerResolutionResult === "damage" &&
    pendingAction.damage?.available === true &&
    pendingAction.damage?.rolled !== true &&
    pendingAction.damage?.status === "available" &&
    pendingAction.damage?.mode === "enabled" &&
    Boolean(pendingAction.targetActorUuid || pendingAction.targetTokenUuid);
}

function canShowReactionMovementButton(pendingAction) {
  return pendingAction.status === "resolved" &&
    pendingAction.reactionMovement?.status === "available";
}

function getResolutionDescription(result = {}) {
  switch (result.reason) {
    case "attacker-higher": return "El ataque supera la defensa.";
    case "defender-higher": return "La defensa bloquea el ataque.";
    case "attacker-critical": return "El atacante obtiene un resultado crítico.";
    case "defender-critical": return "La defensa obtiene un resultado crítico.";
    case "attacker-fumble": return "El atacante falla de forma crítica.";
    case "defender-fumble": return "La defensa falla de forma crítica.";
    case "tie":
    case "tie-attacker":
    case "tie-defender": return "Las tiradas terminan en empate.";
    case "cancelled": return "La resolución fue cancelada.";
    case "timeout": return "La defensa no respondió a tiempo.";
    case "no-defense": return "No se recibió una defensa.";
    default: return "La resolución fue procesada.";
  }
}

function getResolutionOutcomeLabel(result = {}) {
  return result.success ? "Gana atacante" : "Gana defensor";
}

export function buildResolutionContent(pendingAction, result, rollsHTML = "") {
  const damageStatus = pendingAction.damage?.status ?? "unavailable";
  const damageExecutedMessage = pendingAction.damage?.rolled === true
    ? `<p>Daño ejecutado: <strong>${escapeHTML(pendingAction.damage?.total ?? "-")}</strong>.</p>`
    : "";
  const damageErrorMessage = pendingAction.damage?.error && damageStatus === "available"
    ? `<p class="mtrol-chat-warning">No se pudo completar el daño: ${escapeHTML(pendingAction.damage.error)}</p>`
    : "";
  const damageButton = canShowDamageButton(pendingAction, result)
    ? `<button type="button" data-action="mtrol-resolved-damage" data-pending-action-id="${escapeHTML(pendingAction.id)}">LANZAR DAÑO</button>`
    : "";
  const cancelDamageButton = canShowDamageButton(pendingAction, result)
    ? `<button type="button" data-action="mtrol-cancel-damage" data-pending-action-id="${escapeHTML(pendingAction.id)}">CANCELAR DAÑO</button>`
    : "";
  const reactionMovementButton = canShowReactionMovementButton(pendingAction)
    ? `<p>Esquiva exitosa: el objetivo puede mover 1 cuadro en cualquier dirección o renunciar.</p>
       <button type="button" data-action="${REACTION_MOVEMENT_ACTION}" data-pending-action-id="${escapeHTML(pendingAction.id)}">NO MOVER</button>`
    : "";

  if (pendingAction.requiresOpposition !== true) {
    return `<div class="mtrol-chat-card"><h2>DAÑO HABILITADO</h2>
      <p><strong>${escapeHTML(pendingAction.sourceItemName)}</strong> completó su acción principal.</p>
      ${rollsHTML}${damageExecutedMessage}${damageErrorMessage}${damageButton}</div>`;
  }

  const targetName = pendingAction.targetActorName ?? "Defensor";
  const tieMessages = result.tieBreaker
    ? `<p>Empate. MTROL tira 1d10 de desempate.</p>
       <p>Resultado ${result.tieBreaker.total}: gana ${result.tieBreaker.winner === "attacker" ? "atacante" : "defensor"}.</p>`
    : "";
  const shieldWear = pendingAction.shieldWear ?? null;
  const shieldWearMessages = shieldWear?.applied
    ? `<p>MTROL tira 1d4 de desgaste: <strong>${escapeHTML(shieldWear.wear)}</strong>.</p>
       <p>Defensa restante de ${escapeHTML(shieldWear.shieldName)}: <strong>${escapeHTML(shieldWear.remainingDefense)}</strong>.</p>
       ${shieldWear.destroyed ? `<p><strong>${escapeHTML(shieldWear.shieldName)}</strong> se rompe y queda destruido.</p>` : ""}`
    : "";
  const damageWinnerName = pendingAction.damage?.sourceActorUuid === pendingAction.targetActorUuid
    ? targetName
    : pendingAction.sourceActorName ?? pendingAction.sourceItemName;
  const outcomeMessage = pendingAction.winnerResolutionResult === "damage"
    ? `${escapeHTML(damageWinnerName)} ganó la confrontación y obtuvo derecho a lanzar daño.`
    : result.success
    ? `${escapeHTML(pendingAction.sourceActorName ?? pendingAction.sourceItemName)} gana con consecuencia ${escapeHTML(pendingAction.winnerResolutionResult ?? "utility")}.`
    : shieldWear?.applied
      ? `${escapeHTML(targetName)} bloquea correctamente con ${escapeHTML(shieldWear.shieldName)}.`
      : `${escapeHTML(targetName)} defiende correctamente.`;

  return `<div class="mtrol-chat-card"><h2>RESOLUCIÓN ENFRENTADA</h2>
    <p><strong>${escapeHTML(pendingAction.sourceItemName)}</strong> contra <strong>${escapeHTML(targetName)}</strong>.</p>
    <p>Atacante: <strong>${result.attackerTotal}</strong> | Defensor: <strong>${result.defenderTotal}</strong></p>
    ${rollsHTML}${tieMessages}<p>${outcomeMessage}</p>${shieldWearMessages}
    <p>Resultado:<br><strong>${escapeHTML(getResolutionOutcomeLabel(result))}</strong>.</p>
    <p>${escapeHTML(getResolutionDescription(result))}</p>
    ${pendingAction.damage?.status === "cancelled" ? "<p><strong>Daño cancelado por GM.</strong></p>" : ""}
    ${damageExecutedMessage}${damageErrorMessage}${damageButton}${cancelDamageButton}${reactionMovementButton}</div>`;
}

function appendRestoredRollEntries(entries, serializedRolls, label) {
  for (const [index, roll] of mtrolRestoreRolls(serializedRolls).entries()) {
    entries.push({ roll, label: index === 0 ? label : `${label} · cadena ${index}` });
  }
}

export async function prepareResolutionChatRolls(pendingAction, result) {
  const entries = [];
  appendRestoredRollEntries(entries, pendingAction.attackerRoll?.rolls ?? [], "Tirada atacante");
  appendRestoredRollEntries(entries, pendingAction.defenderRoll?.rolls ?? [], "Tirada defensiva");
  const tieBreakerRoll = result.tieBreaker?.roll ?? mtrolRestoreRolls(result.tieBreaker?.rollData ?? [])[0] ?? null;
  if (tieBreakerRoll) entries.push({ roll: tieBreakerRoll, label: "Desempate" });
  const shieldWearRoll = pendingAction.shieldWear?.wearRoll ??
    mtrolRestoreRolls(pendingAction.shieldWear?.wearRollData ?? [])[0] ?? null;
  if (shieldWearRoll) entries.push({ roll: shieldWearRoll, label: "Desgaste de escudo" });
  return mtrolPrepareChatRolls(entries);
}

export async function createInvalidDefenseMessage(actor, message) {
  await ChatMessage.create({
    speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
    content: `<div class="mtrol-chat-card mtrol-chat-warning"><h2>Defensa con escudos rechazada</h2><p>${escapeHTML(message)}</p></div>`
  });
}

export async function createResolutionMessage(pendingAction, result) {
  const actor = pendingAction.sourceActorUuid ? await fromUuid(pendingAction.sourceActorUuid) : null;
  const target = pendingAction.targetActorUuid ? await fromUuid(pendingAction.targetActorUuid) : null;
  pendingAction.sourceActorName = actor?.name ?? "Atacante";
  pendingAction.targetActorName = target?.name ?? "Defensor";
  const chatRolls = await prepareResolutionChatRolls(pendingAction, result);
  const sourceItem = actor?.items?.get?.(pendingAction.sourceItemId) ?? null;
  const resolutionState = ["attacker-fumble", "defender-fumble"].includes(result.reason)
    ? "fumble"
    : (["attacker-critical", "defender-critical"].includes(result.reason) ||
       pendingAction.attackerRoll?.isCritical === true || pendingAction.defenderRoll?.isCritical === true)
      ? "critical"
      : "normal";
  const message = await mtrolCreateRollMessage({
    user: pendingAction.sourceUserId ?? game.user?.id,
    speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
    content: buildResolutionContent(pendingAction, result, chatRolls.html),
    rolls: chatRolls.rolls,
    mtrolCard: {
      family: result.success ? "attack" : "defense",
      state: resolutionState,
      title: "Resolución enfrentada",
      categoryLabel: result.success ? "Ataque vencedor" : "Defensa vencedora",
      formula: `Ataque ${result.attackerTotal} vs Defensa ${result.defenderTotal}`,
      total: result.success ? result.attackerTotal : result.defenderTotal,
      icon: sourceItem?.img ?? actor?.img ?? ""
    },
    flags: { mtrol: {
      pendingActionId: pendingAction.id,
      transactionId: pendingAction.resolutionTransactionId ?? null,
      presentationType: "opposition-resolution",
      damageStatus: pendingAction.damage?.status ?? "unavailable"
    } }
  });
  pendingAction.resolutionMessageId = message?.id ?? null;
  return message;
}
