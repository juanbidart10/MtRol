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
  getPendingAction,
  updateResolutionMessage
} from "./action-engine.js";

const RESOLVED_DAMAGE_ACTION =
  "mtrol-resolved-damage";

let chatHandlerRegistered =
  false;

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

  if (["rolling", "rolled"].includes(pendingAction.damage.status)) {
    throw new Error("El dano ya esta en ejecucion o ya fue ejecutado.");
  }
}

function validateUserCanExecuteDamage(actor) {
  if (game.user.isGM || actor?.isOwner) return;

  throw new Error("No tenes permisos para ejecutar este dano.");
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

async function createDamageFumbleMessage(actor, damageRoll, evaluacionDanio) {
  const damageRollHTML =
    await damageRoll.render({
      flavor: "Tirada de Dano"
    });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="mtrol-chat-card mtrol-chat-pifia">
        <h2>PIFIA EN DANO</h2>

        ${damageRollHTML}

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
      evaluacionDanio
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

  const totalFinalDanio =
    totalBaseDanio +
    evaluacionDanio.totalExtra;

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
      totalFinalDanio
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
    resultadoDanio
  };
}

export async function executeResolvedDamage(pendingActionId, options = {}) {
  const pendingAction =
    getPendingAction(pendingActionId);

  assertCanExecuteResolvedDamage(pendingAction);

  const damage =
    pendingAction.damage;

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

  validateUserCanExecuteDamage(actor);

  damage.status =
    "rolling";

  damage.rolled =
    false;

  damage.lastUserId =
    game.user.id;

  await updateResolutionMessage(pendingAction);

  try {
    const result =
      await executeCompetenciaDamage({
        actor,
        targetActor,
        targetToken,
        formula: damage.formula,
        flatValue: damage.flatValue,
        costoTotal: damage.costoTotal,
        damageContext: damage
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

    await updateResolutionMessage(pendingAction);

    return result;
  } catch (error) {
    if (damage.status === "rolling") {
      damage.status =
        "available";

      damage.rolled =
        false;

      damage.error =
        error.message;
    }

    await updateResolutionMessage(pendingAction);

    throw error;
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
