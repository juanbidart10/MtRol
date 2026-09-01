import test from "node:test";
import assert from "node:assert/strict";

const {
  getActionCooldownStatus,
  markActionCooldownUsed
} = await import("../scripts/actions/action-cooldown-service.js");

test("cooldown service calcula elegibilidad sin mutar el Item", () => {
  let reads = 0;
  const item = {
    system: { cooldown: 2 },
    getFlag() {
      reads += 1;
      return { combatId: "combat", usedAtRound: 3, cooldownRounds: 2 };
    }
  };
  const status = getActionCooldownStatus(item, { combatId: "combat", round: 4 });
  assert.equal(reads, 1);
  assert.equal(status.available, false);
  assert.equal(status.availableAtRound, 6);
  assert.equal(status.roundsRemaining, 2);
});

test("marcar cooldown persiste una sola escritura con el schema vigente", async () => {
  const writes = [];
  const item = {
    system: { cooldown: 3 },
    async setFlag(scope, key, value) { writes.push({ scope, key, value }); }
  };
  const result = await markActionCooldownUsed(item, {
    combat: { id: "combat" },
    combatId: "combat",
    round: 7
  });
  assert.equal(result.changed, true);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].value, {
    combatId: "combat",
    usedAtRound: 7,
    cooldownRounds: 3
  });
});

test("sin combate o cooldown no se escribe persistencia", async () => {
  let writes = 0;
  const item = { system: { cooldown: 0 }, async setFlag() { writes += 1; } };
  assert.equal((await markActionCooldownUsed(item, { combat: null })).changed, false);
  assert.equal(writes, 0);
});

test("turn-system conserva getItemCooldownStatus como API compatible", async () => {
  globalThis.game ??= { users: new Map(), combats: new Map(), actors: new Map(), combat: null };
  globalThis.Hooks ??= { on() {}, callAll() {} };
  globalThis.foundry ??= { utils: { deepClone: structuredClone, randomID: () => "id" } };
  const turns = await import("../scripts/combat/turn-system.js");
  assert.equal(
    turns.getItemCooldownStatus({ system: { cooldown: 0 } }, { combatId: null, round: 0 }).available,
    true
  );
});

