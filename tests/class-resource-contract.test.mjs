import test from "node:test";
import assert from "node:assert/strict";

const PHYSICAL_IDS = Object.freeze([
  "asesino", "bandido", "caballero", "cazador", "comerciante",
  "espadachin", "explorador", "guerrero", "inventor", "ladron",
  "monje", "ninja", "paladin", "valkiria"
]);

const MAGIC_HYBRID_IDS = Object.freeze([
  "nigromante", "bruja", "chaman", "druida", "guardian", "hechicero",
  "mago", "oraculo", "alquimista", "clerigo", "bardo"
]);

const EXPECTED_LABELS = Object.freeze({
  asesino: "Asesino",
  bandido: "Bandido",
  caballero: "Caballero",
  cazador: "Cazador",
  comerciante: "Comerciante",
  espadachin: "Espadachín",
  explorador: "Explorador",
  guerrero: "Guerrero",
  inventor: "Inventor",
  ladron: "Ladrón",
  monje: "Monje",
  ninja: "Ninja",
  paladin: "Paladín",
  valkiria: "Valkiria",
  nigromante: "Nigromante",
  bruja: "Bruja",
  chaman: "Chamán",
  druida: "Druida",
  guardian: "Guardián",
  hechicero: "Hechicero",
  mago: "Mago",
  oraculo: "Oráculo",
  alquimista: "Alquimista",
  clerigo: "Clérigo",
  bardo: "Bardo"
});

function actorState(options = {}) {
  const {
  legacyClass = "",
  level = 1,
  resistance = 0,
  intelligence = 0,
  hpValue = 10,
  hpMax = 10,
  mpValue = 10,
  mpMax = 10,
  hpModifier = 0,
  mpModifier = 0,
  hpLabel = "",
  mpLabel = ""
  } = options;
  const classId = Object.hasOwn(options, "classId")
    ? options.classId
    : "guerrero";
  const identidad = { clase: legacyClass };
  if (classId !== undefined) identidad.classId = classId;

  return {
    system: {
      identidad,
      recursos: { nivel: level },
      atributos: {
        resistencia: resistance,
        inteligencia: intelligence
      },
      vitales: {
        hp: { value: hpValue, max: hpMax },
        mp: { value: mpValue, max: mpMax }
      },
      resourceModifiers: {
        hp: { value: hpModifier, label: hpLabel },
        mp: { value: mpModifier, label: mpLabel }
      }
    }
  };
}

async function loadRegistry() {
  return import("../scripts/actors/class-registry.js");
}

async function loadCalculator() {
  return import("../scripts/actors/class-resource-calculator.js");
}

test("registry contractual contiene exactamente 25 IDs estables, únicos y con labels", async () => {
  const {
    MTROL_CLASS_IDS,
    MTROL_CLASS_REGISTRY
  } = await loadRegistry();
  const expectedIds = [...PHYSICAL_IDS, ...MAGIC_HYBRID_IDS];

  assert.deepEqual(MTROL_CLASS_IDS, expectedIds);
  assert.equal(new Set(MTROL_CLASS_IDS).size, 25);
  assert.equal(Object.keys(MTROL_CLASS_REGISTRY).length, 25);

  for (const id of MTROL_CLASS_IDS) {
    assert.match(id, /^[a-z]+$/);
    assert.equal(MTROL_CLASS_REGISTRY[id].id, id);
    assert.equal(MTROL_CLASS_REGISTRY[id].label, EXPECTED_LABELS[id]);
    assert.ok(MTROL_CLASS_REGISTRY[id].resourceProfile);
  }
});

test("todas las clases físicas resuelven exclusivamente al perfil 10 HP / 5 MP", async () => {
  const { getClassDefinition, getResourceProfileForClass } = await loadRegistry();

  for (const id of PHYSICAL_IDS) {
    assert.equal(getClassDefinition(id).id, id);
    assert.deepEqual(getResourceProfileForClass(id), {
      hpPerResistance: 10,
      mpPerIntelligence: 5
    });
  }
});

test("todas las clases mágicas o híbridas resuelven exclusivamente al perfil 5 HP / 10 MP", async () => {
  const { getClassDefinition, getResourceProfileForClass } = await loadRegistry();

  for (const id of MAGIC_HYBRID_IDS) {
    assert.equal(getClassDefinition(id).id, id);
    assert.deepEqual(getResourceProfileForClass(id), {
      hpPerResistance: 5,
      mpPerIntelligence: 10
    });
  }
});

test("una clase vacía o desconocida no recibe silenciosamente ningún perfil", async () => {
  const { getClassDefinition, getResourceProfileForClass } = await loadRegistry();

  for (const id of [null, undefined, "", "desconocida", "Mago"] ) {
    assert.equal(getClassDefinition(id), null);
    assert.equal(getResourceProfileForClass(id), null);
  }
});

test("la fórmula global aporta exactamente 10 HP y 10 MP por nivel", async () => {
  const { calculateActorResourceMaximums } = await loadCalculator();

  for (const level of [1, 2, 5]) {
    assert.deepEqual(
      calculateActorResourceMaximums(actorState({ level })),
      { active: true, hpMax: level * 10, mpMax: level * 10 }
    );
  }
});

test("Guerrero aplica el perfil físico en los tres casos contractuales", async () => {
  const { calculateActorResourceMaximums } = await loadCalculator();
  const cases = [
    [{ level: 1, resistance: 0, intelligence: 0 }, [10, 10]],
    [{ level: 1, resistance: 1, intelligence: 1 }, [20, 15]],
    [{ level: 3, resistance: 4, intelligence: 2 }, [70, 40]]
  ];

  for (const [input, [hpMax, mpMax]] of cases) {
    assert.deepEqual(calculateActorResourceMaximums(actorState(input)), {
      active: true,
      hpMax,
      mpMax
    });
  }
});

test("Mago aplica el perfil mágico/híbrido en los tres casos contractuales", async () => {
  const { calculateActorResourceMaximums } = await loadCalculator();
  const cases = [
    [{ level: 1, resistance: 0, intelligence: 0 }, [10, 10]],
    [{ level: 1, resistance: 1, intelligence: 1 }, [15, 20]],
    [{ level: 3, resistance: 4, intelligence: 2 }, [50, 50]]
  ];

  for (const [input, [hpMax, mpMax]] of cases) {
    assert.deepEqual(
      calculateActorResourceMaximums(actorState({ classId: "mago", ...input })),
      { active: true, hpMax, mpMax }
    );
  }
});

test("modificadores GM positivos, cero y negativos participan sólo por su valor", async () => {
  const { calculateActorResourceMaximums } = await loadCalculator();

  assert.deepEqual(calculateActorResourceMaximums(actorState({
    classId: "mago",
    level: 2,
    resistance: 2,
    intelligence: 3,
    hpModifier: 10,
    mpModifier: 5,
    hpLabel: "Texto narrativo cualquiera",
    mpLabel: "Otro texto"
  })), { active: true, hpMax: 40, mpMax: 55 });

  assert.deepEqual(calculateActorResourceMaximums(actorState({
    level: 2,
    resistance: 2,
    hpModifier: -5
  })), { active: true, hpMax: 35, mpMax: 20 });
});

test("máximos negativos o entradas no finitas se normalizan a resultados finitos no negativos", async () => {
  const { calculateActorResourceMaximums } = await loadCalculator();

  const negative = calculateActorResourceMaximums(actorState({
    hpModifier: -50,
    mpModifier: -50
  }));
  assert.deepEqual(negative, { active: true, hpMax: 0, mpMax: 0 });

  for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
    const result = calculateActorResourceMaximums(actorState({ hpModifier: invalid, mpModifier: invalid }));
    assert.equal(Number.isFinite(result.hpMax), true);
    assert.equal(Number.isFinite(result.mpMax), true);
    assert.ok(result.hpMax >= 0);
    assert.ok(result.mpMax >= 0);
  }
});

test("subir y bajar Resistencia física aplica el mismo delta a HP value/max", async () => {
  const { calculateResourceTransition } = await loadCalculator();
  const up = calculateResourceTransition(
    actorState({ level: 2, resistance: 2, hpValue: 24, hpMax: 40 }),
    actorState({ level: 2, resistance: 3, hpValue: 24, hpMax: 40 })
  );
  assert.deepEqual(up.hp, { value: 34, max: 50, delta: 10 });

  const down = calculateResourceTransition(
    actorState({ level: 2, resistance: 3, hpValue: 34, hpMax: 50 }),
    actorState({ level: 2, resistance: 2, hpValue: 34, hpMax: 50 })
  );
  assert.deepEqual(down.hp, { value: 24, max: 40, delta: -10 });
});

test("subir y bajar Inteligencia mágica aplica el mismo delta a MP value/max", async () => {
  const { calculateResourceTransition } = await loadCalculator();
  const up = calculateResourceTransition(
    actorState({ classId: "mago", intelligence: 2, mpValue: 18, mpMax: 30 }),
    actorState({ classId: "mago", intelligence: 3, mpValue: 18, mpMax: 30 })
  );
  assert.deepEqual(up.mp, { value: 28, max: 40, delta: 10 });

  const down = calculateResourceTransition(
    actorState({ classId: "mago", intelligence: 3, mpValue: 28, mpMax: 40 }),
    actorState({ classId: "mago", intelligence: 2, mpValue: 28, mpMax: 40 })
  );
  assert.deepEqual(down.mp, { value: 18, max: 30, delta: -10 });
});

test("subir o bajar Nivel produce exactamente ±10 HP/MP sin depender del perfil", async () => {
  const { calculateResourceTransition } = await loadCalculator();

  for (const [classId, resistance, intelligence] of [
    ["guerrero", 2, 2],
    ["mago", 4, 1]
  ]) {
    const up = calculateResourceTransition(
      actorState({ classId, level: 2, resistance, intelligence, hpValue: 22, hpMax: 40, mpValue: 13, mpMax: 30 }),
      actorState({ classId, level: 3, resistance, intelligence, hpValue: 22, hpMax: 40, mpValue: 13, mpMax: 30 })
    );
    assert.equal(up.hp.delta, 10);
    assert.equal(up.mp.delta, 10);
    assert.equal(up.hp.value, 32);
    assert.equal(up.hp.max, 50);
    assert.equal(up.mp.value, 23);
    assert.equal(up.mp.max, 40);

    const down = calculateResourceTransition(
      actorState({ classId, level: 3, resistance, intelligence, hpValue: 32, hpMax: 50, mpValue: 23, mpMax: 40 }),
      actorState({ classId, level: 2, resistance, intelligence, hpValue: 32, hpMax: 50, mpValue: 23, mpMax: 40 })
    );
    assert.equal(down.hp.delta, -10);
    assert.equal(down.mp.delta, -10);
    assert.equal(down.hp.value, 22);
    assert.equal(down.mp.value, 13);
  }
});

test("agregar y retirar modificadores GM conserva semántica reversible de delta", async () => {
  const { calculateResourceTransition } = await loadCalculator();
  const base = actorState({ level: 3, hpValue: 12, hpMax: 30, mpValue: 17, mpMax: 30 });
  const modified = actorState({
    level: 3,
    hpValue: 12,
    hpMax: 30,
    mpValue: 17,
    mpMax: 30,
    hpModifier: 10,
    mpModifier: 5
  });

  const add = calculateResourceTransition(base, modified);
  assert.deepEqual(add.hp, { value: 22, max: 40, delta: 10 });
  assert.deepEqual(add.mp, { value: 22, max: 35, delta: 5 });

  const remove = calculateResourceTransition(
    actorState({ level: 3, hpValue: 22, hpMax: 40, mpValue: 22, mpMax: 35, hpModifier: 10, mpModifier: 5 }),
    base
  );
  assert.deepEqual(remove.hp, { value: 12, max: 30, delta: -10 });
  assert.deepEqual(remove.mp, { value: 17, max: 30, delta: -5 });
});

test("un delta negativo clampa value entre cero y el nuevo máximo", async () => {
  const { calculateResourceTransition } = await loadCalculator();
  const transition = calculateResourceTransition(
    actorState({ level: 4, hpValue: 5, hpMax: 40, mpValue: 35, mpMax: 40 }),
    actorState({ level: 2, hpValue: 5, hpMax: 40, mpValue: 35, mpMax: 40 })
  );

  assert.deepEqual(transition.hp, { value: 0, max: 20, delta: -20 });
  assert.deepEqual(transition.mp, { value: 15, max: 20, delta: -20 });
  assert.ok(transition.hp.value <= transition.hp.max);
  assert.ok(transition.mp.value <= transition.mp.max);
});

test("un update conjunto compara máximo anterior y nuevo una sola vez", async () => {
  const { calculateResourceTransition } = await loadCalculator();
  const transition = calculateResourceTransition(
    actorState({
      classId: "mago", level: 2, resistance: 1, intelligence: 2,
      hpValue: 19, hpMax: 25, mpValue: 31, mpMax: 40
    }),
    actorState({
      classId: "mago", level: 3, resistance: 2, intelligence: 3,
      hpValue: 19, hpMax: 25, mpValue: 31, mpMax: 40
    })
  );

  assert.deepEqual(transition.hp, { value: 34, max: 40, delta: 15 });
  assert.deepEqual(transition.mp, { value: 51, max: 60, delta: 20 });
});

test("cálculo y transición son idempotentes para el mismo estado de entrada", async () => {
  const { calculateActorResourceMaximums, calculateResourceTransition } = await loadCalculator();
  const state = actorState({
    classId: "mago", level: 3, resistance: 2, intelligence: 4,
    hpValue: 37, hpMax: 50, mpValue: 64, mpMax: 70, hpModifier: 10
  });
  const intended = structuredClone(state);

  const maximums = Array.from({ length: 10 }, () => calculateActorResourceMaximums(state));
  const transitions = Array.from({ length: 10 }, () => calculateResourceTransition(state, intended));
  assert.ok(maximums.every(result => JSON.stringify(result) === JSON.stringify(maximums[0])));
  assert.ok(transitions.every(result => JSON.stringify(result) === JSON.stringify(transitions[0])));
  assert.deepEqual(transitions[0].hp, { value: 37, max: 50, delta: 0 });
  assert.deepEqual(transitions[0].mp, { value: 64, max: 70, delta: 0 });
});

test("classId null, vacío o ausente conserva los cuatro recursos persistidos", async () => {
  const { calculateActorResourceMaximums, calculateResourceTransition } = await loadCalculator();

  for (const classId of [null, "", undefined]) {
    const state = actorState({
      classId,
      legacyClass: "Mago",
      level: 4,
      resistance: 5,
      intelligence: 5,
      hpValue: 27,
      hpMax: 33,
      mpValue: 506,
      mpMax: 540
    });
    assert.deepEqual(calculateActorResourceMaximums(state), {
      active: false,
      hpMax: 33,
      mpMax: 540
    });
    assert.deepEqual(calculateResourceTransition(state, structuredClone(state)), {
      active: false,
      hp: { value: 27, max: 33, delta: 0 },
      mp: { value: 506, max: 540, delta: 0 }
    });
  }
});

test("selección GM explícita de Mago activa la transición legacy 37/40 y 64/70", async () => {
  const { calculateResourceTransition } = await loadCalculator();
  const oldState = actorState({
    classId: "",
    legacyClass: "Mago",
    level: 3,
    resistance: 2,
    intelligence: 4,
    hpValue: 27,
    hpMax: 30,
    mpValue: 19,
    mpMax: 25
  });
  const newState = structuredClone(oldState);
  newState.system.identidad.classId = "mago";

  assert.deepEqual(calculateResourceTransition(oldState, newState), {
    active: true,
    hp: { value: 37, max: 40, delta: 10 },
    mp: { value: 64, max: 70, delta: 45 }
  });
});

test("el string legacy nunca manda y classId canónico siempre es la autoridad mecánica", async () => {
  const { calculateActorResourceMaximums } = await loadCalculator();

  assert.equal(calculateActorResourceMaximums(actorState({
    classId: "",
    legacyClass: "Mago",
    level: 3,
    resistance: 2,
    intelligence: 4,
    hpMax: 30,
    mpMax: 25
  })).active, false);

  assert.deepEqual(calculateActorResourceMaximums(actorState({
    classId: "mago",
    legacyClass: "Texto legacy cualquiera",
    level: 3,
    resistance: 2,
    intelligence: 4
  })), { active: true, hpMax: 40, mpMax: 70 });
});
