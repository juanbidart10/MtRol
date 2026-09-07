import test from "node:test";
import assert from "node:assert/strict";
import {
  assertCanonicalOffensiveConfiguration,
  validateCanonicalFormula
} from "../scripts/actions/combat-ability-policy.js";
import { resolveActionDefinition } from "../scripts/actions/action-definition-resolver.js";

const validFormulas = [
  "1d20",
  "1d20 + @atributos.resistencia",
  "1d20 + @competencias.magia",
  "1d20 + @competencias.combate_con_armas",
  "1d20 + @atributos.inteligencia + @competencias.magia",
  "1d20 + @atributos.fuerza + @competencias.combate_con_armas + @armas",
  "2d10"
];

function installRoll(t) {
  const calls = [];
  // Fixed syntax fixtures, not a replacement for Foundry's parser. The unknown
  // attribute is syntactically valid so MTROL must reject it independently.
  const syntaxValid = new Set([...validFormulas, "1d20 + @atributos.fuerzzza"]);
  class ContextualRoll {
    static validate(formula) {
      calls.push({ receiver: this, formula });
      return this === ContextualRoll && syntaxValid.has(formula);
    }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, "Roll");
  globalThis.Roll = ContextualRoll;
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "Roll", original);
    else delete globalThis.Roll;
  });
  return { calls, ContextualRoll };
}

test("Roll.validate mock explicitly requires its class receiver", t => {
  const { ContextualRoll } = installRoll(t);
  assert.equal(ContextualRoll.validate.call(ContextualRoll, "1d20"), true);
  const validate = ContextualRoll.validate;
  assert.equal(validate("1d20"), false);
  assert.equal(validateCanonicalFormula("1d20").valid, true);
});

for (const formula of validFormulas) {
  test(`canonical validation preserves Roll context: ${formula}`, t => {
    const { calls, ContextualRoll } = installRoll(t);
    const labels = formula.includes("@armas") ? ["damageFormula"] : ["formula", "damageFormula"];
    for (const label of labels) {
      assert.deepEqual(validateCanonicalFormula(formula, {
        label, allowWeapons: label === "damageFormula"
      }), { valid: true, formula, errors: [] });
    }
    assert.equal(calls.length, labels.length);
    assert.ok(calls.every(call => call.receiver === ContextualRoll && call.formula === formula));
  });
}

for (const formula of ["1d20 +", "1d20 + ("]) {
  test(`Foundry syntax rejection remains effective: ${formula}`, t => {
    const { calls, ContextualRoll } = installRoll(t);
    for (const label of ["formula", "damageFormula"]) {
      assert.deepEqual(validateCanonicalFormula(formula, { label, allowWeapons: true }).errors,
        [`${label} inválida.`]);
    }
    assert.equal(calls.length, 2);
    assert.ok(calls.every(call => call.receiver === ContextualRoll));
  });
}

test("MTROL rejects unknown attributes before Foundry syntax validation", t => {
  const { calls, ContextualRoll } = installRoll(t);
  const formula = "1d20 + @atributos.fuerzzza";
  assert.equal(ContextualRoll.validate(formula), true);
  calls.length = 0;
  assert.deepEqual(validateCanonicalFormula(formula).errors,
    ["Atributo desconocido: @atributos.fuerzzza."]);
  assert.equal(calls.length, 0);
});

test("a Foundry validator exception still rejects the formula", t => {
  const { ContextualRoll } = installRoll(t);
  ContextualRoll.validate = function () { throw new Error("invalid syntax"); };
  assert.equal(validateCanonicalFormula("1d20").valid, false);
});

test("Aliento de Dragon passes offensive preflight with a context-dependent Roll", t => {
  const { calls, ContextualRoll } = installRoll(t);
  const item = {
    name: "Aliento de Dragon", type: "competencia",
    system: {
      formula: "1d20 + @atributos.inteligencia + @competencias.magia",
      damageFormula: "2d10", resolutionResult: "damage",
      capabilities: ["OFFENSIVE"], actionDomain: "MAGICAL",
      allowedResponses: ["DEFENSE"]
    }
  };
  const targetActor = { items: [{ type: "competencia", system: {
    capabilities: ["REACTION", "DEFENSE"]
  } }] };
  const definition = resolveActionDefinition(item);
  assert.equal(definition.resolutionResult, "damage");
  assert.equal(assertCanonicalOffensiveConfiguration({ item, targetActor, definition }), true);
  assert.deepEqual(calls.map(call => call.formula), [item.system.formula, item.system.damageFormula]);
  assert.ok(calls.every(call => call.receiver === ContextualRoll));
  item.system.damageFormula = "1d20 +";
  assert.throws(() => assertCanonicalOffensiveConfiguration({ item, targetActor, definition }),
    /damageFormula inválida/);
});
