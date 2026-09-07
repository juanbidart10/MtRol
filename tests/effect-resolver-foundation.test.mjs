import test from "node:test";
import assert from "node:assert/strict";

globalThis.foundry = { utils: { deepClone: value => structuredClone(value) } };

const { createEffectContext } = await import("../scripts/effects/effect-context.js");
const { resolveEffects } = await import("../scripts/effects/effect-resolver.js");
const {
  MTROL_EFFECT_PHASES,
  validateEffectDefinition
} = await import("../scripts/effects/effect-types.js");
const { resolveActivePassives } = await import("../scripts/effects/passive-assignment-resolver.js");
const { getRacialPassiveDefinition } = await import("../scripts/races/racial-passive-catalog.js");

function actor(raceId, attributes = {}) {
  return {
    uuid: `Actor.${raceId || "none"}`,
    system: {
      identidad: { raceId },
      atributos: {
        fuerza: 4, aura: 4, resistencia: 3, inteligencia: 2, voluntad: 2,
        carisma: 2, percepcion: 2, destreza: 2, suerte: 2,
        ...attributes
      }
    }
  };
}

function formulaContext(sourceActor, formula, { targetActor = null, isCombat = true } = {}) {
  return createEffectContext({
    phase: MTROL_EFFECT_PHASES.DAMAGE_FORMULA_BUILD,
    sourceActor,
    targetActor,
    formula,
    formulaData: { atributos: structuredClone(sourceActor.system.atributos) },
    isCombat,
    combatId: isCombat ? "combat" : null
  });
}

function mitigationContext(sourceActor, targetActor, damage, { isCombat = true, mitigationPolicy = "standard" } = {}) {
  return createEffectContext({
    phase: MTROL_EFFECT_PHASES.DAMAGE_MITIGATION,
    sourceActor,
    targetActor,
    rawDamage: damage,
    currentDamage: damage,
    isCombat,
    combatId: isCombat ? "combat" : null,
    mitigationPolicy
  });
}

test("PassiveAssignmentResolver descubre la pasiva racial actual y tolera identidad ausente o corrupta", () => {
  assert.deepEqual(resolveActivePassives(actor("orco")).passives.map(entry => entry.technicalId), ["sed_de_batalla"]);
  assert.deepEqual(resolveActivePassives(actor("gnomo")).passives.map(entry => entry.technicalId), ["elemental"]);
  assert.deepEqual(resolveActivePassives(actor("enano")).passives.map(entry => entry.technicalId), ["inquebrantable"]);
  assert.deepEqual(resolveActivePassives(actor("humano")).passives.map(entry => entry.technicalId), ["prodigio"]);
  assert.equal(resolveActivePassives(actor("")).passives.length, 0);

  const warnings = [];
  const invalid = resolveActivePassives(actor("desconocida"), {
    log: { warnOnce: (_channel, _message, diagnostic) => warnings.push(diagnostic) }
  });
  assert.equal(invalid.passives.length, 0);
  assert.equal(invalid.diagnostics[0].code, "RACE_ID_UNKNOWN");
  assert.equal(warnings.length, 1);
});

test("Effect type registry valida contratos piloto sin corregir payloads malformados", () => {
  for (const passiveId of ["sed_de_batalla", "elemental", "inquebrantable"]) {
    const effect = getRacialPassiveDefinition(passiveId).effects[0];
    assert.deepEqual(validateEffectDefinition(effect), { supported: true, valid: true, errors: [] });
  }
  assert.equal(validateEffectDefinition({
    type: "ATTRIBUTE_DAMAGE_MULTIPLIER", attribute: "Fuerza", multiplier: 0,
    subject: "target", requiresCombat: "sí", priority: "alta"
  }).valid, false);
  assert.equal(validateEffectDefinition({ type: "CAPABILITY" }).supported, false);
});

test("Sed de Batalla modifica sólo el aporte de Fuerza en daño de combate", () => {
  const orc = actor("orco");
  const before = structuredClone(orc.system.atributos);
  const result = resolveEffects(formulaContext(orc, "1d10 + @atributos.fuerza"));
  assert.equal(result.formulaData.atributos.fuerza, 6);
  assert.equal(result.formulaData.atributos.aura, 4);
  assert.deepEqual(orc.system.atributos, before);
  assert.deepEqual(result.appliedEffects.map(entry => ({
    passiveId: entry.passiveId, before: entry.before, after: entry.after
  })), [{ passiveId: "sed_de_batalla", before: 4, after: 6 }]);

  assert.equal(resolveEffects(formulaContext(orc, "2 * @atributos.fuerza")).formulaData.atributos.fuerza, 6);
  assert.equal(resolveEffects(formulaContext(orc, "1d10 + @atributos.aura")).appliedEffects.length, 0);
  assert.equal(resolveEffects(formulaContext(orc, "1d20 + @atributos.fuerza", { isCombat: false })).formulaData.atributos.fuerza, 4);
});

test("Sed de Batalla conserva fracciones y Elemental aplica fuera de Combat sólo en damage context", () => {
  const orc = actor("orco", { fuerza: 3 });
  assert.equal(resolveEffects(formulaContext(orc, "1d10 + @atributos.fuerza")).formulaData.atributos.fuerza, 4.5);

  const gnome = actor("gnomo");
  const result = resolveEffects(formulaContext(gnome, "1d8 + @atributos.aura", { isCombat: false }));
  assert.equal(result.formulaData.atributos.aura, 6);
  assert.equal(result.formulaData.atributos.fuerza, 4);
  assert.equal(result.appliedEffects[0].passiveId, "elemental");
});

test("source y target quedan separados para fórmula y mitigación", () => {
  const normal = actor("humano");
  const orcTarget = actor("orco");
  assert.equal(resolveEffects(formulaContext(normal, "1d10 + @atributos.fuerza", {
    targetActor: orcTarget
  })).formulaData.atributos.fuerza, 4);

  const dwarfSource = actor("enano");
  assert.equal(resolveEffects(mitigationContext(dwarfSource, normal, 15)).value, 15);
  assert.equal(resolveEffects(mitigationContext(normal, actor("enano"), 15)).value, 9);
});

test("Inquebrantable reduce el daño post-armadura con floor 0 y no aplica fuera de Combat", () => {
  const dwarf = actor("enano");
  const source = actor("humano");
  const before = structuredClone(dwarf.system.atributos);
  const fifteen = resolveEffects(mitigationContext(source, dwarf, 15));
  assert.equal(fifteen.value, 9);
  const applied = fifteen.appliedEffects[0];
  assert.deepEqual({
    passiveId: applied.passiveId,
    effectType: applied.effectType,
    phase: applied.phase,
    subject: applied.subject,
    actorUuid: applied.actorUuid,
    before: applied.before,
    after: applied.after,
    delta: applied.delta,
    attribute: applied.attribute,
    attributeValue: applied.attributeValue,
    reduction: applied.reduction
  }, {
    passiveId: "inquebrantable",
    effectType: "FLAT_DAMAGE_REDUCTION_FROM_ATTRIBUTE",
    phase: "DAMAGE_MITIGATION",
    subject: "target",
    actorUuid: "Actor.enano",
    before: 15,
    after: 9,
    delta: -6,
    attribute: "resistencia",
    attributeValue: 3,
    reduction: 6
  });
  assert.equal(resolveEffects(mitigationContext(source, dwarf, 4)).value, 0);
  assert.equal(resolveEffects(mitigationContext(source, dwarf, 0)).value, 0);
  assert.equal(resolveEffects(mitigationContext(source, dwarf, 15, { isCombat: false })).value, 15);
  assert.equal(resolveEffects(mitigationContext(source, dwarf, 15, { mitigationPolicy: "none" })).value, 15);
  assert.deepEqual(dwarf.system.atributos, before);
});

test("duplicados de una misma pasiva se procesan una vez y el orden es estable", () => {
  const elemental = getRacialPassiveDefinition("elemental");
  const gnome = actor("gnomo");
  const result = resolveEffects(formulaContext(gnome, "1d8 + @atributos.aura"), {
    resolvePassives: () => ({ passives: [elemental, elemental], diagnostics: [] })
  });
  assert.equal(result.formulaData.atributos.aura, 6);
  assert.equal(result.appliedEffects.length, 1);
});

test("pasivas aún sin handler se descubren pero permanecen inactivas", () => {
  for (const raceId of ["elfo", "elfo_oscuro", "sellado", "espectral"]) {
    const current = actor(raceId);
    const result = resolveEffects(formulaContext(current, "1d10 + @atributos.fuerza"));
    assert.equal(result.appliedEffects.length, 0, raceId);
    assert.deepEqual(result.formulaData.atributos, current.system.atributos, raceId);
    assert.ok(result.skippedEffects.length >= 1, raceId);
  }
});

test("cambiar raceId reemplaza la pasiva derivada sin copiarla ni alterar atributos", () => {
  const current = actor("orco");
  const attributes = structuredClone(current.system.atributos);
  assert.equal(resolveActivePassives(current).passives[0].technicalId, "sed_de_batalla");
  current.system.identidad.raceId = "gnomo";
  assert.equal(resolveActivePassives(current).passives[0].technicalId, "elemental");
  assert.deepEqual(current.system.atributos, attributes);
});
