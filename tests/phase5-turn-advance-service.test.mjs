import test from "node:test";
import assert from "node:assert/strict";

globalThis.game = { user: { isGM: true } };

const { advanceTurnOnce, clearTurnAdvanceLocks } = await import("../scripts/combat/turn-advance-service.js");

function fixture({ fail = false } = {}) {
  const flags = { mtrol: {} };
  let advances = 0;
  const combatant = {
    id: "combatant",
    flags,
    getFlag(scope, key) { return flags[scope]?.[key]; },
    async setFlag(scope, key, value) { flags[scope][key] = structuredClone(value); }
  };
  const combat = {
    async nextTurn() {
      advances += 1;
      if (fail) throw new Error("advance failed");
    }
  };
  return {
    context: { combatId: "combat", round: 2, turn: 1, combatant, combat },
    get advances() { return advances; },
    flags
  };
}

test("advance service ejecuta nextTurn una vez y replay usa receipt persistido", async () => {
  clearTurnAdvanceLocks();
  const data = fixture();
  const first = await advanceTurnOnce(data.context, { completionId: "action" });
  const replay = await advanceTurnOnce(data.context, { completionId: "action" });
  assert.equal(first.advanced, true);
  assert.equal(replay.duplicate, true);
  assert.equal(data.advances, 1);
  assert.equal(data.flags.mtrol.turnAdvance.status, "complete");
});

test("fallo de nextTurn limpia receipt para permitir recovery seguro", async () => {
  clearTurnAdvanceLocks();
  const data = fixture({ fail: true });
  await assert.rejects(() => advanceTurnOnce(data.context), /advance failed/);
  assert.equal(data.flags.mtrol.turnAdvance, null);
  assert.equal(data.advances, 1);
});

test("advance service exige autoridad GM", async () => {
  const data = fixture();
  game.user.isGM = false;
  await assert.rejects(() => advanceTurnOnce(data.context), /autoridad GM/);
  game.user.isGM = true;
  assert.equal(data.advances, 0);
});

