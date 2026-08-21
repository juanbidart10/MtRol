import {
  mtrolEvaluarDadosMtrol,
  mtrolCalcularTotalBaseSinCriticos,
  mtrolMostrarDados
} from "../rolls/dice-engine.js";

import {
  mtrolAplicarDharmaKarma
} from "../rolls/mtrol-dharma-karma.js";

import {
  mtrolObtenerDanioManos
} from "../rolls/roll-helpers.js";

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
  broadcastPendingAction,
  getPendingAction,
  receivePendingActionSync,
  updateResolutionMessage,
  userCanControlActor
} from "./action-engine.js";

import {
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

const RESOLVED_DAMAGE_ACTION =
  "mtrol-resolved-damage";

let chatHandlerRegistered =
  false;

const executingResolvedDamageActions =
  new Set();

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

  if (pendingAction.result?.success !== true) {
    throw new Error("La defensa gano; no hay dano disponible.");
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
  if (userCanControlActor(actor, userId)) return;

  throw new Error("No tenes permisos para ejecutar este dano.");
}

async function publishPendingDamageState(pendingAction) {
  pendingAction.updatedAt =
    Math.max(
      Date.now(),
      Number(pendingAction.updatedAt ?? 0) + 1
    );

  broadcastPendingAction(pendingAction);

  try {
    await updateResolutionMessage(pendingAction);
  } catch (error) {
    console.warn(
      "MTROL | No se pudo actualizar la tarjeta de dano resuelto.",
      error
    );
  }
}

function buildRollData(actor, damage = {}) {
  const rollData =
    foundry.utils.deepClone(actor?.getRollData?.() ?? {});

  const danioManos =
    mtrolObtenerDanioManos(actor);

  rollData.mano =
    danioManos.total;

  rollData.manoDer =
    danioManos.manoDer;

  rollData.manoIzq =
    danioManos.manoIzq;

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

  return rollData;
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
      }))
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

        <p>El dano localizado fue cancelado.</p>
      </div>
    `
  });
}

export async function executeCompetenciaDamage({
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

  const rollData =
    buildRollData(
      actor,
      damageContext
    );

  let damageRoll = null;

  try {
    damageRoll =
      await rollDamage({
        actor,
        formula,
        flatValue,
        rollData
      });
  } catch (error) {
    console.error("MTROL | Formula de dano invalida.", {
      formula,
      flatValue,
      error
    });

    throw new Error(`Formula de dano invalida: ${formula || flatValue}`);
  }

  await mtrolMostrarDados(damageRoll);

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
      damageContext
    );

    return {
      success: false,
      fumble: true,
      damageRoll,
      evaluacionDanio,
      totalBaseDanio: 0,
      totalFinalDanio: 0,
      resultadoDanio: null
    };
  }

  const totalBaseDanio =
    mtrolCalcularTotalBaseSinCriticos(
      damageRoll
    );

  const totalBeforeOrbPassives =
    totalBaseDanio +
    evaluacionDanio.totalExtra;

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
      totalFinalDanio
    });
  } catch (error) {
    console.warn(
      "MTROL | El dano fue aplicado, pero no se pudo crear la combat card.",
      error
    );
  }

  return {
    success: true,
    fumble: false,
    damageRoll,
    evaluacionDanio,
    totalBaseDanio,
    totalFinalDanio,
    orbPassiveDamage,
    resultadoDanio
  };
}

export async function executeConfiguredCompetenciaDamage({
  actor,
  damageCostType = "none",
  costoTotal = 0,
  ...damageArgs
} = {}) {
  let additionalCostReceipt =
    validarCostoResolucionMP(actor, damageCostType);

  if (!additionalCostReceipt?.exito) {
    throw new Error("No hay MP suficiente para ejecutar la resolución de daño.");
  }

  let additionalCostApplied = false;

  try {
    if (additionalCostReceipt.costoTotal > 0) {
      additionalCostReceipt = await aplicarConsumoMP(actor, additionalCostReceipt);
      additionalCostApplied = true;
    }

    return await executeCompetenciaDamage({
      actor,
      ...damageArgs,
      costoTotal: Number(costoTotal ?? 0) + additionalCostReceipt.costoTotal
    });
  } catch (error) {
    if (additionalCostApplied) {
      await reembolsarCostoResolucionMP(actor, additionalCostReceipt);
    }

    throw error;
  }
}

export async function executeResolvedDamageAuthoritative(
  pendingActionId,
  {
    requestingUserId = game.user?.id
  } = {}
) {
  if (!game.user?.isGM) {
    throw new Error("Solo el GM autoritativo puede ejecutar el dano resuelto.");
  }

  const pendingAction =
    getPendingAction(pendingActionId);

  assertCanExecuteResolvedDamage(pendingAction);

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

    validateUserCanExecuteDamage(
      actor,
      requestingUserId
    );

    const additionalCostReceipt =
      validarCostoResolucionMP(actor, damage.costType ?? "none");

    if (!additionalCostReceipt?.exito) {
      throw new Error("No hay MP suficiente para ejecutar la resolución de daño.");
    }

    damage.status =
      "rolling";

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
              item: actor.items?.get?.(damage.competenciaId) ?? null
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
        "failed";

      damage.rolled =
        false;

      damage.error =
        error.message;
    }

    if (damage.status === "failed") {
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

  receivePendingActionSync(
    response.result?.pendingAction
  );

  return response.result?.damageResult ?? null;
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
    console.warn("MTROL | No se pudo ejecutar dano resuelto.", error);
    ui.notifications.warn(error.message ?? "No se pudo ejecutar el dano.");

    const pendingAction =
      getPendingAction(pendingActionId);

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

  Hooks.on("renderChatMessage", (_message, html) => {
    const selector =
      `[data-action="${RESOLVED_DAMAGE_ACTION}"]`;

    if (typeof html?.find === "function") {
      html
        .find(selector)
        .off("click.mtrolResolvedDamage")
        .on("click.mtrolResolvedDamage", onResolvedDamageClick);

      return;
    }

    html
      ?.querySelectorAll?.(selector)
      .forEach(button => {
        button.removeEventListener(
          "click",
          onResolvedDamageClick
        );

        button.addEventListener(
          "click",
          onResolvedDamageClick
        );
      });
  });
}
