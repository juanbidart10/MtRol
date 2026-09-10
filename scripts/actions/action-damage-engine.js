import {
  mtrolEvaluarDadosMtrol,
  mtrolCalcularTotalBaseSinCriticos
} from "../rolls/dice-engine.js";

import {
  mtrolAplicarDharmaKarma
} from "../rolls/mtrol-dharma-karma.js";

import {
  mtrolPrepararRollData
} from "../rolls/formula-parser.js";

import {
  aplicarDanioLocalizado
} from "../combat/damage-localized.js";

import {
  crearCombatCard
} from "../combat/combat-card.js";

import {
  mtrolCreateRollMessage,
  mtrolPrepareChatRolls
} from "../rolls/chat-rolls.js";

import {
  isPrimaryActiveGM,
  requestPrimaryGM
} from "../core/socket-requests.js";

import {
  applyOrbDamagePassives
} from "../progression/orb-passive-effects.js";

import {
  aplicarConsumoMP,
  reembolsarCostoResolucionMP,
  validarCostoResolucionMP
} from "../combat/mp-engine.js";

import {
  completeResolvedTurnAction,
  getCombatantForActor,
  getTurnContext
} from "../combat/turn-system.js";
import { logger } from "../utils/logger.js";

import { createEffectContext } from "../effects/effect-context.js";
import { resolveEffects } from "../effects/effect-resolver.js";
import {
  MTROL_EFFECT_ATTRIBUTE_KEYS,
  MTROL_EFFECT_PHASES
} from "../effects/effect-types.js";
import {
  appendModifiersToFormula,
  getCanonicalDamageFormula,
  normalizeContextualModifiers,
  validateCanonicalFormula
} from "./combat-ability-policy.js";
import {
  MTROL_BODY_ROLL_TABLE,
  MTROL_BODY_SLOT_LABELS
} from "../constants/body-slots.js";

const RESOLVED_DAMAGE_ACTION =
  "mtrol-resolved-damage";
const CANCEL_DAMAGE_ACTION = "mtrol-cancel-damage";

let chatHandlerRegistered =
  false;

const executingResolvedDamageActions =
  new Set();

let actionDependencies = null;

export function configureActionDamageDependencies(dependencies = {}) {
  const required = [
    "assertActivationConsolidated",
    "broadcastPendingAction",
    "getPendingAction",
    "persistPendingActionRuntime",
    "receivePendingActionSync",
    "updateResolutionMessage",
    "userCanControlActor"
  ];
  for (const name of required) {
    if (typeof dependencies[name] !== "function") {
      throw new TypeError(`Action Damage requiere la dependencia ${name}.`);
    }
  }
  actionDependencies = Object.freeze({ ...dependencies });
}

function actions() {
  if (!actionDependencies) {
    throw new Error("Action Damage no fue integrado con Action Engine durante init.");
  }
  return actionDependencies;
}

function toNumber(value, fallback = 0) {
  const number =
    Number(value);

  return Number.isFinite(number) ? number : fallback;
}

function isValidFormula(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidFlatDamage(value) {
  if (value === null || value === undefined || value === "") return false;

  const number =
    Number(value);

  return Number.isFinite(number);
}

function hasUsableDamage(damage = {}) {
  return (
    damage.available === true &&
    (
      isValidFormula(damage.formula) ||
      isValidFlatDamage(damage.flatValue)
    )
  );
}

function assertCanExecuteResolvedDamage(pendingAction) {
  if (!pendingAction) {
    throw new Error("La accion resuelta ya no existe en memoria.");
  }

  if (pendingAction.status !== "resolved") {
    throw new Error("La accion todavia no esta resuelta.");
  }

  if (pendingAction.winnerResolutionResult !== "damage") {
    throw new Error("La consecuencia ganadora no concede daño.");
  }

  if (!hasUsableDamage(pendingAction.damage)) {
    throw new Error("La accion resuelta no tiene dano valido.");
  }

  if (
    pendingAction.damage.status !== "available" ||
    pendingAction.damage.rolled === true
  ) {
    throw new Error("El dano ya esta en ejecucion, fallo o ya fue ejecutado.");
  }
}

function validateUserCanExecuteDamage(actor, userId) {
  if (actions().userCanControlActor(actor, userId)) return;

  throw new Error("No tenes permisos para ejecutar este dano.");
}

async function publishPendingDamageState(pendingAction) {
  if (pendingAction.damage?.id) {
    const others = Array.from(pendingAction.damageEntitlements ?? [])
      .filter(entitlement => entitlement?.id !== pendingAction.damage.id);
    pendingAction.damageEntitlements = [pendingAction.damage, ...others];
  }
  pendingAction.updatedAt =
    Math.max(
      Date.now(),
      Number(pendingAction.updatedAt ?? 0) + 1
    );

  await actions().persistPendingActionRuntime(pendingAction);
  actions().broadcastPendingAction(pendingAction);

  try {
    await actions().updateResolutionMessage(pendingAction);
  } catch (error) {
    logger.warn("DAMAGE", "resolved damage presentation update failed", {
      pendingActionId: pendingAction.id,
      transactionId: pendingAction.damage?.transactionId ?? null,
      status: pendingAction.damage?.status ?? null,
      reasonCode: "PRESENTATION_UPDATE_FAILED",
      error: error.message
    });
  }
}

function resolveDamageCombatId(actor, damage = {}) {
  if (Object.hasOwn(damage, "combatId")) return damage.combatId || null;
  const context = getTurnContext();
  return getCombatantForActor(actor, context.combat) ? context.combatId : null;
}

export function prepareDamageFormulaContext({
  actor,
  targetActor = null,
  formula = "",
  damage = {}
} = {}) {
  const validation = validateCanonicalFormula(formula, {
    allowWeapons: true,
    label: "damageFormula"
  });
  if (!validation.valid) throw new Error(validation.errors.join(" "));
  const modifiers = normalizeContextualModifiers(damage.modifiers ?? [], { allowGmOnly: true });
  const effectiveFormula = appendModifiersToFormula(validation.formula, modifiers);
  const { data: preparedData, etiquetas, armas } = mtrolPrepararRollData(actor, {
    includeWeapons: validation.formula.includes("@armas")
  });
  const rollData = foundry.utils.deepClone(preparedData);

  if (damage.rollData && typeof damage.rollData === "object") {
    foundry.utils.mergeObject(
      rollData,
      damage.rollData,
      {
        inplace: true,
        overwrite: false
      }
    );
  }

  const combatId = resolveDamageCombatId(actor, damage);
  const damageSourceAttribute = MTROL_EFFECT_ATTRIBUTE_KEYS.includes(damage.damageSourceAttribute)
    ? damage.damageSourceAttribute
    : MTROL_EFFECT_ATTRIBUTE_KEYS.includes(damage.item?.system?.damageSourceAttribute)
      ? damage.item.system.damageSourceAttribute
      : null;
  const context = createEffectContext({
    phase: MTROL_EFFECT_PHASES.DAMAGE_FORMULA_BUILD,
    sourceActor: actor,
    targetActor,
    action: damage.item ?? null,
    actionType: damage.actionType ?? null,
    actionDomain: damage.actionDomain ?? damage.damageDomain ?? null,
    damageType: damage.damageType ?? null,
    damageSourceAttribute,
    formula: effectiveFormula,
    formulaData: rollData,
    isCombat: Boolean(combatId),
    combatId,
    metadata: { sourceItemUuid: damage.item?.uuid ?? damage.competenciaUuid ?? null }
  });
  const resolution = resolveEffects(context);
  return {
    context,
    formulaData: resolution.formulaData,
    resolution,
    effectiveFormula,
    breakdown: {
      labels: etiquetas,
      weapons: armas,
      modifiers
    }
  };
}

async function rollDamage({
  actor,
  formula = "",
  flatValue = null,
  rollData = {}
} = {}) {
  if (isValidFormula(formula)) {
    return new Roll(
      formula,
      rollData
    ).evaluate();
  }

  if (isValidFlatDamage(flatValue)) {
    return new Roll(
      String(toNumber(flatValue)),
      rollData
    ).evaluate();
  }

  throw new Error("Formula de dano vacia o invalida.");
}

async function createDamageFumbleMessage(
  actor,
  damageRoll,
  evaluacionDanio,
  localizationRoll,
  damageContext = {}
) {
  const chatRolls =
    await mtrolPrepareChatRolls([
      {
        roll: damageRoll,
        label: "Tirada de Dano"
      },
      ...(evaluacionDanio.extraRolls ?? []).map((extraRoll, index) => ({
        roll: extraRoll,
        label: `Cadena critica de dano ${index + 1}`
      })),
      ...(localizationRoll ? [{ roll: localizationRoll, label: "Tirada de Localización" }] : [])
    ]);

  await mtrolCreateRollMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    rolls: chatRolls.rolls,
    mtrolCard: {
      family: "damage",
      state: "fumble",
      title: damageContext.title ?? "Tirada de Daño",
      categoryLabel: "Daño",
      formula: damageRoll.formula ?? "",
      total: 0,
      icon: damageContext.icon ?? actor.img ?? ""
    },
    content: `
      <div class="mtrol-chat-card mtrol-chat-pifia">
        <h2>PIFIA EN DANO</h2>

        ${chatRolls.html}

        <p>${foundry.utils.escapeHTML(evaluacionDanio.motivo)}</p>

        <p>Daño inicial: <strong>0</strong>.</p>
        <p>Localización: <strong>${damageContext.locationLabel ?? "determinada sin consecuencias"}</strong>.</p>
      </div>
    `
  });
}

async function executeCompetenciaDamage({
  actor,
  targetActor = null,
  targetToken = null,
  formula = "",
  flatValue = null,
  costoTotal = 0,
  damageContext = {}
} = {}) {
  if (!actor) {
    throw new Error("No hay actor atacante para ejecutar dano.");
  }

  const formulaEffects = prepareDamageFormulaContext({
    actor,
    targetActor,
    formula,
    damage: damageContext
  });
  const rollData = formulaEffects.formulaData;

  let damageRoll = null;
  let localizationRoll = null;

  try {
    [damageRoll, localizationRoll] =
      await Promise.all([rollDamage({
        actor,
        formula: formulaEffects.effectiveFormula,
        flatValue,
        rollData
      }), new Roll("1d10").evaluate()]);
  } catch (error) {
    logger.error("DAMAGE", "damage formula evaluation failed", {
      actorUuid: actor?.uuid ?? null,
      formula,
      flatValue,
      reasonCode: "DAMAGE_FORMULA_INVALID",
      error: error.message
    });

    throw new Error(`Formula de dano invalida: ${formula || flatValue}`);
  }

  const evaluacionDanio =
    await mtrolEvaluarDadosMtrol(
      damageRoll
    );

  await mtrolAplicarDharmaKarma(
    actor,
    evaluacionDanio.cantidadDharma,
    evaluacionDanio.cantidadKarma
  );

  if (evaluacionDanio.pifia) {
    await createDamageFumbleMessage(
      actor,
      damageRoll,
      evaluacionDanio,
      localizationRoll,
      {
        ...damageContext,
        locationLabel: MTROL_BODY_SLOT_LABELS[
          MTROL_BODY_ROLL_TABLE[Number(localizationRoll.total ?? 0)]
        ] ?? "No determinada"
      }
    );

    return {
      success: false,
      fumble: true,
      damageRoll,
      evaluacionDanio,
      totalBaseDanio: 0,
      totalFinalDanio: 0,
      formulaEffects: formulaEffects.resolution,
      breakdown: formulaEffects.breakdown,
      localizationRoll,
      resultadoDanio: null
    };
  }

  const totalBaseDanio =
    mtrolCalcularTotalBaseSinCriticos(
      damageRoll
    );

  const totalBeforeOrbPassives =
    totalBaseDanio +
    evaluacionDanio.totalExtra +
    Number(evaluacionDanio.dharmaBonus ?? 0);

  const sourceItem =
    damageContext.item ??
    actor.items?.get?.(damageContext.competenciaId) ??
    null;

  const orbPassiveDamage =
    applyOrbDamagePassives({
      damage: totalBeforeOrbPassives,
      sourceActor: actor,
      targetActor,
      sourceItem
    });

  const totalFinalDanio =
    orbPassiveDamage.damage;

  const resultadoDanio =
    await aplicarDanioLocalizado({
      actor,
      targetActor,
      targetTokenDocument: targetToken?.document ?? targetToken,
      damageRoll,
      danio: totalFinalDanio,
      costoTotal,
      evaluacionDanio,
      totalBaseDanio,
      totalFinalDanio,
      combatId: formulaEffects.context.combatId,
      damageSourceAttribute: formulaEffects.context.damageSourceAttribute,
      localizacionRoll: localizationRoll,
      transactionId: damageContext.transactionId ?? null,
      cardContext: damageContext
    });

  if (!resultadoDanio) {
    throw new Error("No se pudo aplicar el dano localizado.");
  }

  resultadoDanio.danioOriginal =
    totalFinalDanio;

  try {
    await crearCombatCard({
      actor,
      targetActor,
      damageRoll,
      resultadoDanio,
      costoTotal,
      evaluacionDanio,
      totalBaseDanio,
      totalFinalDanio,
      cardContext: {
        ...damageContext,
        breakdown: formulaEffects.breakdown
      }
    });
  } catch (error) {
    logger.warn("DAMAGE", "damage presentation creation failed", {
      actorUuid: actor?.uuid ?? null,
      targetActorUuid: targetActor?.uuid ?? null,
      reasonCode: "PRESENTATION_CREATE_FAILED",
      error: error.message
    });
  }

  return {
    success: true,
    fumble: false,
    damageRoll,
    evaluacionDanio,
    totalBaseDanio,
    totalFinalDanio,
    orbPassiveDamage,
    formulaEffects: formulaEffects.resolution,
    breakdown: formulaEffects.breakdown,
    resultadoDanio
  };
}

export async function executeResolvedDamageAuthoritative(
  pendingActionId,
  {
    requestingUserId = game.user?.id
  } = {}
) {
  if (!isPrimaryActiveGM()) {
    throw new Error("Solo el Primary GM puede ejecutar el dano resuelto.");
  }

  const pendingAction =
    actions().getPendingAction(pendingActionId);

  assertCanExecuteResolvedDamage(pendingAction);
  actions().assertActivationConsolidated(pendingAction);

  if (executingResolvedDamageActions.has(pendingActionId)) {
    throw new Error("El dano ya esta en ejecucion.");
  }

  executingResolvedDamageActions.add(pendingActionId);

  const damage =
    pendingAction.damage;

  try {
    const actor =
      damage.sourceActorUuid
        ? await fromUuid(damage.sourceActorUuid)
        : null;

    const targetActor =
      damage.targetActorUuid
        ? await fromUuid(damage.targetActorUuid)
        : null;

    const targetToken =
      damage.targetTokenUuid
        ? await fromUuid(damage.targetTokenUuid)
        : null;

    if (!actor) {
      throw new Error("No se encontro el actor atacante.");
    }

    if (!targetActor) {
      throw new Error("No se encontro el objetivo.");
    }

    const sourceItem = actor.items?.get?.(damage.competenciaId) ?? null;
    if (!sourceItem) throw new Error("La habilidad que concede el daño ya no existe.");
    damage.formula = getCanonicalDamageFormula(sourceItem, damage.declaredMode ?? null);
    damage.damageFormula = damage.formula;

    validateUserCanExecuteDamage(
      actor,
      requestingUserId
    );

    const additionalCostReceipt =
      validarCostoResolucionMP(
        actor,
        damage.basicCostIncludedInActivation === true
          ? "none"
          : damage.costType ?? "none"
      );

    if (!additionalCostReceipt?.exito) {
      throw new Error("No hay MP suficiente para ejecutar la resolución de daño.");
    }

    damage.status =
      "rolling";

    damage.transactionId ??= `damage:${pendingAction.id}:${damage.id ?? "1"}`;

    damage.rolled =
      false;

    damage.lastUserId =
      requestingUserId;

    damage.error =
      null;

    await publishPendingDamageState(pendingAction);

    if (additionalCostReceipt.costoTotal > 0) {
      const appliedCostReceipt = await aplicarConsumoMP(actor, additionalCostReceipt);
      damage.additionalCostTransactionId = appliedCostReceipt?.transactionId ?? null;
      damage.additionalCostApplied = true;
    }

    const result =
      await executeCompetenciaDamage({
        actor,
        targetActor,
        targetToken,
        formula: damage.formula,
        flatValue: damage.flatValue,
        costoTotal: damage.costoTotal + additionalCostReceipt.costoTotal,
        damageContext: damage
          ? {
              ...damage,
              combatId: pendingAction.combatId ?? null,
              item: sourceItem
            }
          : damage
      });

    damage.status =
      "rolled";

    damage.rolled =
      true;

    damage.rolledAt =
      Date.now();

    damage.total =
      result.totalFinalDanio;

    damage.fumble =
      result.fumble === true;

    await publishPendingDamageState(pendingAction);

    try {
      const turnActor = pendingAction.sourceActorUuid
        ? await fromUuid(pendingAction.sourceActorUuid)
        : actor;
      await completeResolvedTurnAction(turnActor, {
        resolutionId: pendingAction.id,
        completionId: `damage:${pendingAction.id}`
      });
    } catch (turnError) {
      logger.error("TURN", "turn advance after resolved damage failed", {
        transactionId: damage.transactionId ?? null,
        pendingActionId,
        actorUuid: damage.sourceActorUuid ?? null,
        reasonCode: turnError.reasonCode ?? "TURN_ADVANCE_FAILED",
        error: turnError.message
      });
    }

    return result;
  } catch (error) {
    if (damage.additionalCostApplied === true && damage.rolled !== true) {
      const actor = damage.sourceActorUuid
        ? await fromUuid(damage.sourceActorUuid)
        : null;

      await reembolsarCostoResolucionMP(actor, {
        transactionId: damage.additionalCostTransactionId
      });
      damage.additionalCostApplied = false;
      damage.additionalCostTransactionId = null;
    }

    if (damage.status === "rolling") {
      damage.status =
        "available";

      damage.rolled =
        false;

      damage.error =
        error.message;
    }

    if (damage.status === "available") {
      await publishPendingDamageState(pendingAction);
    }

    throw error;
  } finally {
    executingResolvedDamageActions.delete(pendingActionId);
  }
}

export async function executeResolvedDamage(pendingActionId, options = {}) {
  if (game.user?.isGM) {
    return executeResolvedDamageAuthoritative(
      pendingActionId,
      {
        requestingUserId:
          options.requestingUserId ?? game.user.id
      }
    );
  }

  const response =
    await requestPrimaryGM(
      "mtrolExecuteResolvedDamage",
      {
        pendingActionId
      }
    );

  if (!response.ok) {
    throw new Error(
      response.error ?? "No se pudo ejecutar el dano resuelto."
    );
  }

  actions().receivePendingActionSync(
    response.result?.pendingAction
  );

  return response.result?.damageResult ?? null;
}

export async function cancelResolvedDamageAuthoritative(
  pendingActionId,
  { requestingUserId = game.user?.id } = {}
) {
  if (!game.user?.isGM) throw new Error("Sólo el Primary GM puede cancelar daño.");
  const requestingUser = game.users?.get?.(requestingUserId);
  if (!requestingUser?.isGM) throw new Error("Sólo un GM puede cancelar daño.");
  const pendingAction = actions().getPendingAction(pendingActionId);
  assertCanExecuteResolvedDamage(pendingAction);
  const damage = pendingAction.damage;
  damage.status = "cancelled";
  damage.available = false;
  damage.cancelledAt = Date.now();
  damage.cancelledByUserId = requestingUserId;
  damage.cancellationReason = "gm-cancelled";
  await publishPendingDamageState(pendingAction);

  const turnActor = pendingAction.sourceActorUuid
    ? await fromUuid(pendingAction.sourceActorUuid)
    : null;
  if (turnActor) {
    await completeResolvedTurnAction(turnActor, {
      resolutionId: pendingAction.id,
      completionId: `damage-cancelled:${pendingAction.id}`
    });
  }
  return pendingAction;
}

export async function cancelResolvedDamage(pendingActionId) {
  if (game.user?.isGM && isPrimaryActiveGM()) {
    return cancelResolvedDamageAuthoritative(pendingActionId, { requestingUserId: game.user.id });
  }
  const response = await requestPrimaryGM("mtrolCancelResolvedDamage", { pendingActionId });
  if (!response.ok) throw new Error(response.error ?? "No se pudo cancelar el daño.");
  return actions().receivePendingActionSync(response.result?.pendingAction);
}

async function onCancelDamageClick(event) {
  const button = event.target.closest(`[data-action="${CANCEL_DAMAGE_ACTION}"]`);
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  button.disabled = true;
  try {
    await cancelResolvedDamage(button.dataset.pendingActionId);
  } catch (error) {
    ui.notifications.warn(error.message);
    button.disabled = false;
  }
}

async function onResolvedDamageClick(event) {
  const button =
    event.target.closest(`[data-action="${RESOLVED_DAMAGE_ACTION}"]`);

  if (!button) return;

  event.preventDefault();
  event.stopPropagation();

  const pendingActionId =
    button.dataset.pendingActionId;

  if (!pendingActionId) return;

  button.disabled =
    true;

  try {
    await executeResolvedDamage(pendingActionId);
  } catch (error) {
    logger.warn("DAMAGE", "resolved damage request rejected", {
      pendingActionId,
      status: "rejected",
      reasonCode: error.reasonCode ?? "DAMAGE_REQUEST_REJECTED",
      error: error.message
    });
    ui.notifications.warn(error.message ?? "No se pudo ejecutar el dano.");

    const pendingAction =
      actions().getPendingAction(pendingActionId);

    if (pendingAction?.damage?.status === "available") {
      button.disabled =
        false;
    }
  }
}

export function registerResolvedDamageChatHandler() {
  if (chatHandlerRegistered) return;

  chatHandlerRegistered =
    true;

  Hooks.on("renderChatMessage", async (_message, html) => {
    const selector =
      `[data-action="${RESOLVED_DAMAGE_ACTION}"]`;

    if (typeof html?.find === "function") {
      const damageButtons = html.find(selector);
      for (const button of damageButtons?.toArray?.() ?? []) {
        const pending = actions().getPendingAction(button.dataset.pendingActionId);
        const source = pending?.damage?.sourceActorUuid
          ? await fromUuid(pending.damage.sourceActorUuid)
          : null;
        if (!actions().userCanControlActor(source, game.user?.id)) button.remove();
      }
      damageButtons
        .off("click.mtrolResolvedDamage")
        .on("click.mtrolResolvedDamage", onResolvedDamageClick);

      const cancelButtons = html.find(`[data-action="${CANCEL_DAMAGE_ACTION}"]`);
      if (game.user?.isGM !== true) cancelButtons.remove?.();
      else cancelButtons
        .off("click.mtrolCancelDamage")
        .on("click.mtrolCancelDamage", onCancelDamageClick);

      return;
    }

    for (const button of html?.querySelectorAll?.(selector) ?? []) {
        const pending = actions().getPendingAction(button.dataset.pendingActionId);
        const source = pending?.damage?.sourceActorUuid
          ? await fromUuid(pending.damage.sourceActorUuid)
          : null;
        if (!actions().userCanControlActor(source, game.user?.id)) {
          button.remove();
          continue;
        }
        button.removeEventListener(
          "click",
          onResolvedDamageClick
        );

        button.addEventListener(
          "click",
          onResolvedDamageClick
        );
      }
    html?.querySelectorAll?.(`[data-action="${CANCEL_DAMAGE_ACTION}"]`).forEach(button => {
      if (game.user?.isGM !== true) button.remove();
      else {
        button.removeEventListener("click", onCancelDamageClick);
        button.addEventListener("click", onCancelDamageClick);
      }
    });
  });
}
