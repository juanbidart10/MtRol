import test from "node:test";
import assert from "node:assert/strict";

import {
  getOrbLevelRollBonus,
  resolveSpellOrbRollBonus
} from "../scripts/progression/orb-roll-bonus.js";

function actor(orbs) {
  return { system: { orbs } };
}

function spell(orbType) {
  return {
    type: "competencia",
    system: { categoria: "hechizo", orbType }
  };
}

test("niveles 1–3 dan +0, nivel 4 da +2 y nivel 5 da +5", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(getOrbLevelRollBonus), [0, 0, 0, 2, 5]);
});

test("Ignis V y Aqua IV aplican sólo el Orbe del hechizo", () => {
  const owner = actor([
    { id: "ignis-one", type: "ignis", level: 5 },
    { id: "aqua-one", type: "aqua", level: 4 }
  ]);

  assert.equal(resolveSpellOrbRollBonus(owner, spell("ignis")).bonus, 5);
  assert.equal(resolveSpellOrbRollBonus(owner, spell("aqua")).bonus, 2);
});

test("orbType null, Orbe ausente y Competencia no hechizo dan +0", () => {
  const owner = actor([{ id: "ignis-one", type: "ignis", level: 5 }]);

  assert.equal(resolveSpellOrbRollBonus(owner, spell(null)).bonus, 0);
  assert.equal(resolveSpellOrbRollBonus(owner, spell("aqua")).bonus, 0);
  assert.equal(resolveSpellOrbRollBonus(owner, {
    type: "competencia",
    system: { categoria: "competencia", orbType: "ignis" }
  }).bonus, 0);
});

test("datos legacy duplicados nunca stackean", () => {
  const owner = actor([
    { id: "ignis-one", type: "ignis", level: 5 },
    { id: "ignis-two", type: "ignis", level: 4 },
    { id: "aqua-one", type: "aqua", level: 4 }
  ]);

  assert.equal(resolveSpellOrbRollBonus(owner, spell("ignis")).bonus, 5);
});
