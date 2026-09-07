import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const {
  MTROL_RACE_IDS,
  getAllRaceDefinitions,
  getRaceDefinition,
  validateRaceCatalog
} = await import("../scripts/races/race-catalog.js");

const {
  MTROL_RACIAL_PASSIVE_IDS,
  getAllRacialPassiveDefinitions,
  getRacialPassiveDefinition
} = await import("../scripts/races/racial-passive-catalog.js");

const EXPECTED_RACES = Object.freeze({
  humano: [1, { voluntad: 1, carisma: 1 }, "prodigio"],
  elfo: [1, { inteligencia: 1, percepcion: 1 }, "comunicacion_animal"],
  elfo_oscuro: [1, { destreza: 1, percepcion: 1 }, "maldito_alimentacion"],
  enano: [1, { fuerza: 1, resistencia: 1 }, "inquebrantable"],
  orco: [2, { resistencia: 1, fuerza: 2 }, "sed_de_batalla"],
  gnomo: [2, { aura: 1, percepcion: 1, inteligencia: 1 }, "elemental"],
  sellado: [2, { percepcion: 1, voluntad: 1, carisma: 1 }, "anima"],
  draconiano: [2, { voluntad: 1, destreza: 1, aura: 1 }, "frenesi"],
  animalium: [3, { percepcion: 1, fuerza: 2, destreza: 1 }, "instinto_racial"],
  hada: [3, { aura: 1, destreza: 1, carisma: 1, percepcion: 1 }, "virtus"],
  maldito: [3, { percepcion: 1, inteligencia: 2, carisma: 1 }, "maldicion"],
  bendito: [3, { voluntad: 1, carisma: 1, aura: 2 }, "bendicion"],
  espectral: [3, { voluntad: 1, carisma: 1, inteligencia: 1, aura: 1 }, "trascendental"],
  oscuro: [4, { fuerza: 1, aura: 1, inteligencia: 1, resistencia: 1, destreza: 1 }, "subyugador"],
  iluminado: [4, { fuerza: 1, aura: 1, inteligencia: 1, resistencia: 1, voluntad: 1 }, "celestial"],
  eterno: [5, { resistencia: 2, inteligencia: 2, voluntad: 2 }, "infinito"]
});

test("RaceCatalog contiene exactamente las 16 Razas, tiers, atributos y pasivas canónicas", () => {
  assert.deepEqual(MTROL_RACE_IDS, Object.keys(EXPECTED_RACES));
  assert.equal(new Set(MTROL_RACE_IDS).size, 16);
  assert.deepEqual(validateRaceCatalog(), { valid: true, errors: [] });
  for (const [raceId, [unlockLevel, bonuses, basePassiveId]] of Object.entries(EXPECTED_RACES)) {
    const definition = getRaceDefinition(raceId);
    assert.equal(definition.unlockLevel, unlockLevel, raceId);
    assert.deepEqual(definition.creationAttributeBonuses, bonuses, raceId);
    assert.equal(definition.basePassiveId, basePassiveId, raceId);
    assert.ok(Object.isFrozen(definition));
    assert.ok(Object.isFrozen(definition.creationAttributeBonuses));
  }
  const idsAtTier = tier => getAllRaceDefinitions()
    .filter(entry => entry.unlockLevel === tier)
    .map(entry => entry.technicalId);
  assert.deepEqual(idsAtTier(1), ["humano", "elfo", "elfo_oscuro", "enano"]);
  assert.deepEqual(idsAtTier(2), ["orco", "gnomo", "sellado", "draconiano"]);
  assert.deepEqual(idsAtTier(3), ["animalium", "hada", "maldito", "bendito", "espectral"]);
  assert.deepEqual(idsAtTier(4), ["oscuro", "iluminado"]);
  assert.deepEqual(idsAtTier(5), ["eterno"]);
});

test("PassiveCatalog contiene 16 identidades únicas y una definición declarativa por Raza", () => {
  const passives = getAllRacialPassiveDefinitions();
  assert.equal(passives.length, 16);
  assert.equal(new Set(MTROL_RACIAL_PASSIVE_IDS).size, 16);
  for (const race of getAllRaceDefinitions()) {
    const passive = getRacialPassiveDefinition(race.basePassiveId);
    assert.ok(passive, race.technicalId);
    assert.equal(passive.sourceRaceId, race.technicalId);
    assert.equal(passive.unlockLevel, race.unlockLevel);
    assert.ok(passive.effects.length >= 1);
    assert.ok(Object.isFrozen(passive.effects));
  }
  assert.equal(getRacialPassiveDefinition("instinto_racial").effects.length, 2);
  assert.equal(getRacialPassiveDefinition("virtus").effects.length, 2);
  assert.equal(getRacialPassiveDefinition("trascendental").effects.length, 4);
  assert.equal(getRacialPassiveDefinition("infinito").effects[1].value, 10);
  assert.notEqual(getRaceDefinition("elfo_oscuro").basePassiveId, "maldito");
});

test("renombrar displayName no altera identidad ni resolución de pasiva", () => {
  const renamed = { ...getRaceDefinition("gnomo"), displayName: "Gnomo Arcano" };
  assert.equal(renamed.technicalId, "gnomo");
  assert.equal(getRacialPassiveDefinition(renamed.basePassiveId).technicalId, "elemental");
});

test("los engines no conocen Razas ni passiveIds concretos y progresión/caps siguen desconectados", async () => {
  const paths = [
    "../scripts/actions/action-damage-engine.js",
    "../scripts/actions/opposition-policy.js",
    "../scripts/combat/initiative-engine.js",
    "../scripts/actors/progression-engine.js",
    "../scripts/progression/progression-caps.js"
  ];
  const source = (await Promise.all(paths.map(path => readFile(new URL(path, import.meta.url), "utf8")))).join("\n");
  assert.doesNotMatch(source, /racial-passive-catalog|race-catalog/);
  for (const raceId of MTROL_RACE_IDS) assert.doesNotMatch(source, new RegExp(`raceId\\s*===\\s*["']${raceId}["']`));
});
