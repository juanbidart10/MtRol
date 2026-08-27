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

import {
  mtrolCreateRollMessage,
  mtrolPrepareChatRolls,
  mtrolRestoreRolls,
  mtrolSerializeRoll,
  mtrolSerializeRolls
} from "../rolls/chat-rolls.js";

import {
  getItemAbilityDamageConfig
} from "./ability-config.js";

import {
  MTROL_CATEGORIES,
  normalizarCategoria
} from "../core/categories.js";

import {
  completeResolvedTurnAction,
  finalizeResolvedCompetenciaUse,
  getActionGuard
} from "../combat/turn-system.js";

import {
  aplicarConsumoMP,
  validarConsumoMP
} from "../combat/mp-engine.js";

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

let oppositionChatHandlerRegistered =
  false;

const REACTION_MOVEMENT_ACTION =
  "mtrol-close-reaction-movement";

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

    } else if (pendingAction.reactionMovement?.status === "available") {
      pendingAction.reactionMovement.status = "skipped";
      pendingAction.reactionMovement.reason = "timeout";
      pendingAction.reactionMovement.closedAt = now;
      pendingAction.updatedAt = now;
      broadcastPendingAction(pendingAction);
    }

    if (game.user?.isGM && pendingAction.sourceActorUuid) {
      fromUuid(pendingAction.sourceActorUuid)
        .then(sourceActor => sourceActor && completeResolvedTurnAction(sourceActor, {
          resolutionId: pendingAction.id,
          completionId: `opposition-expired:${pendingAction.id}`
        }))
        .catch(error => console.error("MTROL | No se pudo cerrar la oposición vencida.", error));
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

function isFalse(value) {
  return value === false || value === "false";
}

const OPPOSED_DAMAGE_ACTION_TYPES = new Set([
  "attack",
  "basicAttack",
  "combatSkill",
  "damage"
]);

function getItemDamageFormula(item) {
  return String(item?.system?.danio ?? "").trim();
}

function isOpposedDamageAction(item) {
  const system = item?.system ?? {};
  const hasDamage = getItemDamageFormula(item).length > 0;

  if (!hasDamage) return false;

  return (
    OPPOSED_DAMAGE_ACTION_TYPES.has(system.actionType) ||
    system.effect === "damage"
  );
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

export function getActionDefinitionFromItem(item) {
  const system =
    item?.system ?? {};
  const persistedSystem =
    item?._source?.system ?? system;
  const hasExplicitOpposition =
    Object.hasOwn(persistedSystem, "requiresOpposition");

  if (
    isTrue(system.requiresOpposition) ||
    (!hasExplicitOpposition && isOpposedDamageAction(item))
  ) {
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

function getCanonicalDamageContext({
  sourceActor,
  sourceItem,
  targetActor,
  requiresOpposition = true,
  data = {}
} = {}) {
  const formula =
    getItemDamageFormula(sourceItem);

  const executesDamage =
    !isFalse(sourceItem?.system?.ejecutaDanio);

  const config =
    getItemAbilityDamageConfig(sourceItem, {
      requiresOpposition
    });
  const basicCostIncludedInActivation =
    normalizarCategoria(sourceItem?.system?.categoria) === MTROL_CATEGORIES.COMPETENCIA &&
    config.costType === "basic";
  const available =
    executesDamage &&
    formula.length > 0 &&
    (!requiresOpposition || config.resolution === "onOppositionWin");

  return {
    available,
    formula: available ? formula : "",
    flatValue:
      available && Number.isFinite(Number(formula))
        ? Number(formula)
        : null,
    sourceActorUuid: sourceActor?.uuid ?? null,
    sourceTokenUuid: data.sourceTokenUuid ?? null,
    targetActorUuid: targetActor?.uuid ?? null,
    targetTokenUuid: data.targetTokenUuid ?? null,
    competenciaUuid: sourceItem?.uuid ?? null,
    competenciaId: sourceItem?.id ?? null,
    competenciaName: sourceItem?.name ?? null,
    title: sourceItem?.name ?? "Tirada de Daño",
    icon: sourceItem?.img ?? sourceActor?.img ?? "",
    localized: !isFalse(sourceItem?.system?.usaDanioLocalizado),
    costoTotal: Number(data.costoTotal ?? 0),
    resolution: config.resolution,
    mode: config.mode,
    costType: config.costType,
    basicCostIncludedInActivation,
    rollData: {}
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
    pendingAction.damage?.mode === "enabled" &&
    (
      pendingAction.targetActorUuid ||
      pendingAction.targetTokenUuid
    )
  );
}

function canShowReactionMovementButton(pendingAction) {
  return pendingAction.status === "resolved" &&
    pendingAction.reactionMovement?.status === "available";
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

function buildResolutionContent(pendingAction, result, rollsHTML = "") {
  const damageStatus =
    pendingAction.damage?.status ?? "unavailable";

  const damageTotal =
    pendingAction.damage?.total;

  const damageExecutedMessage =
    pendingAction.damage?.rolled === true
      ? `<p>Daño ejecutado: <strong>${escapeHTML(damageTotal ?? "-")}</strong>.</p>`
      : "";

  const damageErrorMessage =
    pendingAction.damage?.error && damageStatus === "failed"
      ? `<p class="mtrol-chat-warning">No se pudo completar el daño: ${escapeHTML(pendingAction.damage.error)}</p>`
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

  const reactionMovementButton =
    canShowReactionMovementButton(pendingAction)
      ? `
        <p>Esquiva exitosa: el objetivo puede mover 1 cuadro en cualquier dirección o renunciar.</p>
        <button type="button"
                data-action="${REACTION_MOVEMENT_ACTION}"
                data-pending-action-id="${escapeHTML(pendingAction.id)}">
          NO MOVER
        </button>
      `
      : "";

  if (pendingAction.requiresOpposition !== true) {
    return `
      <div class="mtrol-chat-card">
        <h2>DAÑO HABILITADO</h2>
        <p><strong>${escapeHTML(pendingAction.sourceItemName)}</strong> completó su acción principal.</p>
        ${rollsHTML}
        ${damageExecutedMessage}
        ${damageErrorMessage}
        ${damageButton}
      </div>
    `;
  }

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
      ${rollsHTML}
      ${tieMessages}
      <p>${outcomeMessage}</p>
      ${shieldWearMessages}
      <p>Resultado:<br><strong>${escapeHTML(getResolutionOutcomeLabel(result))}</strong>.</p>
      <p>${escapeHTML(resolutionDescription)}</p>
      ${damageExecutedMessage}
      ${damageErrorMessage}
      ${damageButton}
      ${reactionMovementButton}
    </div>
  `;
}

function appendRestoredRollEntries(entries, serializedRolls, label) {
  for (const [index, roll] of mtrolRestoreRolls(serializedRolls).entries()) {
    entries.push({
      roll,
      label: index === 0
        ? label
        : `${label} · cadena ${index}`
    });
  }
}

async function prepareResolutionChatRolls(pendingAction, result) {
  const entries = [];

  appendRestoredRollEntries(
    entries,
    pendingAction.attackerRoll?.rolls ?? [],
    "Tirada atacante"
  );

  appendRestoredRollEntries(
    entries,
    pendingAction.defenderRoll?.rolls ?? [],
    "Tirada defensiva"
  );

  const tieBreakerRoll =
    result.tieBreaker?.roll ??
    mtrolRestoreRolls(result.tieBreaker?.rollData ?? [])[0] ??
    null;

  if (tieBreakerRoll) {
    entries.push({
      roll: tieBreakerRoll,
      label: "Desempate"
    });
  }

  const shieldWearRoll =
    pendingAction.shieldWear?.wearRoll ??
    mtrolRestoreRolls(pendingAction.shieldWear?.wearRollData ?? [])[0] ??
    null;

  if (shieldWearRoll) {
    entries.push({
      roll: shieldWearRoll,
      label: "Desgaste de escudo"
    });
  }

  return mtrolPrepareChatRolls(entries);
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

  const chatRolls =
    await prepareResolutionChatRolls(
      pendingAction,
      result
    );

  const sourceItem =
    actor?.items?.get?.(pendingAction.sourceItemId) ?? null;

  const resolutionState =
    ["attacker-fumble", "defender-fumble"].includes(result.reason)
      ? "fumble"
      : (
          ["attacker-critical", "defender-critical"].includes(result.reason) ||
          pendingAction.attackerRoll?.isCritical === true ||
          pendingAction.defenderRoll?.isCritical === true
        )
        ? "critical"
        : "normal";

  const message =
    await mtrolCreateRollMessage({
      user: pendingAction.sourceUserId ?? game.user?.id,
      speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
      content: buildResolutionContent(
        pendingAction,
        result,
        chatRolls.html
      ),
      rolls: chatRolls.rolls,
      mtrolCard: {
        family: result.success ? "attack" : "defense",
        state: resolutionState,
        title: "Resolución enfrentada",
        categoryLabel:
          result.success
            ? "Ataque vencedor"
            : "Defensa vencedora",
        formula: `Ataque ${result.attackerTotal} vs Defensa ${result.defenderTotal}`,
        total:
          result.success
            ? result.attackerTotal
            : result.defenderTotal,
        icon: sourceItem?.img ?? actor?.img ?? ""
      },
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
    responseDamage: data.responseDamage ?? null,
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

  const turnGuard = getActionGuard(sourceActor, sourceItem);
  if (!turnGuard.allowed) throw new Error(turnGuard.reason);

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
    sourceActorName: sourceActor.name,
    targetActorId: targetActor.id,
    targetActorUuid: targetActor.uuid,
    targetActorName: targetActor.name,
    sourceItemId: sourceItem.id,
    sourceItemName: sourceItem.name,
    actionType: definition.actionType,
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
      data: data.damage ?? {}
    })
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

export async function createReadyDamageActionAuthoritative(data = {}, {
  requestingUserId = game.user?.id
} = {}) {
  if (!game.user?.isGM) {
    throw new Error("Solo el GM autoritativo puede habilitar una resolución de daño.");
  }

  const sourceActor = data.sourceActorUuid
    ? await fromUuid(data.sourceActorUuid)
    : game.actors?.get?.(data.sourceActorId) ?? null;
  const targetActor = data.targetActorUuid
    ? await fromUuid(data.targetActorUuid)
    : game.actors?.get?.(data.targetActorId) ?? null;

  if (!sourceActor || !targetActor) {
    throw new Error("La resolución de daño no contiene actores válidos.");
  }

  if (!userCanControlActor(sourceActor, requestingUserId)) {
    throw new Error("El usuario no controla al actor atacante.");
  }

  const sourceItem = sourceActor.items.get(data.sourceItemId);

  if (!sourceItem || sourceItem.type !== "competencia") {
    throw new Error("La competencia atacante ya no existe.");
  }

  const turnGuard = getActionGuard(sourceActor, sourceItem);
  if (!turnGuard.allowed) throw new Error(turnGuard.reason);

  const definition = getActionDefinitionFromItem(sourceItem);
  const config = getItemAbilityDamageConfig(sourceItem, {
    requiresOpposition: definition.requiresOpposition
  });

  if (config.resolution !== "immediate" || config.mode !== "enabled") {
    throw new Error("La habilidad no admite una ejecución de daño inmediata habilitada.");
  }

  const canonicalData = {
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
    effect: definition.effect,
    defenseType: definition.defenseType,
    oppositionType: definition.oppositionType,
    requiresOpposition: false,
    damage: getCanonicalDamageContext({
      sourceActor,
      sourceItem,
      targetActor,
      requiresOpposition: false,
      data: data.damage ?? {}
    })
  };
  const pendingAction = buildPendingAction(canonicalData);

  pendingAction.status = "resolved";
  pendingAction.result = {
    success: true,
    reason: "no-opposition",
    attackerTotal: Number(data.attackerRoll?.total ?? 0),
    defenderTotal: 0,
    tieBreaker: null
  };
  pendingAction.resolvedAt = Date.now();
  pendingAction.updatedAt = pendingAction.resolvedAt;
  pendingActions.set(pendingAction.id, pendingAction);

  await createResolutionMessage(pendingAction, pendingAction.result);
  broadcastPendingAction(pendingAction);
  return pendingAction;
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

export function getPendingOppositionForActor(actor) {
  return getAvailableActionsForActor(actor)[0] ?? null;
}

export function getReactionMovementForActor(actor) {
  if (!actor) return null;
  cleanupExpiredPendingActions();
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
  specialContext = null,
  consumeResponse = false,
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

  if (!defenseItem || defenseItem.type !== "competencia") {
    throw new Error("La acción de oposición no es válida.");
  }

  const responseGuard = getActionGuard(actor, defenseItem);
  if (
    !responseGuard.allowed ||
    (responseGuard.reactive && responseGuard.opposition?.id !== pendingAction.id)
  ) {
    throw new Error(responseGuard.reason ?? "La acción no pertenece a esta oposición.");
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
    defenseItem.system?.actionType ?? "utility";

  pendingAction.responseEffect =
    defenseItem.system?.effect ?? "none";

  pendingAction.responseDamage =
    getCanonicalDamageContext({
      sourceActor: actor,
      sourceItem: defenseItem,
      targetActor: pendingAction.sourceActorUuid
        ? await fromUuid(pendingAction.sourceActorUuid)
        : null,
      requiresOpposition: false,
      data: {
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

export async function attachDefenseRoll(pendingActionId, rollData = {}, options = {}) {
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
        specialContext: options.specialContext ?? null,
        consumeResponse: options.consumeResponse === true,
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
        defenderRoll: rollToData(rollData),
        specialContext: options.specialContext ?? null,
        consumeResponse: options.consumeResponse === true
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
  consumeResponse = false
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
    { specialContext, consumeResponse }
  );
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

    if (!result.success && pendingAction.responseEffect === "stunned") {
      const source = pendingAction.sourceTokenUuid
        ? await fromUuid(pendingAction.sourceTokenUuid)
        : await fromUuid(pendingAction.sourceActorUuid);
      await applyState(source, pendingAction.responseEffect, {
        source: pendingAction.responseItemName,
        pendingActionId,
        duration: 1,
        intensity: 0
      });
    }

    if (!result.success && pendingAction.defenseType === "dodge") {
      pendingAction.reactionMovement = {
        resolutionId: pendingAction.id,
        actorUuid: pendingAction.targetActorUuid,
        tokenUuid: pendingAction.targetTokenUuid,
        allowance: 1,
        status: "available",
        grantedAt: Date.now()
      };
    }

    if (!result.success && pendingAction.responseDamage?.available === true) {
      const responseActor = pendingAction.targetActorUuid
        ? await fromUuid(pendingAction.targetActorUuid)
        : null;
      const sourceActor = pendingAction.sourceActorUuid
        ? await fromUuid(pendingAction.sourceActorUuid)
        : null;
      const sourceToken = pendingAction.sourceTokenUuid
        ? await fromUuid(pendingAction.sourceTokenUuid)
        : null;
      const responseItem = responseActor?.items?.get?.(pendingAction.responseItemId) ?? null;
      const { executeConfiguredCompetenciaDamage } =
        await import("./action-damage-engine.js");
      const damageResult = await executeConfiguredCompetenciaDamage({
        actor: responseActor,
        targetActor: sourceActor,
        targetToken: sourceToken,
        formula: pendingAction.responseDamage.formula,
        flatValue: pendingAction.responseDamage.flatValue,
        costoTotal: Number(pendingAction.responseDamage.costoTotal ?? 0),
        damageCostType: pendingAction.responseDamage.costType ?? "none",
        damageContext: {
          ...pendingAction.responseDamage,
          item: responseItem,
          title: pendingAction.responseItemName,
          icon: responseItem?.img ?? responseActor?.img ?? ""
        }
      });
      pendingAction.responseDamage.status = damageResult?.success === true ? "rolled" : "failed";
      pendingAction.responseDamage.rolled = true;
      pendingAction.responseDamage.total = Number(damageResult?.totalFinalDanio ?? 0);
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

  if (
    result.success === true &&
    pendingAction.damage?.available === true &&
    pendingAction.damage?.mode === "automatic" &&
    pendingAction.damage?.resolution === "onOppositionWin"
  ) {
    try {
      const { executeResolvedDamageAuthoritative } =
        await import("./action-damage-engine.js");

      await executeResolvedDamageAuthoritative(
        pendingAction.id,
        { requestingUserId: pendingAction.sourceUserId ?? game.user?.id }
      );
    } catch (error) {
      console.warn("MTROL | No se pudo ejecutar automáticamente el daño resuelto.", error);
    }
  }

  broadcastPendingAction(pendingAction);

  console.log("MTROL | Opposed action resolved authoritatively", result);

  const waitsForManualDamage = result.success === true &&
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
        console.error("MTROL | No se pudo avanzar tras cerrar la oposición.", error);
      }
    }
  }

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

  if (sourceActor) {
    await completeResolvedTurnAction(sourceActor, {
      resolutionId: pendingAction.id,
      completionId: `opposition-cancelled:${pendingAction.id}`
    });
  }

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
  if (game.user?.isGM) {
    return completeReactionMovementAuthoritative(pendingActionId, {
      ...options,
      requestingUserId: options.requestingUserId ?? game.user.id
    });
  }
  const response = await requestPrimaryGM("mtrolCompleteReactionMovement", {
    pendingActionId,
    actorUuid: options.actorUuid ?? null,
    tokenUuid: options.tokenUuid ?? null,
    cost: options.cost ?? 0,
    reason: options.reason ?? "skipped"
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

export function installMtrolActionsApi() {
  game.mtrol = game.mtrol || {};
  game.mtrol.actions = {
    createPendingAction,
    createPendingActionAuthoritative,
    createPendingActionFromCompetencia,
    createReadyDamageAction,
    createReadyDamageActionAuthoritative,
    createReadyDamageActionFromCompetencia,
    attachDefenseRoll,
    attachDefenseRollAuthoritative,
    attachDefenseRollForActor,
    resolvePendingAction,
    resolvePendingActionAuthoritative,
    requestPendingActionsForActor,
    getPendingOppositionForActor,
    getReactionMovementForActor,
    completeReactionMovement,
    completeReactionMovementAuthoritative,
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
