import test from "node:test";
import assert from "node:assert/strict";

const warnings = [];
class UserCollection extends Map {
  [Symbol.iterator]() { return this.values(); }
}
const users = new UserCollection([
  ["gm", { id: "gm", isGM: true, active: true }],
  ["owner-a", { id: "owner-a", isGM: false, active: true }],
  ["owner-b", { id: "owner-b", isGM: false, active: true }]
]);

globalThis.game = {
  user: users.get("gm"),
  users,
  combat: null,
  mtrol: { actions: {} }
};
globalThis.ui = { notifications: { warn: message => warnings.push(message) } };
globalThis.Hooks = { on() {}, callAll() {} };
globalThis.canvas = { grid: { size: 100 }, scene: { grid: { size: 100, distance: 1 } } };

const documents = new Map();
globalThis.fromUuid = async uuid => documents.get(uuid) ?? null;

let reactiveOpposition = null;
let reactionMovement = null;
game.mtrol.actions.getPendingOppositionForActor = actor =>
  reactiveOpposition && (
    reactiveOpposition.targetActorId === actor?.id ||
    reactiveOpposition.targetActorUuid === actor?.uuid
  ) ? reactiveOpposition : null;
game.mtrol.actions.getReactionMovementForActor = actor =>
  reactionMovement?.actorUuid === actor?.uuid ? reactionMovement : null;

const {
  canPrepare,
  completeResolvedTurnAction,
  consumePreparation,
  getActionGuard,
  getCombatantTurnState,
  getPreparation,
  getPrepareGuard,
  getTurnResolutionState,
  prepare,
  setPreparation,
  startCombatantTurnAuthoritative,
  turnSocketOperations,
  validateTurnMovement
} = await import("../scripts/combat/turn-system.js");

class Combatants extends Array {
  get(id) { return this.find(value => value.id === id) ?? null; }
}

function actor(id, ownerId) {
  const items = new Map();
  const value = {
    id,
    uuid: `Actor.${id}`,
    items,
    system: { identidad: { classId: "guerrero" } },
    flags: { mtrol: {} },
    ownership: { [ownerId]: 3 },
    testUserPermission(user) { return user.id === ownerId || user.isGM; },
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
    async update(changes) {
      for (const [path, next] of Object.entries(changes)) {
        const [, scope, key] = path.split(".");
        this.flags[scope] ??= {};
        this.flags[scope][key] = structuredClone(next);
      }
      return this;
    }
  };
  documents.set(value.uuid, value);
  return value;
}

function item(owner, id, actionType, cooldown = 0) {
  const value = {
    id,
    uuid: `${owner.uuid}.Item.${id}`,
    type: "competencia",
    name: id,
    system: { actionType, cooldown },
    flags: {},
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
    async setFlag(scope, key, data) {
      this.flags[scope] ??= {};
      this.flags[scope][key] = structuredClone(data);
      return data;
    }
  };
  owner.items.set(id, value);
  documents.set(value.uuid, value);
  return value;
}

function combatant(id, owner, turn) {
  return {
    id,
    actor: owner,
    flags: { mtrol: { turnState: {
      combatId: "combat",
      round: 1,
      turn,
      baseMovementRemaining: 1,
      extraMovementRemaining: 0,
      actionConsumed: false
    } } },
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
    async setFlag(scope, key, data) {
      this.flags[scope] ??= {};
      this.flags[scope][key] = structuredClone(data);
      return data;
    }
  };
}

function scenario() {
  reactiveOpposition = null;
  reactionMovement = null;
  const attacker = actor(`attacker-${Math.random()}`, "owner-a");
  const defender = actor(`defender-${Math.random()}`, "owner-b");
  const scenarioId = Math.random().toString(36).slice(2);
  const first = combatant(`first-${scenarioId}`, attacker, 0);
  const second = combatant(`second-${scenarioId}`, defender, 1);
  const combatants = new Combatants(first, second);
  const combat = {
    id: "combat",
    started: true,
    round: 1,
    turn: 0,
    combatant: first,
    combatants,
    turns: combatants,
    nextTurnCalls: 0,
    async nextTurn() { this.nextTurnCalls++; }
  };
  game.combat = combat;
  return { attacker, defender, first, second, combat };
}

test("guard central permite al activo, bloquea acciones ajenas y mantiene la reacción", () => {
  const { attacker, defender } = scenario();
  assert.equal(getActionGuard(attacker, item(attacker, "attack", "attack")).allowed, true);
  assert.equal(getActionGuard(defender, item(defender, "other-attack", "attack")).allowed, false);
  assert.equal(getActionGuard(defender, item(defender, "defense-before", "defense")).allowed, false);
  reactiveOpposition = {
    id: "opposition-guard",
    status: "waiting-defense",
    targetActorId: defender.id,
    targetActorUuid: defender.uuid
  };
  assert.equal(getActionGuard(defender, item(defender, "defense", "defense")).allowed, true);
  assert.equal(getActionGuard(defender, item(defender, "spell", "attack")).allowed, true);
});

test("resolución ofensiva consume movimiento/acción pero la defensa no toca el turno futuro", async () => {
  const { attacker, defender, first, second, combat } = scenario();
  await turnSocketOperations.finalizeTurnUseAuthoritative({
    actorUuid: attacker.uuid,
    itemId: item(attacker, "attack", "attack").id,
    resolution: { finalResult: 25 }
  }, { requestingUserId: "owner-a" });
  assert.equal(getCombatantTurnState(first).actionConsumed, true);
  assert.equal(getCombatantTurnState(first).baseMovementRemaining, 0);
  await completeResolvedTurnAction(attacker, { completionId: "attack-complete" });
  await completeResolvedTurnAction(attacker, { completionId: "attack-complete" });
  assert.equal(combat.nextTurnCalls, 1, "el cierre duplicado no salta dos Combatants");

  const futureBefore = structuredClone(getCombatantTurnState(second));
  reactiveOpposition = {
    id: "opposition-defense",
    status: "waiting-defense",
    targetActorId: defender.id,
    targetActorUuid: defender.uuid
  };
  await turnSocketOperations.finalizeTurnUseAuthoritative({
    actorUuid: defender.uuid,
    itemId: item(defender, "defense", "defense").id,
    resolution: { finalResult: 30 }
  }, { requestingUserId: "owner-b" });
  assert.deepEqual(getCombatantTurnState(second), futureBefore);
});

test("una acción reactiva paga cooldown sin consumir el turno futuro", async () => {
  const { defender, second } = scenario();
  const spell = item(defender, "reactive-spell", "attack", 1);
  reactiveOpposition = {
    id: "opposition-spell",
    status: "waiting-defense",
    targetActorId: defender.id,
    targetActorUuid: defender.uuid
  };
  const futureBefore = structuredClone(getCombatantTurnState(second));
  const receipt = await turnSocketOperations.finalizeTurnUseAuthoritative({
    actorUuid: defender.uuid,
    itemId: spell.id,
    resolution: { finalResult: 22 }
  }, { requestingUserId: "owner-b" });
  assert.equal(receipt.reactive, true);
  assert.deepEqual(getCombatantTurnState(second), futureBefore);
  assert.deepEqual(spell.flags.mtrol.cooldown, {
    combatId: "combat",
    usedAtRound: 1,
    cooldownRounds: 1
  });
});

test("una resolución pendiente bloquea fin manual y sólo su cierre autoritativo avanza", async () => {
  const { attacker, combat } = scenario();
  const attack = item(attacker, "pending-attack", "attack");
  await turnSocketOperations.finalizeTurnUseAuthoritative({
    actorUuid: attacker.uuid,
    itemId: attack.id,
    resolution: { finalResult: 20 },
    pendingResolutionId: "pending-1"
  }, { requestingUserId: "owner-a" });
  assert.deepEqual(getTurnResolutionState(), {
    ids: ["pending-1"],
    actorUuid: attacker.uuid,
    itemUuid: attack.uuid,
    combatId: "combat",
    round: 1,
    turn: 0,
    pending: true
  });
  await assert.rejects(
    turnSocketOperations.endTurnAuthoritative({ combatId: "combat" }, { requestingUserId: "owner-a" }),
    /todavía está pendiente/
  );
  await assert.rejects(
    turnSocketOperations.completeResolvedTurnActionAuthoritative({
      actorUuid: attacker.uuid,
      resolutionId: "otra"
    }, { requestingUserId: "owner-a" }),
    /no coincide/
  );
  await turnSocketOperations.completeResolvedTurnActionAuthoritative({
    actorUuid: attacker.uuid,
    resolutionId: "pending-1"
  }, { requestingUserId: "owner-a" });
  assert.equal(combat.nextTurnCalls, 1);
});

test("refresh y reconexión sólo releen el estado persistido del Combatant", () => {
  const { first } = scenario();
  first.flags.mtrol.turnState.baseMovementRemaining = 0;
  first.flags.mtrol.turnState.extraMovementRemaining = 2;
  first.flags.mtrol.turnState.movementSpent = 1;
  first.flags.mtrol.turnState.actionConsumed = true;
  const before = structuredClone(first.flags.mtrol.turnState);
  assert.deepEqual(getCombatantTurnState(first), before);
  assert.deepEqual(getCombatantTurnState(first), before);
  assert.deepEqual(first.flags.mtrol.turnState, before);
});

test("Habilidad Especial contextual se valida en GM y Movimiento usa el resultado final", async () => {
  const { attacker, first } = scenario();
  attacker.system.identidad.classId = "mago";
  attacker.flags.mtrol.specialAbilities = { 1: { unlocked: true } };
  const orb = item(attacker, "orb", "utility", 1);
  orb.name = "Orbe Control";
  orb.system.specialAbilityKey = "orbe-control";
  await turnSocketOperations.finalizeTurnUseAuthoritative({
    actorUuid: attacker.uuid,
    itemId: orb.id,
    resolution: { finalResult: 29 },
    specialContext: { slot: 1, mode: "movement" }
  }, { requestingUserId: "owner-a" });
  const state = getCombatantTurnState(first);
  assert.equal(state.actionConsumed, true);
  assert.equal(state.baseMovementRemaining, 0);
  assert.equal(state.extraMovementRemaining, 2);
  assert.deepEqual(orb.flags.mtrol.cooldown, {
    combatId: "combat",
    usedAtRound: 1,
    cooldownRounds: 1
  });
});

test("Orbe Movimiento permanece permitido si el Actor ya gastó movimiento base", () => {
  const { attacker, first } = scenario();
  first.flags.mtrol.turnState.movementSpent = 1;
  first.flags.mtrol.turnState.baseMovementRemaining = 0;
  const guard = getActionGuard(attacker, item(attacker, "orb-move", "utility"), {
    kindOverride: "movement"
  });
  assert.equal(guard.allowed, true);
});

test("Habilidad Especial bloqueada o Stun diferido no mutan turno ni cooldown", async () => {
  const { attacker, first } = scenario();
  attacker.system.identidad.classId = "mago";
  const orb = item(attacker, "orb-locked", "utility", 1);
  orb.name = "Orbe Control";
  orb.system.specialAbilityKey = "orbe-control";
  const before = structuredClone(getCombatantTurnState(first));
  await assert.rejects(
    turnSocketOperations.finalizeTurnUseAuthoritative({
      actorUuid: attacker.uuid,
      itemId: orb.id,
      resolution: { finalResult: 30 },
      specialContext: { slot: 1, mode: "attack" }
    }, { requestingUserId: "owner-a" }),
    /bloqueada/
  );
  attacker.flags.mtrol.specialAbilities = { 1: { unlocked: true } };
  await assert.rejects(
    turnSocketOperations.finalizeTurnUseAuthoritative({
      actorUuid: attacker.uuid,
      itemId: orb.id,
      resolution: { finalResult: 30 },
      specialContext: { slot: 1, mode: "stun" }
    }, { requestingUserId: "owner-a" }),
    /no está disponible/
  );
  assert.deepEqual(getCombatantTurnState(first), before);
  assert.equal(orb.flags.mtrol, undefined);
});

test("Orbe Movimiento fallido consume la acción y finaliza el turno sin movimiento", async () => {
  const { attacker, first, combat } = scenario();
  attacker.system.identidad.classId = "mago";
  attacker.flags.mtrol.specialAbilities = { 1: { unlocked: true } };
  const orb = item(attacker, "orb-fail", "utility", 1);
  orb.name = "Orbe Control";
  orb.system.specialAbilityKey = "orbe-control";
  await turnSocketOperations.finalizeTurnUseAuthoritative({
    actorUuid: attacker.uuid,
    itemId: orb.id,
    resolution: { finalResult: 39, pifia: true },
    specialContext: { slot: 1, mode: "movement" }
  }, { requestingUserId: "owner-a" });
  assert.equal(getCombatantTurnState(first).actionConsumed, true);
  assert.equal(getCombatantTurnState(first).extraMovementRemaining, 0);
  assert.equal(combat.nextTurnCalls, 1);
});

test("fin voluntario acepta al Owner activo, rechaza a otro jugador y GM conserva control", async () => {
  const { combat, second } = scenario();
  await turnSocketOperations.endTurnAuthoritative({ combatId: "combat" }, { requestingUserId: "owner-a" });
  assert.equal(combat.nextTurnCalls, 1);
  await assert.rejects(
    turnSocketOperations.endTurnAuthoritative({ combatId: "combat" }, { requestingUserId: "owner-b" }),
    /propio turno/
  );
  combat.turn = 1;
  combat.combatant = second;
  await turnSocketOperations.endTurnAuthoritative({ combatId: "combat" }, { requestingUserId: "gm" });
  assert.equal(combat.nextTurnCalls, 2);
});

test("preUpdateToken bloquea exceso y actor ajeno; GM tiene bypass sin consumo", () => {
  const { attacker, defender, first } = scenario();
  const token = {
    uuid: "Scene.scene.Token.a",
    actor: attacker,
    parent: { grid: { size: 100, distance: 1 } },
    x: 0,
    y: 0,
    elevation: 0
  };
  assert.equal(validateTurnMovement(token, { x: 200 }, {}, "owner-a"), false);
  assert.equal(validateTurnMovement({ ...token, actor: defender }, { x: 100 }, {}, "owner-b"), false);
  assert.equal(validateTurnMovement(token, { x: 500 }, {}, "gm"), true);
  assert.equal(getCombatantTurnState(first).baseMovementRemaining, 1);
});

test("preUpdateToken consulta la colisión real de Foundry antes de autorizar", () => {
  const { attacker } = scenario();
  const token = {
    id: "token-a",
    uuid: "Scene.scene.Token.blocked",
    actor: attacker,
    parent: { grid: { size: 100, distance: 1 } },
    x: 0,
    y: 0,
    elevation: 0,
    object: {
      center: { x: 50, y: 50 },
      checkCollision(destination, options) {
        assert.deepEqual(destination, { x: 150, y: 50 });
        assert.deepEqual(options, { type: "move", mode: "any" });
        return true;
      }
    }
  };
  assert.equal(validateTurnMovement(token, { x: 100 }, {}, "owner-a"), false);
  assert.match(warnings.at(-1), /pared o columna/);
});

test("movimiento de Esquiva acepta una diagonal, limita a un cuadro y no toca el turno futuro", () => {
  const { defender, second } = scenario();
  reactionMovement = {
    pendingActionId: "dodge-resolution",
    actorUuid: defender.uuid,
    allowance: 1
  };
  const token = {
    id: "dodge-token",
    uuid: "Scene.scene.Token.dodge",
    actor: defender,
    parent: { grid: { size: 100, distance: 1 } },
    x: 0,
    y: 0,
    elevation: 0,
    object: {
      center: { x: 50, y: 50 },
      checkCollision: () => false
    }
  };
  const futureBefore = structuredClone(getCombatantTurnState(second));
  const diagonal = {};
  assert.equal(validateTurnMovement(token, { x: 100, y: 100 }, diagonal, "owner-b"), true);
  assert.deepEqual(diagonal.mtrolReactionMovement, {
    pendingActionId: "dodge-resolution",
    actorUuid: defender.uuid,
    tokenUuid: token.uuid,
    cost: 1
  });
  assert.equal(validateTurnMovement(token, { x: 200 }, {}, "owner-b"), false);
  assert.deepEqual(getCombatantTurnState(second), futureBefore);
});

test("Prepararse suma uno, consume movimiento/acción y finaliza el turno", async () => {
  const { attacker, first, combat } = scenario();
  assert.equal(canPrepare(attacker), true);
  const receipt = await prepare(attacker);
  assert.deepEqual([receipt.previous, receipt.value], [0, 1]);
  assert.equal(getPreparation(attacker), 1);
  assert.equal(getCombatantTurnState(first).actionConsumed, true);
  assert.equal(getCombatantTurnState(first).baseMovementRemaining, 0);
  assert.equal(getCombatantTurnState(first).extraMovementRemaining, 0);
  assert.equal(combat.nextTurnCalls, 1);
});

test("Prepararse acumula hasta +5 y rechaza perder otro turno en el cap", async () => {
  const { attacker, first, combat } = scenario();
  for (let expected = 1; expected <= 5; expected++) {
    first.flags.mtrol.turnState = {
      combatId: "combat", round: 1, turn: 0,
      baseMovementRemaining: 1, extraMovementRemaining: 0,
      movementSpent: 0, actionConsumed: false
    };
    const receipt = await prepare(attacker);
    assert.equal(receipt.value, expected);
  }
  first.flags.mtrol.turnState = {
    combatId: "combat", round: 2, turn: 0,
    baseMovementRemaining: 1, extraMovementRemaining: 0,
    movementSpent: 0, actionConsumed: false
  };
  combat.round = 2;
  const callsAtCap = combat.nextTurnCalls;
  assert.equal(getPrepareGuard(attacker).allowed, false);
  await assert.rejects(prepare(attacker), /máximo/);
  assert.equal(combat.nextTurnCalls, callsAtCap);
});

test("movimiento previo y ausencia de Combat bloquean Prepararse", () => {
  const { attacker, first } = scenario();
  first.flags.mtrol.turnState.movementSpent = 1;
  first.flags.mtrol.turnState.baseMovementRemaining = 0;
  assert.equal(getPrepareGuard(attacker).allowed, false);
  assert.match(getPrepareGuard(attacker).reason, /movido/);
  game.combat = null;
  assert.equal(canPrepare(attacker), false);
});

test("GM establece 0–5 dentro o fuera de combate y un jugador no puede hacerlo", async () => {
  const { attacker } = scenario();
  for (const value of [5, 2, 0]) {
    assert.equal((await setPreparation(attacker, value)).value, value);
    assert.equal(getPreparation(attacker), value);
  }
  game.user = users.get("owner-a");
  await assert.rejects(
    turnSocketOperations.setPreparationAuthoritative({ actorUuid: attacker.uuid, value: 5 }, { requestingUserId: "owner-a" }),
    /Sólo el GM/
  );
  game.user = users.get("gm");
});

test("la fórmula recibe la reserva completa y sólo después queda en cero", async () => {
  const { attacker } = scenario();
  await setPreparation(attacker, 4);
  let observedDuringFormula = null;
  const execution = await consumePreparation(attacker, async bonus => {
    observedDuringFormula = getPreparation(attacker);
    return { total: 10 + bonus, pifia: true };
  });
  assert.equal(execution.preparationBonus, 4);
  assert.equal(execution.result.total, 14);
  assert.equal(observedDuringFormula, 4);
  assert.equal(getPreparation(attacker), 0);
});

test("si la fórmula no llega a resolverse, la reserva se libera sin perder Preparación", async () => {
  const { attacker } = scenario();
  await setPreparation(attacker, 3);
  await assert.rejects(
    consumePreparation(attacker, async () => { throw new Error("cancelada"); }),
    /cancelada/
  );
  assert.equal(getPreparation(attacker), 3);
  assert.equal(attacker.getFlag("mtrol", "preparationReservation"), null);
});

test("dos consumos simultáneos no pueden aplicar dos veces la misma Preparación", async () => {
  const { attacker } = scenario();
  await setPreparation(attacker, 5);
  let executions = 0;
  const run = () => consumePreparation(attacker, async bonus => {
    executions++;
    return bonus;
  });
  const settled = await Promise.allSettled([run(), run()]);
  assert.equal(settled.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(executions, 1);
  assert.equal(getPreparation(attacker), 0);
});

test("una defensa consume Preparación sin consumir ni alterar el turno futuro del defensor", async () => {
  const { defender, second } = scenario();
  await setPreparation(defender, 4);
  const futureBefore = structuredClone(getCombatantTurnState(second));
  const execution = await consumePreparation(defender, bonus => ({ defenseTotal: 8 + bonus }));
  assert.equal(execution.result.defenseTotal, 12);
  assert.equal(getPreparation(defender), 0);
  assert.deepEqual(getCombatantTurnState(second), futureBefore);
});

test("elevation pura no crea gasto y una actualización combinada cobra sólo X/Y", () => {
  const { attacker, first } = scenario();
  const token = {
    id: "elevation-token",
    uuid: "Scene.scene.Token.elevation",
    actor: attacker,
    parent: { grid: { size: 100, distance: 1 } },
    x: 0,
    y: 0,
    elevation: 0
  };
  const elevationOptions = {};
  assert.equal(validateTurnMovement(token, { elevation: 50 }, elevationOptions, "owner-a"), true);
  assert.equal(elevationOptions.mtrolTurnMovement, undefined);
  assert.equal(getCombatantTurnState(first).movementSpent, 0);

  const combinedOptions = {};
  assert.equal(validateTurnMovement(token, { x: 100, elevation: 50 }, combinedOptions, "owner-a"), true);
  assert.equal(combinedOptions.mtrolTurnMovement.cost, 1);
});

test("escenario completo V1: movimiento, ataque, reacción, Prepararse, especial y cooldown", async () => {
  const { attacker: actorA, defender: actorB, first, second, combat } = scenario();
  const attack = item(actorA, "flow-attack", "attack");
  const defense = item(actorB, "flow-defense", "defense");

  const tokenA = {
    uuid: `${actorA.uuid}.Token`,
    actor: actorA,
    parent: { grid: { size: 100, distance: 1 } },
    x: 0,
    y: 0,
    elevation: 0
  };
  documents.set(tokenA.uuid, tokenA);
  const moveOptions = {};
  assert.equal(validateTurnMovement(tokenA, { x: 100 }, moveOptions, "owner-a"), true);
  await turnSocketOperations.commitTurnMovementAuthoritative({
    tokenUuid: tokenA.uuid,
    movement: moveOptions.mtrolTurnMovement
  }, { requestingUserId: "owner-a" });
  assert.equal(getCombatantTurnState(first).movementSpent, 1);

  await turnSocketOperations.finalizeTurnUseAuthoritative({
    actorUuid: actorA.uuid,
    itemId: attack.id,
    resolution: { finalResult: 18 },
    pendingResolutionId: "flow-opposition"
  }, { requestingUserId: "owner-a" });
  const defenderFuture = structuredClone(getCombatantTurnState(second));
  reactiveOpposition = {
    id: "flow-opposition",
    status: "waiting-defense",
    targetActorId: actorB.id,
    targetActorUuid: actorB.uuid
  };
  await turnSocketOperations.finalizeTurnUseAuthoritative({
    actorUuid: actorB.uuid,
    itemId: defense.id,
    resolution: { finalResult: 14 }
  }, { requestingUserId: "owner-b" });
  assert.deepEqual(getCombatantTurnState(second), defenderFuture);
  await turnSocketOperations.completeResolvedTurnActionAuthoritative({
    actorUuid: actorA.uuid,
    resolutionId: "flow-opposition"
  }, { requestingUserId: "owner-a" });
  assert.equal(combat.nextTurnCalls, 1);

  combat.turn = 1;
  combat.combatant = second;
  await startCombatantTurnAuthoritative(second, {
    combat,
    combatId: "combat",
    round: 1,
    turn: 1,
    combatant: second,
    actor: actorB
  });
  await prepare(actorB);
  assert.equal(getPreparation(actorB), 1);
  assert.equal(combat.nextTurnCalls, 2);

  combat.round = 2;
  combat.turn = 0;
  combat.combatant = first;
  await startCombatantTurnAuthoritative(first, {
    combat,
    combatId: "combat",
    round: 2,
    turn: 0,
    combatant: first,
    actor: actorA
  });
  await turnSocketOperations.endTurnAuthoritative({ combatId: "combat" }, { requestingUserId: "owner-a" });

  combat.turn = 1;
  combat.combatant = second;
  await startCombatantTurnAuthoritative(second, {
    combat,
    combatId: "combat",
    round: 2,
    turn: 1,
    combatant: second,
    actor: actorB
  });
  assert.equal(getPreparation(actorB), 1, "Preparación persiste entre rondas");
  actorB.system.identidad.classId = "mago";
  actorB.flags.mtrol.specialAbilities = { 1: { unlocked: true } };
  const orb = item(actorB, "flow-orb", "utility", 1);
  orb.name = "Orbe Control";
  orb.system.specialAbilityKey = "orbe-control";
  const prepared = await consumePreparation(actorB, bonus => ({ finalResult: 20 + bonus }));
  assert.equal(prepared.result.finalResult, 21);
  assert.equal(getPreparation(actorB), 0);
  await turnSocketOperations.finalizeTurnUseAuthoritative({
    actorUuid: actorB.uuid,
    itemId: orb.id,
    resolution: prepared.result,
    specialContext: { slot: 1, mode: "attack" }
  }, { requestingUserId: "owner-b" });
  await turnSocketOperations.completeResolvedTurnActionAuthoritative({
    actorUuid: actorB.uuid,
    completionId: "flow-special"
  }, { requestingUserId: "owner-b" });
  assert.equal(orb.flags.mtrol.cooldown.usedAtRound, 2);
  assert.equal(combat.nextTurnCalls, 4);
});
