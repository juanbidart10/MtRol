// =========================
// MTROL - COMBAT CARD UI
// =========================

import {
  mtrolCreateRollMessage,
  mtrolPrepareChatRolls
} from "../rolls/chat-rolls.js";
import { logger } from "../utils/logger.js";

export async function crearCombatCard({
  actor,
  targetActor = null,
  damageRoll,
  resultadoDanio,
  costoTotal = 0,
  evaluacionDanio = null,
  totalBaseDanio = null,
  totalFinalDanio = null,
  cardContext = {}
} = {}) {
  if (!actor) {
    logger.warn("CHAT_CARD", "combat card creation skipped", {
      command: "combat-card.create",
      status: "rejected",
      reasonCode: "COMBAT_CARD_ACTOR_MISSING"
    });
    return;
  }

  if (!damageRoll || !resultadoDanio) {
    logger.warn("CHAT_CARD", "combat card creation skipped", {
      command: "combat-card.create",
      actorUuid: actor.uuid ?? null,
      status: "rejected",
      reasonCode: "COMBAT_CARD_DAMAGE_DATA_MISSING"
    });
    return;
  }

  const damageChatRolls =
    await mtrolPrepareChatRolls([
      {
        roll: damageRoll,
        label: "Tirada de Daño"
      },
      ...(evaluacionDanio?.extraRolls ?? []).map((extraRoll, index) => ({
        roll: extraRoll,
        label: `Cadena crítica de daño ${index + 1}`
      }))
    ]);

  const localizationChatRolls =
    await mtrolPrepareChatRolls(
      resultadoDanio.localizacionRoll
        ? {
            roll: resultadoDanio.localizacionRoll,
            label: "Tirada de Localización"
          }
        : []
    );

  const objetivoMuerto =
    Number(resultadoDanio.hpNuevo ?? 1) <= 0;

  const aplicacionManual =
    resultadoDanio.aplicacion === "manual_sin_gm";

  const armaduraDestruida =
    Boolean(resultadoDanio.itemDestruido);

  const targetName =
    targetActor?.name ?? "Sin objetivo";

  const targetTextCombat =
    targetActor
      ? `<strong>${targetName}</strong>`
      : "<strong>Sin objetivo</strong>";

  const itemName =
    resultadoDanio.item ?? "Sin armadura";

  const detallesCritico =
    Array.isArray(evaluacionDanio?.detalles)
      ? evaluacionDanio.detalles
      : [];

  const hayCritico =
    detallesCritico.length > 0;

  const baseDanio =
    totalBaseDanio ?? damageRoll.total ?? 0;

  const extraCritico =
    Number(evaluacionDanio?.totalExtra ?? 0);

  const finalDanio =
    totalFinalDanio ??
    resultadoDanio.danioOriginal ??
    damageRoll.total ??
    0;

  await mtrolCreateRollMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    rolls: [
      ...damageChatRolls.rolls,
      ...localizationChatRolls.rolls
    ],
    mtrolCard: {
      ...cardContext,
      family: "damage",
      state:
        hayCritico
          ? "critical"
          : "normal",
      title: cardContext.title ?? "Resultado de Combate",
      categoryLabel: "Daño localizado",
      formula: damageRoll.formula ?? "",
      total: finalDanio,
      icon: cardContext.icon ?? actor.img ?? ""
    },
    content: `
      <div class="mtrol-combat-card">
        <div class="mtrol-combat-header">
          <div class="mtrol-combat-title">
            Resultado de Combate
          </div>

          <div class="mtrol-combat-subheader">
            <strong>${actor.name}</strong>
            &rarr;
            ${targetTextCombat}
          </div>
        </div>

        <hr>

        <div class="mtrol-combat-section">
          <div class="mtrol-roll-block">
            ${damageChatRolls.html}
          </div>

          <p>
            <span class="mtrol-combat-label">Da&ntilde;o base</span>
            <strong>${baseDanio}</strong>
          </p>

          ${
            hayCritico
              ? `
                <div class="mtrol-combat-crit-block">
                  <p>
                    <strong>Cadena de cr&iacute;tico</strong>
                  </p>

                  <div class="mtrol-details">
                    ${detallesCritico.join("<br>")}
                  </div>

                  <p>
                    <span class="mtrol-combat-label">Extra cr&iacute;tico</span>
                    <strong>${extraCritico}</strong>
                  </p>

                  <p>
                    <span class="mtrol-combat-label">Da&ntilde;o final con cr&iacute;tico</span>
                    <strong>${finalDanio}</strong>
                  </p>
                </div>

                <hr>
              `
              : ""
          }

          ${
            localizationChatRolls.html
              ? `
                <div class="mtrol-roll-block">
                  ${localizationChatRolls.html}
                </div>
              `
              : ""
          }

          <p>
            <span class="mtrol-combat-label">Dado de localizaci&oacute;n</span>
            <strong>D10 = ${resultadoDanio.numeroLocalizacion ?? "-"}</strong>
          </p>

          <p>
            <span class="mtrol-combat-label">Zona impactada</span>
            <strong>${resultadoDanio.zona ?? "No determinada"}</strong>
          </p>

          <p>
            <span class="mtrol-combat-label">Da&ntilde;o aplicado</span>
            <strong>${resultadoDanio.danioOriginal ?? 0}</strong>
          </p>

          <p>
            <span class="mtrol-combat-label">Armadura</span>
            <strong>${itemName}</strong>
          </p>

          <p>
            <span class="mtrol-combat-label">Defensa</span>
            <strong>${resultadoDanio.defensaInicial ?? 0}</strong>
            &rarr;
            <strong>${resultadoDanio.defensaFinal ?? 0}</strong>
          </p>

          <p>
            <span class="mtrol-combat-label">Da&ntilde;o absorbido</span>
            <strong>${resultadoDanio.danioAbsorbido ?? 0}</strong>
          </p>

          <p>
            <span class="mtrol-combat-label">HP perdido</span>
            <strong>${resultadoDanio.hpPerdido ?? 0}</strong>
          </p>

          <hr>

          <p>
            <span class="mtrol-combat-label">MP consumido</span>
            <strong>${costoTotal ?? 0}</strong>
          </p>

          ${
            aplicacionManual
              ? `
                <div class="mtrol-combat-alert">
                  No hay GM conectado para aplicar automáticamente el daño. Aplicar manualmente.
                </div>
              `
              : ""
          }

          ${
            armaduraDestruida
              ? `
                <div class="mtrol-combat-alert destroy">
                  ${itemName} fue destruido
                </div>
              `
              : ""
          }

          ${
            objetivoMuerto && targetActor
              ? `
                <div class="mtrol-combat-alert death">
                  ${targetName} ha muerto
                </div>
              `
              : ""
          }
        </div>
      </div>
    `
  });
}
