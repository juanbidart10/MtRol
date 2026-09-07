import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

globalThis.foundry = {
  utils: {
    deepClone: value => value === undefined ? undefined : structuredClone(value),
    randomID: () => "effect-pipeline",
    mergeObject: (target, source) => Object.assign(target, source)
  }
};

function actor(raceId, attributes = {}) {
  const items = [];
  items.get = id => items.find(item => item.id === id) ?? null;
  return {
    id: raceId,
    uuid: `Actor.${raceId}`,
    name: raceId,
    system: {
      identidad: { raceId },
      atributos: {
        fuerza: 4, aura: 4, resistencia: 3, inteligencia: 2, voluntad: 2,
        carisma: 2, percepcion: 2, destreza: 2, suerte: 2,
        ...attributes
      },
      recursos: {}, vitales: { hp: { value: 20, max: 20 } },
      equipamiento: {}
    },
    items,
    getRollData: () => ({})
  };
}

const orc = actor("orco");
const combat = {
  id: "combat-effects",
  started: true,
  round: 1,
  turn: 0,
  flags: { mtrol: {} },
  combatants: [],
  turns: [],
  async update(changes) {
    if (changes["flags.mtrol.runtime"]) this.flags.mtrol.runtime = structuredClone(changes["flags.mtrol.runtime"]);
  }
};
const orcCombatant = { id: "combatant-orc", actor: orc };
combat.combatant = orcCombatant;
combat.combatants.push(orcCombatant);
combat.turns.push(orcCombatant);

globalThis.game = {
  user: { id: "gm", isGM: true },
  users: { get: () => ({ id: "gm", isGM: true }) },
  actors: { get: () => null },
  combat,
  combats: { get: id => id === combat.id ? combat : null }
};

const { mtrolPrepararRollData } = await import("../scripts/rolls/formula-parser.js");
const { prepareDamageFormulaContext } = await import("../scripts/actions/action-damage-engine.js");
const {
  aplicarDanioCanonicoAutorizado,
  resolveAuthorizedDamageMitigation
} = await import("../scripts/combat/damage-authorized.js");

test("pipeline de fórmula usa dato efectivo contextual y conserva fórmula/dado reales", async () => {
  const prepared = prepareDamageFormulaContext({
    actor: orc,
    formula: "1d10 + @atributos.fuerza",
    damage: { combatId: combat.id }
  });
  assert.equal(prepared.context.formula, "1d10 + @atributos.fuerza");
  assert.equal(prepared.formulaData.atributos.fuerza, 6);
  assert.equal(orc.system.atributos.fuerza, 4);
  assert.equal(mtrolPrepararRollData(orc).data.atributos.fuerza, 4, "roll general permanece intacto");

  const source = await readFile(new URL("../scripts/actions/action-damage-engine.js", import.meta.url), "utf8");
  assert.match(source, /new Roll\(\s*formula,\s*rollData\s*\)/);
  assert.doesNotMatch(source, /\(formula[^\n]*\)\s*\*\s*1\.5/);
});

test("Elemental modifica Aura en damage context fuera de Combat, no el Actor", () => {
  const gnome = actor("gnomo");
  const prepared = prepareDamageFormulaContext({
    actor: gnome,
    formula: "1d8 + @atributos.aura",
    damage: { combatId: null }
  });
  assert.equal(prepared.formulaData.atributos.aura, 6);
  assert.equal(gnome.system.atributos.aura, 4);
});

test("mitigación pura identifica target Enano sólo cuando participa en Combat", () => {
  const dwarf = actor("enano");
  const dwarfCombatant = { id: "combatant-dwarf", actor: dwarf };
  combat.combatants.push(dwarfCombatant);
  const mitigation = resolveAuthorizedDamageMitigation({
    attackerActor: orc,
    targetActor: dwarf,
    damage: 15,
    combatId: combat.id
  });
  assert.equal(mitigation.resolution.value, 9);
  combat.combatants.pop();
  assert.equal(resolveAuthorizedDamageMitigation({
    attackerActor: orc,
    targetActor: dwarf,
    damage: 15,
    combatId: combat.id
  }).resolution.value, 15);
});

test("orden canónico: armadura recibe daño bruto y luego Inquebrantable reduce sólo HP", async () => {
  const dwarf = actor("enano");
  const armor = {
    id: "armor", uuid: `${dwarf.uuid}.Item.armor`, type: "objeto", name: "Armadura",
    system: { defensa: 10 }
  };
  dwarf.items.push(armor);
  dwarf.system.equipamiento.pecho = armor.id;
  dwarf.documentName = "Actor";
  dwarf.flags = { mtrol: {} };
  dwarf.setFlag = async (_scope, key, value) => { dwarf.flags.mtrol[key] = structuredClone(value); };
  dwarf.update = async changes => {
    if ("system.equipamiento.pecho" in changes) dwarf.system.equipamiento.pecho = changes["system.equipamiento.pecho"];
    if ("system.vitales.hp.value" in changes) dwarf.system.vitales.hp.value = changes["system.vitales.hp.value"];
  };
  dwarf.deleteEmbeddedDocuments = async (_type, ids) => {
    for (const id of ids) {
      const index = dwarf.items.findIndex(item => item.id === id);
      if (index >= 0) dwarf.items.splice(index, 1);
    }
  };
  const dwarfCombatant = { id: "combatant-dwarf", actor: dwarf };
  combat.combatants.push(dwarfCombatant);

  const receipt = await aplicarDanioCanonicoAutorizado({
    attackerActor: orc,
    targetActor: dwarf,
    transactionId: "armor-before-inquebrantable",
    payload: { danio: 15, slot: "pecho", numeroLocalizacion: 5, combatId: combat.id }
  });

  assert.equal(receipt.result.defensaInicial, 10);
  assert.equal(receipt.result.itemDestruido, true, "la armadura recibió los 15 puntos brutos");
  assert.equal(receipt.result.danioAbsorbido, 10);
  assert.equal(receipt.result.danioMitigadoPasiva, 5);
  assert.equal(receipt.result.hpPerdido, 0);
  assert.equal(dwarf.system.vitales.hp.value, 20);
  assert.equal(receipt.result.effectResolution.appliedEffects[0].passiveId, "inquebrantable");
  combat.combatants.pop();
});

