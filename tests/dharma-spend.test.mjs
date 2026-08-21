import test from "node:test";
import assert from "node:assert/strict";

import {
  MTROL_DHARMA_MAX,
  MTROL_DHARMA_MIN,
  MTROL_DHARMA_SUPPORTED_FACES,
  createDharmaDieId,
  createDharmaSpendContext,
  finalizeDharmaCritical,
  getDharmaEligibleInitialDice,
  getDharmaNaturalRule,
  resolveDharmaInitialDie,
  markDharmaSpendConsumed,
  validateDharmaSpend
} from "../scripts/rolls/dharma-engine.js";

function buildEligibleDice(count = 5, faces = 10) {
  return getDharmaEligibleInitialDice({
    terms: [{
      number: count,
      faces
    }]
  });
}

test("Dharma Burn admite exclusivamente d6, d8, d10, d12 y d20", () => {
  assert.equal(MTROL_DHARMA_MIN, 0);
  assert.equal(MTROL_DHARMA_MAX, 5);
  assert.deepEqual(
    MTROL_DHARMA_SUPPORTED_FACES,
    [6, 8, 10, 12, 20]
  );
});

test("cada dado inicial recibe identidad propia incluso dentro de XdY", () => {
  const dice = getDharmaEligibleInitialDice({
    terms: [
      { number: 3, faces: 10 },
      { operator: "+" },
      { number: 1, faces: 8 },
      { operator: "+" },
      { number: 1, faces: 4 }
    ]
  });

  assert.deepEqual(
    dice.map(die => die.id),
    [
      "initial:0:0",
      "initial:0:1",
      "initial:0:2",
      "initial:2:0"
    ]
  );

  assert.deepEqual(
    dice.map(die => die.label),
    ["D10 #1", "D10 #2", "D10 #3", "D8 #1"]
  );

  assert.equal(createDharmaDieId(0, 1), "initial:0:1");
});

test("el saldo disponible limita exactamente la cantidad seleccionable", () => {
  const dice = buildEligibleDice();

  const zero = validateDharmaSpend({
    availableDharma: 0,
    selectedDice: [],
    eligibleDice: dice
  });

  assert.equal(zero.valid, true);
  assert.equal(zero.enabled, false);
  assert.equal(zero.cost, 0);

  for (const available of [1, 3, 5]) {
    const allowed = validateDharmaSpend({
      availableDharma: available,
      selectedDice: dice.slice(0, available),
      eligibleDice: dice
    });

    assert.equal(allowed.valid, true, `${available} disponibles`);
    assert.equal(allowed.enabled, true, `${available} disponibles`);
    assert.equal(allowed.cost, available, `${available} disponibles`);

    if (available < dice.length) {
      const exceeded = validateDharmaSpend({
        availableDharma: available,
        selectedDice: dice.slice(0, available + 1),
        eligibleDice: dice
      });

      assert.equal(exceeded.valid, false, `${available} excedidos`);
      assert.ok(
        exceeded.errors.some(error => error.code === "insufficient-balance"),
        `${available} excedidos`
      );
    }
  }
});

test("saldos fuera de 0..5 y selecciones duplicadas o ajenas se rechazan", () => {
  const dice = buildEligibleDice(2);

  for (const availableDharma of [-1, 6, 1.5]) {
    const result = validateDharmaSpend({
      availableDharma,
      selectedDice: [],
      eligibleDice: dice
    });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some(error => error.code === "invalid-balance"));
  }

  const invalidSelection = validateDharmaSpend({
    availableDharma: 2,
    selectedDice: [dice[0], dice[0], "initial:99:0"],
    eligibleDice: dice
  });

  assert.equal(invalidSelection.valid, false);
  assert.equal(invalidSelection.cost, 1);
  assert.ok(
    invalidSelection.errors.some(error => error.code === "duplicate-selection")
  );
  assert.ok(
    invalidSelection.errors.some(error => error.code === "invalid-selection")
  );
});

test("resultados normales protegidos reciben +1 sin clamp", () => {
  const scenarios = [
    { faces: 10, naturalResult: 7, finalResult: 8 },
    { faces: 20, naturalResult: 20, finalResult: 21 },
    { faces: 6, naturalResult: 6, finalResult: 7 }
  ];

  for (const scenario of scenarios) {
    const die = buildEligibleDice(1, scenario.faces)[0];
    const trace = resolveDharmaInitialDie({
      die,
      naturalResult: scenario.naturalResult
    });

    assert.equal(trace.naturalResult, scenario.naturalResult);
    assert.equal(trace.effectiveResult, scenario.finalResult);
    assert.equal(trace.dharmaBonus, 1);
    assert.equal(trace.finalResult, scenario.finalResult);
    assert.equal(trace.fumble, false);
  }
});

test("Dharma neutraliza la pifia protegida de d10 y la pifia especial de d6", () => {
  for (const scenario of [
    { faces: 10, naturalResult: 2, effectiveResult: 3 },
    { faces: 6, naturalResult: 1, effectiveResult: 2 }
  ]) {
    const die = buildEligibleDice(1, scenario.faces)[0];
    const trace = resolveDharmaInitialDie({
      die,
      naturalResult: scenario.naturalResult
    });

    assert.equal(trace.naturalFumble, true);
    assert.equal(trace.fumble, false);
    assert.equal(trace.fumblePrevented, true);
    assert.equal(trace.effectiveResult, scenario.effectiveResult);
    assert.equal(trace.finalResult, scenario.effectiveResult);
    assert.equal(trace.naturalResult, scenario.naturalResult);
  }
});

test("en 3d10 Dharma aplicado solo a #2 no altera #1 ni #3", () => {
  const dice = buildEligibleDice(3);
  const selectedId = dice[1].id;
  const results = [4, 7, 9];

  const traces = dice.map((die, index) =>
    resolveDharmaInitialDie({
      die,
      naturalResult: results[index],
      selected: die.id === selectedId
    })
  );

  assert.deepEqual(
    traces.map(trace => trace.finalResult),
    [4, 8, 9]
  );

  assert.deepEqual(
    traces.map(trace => trace.protectedByDharma),
    [false, true, false]
  );
});

test("un 1 protegido sigue siendo critico y recibe +1 solo despues de la cadena", () => {
  const die = buildEligibleDice(1, 10)[0];
  const trace = resolveDharmaInitialDie({
    die,
    naturalResult: 1
  });

  assert.equal(trace.naturalResult, 1);
  assert.equal(trace.effectiveResult, 1);
  assert.equal(trace.naturalCritical, true);
  assert.equal(trace.critical, true);
  assert.equal(trace.fumble, false);
  assert.equal(trace.dharmaBonus, 0);
  assert.equal(trace.requiresPostCriticalBonus, true);
  assert.equal(trace.finalResult, null);

  const finalized =
    finalizeDharmaCritical(trace, 24);

  assert.equal(finalized.naturalResult, 1);
  assert.equal(finalized.criticalResolvedResult, 24);
  assert.equal(finalized.dharmaBonusAfterCritical, 1);
  assert.equal(finalized.finalResult, 25);
});

test("la proteccion no se propaga a dados de cadena o no iniciales", () => {
  const die = buildEligibleDice(1, 10)[0];
  const trace = resolveDharmaInitialDie({
    die,
    naturalResult: 2,
    selected: true,
    initial: false
  });

  assert.equal(trace.selected, true);
  assert.equal(trace.initial, false);
  assert.equal(trace.protectedByDharma, false);
  assert.equal(trace.naturalFumble, true);
  assert.equal(trace.fumble, true);
  assert.equal(trace.fumblePrevented, false);
  assert.equal(trace.effectiveResult, 2);
  assert.equal(trace.finalResult, 2);
});

test("las reglas puras rechazan dados no admitidos y finalizaciones criticas invalidas", () => {
  assert.throws(
    () => getDharmaNaturalRule(4, 1),
    /no admite Dharma Burn/
  );

  assert.throws(
    () => finalizeDharmaCritical({ naturalCritical: false }, 10),
    /no corresponde a un critico inicial protegido/
  );
});

test("el contexto transitorio queda preparado y solo un recibo coincidente lo marca consumido", () => {
  const selectedDice = buildEligibleDice(2);
  const prepared = createDharmaSpendContext({
    actorUuid: "Actor.hero",
    selectedDice,
    transactionId: "tx-context"
  });

  assert.deepEqual(prepared, {
    version: 1,
    enabled: true,
    state: "prepared",
    actorUuid: "Actor.hero",
    selectedDice: selectedDice.map(({ id, termIndex, resultIndex, faces }) => ({
      id,
      termIndex,
      resultIndex,
      faces
    })),
    selectedIds: ["initial:0:0", "initial:0:1"],
    cost: 2,
    transactionId: "tx-context",
    receipt: null
  });

  const receipt = {
    authorized: true,
    actorUuid: "Actor.hero",
    transactionId: "tx-context",
    selectedIds: ["initial:0:0", "initial:0:1"],
    cost: 2,
    balanceBefore: 3,
    balanceAfter: 1
  };

  const consumed = markDharmaSpendConsumed(prepared, receipt);
  assert.equal(consumed.state, "consumed");
  assert.deepEqual(consumed.receipt, receipt);
  assert.equal(prepared.state, "prepared");
  assert.equal(prepared.receipt, null);

  assert.throws(
    () => markDharmaSpendConsumed(prepared, {
      ...receipt,
      transactionId: "tx-other"
    }),
    /no coincide/
  );
});
