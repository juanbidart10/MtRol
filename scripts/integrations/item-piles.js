import { logger } from "../utils/logger.js";

export function registerItemPilesHooks() {
  Hooks.on("updateActor", async (actor, changes) => {
    try {
      if (!game.user.isGM) return;

    const cambioItemPiles =
      changes?.flags?.["item-piles"] ||
      changes?.flags?.itempiles;

    if (!cambioItemPiles) return;

    const actorEsBotin =
      actor.flags?.["item-piles"] ||
      actor.flags?.itempiles;

    if (!actorEsBotin) return;

    const competencias = actor.items.filter(item =>
      item.type === "competencia"
    );

    if (!competencias.length) return;

    await actor.deleteEmbeddedDocuments(
      "Item",
      competencias.map(item => item.id)
    );

      logger.info("ITEM_PILES", "loot actor sanitized", {
        actorUuid: actor.uuid ?? null,
        removedCount: competencias.length,
        status: "completed",
        reasonCode: "LOOT_COMPETENCIAS_REMOVED"
      });
    } catch (error) {
      logger.error("ITEM_PILES", "loot actor sanitization failed", {
        actorUuid: actor?.uuid ?? null,
        status: "failed",
        reasonCode: "LOOT_SANITIZATION_FAILED",
        error
      });
    }
  });
}
