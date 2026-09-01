import test from "node:test";
import assert from "node:assert/strict";

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
      defenseType,
      effect,
      requiresOpposition,
      oppositionType: "free",
      effectDuration: 1,
      effectIntensity: 0,
      danio,
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
  damageCostType
} = {}) {
  return createItem({
    id,
    name: `Ataque ${id}`,
    categoria,
    actionType: "attack",
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

game.mtrol.actions = {
  getPendingAction: actionModule.getPendingAction,
  serializePendingAction: actionModule.serializePendingAction,
  receivePendingActionSync: actionModule.receivePendingActionSync,
  receivePendingActionCleared: actionModule.receivePendingActionCleared
};

async function createPending({
  suffix,
  attackerTotal,
  categoria,
  ejecutaDanio = true,
  danio = "1d6",
  damageResolution,
  damageMode,
  damageCostType,
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
      damageCostType
    }
  );

  const attacker = createActor({
    id: `attacker-${suffix}`,
    ownerIds: [attackerOwner.id],
    items: [attackSkill]
  });

  const target = defender ?? createActor({
    id: `defender-${suffix}`,
    ownerIds: [defenderOwner.id],
    items: [createDefenseSkill(`defense-${suffix}`)]
  });

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
    attackSkill
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
    total: 9
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

test("Contraataque ganador ejecuta su daño existente contra el atacante", async () => {
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
  queueRoll("1d6", 6);
  queueRoll("1d10", 5);
  const result = await defend({
    pending: context.pending,
    defender,
    total: 9,
    defenseSkill: counterattack
  });
  assert.equal(result.resolutionResult.success, false);
  assert.equal(context.attacker.system.vitales.hp.value, 14);
  assert.equal(context.pending.responseDamage.status, "rolled");
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

test("ejecutaDanio false invalida metadatos cliente y nunca muestra boton", async () => {
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

  assert.equal(context.pending.damage.available, false);
  assert.equal(context.pending.damage.status, "unavailable");
  assert.doesNotMatch(message.content, /mtrol-resolved-damage/);
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
    attackerTotal: 9,
    damageResolution: "onOppositionWin",
    damageMode: "enabled",
    damageCostType: "basic"
  });

  context.attackSkill.system.categoria = "hechizo";
  context.attackSkill.system.nivel = 1;
  context.attacker.system.vitales.mp.value = 10;
  context.attacker.system.vitales.mp.max = 10;

  await mpModule.procesarConsumoMP(context.attacker, context.attackSkill);
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
    attackerTotal: 9,
    categoria: "competencia",
    damageResolution: "onOppositionWin",
    damageMode: "enabled",
    damageCostType: "basic"
  });

  context.attacker.system.vitales.mp.value = 10;
  context.attacker.system.vitales.mp.max = 10;

  const activation = await mpModule.procesarConsumoMP(
    context.attacker,
    context.attackSkill
  );
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
    attackerTotal: 3,
    damageResolution: "onOppositionWin",
    damageMode: "enabled",
    damageCostType: "basic"
  });

  context.attackSkill.system.categoria = "hechizo";
  context.attackSkill.system.nivel = 1;
  context.attacker.system.vitales.mp.value = 10;

  await mpModule.procesarConsumoMP(context.attacker, context.attackSkill);
  assert.equal(context.attacker.system.vitales.mp.value, 9);

  await defend({
    pending: context.pending,
    defender: context.defender,
    total: 8
  });

  assert.equal(context.attacker.system.vitales.mp.value, 9);
  assert.equal(context.pending.damage.additionalCostApplied, false);
  assert.equal(context.defender.system.vitales.hp.value, 20);
});

test("modo automático ejecuta una sola vez al ganar oposición", async () => {
  const context = await createPending({
    suffix: "configured-automatic",
    attackerTotal: 9,
    damageResolution: "onOppositionWin",
    damageMode: "automatic",
    damageCostType: "basic"
  });

  context.attacker.system.vitales.mp.value = 9;
  context.attacker.system.vitales.mp.max = 10;
  queueRoll("1d6", 5);
  queueRoll("1d10", 5);

  await defend({
    pending: context.pending,
    defender: context.defender,
    total: 4
  });

  assert.equal(context.pending.damage.status, "rolled");
  assert.equal(context.attacker.system.vitales.mp.value, 8);
  assert.equal(context.defender.system.vitales.hp.value, 15);
  assert.doesNotMatch(resolutionMessageFor(context.pending.id).content, /mtrol-resolved-damage/);
});

test("daño inmediato habilitado reutiliza pendingActions y cobra recién al ejecutar", async () => {
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

  const pending = await actionModule.createReadyDamageActionFromCompetencia({
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
  });

  assert.equal(pending.status, "resolved");
  assert.equal(pending.damage.status, "available");
  assert.equal(attacker.system.vitales.mp.value, 9);
  assert.match(resolutionMessageFor(pending.id).content, /mtrol-resolved-damage/);

  queueRoll("1d6", 4);
  queueRoll("1d10", 5);
  await damageModule.executeResolvedDamageAuthoritative(
    pending.id,
    { requestingUserId: attackerOwner.id }
  );

  assert.equal(attacker.system.vitales.mp.value, 8);
  assert.equal(defender.system.vitales.hp.value, 16);
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

test("un fallo de ejecucion queda terminal y no permite reintentar dano", async () => {
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

  assert.equal(context.pending.damage.status, "failed");
  assert.equal(context.attacker.system.vitales.mp.value, 9, "el costo adicional se reembolsa si el daño no puede ejecutarse");
  assert.equal(context.defender.system.vitales.hp.value, 20);
  assert.match(
    resolutionMessageFor(context.pending.id).content,
    /No se pudo completar el daño/
  );

  await assert.rejects(
    damageModule.executeResolvedDamageAuthoritative(
      context.pending.id,
      { requestingUserId: attackerOwner.id }
    ),
    /fallo o ya fue ejecutado/
  );

  assert.equal(context.defender.system.vitales.hp.value, 20);
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

  assert.equal(activeHandlers.size, 1);
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
