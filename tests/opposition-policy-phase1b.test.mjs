import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_ALLOWED_RESPONSES,
  evaluateOppositionResponseEligibility,
  getOppositionActionDefinition,
  OPPOSITION_CAPABILITIES
} from "../scripts/actions/opposition-policy.js";
import {
  getCounterattackPolicyForClass,
  MTROL_CLASS_FAMILIES
} from "../scripts/actors/class-registry.js";

function actor(classId = "guerrero") {
  return {
    id: "defender",
    uuid: "Actor.defender",
    system: { identidad: { classId } }
  };
}

function item(system = {}) {
  return {
    id: "response",
    uuid: "Actor.defender.Item.response",
    type: "competencia",
    system
  };
}

function pending(actionDomain = "PHYSICAL", allowedResponses = DEFAULT_ALLOWED_RESPONSES) {
  return {
    id: "pending",
    status: "waiting-defense",
    targetActorId: "defender",
    targetActorUuid: "Actor.defender",
    actionDomain,
    allowedResponses: Array.from(allowedResponses)
  };
}

function evaluate({
  actionDomain = "PHYSICAL",
  classId = "guerrero",
  capabilities,
  responseDomain = null,
  selectedCapability,
  allowedResponses = DEFAULT_ALLOWED_RESPONSES,
  extra = {}
}) {
  return evaluateOppositionResponseEligibility({
    pendingAction: pending(actionDomain, allowedResponses),
    actor: actor(classId),
    item: item({ capabilities, responseDomain, ...extra }),
    selectedCapability,
    guard: { allowed: true, reactive: true, opposition: { id: "pending" } }
  });
}

test("actionType canónico conserva identidad y separa capabilities del comportamiento legacy", () => {
  const spell = getOppositionActionDefinition(item({
    categoria: "hechizo",
    actionType: "defense",
    defenseType: "dodge"
  }));
  assert.equal(spell.actionType, "spell");
  assert.equal(spell.legacyActionType, "defense");
  assert.deepEqual(spell.capabilities, ["DODGE", "REACTION", "MOVEMENT"]);
});

test("mapper legacy deriva defensa y dodge sin mutar el Item", () => {
  const legacyDefense = item({ actionType: "defense", defenseType: "shield" });
  const legacyDodge = item({ actionType: "defense", defenseType: "dodge" });
  assert.deepEqual(
    getOppositionActionDefinition(legacyDefense).capabilities,
    ["DEFENSE", "REACTION"]
  );
  assert.deepEqual(
    getOppositionActionDefinition(legacyDodge).capabilities,
    ["DODGE", "REACTION"]
  );
  assert.equal(legacyDefense.system.capabilities, undefined);
  assert.equal(legacyDodge.system.capabilities, undefined);
});

test("familias de clase aplican la clasificación aprobada", () => {
  assert.equal(getCounterattackPolicyForClass("guerrero").family, MTROL_CLASS_FAMILIES.PHYSICAL);
  assert.equal(getCounterattackPolicyForClass("mago").family, MTROL_CLASS_FAMILIES.MAGICAL);
  for (const classId of ["alquimista", "bardo", "clerigo"]) {
    const policy = getCounterattackPolicyForClass(classId);
    assert.equal(policy.family, MTROL_CLASS_FAMILIES.HYBRID);
    assert.deepEqual(policy.counterattackDomains, ["PHYSICAL"]);
  }
});

test("matriz de DODGE y DEFENSE es transversal a PHYSICAL y MAGICAL", () => {
  for (const actionDomain of ["PHYSICAL", "MAGICAL"]) {
    for (const selectedCapability of ["DODGE", "DEFENSE"]) {
      const result = evaluate({
        actionDomain,
        capabilities: [selectedCapability, "REACTION"],
        selectedCapability
      });
      assert.equal(result.valid, true, `${selectedCapability} vs ${actionDomain}`);
    }
  }
});

test("matriz de COUNTERATTACK exige dominio coincidente y policy de clase", () => {
  const capabilities = ["OFFENSIVE", "COUNTERATTACK", "REACTION"];
  const scenarios = [
    ["PHYSICAL", "guerrero", "PHYSICAL", true],
    ["MAGICAL", "guerrero", "PHYSICAL", false],
    ["PHYSICAL", "mago", "MAGICAL", false],
    ["MAGICAL", "mago", "MAGICAL", true],
    ["PHYSICAL", "clerigo", "PHYSICAL", true],
    ["MAGICAL", "clerigo", "PHYSICAL", false]
  ];
  for (const [actionDomain, classId, responseDomain, valid] of scenarios) {
    const result = evaluate({
      actionDomain,
      classId,
      capabilities,
      responseDomain,
      selectedCapability: "COUNTERATTACK"
    });
    assert.equal(result.valid, valid, `${actionDomain}/${classId}/${responseDomain}`);
  }
});

test("override futuro vive en la habilidad y no muta policy híbrida", () => {
  const result = evaluate({
    actionDomain: "MAGICAL",
    classId: "clerigo",
    capabilities: ["OFFENSIVE", "COUNTERATTACK", "REACTION"],
    responseDomain: "MAGICAL",
    selectedCapability: "COUNTERATTACK",
    extra: { counterattackDomainOverrides: ["MAGICAL"] }
  });
  assert.equal(result.valid, true);
  assert.deepEqual(getCounterattackPolicyForClass("clerigo").counterattackDomains, ["PHYSICAL"]);
});

test("libre y MOVEMENT sin capability reactiva no son wildcard", () => {
  const free = evaluate({
    capabilities: [],
    selectedCapability: null,
    extra: { oppositionType: "free", actionType: "utility" }
  });
  assert.equal(free.valid, false);
  assert.equal(free.reasonCode, "CAPABILITY_NOT_DECLARED");

  const movement = evaluate({
    capabilities: ["MOVEMENT"],
    selectedCapability: "MOVEMENT",
    allowedResponses: ["DODGE"]
  });
  assert.equal(movement.valid, false);
});

test("Esquiva Áurica declarativa es spell multi-capability y esquiva ambos dominios", () => {
  const auric = {
    categoria: "hechizo",
    actionType: "spell",
    capabilities: ["DODGE", "REACTION", "MOVEMENT"],
    responseCapability: "DODGE"
  };
  const definition = getOppositionActionDefinition(item(auric));
  assert.equal(definition.actionType, "spell");
  assert.deepEqual(definition.capabilities, ["DODGE", "REACTION", "MOVEMENT"]);
  for (const actionDomain of ["PHYSICAL", "MAGICAL"]) {
    assert.equal(evaluate({ actionDomain, capabilities: auric.capabilities }).valid, true);
  }
});

test("allowedResponses restringe una acción multi-capability y fija preset sin selector", () => {
  const result = evaluate({
    capabilities: ["DEFENSE", "DODGE", "REACTION"],
    selectedCapability: null,
    allowedResponses: [OPPOSITION_CAPABILITIES.DODGE],
    extra: { responseCapability: "DODGE" }
  });
  assert.equal(result.valid, true);
  assert.equal(result.selectedCapability, "DODGE");

  const ambiguous = evaluate({
    capabilities: ["DEFENSE", "DODGE", "REACTION"],
    selectedCapability: null,
    allowedResponses: ["DEFENSE", "DODGE"]
  });
  assert.equal(ambiguous.valid, false);
  assert.equal(ambiguous.reasonCode, "AMBIGUOUS_RESPONSE_CAPABILITY");
});

test("rechaza target, estado y guard incorrectos con códigos estables", () => {
  const base = {
    pendingAction: pending(),
    actor: actor(),
    item: item({ capabilities: ["DODGE", "REACTION"] }),
    selectedCapability: "DODGE"
  };
  assert.equal(evaluateOppositionResponseEligibility({
    ...base,
    pendingAction: { ...base.pendingAction, status: "resolved" }
  }).reasonCode, "OPPOSITION_NOT_WAITING");
  assert.equal(evaluateOppositionResponseEligibility({
    ...base,
    actor: { ...base.actor, id: "other", uuid: "Actor.other" }
  }).reasonCode, "UNAUTHORIZED_TARGET");
  assert.equal(evaluateOppositionResponseEligibility({
    ...base,
    guard: { allowed: false, reason: "cooldown" }
  }).reasonCode, "ACTION_GUARD_REJECTED");
});
