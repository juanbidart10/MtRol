import test from "node:test";
import assert from "node:assert/strict";

let randomCounter = 0;
let messageCounter = 0;

const warnings = [];
const socketEvents = [];
const chatMessages = [];
const uuidRegistry = new Map();
const rollQueue = [];

function deepClone(value) {
  return value === undefined
    ? undefined
    : structuredClone(value);
}

globalThis.foundry = {
  utils: {
    randomID: () => `random-${++randomCounter}`,
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
    return this;
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
  id: "gm",
  isGM: true,
  active: true
};

const ownerA = {
  id: "owner-a",
  isGM: false,
  active: true
};

const ownerB = {
  id: "owner-b",
  isGM: false,
  active: true
};

globalThis.game = {
  user: gmUser,
  users: new MockUsers([gmUser, ownerA, ownerB]),
  socket: {
    emit: (channel, data) => {
      socketEvents.push({
        channel,
        data: deepClone(data)
      });
    }
  },
  dice3d: null,
  messages: {
    get: () => null
  }
};

globalThis.ui = {
  notifications: {
    warn: message => warnings.push(message),
    info: () => {}
  }
};

globalThis.ChatMessage = {
  getSpeaker: ({ actor } = {}) => ({
    actor: actor?.id ?? null
  }),
  create: async data => {
    const message = {
      id: `message-${++messageCounter}`,
      ...data,
      update: async changes => Object.assign(message, changes)
    };

    chatMessages.push(message);
    return message;
  }
};

globalThis.fromUuid = async uuid =>
  uuidRegistry.get(uuid) ?? null;

class MockItems {
  constructor(items = []) {
    this.map = new Map(
      items.map(item => [item.id, item])
    );
  }

  get(id) {
    return this.map.get(id) ?? null;
  }

  find(callback) {
    return Array.from(this.map.values()).find(callback);
  }

  filter(callback) {
    return Array.from(this.map.values()).filter(callback);
  }

  mapValues(callback) {
    return Array.from(this.map.values()).map(callback);
  }

  map(callback) {
    return this.mapValues(callback);
  }

  delete(id) {
    return this.map.delete(id);
  }

  [Symbol.iterator]() {
    return this.map.values();
  }
}

function setByPath(target, path, value) {
  const parts =
    path.split(".");

  let current =
    target;

  for (const part of parts.slice(0, -1)) {
    current[part] ??= {};
    current = current[part];
  }

  current[parts.at(-1)] = value;
}

function createItem({
  id,
  name = id,
  type = "objeto",
  tipoObjeto = "general",
  slot = "",
  equipado = false,
  defensa = 0,
  defensaBase = defensa,
  danio = "",
  peso = 0,
  cantidad = 1,
  actionType = null,
  defenseType = null,
  effect = null,
  requiresOpposition = false
}) {
  const item = {
    id,
    uuid: `Item.${id}`,
    name,
    type,
    system: {
      tipoObjeto,
      slot,
      equipado,
      defensa,
      defensaBase,
      danio,
      peso,
      cantidad,
      actionType,
      defenseType,
      effect,
      requiresOpposition,
      oppositionType: "free",
      effectDuration: 1,
      effectIntensity: 0
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
  name = id,
  ownerIds = [],
  items = [],
  manoIzq = "",
  manoDer = "",
  fuerza = 3
}) {
  const actor = {
    id,
    uuid: `Actor.${id}`,
    name,
    type: "personaje",
    ownerIds: new Set(ownerIds),
    system: {
      atributos: {
        fuerza
      },
      equipamiento: {
        cabeza: "",
        cuello: "",
        hombros: "",
        brazos: "",
        pecho: "",
        piernas: "",
        pies: "",
        manoIzq,
        manoDer,
        extra: ""
      }
    },
    items: new MockItems(items),
    testUserPermission(user, level) {
      return (
        level === "OWNER" &&
        (
          user?.isGM ||
          actor.ownerIds.has(user?.id)
        )
      );
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

      for (const itemId of ids) {
        actor.items.delete(itemId);
      }

      return ids;
    }
  };

  uuidRegistry.set(actor.uuid, actor);
  return actor;
}

function queueRoll(formula, total) {
  rollQueue.push({
    formula,
    total
  });
}

const equipmentModule =
  await import("../scripts/items/equipment-engine.js");

const destructionModule =
  await import("../scripts/items/item-destruction-engine.js");

const shieldWearModule =
  await import("../scripts/items/shield-wear-engine.js");

const rollHelpersModule =
  await import("../scripts/rolls/roll-helpers.js");

const resolutionModule =
  await import("../scripts/actions/resolution-engine.js");

const carryModule =
  await import("../scripts/core/mtrol-carry-weight.js");

const actionModule =
  await import("../scripts/actions/action-engine.js");

function createWeapon(id, slot, danio = "4") {
  return createItem({
    id,
    name: `Arma ${id}`,
    tipoObjeto: "arma",
    slot,
    equipado: true,
    danio,
    peso: 2
  });
}

function createShield(id, slot, defensa = 8) {
  return createItem({
    id,
    name: `Escudo ${id}`,
    tipoObjeto: "escudo",
    slot,
    equipado: true,
    defensa,
    defensaBase: 8,
    danio: "99",
    peso: 3
  });
}

function createAttackSkill(id = "attack-skill") {
  return createItem({
    id,
    name: "Ataque enfrentado",
    type: "competencia",
    actionType: "attack",
    effect: "damage",
    defenseType: "custom",
    requiresOpposition: true
  });
}

function createShieldDefenseSkill(id = "shield-defense") {
  return createItem({
    id,
    name: "Defensa con escudos",
    type: "competencia",
    actionType: "defense",
    defenseType: "shield",
    effect: "block"
  });
}

async function createAuthoritativeAction({
  attacker,
  defender,
  attackSkill,
  attackerTotal = 8,
  attackerFumble = false
}) {
  return actionModule.createPendingActionAuthoritative({
    sourceActorId: attacker.id,
    sourceActorUuid: attacker.uuid,
    sourceItemId: attackSkill.id,
    sourceItemName: attackSkill.name,
    targetActorId: defender.id,
    targetActorUuid: defender.uuid,
    attackerRoll: {
      total: attackerTotal,
      pifia: attackerFumble
    },
    requiresOpposition: true,
    damage: {
      available: true,
      formula: "1d6"
    }
  }, {
    requestingUserId: ownerA.id
  });
}

test("helper canónico conserva mano izquierda y derecha", () => {
  const weapon = createWeapon("right-weapon", "manoDer");
  const shield = createShield("left-shield", "manoIzq");
  const actor = createActor({
    id: "hands-a",
    items: [weapon, shield],
    manoIzq: shield.id,
    manoDer: weapon.id
  });

  const hands =
    equipmentModule.getEquippedHandItems(actor);

  assert.equal(hands.manoIzq, shield);
  assert.equal(hands.manoDer, weapon);
  assert.deepEqual(
    equipmentModule.getEquippedShields(actor),
    [{
      slot: "manoIzq",
      item: shield
    }]
  );
});

test("@mano excluye escudos en ambas combinaciones de mano", () => {
  const rightWeapon = createWeapon("weapon-r", "manoDer", "4");
  const leftShield = createShield("shield-l", "manoIzq");
  const firstActor = createActor({
    id: "mano-first",
    items: [rightWeapon, leftShield],
    manoIzq: leftShield.id,
    manoDer: rightWeapon.id
  });

  assert.deepEqual(
    rollHelpersModule.mtrolObtenerDanioManos(firstActor),
    {
      manoDer: 4,
      manoIzq: 0,
      total: 4,
      nombresDer: [rightWeapon.name],
      nombresIzq: []
    }
  );

  const leftWeapon = createWeapon("weapon-l", "manoIzq", "5");
  const rightShield = createShield("shield-r", "manoDer");
  const secondActor = createActor({
    id: "mano-second",
    items: [leftWeapon, rightShield],
    manoIzq: leftWeapon.id,
    manoDer: rightShield.id
  });

  assert.equal(
    rollHelpersModule.mtrolObtenerDanioManos(secondActor).total,
    5
  );
});

test("@mano conserva dos armas, fallback legacy y excluye dos escudos", () => {
  const rightWeapon = createWeapon("dual-r", "manoDer", "3");
  const leftWeapon = createWeapon("dual-l", "manoIzq", "2");
  const dualWeapons = createActor({
    id: "dual-weapons",
    items: [rightWeapon, leftWeapon],
    manoIzq: leftWeapon.id,
    manoDer: rightWeapon.id
  });

  assert.equal(
    rollHelpersModule.mtrolObtenerDanioManos(dualWeapons).total,
    5
  );

  const legacy = createWeapon("legacy", "manoDer", "6");
  legacy.system.tipoObjeto = "general";
  const legacyActor = createActor({
    id: "legacy-actor",
    items: [legacy],
    manoDer: legacy.id
  });

  assert.equal(
    rollHelpersModule.mtrolObtenerDanioManos(legacyActor).total,
    6
  );

  const shieldA = createShield("double-a", "manoIzq");
  const shieldB = createShield("double-b", "manoDer");
  const dualShields = createActor({
    id: "dual-shields",
    items: [shieldA, shieldB],
    manoIzq: shieldA.id,
    manoDer: shieldB.id
  });

  assert.equal(
    rollHelpersModule.mtrolObtenerDanioManos(dualShields).total,
    0
  );
});

test("reglas de oposición: mayores, pifias y desempates", async () => {
  assert.equal(
    (
      await resolutionModule.resolveOpposedAction({
        attackerRoll: { total: 9 },
        defenderRoll: { total: 4 }
      })
    ).reason,
    "attacker-higher"
  );

  assert.equal(
    (
      await resolutionModule.resolveOpposedAction({
        attackerRoll: { total: 4 },
        defenderRoll: { total: 9 }
      })
    ).reason,
    "defender-higher"
  );

  assert.equal(
    (
      await resolutionModule.resolveOpposedAction({
        attackerRoll: { total: 9, isFumble: true },
        defenderRoll: { total: 4 }
      })
    ).reason,
    "attacker-fumble"
  );

  assert.equal(
    (
      await resolutionModule.resolveOpposedAction({
        attackerRoll: { total: 9 },
        defenderRoll: { total: 4, isFumble: true }
      })
    ).reason,
    "defender-fumble"
  );

  queueRoll("1d10", 4);
  assert.equal(
    (
      await resolutionModule.resolveOpposedAction({
        attackerRoll: { total: 7 },
        defenderRoll: { total: 7 }
      })
    ).reason,
    "tie-attacker"
  );

  queueRoll("1d10", 8);
  assert.equal(
    (
      await resolutionModule.resolveOpposedAction({
        attackerRoll: { total: 7 },
        defenderRoll: { total: 7 }
      })
    ).reason,
    "tie-defender"
  );
});

test("desgaste resta defensa y solo se aplica a victorias defensivas válidas", async () => {
  const shield = createShield("wear-shield", "manoIzq", 8);
  const actor = createActor({
    id: "wear-actor",
    items: [shield],
    manoIzq: shield.id
  });

  const pendingAction = {
    id: "wear-action",
    status: "resolving",
    targetActorId: actor.id,
    targetActorUuid: actor.uuid,
    defenseActionType: "defense",
    defenseType: "shield",
    defenseEffect: "block",
    shieldItemId: shield.id,
    shieldItemUuid: shield.uuid,
    shieldSlot: "manoIzq"
  };

  queueRoll("1d4", 3);

  const wear =
    await shieldWearModule.applyShieldWear({
      defenderActor: actor,
      shieldItemId: shield.id,
      shieldItemUuid: shield.uuid,
      shieldSlot: "manoIzq",
      pendingAction,
      resolutionResult: {
        success: false,
        reason: "defender-higher"
      }
    });

  assert.equal(wear.wear, 3);
  assert.equal(wear.remainingDefense, 5);
  assert.equal(shield.system.defensa, 5);

  for (const reason of [
    "attacker-higher",
    "attacker-fumble",
    "defender-fumble",
    "tie-attacker"
  ]) {
    assert.equal(
      shieldWearModule.shouldApplyShieldWear(
        pendingAction,
        {
          success: reason === "attacker-higher" ||
            reason === "defender-fumble" ||
            reason === "tie-attacker",
          reason
        }
      ),
      false
    );
  }
});

test("rotura exacta limpia slot, elimina item y libera peso", async () => {
  const shield = createShield("break-exact", "manoDer", 2);
  const actor = createActor({
    id: "break-exact-actor",
    items: [shield],
    manoDer: shield.id,
    fuerza: 2
  });

  const pesoAntes =
    carryModule.calcularCargaActor(actor).pesoActual;

  const pendingAction = {
    id: "break-exact-action",
    status: "resolving",
    targetActorId: actor.id,
    targetActorUuid: actor.uuid,
    defenseActionType: "defense",
    defenseType: "shield",
    defenseEffect: "block",
    shieldItemId: shield.id,
    shieldItemUuid: shield.uuid,
    shieldSlot: "manoDer"
  };

  queueRoll("1d4", 2);

  const wear =
    await shieldWearModule.applyShieldWear({
      defenderActor: actor,
      shieldItemId: shield.id,
      shieldItemUuid: shield.uuid,
      shieldSlot: "manoDer",
      pendingAction,
      resolutionResult: {
        success: false,
        reason: "defender-higher"
      }
    });

  assert.equal(wear.remainingDefense, 0);
  assert.equal(wear.destroyed, true);
  assert.equal(actor.system.equipamiento.manoDer, "");
  assert.equal(actor.items.get(shield.id), null);
  assert.equal(pesoAntes, 3);
  assert.equal(carryModule.calcularCargaActor(actor).pesoActual, 0);
});

test("rotura por debajo de cero es idempotente y limpia referencias duplicadas", async () => {
  const shield = createShield("break-below", "manoIzq", 1);
  const actor = createActor({
    id: "break-below-actor",
    items: [shield],
    manoIzq: shield.id
  });

  actor.system.equipamiento.extra = shield.id;

  const pendingAction = {
    id: "break-below-action",
    status: "resolving",
    targetActorId: actor.id,
    targetActorUuid: actor.uuid,
    defenseActionType: "defense",
    defenseType: "shield",
    defenseEffect: "block",
    shieldItemId: shield.id,
    shieldItemUuid: shield.uuid,
    shieldSlot: "manoIzq"
  };

  queueRoll("1d4", 4);

  const wear =
    await shieldWearModule.applyShieldWear({
      defenderActor: actor,
      shieldItemId: shield.id,
      shieldItemUuid: shield.uuid,
      shieldSlot: "manoIzq",
      pendingAction,
      resolutionResult: {
        success: false,
        reason: "tie-defender"
      }
    });

  assert.equal(wear.remainingDefense, 0);
  assert.equal(actor.system.equipamiento.manoIzq, "");
  assert.equal(actor.system.equipamiento.extra, "");

  const repeated =
    await destructionModule.destroyEquippedItem({
      actor,
      item: shield,
      slot: "manoIzq"
    });

  assert.equal(repeated.alreadyDestroyed, true);
  assert.equal(repeated.destroyed, false);
});

test("la resolución informa la rotura en una única carta coherente", async () => {
  const attackSkill = createAttackSkill("attack-break-chat");
  const defenseSkill = createShieldDefenseSkill("defense-break-chat");
  const shield = createShield("shield-break-chat", "manoIzq", 1);

  const attacker = createActor({
    id: "attacker-break-chat",
    ownerIds: [ownerA.id],
    items: [attackSkill]
  });

  const defender = createActor({
    id: "defender-break-chat",
    ownerIds: [ownerB.id],
    items: [defenseSkill, shield],
    manoIzq: shield.id
  });

  const pending =
    await createAuthoritativeAction({
      attacker,
      defender,
      attackSkill,
      attackerTotal: 4
    });

  queueRoll("1d4", 3);

  await actionModule.attachDefenseRollAuthoritative({
    pendingActionId: pending.id,
    defenderActorUuid: defender.uuid,
    defenseItemId: defenseSkill.id,
    defenderRoll: { total: 8 },
    requestingUserId: ownerB.id
  });

  const resolutionMessage =
    chatMessages.findLast(message =>
      message.flags?.mtrol?.pendingActionId === pending.id
    );

  assert.match(
    resolutionMessage.content,
    /Escudo shield-break-chat.*se rompe y queda destruido/s
  );

  assert.equal(
    chatMessages.filter(message =>
      message.flags?.mtrol?.pendingActionId === pending.id
    ).length,
    1
  );
});

test("GM rechaza cero escudos y deja la acción esperando defensa", async () => {
  const attackSkill = createAttackSkill("attack-no-shield");
  const defenseSkill = createShieldDefenseSkill("defense-no-shield");
  const weaponA = createWeapon("no-shield-a", "manoIzq");
  const weaponB = createWeapon("no-shield-b", "manoDer");

  const attacker = createActor({
    id: "attacker-no-shield",
    ownerIds: [ownerA.id],
    items: [attackSkill]
  });

  const defender = createActor({
    id: "defender-no-shield",
    ownerIds: [ownerB.id],
    items: [defenseSkill, weaponA, weaponB],
    manoIzq: weaponA.id,
    manoDer: weaponB.id
  });

  const pending =
    await createAuthoritativeAction({
      attacker,
      defender,
      attackSkill
    });

  await assert.rejects(
    actionModule.attachDefenseRollAuthoritative({
      pendingActionId: pending.id,
      defenderActorUuid: defender.uuid,
      defenseItemId: defenseSkill.id,
      defenderRoll: { total: 9 },
      requestingUserId: ownerB.id
    }),
    /no tiene un escudo equipado/
  );

  assert.equal(pending.status, "waiting-defense");
  assert.equal(pending.defenderRoll, null);
});

test("GM rechaza dos escudos sin seleccionar silenciosamente", async () => {
  const attackSkill = createAttackSkill("attack-two-shields");
  const defenseSkill = createShieldDefenseSkill("defense-two-shields");
  const shieldA = createShield("two-a", "manoIzq");
  const shieldB = createShield("two-b", "manoDer");

  const attacker = createActor({
    id: "attacker-two-shields",
    ownerIds: [ownerA.id],
    items: [attackSkill]
  });

  const defender = createActor({
    id: "defender-two-shields",
    ownerIds: [ownerB.id],
    items: [defenseSkill, shieldA, shieldB],
    manoIzq: shieldA.id,
    manoDer: shieldB.id
  });

  const pending =
    await createAuthoritativeAction({
      attacker,
      defender,
      attackSkill
    });

  await assert.rejects(
    actionModule.attachDefenseRollAuthoritative({
      pendingActionId: pending.id,
      defenderActorUuid: defender.uuid,
      defenseItemId: defenseSkill.id,
      defenderRoll: { total: 9 },
      requestingUserId: ownerB.id
    }),
    /más de un escudo/
  );

  assert.equal(pending.status, "waiting-defense");
  assert.equal(pending.shieldItemId, null);
});

test("resolución autoritativa desgasta una sola vez y bloquea doble resolución", async () => {
  const attackSkill = createAttackSkill("attack-authoritative");
  const defenseSkill = createShieldDefenseSkill("defense-authoritative");
  const shield = createShield("authoritative-shield", "manoDer", 8);
  const weapon = createWeapon("authoritative-weapon", "manoIzq", "5");

  const attacker = createActor({
    id: "attacker-authoritative",
    ownerIds: [ownerA.id],
    items: [attackSkill]
  });

  const defender = createActor({
    id: "defender-authoritative",
    ownerIds: [ownerB.id],
    items: [defenseSkill, shield, weapon],
    manoIzq: weapon.id,
    manoDer: shield.id
  });

  const pending =
    await createAuthoritativeAction({
      attacker,
      defender,
      attackSkill,
      attackerTotal: 6
    });

  queueRoll("1d4", 3);

  const result =
    await actionModule.attachDefenseRollAuthoritative({
      pendingActionId: pending.id,
      defenderActorUuid: defender.uuid,
      defenseItemId: defenseSkill.id,
      defenderRoll: { total: 9 },
      requestingUserId: ownerB.id
    });

  assert.equal(result.resolutionResult.reason, "defender-higher");
  assert.equal(pending.status, "resolved");
  assert.equal(pending.shieldItemId, shield.id);
  assert.equal(pending.shieldSlot, "manoDer");
  assert.equal(shield.system.defensa, 5);

  const resolutionMessage =
    chatMessages.findLast(message =>
      message.flags?.mtrol?.pendingActionId === pending.id
    );

  assert.match(
    resolutionMessage.content,
    /bloquea correctamente con Escudo authoritative-shield/
  );

  assert.match(
    resolutionMessage.content,
    /MTROL tira 1d4 de desgaste/
  );

  assert.match(
    resolutionMessage.content,
    /Defensa restante/
  );

  await assert.rejects(
    actionModule.resolvePendingActionAuthoritative(
      pending.id,
      {
        requestingUserId: ownerB.id
      }
    ),
    /ya fue resuelta/
  );

  assert.equal(shield.system.defensa, 5);
});

test("dos defensas concurrentes no pueden resolver ni desgastar dos veces", async () => {
  const attackSkill = createAttackSkill("attack-concurrent");
  const defenseSkill = createShieldDefenseSkill("defense-concurrent");
  const shield = createShield("shield-concurrent", "manoIzq", 8);

  const attacker = createActor({
    id: "attacker-concurrent",
    ownerIds: [ownerA.id],
    items: [attackSkill]
  });

  const defender = createActor({
    id: "defender-concurrent",
    ownerIds: [ownerB.id],
    items: [defenseSkill, shield],
    manoIzq: shield.id
  });

  const pending =
    await createAuthoritativeAction({
      attacker,
      defender,
      attackSkill,
      attackerTotal: 5
    });

  queueRoll("1d4", 2);

  const attempts =
    await Promise.allSettled([
      actionModule.attachDefenseRollAuthoritative({
        pendingActionId: pending.id,
        defenderActorUuid: defender.uuid,
        defenseItemId: defenseSkill.id,
        defenderRoll: { total: 8 },
        requestingUserId: ownerB.id
      }),
      actionModule.attachDefenseRollAuthoritative({
        pendingActionId: pending.id,
        defenderActorUuid: defender.uuid,
        defenseItemId: defenseSkill.id,
        defenderRoll: { total: 8 },
        requestingUserId: ownerB.id
      })
    ]);

  assert.equal(
    attempts.filter(attempt => attempt.status === "fulfilled").length,
    1
  );

  assert.equal(
    attempts.filter(attempt => attempt.status === "rejected").length,
    1
  );

  assert.equal(shield.system.defensa, 6);
  assert.equal(pending.status, "resolved");
});

test("gana atacante y pifias no producen desgaste", async () => {
  async function runCase({
    suffix,
    attackerTotal,
    defenderTotal,
    attackerFumble = false,
    defenderFumble = false,
    expectedReason
  }) {
    const attackSkill = createAttackSkill(`attack-${suffix}`);
    const defenseSkill = createShieldDefenseSkill(`defense-${suffix}`);
    const shield = createShield(`shield-${suffix}`, "manoIzq", 8);

    const attacker = createActor({
      id: `attacker-${suffix}`,
      ownerIds: [ownerA.id],
      items: [attackSkill]
    });

    const defender = createActor({
      id: `defender-${suffix}`,
      ownerIds: [ownerB.id],
      items: [defenseSkill, shield],
      manoIzq: shield.id
    });

    const pending =
      await createAuthoritativeAction({
        attacker,
        defender,
        attackSkill,
        attackerTotal,
        attackerFumble
      });

    const result =
      await actionModule.attachDefenseRollAuthoritative({
        pendingActionId: pending.id,
        defenderActorUuid: defender.uuid,
        defenseItemId: defenseSkill.id,
        defenderRoll: {
          total: defenderTotal,
          pifia: defenderFumble
        },
        requestingUserId: ownerB.id
      });

    assert.equal(result.resolutionResult.reason, expectedReason);
    assert.equal(shield.system.defensa, 8);
    assert.equal(pending.shieldWear, null);
  }

  await runCase({
    suffix: "attacker-wins",
    attackerTotal: 9,
    defenderTotal: 4,
    expectedReason: "attacker-higher"
  });

  await runCase({
    suffix: "attacker-fumble",
    attackerTotal: 9,
    defenderTotal: 4,
    attackerFumble: true,
    expectedReason: "attacker-fumble"
  });

  await runCase({
    suffix: "defender-fumble",
    attackerTotal: 4,
    defenderTotal: 9,
    defenderFumble: true,
    expectedReason: "defender-fumble"
  });
});

test("empate 1-5 no desgasta y empate 6-10 desgasta", async () => {
  async function runTie({
    suffix,
    tie,
    wear = null
  }) {
    const attackSkill = createAttackSkill(`attack-tie-${suffix}`);
    const defenseSkill = createShieldDefenseSkill(`defense-tie-${suffix}`);
    const shield = createShield(`shield-tie-${suffix}`, "manoIzq", 8);

    const attacker = createActor({
      id: `attacker-tie-${suffix}`,
      ownerIds: [ownerA.id],
      items: [attackSkill]
    });

    const defender = createActor({
      id: `defender-tie-${suffix}`,
      ownerIds: [ownerB.id],
      items: [defenseSkill, shield],
      manoIzq: shield.id
    });

    const pending =
      await createAuthoritativeAction({
        attacker,
        defender,
        attackSkill,
        attackerTotal: 7
      });

    queueRoll("1d10", tie);
    if (wear !== null) queueRoll("1d4", wear);

    const result =
      await actionModule.attachDefenseRollAuthoritative({
        pendingActionId: pending.id,
        defenderActorUuid: defender.uuid,
        defenseItemId: defenseSkill.id,
        defenderRoll: { total: 7 },
        requestingUserId: ownerB.id
      });

    return {
      result,
      pending,
      shield
    };
  }

  const attackerTie =
    await runTie({
      suffix: "attacker",
      tie: 4
    });

  assert.equal(attackerTie.result.resolutionResult.reason, "tie-attacker");
  assert.equal(attackerTie.shield.system.defensa, 8);

  const defenderTie =
    await runTie({
      suffix: "defender",
      tie: 8,
      wear: 2
    });

  assert.equal(defenderTie.result.resolutionResult.reason, "tie-defender");
  assert.equal(defenderTie.shield.system.defensa, 6);
});

test("GM cancela si el escudo cambia después de validarlo y antes del desgaste", async () => {
  const shield = createShield("changed-shield", "manoIzq", 8);
  const replacement = createShield("replacement-shield", "manoIzq", 8);
  const actor = createActor({
    id: "changed-actor",
    items: [shield, replacement],
    manoIzq: replacement.id
  });

  const pendingAction = {
    id: "changed-action",
    status: "resolving",
    targetActorId: actor.id,
    targetActorUuid: actor.uuid,
    defenseActionType: "defense",
    defenseType: "shield",
    defenseEffect: "block",
    shieldItemId: shield.id,
    shieldItemUuid: shield.uuid,
    shieldSlot: "manoIzq"
  };

  await assert.rejects(
    shieldWearModule.applyShieldWear({
      defenderActor: actor,
      shieldItemId: shield.id,
      shieldItemUuid: shield.uuid,
      shieldSlot: "manoIzq",
      pendingAction,
      resolutionResult: {
        success: false,
        reason: "defender-higher"
      }
    }),
    /ya no está equipado/
  );

  assert.equal(shield.system.defensa, 8);
  assert.equal(replacement.system.defensa, 8);
});

test("sin GM activo la solicitud falla sin crear estado autoritativo", async () => {
  const previousUser = game.user;
  const previousUsers = game.users;

  game.user = ownerA;
  game.users = new MockUsers([ownerA, ownerB]);

  const response =
    await (
      await import("../scripts/core/socket-requests.js")
    ).requestPrimaryGM(
      "mtrolCreatePendingAction",
      {}
    );

  assert.equal(response.ok, false);
  assert.match(response.error, /Se requiere un GM conectado/);

  game.user = previousUser;
  game.users = previousUsers;
});

test("Owner contra Owner requiere verificación runtime con dos clientes reales", {
  skip: "La sincronización de SocketInterface y la replicación de documentos requieren dos sesiones Foundry."
}, () => {});

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
    "Las acciones autoritativas deben emitir sincronización."
  );
});
