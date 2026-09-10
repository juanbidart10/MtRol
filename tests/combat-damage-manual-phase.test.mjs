import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

globalThis.game ??= { user: { id: "gm", isGM: true } };
globalThis.foundry ??= { utils: { deepClone: structuredClone } };

const {
  appendModifiersToFormula,
  normalizeContextualModifiers,
  validateCanonicalFormula
} = await import("../scripts/actions/combat-ability-policy.js");
const { mtrolResolverDanioArmas } = await import("../scripts/rolls/roll-helpers.js");

function weapon(id, damage, type = "arma") {
  return { id, uuid: `Actor.a.Item.${id}`, name: id, type: "objeto", system: { tipoObjeto: type, danio: damage } };
}

function actorWithHands(left = null, right = null) {
  const items = new Map([left, right].filter(Boolean).map(item => [item.id, item]));
  return {
    items,
    system: { equipamiento: { manoIzq: left?.id ?? "", manoDer: right?.id ?? "" } }
  };
}

test("formula y damageFormula validan referencias con responsabilidades separadas", () => {
  assert.equal(validateCanonicalFormula("1d20 + @atributos.fuerza").valid, true);
  assert.equal(validateCanonicalFormula("1d20 + @atributos.fuerzzza").valid, false);
  assert.equal(validateCanonicalFormula("1d20 + @armas").valid, false);
  assert.equal(validateCanonicalFormula("1d20 + @armas", { allowWeapons: true }).valid, true);
  assert.equal(validateCanonicalFormula("1d8 + @competencias.combate_con_armas").valid, true);
});

test("@armas suma cero, un arma, dual wield y deduplica el mismo Item", () => {
  assert.equal(mtrolResolverDanioArmas(actorWithHands()).total, 0);
  const sword = weapon("sword", 15);
  const dagger = weapon("dagger", 10);
  assert.equal(mtrolResolverDanioArmas(actorWithHands(null, sword)).total, 15);
  assert.equal(mtrolResolverDanioArmas(actorWithHands(dagger, sword)).total, 25);
  assert.equal(mtrolResolverDanioArmas(actorWithHands(sword, sword)).total, 15);
});

test("@armas excluye escudo, acepta nudillos y relee equipamiento actual", () => {
  const shield = weapon("shield", 20, "escudo");
  const knuckles = weapon("knuckles", 10);
  const actor = actorWithHands(shield, knuckles);
  assert.equal(mtrolResolverDanioArmas(actor).total, 10);
  actor.items.delete(knuckles.id);
  assert.equal(mtrolResolverDanioArmas(actor).total, 0);
});

test("@armas acepta 0 y bloquea daño equipado inválido", () => {
  assert.equal(mtrolResolverDanioArmas(actorWithHands(null, weapon("zero", 0))).total, 0);
  for (const value of ["", null, -1, 2.5, 31, "quince"]) {
    assert.throws(
      () => mtrolResolverDanioArmas(actorWithHands(null, weapon(`bad-${value}`, value))),
      /entero entre 0 y 30/
    );
  }
});

test("modifiers son explicables, stackean en la fórmula y el de nivel es sólo GM", () => {
  const modifiers = normalizeContextualModifiers([
    { sourceId: "ability", sourceType: "ability", label: "Habilidad", value: 5 },
    { sourceId: "state", sourceType: "state", label: "Estado", value: 3 },
    { sourceId: "gm-level", sourceType: "gm-level-difference", label: "Diferencia de nivel", value: -5 }
  ], { allowGmOnly: true });
  assert.equal(appendModifiersToFormula("1d20", modifiers), "1d20 + 5 + 3 - 5");
  assert.equal(modifiers.reduce((total, modifier) => total + modifier.value, 0), 3);
  assert.throws(() => normalizeContextualModifiers([modifiers[2]], { allowGmOnly: false }), /Sólo el GM/);
});

test("schema y UI aplican cap global 0–30 y conservan Extra", async () => {
  const [model, template, slots] = await Promise.all([
    readFile(new URL("../models/objeto-model.js", import.meta.url), "utf8"),
    readFile(new URL("../templates/items/objeto-sheet.html", import.meta.url), "utf8"),
    readFile(new URL("../scripts/constants/body-slots.js", import.meta.url), "utf8")
  ]);
  assert.doesNotMatch(model, /max:\s*20/);
  assert.match(model, /max:\s*30/g);
  assert.doesNotMatch(template, /max="20"/);
  assert.match(template, /max="30"/);
  assert.match(slots, /10:\s*"extra"/);
});

test("guardrails: no timeout defensivo, no daño automático/directo y Chat ofensivo privado", async () => {
  const [engine, sheet, card] = await Promise.all([
    readFile(new URL("../scripts/actions/action-engine.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/sheets/actors/personaje-sheet.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/combat/combat-card.js", import.meta.url), "utf8")
  ]);
  assert.doesNotMatch(engine, /cancellationReason\s*=\s*[\r\n\s]*"timeout"/);
  assert.doesNotMatch(engine, /automatic resolved damage execution/);
  assert.doesNotMatch(sheet, /executeConfiguredCompetenciaDamage|createReadyDamageActionFromCompetencia/);
  assert.doesNotMatch(card, /Da&ntilde;o absorbido|HP perdido|Defensa restante|Inquebrantable|Virtus|Maldici[oó]n/);
});

test("desempate muestra overlay efímero y conserva 1–5/6–10", async () => {
  const originalCanvas = globalThis.canvas;
  const originalPixi = globalThis.PIXI;
  const originalRoll = globalThis.Roll;
  const totals = [5, 6];
  const added = [];
  class TextMock {
    constructor(options) {
      this.options = options;
      this.anchor = { set() {} };
      this.position = { set() {} };
      this.parent = { removeChild: value => { value.removed = true; } };
    }
    destroy() { this.destroyed = true; }
  }
  globalThis.canvas = { dimensions: { width: 100, height: 80 }, stage: { addChild: value => added.push(value) } };
  globalThis.PIXI = { Text: TextMock };
  globalThis.Roll = class {
    constructor(formula) { this.formula = formula; }
    async evaluate() { this.total = totals.shift(); return this; }
  };
  try {
    const { rollMtrolTieBreaker } = await import("../scripts/actions/resolution-engine.js");
    assert.equal((await rollMtrolTieBreaker({ delayMs: 0 })).winner, "attacker");
    assert.equal((await rollMtrolTieBreaker({ delayMs: 0 })).winner, "defender");
    assert.equal(added.length, 2);
    assert.ok(added.every(label => label.removed && label.destroyed));
  } finally {
    globalThis.canvas = originalCanvas;
    globalThis.PIXI = originalPixi;
    globalThis.Roll = originalRoll;
  }
});

test("system.json mantiene versión 1.4.1", async () => {
  const system = JSON.parse(await readFile(new URL("../system.json", import.meta.url), "utf8"));
  assert.equal(system.version, "1.4.1");
});
