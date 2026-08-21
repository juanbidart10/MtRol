import test from "node:test";
import assert from "node:assert/strict";

const {
  applyOrbDamagePassives,
  resolveOrbRollPassiveBonus
} = await import("../scripts/progression/orb-passive-effects.js");

function actor(...types) {
  return {
    system: {
      orbs: types.map((type, index) => ({ id: `${type}-${index}`, type, level: index % 2 ? 5 : 1 }))
    }
  };
}

function item(system = {}) {
  return { type: "competencia", system };
}

test("Aeris suma +5 exclusivamente a la Esquiva canónica", () => {
  assert.equal(resolveOrbRollPassiveBonus(actor("aeris"), item({ actionType: "defense", defenseType: "dodge" })).bonus, 5);
  assert.equal(resolveOrbRollPassiveBonus(actor("aeris"), item({ actionType: "defense", defenseType: "shield" })).bonus, 0);
  assert.equal(resolveOrbRollPassiveBonus(actor("aeris"), item({ actionType: "attack", defenseType: "dodge" })).bonus, 0);
});

test("Mentem y Gravitae usan categoría hechizo y tags canónicos", () => {
  const both = resolveOrbRollPassiveBonus(
    actor("mentem", "gravitae"),
    item({ categoria: "hechizo", spellTags: ["sensory", "destructive"] })
  );
  assert.equal(both.bonus, 10);
  assert.deepEqual(both.sources.map(source => source.orbType), ["mentem", "gravitae"]);
  assert.equal(resolveOrbRollPassiveBonus(actor("mentem"), item({ categoria: "hechizo", spellTags: [] })).bonus, 0);
  assert.equal(resolveOrbRollPassiveBonus(actor("gravitae"), item({ categoria: "competencia", spellTags: ["destructive"] })).bonus, 0);
});

test("pasivas de tirada son iguales en nivel 1 y 5 y no se duplican", () => {
  const dodge = item({ actionType: "defense", defenseType: "dodge" });
  assert.equal(resolveOrbRollPassiveBonus(actor("aeris"), dodge).bonus, 5);
  assert.equal(resolveOrbRollPassiveBonus({ system: { orbs: [
    { id: "a", type: "aeris", level: 1 },
    { id: "b", type: "aeris", level: 5 }
  ] } }, dodge).bonus, 5);
});

test("Ignis aplica floor sólo a fuego y Oscuritae a todo daño saliente", () => {
  assert.equal(applyOrbDamagePassives({
    damage: 21,
    sourceActor: actor("ignis"),
    sourceItem: item({ damageElement: "fire", damageType: "magical" })
  }).damage, 22);
  assert.equal(applyOrbDamagePassives({
    damage: 21,
    sourceActor: actor("ignis"),
    sourceItem: item({ damageElement: null, damageType: "magical" })
  }).damage, 21);
  assert.equal(applyOrbDamagePassives({ damage: 21, sourceActor: actor("oscuritae"), sourceItem: item() }).damage, 22);
});

test("Corpus reduce sólo daño físico e Imagem resta 5 sólo al mágico", () => {
  assert.equal(applyOrbDamagePassives({ damage: 21, targetActor: actor("corpus"), sourceItem: item({ damageType: "physical" }) }).damage, 19);
  assert.equal(applyOrbDamagePassives({ damage: 21, targetActor: actor("corpus"), sourceItem: item({ damageType: "magical" }) }).damage, 21);
  assert.equal(applyOrbDamagePassives({ damage: 24, targetActor: actor("imagem"), sourceItem: item({ damageType: "magical" }) }).damage, 19);
  assert.equal(applyOrbDamagePassives({ damage: 3, targetActor: actor("imagem"), sourceItem: item({ damageType: "magical" }) }).damage, 0);
  assert.equal(applyOrbDamagePassives({ damage: 24, targetActor: actor("imagem"), sourceItem: item({ damageType: "physical" }) }).damage, 24);
});

test("stacking compatible es secuencial, trazable y sin Orbe no modifica", () => {
  const result = applyOrbDamagePassives({
    damage: 100,
    sourceActor: actor("ignis", "oscuritae"),
    targetActor: actor("imagem"),
    sourceItem: item({ damageType: "magical", damageElement: "fire" })
  });
  assert.equal(result.damage, 105);
  assert.deepEqual(result.sources.map(source => source.orbType), ["ignis", "oscuritae", "imagem"]);
  assert.deepEqual(result.sources.map(source => [source.before, source.after]), [[100, 105], [105, 110], [110, 105]]);
  assert.deepEqual(applyOrbDamagePassives({ damage: 17, sourceActor: actor(), targetActor: actor(), sourceItem: item() }), {
    damage: 17,
    sources: []
  });
});
