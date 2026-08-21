import test from "node:test";
import assert from "node:assert/strict";

import {
  createDharmaSpendContext,
  getDharmaEligibleInitialDice
} from "../scripts/rolls/dharma-engine.js";

const queuedResults = [];
const createdMessages = [];
const warnings = [];
let evaluationCount = 0;

function parseFormula(formula) {
  const match = String(formula).match(/^(\d+)d(\d+)(?:\s*\+\s*(-?\d+))?$/i);
  if (!match) throw new Error(`Formula de prueba no soportada: ${formula}`);

  const number = Number(match[1]);
  const faces = Number(match[2]);
  const modifier = Number(match[3] ?? 0);
  const die = {
    number,
    faces,
    results: []
  };

  return {
    die,
    modifier,
    terms: modifier === 0
      ? [die]
      : [die, { operator: "+" }, { number: modifier }]
  };
}

class MockRoll {
  constructor(formula, data = {}) {
    const parsed = parseFormula(formula);
    this.formula = formula;
    this.data = data;
    this.terms = parsed.terms;
    this.dice = [parsed.die];
    this.modifier = parsed.modifier;
    this.total = null;
    this.evaluated = false;
  }

  async evaluate() {
    assert.equal(this.evaluated, false, "el Roll debe evaluarse una sola vez");
    const next = queuedResults.shift();
    assert.ok(next, `falta resultado para ${this.formula}`);
    assert.equal(next.formula, this.formula);
    assert.equal(next.results.length, this.dice[0].number);

    this.dice[0].results = next.results.map(result => ({
      result,
      active: true
    }));
    this.total = next.results.reduce((sum, result) => sum + result, 0) + this.modifier;
    this.evaluated = true;
    evaluationCount += 1;
    return this;
  }

  async render() {
    return `<div class="dice-roll">${this.total}</div>`;
  }

  toJSON() {
    return {
      class: "Roll",
      formula: this.formula,
      terms: this.terms,
      total: this.total,
      evaluated: this.evaluated
    };
  }
}

globalThis.Roll = MockRoll;
globalThis.foundry = {
  utils: {
    deepClone: value => structuredClone(value),
    duplicate: value => structuredClone(value),
    escapeHTML: value => String(value ?? ""),
    mergeObject: (target, source) => Object.assign(target, source)
  }
};
globalThis.game = {
  user: {
    id: "player",
    isGM: false
  },
  dice3d: null
};
globalThis.ui = {
  notifications: {
    warn: message => warnings.push(message),
    info() {}
  }
};
globalThis.ChatMessage = {
  getSpeaker: ({ actor }) => ({ actor: actor.id }),
  async create(data) {
    createdMessages.push(data);
    return data;
  }
};

const { mtrolRoll } = await import("../scripts/rolls/mtrol-rolls.js");
const { resolverCompetencia } =
  await import("../scripts/combat/competencia-engine.js");

function queue(formula, ...results) {
  queuedResults.push({ formula, results });
}

function buildActor(balance = 3) {
  return {
    id: "hero",
    uuid: "Actor.hero",
    name: "Heroe",
    img: "hero.webp",
    isOwner: true,
    items: [],
    system: {
      atributos: { fuerza: 3 },
      recursos: { dharma: balance, karma: 0 },
      vitales: {
        mp: { value: 10, max: 10 }
      },
      equipamiento: {
        manoDer: "",
        manoIzq: ""
      },
      orbs: []
    },
    getRollData() {
      return {};
    },
    getFlag() {
      return null;
    },
    async update(changes) {
      for (const [path, value] of Object.entries(changes)) {
        if (path === "system.recursos.dharma") this.system.recursos.dharma = value;
        if (path === "system.recursos.karma") this.system.recursos.karma = value;
      }
      return this;
    }
  };
}

function prepareContext(actor, formula, selectedIndex = 0) {
  const preview = new MockRoll(formula);
  const eligible = getDharmaEligibleInitialDice(preview);

  return createDharmaSpendContext({
    actorUuid: actor.uuid,
    selectedDice: [eligible[selectedIndex]],
    transactionId: `tx-${selectedIndex}-${formula}`
  });
}

function consumingStub(actor, events = []) {
  return async (_receivedActor, context) => {
    events.push("consume");
    assert.equal(_receivedActor, actor);
    assert.equal(actor.system.recursos.dharma >= context.cost, true);
    const before = actor.system.recursos.dharma;
    actor.system.recursos.dharma -= context.cost;

    return {
      authorized: true,
      actorUuid: actor.uuid,
      transactionId: context.transactionId,
      selectedIds: context.selectedIds,
      cost: context.cost,
      balanceBefore: before,
      balanceAfter: actor.system.recursos.dharma
    };
  };
}

test.beforeEach(() => {
  queuedResults.length = 0;
  createdMessages.length = 0;
  warnings.length = 0;
});

test("la ruta representativa sin Dharma conserva exactamente el comportamiento previo", async () => {
  const actor = buildActor(3);
  const beforeEvaluations = evaluationCount;
  let consumptionCalls = 0;
  queue("1d10 + 3", 7);

  const result = await mtrolRoll(
    "1d10 + 3",
    actor,
    "Fuerza",
    {},
    {
      consumeDharma: async () => {
        consumptionCalls += 1;
      }
    }
  );

  assert.equal(result.total, 10);
  assert.equal(result.dharmaBonus, 0);
  assert.equal(result.dharmaSpend, null);
  assert.equal(actor.system.recursos.dharma, 3);
  assert.equal(consumptionCalls, 0);
  assert.equal(evaluationCount - beforeEvaluations, 1);
  assert.equal(
    "dharma" in createdMessages.at(-1).flags.mtrol.rollCard,
    false,
    "la ruta normal no persiste metadatos de Dharma"
  );
});

test("consume inmediatamente antes de evaluar y aplica +1 al dado inicial elegido", async () => {
  const actor = buildActor(3);
  const formula = "1d10 + 3";
  const context = prepareContext(actor, formula);
  const events = [];
  queue(formula, 7);

  const originalEvaluate = MockRoll.prototype.evaluate;
  MockRoll.prototype.evaluate = async function (...args) {
    events.push("evaluate");
    return originalEvaluate.apply(this, args);
  };

  try {
    const result = await mtrolRoll(
      formula,
      actor,
      "Fuerza con Dharma",
      {},
      {
        dharmaSpend: context,
        consumeDharma: consumingStub(actor, events)
      }
    );

    assert.deepEqual(events, ["consume", "evaluate"]);
    assert.equal(result.total, 11);
    assert.equal(result.dharmaBonus, 1);
    assert.equal(actor.system.recursos.dharma, 2);
    assert.equal(result.dharmaSpend.context.state, "consumed");
    assert.deepEqual(result.dharmaSpend.traces.map(trace => ({
      natural: trace.naturalResult,
      effective: trace.effectiveResult,
      final: trace.finalResult
    })), [{ natural: 7, effective: 8, final: 8 }]);
    assert.deepEqual(
      createdMessages.at(-1).flags.mtrol.rollCard.dharma.traces.map(trace => ({
        natural: trace.naturalResult,
        effective: trace.effectiveResult,
        final: trace.finalResult
      })),
      [{ natural: 7, effective: 8, final: 8 }]
    );
    assert.equal(
      "transactionId" in createdMessages.at(-1).flags.mtrol.rollCard.dharma,
      false
    );
  } finally {
    MockRoll.prototype.evaluate = originalEvaluate;
  }
});

test("Dharma neutraliza la pifia inicial sin acreditar Karma", async () => {
  const actor = buildActor(2);
  const formula = "1d10 + 3";
  const context = prepareContext(actor, formula);
  queue(formula, 2);

  const result = await mtrolRoll(
    formula,
    actor,
    "Fuerza protegida",
    {},
    {
      dharmaSpend: context,
      consumeDharma: consumingStub(actor)
    }
  );

  assert.equal(result.pifia, false);
  assert.equal(result.total, 6);
  assert.equal(result.dharmaBonus, 1);
  assert.equal(actor.system.recursos.dharma, 1);
  assert.equal(actor.system.recursos.karma, 0);
  assert.equal(result.dharmaSpend.traces[0].fumblePrevented, true);
});

test("un critico protegido conserva su cadena y suma +1 solamente al finalizar", async () => {
  const actor = buildActor(2);
  const formula = "1d10 + 3";
  const context = prepareContext(actor, formula);
  queue(formula, 1);
  queue("1d10", 4);

  const result = await mtrolRoll(
    formula,
    actor,
    "Fuerza critica protegida",
    {},
    {
      dharmaSpend: context,
      consumeDharma: consumingStub(actor)
    }
  );

  assert.equal(result.critico, true);
  assert.equal(result.extra, 8);
  assert.equal(result.dharmaBonus, 1);
  assert.equal(result.total, 12);
  assert.equal(result.rolls.length, 2);
  assert.equal(result.dharmaSpend.traces[0].criticalResolvedResult, 8);
  assert.equal(result.dharmaSpend.traces[0].finalResult, 9);
  assert.equal(actor.system.recursos.dharma, 2, "consume uno y el critico natural acredita uno");
});

test("una seleccion invalida se detiene antes del consumo y antes de evaluar", async () => {
  const actor = buildActor(0);
  const formula = "1d10 + 3";
  const context = prepareContext({ ...actor, uuid: actor.uuid }, formula);
  let consumptionCalls = 0;
  const beforeEvaluations = evaluationCount;

  const result = await mtrolRoll(
    formula,
    actor,
    "Sin saldo",
    {},
    {
      dharmaSpend: context,
      consumeDharma: async () => {
        consumptionCalls += 1;
      }
    }
  );

  assert.equal(result, null);
  assert.equal(consumptionCalls, 0);
  assert.equal(evaluationCount, beforeEvaluations);
  assert.equal(queuedResults.length, 0);
  assert.match(warnings.at(-1), /Dharma insuficiente/);
});

test("fase 9: una pifia no protegida conserva precedencia global y el gasto comprometido", async () => {
  const actor = buildActor(3);
  const formula = "3d10 + 3";
  const preview = new MockRoll(formula);
  const eligible = getDharmaEligibleInitialDice(preview);
  const context = createDharmaSpendContext({
    actorUuid: actor.uuid,
    selectedDice: [eligible[0], eligible[1]],
    transactionId: "tx-global-fumble"
  });
  queue(formula, 2, 8, 2);

  const result = await mtrolRoll(
    formula,
    actor,
    "Pifia global",
    {},
    {
      dharmaSpend: context,
      consumeDharma: consumingStub(actor)
    }
  );

  assert.equal(result.pifia, true);
  assert.equal(result.total, 0);
  assert.equal(actor.system.recursos.dharma, 1, "consume exactamente los dos dados elegidos");
  assert.equal(actor.system.recursos.karma, 1, "solo la pifia no protegida acredita Karma");
  assert.deepEqual(
    result.dharmaSpend.traces.map(trace => ({
      natural: trace.naturalResult,
      effective: trace.effectiveResult,
      prevented: trace.fumblePrevented
    })),
    [
      { natural: 2, effective: 3, prevented: true },
      { natural: 8, effective: 9, prevented: false }
    ]
  );
});

test("fase 9: critico y bonus protegidos no rescatan una pifia real posterior", async () => {
  const actor = buildActor(3);
  const formula = "3d10 + 3";
  const eligible = getDharmaEligibleInitialDice(new MockRoll(formula));
  const context = createDharmaSpendContext({
    actorUuid: actor.uuid,
    selectedDice: [eligible[0], eligible[1]],
    transactionId: "tx-mixed-global-fumble"
  });
  queue(formula, 1, 7, 2);
  queue("1d10", 4);

  const result = await mtrolRoll(
    formula,
    actor,
    "Critico y pifia global",
    {},
    {
      dharmaSpend: context,
      consumeDharma: consumingStub(actor)
    }
  );

  assert.equal(result.pifia, true);
  assert.equal(result.total, 0);
  assert.equal(result.rolls.length, 2, "conserva la cadena real ya resuelta");
  assert.equal(actor.system.recursos.dharma, 2, "gasta dos y acredita el critico natural actual");
  assert.equal(actor.system.recursos.karma, 1);
});

test("fase 10: el Dharma inicial no protege una pifia producida por la cadena critica", async () => {
  const actor = buildActor(3);
  const formula = "1d10 + 3";
  const context = prepareContext(actor, formula);
  queue(formula, 1);
  queue("1d10", 2);

  const result = await mtrolRoll(
    formula,
    actor,
    "Cadena no protegida",
    {},
    {
      dharmaSpend: context,
      consumeDharma: consumingStub(actor)
    }
  );

  assert.equal(result.pifia, true);
  assert.equal(result.total, 0);
  assert.equal(result.rolls.length, 2);
  assert.equal(result.dharmaSpend.traces[0].naturalCritical, true);
  assert.equal(result.dharmaSpend.traces[0].requiresPostCriticalBonus, true);
  assert.equal(result.dharmaSpend.traces[0].criticalResolvedResult, null);
  assert.equal(actor.system.recursos.dharma, 3, "consume uno y conserva el Dharma ganado por el critico natural");
  assert.equal(actor.system.recursos.karma, 1, "la pifia de cadena acredita Karma normalmente");
});

test("fase 11: resolverCompetencia reutiliza el mismo contexto y motor sin duplicar reglas", async () => {
  const actor = buildActor(2);
  const formula = "2d10 + 3";
  const eligible = getDharmaEligibleInitialDice(new MockRoll(formula));
  const context = createDharmaSpendContext({
    actorUuid: actor.uuid,
    selectedDice: [eligible[1]],
    transactionId: "tx-competencia"
  });
  const gm = { id: "gm", isGM: true, active: true };
  const users = new Map([[gm.id, gm]]);
  const previousUser = game.user;
  const previousUsers = game.users;
  const previousModules = game.modules;
  const previousSystem = game.system;
  const previousFromUuid = globalThis.fromUuid;

  game.user = gm;
  game.users = {
    get: id => users.get(id),
    [Symbol.iterator]: () => users.values()
  };
  game.modules = { get: () => null };
  game.system = { id: "mtrol" };
  globalThis.fromUuid = async uuid => uuid === actor.uuid ? actor : null;
  queue(formula, 5, 5);

  try {
    const result = await resolverCompetencia({
      actor,
      item: {
        id: "skill",
        type: "competencia",
        name: "Atletismo",
        img: "skill.webp",
        system: {
          nivel: 1,
          categoria: "competencia",
          formula,
          requiresTarget: false,
          requiresOpposition: false
        }
      },
      dharmaSpend: context
    });

    assert.equal(result.resultadoCompetencia.total, 14);
    assert.equal(result.resultadoCompetencia.dharmaBonus, 1);
    assert.equal(result.resultadoCompetencia.dharmaSpend.traces[0].resultIndex, 1);
    assert.equal(actor.system.recursos.dharma, 1);
  } finally {
    game.user = previousUser;
    game.users = previousUsers;
    game.modules = previousModules;
    game.system = previousSystem;
    globalThis.fromUuid = previousFromUuid;
  }
});

test("fase 13: d20 máximo protegido supera el máximo físico sin clamp", async () => {
  const actor = buildActor(1);
  const formula = "1d20";
  const context = prepareContext(actor, formula);
  queue(formula, 20);

  const result = await mtrolRoll(formula, actor, "D20 con Dharma", {}, {
    dharmaSpend: context,
    consumeDharma: consumingStub(actor)
  });

  assert.equal(result.total, 21);
  assert.equal(result.dharmaSpend.traces[0].naturalResult, 20);
  assert.equal(result.dharmaSpend.traces[0].finalResult, 21);
  assert.equal(actor.system.recursos.dharma, 0);
});

test("fase 13: la pifia especial de d6 queda neutralizada antes de Karma", async () => {
  const actor = buildActor(1);
  const formula = "1d6";
  const context = prepareContext(actor, formula);
  queue(formula, 1);

  const result = await mtrolRoll(formula, actor, "D6 protegido", {}, {
    dharmaSpend: context,
    consumeDharma: consumingStub(actor)
  });

  assert.equal(result.pifia, false);
  assert.equal(result.total, 2);
  assert.equal(result.dharmaSpend.traces[0].fumblePrevented, true);
  assert.equal(actor.system.recursos.karma, 0);
  assert.equal(actor.system.recursos.dharma, 0);
});

test("fase 13: en 2d10 sólo la instancia seleccionada recibe Dharma", async () => {
  const actor = buildActor(1);
  const formula = "2d10";
  const context = prepareContext(actor, formula, 0);
  queue(formula, 5, 7);

  const result = await mtrolRoll(formula, actor, "Identidad individual", {}, {
    dharmaSpend: context,
    consumeDharma: consumingStub(actor)
  });

  assert.equal(result.total, 13);
  assert.deepEqual(
    result.roll.dice[0].results.map(entry => entry.result),
    [5, 7],
    "el Roll natural no se altera"
  );
  assert.equal(result.dharmaSpend.traces.length, 1);
  assert.equal(result.dharmaSpend.traces[0].resultIndex, 0);
  assert.equal(result.dharmaSpend.traces[0].finalResult, 6);
});

test("fase 13: tres selecciones consumen exactamente tres pese a mezclar crítico, pifia neutralizada y normal", async () => {
  const actor = buildActor(3);
  const formula = "3d10";
  const eligible = getDharmaEligibleInitialDice(new MockRoll(formula));
  const context = createDharmaSpendContext({
    actorUuid: actor.uuid,
    selectedDice: eligible,
    transactionId: "tx-three-outcomes"
  });
  queue(formula, 1, 2, 7);
  queue("1d10", 4);

  const result = await mtrolRoll(formula, actor, "Tres resultados", {}, {
    dharmaSpend: context,
    consumeDharma: consumingStub(actor)
  });

  assert.equal(result.pifia, false);
  assert.equal(result.total, 20);
  assert.equal(result.dharmaSpend.context.receipt.cost, 3);
  assert.equal(result.dharmaSpend.traces.length, 3);
  assert.equal(actor.system.recursos.dharma, 1, "saldo 3 - costo 3 + Dharma ganado por crítico");
  assert.equal(actor.system.recursos.karma, 0);
});

test("Fase 6: el bonus de Orbe se suma una sola vez al total normal del hechizo", async () => {
  const actor = buildActor(0);
  actor.system.orbs = [
    { id: "ignis-one", type: "ignis", level: 5 },
    { id: "aqua-one", type: "aqua", level: 4 }
  ];
  const item = {
    type: "competencia",
    system: { categoria: "hechizo", orbType: "ignis" }
  };
  queue("1d10 + 3", 7);

  const result = await mtrolRoll("1d10 + 3", actor, "Hechizo Ignis", {
    item,
    category: "hechizo"
  });

  assert.equal(result.total, 15);
  assert.equal(result.orbBonus, 5);
  assert.equal(result.roll.total, 10, "el Roll natural/evaluado no se modifica");
  assert.deepEqual(createdMessages.at(-1).flags.mtrol.rollCard.orbBonus, {
    type: "ignis",
    name: "Ignis",
    level: 5,
    levelName: "Primordial",
    bonus: 5
  });
  assert.match(createdMessages.at(-1).content, /Orbe Ignis V[\s\S]*\+5/);
});

test("Fase 6: crítico natural conserva cadena y recibe +2 sólo al total final", async () => {
  const actor = buildActor(0);
  actor.system.orbs = [{ id: "ignis-one", type: "ignis", level: 4 }];
  const item = {
    type: "competencia",
    system: { categoria: "hechizo", orbType: "ignis" }
  };
  queue("1d10 + 3", 1);
  queue("1d10", 4);

  const result = await mtrolRoll("1d10 + 3", actor, "Hechizo crítico", {
    item,
    category: "hechizo"
  });

  assert.equal(result.critico, true);
  assert.equal(result.extra, 8);
  assert.equal(result.orbBonus, 2);
  assert.equal(result.total, 13);
  assert.equal(result.roll.dice[0].results[0].result, 1);
});

test("Fase 6: pifia natural conserva total cero aunque el Orbe sea nivel 5", async () => {
  const actor = buildActor(0);
  actor.system.orbs = [{ id: "ignis-one", type: "ignis", level: 5 }];
  const item = {
    type: "competencia",
    system: { categoria: "hechizo", orbType: "ignis" }
  };
  queue("1d10 + 3", 2);

  const result = await mtrolRoll("1d10 + 3", actor, "Hechizo con pifia", {
    item,
    category: "hechizo"
  });

  assert.equal(result.pifia, true);
  assert.equal(result.total, 0);
  assert.equal(result.roll.dice[0].results[0].result, 2);
});

test("Fase 6: Dharma conserva su +1 y el Orbe suma después al total final", async () => {
  const actor = buildActor(1);
  actor.system.orbs = [{ id: "ignis-one", type: "ignis", level: 5 }];
  const item = {
    type: "competencia",
    system: { categoria: "hechizo", orbType: "ignis" }
  };
  const formula = "1d10 + 3";
  const context = prepareContext(actor, formula);
  queue(formula, 7);

  const result = await mtrolRoll(formula, actor, "Hechizo con Dharma", {
    item,
    category: "hechizo"
  }, {
    dharmaSpend: context,
    consumeDharma: consumingStub(actor)
  });

  assert.equal(result.dharmaBonus, 1);
  assert.equal(result.orbBonus, 5);
  assert.equal(result.total, 16);
  assert.equal(result.roll.dice[0].results[0].result, 7);
  assert.equal(result.dharmaSpend.traces[0].finalResult, 8);
});

test("Fase 7: pasiva de hechizo se suma después de Dharma y bonus de nivel", async () => {
  const actor = buildActor(1);
  actor.system.orbs = [
    { id: "mentem-one", type: "mentem", level: 5 }
  ];
  const item = {
    type: "competencia",
    system: {
      categoria: "hechizo",
      orbType: "mentem",
      spellTags: ["sensory"]
    }
  };
  const formula = "1d10 + 3";
  const context = prepareContext(actor, formula);
  queue(formula, 7);

  const result = await mtrolRoll(formula, actor, "Hechizo sensorial", { item }, {
    dharmaSpend: context,
    consumeDharma: consumingStub(actor)
  });

  assert.equal(result.roll.total, 10);
  assert.equal(result.dharmaBonus, 1);
  assert.equal(result.orbBonus, 5);
  assert.equal(result.orbPassiveBonus, 5);
  assert.equal(result.total, 21);
  assert.equal(result.roll.dice[0].results[0].result, 7);
  assert.deepEqual(createdMessages.at(-1).flags.mtrol.rollCard.orbPassiveBonus, {
    bonus: 5,
    sources: [{ orbType: "mentem", passiveName: "Fragmentum", bonus: 5 }]
  });
});

test("Fase 7: Aeris no altera dado natural y la pifia conserva total cero", async () => {
  const actor = buildActor(0);
  actor.system.orbs = [{ id: "aeris-one", type: "aeris", level: 1 }];
  const dodge = {
    type: "competencia",
    system: { actionType: "defense", defenseType: "dodge" }
  };
  queue("1d10 + 3", 2);

  const result = await mtrolRoll("1d10 + 3", actor, "Esquiva", { item: dodge });

  assert.equal(result.pifia, true);
  assert.equal(result.total, 0);
  assert.equal(result.roll.dice[0].results[0].result, 2);
});
