import { rollMtrolInitiative } from "./initiative-engine.js";

// Registration bookkeeping only: weak keys are Combat prototypes, never gameplay
// state. Lifetime: this module/client session. F5 rebuilds it during setup.
const installedPrototypes = new WeakSet();

/**
 * Existing v14 compatibility override, deliberately not a new initiative engine.
 * Keep roll/preparation/Karma/Dharma/chat timing and the legacy turn:0 reset.
 * Stock formula/updateTurn options are not an equivalent replacement; see the
 * Phase 6 socket/initiative report before changing this public method contract.
 */
export function installMtrolInitiativeAdapter(
  Combat = globalThis.Combat,
  rollInitiative = rollMtrolInitiative
) {
  if (installedPrototypes.has(Combat.prototype)) return false;

  Combat.prototype.rollInitiative = async function (ids, options = {}) {
    ids = typeof ids === "string" ? [ids] : ids;
    if (!Array.isArray(ids)) {
      ids = this.combatants.filter(c => c.isOwner).map(c => c.id);
    }

    const updates = [];
    for (const id of ids) {
      const combatant = this.combatants.get(id);
      if (!combatant) continue;
      const actor = combatant.actor;
      if (!actor) continue;
      const resultado = await rollInitiative(actor);
      if (!resultado) continue;
      updates.push({ _id: combatant.id, initiative: resultado.total });
    }

    if (updates.length) {
      await this.updateEmbeddedDocuments("Combatant", updates);
    }
    await this.update({ turn: 0 });
    return this;
  };

  installedPrototypes.add(Combat.prototype);
  return true;
}
