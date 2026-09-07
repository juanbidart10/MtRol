 // =========================
// MTROL - ROLLS ORCHESTRATOR
// =========================
// Motor central de tiradas MtRol.
// Orquesta:
// - preparación de fórmula
// - evaluación de dados
// - crítico / pifia
// - Dharma / Karma
// - chat card
// =========================

import {
  mtrolPrepararRollData
} from "./formula-parser.js";

import {
  mtrolEvaluarDadosMtrol,
  mtrolCalcularTotalBaseSinCriticos,
  mtrolMostrarDados
} from "./dice-engine.js";

import {
  mtrolCrearFormulaVisual,
  mtrolNormalizarFormulaVisual
} from "./roll-formatter.js";

import {
  mtrolAplicarDharmaKarma
} from "./mtrol-dharma-karma.js";

import {
  mtrolCreateRollMessage,
  mtrolPrepareChatRolls
} from "./chat-rolls.js";

import {
  getDharmaEligibleInitialDice,
  markDharmaSpendConsumed,
  validateDharmaSpend
} from "./dharma-engine.js";

import {
  consumeDharmaSpend
} from "./dharma-spend-service.js";

import {
  resolveSpellOrbRollBonus
} from "../progression/orb-roll-bonus.js";

import {
  resolveOrbRollPassiveBonus
} from "../progression/orb-passive-effects.js";

import {
  consumePreparation
} from "../combat/turn-system.js";

import { resolveGameplayRollEffects } from "../effects/effect-pipeline.js";

export { resolveGameplayRollEffects } from "../effects/effect-pipeline.js";

function buildDharmaCardAudit(context, traces = []) {
  if (!context || !Array.isArray(traces)) return null;

  return {
    used: context.cost,
    traces: traces.map(trace => ({
      termIndex: trace.termIndex,
      resultIndex: trace.resultIndex,
      faces: trace.faces,
      naturalResult: trace.naturalResult,
      effectiveResult: trace.effectiveResult,
      finalResult: trace.finalResult,
      fumblePrevented: trace.fumblePrevented,
      naturalCritical: trace.naturalCritical,
      criticalResolvedResult: trace.criticalResolvedResult,
      dharmaBonus: trace.dharmaBonus,
      dharmaBonusAfterCritical: trace.dharmaBonusAfterCritical
    }))
  };
}

export async function mtrolRoll(
  formula,
  actor,
  flavor = "Tirada MtRol",
  cardContext = {},
  {
    dharmaSpend = null,
    consumeDharma = consumeDharmaSpend
  } = {}
) {
  if (!actor) {
    ui.notifications.warn("MtRol | No hay actor para la tirada.");
    return null;
  }

  const {
    data,
    etiquetas,
    danioManos
  } = mtrolPrepararRollData(actor);

  const formulaVisual =
    mtrolCrearFormulaVisual(formula, etiquetas);

  const formulaVisualFinal =
    mtrolNormalizarFormulaVisual(formulaVisual);

  const roll =
    new Roll(formula, data);

  let activeDharmaContext = null;

  if (dharmaSpend?.enabled === true) {
    const eligibleDice =
      getDharmaEligibleInitialDice(roll);

    const validation =
      validateDharmaSpend({
        availableDharma:
          actor.system?.recursos?.dharma,
        selectedDice:
          dharmaSpend.selectedIds ?? dharmaSpend.selectedDice,
        eligibleDice
      });

    if (!validation.valid) {
      const message =
        validation.errors[0]?.message ??
        "La seleccion de Dharma no es valida.";

      ui.notifications.warn(message);
      return null;
    }

  }

  const preparationExecution =
    await consumePreparation(actor, async () => {
      if (dharmaSpend?.enabled === true) {
        const receipt =
          await consumeDharma(actor, dharmaSpend);

        activeDharmaContext =
          markDharmaSpendConsumed(
            dharmaSpend,
            receipt
          );
      }

      return roll.evaluate();
    });

  const preparationBonus =
    Number(preparationExecution.preparationBonus ?? 0);

  // Esta visual pertenece a tiradas normales MtRol.
  // No afecta el daño localizado si ese daño no llama a mtrolRoll().
  await mtrolMostrarDados(roll);

  const evaluacion =
    await mtrolEvaluarDadosMtrol(roll, {
      dharmaContext: activeDharmaContext
    });

  const chatRolls =
    await mtrolPrepareChatRolls([
      {
        roll,
        label: flavor
      },
      ...(evaluacion.extraRolls ?? []).map((extraRoll, index) => ({
        roll: extraRoll,
        label: `Cadena critica ${index + 1}`
      }))
    ]);

  const baseCardContext = {
    ...cardContext,
    title: cardContext.title ?? flavor,
    icon: cardContext.icon ?? actor.img ?? "",
    formula: cardContext.formula ?? formulaVisualFinal
  };

  const dharmaCardAudit =
    buildDharmaCardAudit(
      activeDharmaContext,
      evaluacion.dharmaTraces
    );

  if (evaluacion.pifia) {
    await mtrolAplicarDharmaKarma(
      actor,
      evaluacion.cantidadDharma,
      evaluacion.cantidadKarma
    );

    await mtrolCreateRollMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      rolls: chatRolls.rolls,
      mtrolCard: {
        ...baseCardContext,
        state: "fumble",
        total: 0,
        dharma: dharmaCardAudit,
        preparation: preparationBonus
      },
      content: `
        <div class="mtrol-chat-card mtrol-chat-pifia">
          <h2>💀 PIFIA 💀</h2>
          <p>${evaluacion.motivo}</p>
          ${chatRolls.html}
          ${preparationBonus > 0
            ? `<p>Preparación consumida: <strong>+${preparationBonus}</strong>.</p>`
            : ""}
        </div>
      `
    });

    return {
      pifia: true,
      critico: false,
      total: 0,
      roll,
      rolls: chatRolls.rolls,
      dharma: evaluacion.cantidadDharma,
      karma: evaluacion.cantidadKarma,
      preparationBonus,
      dharmaSpend: activeDharmaContext
        ? {
            context: activeDharmaContext,
            traces: evaluacion.dharmaTraces ?? []
          }
        : null,
      mano: danioManos.total,
      manoDer: danioManos.manoDer,
      manoIzq: danioManos.manoIzq
    };
  }

  const totalBase =
    mtrolCalcularTotalBaseSinCriticos(roll);

  const rollEffects =
    resolveGameplayRollEffects(actor, totalBase, cardContext);

  const orbRollBonus =
    resolveSpellOrbRollBonus(actor, cardContext.item);

  const orbPassiveBonus =
    resolveOrbRollPassiveBonus(actor, cardContext.item);

  const totalFinal =
    rollEffects.value +
    evaluacion.totalExtra +
    Number(evaluacion.dharmaBonus ?? 0) +
    orbRollBonus.bonus +
    orbPassiveBonus.bonus +
    preparationBonus;

  await mtrolAplicarDharmaKarma(
    actor,
    evaluacion.cantidadDharma,
    evaluacion.cantidadKarma
  );

  const usaManos =
    formula.includes("@mano");

  const detalleManos = `
    <div class="mtrol-details">
      <strong>Armas equipadas:</strong><br>
      Mano derecha: ${
        danioManos.nombresDer.length
          ? `${danioManos.nombresDer.join(", ")} (+${danioManos.manoDer})`
          : "Sin arma con daño"
      }<br>
      Mano izquierda: ${
        danioManos.nombresIzq.length
          ? `${danioManos.nombresIzq.join(", ")} (+${danioManos.manoIzq})`
          : "Sin arma con daño"
      }<br>
      Total @mano: <strong>${danioManos.total}</strong>
    </div>
  `;

  await mtrolCreateRollMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    rolls: chatRolls.rolls,
    mtrolCard: {
      ...baseCardContext,
      state:
        evaluacion.detalles.length > 0
          ? "critical"
          : "normal",
      total: totalFinal,
      dharma: dharmaCardAudit,
      orbBonus: orbRollBonus.bonus > 0 ? orbRollBonus : null,
      orbPassiveBonus: orbPassiveBonus.bonus > 0 ? orbPassiveBonus : null,
      effects: rollEffects.appliedEffects
    },
    content: `
      <div class="mtrol-chat-card mtrol-chat-success">

        <h2>${flavor}</h2>

        <div class="mtrol-formula-box">
          ⚔️ ${formulaVisualFinal}
        </div>

        <hr>

        ${usaManos ? detalleManos : ""}

        ${usaManos ? "<hr>" : ""}

        ${chatRolls.html}

        <hr>

        ${
          evaluacion.detalles.length
            ? `
              <div class="mtrol-result-line">
                Resultado base sin crítico:
                <strong>${totalBase}</strong>
              </div>

              <hr>

              <div class="mtrol-details">
                ${evaluacion.detalles.join("<br>")}
              </div>
            `
            : ""
        }

        <hr>

        ${
          orbRollBonus.bonus > 0
            ? `<div class="mtrol-details mtrol-orb-roll-bonus">
                Orbe ${orbRollBonus.name} ${orbRollBonus.level === 5 ? "V" : "IV"}
                <strong>+${orbRollBonus.bonus}</strong>
              </div>
              <hr>`
            : ""
        }

        ${orbPassiveBonus.sources.map(source => `
          <div class="mtrol-details mtrol-orb-passive-bonus">
            ${source.passiveName} <strong>+${source.bonus}</strong>
          </div>
          <hr>
        `).join("")}

        ${preparationBonus > 0
          ? `<div class="mtrol-details mtrol-preparation-roll-bonus">
              Preparación <strong>+${preparationBonus}</strong>
            </div><hr>`
          : ""}

        <div class="mtrol-total">
          Total final:
          <strong>${totalFinal}</strong>
        </div>

      </div>
    `
  });

  return {
    pifia: false,
    critico: evaluacion.detalles.length > 0,
    total: totalFinal,
    roll,
    rolls: chatRolls.rolls,
    extra: evaluacion.totalExtra,
    dharmaBonus: Number(evaluacion.dharmaBonus ?? 0),
    preparationBonus,
    orbBonus: orbRollBonus.bonus,
    orb: orbRollBonus.bonus > 0 ? orbRollBonus : null,
    orbPassiveBonus: orbPassiveBonus.bonus,
    orbPassives: orbPassiveBonus.sources,
    rollEffects,
    dharmaSpend: activeDharmaContext
      ? {
          context: activeDharmaContext,
          traces: evaluacion.dharmaTraces ?? []
        }
      : null,
    mano: danioManos.total,
    manoDer: danioManos.manoDer,
    manoIzq: danioManos.manoIzq
  };
}
