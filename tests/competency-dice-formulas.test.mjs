import test from "node:test";
import assert from "node:assert/strict";
import { getCompetencyFormula, getCompetencyDieFormula, MTROL_COMPETENCY_TECHNICAL_IDS } from "../scripts/competencies/competency-catalog.js";
import { mtrolPrepararRollData } from "../scripts/rolls/formula-parser.js";
import { mtrolCrearFormulaVisual } from "../scripts/rolls/roll-formatter.js";
import { validateCanonicalFormula, assertCanonicalOffensiveConfiguration } from "../scripts/actions/combat-ability-policy.js";
import { getMtrolRollModifiers } from "../scripts/ui/chat-roll-card-renderer.js";

function competency(technicalId = "magia", nivel = 5, id = technicalId) {
  return { id, type: "competencia", name: "Magia", system: { technicalId, nivel } };
}
function actor(items = []) {
  return { items, system: { atributos: { inteligencia: 4, fuerza: 3, percepcion: 2 }, equipamiento: {} }, getRollData: () => ({}) };
}
function expand(formula, data) {
  return formula.replace(/@([\w.]+)/g, (_match, path) => String(path.split(".").reduce((value, key) => value?.[key], data) ?? 0));
}
// Construction-only probe: any attempted evaluation while preparing RollData fails.
class ProbeRoll {
  constructor(formula, data) {
    this.formula = expand(formula, data);
    this.terms = [...this.formula.matchAll(/(\d+)d(\d+)|([+*-])|(\d+)/g)].map(match =>
      match[1] ? { number: Number(match[1]), faces: Number(match[2]), results: [] }
        : match[3] ? { operator: match[3] } : { number: Number(match[4]) });
  }
  evaluate() { throw new Error("Unexpected pre-evaluation"); }
}

for (const [index, die] of ["1d4", "1d6", "1d8", "1d10", "1d12"].entries()) {
  const level = index + 1;
  test(`level ${level}: full competency and die-only contracts coexist`, () => {
    assert.equal(getCompetencyFormula(level), `${die} + ${level}`);
    assert.equal(getCompetencyDieFormula(level), die);
    const { data } = mtrolPrepararRollData(actor([competency("magia", level)]));
    assert.equal(expand("@competencias.magia", data), `(${die} + ${level})`);
    assert.equal(expand("@competenciasDado.magia", data), die);
  });
}

test("all 46 technical IDs support both namespaces at every level", () => {
  for (let level = 1; level <= 5; level++) {
    const { data } = mtrolPrepararRollData(actor(MTROL_COMPETENCY_TECHNICAL_IDS.map(id => competency(id, level))));
    assert.equal(Object.keys(data.competenciasDado).length, 46);
    for (const id of MTROL_COMPETENCY_TECHNICAL_IDS) {
      assert.equal(data.competenciasDado[id], getCompetencyDieFormula(level));
      assert.equal(data.competencias[id], `(${getCompetencyFormula(level)})`);
    }
  }
});

test("missing competencies, unknown IDs, invalid levels and duplicates match existing behavior", () => {
  const missing = mtrolPrepararRollData(actor()).data;
  for (const namespace of ["competencias", "competenciasDado"]) {
    assert.equal(expand(`@${namespace}.magia`, missing), "0");
    assert.equal(expand(`@${namespace}.foo_bar_inexistente`, missing), "0");
    assert.equal(validateCanonicalFormula(`@${namespace}.foo_bar_inexistente`).valid, true);
  }
  for (const level of [0, -1, 6, 99, null, "x", 2.5]) {
    assert.equal(getCompetencyDieFormula(level), null);
    const { data } = mtrolPrepararRollData(actor([competency("magia", level)]));
    assert.equal(data.competenciasDado.magia, 0);
    assert.equal(data.competencias.magia, 0);
  }
  const { data, etiquetas } = mtrolPrepararRollData(actor([competency("magia", 5, "a"), competency("magia", 3, "b")]));
  assert.equal(data.competenciasDado.magia, 0);
  assert.equal(data.competencias.magia, 0);
  assert.equal(etiquetas["competenciasDado.magia"], undefined);
});

test("renaming does not affect technical identity and display name alone grants no reference", () => {
  const item = competency();
  item.name = "Arcanismo";
  assert.equal(mtrolPrepararRollData(actor([item])).data.competenciasDado.magia, "1d12");
  item.system.technicalId = "";
  item.name = "Magia";
  assert.equal(mtrolPrepararRollData(actor([item])).data.competenciasDado.magia, 0);
});

test("initial formula preserves dice expressions, attribute and breakdown without level bonus", t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "Roll");
  globalThis.Roll = ProbeRoll;
  t.after(() => original ? Object.defineProperty(globalThis, "Roll", original) : delete globalThis.Roll);
  const formula = "1d20 + @atributos.inteligencia + @competenciasDado.magia";
  const { data, etiquetas } = mtrolPrepararRollData(actor([competency()]));
  const roll = new Roll(formula, data);
  assert.equal(roll.formula, "1d20 + 4 + 1d12");
  assert.deepEqual(roll.terms.filter(term => term.faces).map(term => term.faces), [20, 12]);
  assert.ok(roll.terms.filter(term => term.faces).every(term => term.results.length === 0));
  assert.deepEqual(getMtrolRollModifiers(roll).map(modifier => modifier.value), [4]);
  assert.equal(mtrolCrearFormulaVisual(formula, etiquetas), "1d20 + INTELIGENCIA + MAGIA — DADO DE COMPETENCIA");
});

test("damage uses die-only competency with unchanged weapon resolver", () => {
  const weapon = { id: "sword", type: "objeto", name: "Espada", system: { tipoObjeto: "arma", danio: 15 } };
  const current = actor([competency("combate_con_armas", 3), weapon]);
  current.system.equipamiento.manoDer = weapon.id;
  const formula = "1d20 + @atributos.fuerza + @competenciasDado.combate_con_armas + @armas";
  assert.equal(validateCanonicalFormula(formula, { allowWeapons: true }).valid, true);
  const { data, armas } = mtrolPrepararRollData(current, { includeWeapons: true });
  const roll = new ProbeRoll(formula, data);
  assert.equal(roll.formula, "1d20 + 3 + 1d8 + 15");
  assert.equal(armas.total, 15);
  assert.deepEqual(roll.terms.filter(term => term.faces).map(term => term.faces), [20, 8]);
  assert.deepEqual(getMtrolRollModifiers(roll).map(modifier => modifier.value), [3, 15]);
});

test("mixed and repeated references retain separate dice and arithmetic precedence", () => {
  const { data } = mtrolPrepararRollData(actor([competency()]));
  const roll = new ProbeRoll("@competencias.magia + @competenciasDado.magia", data);
  assert.equal(roll.formula, "(1d12 + 5) + 1d12");
  assert.equal(roll.terms.filter(term => term.faces === 12).length, 2);
  assert.equal(expand("2 * @competenciasDado.magia + @competenciasDado.magia / 2", data), "2 * 1d12 + 1d12 / 2");
});

test("new namespace uses the bound Foundry validator in initial/damage preflight", t => {
  const valid = [
    "1d20 + @competenciasDado.magia",
    "1d20 + @atributos.inteligencia + @competenciasDado.magia",
    "1d20 + @competenciasDado.combate_con_armas + @armas",
    "@competencias.magia + @competenciasDado.magia"
  ];
  const original = Object.getOwnPropertyDescriptor(globalThis, "Roll");
  class ContextRoll { static validate(formula) { return this === ContextRoll && valid.includes(formula); } }
  globalThis.Roll = ContextRoll;
  t.after(() => original ? Object.defineProperty(globalThis, "Roll", original) : delete globalThis.Roll);
  for (const formula of valid) assert.equal(validateCanonicalFormula(formula, { allowWeapons: true }).valid, true);
  for (const formula of ["1d20 +", "1d20 + ("]) assert.equal(validateCanonicalFormula(formula).valid, false);
  assert.equal(assertCanonicalOffensiveConfiguration({
    item: { name: "Habilidad", system: { formula: valid[1], damageFormula: valid[2] } },
    definition: { resolutionResult: "damage", actionDomain: "MAGICAL", allowedResponses: ["DEFENSE"] }
  }), true);
});

test("malformed die-only paths are rejected even when Foundry would accept them", t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "Roll");
  globalThis.Roll = { validate() { assert.fail("Canonical reference errors must stop before syntax validation"); } };
  t.after(() => original ? Object.defineProperty(globalThis, "Roll", original) : delete globalThis.Roll);
  for (const formula of ["@competenciasDado", "@competenciasDado.", "@competenciasDado.Magia", "@competenciasDado.foo__bar", "@competenciasDado.magia.nivel"]) {
    assert.match(validateCanonicalFormula(formula).errors.join(" "), /Referencia de competencia inválida/);
  }
});
