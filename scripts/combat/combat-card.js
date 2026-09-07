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

  const targetName =
    targetActor?.name ?? "Sin objetivo";

  const targetTextCombat =
    targetActor
      ? `<strong>${targetName}</strong>`
      : "<strong>Sin objetivo</strong>";

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
  const weaponBreakdown = cardContext.breakdown?.weapons?.items ?? [];
  const modifierBreakdown = cardContext.breakdown?.modifiers ?? [];

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
            <span class="mtrol-combat-label">Da&ntilde;o inicial</span>
            <strong>${finalDanio}</strong>
          </p>

          ${weaponBreakdown.length ? `<div class="mtrol-details"><strong>@armas:</strong><br>${weaponBreakdown
            .map(entry => `${foundry.utils.escapeHTML(entry.name)} +${entry.damage}`)
            .join("<br>")}<br>Total @armas: <strong>${cardContext.breakdown.weapons.total}</strong></div>` : ""}

          ${modifierBreakdown.length ? `<div class="mtrol-details"><strong>Modifiers:</strong><br>${modifierBreakdown
            .map(entry => `${foundry.utils.escapeHTML(entry.label)} ${entry.value >= 0 ? "+" : ""}${entry.value}`)
            .join("<br>")}</div>` : ""}

          <hr>

          <p>
            <span class="mtrol-combat-label">MP consumido</span>
            <strong>${costoTotal ?? 0}</strong>
          </p>

        </div>
      </div>
    `
  });
}
