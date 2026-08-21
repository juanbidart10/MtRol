import test from "node:test";
import assert from "node:assert/strict";

const extraRollQueue = [];

class MockRoll {
  constructor(formula) {
    this.formula = formula;
    this.total = null;
    this.dice = [];
  }

  async evaluate() {
    const next = extraRollQueue.shift();

    assert.ok(next, `Falta resultado para ${this.formula}.`);
    assert.equal(next.formula, this.formula);

    this.total = next.total;
    this.dice = next.dice;
    return this;
  }
}

globalThis.Roll = MockRoll;

globalThis.game = {
  user: {
    isGM: true
  },
  dice3d: null
};

globalThis.ui = {
  notifications: {
    info: () => {},
    warn: () => {}
  }
};

globalThis.ChatMessage = {
  getSpeaker: () => ({}),
  create: async data => data
};

function createRoll(faces, results, total = null) {
  const normalizedResults =
    results.map(result => ({ result, active: true }));

  return {
    total: total ?? results.reduce((sum, result) => sum + result, 0),
    dice: [{
      faces,
      results: normalizedResults
    }]
  };
}

function createActor() {
  const actor = {
    name: "Personaje de caracterizacion",
    isOwner: true,
    system: {
      recursos: {
        dharma: 0,
        karma: 0
      }
    },
    async update(changes) {
      actor.system.recursos.dharma =
        changes["system.recursos.dharma"];

      actor.system.recursos.karma =
        changes["system.recursos.karma"];

      return actor;
    }
  };

  return actor;
}

const diceEngine =
  await import("../scripts/rolls/dice-engine.js");

const resourceEngine =
  await import("../scripts/rolls/mtrol-dharma-karma.js");

test("d8, d10, d12 y d20 con resultado 2 producen la pifia y el Karma actuales", async () => {
  for (const faces of [8, 10, 12, 20]) {
    const roll = createRoll(faces, [2]);
    const naturalResults = structuredClone(roll.dice[0].results);

    const evaluation =
      await diceEngine.mtrolEvaluarDadosMtrol(roll);

    assert.equal(evaluation.pifia, true, `D${faces}`);
    assert.equal(evaluation.cantidadKarma, 1, `D${faces}`);
    assert.equal(evaluation.cantidadDharma, 0, `D${faces}`);
    assert.equal(evaluation.totalExtra, 0, `D${faces}`);
    assert.deepEqual(roll.dice[0].results, naturalResults, `D${faces}`);

    const actor = createActor();
    await resourceEngine.mtrolAplicarDharmaKarma(
      actor,
      evaluation.cantidadDharma,
      evaluation.cantidadKarma
    );

    assert.equal(actor.system.recursos.karma, 1, `D${faces}`);
    assert.equal(actor.system.recursos.dharma, 0, `D${faces}`);
  }
});

test("d6 con resultado 1 produce su pifia y Karma especiales actuales", async () => {
  const roll = createRoll(6, [1]);
  const evaluation =
    await diceEngine.mtrolEvaluarDadosMtrol(roll);

  assert.equal(evaluation.pifia, true);
  assert.equal(evaluation.cantidadKarma, 1);
  assert.equal(evaluation.cantidadDharma, 0);

  const actor = createActor();
  await resourceEngine.mtrolAplicarDharmaKarma(
    actor,
    evaluation.cantidadDharma,
    evaluation.cantidadKarma
  );

  assert.equal(actor.system.recursos.karma, 1);
  assert.equal(actor.system.recursos.dharma, 0);
});

test("el 1 natural de d8, d10, d12 y d20 conserva critico, cadena y Dharma actuales", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = callback => {
    queueMicrotask(callback);
    return 0;
  };

  try {
    for (const faces of [8, 10, 12, 20]) {
      extraRollQueue.push({
        formula: `1d${faces}`,
        total: 4,
        dice: createRoll(faces, [4]).dice
      });

      const roll = createRoll(faces, [1]);
      const evaluation =
        await diceEngine.mtrolEvaluarDadosMtrol(roll);

      assert.equal(evaluation.pifia, false, `D${faces}`);
      assert.equal(evaluation.cantidadDharma, 1, `D${faces}`);
      assert.equal(evaluation.cantidadKarma, 0, `D${faces}`);
      assert.equal(evaluation.extraRolls.length, 1, `D${faces}`);
      assert.equal(evaluation.totalExtra, 8, `D${faces}`);
      assert.equal(
        diceEngine.mtrolCalcularTotalBaseSinCriticos(roll),
        0,
        `D${faces}`
      );

      const actor = createActor();
      await resourceEngine.mtrolAplicarDharmaKarma(
        actor,
        evaluation.cantidadDharma,
        evaluation.cantidadKarma
      );

      assert.equal(actor.system.recursos.dharma, 1, `D${faces}`);
      assert.equal(actor.system.recursos.karma, 0, `D${faces}`);
    }
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("una pifia entre varios dados mantiene la cancelacion global actual", async () => {
  const roll = createRoll(10, [5, 2, 8]);
  const naturalResults = structuredClone(roll.dice[0].results);

  const evaluation =
    await diceEngine.mtrolEvaluarDadosMtrol(roll);

  assert.equal(evaluation.pifia, true);
  assert.equal(evaluation.cantidadKarma, 1);
  assert.equal(evaluation.cantidadDharma, 0);
  assert.equal(evaluation.extraRolls.length, 0);
  assert.deepEqual(roll.dice[0].results, naturalResults);
});
