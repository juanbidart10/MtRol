// =========================
// MTROL - DHARMA / KARMA
// =========================
// Sistema centralizado.
// No usa hooks automáticos para evitar duplicados.
// Las tiradas deben llamar manualmente a mtrolAplicarDharmaKarma().
// =========================

import { buildMtrolDestinyCardContent } from "../ui/destiny-chat-card.js";
import { runActorResourceTransaction } from "../actors/actor-resource-service.js";
import { requestPrimaryGM } from "../core/socket-requests.js";
import { logger } from "../utils/logger.js";

export function registerDharmaKarmaHooks() {
  logger.debug("DESTINY", "automatic Dharma/Karma hooks disabled", {
    status: "manual",
    reasonCode: "DESTINY_MANUAL_MODE"
  });
}

export async function mtrolAplicarDharmaKarma(
  actor,
  cantidadDharma = 0,
  cantidadKarma = 0,
  { transactionId = `destiny:${globalThis.foundry?.utils?.randomID?.() ?? crypto.randomUUID()}` } = {}
) {
  if (!actor) return;
  if (!game.user.isGM && !actor.isOwner) return;
  if (cantidadDharma <= 0 && cantidadKarma <= 0) return;

  if (!game.user?.isGM && game.users) {
    const response = await requestPrimaryGM("mtrolAdjustDestiny", {
      actorUuid: actor.uuid,
      transactionId,
      cantidadDharma,
      cantidadKarma
    });
    if (!response.ok || response.result?.commandResult?.ok === false) {
      throw new Error(response.error ?? response.result?.commandResult?.humanReason ?? "No se pudo actualizar Karma/Dharma.");
    }
    return response.result?.receipt ?? null;
  }

  return runActorResourceTransaction(actor, {
    transactionId,
    origin: "destiny-adjust",
    allowOwnerCompatibility: true,
    tracksWrites: true
  }, async (canonicalActor, { beforeWrite }) => {
  await beforeWrite();
  let dharmaActual =
    Number(canonicalActor.system.recursos?.dharma ?? 0);

  let karmaActual =
    Number(canonicalActor.system.recursos?.karma ?? 0);

  for (let i = 0; i < cantidadDharma; i++) {
    dharmaActual++;

    if (dharmaActual >= 5) {
      ui.notifications.info(`${canonicalActor.name} obtuvo una Carta de Dharma`);

      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: canonicalActor }),
        content: buildMtrolDestinyCardContent({
          type: "dharma",
          actorName: canonicalActor.name
        })
      });

      dharmaActual = 0;
    }
  }

  for (let i = 0; i < cantidadKarma; i++) {
    karmaActual++;

    if (karmaActual >= 5) {
      ui.notifications.info(`${canonicalActor.name} obtuvo una Carta de Karma`);

      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: canonicalActor }),
        content: buildMtrolDestinyCardContent({
          type: "karma",
          actorName: canonicalActor.name
        })
      });

      karmaActual = 0;
    }
  }

  await beforeWrite();

  await canonicalActor.update({
    "system.recursos.dharma": dharmaActual,
    "system.recursos.karma": karmaActual
  });
  return {
    authorized: true,
    dharmaAdded: Number(cantidadDharma),
    karmaAdded: Number(cantidadKarma),
    dharmaAfter: dharmaActual,
    karmaAfter: karmaActual
  };
  });
}
