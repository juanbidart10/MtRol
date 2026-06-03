// =========================
// MTROL - HOOKS
// =========================

import {
  rollMtrolInitiative
} from "../combat/initiative-engine.js";

import {
  registrarHooksPesoMtrol
} from "./mtrol-carry-weight.js";

export function registerHooks() {

  console.log("=================================");
  console.log("MTROL | HOOKS");
  console.log("=================================");

  registrarHooksPesoMtrol();

  // =========================
  // CHAT RENDER V14
  // =========================

  Hooks.on("renderChatMessageHTML", () => {
    // Placeholder futuro para chat cards premium.
  });

  // =========================
  // UPDATE ACTOR
  // =========================

  Hooks.on("updateActor", () => {
    // Runtime hooks futuros.
  });

  // =========================
  // MTROL - OVERRIDE INICIATIVA
  // =========================

  const originalRollInitiative =
    Combat.prototype.rollInitiative;

  Combat.prototype.rollInitiative = async function (
    ids,
    options = {}
  ) {
    ids = typeof ids === "string" ? [ids] : ids;

    if (!Array.isArray(ids)) {
      ids = this.combatants
        .filter(c => c.isOwner)
        .map(c => c.id);
    }

    const updates = [];

    for (const id of ids) {
      const combatant =
        this.combatants.get(id);

      if (!combatant) continue;

      const actor =
        combatant.actor;

      if (!actor) continue;

      const resultado =
        await rollMtrolInitiative(actor);

      if (!resultado) continue;

      updates.push({
        _id: combatant.id,
        initiative: resultado.total
      });
    }

    if (updates.length) {
      await this.updateEmbeddedDocuments(
        "Combatant",
        updates
      );
    }

    await this.update({
      turn: 0
    });

    return this;
  };

  console.log("MTROL | Iniciativa MtRol registrada.");
  console.log("MTROL | Hooks registrados.");

}
