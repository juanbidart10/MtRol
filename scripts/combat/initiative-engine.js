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

export async function rollMtrolInitiative(actor) {
  if (!actor) {
    ui.notifications.warn("MtRol | No hay actor para iniciativa.");
    return null;
  }

  const data =
    actor.getRollData ? actor.getRollData() : {};

  data.atributos =
    actor.system?.atributos ?? {};

  const mainRoll =
    await new Roll(
      "1d10 + @atributos.destreza",
      data
    ).evaluate();

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
      content: `
        <div class="mtrol-chat-card mtrol-chat-pifia">
          <h2>💀 PIFIA DE INICIATIVA 💀</h2>
          <p>${evaluacion.motivo}</p>
          ${mainChatRolls.html}
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
      evaluacion
    };
  }

  const totalBase =
    mtrolCalcularTotalBaseSinCriticos(mainRoll);

  const totalPrincipal =
    totalBase + evaluacion.totalExtra;

  const secondaryRoll =
    await new Roll("1d10").evaluate();

  await mtrolMostrarDados(secondaryRoll);

  const secondaryChatRolls =
    await mtrolPrepareChatRolls({
      roll: secondaryRoll,
      label: "Iniciativa secundaria"
    });

  const totalFinal =
    totalPrincipal + Number(secondaryRoll.total ?? 0);

  await mtrolCreateRollMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    rolls: [
      ...mainChatRolls.rolls,
      ...secondaryChatRolls.rolls
    ],
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
    evaluacion
  };
}
