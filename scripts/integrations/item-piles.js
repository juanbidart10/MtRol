export function registerItemPilesHooks() {
  Hooks.on("updateActor", async (actor, changes) => {
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

    console.log(
      `MtRol | ${competencias.length} competencias eliminadas del botín ${actor.name}.`
    );
  });
}