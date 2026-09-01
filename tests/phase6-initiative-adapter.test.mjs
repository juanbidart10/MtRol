import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

globalThis.foundry = { utils: { randomID: () => "id", deepClone: structuredClone } };
const { installMtrolInitiativeAdapter } = await import("../scripts/combat/initiative-foundry-adapter.js");

function fixture(roll = async actor => ({ total: actor.total })) {
  const calls = [];
  const entries = [
    { id: "a", isOwner: true, actor: { id: "aa", total: 12 } },
    { id: "b", isOwner: false, actor: { id: "bb", total: 0 } },
    { id: "c", isOwner: true, actor: null },
    { id: "d", isOwner: true, actor: { id: "dd", total: 24 } }
  ];
  class FakeCombat {
    constructor() {
      this.combatants = entries;
      this.combatants.get = id => entries.find(entry => entry.id === id);
    }
    async rollInitiative() { throw new Error("stock method must not run"); }
    async updateEmbeddedDocuments(...args) { calls.push(["embedded", ...args]); }
    async update(...args) { calls.push(["update", ...args]); }
  }
  installMtrolInitiativeAdapter(FakeCombat, async actor => {
    calls.push(["roll", actor.id]);
    return roll(actor);
  });
  return { FakeCombat, combat: new FakeCombat(), calls };
}

test("initiative adapter preserves string ID, write ordering and Combat result", async () => {
  const { combat, calls } = fixture();
  assert.equal(await combat.rollInitiative("a"), combat);
  assert.deepEqual(calls, [["roll", "aa"], ["embedded", "Combatant", [{ _id: "a", initiative: 12 }]], ["update", { turn: 0 }]]);
});

test("initiative adapter preserves explicit ID order, missing entries and zero fumble", async () => {
  const { combat, calls } = fixture();
  await combat.rollInitiative(["b", "missing", "c", "a"]);
  assert.deepEqual(calls, [["roll", "bb"], ["roll", "aa"], ["embedded", "Combatant", [
    { _id: "b", initiative: 0 }, { _id: "a", initiative: 12 }
  ]], ["update", { turn: 0 }]]);
});

test("initiative adapter defaults to owned combatants only", async () => {
  for (const ids of [undefined, null, {}, 7]) {
    const { combat, calls } = fixture();
    await combat.rollInitiative(ids);
    assert.deepEqual(calls.filter(call => call[0] === "roll"), [["roll", "aa"], ["roll", "dd"]]);
  }
});

test("initiative adapter preserves empty/null result and legacy options semantics", async () => {
  const { combat, calls } = fixture(async () => null);
  await combat.rollInitiative(["a"], { formula: "999", updateTurn: false, messageMode: "blindroll" });
  assert.deepEqual(calls, [["roll", "aa"], ["update", { turn: 0 }]]);
  calls.length = 0;
  await combat.rollInitiative([]);
  assert.deepEqual(calls, [["update", { turn: 0 }]]);
});

test("initiative adapter propagates roll failure without Combat writes", async () => {
  const failure = new Error("roll failed");
  const { combat, calls } = fixture(async () => { throw failure; });
  await assert.rejects(combat.rollInitiative(["a", "d"]), error => error === failure);
  assert.deepEqual(calls, [["roll", "aa"]]);
});

test("initiative adapter does not reset turn after an embedded write failure", async () => {
  const failure = new Error("write failed");
  const { combat, calls } = fixture();
  combat.updateEmbeddedDocuments = async () => { throw failure; };
  await assert.rejects(combat.rollInitiative("a"), error => error === failure);
  assert.deepEqual(calls, [["roll", "aa"]]);
});

test("initiative adapter propagates final turn write failure without retry", async () => {
  const failure = new Error("turn write failed");
  const { combat, calls } = fixture();
  combat.update = async () => { throw failure; };
  await assert.rejects(combat.rollInitiative("a"), error => error === failure);
  assert.equal(calls.filter(call => call[0] === "embedded").length, 1);
});

test("initiative patch installs once and does not overwrite a later module wrapper", async () => {
  const { FakeCombat, combat, calls } = fixture();
  const installed = FakeCombat.prototype.rollInitiative;
  const keys = Reflect.ownKeys(FakeCombat.prototype);
  for (let i = 0; i < 100; i++) {
    assert.equal(installMtrolInitiativeAdapter(FakeCombat, () => { throw new Error("duplicate install"); }), false);
    assert.equal(FakeCombat.prototype.rollInitiative, installed);
  }
  const wrapper = async function (...args) { return installed.apply(this, args); };
  FakeCombat.prototype.rollInitiative = wrapper;
  assert.equal(installMtrolInitiativeAdapter(FakeCombat), false);
  assert.equal(FakeCombat.prototype.rollInitiative, wrapper);
  assert.deepEqual(Reflect.ownKeys(FakeCombat.prototype), keys);
  await combat.rollInitiative("a");
  assert.equal(calls.filter(call => call[0] === "roll").length, 1);
});

test("fresh Combat prototype installs independently without changing other methods", () => {
  class First { rollInitiative() {} nextTurn() {} }
  class Second { rollInitiative() {} nextTurn() {} }
  const firstNext = First.prototype.nextTurn, secondNext = Second.prototype.nextTurn;
  assert.equal(installMtrolInitiativeAdapter(First), true);
  assert.equal(installMtrolInitiativeAdapter(Second), true);
  assert.equal(First.prototype.nextTurn, firstNext);
  assert.equal(Second.prototype.nextTurn, secondNext);
});

test("hook bootstrap delegates initiative; no inline patch or unused original remains", async () => {
  const source = await readFile(new URL("../scripts/core/hooks.js", import.meta.url), "utf8");
  assert.match(source, /installMtrolInitiativeAdapter\(\)/);
  assert.doesNotMatch(source, /Combat\.prototype|originalRollInitiative|rollMtrolInitiative/);
});
