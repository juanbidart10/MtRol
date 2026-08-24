import test from "node:test";
import assert from "node:assert/strict";

import {
  MTROL_PROGRESSION_ATTRIBUTE_KEYS,
  evaluateProgression,
  getRequirementsForLevel,
  isEligibleForNextLevel
} from "../scripts/actors/progression-engine.js";

const ATTRIBUTE_KEYS = [
  "resistencia",
  "carisma",
  "fuerza",
  "inteligencia",
  "voluntad",
  "aura",
  "percepcion",
  "destreza",
  "suerte"
];

function makeActor({
  level = 1,
  exp = 0,
  mvp = 0,
  missions = 0,
  dungeons = 0,
  merit = 0,
  enemy = false,
  approval = false,
  attributesAtFive = 0,
  competenceLevels = [],
  extraItems = []
} = {}) {
  return {
    system: {
      recursos: { nivel: level, exp, mvp },
      progression: {
        missionsCompleted: missions,
        dungeonsCompleted: dungeons,
        meritCredits: merit,
        defeatedLevel5Enemy: enemy,
        dmApproval: approval
      },
      atributos: Object.fromEntries(
        ATTRIBUTE_KEYS.map((key, index) => [key, index < attributesAtFive ? 5 : 4])
      )
    },
    items: [
      ...competenceLevels.map((nivel, index) => ({
        id: `competencia-${index}`,
        type: "competencia",
        system: { nivel, categoria: "competencia", tipo: "" }
      })),
      ...extraItems
    ]
  };
}

test("el registro usa exactamente los nueve atributos reales", () => {
  assert.deepEqual([...MTROL_PROGRESSION_ATTRIBUTE_KEYS], ATTRIBUTE_KEYS);
});

test("Nivel 1→2 completo e incompleto", () => {
  const complete = makeActor({ exp: 1000, mvp: 1, missions: 1, competenceLevels: [3] });
  const incomplete = makeActor({ exp: 999, mvp: 1, missions: 1, competenceLevels: [3] });

  assert.equal(isEligibleForNextLevel(complete), true);
  assert.equal(evaluateProgression(incomplete).eligible, false);
});

test("Nivel 2→3 completo e incompleto", () => {
  const complete = makeActor({
    level: 2,
    exp: 15000,
    mvp: 20,
    dungeons: 1,
    merit: 5,
    attributesAtFive: 2,
    competenceLevels: [5, 5]
  });
  const incomplete = structuredClone(complete);
  incomplete.system.progression.meritCredits = 4;

  assert.equal(evaluateProgression(complete).eligible, true);
  assert.equal(evaluateProgression(incomplete).eligible, false);
});

test("Nivel 3→4 exige aprobación DM", () => {
  const actor = makeActor({
    level: 3,
    exp: 30000,
    mvp: 30,
    missions: 5,
    attributesAtFive: 4,
    competenceLevels: [5, 5, 5, 5]
  });

  assert.equal(evaluateProgression(actor).eligible, false);
  actor.system.progression.dmApproval = true;
  assert.equal(evaluateProgression(actor).eligible, true);
});

test("Nivel 4→5 completo e incompleto", () => {
  const complete = makeActor({
    level: 4,
    exp: 50000,
    mvp: 50,
    missions: 10,
    enemy: true,
    approval: true,
    attributesAtFive: 7,
    competenceLevels: [5, 5, 5, 5, 5, 5, 5]
  });
  const incomplete = structuredClone(complete);
  incomplete.system.progression.defeatedLevel5Enemy = false;

  assert.equal(evaluateProgression(complete).eligible, true);
  assert.equal(evaluateProgression(incomplete).eligible, false);
});

test("Nivel 5 es máximo y no tiene siguiente ascenso", () => {
  const evaluation = evaluateProgression(makeActor({ level: 5, exp: 90000, mvp: 90 }));

  assert.equal(getRequirementsForLevel(5), null);
  assert.equal(evaluation.maximumLevel, true);
  assert.equal(evaluation.nextLevel, null);
  assert.equal(evaluation.eligible, false);
  assert.deepEqual(evaluation.requirements, []);
});

test("EXP y MVP excedentes se preservan y sólo la barra visual se clampa", () => {
  const actor = makeActor({
    level: 2,
    exp: 18750,
    mvp: 27,
    dungeons: 1,
    merit: 5,
    attributesAtFive: 2,
    competenceLevels: [5, 5]
  });
  const before = structuredClone(actor);
  const evaluation = evaluateProgression(actor);

  assert.equal(evaluation.current.exp, 18750);
  assert.equal(evaluation.current.mvp, 27);
  assert.equal(evaluation.expProgress.required, 15000);
  assert.equal(evaluation.expProgress.percent, 100);
  assert.equal(evaluation.expProgress.text, "18.750 / 15.000 EXP");
  assert.deepEqual(actor, before, "la evaluación pura no modifica el Actor");
});

test("los conteos usan nueve atributos y sólo Competencias de progresión", () => {
  const evaluation = evaluateProgression(makeActor({
    attributesAtFive: 3,
    competenceLevels: [2, 3, 5, 6],
    extraItems: [
      { type: "objeto", system: { nivel: 5 } },
      { type: "arma", system: { nivel: 5 } }
    ]
  }));

  assert.equal(evaluation.counts.attributesAtFive, 3);
  assert.equal(evaluation.counts.competencesAtFive, 2);
  assert.equal(evaluation.counts.competencesAtLeastThree, 3);
});

test("los requisitos públicos son independientes entre llamadas", () => {
  const first = getRequirementsForLevel(1);
  const second = getRequirementsForLevel(1);

  assert.notEqual(first, second);
  assert.notEqual(first.requirements, second.requirements);
  assert.equal(first.nextLevel, 2);
  assert.equal(first.requiredExp, 1000);
});

test("progreso global cuenta sólo requisitos completos de forma binaria", () => {
  const actor = makeActor({ level: 2, exp: 7500 });

  let evaluation = evaluateProgression(actor);
  assert.deepEqual(evaluation.globalProgress, { completed: 0, total: 6, percent: 0, text: "0 / 6" });

  actor.system.recursos.mvp = 20;
  evaluation = evaluateProgression(actor);
  assert.equal(evaluation.globalProgress.completed, 1);
  assert.equal(evaluation.globalProgress.percent, 17);
  assert.equal(evaluation.requirements.find(requirement => requirement.key === "exp").met, false);

  actor.system.progression.dungeonsCompleted = 1;
  actor.system.progression.meritCredits = 5;
  evaluation = evaluateProgression(actor);
  assert.equal(evaluation.globalProgress.completed, 3);
  assert.equal(evaluation.globalProgress.percent, 50);

  actor.system.recursos.exp = 15000;
  actor.system.atributos.resistencia = 5;
  actor.system.atributos.carisma = 5;
  actor.items.push(
    { type: "competencia", system: { nivel: 5, categoria: "competencia", tipo: "" } },
    { type: "competencia", system: { nivel: 5, categoria: "competencia", tipo: "" } }
  );
  evaluation = evaluateProgression(actor);
  assert.deepEqual(evaluation.globalProgress, { completed: 6, total: 6, percent: 100, text: "6 / 6" });
});
