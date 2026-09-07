import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  classifyTurnAction,
  consumeOffensiveAction,
  createTurnState,
  getCooldownStatus,
  grantExtraMovement,
  measureGridSpaces,
  movementFromFinalResult,
  movementRemaining,
  sanitizePreparation,
  spendMovement
} from "../scripts/combat/turn-state.js";

test("fase 1: cada turno nace con un cuadro base y una acción limpia", () => {
  assert.deepEqual(createTurnState({ combatId: "c1", round: 3, turn: 2 }), {
    combatId: "c1",
    round: 3,
    turn: 2,
    baseMovementRemaining: 1,
    extraMovementRemaining: 0,
    movementSpent: 0,
    actionConsumed: false,
    movementSource: null,
    attributeMovementFollowUp: "none",
    followUpAttackAvailable: false,
    followUpAttackConsumed: false
  });
});

test("fase 1: defensa es reacción y no se confunde con una acción normal", () => {
  assert.equal(classifyTurnAction({ system: { actionType: "defense" } }), "reaction");
  assert.equal(classifyTurnAction({ system: { actionType: "utility" } }), "normal");
});

test("fase 2: horizontal, vertical y diagonal cuentan cuadros realmente atravesados", () => {
  const base = { fromX: 0, fromY: 0, gridSize: 100 };
  assert.equal(measureGridSpaces({ ...base, toX: 100, toY: 0 }), 1);
  assert.equal(measureGridSpaces({ ...base, toX: 0, toY: 200 }), 2);
  assert.equal(measureGridSpaces({ ...base, toX: 300, toY: 300 }), 3);
});

test("hotfix elevation: elevación pura cuesta cero y X/Y combinado ignora elevación", () => {
  assert.equal(measureGridSpaces({
    fromX: 0,
    fromY: 0,
    toX: 0,
    toY: 0,
    fromElevation: 0,
    toElevation: 100,
    gridSize: 100
  }), 0);
  assert.equal(measureGridSpaces({
    fromX: 0,
    fromY: 0,
    toX: 100,
    toY: 0,
    fromElevation: 0,
    toElevation: 100,
    gridSize: 100
  }), 1);
});

test("Preparación se sanitiza siempre al rango persistente 0–5", () => {
  assert.deepEqual(
    [-8, 0, 2.9, 5, 99, "invalido"].map(sanitizePreparation),
    [0, 0, 2, 5, 5, 0]
  );
});

test("fase 2: el límite exacto se permite y excederlo se rechaza antes de mutar", () => {
  const state = createTurnState();
  const exact = spendMovement(state, 1);
  const illegal = spendMovement(state, 2);
  assert.equal(exact.allowed, true);
  assert.equal(movementRemaining(exact.state), 0);
  assert.equal(illegal.allowed, false);
  assert.equal(movementRemaining(illegal.state), 1);
});

test("fase 2: tabla de movimiento usa exclusivamente el resultado final", () => {
  const cases = [[9, 0], [10, 1], [19, 1], [20, 2], [29, 2], [30, 3], [39, 3], [40, 4]];
  for (const [finalResult, expected] of cases) {
    assert.equal(movementFromFinalResult({ finalResult }), expected);
  }
});

test("fase 2: pifia o fallo invalidan todo movimiento extra", () => {
  assert.equal(movementFromFinalResult({ finalResult: 40, pifia: true }), 0);
  assert.equal(movementFromFinalResult({ finalResult: 40, success: false }), 0);
});

test("fase 2: movimiento parcial conserva lo no gastado y el base nunca acumula", () => {
  const withExtra = grantExtraMovement(createTurnState(), { finalResult: 25 }).state;
  assert.equal(movementRemaining(withExtra), 3);
  const partial = spendMovement(withExtra, 1).state;
  assert.deepEqual(
    [partial.baseMovementRemaining, partial.extraMovementRemaining],
    [0, 2]
  );
  assert.equal(createTurnState({ round: 2 }).baseMovementRemaining, 1);
});

test("fase 3: ataque consume acción y elimina todo movimiento sobrante", () => {
  const state = grantExtraMovement(createTurnState(), { finalResult: 35 }).state;
  const consumed = consumeOffensiveAction(state);
  assert.equal(consumed.actionConsumed, true);
  assert.equal(movementRemaining(consumed), 0);
  assert.equal(classifyTurnAction({ system: { actionType: "attack" } }), "offensive");
});

test("fase 3: hechizo de movimiento es acción completa pero conserva el extra obtenido", () => {
  const result = grantExtraMovement(createTurnState(), { finalResult: 34 }, { fullAction: true });
  assert.equal(result.granted, 3);
  assert.equal(result.state.actionConsumed, true);
  assert.equal(result.state.baseMovementRemaining, 1);
  assert.equal(result.state.extraMovementRemaining, 3);
});

test("fase 3: hechizo de movimiento fallido consume la acción sin otorgar cuadros", () => {
  const result = grantExtraMovement(
    createTurnState(),
    { finalResult: 34, pifia: true },
    { fullAction: true }
  );
  assert.equal(result.granted, 0);
  assert.equal(result.state.actionConsumed, true);
  assert.equal(movementRemaining(result.state), 1);
});

test("fase 4: CD 1 usado en R3 bloquea R4 y habilita R5", () => {
  const usage = { combatId: "combat", usedAtRound: 3 };
  assert.equal(getCooldownStatus({ currentCombatId: "combat", currentRound: 4, cooldownRounds: 1, usage }).available, false);
  assert.equal(getCooldownStatus({ currentCombatId: "combat", currentRound: 5, cooldownRounds: 1, usage }).available, true);
});

test("fase 4: CD 2 usado en R3 bloquea R4/R5 y habilita R6", () => {
  const usage = { combatId: "combat", usedAtRound: 3 };
  for (const round of [4, 5]) {
    assert.equal(getCooldownStatus({ currentCombatId: "combat", currentRound: round, cooldownRounds: 2, usage }).available, false);
  }
  assert.equal(getCooldownStatus({ currentCombatId: "combat", currentRound: 6, cooldownRounds: 2, usage }).available, true);
});

test("fase 4: cooldown pertenece al Combat y soporta saltos o retrocesos de ronda", () => {
  const usage = { combatId: "old", usedAtRound: 9 };
  assert.equal(getCooldownStatus({ currentCombatId: "new", currentRound: 1, cooldownRounds: 2, usage }).available, true);
  const sameCombat = { combatId: "new", usedAtRound: 3 };
  assert.equal(getCooldownStatus({ currentCombatId: "new", currentRound: 20, cooldownRounds: 2, usage: sameCombat }).available, true);
  assert.equal(getCooldownStatus({ currentCombatId: "new", currentRound: 2, cooldownRounds: 2, usage: sameCombat }).available, false);
});

test("integración: hooks semánticos, movimiento preventivo y sockets autoritativos están registrados", async () => {
  const [turnSource, hooksSource, socketSource, transactionSource, dispatcherSource] = await Promise.all([
    readFile(new URL("../scripts/combat/turn-system.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/core/hooks.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/core/sockets.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/runtime/transaction-commands.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/core/hook-dispatcher.js", import.meta.url), "utf8")
  ]);
  for (const hook of ["createCombat", "preUpdateCombat", "updateCombat", "deleteCombat"]) {
    assert.match(turnSource, new RegExp(`Hooks\\.on\\(\"${hook}\"`));
  }
  assert.match(turnSource, /preUpdateTokenDispatcher\.subscribe\("turn\.movement-guard"/);
  assert.match(turnSource, /updateTokenDispatcher\.subscribe\("turn\.movement-commit"/);
  assert.match(dispatcherSource, /Hooks\.on\("preUpdateToken"/);
  assert.match(dispatcherSource, /Hooks\.on\("updateToken"/);
  for (const event of ["TurnStart", "TurnEnd", "RoundStart", "RoundEnd"]) {
    assert.match(turnSource, new RegExp(`emitSemanticEvent\\(\"${event}\"`));
  }
  assert.match(hooksSource, /registerMtrolTurnHooks\(\)/);
  for (const operation of ["mtrolEndTurn", "mtrolGrantTurnMovement", "mtrolFinalizeTurnUse", "mtrolCompleteTurnAction"]) {
    assert.match(transactionSource, new RegExp(operation));
  }
  assert.match(transactionSource, /mtrolCommitTurnMovement:\s*"movement\.commit"/);
});

test("V1: tracker conserva un único finalizador, marca turno y expone panel GM", async () => {
  const [turnSource, trackerSource] = await Promise.all([
    readFile(new URL("../scripts/combat/turn-system.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/combat/turn-tracker-adapter.js", import.meta.url), "utf8")
  ]);
  assert.match(trackerSource, /TURNO ACTIVO/);
  assert.match(trackerSource, /Movimiento: \$\{api\.getAvailableMovement/);
  assert.match(trackerSource, /mtrol-gm-combat-state/);
  assert.match(trackerSource, /data-mtrol-gm-special-lock/);
  assert.match(trackerSource, /data-mtrol-gm-preparation/);
  assert.equal((trackerSource.match(/dataset\.mtrolEndTurn\s*=/g) ?? []).length, 1);
  const advanceSource = await readFile(new URL("../scripts/combat/turn-advance-service.js", import.meta.url), "utf8");
  assert.equal((`${turnSource}\n${advanceSource}`.match(/\.nextTurn\(\)/g) ?? []).length, 1);
});

test("Preparación se integra una vez en mtrolRoll e iniciativa y las tres vistas leen el mismo contexto", async () => {
  const [rollSource, initiativeSource, sheetSource, templateSource, transactionSource] = await Promise.all([
    readFile(new URL("../scripts/rolls/mtrol-rolls.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/combat/initiative-engine.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/sheets/actors/personaje-sheet.js", import.meta.url), "utf8"),
    readFile(new URL("../templates/actors/personaje-sheet.html", import.meta.url), "utf8"),
    readFile(new URL("../scripts/runtime/transaction-commands.js", import.meta.url), "utf8")
  ]);
  assert.equal((rollSource.match(/consumePreparation\(actor/g) ?? []).length, 1);
  assert.equal((initiativeSource.match(/consumePreparation\(actor/g) ?? []).length, 1);
  assert.match(rollSource, /orbPassiveBonus\.bonus \+\s*preparationBonus/);
  assert.match(initiativeSource, /primaryRollEffects\.value \+ evaluacion\.totalExtra \+ preparationBonus/);
  assert.match(sheetSource, /context\.mtrolPreparation/);
  assert.equal((templateSource.match(/En preparación:/g) ?? []).length, 3);
  assert.match(templateSource, /\{\{#if esGM\}\}[\s\S]*mtrol-preparation-adjust/);
  for (const operation of [
    "mtrolPrepareTurn",
    "mtrolSetPreparation",
    "mtrolReservePreparation",
    "mtrolCompletePreparation",
    "mtrolCancelPreparationReservation"
  ]) assert.match(transactionSource, new RegExp(operation));
});

test("hotfix movilidad conecta sólo los cuatro atributos y registra adapters de GRANTED MOVEMENT", async () => {
  const [sheetSource, socketSource, transactionSource] = await Promise.all([
    readFile(new URL("../scripts/sheets/actors/personaje-sheet.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/core/sockets.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/runtime/transaction-commands.js", import.meta.url), "utf8")
  ]);
  assert.match(sheetSource, /new Set\(\["destreza", "fuerza", "aura", "suerte"\]\)/);
  assert.match(sheetSource, /item\.system\?\.actionType === "movement"/);
  assert.match(transactionSource, /mtrolCommitGrantedMovement:\s*"movement\.commit"/);
  assert.match(transactionSource, /mtrolCompleteGrantedMovement:\s*"movement\.renounce"/);
  assert.match(transactionSource, /mtrolCompleteAttributeMovement/);
});
