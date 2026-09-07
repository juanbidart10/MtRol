import test from "node:test";
import assert from "node:assert/strict";

const {
  resolveActionDefinition,
  resolveCanonicalDamageContext
} = await import("../scripts/actions/action-definition-resolver.js");

test("resolver conserva metadata explícita de oposición", () => {
  const definition = resolveActionDefinition({
    name: "Golpe Arcano",
    system: {
      actionType: "attack",
      actionDomain: "MAGICAL",
      capabilities: ["OFFENSIVE"],
      allowedResponses: ["DODGE"],
      requiresOpposition: true,
      effect: "damage",
      defenseType: "dodge"
    },
    _source: { system: { requiresOpposition: true } }
  });

  assert.equal(definition.requiresOpposition, true);
  assert.equal(definition.actionDomain, "MAGICAL");
  assert.deepEqual(definition.capabilities, ["OFFENSIVE"]);
  assert.deepEqual(definition.allowedResponses, ["DODGE"]);
  assert.equal(definition.effect, "damage");
});

test("resolver mantiene fallback legacy de daño opuesto sin inferir nombres nuevos", () => {
  const damage = resolveActionDefinition({
    name: "Ataque cualquiera",
    system: { actionType: "attack", danio: "1d8" },
    _source: { system: { actionType: "attack", danio: "1d8" } }
  });
  const utility = resolveActionDefinition({ name: "Ataque cualquiera", system: {} });

  assert.equal(damage.requiresOpposition, true);
  assert.equal(utility.requiresOpposition, false);
});

test("contexto de daño canónico conserva fórmula, coste y referencias", () => {
  const context = resolveCanonicalDamageContext({
    sourceActor: { uuid: "Actor.a", img: "actor.webp" },
    targetActor: { uuid: "Actor.b" },
    sourceItem: {
      id: "spell",
      uuid: "Actor.a.Item.spell",
      name: "Rayo",
      img: "rayo.webp",
      system: {
        categoria: "competencia",
        danio: "7",
        ejecutaDanio: true,
        usaDanioLocalizado: false,
        damageResolution: "onOppositionWin",
        damageMode: "enabled",
        damageCostType: "basic",
        damageSourceAttribute: "aura",
        resolutionResult: "damage"
      },
      _source: { system: { damageResolution: "onOppositionWin" } }
    },
    requiresOpposition: true,
    data: { costoTotal: 3, sourceTokenUuid: "Token.a", targetTokenUuid: "Token.b" }
  });

  assert.equal(context.available, true);
  assert.equal(context.formula, "7");
  assert.equal(context.flatValue, 7);
  assert.equal(context.costType, "basic");
  assert.equal(context.basicCostIncludedInActivation, true);
  assert.equal(context.localized, false);
  assert.equal(context.sourceActorUuid, "Actor.a");
  assert.equal(context.targetActorUuid, "Actor.b");
  assert.equal(context.damageSourceAttribute, "aura");
});

test("contexto de daño ignora atributo legacy y acepta sólo metadata explícita canónica", () => {
  const sourceActor = { uuid: "Actor.a" };
  const targetActor = { uuid: "Actor.b" };
  const base = {
    id: "spell",
    system: {
      ejecutaDanio: true,
      danio: "1d6 + @atributos.aura",
      atributo: "aura"
    }
  };
  assert.equal(resolveCanonicalDamageContext({
    sourceActor,
    targetActor,
    sourceItem: base
  }).damageSourceAttribute, null);
  assert.equal(resolveCanonicalDamageContext({
    sourceActor,
    targetActor,
    sourceItem: { ...base, system: { ...base.system, damageSourceAttribute: "aura" } }
  }).damageSourceAttribute, "aura");
});

test("action-engine conserva el export legacy del resolver", async () => {
  globalThis.game ??= { combats: new Map(), actors: new Map(), users: new Map() };
  globalThis.Hooks ??= { on() {} };
  globalThis.foundry ??= { utils: { randomID: () => "id", deepClone: structuredClone } };
  const legacy = await import("../scripts/actions/action-engine.js");
  assert.equal(
    legacy.getActionDefinitionFromItem({ system: { requiresOpposition: false }, _source: { system: { requiresOpposition: false } } }).requiresOpposition,
    false
  );
});

