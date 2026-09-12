import test from "node:test";
import assert from "node:assert/strict";
import {
  findTechnicallyCompatibleResponses,
  assertCanonicalOffensiveConfiguration
} from "../scripts/actions/combat-ability-policy.js";
import {
  DEFAULT_ALLOWED_RESPONSES,
  evaluateOppositionResponseEligibility
} from "../scripts/actions/opposition-policy.js";

function fixture({ capabilities, preset, responseDomain = "PHYSICAL", actionDomain = "MAGICAL",
  allowedResponses = DEFAULT_ALLOWED_RESPONSES, classId = "guerrero", extra = {} }) {
  const item = { id: "response", type: "competencia", system: {
    capabilities, responseCapability: preset, responseDomain, ...extra
  } };
  const actor = { id: "target", uuid: "Actor.target", items: [item], system: { identidad: { classId } } };
  const pendingAction = { id: "pending", status: "waiting-defense", targetActorId: actor.id,
    targetActorUuid: actor.uuid, actionDomain, allowedResponses: [...allowedResponses] };
  return { actor, item, pendingAction };
}

function verify(config, reason, effective) {
  const input = fixture(config);
  const before = structuredClone(input);
  const eligible = evaluateOppositionResponseEligibility(input);
  assert.equal(eligible.reasonCode, reason);
  if (effective !== undefined) assert.equal(eligible.selectedCapability, effective);
  assert.deepEqual(findTechnicallyCompatibleResponses(input.actor, input.pendingAction), reason === "OK" ? [input.item] : []);
  assert.deepEqual(input, before, "policy and preflight must not mutate documents or definition");
  return input;
}

for (const [label, capabilities, preset, responseDomain, reason] of [
  ["A", ["DEFENSE", "REACTION"], "DEFENSE", "PHYSICAL", "OK"],
  ["B", ["DODGE", "REACTION"], "DODGE", "PHYSICAL", "OK"],
  ["C", ["DEFENSE", "COUNTERATTACK", "REACTION"], "DEFENSE", "PHYSICAL", "OK"],
  ["D", ["DODGE", "COUNTERATTACK", "REACTION"], "DODGE", "PHYSICAL", "OK"],
  ["E", ["DEFENSE", "COUNTERATTACK", "REACTION"], "COUNTERATTACK", "PHYSICAL", "COUNTERATTACK_DOMAIN_MISMATCH"],
  ["F", ["DEFENSE", "COUNTERATTACK", "REACTION"], "DEFENSE", null, "OK"],
  ["G", ["DODGE", "COUNTERATTACK", "REACTION"], "DODGE", null, "OK"],
  ["H", ["DEFENSE", "COUNTERATTACK", "REACTION"], "COUNTERATTACK", null, "COUNTERATTACK_DOMAIN_MISSING"]
]) test(`${label}: MAGICAL attack / ${preset} / responseDomain ${responseDomain}`, () => {
  verify({ capabilities, preset, responseDomain }, reason, preset);
});

for (const preset of [null, "", "auto"]) {
  for (const capability of ["DEFENSE", "DODGE"]) {
    test(`I/J: ${JSON.stringify(preset)} resolves only allowed ${capability} on mixed Item`, () => {
      verify({ capabilities: [capability, "COUNTERATTACK", "REACTION"], preset,
        allowedResponses: [capability] }, "OK", capability);
    });
  }
  test(`K: ${JSON.stringify(preset)} counterattack still checks domain`, () => {
    verify({ capabilities: ["COUNTERATTACK", "REACTION"], preset,
      allowedResponses: ["COUNTERATTACK"] }, "COUNTERATTACK_DOMAIN_MISMATCH", "COUNTERATTACK");
  });
  test(`L: ${JSON.stringify(preset)} ambiguous response never picks arbitrarily`, () => {
    verify({ capabilities: ["DEFENSE", "COUNTERATTACK", "REACTION"], preset,
      allowedResponses: ["DEFENSE", "COUNTERATTACK"] }, "AMBIGUOUS_RESPONSE_CAPABILITY", null);
  });
}

for (const [classId, actionDomain, responseDomain, reason] of [
  ["guerrero", "PHYSICAL", "PHYSICAL", "OK"],
  ["mago", "MAGICAL", "MAGICAL", "OK"],
  ["clerigo", "PHYSICAL", "PHYSICAL", "OK"],
  ["mago", "PHYSICAL", "PHYSICAL", "CLASS_POLICY_REJECTED"],
  ["guerrero", "MAGICAL", "MAGICAL", "CLASS_POLICY_REJECTED"],
  ["clerigo", "MAGICAL", "MAGICAL", "CLASS_POLICY_REJECTED"]
]) test(`counterattack class policy ${classId}/${actionDomain}/${responseDomain}`, () => {
  verify({ capabilities: ["DEFENSE", "COUNTERATTACK", "REACTION"], preset: "COUNTERATTACK",
    classId, actionDomain, responseDomain }, reason, "COUNTERATTACK");
});

test("counterattack retains Item override and response-domain fallback", () => {
  const base = { capabilities: ["COUNTERATTACK", "REACTION"], preset: null,
    responseDomain: null, classId: "clerigo" };
  verify({ ...base, extra: { actionDomain: "MAGICAL", counterattackDomainOverrides: ["MAGICAL"] } }, "OK");
  verify({ ...base, extra: { damageType: "MAGICAL", counterattackDomainOverrides: ["MAGICAL"] } }, "OK");
  verify({ ...base, extra: { actionDomain: "PHYSICAL", damageType: "MAGICAL",
    counterattackDomainOverrides: ["MAGICAL"] } }, "COUNTERATTACK_DOMAIN_MISMATCH");
  verify({ ...base, classId: "unknown", extra: { actionDomain: "MAGICAL",
    counterattackDomainOverrides: ["MAGICAL"] } }, "CLASS_POLICY_REJECTED");
});

test("manual preset is not replaced by a different allowed candidate", () => {
  verify({ capabilities: ["DEFENSE", "COUNTERATTACK", "REACTION"], preset: "COUNTERATTACK",
    allowedResponses: ["DEFENSE"] }, "RESPONSE_NOT_ALLOWED", "COUNTERATTACK");
});

test("explicit selectedCapability overrides Item preset at authority", () => {
  const input = fixture({ capabilities: ["DEFENSE", "COUNTERATTACK", "REACTION"], preset: "COUNTERATTACK" });
  assert.equal(evaluateOppositionResponseEligibility({ ...input, selectedCapability: "DEFENSE" }).reasonCode, "OK");
  assert.equal(evaluateOppositionResponseEligibility({ ...input, selectedCapability: "auto",
    pendingAction: { ...input.pendingAction, allowedResponses: ["DEFENSE"] } }).selectedCapability, "DEFENSE");
});

test("REACTION, valid capability and allowedResponses remain required", () => {
  verify({ capabilities: ["DODGE", "COUNTERATTACK"], preset: "DODGE" }, "REACTION_NOT_DECLARED");
  verify({ capabilities: ["DODGE", "REACTION"], preset: "DEFENSE" }, "CAPABILITY_NOT_DECLARED");
  verify({ capabilities: ["DODGE", "REACTION"], preset: "DODGE", allowedResponses: [] }, "RESPONSE_NOT_ALLOWED");
});

test("offensive preflight admits mixed defense and dodge without domain normalization", () => {
  for (const preset of ["DEFENSE", "DODGE"]) {
    const input = verify({ capabilities: [preset, "COUNTERATTACK", "REACTION"], preset,
      responseDomain: null }, "OK");
    assert.doesNotThrow(() => assertCanonicalOffensiveConfiguration({
      item: { name: "Attack", system: { formula: "1d20", damageFormula: "1d6" } },
      targetActor: input.actor, definition: { ...input.pendingAction, resolutionResult: "damage" }
    }));
    assert.deepEqual(findTechnicallyCompatibleResponses(input.actor, {
      ...input.pendingAction, allowedResponses: [preset]
    }), [input.item]);
  }
});

test("authority still rejects invalid state, target and guard after mechanical preflight", () => {
  const input = verify({ capabilities: ["DEFENSE", "COUNTERATTACK", "REACTION"], preset: "DEFENSE" }, "OK");
  assert.equal(evaluateOppositionResponseEligibility({ ...input,
    pendingAction: { ...input.pendingAction, status: "resolved" } }).reasonCode, "OPPOSITION_NOT_WAITING");
  assert.equal(evaluateOppositionResponseEligibility({ ...input,
    actor: { ...input.actor, id: "other", uuid: "Actor.other" } }).reasonCode, "UNAUTHORIZED_TARGET");
  assert.equal(evaluateOppositionResponseEligibility({ ...input,
    guard: { allowed: false } }).reasonCode, "ACTION_GUARD_REJECTED");
});
