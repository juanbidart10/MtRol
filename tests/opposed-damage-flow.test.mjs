import test from "node:test";
import assert from "node:assert/strict";
import { getReceiptFromRuntime } from "../scripts/runtime/receipt-store.js";

let randomCounter = 0;
let messageCounter = 0;

const warnings = [];
const socketEvents = [];
const socketHandlers = new Map();
const chatMessages = [];
const hookHandlers = new Map();
const uuidRegistry = new Map();
const rollQueue = [];

function deepClone(value) {
  return value === undefined
    ? undefined
    : structuredClone(value);
}

globalThis.foundry = {
  utils: {
    randomID: () => `flow-${++randomCounter}`,
    deepClone,
    duplicate: deepClone,
    escapeHTML: value => String(value ?? ""),
    mergeObject: (target, source) => Object.assign(target, source)
  }
};

class MockRoll {
  constructor(formula) {
    this.formula = formula;
    this.total = null;
    this.dice = [];
  }

  async evaluate() {
    const next = rollQueue.shift();

    if (!next) {
      throw new Error(`No hay resultado simulado para ${this.formula}`);
    }

    assert.equal(next.formula, this.formula);
    this.total = next.total;

    const simpleDie = /^1d(\d+)$/i.exec(this.formula);

    if (simpleDie) {
      this.dice = [{
        faces: Number(simpleDie[1]),
        results: [{
          result: next.total,
          active: true
        }]
      }];
    }

    return this;
  }

  async render({ flavor = "" } = {}) {
    return `
      <div class="dice-roll">
        <div class="dice-flavor">${flavor}</div>
        <h4 class="dice-total">${this.total}</h4>
      </div>
    `;
  }

  toJSON() {
    return {
      class: "Roll",
      formula: this.formula,
      total: this.total,
      evaluated: true,
      terms: this.dice.map(die => ({
        class: "Die",
        number: die.results.length,
        faces: die.faces,
        results: deepClone(die.results)
      }))
    };
  }

  static fromData(data) {
    const roll = new MockRoll(data.formula);
    roll.total = data.total;
    roll.dice = (data.terms ?? [])
      .filter(term => term.class === "Die")
      .map(term => ({
        faces: term.faces,
        results: deepClone(term.results ?? [])
      }));
    return roll;
  }
}

globalThis.Roll = MockRoll;

class MockUsers {
  constructor(users) {
    this.users = users;
    this.byId = new Map(users.map(user => [user.id, user]));
  }

  get(id) {
    return this.byId.get(id) ?? null;
  }

  filter(callback) {
    return this.users.filter(callback);
  }

  some(callback) {
    return this.users.some(callback);
  }

  [Symbol.iterator]() {
    return this.users[Symbol.iterator]();
  }
}

const gmUser = {
  id: "gm-flow",
  isGM: true,
  active: true
};

const attackerOwner = {
  id: "attacker-owner",
  isGM: false,
  active: true
};

const defenderOwner = {
  id: "defender-owner",
  isGM: false,
  active: true
};

const combat = {
  id: "combat-flow",
  flags: {},
  async update(changes) {
    this.flags.mtrol ??= {};
    this.flags.mtrol.runtime = deepClone(changes["flags.mtrol.runtime"]);
    return this;
  }
};

globalThis.game = {
  user: gmUser,
  users: new MockUsers([
    gmUser,
    attackerOwner,
    defenderOwner
  ]),
  socket: {
    on(channel, handler) {
      socketHandlers.set(channel, handler);
    },
    emit(channel, data) {
      socketEvents.push({
        channel,
        data: deepClone(data)
      });
    }
  },
  dice3d: null,
  combat,
  combats: new Map([[combat.id, combat]]),
  messages: {
    get: id => chatMessages.find(message => message.id === id) ?? null
  },
  mtrol: {}
};

globalThis.ui = {
  notifications: {
    warn: message => warnings.push(message),
    info: () => {}
  }
};

globalThis.Hooks = {
  on(name, handler) {
    const handlers = hookHandlers.get(name) ?? [];
    handlers.push(handler);
    hookHandlers.set(name, handlers);
  }
};

globalThis.ChatMessage = {
  getSpeaker: ({ actor } = {}) => ({
    actor: actor?.id ?? null
  }),
  create: async data => {
    const message = {
      id: `flow-message-${++messageCounter}`,
      ...data,
      async update(changes) {
        Object.assign(message, changes);
        return message;
      }
    };

    chatMessages.push(message);
    return message;
  }
};

globalThis.fromUuid = async uuid =>
  uuidRegistry.get(uuid) ?? null;

class MockItems {
  constructor(items = []) {
    this.values = new Map(items.map(item => [item.id, item]));
  }

  get(id) {
    return this.values.get(id) ?? null;
  }

  find(callback) {
    return Array.from(this.values.values()).find(callback);
  }

  filter(callback) {
    return Array.from(this.values.values()).filter(callback);
  }

  map(callback) {
    return Array.from(this.values.values()).map(callback);
  }

  delete(id) {
    return this.values.delete(id);
  }

  [Symbol.iterator]() {
    return this.values.values();
  }
}

function setByPath(target, path, value) {
  const parts = path.split(".");
  let current = target;

  for (const part of parts.slice(0, -1)) {
    current[part] ??= {};
    current = current[part];
  }

  current[parts.at(-1)] = value;
}

function createItem({
  id,
  name = id,
  type = "competencia",
  categoria,
  tipoObjeto = "general",
  actionType = null,
  formula = "1d20",
  resolutionResult = null,
  defenseType = null,
  effect = null,
  requiresOpposition = false,
  danio = "",
  ejecutaDanio = true,
  usaDanioLocalizado = true,
  damageResolution,
  damageMode,
  damageCostType,
  damageType = null,
  equipado = false,
  slot = "",
  defensa = 0
}) {
  const item = {
    id,
    uuid: `Item.${id}`,
    name,
    type,
    system: {
      tipoObjeto,
      ...(categoria ? { categoria } : {}),
      actionType,
      formula,
      ...(resolutionResult ? { resolutionResult } : {}),
      defenseType,
      effect,
      requiresOpposition,
      oppositionType: "free",
      effectDuration: 1,
      effectIntensity: 0,
      danio,
      damageFormula: danio,
      ejecutaDanio,
      usaDanioLocalizado,
      ...(damageResolution ? { damageResolution } : {}),
      ...(damageMode ? { damageMode } : {}),
      ...(damageCostType ? { damageCostType } : {}),
      damageType,
      equipado,
      slot,
      defensa,
      defensaBase: defensa,
      peso: 1,
      cantidad: 1
    },
    async update(changes) {
      for (const [path, value] of Object.entries(changes)) {
        setByPath(item, path, value);
      }

      return item;
    }
  };

  uuidRegistry.set(item.uuid, item);
  return item;
}

function createActor({
  id,
  ownerIds = [],
  items = [],
  hp = 20,
  mp = 30,
  equipment = {}
}) {
  const actor = {
    id,
    uuid: `Actor.${id}`,
    name: id,
    type: "personaje",
    ownerIds: new Set(ownerIds),
    system: {
      identidad: { classId: "guerrero" },
      atributos: {
        fuerza: 3
      },
      vitales: {
        hp: {
          value: hp,
          max: hp
        },
        mp: {
          value: mp,
          max: mp
        }
      },
      recursos: {
        dharma: 0,
        karma: 0
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
        manoDer: "",
        extra: "",
        ...equipment
      }
    },
    flags: {
      mtrol: {
        mpStacks: {}
      }
    },
    items: new MockItems(items),
    get isOwner() {
      return game.user?.isGM || actor.ownerIds.has(game.user?.id);
    },
    testUserPermission(user, level) {
      return level === "OWNER" && (
        user?.isGM || actor.ownerIds.has(user?.id)
      );
    },
    getRollData() {
      return deepClone(actor.system);
    },
    getFlag(scope, key) {
      return actor.flags?.[scope]?.[key];
    },
    async setFlag(scope, key, value) {
      actor.flags[scope] ??= {};
      actor.flags[scope][key] = deepClone(value);
    },
    getActiveTokens() {
      return [];
    },
    async update(changes) {
      for (const [path, value] of Object.entries(changes)) {
        setByPath(actor, path, value);
      }

      return actor;
    },
    async deleteEmbeddedDocuments(documentName, ids) {
      assert.equal(documentName, "Item");

      for (const idToDelete of ids) {
        actor.items.delete(idToDelete);
      }

      return ids;
    }
  };

  uuidRegistry.set(actor.uuid, actor);
  return actor;
}

function createAttackSkill(id, {
  categoria,
  ejecutaDanio = true,
  danio = "1d6",
  damageResolution,
  damageMode,
  damageCostType,
  resolutionResult = "damage"
} = {}) {
  return createItem({
    id,
    name: `Ataque ${id}`,
    categoria,
    actionType: "attack",
    resolutionResult,
    damageType: "physical",
    effect: "damage",
    requiresOpposition: true,
    danio,
    ejecutaDanio,
    damageResolution,
    damageMode,
    damageCostType
  });
}

function createDefenseSkill(id) {
  return createItem({
    id,
    name: `Defensa ${id}`,
    actionType: "defense",
    resolutionResult: "movement",
    defenseType: "dodge",
    effect: "none"
  });
}

function createArmor(id, defensa = 4) {
  return createItem({
    id,
    name: `Armadura ${id}`,
    type: "objeto",
    tipoObjeto: "armadura",
    equipado: true,
    slot: "pecho",
    defensa
  });
}

function queueRoll(formula, total) {
  rollQueue.push({
    formula,
    total
  });
}

const actionModule =
  await import("../scripts/actions/action-engine.js");

const damageModule =
  await import("../scripts/actions/action-damage-engine.js");

const mpModule =
  await import("../scripts/combat/mp-engine.js");

const socketModule =
  await import("../scripts/core/sockets.js");

const runtimeFoundation =
  await import("../scripts/runtime/runtime-foundation.js");

const turnModule = await import("../scripts/combat/turn-system.js");
const presentationModule = await import("../scripts/actions/pending-action-presentation.js");

game.mtrol.actions = {
  getPendingAction: actionModule.getPendingAction,
  serializePendingAction: actionModule.serializePendingAction,
  receivePendingActionSync: actionModule.receivePendingActionSync,
  receivePendingActionCleared: actionModule.receivePendingActionCleared
};

async function createPending({
  suffix,
  attackerTotal,
  attackerMP = 30,
  categoria,
  ejecutaDanio = true,
  danio = "1d6",
  damageResolution,
  damageMode,
  damageCostType,
  resolutionResult,
  activateSource = false,
  defender = null
}) {
  const attackSkill = createAttackSkill(
    `attack-${suffix}`,
    {
      categoria,
      ejecutaDanio,
      danio,
      damageResolution,
      damageMode,
      damageCostType,
      resolutionResult
    }
  );

  const attacker = createActor({
    id: `attacker-${suffix}`,
    mp: attackerMP,
    ownerIds: [attackerOwner.id],
    items: [attackSkill]
  });

  const target = defender ?? createActor({
    id: `defender-${suffix}`,
    ownerIds: [defenderOwner.id],
    items: [createDefenseSkill(`defense-${suffix}`)]
  });

  let combatant = null;
  if (activateSource) {
    turnModule.configureTurnActionIntegration({
      getPendingOppositionForActor: actionModule.getPendingOppositionForActor,
      getReactionMovementForActor: actionModule.getReactionMovementForActor,
      completeReactionMovementAuthoritative: actionModule.completeReactionMovementAuthoritative
    });
    combatant = {
      id: `combatant-${suffix}`,
      actor: attacker,
      flags: { mtrol: {} },
      getFlag(scope, key) { return this.flags[scope]?.[key]; },
      async setFlag(scope, key, value) {
        this.flags[scope] ??= {};
        this.flags[scope][key] = deepClone(value);
      }
    };
    Object.assign(combat, {
      started: true,
      round: 1,
      turn: 0,
      combatant,
      combatants: [combatant],
      turns: [combatant],
      nextTurnCalls: 0,
      async nextTurn() { this.nextTurnCalls += 1; }
    });
    await turnModule.startCombatantTurnAuthoritative(combatant, turnModule.getTurnContext());
  }

  const pending =
    await actionModule.createPendingActionAuthoritative({
      sourceActorId: attacker.id,
      sourceActorUuid: attacker.uuid,
      sourceItemId: attackSkill.id,
      sourceItemName: attackSkill.name,
      targetActorId: target.id,
      targetActorUuid: target.uuid,
      attackerRoll: {
        total: attackerTotal
      },
      damage: {
        available: true,
        formula: "99d99"
      }
    }, {
      requestingUserId: attackerOwner.id
    });

  return {
    pending,
    attacker,
    defender: target,
    attackSkill,
    combatant
  };
}

async function defend({
  pending,
  defender,
  total,
  defenseSkill = null
}) {
  const item = defenseSkill ??
    defender.items.find(candidate => candidate.system?.actionType === "defense");

  return actionModule.attachDefenseRollAuthoritative({
    pendingActionId: pending.id,
    defenderActorUuid: defender.uuid,
    defenseItemId: item.id,
    defenderRoll: {
      total
    },
    requestingUserId: defenderOwner.id
  });
}

function resolutionMessageFor(pendingActionId) {
  return chatMessages.findLast(message =>
    message.flags?.mtrol?.pendingActionId === pendingActionId
  );
}

test("la matriz ataque/defensa/desempate controla el boton DANIO", async () => {
  async function runCase({
    suffix,
    attackerTotal,
    defenderTotal,
    tie = null,
    expectedButton,
    expectedReason
  }) {
    const context = await createPending({
      suffix,
      attackerTotal
    });

    if (tie !== null) queueRoll("1d10", tie);

    const result = await defend({
      pending: context.pending,
      defender: context.defender,
      total: defenderTotal
    });

    const message = resolutionMessageFor(context.pending.id);

    assert.equal(result.resolutionResult.reason, expectedReason);
    assert.equal(
      message.content.includes('data-action="mtrol-resolved-damage"'),
      expectedButton
    );
    if (expectedButton) {
      assert.equal(
        message.content.includes(`data-pending-action-id="${context.pending.id}"`),
        true
      );
    }

    return context;
  }

  await runCase({
    suffix: "attacker-higher",
    attackerTotal: 9,
    defenderTotal: 4,
    expectedButton: true,
    expectedReason: "attacker-higher"
  });

  await runCase({
    suffix: "defender-higher",
    attackerTotal: 4,
    defenderTotal: 9,
    expectedButton: false,
    expectedReason: "defender-higher"
  });

  await runCase({
    suffix: "tie-attacker",
    attackerTotal: 7,
    defenderTotal: 7,
    tie: 4,
    expectedButton: true,
    expectedReason: "tie-attacker"
  });

  await runCase({
    suffix: "tie-defender",
    attackerTotal: 7,
    defenderTotal: 7,
    tie: 8,
    expectedButton: false,
    expectedReason: "tie-defender"
  });
});

test("Esquiva ganadora crea un permiso reactivo independiente de un cuadro", async () => {
  const context = await createPending({
    suffix: "dodge-movement",
    attackerTotal: 4
  });
  await defend({
    pending: context.pending,
    defender: context.defender,
    total: 37
  });
  assert.deepEqual(actionModule.getReactionMovementForActor(context.defender), {
    pendingActionId: context.pending.id,
    allowance: 1,
    tokenUuid: null
  });
  assert.equal(context.pending.reactionMovement.status, "available");
});

test("Esquiva perdedora no concede movimiento reactivo", async () => {
  const context = await createPending({
    suffix: "dodge-loses",
    attackerTotal: 9
  });
  await defend({
    pending: context.pending,
    defender: context.defender,
    total: 4
  });
  assert.equal(context.pending.reactionMovement, null);
  assert.equal(actionModule.getReactionMovementForActor(context.defender), null);
});

test("movement enfrentado ganador concede al target, conserva turno y publica snapshot", async t => {
  const context = await createPending({
    suffix: "canonical-target-movement",
    attackerTotal: 27,
    resolutionResult: "movement",
    activateSource: true,
    ejecutaDanio: false,
    danio: ""
  });
  t.after(() => {
    for (const key of ["started", "round", "turn", "combatant", "combatants", "turns", "nextTurn"]) {
      delete combat[key];
    }
  });
  await defend({ pending: context.pending, defender: context.defender, total: 4 });
  const current = actionModule.getPendingAction(context.pending.id);
  assert.equal(current.winnerResolutionResult, "movement");
  assert.equal(current.movementGrant.granted, 2);
  assert.equal(current.movementGrant.targetActorUuid, context.defender.uuid);
  assert.equal(turnModule.getGrantedMovement(context.defender).remaining, 2);
  assert.equal(combat.nextTurnCalls, 0);
  assert.match(resolutionMessageFor(current.id).content, new RegExp(`${context.defender.name} obtiene 2 cuadro\\(s\\) de movimiento`));
});

test("declaración de respuesta persiste antes de tirar y recovery conserva su preset", async () => {
  const context = await createPending({
    suffix: "declared-before-roll",
    attackerTotal: 7
  });
  const responseItem = context.defender.items.find(candidate =>
    candidate.system?.defenseType === "dodge"
  );
  await actionModule.declareOppositionResponseAuthoritative({
    pendingActionId: context.pending.id,
    defenderActorUuid: context.defender.uuid,
    responseItemId: responseItem.id,
    selectedCapability: "DODGE",
    mode: "auric",
    requestingUserId: defenderOwner.id,
    transactionId: "declare-before-roll"
  });
  assert.equal(context.pending.status, "waiting-defense");
  assert.equal(context.pending.defenderRoll, null);
  assert.equal(context.pending.responseDeclaration.selectedCapability, "DODGE");
  assert.equal(context.pending.responseDeclaration.mode, "auric");

  actionModule.receivePendingActionCleared(context.pending.id);
  const runtime = runtimeFoundation.runtimeRepository.read(game.combat);
  await actionModule.hydratePendingActionsFromRuntime(runtime, game.combat);
  const recovered = actionModule.getPendingAction(context.pending.id);
  assert.equal(recovered.responseDeclaration.itemUuid, responseItem.uuid);
  assert.equal(recovered.responseDeclaration.selectedCapability, "DODGE");
  assert.equal(recovered.responseDeclaration.mode, "auric");
});

test("acción ofensiva sin dominio mecánico se rechaza sin fallback", async () => {
  const attackSkill = createItem({
    id: "attack-without-domain",
    name: "Ataque sin dominio",
    actionType: "attack",
    effect: "damage",
    requiresOpposition: true,
    danio: "1d6"
  });
  const attacker = createActor({
    id: "attacker-without-domain",
    ownerIds: [attackerOwner.id],
    items: [attackSkill]
  });
  const defender = createActor({
    id: "defender-without-domain",
    ownerIds: [defenderOwner.id]
  });
  await assert.rejects(
    actionModule.createPendingActionAuthoritative({
      sourceActorId: attacker.id,
      sourceActorUuid: attacker.uuid,
      sourceItemId: attackSkill.id,
      targetActorId: defender.id,
      targetActorUuid: defender.uuid,
      attackerRoll: { total: 8 }
    }, { requestingUserId: attackerOwner.id }),
    /actionDomain válido/
  );
});

test("Contraataque ganador crea un derecho manual contra el atacante", async () => {
  const counterattack = createItem({
    id: "counterattack-response",
    name: "Contraataque",
    categoria: "contraataque",
    actionType: "attack",
    effect: "damage",
    danio: "1d6",
    ejecutaDanio: true,
    damageResolution: "immediate",
    damageMode: "automatic",
    damageType: "physical"
  });
  const defender = createActor({
    id: "counterattack-defender",
    ownerIds: [defenderOwner.id],
    items: [counterattack]
  });
  const context = await createPending({
    suffix: "counterattack",
    attackerTotal: 4,
    defender
  });
  const result = await defend({
    pending: context.pending,
    defender,
    total: 9,
    defenseSkill: counterattack
  });
  assert.equal(result.resolutionResult.success, false);
  assert.equal(context.attacker.system.vitales.hp.value, 20);
  assert.equal(context.pending.damage.sourceActorUuid, defender.uuid);
  assert.equal(context.pending.damage.targetActorUuid, context.attacker.uuid);
  assert.equal(context.pending.damage.status, "available");
  queueRoll("1d6", 6);
  queueRoll("1d10", 5);
  await damageModule.executeResolvedDamageAuthoritative(context.pending.id, {
    requestingUserId: defenderOwner.id
  });
  assert.equal(context.attacker.system.vitales.hp.value, 14);
  assert.equal(context.pending.damage.status, "rolled");
});

test("un ataque sin objetivo no crea una accion pendiente", async () => {
  const attackSkill = createAttackSkill("attack-no-target");
  const attacker = createActor({
    id: "attacker-no-target",
    ownerIds: [attackerOwner.id],
    items: [attackSkill]
  });
  const countBefore = actionModule.listPendingActions().length;

  const pending =
    await actionModule.createPendingActionFromCompetencia({
      actor: attacker,
      item: attackSkill,
      targetToken: null,
      attackerRoll: {
        total: 8
      },
      damage: {
        available: true,
        formula: "1d6"
      }
    });

  assert.equal(pending, null);
  assert.equal(actionModule.listPendingActions().length, countBefore);
  assert.match(warnings.at(-1), /necesita un objetivo/i);
});

test("dos combates simultaneos conservan su pendingActionId", async () => {
  const defenseSkill = createDefenseSkill("shared-defense");
  const defender = createActor({
    id: "shared-defender",
    ownerIds: [defenderOwner.id],
    items: [defenseSkill]
  });

  const first = await createPending({
    suffix: "simultaneous-a",
    attackerTotal: 9,
    defender
  });
  const second = await createPending({
    suffix: "simultaneous-b",
    attackerTotal: 3,
    defender
  });

  const secondResult = await actionModule.attachDefenseRollForActor({
    actor: defender,
    item: defenseSkill,
    defenderRoll: {
      total: 5
    },
    pendingActionId: second.pending.id
  });

  const firstResult = await actionModule.attachDefenseRollForActor({
    actor: defender,
    item: defenseSkill,
    defenderRoll: {
      total: 5
    },
    pendingActionId: first.pending.id
  });

  assert.equal(secondResult.reason, "defender-higher");
  assert.equal(firstResult.reason, "attacker-higher");
  assert.equal(second.pending.defenderRoll.total, 5);
  assert.equal(first.pending.defenderRoll.total, 5);
});

test("resolutionResult damage prevalece sobre el flag legacy ejecutaDanio", async () => {
  const context = await createPending({
    suffix: "disabled-damage",
    attackerTotal: 9,
    ejecutaDanio: false
  });

  await defend({
    pending: context.pending,
    defender: context.defender,
    total: 4
  });

  const message = resolutionMessageFor(context.pending.id);

  assert.equal(context.pending.damage.available, true);
  assert.equal(context.pending.damage.status, "available");
  assert.match(message.content, /mtrol-resolved-damage/);
});

test("doble ejecucion aplica dano sin armadura una sola vez", async () => {
  const context = await createPending({
    suffix: "double-damage",
    attackerTotal: 9
  });

  await defend({
    pending: context.pending,
    defender: context.defender,
    total: 4
  });

  queueRoll("1d6", 6);
  queueRoll("1d10", 5);

  const attempts = await Promise.allSettled([
    damageModule.executeResolvedDamageAuthoritative(
      context.pending.id,
      { requestingUserId: attackerOwner.id }
    ),
    damageModule.executeResolvedDamageAuthoritative(
      context.pending.id,
      { requestingUserId: attackerOwner.id }
    )
  ]);

  assert.equal(
    attempts.filter(attempt => attempt.status === "fulfilled").length,
    1
  );
  assert.equal(
    attempts.filter(attempt => attempt.status === "rejected").length,
    1
  );
  assert.equal(context.defender.system.vitales.hp.value, 14);
  assert.equal(context.pending.damage.status, "rolled");
  assert.equal(context.pending.damage.rolled, true);
  assert.doesNotMatch(
    resolutionMessageFor(context.pending.id).content,
    /mtrol-resolved-damage/
  );
});

test("Explosión declarativa cobra el Básico adicional sólo al ejecutar daño y bloquea doble click", async () => {
  const context = await createPending({
    suffix: "configured-phased-cost",
    categoria: "hechizo",
    attackerMP: 10,
    attackerTotal: 9,
    damageResolution: "onOppositionWin",
    damageMode: "enabled",
    damageCostType: "basic"
  });


  assert.equal(context.attacker.system.vitales.mp.value, 9, "la fase principal cobra Hechizo Nivel 1");

  await defend({
    pending: context.pending,
    defender: context.defender,
    total: 4
  });

  assert.equal(context.attacker.system.vitales.mp.value, 9, "ganar y habilitar no cobra");
  assert.equal(context.pending.damage.additionalCostApplied, false);

  queueRoll("1d6", 6);
  queueRoll("1d10", 5);

  await damageModule.executeResolvedDamageAuthoritative(
    context.pending.id,
    { requestingUserId: attackerOwner.id }
  );

  assert.equal(context.attacker.system.vitales.mp.value, 8);
  assert.equal(context.pending.damage.additionalCostApplied, true);

  await assert.rejects(
    damageModule.executeResolvedDamageAuthoritative(
      context.pending.id,
      { requestingUserId: attackerOwner.id }
    ),
    /ya fue ejecutado/
  );

  assert.equal(context.attacker.system.vitales.mp.value, 8, "doble click no vuelve a cobrar");
  assert.equal(context.defender.system.vitales.hp.value, 14, "doble click no vuelve a dañar");
});

test("Competencia con Básico cobra al activar y la resolución no duplica el +1", async () => {
  const context = await createPending({
    suffix: "competence-basic-on-activation",
    attackerMP: 10,
    attackerTotal: 9,
    categoria: "competencia",
    damageResolution: "onOppositionWin",
    damageMode: "enabled",
    damageCostType: "basic"
  });

  const activation = getReceiptFromRuntime(
    combat.flags.mtrol.runtime,
    context.pending.activationCostTransactionId
  ).result;
  assert.equal(activation.costoStack, 1);
  assert.equal(activation.costoBasico, 1);
  assert.equal(activation.costoTotal, 2);
  assert.equal(context.attacker.system.vitales.mp.value, 8);
  assert.equal(context.pending.damage.basicCostIncludedInActivation, true);
  assert.equal(context.pending.damage.additionalMpCost, 0);

  await defend({
    pending: context.pending,
    defender: context.defender,
    total: 4
  });

  queueRoll("1d6", 6);
  queueRoll("1d10", 5);
  await damageModule.executeResolvedDamageAuthoritative(
    context.pending.id,
    { requestingUserId: attackerOwner.id }
  );

  assert.equal(context.attacker.system.vitales.mp.value, 8);
  assert.equal(context.pending.damage.additionalCostApplied, false);
});

test("perder oposición no cobra el costo adicional configurado", async () => {
  const context = await createPending({
    suffix: "configured-loss",
    categoria: "hechizo",
    attackerMP: 10,
    attackerTotal: 3,
    damageResolution: "onOppositionWin",
    damageMode: "enabled",
    damageCostType: "basic"
  });


  assert.equal(context.attacker.system.vitales.mp.value, 9);

  await defend({
    pending: context.pending,
    defender: context.defender,
    total: 12
  });

  assert.equal(context.attacker.system.vitales.mp.value, 9);
  assert.equal(context.pending.damage.additionalCostApplied, false);
  assert.equal(context.defender.system.vitales.hp.value, 20);
});

test("una configuración legacy automática migra a lanzamiento manual", async () => {
  const context = await createPending({
    suffix: "configured-automatic",
    attackerTotal: 9,
    damageResolution: "onOppositionWin",
    damageMode: "automatic",
    damageCostType: "basic"
  });

  context.attacker.system.vitales.mp.value = 9;
  context.attacker.system.vitales.mp.max = 10;
  await defend({
    pending: context.pending,
    defender: context.defender,
    total: 4
  });

  assert.equal(context.pending.damage.status, "available");
  assert.equal(context.attacker.system.vitales.mp.value, 9);
  assert.equal(context.defender.system.vitales.hp.value, 20);
  assert.match(resolutionMessageFor(context.pending.id).content, /mtrol-resolved-damage/);
  queueRoll("1d6", 5);
  queueRoll("1d10", 5);
  await damageModule.executeResolvedDamageAuthoritative(context.pending.id, {
    requestingUserId: attackerOwner.id
  });
  assert.equal(context.attacker.system.vitales.mp.value, 8);
  assert.equal(context.defender.system.vitales.hp.value, 15);
});

test("daño inmediato queda rechazado antes de crear una resolución", async () => {
  const skill = createItem({
    id: "immediate-enabled-skill",
    name: "Habilidad configurada",
    actionType: "attack",
    effect: "damage",
    requiresOpposition: false,
    danio: "1d6",
    damageResolution: "immediate",
    damageMode: "enabled",
    damageCostType: "basic"
  });
  const attacker = createActor({
    id: "immediate-enabled-attacker",
    ownerIds: [attackerOwner.id],
    items: [skill],
    mp: 9
  });
  const defender = createActor({
    id: "immediate-enabled-target",
    ownerIds: [defenderOwner.id]
  });

  await assert.rejects(actionModule.createReadyDamageActionFromCompetencia({
    actor: attacker,
    item: skill,
    targetToken: {
      id: "immediate-target-token",
      uuid: "Scene.test.Token.immediate-target-token",
      actor: defender
    },
    attackerRoll: { total: 7 },
    damage: {
      available: true,
      formula: "1d6",
      costoTotal: 1
    }
  }), /daño directo está deshabilitado/i);
  assert.equal(attacker.system.vitales.mp.value, 9);
  assert.equal(defender.system.vitales.hp.value, 20);
});

test("Cancelar Daño es sólo GM, no tira dados y deja auditoría", async () => {
  const context = await createPending({ suffix: "gm-cancel", attackerTotal: 9 });
  await defend({ pending: context.pending, defender: context.defender, total: 4 });
  await assert.rejects(
    damageModule.cancelResolvedDamageAuthoritative(context.pending.id, {
      requestingUserId: attackerOwner.id
    }),
    /Sólo un GM/
  );
  await damageModule.cancelResolvedDamageAuthoritative(context.pending.id, {
    requestingUserId: gmUser.id
  });
  assert.equal(context.pending.damage.status, "cancelled");
  assert.equal(context.pending.damage.cancelledByUserId, gmUser.id);
  assert.equal(context.defender.system.vitales.hp.value, 20);
  assert.match(resolutionMessageFor(context.pending.id).content, /Daño cancelado por GM/);
});

test("pifia de damageFormula consume el derecho sin tocar armadura ni HP", async () => {
  const armor = createArmor("fumble-armor", 20);
  const defender = createActor({
    id: "fumble-target",
    ownerIds: [defenderOwner.id],
    items: [createDefenseSkill("fumble-defense"), armor],
    equipment: { extra: armor.id }
  });
  const context = await createPending({ suffix: "damage-fumble", attackerTotal: 9, defender });
  await defend({ pending: context.pending, defender, total: 4 });
  queueRoll("1d6", 1);
  queueRoll("1d10", 10);
  const result = await damageModule.executeResolvedDamageAuthoritative(context.pending.id, {
    requestingUserId: attackerOwner.id
  });
  assert.equal(result.fumble, true);
  assert.equal(result.totalFinalDanio, 0);
  assert.equal(context.pending.damage.status, "rolled");
  assert.equal(armor.system.defensa, 20);
  assert.equal(defender.system.vitales.hp.value, 20);
});

test("dano localizado consume armadura y transmite sobrante a HP", async () => {
  const armor = createArmor("armor-damage", 4);
  const defenseSkill = createDefenseSkill("armor-defense");
  const defender = createActor({
    id: "armor-defender",
    ownerIds: [defenderOwner.id],
    items: [defenseSkill, armor],
    equipment: {
      pecho: armor.id
    }
  });
  const context = await createPending({
    suffix: "armor-damage",
    attackerTotal: 9,
    defender
  });

  await defend({
    pending: context.pending,
    defender,
    total: 4,
    defenseSkill
  });

  queueRoll("1d6", 6);
  queueRoll("1d10", 5);

  const result =
    await damageModule.executeResolvedDamageAuthoritative(
      context.pending.id,
      { requestingUserId: attackerOwner.id }
    );

  assert.equal(result.resultadoDanio.slot, "pecho");
  assert.equal(result.resultadoDanio.danioAbsorbido, 4);
  assert.equal(result.resultadoDanio.hpPerdido, 2);
  assert.equal(result.resultadoDanio.itemDestruido, true);
  assert.equal(defender.system.vitales.hp.value, 18);
  assert.equal(defender.system.equipamiento.pecho, "");
  assert.equal(defender.items.get(armor.id), null);
});

test("pasivas modifican un único total antes de localización, armadura y HP", async () => {
  const armor = createArmor("orb-pipeline-armor", 10);
  const defenseSkill = createDefenseSkill("orb-pipeline-defense");
  const defender = createActor({
    id: "orb-pipeline-defender",
    ownerIds: [defenderOwner.id],
    items: [defenseSkill, armor],
    hp: 200,
    equipment: { pecho: armor.id }
  });
  defender.system.orbs = [{ id: "corpus-one", type: "corpus", level: 1 }];

  const context = await createPending({
    suffix: "orb-pipeline",
    attackerTotal: 9,
    defender
  });
  context.attacker.system.orbs = [
    { id: "ignis-one", type: "ignis", level: 1 },
    { id: "oscuritae-one", type: "oscuritae", level: 5 }
  ];
  context.attackSkill.system.damageType = "physical";
  context.attackSkill.system.damageElement = "fire";

  await defend({ pending: context.pending, defender, total: 4, defenseSkill });
  queueRoll("1d6", 100);
  queueRoll("1d10", 5);

  const result = await damageModule.executeResolvedDamageAuthoritative(
    context.pending.id,
    { requestingUserId: attackerOwner.id }
  );

  assert.equal(result.totalFinalDanio, 104, "100 → Ignis 105 → Oscuritae 110 → Corpus 104");
  assert.equal(result.resultadoDanio.danioOriginal, 104);
  assert.equal(result.resultadoDanio.danioAbsorbido, 10);
  assert.equal(result.resultadoDanio.hpPerdido, 94);
  assert.equal(defender.system.vitales.hp.value, 106);
});

test("un fallo de ejecución conserva el derecho y permite reintentar", async () => {
  const context = await createPending({
    suffix: "failed-damage",
    attackerTotal: 9,
    danio: "formula-invalida",
    damageResolution: "onOppositionWin",
    damageMode: "enabled",
    damageCostType: "basic"
  });

  context.attacker.system.vitales.mp.value = 9;

  await defend({
    pending: context.pending,
    defender: context.defender,
    total: 4
  });

  await assert.rejects(
    damageModule.executeResolvedDamageAuthoritative(
      context.pending.id,
      { requestingUserId: attackerOwner.id }
    ),
    /Formula de dano invalida/
  );

  assert.equal(context.pending.damage.status, "available");
  assert.equal(context.attacker.system.vitales.mp.value, 9, "el costo adicional se reembolsa si el daño no puede ejecutarse");
  assert.equal(context.defender.system.vitales.hp.value, 20);
  assert.match(
    resolutionMessageFor(context.pending.id).content,
    /No se pudo completar el daño/
  );

  context.attackSkill.system.damageFormula = "1d6";
  queueRoll("1d6", 5);
  queueRoll("1d10", 5);
  await damageModule.executeResolvedDamageAuthoritative(context.pending.id, {
    requestingUserId: attackerOwner.id
  });
  assert.equal(context.defender.system.vitales.hp.value, 15);
});

test("Owner atacante inicia por socket y el GM ejecuta el dano autoritativo", async () => {
  const context = await createPending({
    suffix: "owner-to-gm",
    attackerTotal: 9
  });

  await defend({
    pending: context.pending,
    defender: context.defender,
    total: 4
  });

  socketModule.registerMtrolSockets();

  queueRoll("1d6", 5);
  queueRoll("1d10", 5);

  await socketHandlers.get("system.mtrol")({
    action: "mtrolExecuteResolvedDamage",
    requestId: "owner-damage-request",
    requestingUserId: attackerOwner.id,
    targetGMId: gmUser.id,
    payload: {
      pendingActionId: context.pending.id
    }
  }, attackerOwner.id);

  const response = socketEvents.findLast(event =>
    event.data?.action === "mtrolSocketResponse" &&
    event.data?.requestId === "owner-damage-request"
  );

  assert.equal(response.data.ok, true);
  assert.equal(response.data.targetUserId, attackerOwner.id);
  assert.equal(response.data.result.damageResult.totalFinalDanio, 5);
  assert.equal(context.defender.system.vitales.hp.value, 15);
  assert.equal(context.pending.damage.lastUserId, attackerOwner.id);
});

test("sin GM el Owner no altera el estado ni aplica dano", async () => {
  const context = await createPending({
    suffix: "damage-without-gm",
    attackerTotal: 9
  });

  await defend({
    pending: context.pending,
    defender: context.defender,
    total: 4
  });

  const previousUser = game.user;
  const previousUsers = game.users;

  game.user = attackerOwner;
  game.users = new MockUsers([
    attackerOwner,
    defenderOwner
  ]);

  try {
    await assert.rejects(
      damageModule.executeResolvedDamage(context.pending.id),
      /Se requiere un GM conectado/
    );

    assert.equal(context.pending.damage.status, "available");
    assert.equal(context.pending.damage.rolled, false);
    assert.equal(context.defender.system.vitales.hp.value, 20);
    assert.match(warnings.at(-1), /Se requiere un GM conectado/);
  } finally {
    game.user = previousUser;
    game.users = previousUsers;
  }
});

test("registrar y rerenderizar chat no duplica handlers", () => {
  damageModule.registerResolvedDamageChatHandler();
  damageModule.registerResolvedDamageChatHandler();

  const renderHandlers = hookHandlers.get("renderChatMessage") ?? [];
  assert.equal(renderHandlers.length, 1);

  const activeHandlers = new Map();
  const selection = {
    off(eventName) {
      activeHandlers.delete(eventName);
      return selection;
    },
    on(eventName, handler) {
      activeHandlers.set(eventName, handler);
      return selection;
    }
  };
  const html = {
    find: () => selection
  };

  renderHandlers[0](null, html);
  renderHandlers[0](null, html);

  assert.equal(activeHandlers.size, 2);
  assert.equal(activeHandlers.has("click.mtrolResolvedDamage"), true);
});

test("F5 simulado recupera waiting-defense desde Combat y resuelve la misma pendingAction", async () => {
  const context = await createPending({
    suffix: "recovery-f5",
    attackerTotal: 9
  });
  const pendingActionId = context.pending.id;
  const pendingCardsBefore = chatMessages.filter(message =>
    message.flags?.mtrol?.pendingActionId === pendingActionId &&
    message.flags?.mtrol?.presentationType === "opposition-pending"
  ).length;

  await actionModule.hydratePendingActionsFromRuntime({ pendingActions: {} }, combat);
  assert.equal(actionModule.getPendingAction(pendingActionId), null);

  runtimeFoundation.recoveryCoordinator.configure({
    hydrateCache: actionModule.hydratePendingActionsFromRuntime,
    recoverPresentation: actionModule.recoverPendingActionPresentation
  });
  const recovered = await runtimeFoundation.recoveryCoordinator.recover(combat, {
    authorityUserId: gmUser.id,
    isPrimaryGM: true,
    notify: message => warnings.push(message)
  });
  const pendingAfterF5 = actionModule.getPendingAction(pendingActionId);

  assert.equal(recovered.waitingIds.includes(pendingActionId), true);
  assert.equal(pendingAfterF5.id, pendingActionId);
  assert.equal(pendingAfterF5.status, "waiting-defense");
  assert.equal(chatMessages.filter(message =>
    message.flags?.mtrol?.pendingActionId === pendingActionId &&
    message.flags?.mtrol?.presentationType === "opposition-pending"
  ).length, pendingCardsBefore);

  const result = await defend({
    pending: pendingAfterF5,
    defender: context.defender,
    total: 4
  });

  assert.equal(result.resolutionResult.success, true);
  assert.equal(actionModule.getPendingAction(pendingActionId).status, "resolved");
  assert.equal(
    combat.flags.mtrol.runtime.pendingActions[pendingActionId].status,
    "resolved"
  );
});

test("recovery recrea solo la presentacion si falta la Chat Card", async () => {
  const context = await createPending({
    suffix: "recovery-card-missing",
    attackerTotal: 8
  });
  const id = context.pending.id;
  const oldMessageId = context.pending.pendingMessageId;
  const oldIndex = chatMessages.findIndex(message => message.id === oldMessageId);
  assert.notEqual(oldIndex, -1);
  chatMessages.splice(oldIndex, 1);

  await actionModule.hydratePendingActionsFromRuntime({ pendingActions: {} }, combat);
  runtimeFoundation.recoveryCoordinator.configure({
    hydrateCache: actionModule.hydratePendingActionsFromRuntime,
    recoverPresentation: actionModule.recoverPendingActionPresentation
  });
  await runtimeFoundation.recoveryCoordinator.recover(combat, {
    authorityUserId: gmUser.id,
    isPrimaryGM: true,
    notify: message => warnings.push(message)
  });

  const recovered = actionModule.getPendingAction(id);
  assert.equal(recovered.status, "waiting-defense");
  assert.notEqual(recovered.pendingMessageId, oldMessageId);
  assert.equal(chatMessages.filter(message =>
    message.flags?.mtrol?.pendingActionId === id &&
    message.flags?.mtrol?.presentationType === "opposition-pending"
  ).length, 1);
});

test.after(() => {
  assert.equal(
    rollQueue.length,
    0,
    "Todas las tiradas simuladas deben consumirse."
  );

  assert.ok(
    socketEvents.some(event =>
      event.channel === "system.mtrol" &&
      event.data?.action === "mtrolPendingActionSync"
    ),
    "Las acciones y el dano deben sincronizarse por system.mtrol."
  );
});

async function lifecycleFixture(t, { mp = 20, category = 'combate', response = 'DODGE' } = {}) {
  const suffix = `p0-${++randomCounter}`;
  const item = createAttackSkill(`main-${suffix}`, { categoria: category });
  const responseItem = response === 'COUNTERATTACK'
    ? createItem({ id: `response-${suffix}`, categoria: 'contraataque', actionType: 'attack',
        effect: 'damage', danio: '1d6', damageType: 'physical' })
    : createDefenseSkill(`response-${suffix}`);
  const actor = createActor({ id: `source-${suffix}`, items: [item], ownerIds: [attackerOwner.id], mp });
  const target = createActor({ id: `target-${suffix}`, items: [responseItem], ownerIds: [defenderOwner.id], mp: 10 });
  const combatant = { id: `combatant-${suffix}`, actor, flags: { mtrol: {} },
    getFlag(scope, key) { return this.flags[scope]?.[key]; },
    async setFlag(scope, key, value) { this.flags[scope] ??= {}; this.flags[scope][key] = deepClone(value); } };
  game.combat = combat;
  game.user = gmUser;
  game.modules ??= new Map();
  Object.assign(combat, { started: true, round: 1, turn: 0, combatant,
    combatants: [combatant], turns: [combatant], nextTurnCalls: 0,
    async nextTurn() { this.nextTurnCalls += 1; } });
  turnModule.configureTurnActionIntegration({
    getPendingOppositionForActor: actionModule.getPendingOppositionForActor,
    getReactionMovementForActor: actionModule.getReactionMovementForActor,
    completeReactionMovementAuthoritative: actionModule.completeReactionMovementAuthoritative
  });
  await turnModule.startCombatantTurnAuthoritative(combatant, turnModule.getTurnContext());
  t.after(() => {
    for (const key of ['started', 'round', 'turn', 'combatant', 'combatants', 'turns', 'nextTurn']) delete combat[key];
    game.user = gmUser;
  });
  const payload = { id: `attempt-${suffix}`, sourceActorUuid: actor.uuid, sourceItemId: item.id,
    targetActorUuid: target.uuid, attackerRoll: { total: 8 } };
  return { actor, target, item, responseItem, combatant, payload };
}

test('P0 MP insuficiente rechaza intención sin Roll, pending, Card, cooldown ni acción', async t => {
  const f = await lifecycleFixture(t, { mp: 0 });
  const before = chatMessages.length;
  await assert.rejects(actionModule.createPendingAction({ ...f.payload, executeRoll: true }), /MP/);
  assert.equal(f.actor.system.vitales.mp.value, 0);
  assert.equal(f.combatant.flags.mtrol.turnState.actionConsumed, false);
  assert.equal(combat.flags.mtrol.runtime.pendingActions[f.payload.id], undefined);
  assert.equal(chatMessages.length, before);
  assert.equal(turnModule.getActionGuard(f.actor, f.item).allowed, true);
  assert.equal(f.item.flags?.mtrol?.cooldown, undefined);
});

test('P0 intención autoritativa tira y cobra una vez; retry y concurrencia no duplican', async t => {
  const f = await lifecycleFixture(t);
  const payload = { ...f.payload, executeRoll: true };
  delete payload.attackerRoll;
  queueRoll('1d20', 8);
  const [first, duplicate] = await Promise.all([
    actionModule.createPendingAction(payload), actionModule.createPendingAction(payload)
  ]);
  assert.equal(first.id, duplicate.id);
  assert.equal(f.actor.system.vitales.mp.value, 15);
  assert.equal(f.combatant.flags.mtrol.turnState.actionConsumed, true);
  assert.equal(first.attackerRoll.total, 8);
  assert.equal(first.damage.costoTotal, 5);
  assert.equal((await actionModule.createPendingAction(payload)).id, first.id);
  assert.equal(f.actor.system.vitales.mp.value, 15);
  assert.equal(chatMessages.filter(m => m.flags?.mtrol?.pendingActionId === first.id).length, 1);
  assert.equal(getReceiptFromRuntime(combat.flags.mtrol.runtime, first.activationTransactionId).status, 'completed');
  for (const status of ['waiting-defense', 'resolving', 'resolved']) {
    const snapshot = combat.flags.mtrol.runtime.pendingActions[first.id];
    snapshot.status = status;
    snapshot.damage.status = 'available';
    snapshot.damage.available = true;
    await assert.rejects(actionModule.createPendingAction({ ...payload, id: `${first.id}-${status}` }), /pendiente|consumida/);
  }
});

test('P0 dos intenciones distintas concurrentes sólo aceptan una main action', async t => {
  const f = await lifecycleFixture(t);
  const results = await Promise.allSettled([
    actionModule.createPendingAction(f.payload),
    actionModule.createPendingAction({ ...f.payload, id: `${f.payload.id}-other` })
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  assert.equal(f.actor.system.vitales.mp.value, 15);
});

test('P0 stack se incrementa una vez por intento consolidado', async t => {
  const f = await lifecycleFixture(t, { category: 'competencia' });
  await actionModule.createPendingAction(f.payload);
  await actionModule.createPendingAction(f.payload);
  assert.equal(f.actor.system.vitales.mp.value, 19);
  assert.equal(f.actor.flags.mtrol.mpStacks[f.item.id], 1);
});

test('P0 fallo al persistir pending conserva recibos de coste/stack y exige recovery sin publicar', async t => {
  const f = await lifecycleFixture(t, { category: 'competencia' });
  const original = combat.update;
  combat.update = async function(changes) {
    if (changes['flags.mtrol.runtime']?.pendingActions?.[f.payload.id]) throw new Error('PENDING_WRITE_FAILED');
    return original.call(this, changes);
  };
  t.after(() => { combat.update = original; });
  await assert.rejects(actionModule.createPendingAction(f.payload), e => e.reasonCode === 'RECOVERY_REQUIRED');
  assert.equal(f.actor.system.vitales.mp.value, 19);
  assert.equal(f.actor.flags.mtrol.mpStacks[f.item.id], 1);
  const receipt = getReceiptFromRuntime(
    combat.flags.mtrol.runtime,
    `opposition.create:${f.payload.id}:activation`
  );
  assert.equal(receipt.status, 'recovery-required');
  assert.ok(receipt.checkpoints['activation-cost']);
  assert.equal(chatMessages.filter(m => m.flags?.mtrol?.pendingActionId === f.payload.id).length, 0);
  assert.equal(turnModule.getActionGuard(f.actor, f.item).allowed, false);
  combat.update = original;
  await assert.rejects(actionModule.createPendingAction({ ...f.payload, id: `${f.payload.id}-retry-other` }), /pendiente/);
});

test('P0 Counterattack ignora consumeResponse=false, cobra 5 y daño no recobra activación', async t => {
  const f = await lifecycleFixture(t, { response: 'COUNTERATTACK' });
  const pending = await actionModule.createPendingAction(f.payload);
  assert.equal(turnModule.getActionGuard(f.target, f.responseItem).reactive, true);
  const response = { pendingActionId: pending.id, defenderActorUuid: f.target.uuid,
    defenseItemId: f.responseItem.id, defenderRoll: { total: 12 }, consumeResponse: false,
    requestingUserId: defenderOwner.id, transactionId: `${pending.id}:response` };
  await actionModule.attachDefenseRollAuthoritative(response);
  await actionModule.attachDefenseRollAuthoritative(response);
  assert.equal(f.target.system.vitales.mp.value, 5);
  const current = actionModule.getPendingAction(pending.id);
  assert.equal(current.damage.sourceActorUuid, f.target.uuid);
  assert.equal(current.damage.costoTotal, 5);
  const receipt = getReceiptFromRuntime(combat.flags.mtrol.runtime, current.responseActivationTransactionId);
  receipt.status = 'recovery-required';
  await assert.rejects(damageModule.executeResolvedDamageAuthoritative(pending.id,
    { requestingUserId: defenderOwner.id }), /consolidación|revisión/);
  assert.equal(f.target.system.vitales.mp.value, 5);
  receipt.status = 'completed';

  assert.equal(f.combatant.flags.mtrol.turnState.actionConsumed, true);
  const card = game.messages.get(current.resolutionMessageId);
  assert.equal(current.resolutionMessageId, current.pendingMessageId);
  assert.match(card.content, /Respuesta: Contraataque/);
  assert.match(card.content, new RegExp(`Ahora: ${f.target.name} debe lanzar daño`));
  assert.doesNotMatch(card.content, /Esperando respuesta/);
  queueRoll('1d6', 4); queueRoll('1d10', 5);
  await damageModule.executeResolvedDamageAuthoritative(pending.id, { requestingUserId: defenderOwner.id });
  assert.equal(f.target.system.vitales.mp.value, 5);
  assert.equal(turnModule.getActionGuard(f.actor, f.item).allowed, false);
  combat.round = 2;
  await turnModule.startCombatantTurnAuthoritative(f.combatant, turnModule.getTurnContext());
  assert.equal(turnModule.getActionGuard(f.actor, f.item).allowed, true);
});

test('P0 respuesta sin MP no puede omitir coste obligatorio', async t => {
  const f = await lifecycleFixture(t, { response: 'COUNTERATTACK' });
  const pending = await actionModule.createPendingAction(f.payload);
  f.target.system.vitales.mp.value = 0;
  await assert.rejects(actionModule.attachDefenseRollAuthoritative({ pendingActionId: pending.id,
    defenderActorUuid: f.target.uuid, defenseItemId: f.responseItem.id,
    executeRoll: true, consumeResponse: false, requestingUserId: defenderOwner.id }), /MP/);
  assert.equal(actionModule.getPendingAction(pending.id).status, 'waiting-defense');
});

test('P0 Card usa snapshot efectivo, allowance real, estados y proyección pública', () => {
  const pending = { id: 'card-p0', status: 'waiting-defense', sourceActorUuid: 'Actor.a', sourceActorName: 'A',
    targetActorUuid: 'Actor.b', targetActorName: 'B', sourceItemName: 'Aliento',
    attackerRoll: { total: 24 }, resolutionResult: 'damage', allowedResponses: ['DODGE'] };
  const waiting = presentationModule.buildResolutionContent(pending);
  assert.match(waiting, /A — Aliento/); assert.match(waiting, /24/); assert.match(waiting, /Debe responder/);
  assert.match(waiting, /Esquiva/); assert.doesNotMatch(waiting, /Contraataque/);
  Object.assign(pending, { status: 'resolved', responseItemName: 'Paso Áurico',
    responseDeclaration: { selectedCapability: 'DODGE' }, defenderRoll: { total: 27 },
    responseResolutionResult: 'movement', winnerResolutionResult: 'movement',
    reactionMovement: { status: 'available', allowance: 2 }, result: { success: false },
    shieldWear: { applied: true, remainingDefense: 987654 },
    damage: { total: 654321, damageFinal: 123456, hpLost: 123456 } });
  const html = presentationModule.buildResolutionContent(pending);
  assert.match(html, /Paso Áurico/); assert.match(html, /Respuesta: Esquiva/);
  assert.match(html, /Movimiento concedido: 2/);
  pending.movementGrant = { targetActorName: 'B', granted: 2, remaining: 2, grantId: 'movement:card-p0' };
  assert.match(presentationModule.buildResolutionContent(pending), /B obtiene 2 cuadro\(s\) de movimiento/);
  assert.doesNotMatch(html, /Automática|DODGE|987654|654321|123456|Inquebrantable|Virtus|Maldición|Defensa restante/);
  pending.status = 'cancelled';
  assert.match(presentationModule.buildResolutionContent(pending), /OPOSICIÓN · Cancelada/);
});

test('P0 DODGE automática ejecuta en autoridad sin consumir turno futuro', async t => {
  const f = await lifecycleFixture(t);
  f.responseItem.system.responseCapability = ''; // Valor canónico de Automática en el modelo.
  const future = { id: `future-${f.target.id}`, actor: f.target, flags: { mtrol: { turnState: { actionConsumed: false } } } };
  combat.combatants.push(future);
  const pending = await actionModule.createPendingAction(f.payload);
  const before = f.target.system.vitales.mp.value;
  await actionModule.declareOppositionResponseAuthoritative({ pendingActionId: pending.id,
    defenderActorUuid: f.target.uuid, responseItemId: f.responseItem.id, requestingUserId: defenderOwner.id });
  assert.equal(f.target.system.vitales.mp.value, before);
  queueRoll('1d20', 12);
  const result = await actionModule.attachDefenseRollForActor({ actor: f.target, item: f.responseItem,
    pendingActionId: pending.id, executeRoll: true, transactionId: `${pending.id}:dodge` });
  assert.ok(result);
  assert.equal(f.target.system.vitales.mp.value, before - 1);
  assert.equal(future.flags.mtrol.turnState.actionConsumed, false);
  const current = actionModule.getPendingAction(pending.id);
  assert.equal(current.responseDeclaration.selectedCapability, 'DODGE');
  assert.match(game.messages.get(current.resolutionMessageId).content, /Respuesta: Esquiva/);
});

test('P0 DEFENSE permitida con acción del iniciador consumida y sin daño pendiente', async t => {
  const f = await lifecycleFixture(t);
  Object.assign(f.responseItem.system, { defenseType: 'shield', effect: 'block', resolutionResult: 'defense' });
  const shield = createItem({ id: `shield-${f.target.id}`, type: 'objeto', tipoObjeto: 'escudo',
    equipado: true, slot: 'manoIzq', defensa: 8 });
  f.target.items.values.set(shield.id, shield);
  f.target.system.equipamiento.manoIzq = shield.id;
  const pending = await actionModule.createPendingAction(f.payload);
  queueRoll('1d4', 1);
  await actionModule.attachDefenseRollAuthoritative({ pendingActionId: pending.id,
    defenderActorUuid: f.target.uuid, defenseItemId: f.responseItem.id,
    defenderRoll: { total: 12 }, requestingUserId: defenderOwner.id });
  const current = actionModule.getPendingAction(pending.id);
  assert.equal(current.responseDeclaration.selectedCapability, 'DEFENSE');
  assert.equal(current.damage.available, false);
  assert.match(game.messages.get(current.resolutionMessageId).content, /Ataque evitado/);
  assert.equal(turnModule.getActionGuard(f.actor, f.item).allowed, false);
});

test('P0 follow-up físico permite exactamente un ataque y valida alcance canónico', async t => {
  const f = await lifecycleFixture(t);
  Object.assign(f.combatant.flags.mtrol.turnState, { actionConsumed: true, followUpAttackAvailable: true,
    followUpAttackConsumed: false, movementSource: 'attribute' });
  const scene = { grid: { type: 1, size: 100 } };
  const source = { id: 'follow-source', uuid: `Token.${f.actor.id}`, actor: f.actor,
    parent: scene, x: 0, y: 0, width: 1, height: 1, disposition: 1 };
  const target = { id: 'follow-target', uuid: `Token.${f.target.id}`, actor: f.target,
    parent: scene, x: 100, y: 0, width: 1, height: 1, disposition: -1 };
  f.combatant.token = source;
  uuidRegistry.set(target.uuid, target);
  assert.equal(turnModule.getActionGuard(f.actor, f.item).attributeFollowUp, true);
  const pending = await actionModule.createPendingAction({ ...f.payload, targetTokenUuid: target.uuid });
  assert.ok(pending);
  assert.equal(f.combatant.flags.mtrol.turnState.followUpAttackConsumed, true);
  await assert.rejects(actionModule.createPendingAction({ ...f.payload, id: `${f.payload.id}-second`, targetTokenUuid: target.uuid }), /pendiente|consumida/);
});

test('P0 cambio de Primary GM tras débito conserva intento para revisión sin Roll ni Card', async t => {
  const f = await lifecycleFixture(t);
  const update = f.actor.update;
  f.actor.update = async function(changes) {
    const result = await update.call(this, changes);
    gmUser.active = false;
    return result;
  };
  t.after(() => { gmUser.active = true; });
  await assert.rejects(actionModule.createPendingAction({ ...f.payload, executeRoll: true }), e => e.reasonCode === 'RECOVERY_REQUIRED');
  gmUser.active = true;
  assert.equal(f.actor.system.vitales.mp.value, 15);
  assert.equal(chatMessages.filter(m => m.flags?.mtrol?.pendingActionId === f.payload.id).length, 0);
  assert.equal(getReceiptFromRuntime(
    combat.flags.mtrol.runtime,
    `opposition.create:${f.payload.id}:activation`
  ).status, 'recovery-required');
  assert.equal(turnModule.getActionGuard(f.actor, f.item).allowed, false);
});
