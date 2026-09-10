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
    content: buildResolutionContent(pendingAction, pendingAction.result),
    flags: { mtrol: {
      pendingActionId: pendingAction.id,
      transactionId: pendingAction.createTransactionId ?? null,
      presentationType: "opposition-pending"
    } }
  });
}

export function findPendingActionMessage(pendingActionId, presentationType) {
  if (!pendingActionId) return null;
  const messages = game.messages?.contents ?? (game.messages?.[Symbol.iterator] ? Array.from(game.messages) : []);
  return messages.find(message =>
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

const RESPONSE_LABELS = { DEFENSE: "Defensa", DODGE: "Esquiva", COUNTERATTACK: "Contraataque" };
const CONSEQUENCE_LABELS = { damage: "Daño", movement: "Movimiento", defense: "Ataque evitado",
  utility: "Utilidad", state: "Estado", control: "Control", none: "Sin consecuencia" };
const MODE_LABELS = { attack: "Ataque", movement: "Movimiento", "recover-mp": "Recuperar MP",
  "astral-projection": "Proyección astral" };

export function buildResolutionContent(pendingAction, result = pendingAction.result, rollsHTML = "") {
  const p = pendingAction;
  const source = p.sourceActorName ?? "Iniciador";
  const target = p.targetActorName ?? "Objetivo";
  const capability = RESPONSE_LABELS[p.responseDeclaration?.selectedCapability] ?? "Respuesta";
  const damageAvailable = canShowDamageButton(p, result);
  const movementAvailable = canShowReactionMovementButton(p);
  const status = p.status === "cancelled" ? "Cancelada"
    : p.status === "recovery-required" ? "Requiere revisión del GM"
    : p.status === "waiting-defense" ? "Esperando respuesta"
    : p.status === "resolving" ? "Resolviendo oposición"
    : damageAvailable ? "Esperando lanzamiento de daño"
    : p.damage?.status === "rolling" ? "Lanzando daño"
    : movementAvailable ? "Esperando movimiento o renuncia" : "Resuelta";
  const winner = result ? (result.success ? source : target) : null;
  const winnerItem = result ? (result.success ? p.sourceItemName : p.responseItemName ?? p.defenseItemName) : null;
  const consequence = CONSEQUENCE_LABELS[p.winnerResolutionResult] ?? "Resultado aplicado";
  const damageSource = p.damage?.sourceActorUuid === p.targetActorUuid ? target : source;
  const damageTarget = p.damage?.targetActorUuid === p.sourceActorUuid ? source : target;
  const response = p.responseDeclaration || p.defenderRoll
    ? `<p><strong>${escapeHTML(target)} — ${escapeHTML(p.responseItemName ?? p.defenseItemName ?? "Respuesta declarada")}</strong>
        ${escapeHTML(p.defenderRoll?.total ?? "—")}<br>Respuesta: ${escapeHTML(capability)}
        ${p.responseResolutionResult ? `<br>Consecuencia de respuesta: ${escapeHTML(CONSEQUENCE_LABELS[p.responseResolutionResult] ?? "Resultado aplicado")}` : ""}</p>`
    : `<p>VS <strong>${escapeHTML(target)}</strong></p>`;
  const waiting = p.status === "waiting-defense"
    ? `<p>Debe responder: <strong>${escapeHTML(target)}</strong></p><p>Respuestas válidas:
        ${(p.allowedResponses ?? []).map(value => RESPONSE_LABELS[value]).filter(Boolean).map(escapeHTML).join(" · ")}</p>` : "";
  const outcome = winner && !["cancelled", "recovery-required"].includes(p.status)
    ? `<p>Ganador: <strong>${escapeHTML(winner)} — ${escapeHTML(winnerItem ?? "Habilidad")}</strong></p>
       <p>Consecuencia: <strong>${escapeHTML(consequence)}</strong>${p.winnerResolutionResult === "damage" ? ` contra ${escapeHTML(damageTarget)}` : ""}</p>` : "";
  const tie = result?.tieBreaker ? `<p>Empate · 1d10: ${escapeHTML(result.tieBreaker.total)}. Ganador: ${escapeHTML(winner)}.</p>` : "";
  const damage = damageAvailable
    ? `<p>Ahora: ${escapeHTML(damageSource)} debe lanzar daño contra ${escapeHTML(damageTarget)}.</p>
       <button type="button" data-action="mtrol-resolved-damage" data-pending-action-id="${escapeHTML(p.id)}">LANZAR DAÑO</button>
       <button type="button" data-action="mtrol-cancel-damage" data-pending-action-id="${escapeHTML(p.id)}">CANCELAR DAÑO</button>` : "";
  const movement = movementAvailable
    ? `<p>Movimiento concedido: ${escapeHTML(p.reactionMovement.allowance ?? 0)} cuadro(s). ${escapeHTML(target)} puede mover o renunciar.</p>
       <button type="button" data-action="${REACTION_MOVEMENT_ACTION}" data-pending-action-id="${escapeHTML(p.id)}">NO MOVER</button>` : "";
  const canonicalMovement = p.movementGrant?.granted > 0
    ? `<p>${escapeHTML(p.movementGrant.targetActorName ?? "Actor")} obtiene ${escapeHTML(p.movementGrant.granted)} cuadro(s) de movimiento.</p>`
    : "";
  const error = damageAvailable && p.damage?.error ? "<p>No se pudo completar el daño. Reintentá el lanzamiento o solicitá revisión del GM.</p>" : "";
  const shield = p.shieldWear?.destroyed ? `<p>${escapeHTML(p.shieldWear.shieldName)} se rompe y queda destruido.</p>` : "";
  const closed = p.damage?.status === "cancelled" ? "<p>Daño cancelado por GM.</p>"
    : p.damage?.rolled === true ? "<p>Lanzamiento de daño completado.</p>" : "";
  return `<div class="mtrol-chat-card"><h2>OPOSICIÓN · ${escapeHTML(status)}</h2>
    <p><strong>${escapeHTML(source)} — ${escapeHTML(p.sourceItemName)}</strong><br>Resultado: ${escapeHTML(p.attackerRoll?.total ?? "—")}
    ${p.declaredMode ? `<br>Modo: ${escapeHTML(MODE_LABELS[p.declaredMode] ?? "Modo declarado")}` : ""}
    <br>Consecuencia configurada: ${escapeHTML(CONSEQUENCE_LABELS[p.resolutionResult] ?? "Resultado aplicado")}</p>
    ${response}${waiting}${rollsHTML}${tie}${outcome}${canonicalMovement}${damage}${movement}${error}${shield}${closed}</div>`;
}

function appendRestoredRollEntries(entries, serializedRolls, label) {
  for (const [index, roll] of mtrolRestoreRolls(serializedRolls).entries()) {
    entries.push({ roll, label: index === 0 ? label : `${label} · cadena ${index}` });
  }
}

export async function prepareResolutionChatRolls(pendingAction, result) {
  const entries = [];
  appendRestoredRollEntries(entries, pendingAction.attackerRoll?.rolls ?? [], "Tirada atacante");
  appendRestoredRollEntries(entries, pendingAction.defenderRoll?.rolls ?? [], "Tirada de respuesta");
  const tieBreakerRoll = result.tieBreaker?.roll ?? mtrolRestoreRolls(result.tieBreaker?.rollData ?? [])[0] ?? null;
  if (tieBreakerRoll) entries.push({ roll: tieBreakerRoll, label: "Desempate" });
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
  const existing = game.messages?.get?.(pendingAction.resolutionMessageId ?? pendingAction.pendingMessageId);
  if (existing) {
    pendingAction.resolutionMessageId = existing.id;
    return existing.update({ content: buildResolutionContent(pendingAction, result, chatRolls.html),
      rolls: chatRolls.rolls,
      flags: { ...(existing.flags ?? {}), mtrol: { ...(existing.flags?.mtrol ?? {}),
        presentationType: "opposition-resolution", damageStatus: pendingAction.damage?.status ?? "unavailable" } } });
  }
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
      categoryLabel: "Oposición resuelta",
      formula: `Iniciador ${result.attackerTotal} vs Respuesta ${result.defenderTotal}`,
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
