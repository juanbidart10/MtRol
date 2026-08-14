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

export async function mtrolRoll(formula, actor, flavor = "Tirada MtRol") {
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
    await new Roll(formula, data).evaluate();

  // Esta visual pertenece a tiradas normales MtRol.
  // No afecta el daño localizado si ese daño no llama a mtrolRoll().
  await mtrolMostrarDados(roll);

  const evaluacion =
    await mtrolEvaluarDadosMtrol(roll);

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

  if (evaluacion.pifia) {
    await mtrolAplicarDharmaKarma(
      actor,
      evaluacion.cantidadDharma,
      evaluacion.cantidadKarma
    );

    await mtrolCreateRollMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      rolls: chatRolls.rolls,
      content: `
        <div class="mtrol-chat-card mtrol-chat-pifia">
          <h2>💀 PIFIA 💀</h2>
          <p>${evaluacion.motivo}</p>
          ${chatRolls.html}
        </div>
      `
    });

    return {
      pifia: true,
      total: 0,
      roll,
      rolls: chatRolls.rolls,
      dharma: evaluacion.cantidadDharma,
      karma: evaluacion.cantidadKarma,
      mano: danioManos.total,
      manoDer: danioManos.manoDer,
      manoIzq: danioManos.manoIzq
    };
  }

  const totalBase =
    mtrolCalcularTotalBaseSinCriticos(roll);

  const totalFinal =
    totalBase + evaluacion.totalExtra;

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

        <div class="mtrol-total">
          Total final:
          <strong>${totalFinal}</strong>
        </div>

      </div>
    `
  });

  return {
    pifia: false,
    total: totalFinal,
    roll,
    rolls: chatRolls.rolls,
    extra: evaluacion.totalExtra,
    mano: danioManos.total,
    manoDer: danioManos.manoDer,
    manoIzq: danioManos.manoIzq
  };
}
