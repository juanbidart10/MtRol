import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const rollQueue = [];
const chatMessages = [];
const diceAnimations = [];

let evaluationCount = 0;
let renderCount = 0;
let restorationCount = 0;

function clone(value) {
  return value === undefined
    ? undefined
    : structuredClone(value);
}

globalThis.foundry = {
  utils: {
    deepClone: clone,
    duplicate: clone,
    escapeHTML: value => String(value ?? ""),
    mergeObject: (target, source) => Object.assign(target, source)
  }
};

function buildTerms(dice = []) {
  return dice.map(die => ({
    class: "Die",
    number: die.results.length,
    faces: die.faces,
    results: die.results.map(result => ({
      result,
      active: true
    }))
  }));
}

function buildDice(terms = []) {
  return terms.map(term => ({
    faces: term.faces,
    results: clone(term.results)
  }));
}

class MockRoll {
  constructor(formula, data = {}) {
    this.formula = formula;
    this.data = data;
    this.total = null;
    this.terms = [];
    this.dice = [];
    this.evaluated = false;
  }

  async evaluate() {
    assert.equal(this.evaluated, false, "Un Roll no debe evaluarse dos veces.");

    const next = rollQueue.shift();

    assert.ok(next, `Falta un resultado determinista para ${this.formula}`);
    assert.equal(next.formula, this.formula);

    this.total = next.total;
    this.terms = buildTerms(next.dice);
    this.dice = buildDice(this.terms);
    this.evaluated = true;
    evaluationCount++;

    return this;
  }

  async render({ flavor = "" } = {}) {
    renderCount++;

    const results = this.dice
      .flatMap(die => die.results.map(result => result.result))
      .join(", ");

    return `
      <div class="dice-roll">
        <div class="dice-flavor">${flavor}</div>
        <div class="dice-result">
          <div class="dice-formula">${this.formula}</div>
          <div class="dice-tooltip">${results}</div>
          <h4 class="dice-total">${this.total}</h4>
        </div>
      </div>
    `;
  }

  toJSON() {
    return {
      class: "Roll",
      formula: this.formula,
      terms: clone(this.terms),
      total: this.total,
      evaluated: this.evaluated
    };
  }

  static fromData(data) {
    restorationCount++;

    const roll =
      new MockRoll(data.formula);

    roll.total = data.total;
    roll.terms = clone(data.terms);
    roll.dice = buildDice(roll.terms);
    roll.evaluated = data.evaluated !== false;

    return roll;
  }

  static fromJSON(json) {
    return MockRoll.fromData(JSON.parse(json));
  }
}

globalThis.Roll = MockRoll;

globalThis.game = {
  user: {
    id: "player",
    isGM: false
  },
  dice3d: {
    showForRoll: async roll => {
      diceAnimations.push(roll);
    }
  }
};

globalThis.ui = {
  notifications: {
    warn: () => {},
    info: () => {}
  }
};

globalThis.ChatMessage = {
  getSpeaker: ({ actor } = {}) => ({
    actor: actor?.id ?? null
  }),
  create: async data => {
    const recordedData = {
      ...data,
      messageHookDisabledAtCreate:
        game.dice3d?.messageHookDisabled === true
    };

    chatMessages.push(recordedData);
    return {
      id: `message-${chatMessages.length}`,
      ...recordedData
    };
  }
};

function queueRoll(formula, total, dice) {
  rollQueue.push({
    formula,
    total,
    dice
  });
}

function createActor(id = "actor") {
  const actor = {
    id,
    name: id,
    system: {
      atributos: {
        destreza: 3,
        fuerza: 3
      },
      identidad: {
        raceId: ""
      },
      recursos: {
        dharma: 0,
        karma: 0
      },
      vitales: {
        hp: {
          value: 10,
          max: 10
        },
        mp: {
          value: 10,
          max: 10
        }
      },
      equipamiento: {
        cabeza: "",
        cuello: "",
        hombros: "",
        brazos: "",
        pecho: "",
        piernas: "",
        pies: "",
        manoIzq: "",
        manoDer: ""
      }
    },
    items: [],
    getRollData() {
      return {
        atributos: clone(actor.system.atributos),
        recursos: clone(actor.system.recursos),
        vitales: clone(actor.system.vitales)
      };
    },
    async update(changes) {
      if (changes["system.recursos.dharma"] !== undefined) {
        actor.system.recursos.dharma = changes["system.recursos.dharma"];
      }

      if (changes["system.recursos.karma"] !== undefined) {
        actor.system.recursos.karma = changes["system.recursos.karma"];
      }

      return actor;
    }
  };

  return actor;
}

const chatRollModule =
  await import("../scripts/rolls/chat-rolls.js");

const rollModule =
  await import("../scripts/rolls/mtrol-rolls.js");

const initiativeModule =
  await import("../scripts/combat/initiative-engine.js");

const combatCardModule =
  await import("../scripts/combat/combat-card.js");

test("ataque basico conserva 2d10, formula, modificador y total sin reevaluar", async () => {
  const beforeEvaluations = evaluationCount;
  const beforeAnimations = diceAnimations.length;

  queueRoll("2d10 + 3", 11, [{
    faces: 10,
    results: [4, 4]
  }]);

  const result =
    await rollModule.mtrolRoll(
      "2d10 + 3",
      createActor("ataque-basico"),
      "Ataque basico"
    );

  const message =
    chatMessages.at(-1);

  assert.equal(result.total, 11);
  assert.equal(result.roll.formula, "2d10 + 3");
  assert.deepEqual(
    result.roll.dice[0].results.map(entry => entry.result),
    [4, 4]
  );
  assert.equal(result.roll.data.atributos.fuerza, 3);
  assert.deepEqual(message.rolls, [result.roll]);
  assert.match(message.content, /dice-roll/);
  assert.match(message.content, /dice-tooltip/);
  assert.match(message.content, /4, 4/);
  assert.equal(message.messageHookDisabledAtCreate, false);
  assert.equal(
    Object.hasOwn(game.dice3d, "messageHookDisabled"),
    false
  );
  assert.equal(evaluationCount - beforeEvaluations, 1);
  assert.equal(diceAnimations.length - beforeAnimations, 0);
});

test("pifia natural permanece visible en los terminos del Roll", async () => {
  queueRoll("2d10 + 3", 13, [{
    faces: 10,
    results: [2, 8]
  }]);

  const result =
    await rollModule.mtrolRoll(
      "2d10 + 3",
      createActor("pifia"),
      "Pifia natural"
    );

  assert.equal(result.pifia, true);
  assert.equal(result.total, 0);
  assert.deepEqual(
    result.roll.terms[0].results.map(entry => entry.result),
    [2, 8]
  );
  assert.equal(chatMessages.at(-1).rolls[0], result.roll);
});

test("Frenesí multiplica sólo el resultado base y conserva la pifia oficial", async () => {
  const draconian = createActor("frenesi");
  draconian.system.identidad.raceId = "draconiano";
  draconian.system.vitales.hp.value = 2;

  queueRoll("2d10 + 3", 11, [{
    faces: 10,
    results: [4, 4]
  }]);
  const success = await rollModule.mtrolRoll("2d10 + 3", draconian, "Frenesí");
  assert.equal(success.total, 22);
  assert.equal(success.roll.total, 11, "el Roll y sus dados no se preevalúan ni reescriben");
  assert.equal(success.rollEffects.appliedEffects[0].passiveId, "frenesi");

  queueRoll("2d10 + 3", 13, [{
    faces: 10,
    results: [2, 8]
  }]);
  const fumble = await rollModule.mtrolRoll("2d10 + 3", draconian, "Pifia con Frenesí");
  assert.equal(fumble.pifia, true);
  assert.equal(fumble.total, 0);
});

test("critico y cadena conservan cada Roll real y todos sus resultados", async () => {
  const beforeEvaluations = evaluationCount;
  const beforeAnimations = diceAnimations.length;

  queueRoll("2d10 + 3", 14, [{
    faces: 10,
    results: [1, 10]
  }]);
  queueRoll("1d10", 1, [{
    faces: 10,
    results: [1]
  }]);
  queueRoll("1d10", 4, [{
    faces: 10,
    results: [4]
  }]);

  const result =
    await rollModule.mtrolRoll(
      "2d10 + 3",
      createActor("critico"),
      "Critico encadenado"
    );

  assert.equal(result.total, 25);
  assert.equal(result.rolls.length, 3);
  assert.deepEqual(
    result.rolls.map(roll =>
      roll.dice.flatMap(die => die.results.map(entry => entry.result))
    ),
    [[1, 10], [1], [4]]
  );
  assert.deepEqual(chatMessages.at(-1).rolls, result.rolls);
  assert.equal(evaluationCount - beforeEvaluations, 3);
  assert.equal(diceAnimations.length - beforeAnimations, 0);
});

test("competencia, defensa, esquiva, contraataque, hechizo y meditacion comparten el Roll preservado", async () => {
  const categories = [
    "Competencia",
    "Defensa",
    "Esquiva",
    "Contraataque",
    "Hechizo",
    "Meditacion"
  ];

  for (const category of categories) {
    queueRoll("2d10 + 3", 11, [{
      faces: 10,
      results: [4, 4]
    }]);

    const result =
      await rollModule.mtrolRoll(
        "2d10 + 3",
        createActor(category),
        category
      );

    assert.equal(result.total, 11, category);
    assert.equal(chatMessages.at(-1).rolls[0], result.roll, category);
    assert.match(chatMessages.at(-1).content, new RegExp(category));
  }
});

test("iniciativa conserva principal, secundaria y el total existente", async () => {
  queueRoll("1d10 + @atributos.destreza", 7, [{
    faces: 10,
    results: [4]
  }]);
  queueRoll("1d10", 8, [{
    faces: 10,
    results: [8]
  }]);

  const result =
    await initiativeModule.rollMtrolInitiative(
      createActor("iniciativa")
    );

  assert.equal(result.total, 15);
  assert.deepEqual(result.rolls, [
    result.mainRoll,
    result.secondaryRoll
  ]);
  assert.deepEqual(chatMessages.at(-1).rolls, result.rolls);
  assert.match(chatMessages.at(-1).content, /Iniciativa principal/);
  assert.match(chatMessages.at(-1).content, /Iniciativa secundaria/);
});

test("Instinto suma +10 una vez en la iniciativa canónica", async () => {
  const animalium = createActor("instinto");
  animalium.system.identidad.raceId = "animalium";
  queueRoll("1d10 + @atributos.destreza", 7, [{
    faces: 10,
    results: [4]
  }]);
  queueRoll("1d10", 8, [{
    faces: 10,
    results: [8]
  }]);
  const result = await initiativeModule.rollMtrolInitiative(animalium);
  assert.equal(result.total, 25);
  assert.equal(result.initiativeEffects.appliedEffects.length, 1);
  assert.equal(result.initiativeEffects.appliedEffects[0].delta, 10);
});

test("card de dano conserva dano, cadena y localizacion sin lanzar dados", async () => {
  const damageRoll = MockRoll.fromData({
    formula: "1d6 + 2",
    terms: buildTerms([{ faces: 6, results: [5] }]),
    total: 7,
    evaluated: true
  });

  const criticalRoll = MockRoll.fromData({
    formula: "1d6",
    terms: buildTerms([{ faces: 6, results: [4] }]),
    total: 4,
    evaluated: true
  });

  const locationRoll = MockRoll.fromData({
    formula: "1d10",
    terms: buildTerms([{ faces: 10, results: [8] }]),
    total: 8,
    evaluated: true
  });

  const beforeEvaluations = evaluationCount;

  await combatCardModule.crearCombatCard({
    actor: createActor("atacante"),
    targetActor: createActor("objetivo"),
    damageRoll,
    resultadoDanio: {
      localizacionRoll: locationRoll,
      numeroLocalizacion: 8,
      zona: "piernas",
      danioOriginal: 15,
      hpNuevo: 10
    },
    evaluacionDanio: {
      detalles: ["Critico"],
      totalExtra: 8,
      extraRolls: [criticalRoll]
    },
    totalBaseDanio: 7,
    totalFinalDanio: 15
  });

  assert.deepEqual(chatMessages.at(-1).rolls, [
    damageRoll,
    criticalRoll,
    locationRoll
  ]);
  assert.equal(evaluationCount, beforeEvaluations);
  assert.match(chatMessages.at(-1).content, /Tirada de Daño/);
  assert.match(chatMessages.at(-1).content, /Cadena crítica de daño 1/);
  assert.match(chatMessages.at(-1).content, /Tirada de Localización/);
});

test("helper serializa y restaura terminos oficiales sin evaluar ni inventar desde total", async () => {
  const original = MockRoll.fromData({
    formula: "2d10 + 3",
    terms: buildTerms([{ faces: 10, results: [2, 8] }]),
    total: 13,
    evaluated: true
  });

  const beforeEvaluations = evaluationCount;
  const serialized =
    chatRollModule.mtrolSerializeRoll(original);

  const restored =
    chatRollModule.mtrolRestoreRoll(serialized);

  assert.deepEqual(
    restored.terms[0].results.map(entry => entry.result),
    [2, 8]
  );
  assert.equal(restored.total, 13);
  assert.equal(evaluationCount, beforeEvaluations);

  const beforeRestorations = restorationCount;

  assert.equal(
    chatRollModule.mtrolRestoreRoll({
      formula: "2d10 + 3",
      total: 13
    }),
    null
  );

  assert.equal(restorationCount, beforeRestorations);
});

test("helper acepta multiples Rolls, labels y no altera privacidad ni anima dados", async () => {
  const first = MockRoll.fromData({
    formula: "1d10",
    terms: buildTerms([{ faces: 10, results: [4] }]),
    total: 4,
    evaluated: true
  });

  const second = MockRoll.fromData({
    formula: "1d4",
    terms: buildTerms([{ faces: 4, results: [3] }]),
    total: 3,
    evaluated: true
  });

  const beforeEvaluations = evaluationCount;
  const beforeAnimations = diceAnimations.length;
  const prepared =
    await chatRollModule.mtrolPrepareChatRolls([
      { roll: first, label: "Primera" },
      { roll: second, label: "Segunda" }
    ]);

  const originalMessageData = {
    speaker: { actor: "actor" },
    whisper: ["gm"],
    blind: true,
    flags: {
      mtrol: {
        test: true
      }
    }
  };

  const finalMessageData = {
    ...originalMessageData,
    rolls: prepared.rolls,
    content: prepared.html
  };

  assert.deepEqual(prepared.rolls, [first, second]);
  assert.match(prepared.html, /Primera/);
  assert.match(prepared.html, /Segunda/);
  assert.deepEqual(finalMessageData.whisper, ["gm"]);
  assert.equal(finalMessageData.blind, true);
  assert.deepEqual(finalMessageData.flags, originalMessageData.flags);
  assert.equal(evaluationCount, beforeEvaluations);
  assert.equal(diceAnimations.length, beforeAnimations);
});

test("mensajes sin dados no reciben un desglose artificial", async () => {
  const beforeEvaluations = evaluationCount;
  const prepared =
    await chatRollModule.mtrolPrepareChatRolls([]);

  assert.deepEqual(prepared, {
    rolls: [],
    html: ""
  });
  assert.equal(evaluationCount, beforeEvaluations);
});

test("system.json conserva la versión declarada de release", async () => {
  const system = JSON.parse(
    await readFile(
      new URL("../system.json", import.meta.url),
      "utf8"
    )
  );

  assert.equal(system.version, "1.4.1");
});

test.after(() => {
  assert.equal(rollQueue.length, 0);
  assert.ok(renderCount > 0);
});
