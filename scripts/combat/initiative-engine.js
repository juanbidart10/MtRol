import {
  mtrolEvaluarDadosMtrol,
  mtrolCalcularTotalBaseSinCriticos,
  mtrolMostrarDados
} from "../rolls/dice-engine.js";

import {
  mtrolAplicarDharmaKarma
} from "../rolls/mtrol-dharma-karma.js";

import {
  mtrolCreateRollMessage,
  mtrolPrepareChatRolls
} from "../rolls/chat-rolls.js";

import {
  consumePreparation
} from "./turn-system.js";

import {
  mtrolPrepararRollData
} from "../rolls/formula-parser.js";

import {
  resolveGameplayRollEffects,
  resolveInitiativeEffects
} from "../effects/effect-pipeline.js";

export { resolveInitiativeEffects } from "../effects/effect-pipeline.js";

export async function rollMtrolInitiative(actor) {
  if (!actor) {
    ui.notifications.warn("MtRol | No hay actor para iniciativa.");
    return null;
  }

  const { data } =
    mtrolPrepararRollData(actor);

  const mainRoll = new Roll(
    "1d10 + @atributos.destreza",
    data
  );

  const preparationExecution =
    await consumePreparation(actor, () => mainRoll.evaluate());

  const preparationBonus =
    Number(preparationExecution.preparationBonus ?? 0);

  await mtrolMostrarDados(mainRoll);

  const evaluacion =
    await mtrolEvaluarDadosMtrol(mainRoll);

  await mtrolAplicarDharmaKarma(
    actor,
    evaluacion.cantidadDharma,
    evaluacion.cantidadKarma
  );

  const mainChatRolls =
    await mtrolPrepareChatRolls([
      {
        roll: mainRoll,
        label: "Iniciativa principal"
      },
      ...(evaluacion.extraRolls ?? []).map((extraRoll, index) => ({
        roll: extraRoll,
        label: `Cadena critica de iniciativa ${index + 1}`
      }))
    ]);

  if (evaluacion.pifia) {
    await mtrolCreateRollMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      rolls: mainChatRolls.rolls,
      mtrolCard: {
        family: "check",
        state: "fumble",
        title: "Iniciativa MtROL",
        categoryLabel: "Iniciativa",
        formula: "1D10 + DESTREZA",
        total: 0,
        preparation: preparationBonus,
        icon: actor.img ?? ""
      },
      content: `
        <div class="mtrol-chat-card mtrol-chat-pifia">
          <h2>💀 PIFIA DE INICIATIVA 💀</h2>
          <p>${evaluacion.motivo}</p>
          ${mainChatRolls.html}
          ${preparationBonus > 0
            ? `<p>Preparación consumida: <strong>+${preparationBonus}</strong>.</p>`
            : ""}
          <p>La iniciativa queda en <strong>0</strong>.</p>
        </div>
      `
    });

    return {
      pifia: true,
      total: 0,
      mainRoll,
      secondaryRoll: null,
      rolls: mainChatRolls.rolls,
      evaluacion,
      preparationBonus
    };
  }

  const totalBase =
    mtrolCalcularTotalBaseSinCriticos(mainRoll);

  const primaryRollEffects =
    resolveGameplayRollEffects(actor, totalBase, { actionType: "initiative" });

  const totalPrincipal =
    primaryRollEffects.value + evaluacion.totalExtra + preparationBonus;

  const secondaryRoll =
    await new Roll("1d10").evaluate();

  await mtrolMostrarDados(secondaryRoll);

  const secondaryChatRolls =
    await mtrolPrepareChatRolls({
      roll: secondaryRoll,
      label: "Iniciativa secundaria"
    });

  const initiativeBeforeEffects =
    totalPrincipal + Number(secondaryRoll.total ?? 0);

  const initiativeEffects =
    resolveInitiativeEffects(actor, initiativeBeforeEffects);

  const totalFinal = initiativeEffects.value;

  await mtrolCreateRollMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    rolls: [
      ...mainChatRolls.rolls,
      ...secondaryChatRolls.rolls
    ],
    mtrolCard: {
      family: "check",
      state:
        evaluacion.detalles.length > 0
          ? "critical"
          : "normal",
      title: "Iniciativa MtROL",
      categoryLabel: "Iniciativa",
      formula: "1D10 + DESTREZA + 1D10",
      total: totalFinal,
      preparation: preparationBonus,
      icon: actor.img ?? ""
    },
    content: `
      <div class="mtrol-chat-card mtrol-chat-success">
        <h2>⚡ Iniciativa MtRol</h2>

        <p>
          Dado principal:
          <strong>1D10 + DESTREZA</strong>
        </p>

        <p>
          Resultado principal:
          <strong>${totalPrincipal}</strong>
        </p>

        ${mainChatRolls.html}

        ${
          evaluacion.detalles.length
            ? `
              <hr>
              <div class="mtrol-details">
                ${evaluacion.detalles.join("<br>")}
              </div>
            `
            : ""
        }

        ${preparationBonus > 0
          ? `<p>Preparación: <strong>+${preparationBonus}</strong></p>`
          : ""}

        <p>
          Dado secundario plano:
          <strong>${secondaryRoll.total}</strong>
        </p>

        ${secondaryChatRolls.html}

        <hr>

        <p>
          Total de iniciativa:
          <strong>${totalFinal}</strong>
        </p>
      </div>
    `
  });

  return {
    pifia: false,
    total: totalFinal,
    mainRoll,
    secondaryRoll,
    rolls: [
      ...mainChatRolls.rolls,
      ...secondaryChatRolls.rolls
    ],
    evaluacion,
    preparationBonus,
    primaryRollEffects,
    initiativeEffects
  };
}
