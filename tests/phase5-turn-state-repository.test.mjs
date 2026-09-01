import test from "node:test";
import assert from "node:assert/strict";

const {
  readCombatantFlag,
  readTurnState,
  writeCombatantFlag,
  writeTurnState
} = await import("../scripts/combat/turn-state-repository.js");

function combatantFixture() {
  const flags = { mtrol: {} };
  return {
    flags,
    getFlag(scope, key) { return flags[scope]?.[key]; },
    async setFlag(scope, key, value) {
      flags[scope] ??= {};
      flags[scope][key] = structuredClone(value);
      return value;
    }
  };
}

test("repository encapsula flags MTROL sin reglas de gameplay", async () => {
  const combatant = combatantFixture();
  await writeCombatantFlag(combatant, "custom", { value: 3 });
  assert.deepEqual(readCombatantFlag(combatant, "custom"), { value: 3 });
});

test("repository normaliza turnState al escribir y leer", async () => {
  const combatant = combatantFixture();
  const state = await writeTurnState(combatant, {
    combatId: "combat",
    round: 2,
    turn: 1,
    baseMovementRemaining: -4,
    extraMovementRemaining: 3,
    actionConsumed: true
  });
  assert.equal(state.baseMovementRemaining, 0);
  assert.equal(state.extraMovementRemaining, 3);
  assert.equal(state.actionConsumed, true);
  assert.deepEqual(readTurnState(combatant), state);
});

test("repository rechaza persistencia sin Document Combatant", async () => {
  await assert.rejects(() => writeCombatantFlag(null, "turnState", {}), /Combatant inválido/);
});

