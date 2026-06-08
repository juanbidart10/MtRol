// =========================
// MTROL - DHARMA / KARMA
// =========================
// Sistema centralizado.
// No usa hooks automáticos para evitar duplicados.
// Las tiradas deben llamar manualmente a mtrolAplicarDharmaKarma().
// =========================

export function registerDharmaKarmaHooks() {
  console.log("MtRol | Dharma/Karma hooks desactivados. Sistema manual activo.");
}

export async function mtrolAplicarDharmaKarma(actor, cantidadDharma = 0, cantidadKarma = 0) {
  if (!actor) return;
  if (!game.user.isGM && !actor.isOwner) return;
  if (cantidadDharma <= 0 && cantidadKarma <= 0) return;

  let dharmaActual =
    Number(actor.system.recursos?.dharma ?? 0);

  let karmaActual =
    Number(actor.system.recursos?.karma ?? 0);

  for (let i = 0; i < cantidadDharma; i++) {
    dharmaActual++;

    if (dharmaActual >= 5) {
      ui.notifications.info(`🏆 ${actor.name} obtuvo una Carta de Dharma`);

      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `
          <div style="text-align:center; font-size:18px; padding:10px;">
            🏆 <strong>Carta de Dharma</strong> 🏆
            <br><br>
            ${actor.name} alcanzó 5 puntos de Dharma.
            <br>
            Sus puntos de Dharma se reinician.
          </div>
        `
      });

      dharmaActual = 0;
    }
  }

  for (let i = 0; i < cantidadKarma; i++) {
    karmaActual++;

    if (karmaActual >= 5) {
      ui.notifications.info(`💀 ${actor.name} obtuvo una Carta de Karma`);

      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `
          <div style="text-align:center; font-size:18px; padding:10px;">
            💀 <strong>Carta de Karma</strong> 💀
            <br><br>
            ${actor.name} alcanzó 5 puntos de Karma.
            <br>
            Sus puntos de Karma se reinician.
          </div>
        `
      });

      karmaActual = 0;
    }
  }

  await actor.update({
    "system.recursos.dharma": dharmaActual,
    "system.recursos.karma": karmaActual
  });
}