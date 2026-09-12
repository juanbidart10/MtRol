import test from "node:test";
import assert from "node:assert/strict";
import { resolveActionDefinition } from "../scripts/actions/action-definition-resolver.js";
import { evaluateOppositionResponseEligibility } from "../scripts/actions/opposition-policy.js";

class ItemSheet {
  constructor(item) { this.item = item; }
  getData() { return {}; }
  activateListeners() {}
  async _updateObject(_event, data) { return structuredClone(data); }
}
globalThis.foundry = {
  appv1: { sheets: { ItemSheet } },
  utils: { duplicate: structuredClone }
};
globalThis.game = { user: { isGM: true }, system: { id: "mtrol" } };
globalThis.ui = { notifications: { warn() {} } };
const { CompetenciaSheet } = await import("../scripts/sheets/items/competencia-sheet.js");

const responses = ["DEFENSE", "DODGE", "COUNTERATTACK"];
function sheet(system = {}) {
  return new CompetenciaSheet({
    name: "Habilidad", type: "competencia", img: "icons/svg/item-bag.svg", system
  });
}
function controls(selected) {
  return Object.fromEntries([
    ["mtrolResponseControls", "true"],
    ...selected.map(value => [`mtrolAllowedResponse.${value}`, true])
  ]);
}

for (let count = 0; count <= 3; count++) {
  test(`${count} allowed response checkboxes persist an exact array including omitted unchecked inputs`, async () => {
    const selected = responses.slice(0, count);
    const result = await sheet({ allowedResponses: responses })._updateObject(null, controls(selected));
    assert.deepEqual(result["system.allowedResponses"], selected);
    assert.ok(Object.keys(result).every(key => !key.startsWith("mtrol")));
  });
  test(`${count} historical responses render the corresponding checked options`, () => {
    const selected = responses.slice(0, count);
    const options = sheet({ allowedResponses: selected }).getData().allowedResponseOptions;
    assert.deepEqual(options.filter(option => option.selected).map(option => option.value), selected);
    assert.deepEqual(options.map(option => option.label), ["Defensa", "Esquiva", "Contraataque"]);
  });
}

test("historical array order is preserved and serialized false is not selected", async () => {
  const result = await sheet({ allowedResponses: ["DODGE", "DEFENSE"] })._updateObject(null, {
    ...controls(["DEFENSE", "DODGE"]), "mtrolAllowedResponse.COUNTERATTACK": "false"
  });
  assert.deepEqual(result["system.allowedResponses"], ["DODGE", "DEFENSE"]);
});

for (const capability of [null, ...responses]) {
  test(`response display derives zero/one capability without persisting: ${capability}`, async () => {
    const current = sheet({ capabilities: capability ? [capability, "REACTION"] : ["OFFENSIVE"] });
    const config = current.getData().responseConfiguration;
    assert.deepEqual(config.candidates, capability ? [capability] : []);
    assert.equal(config.multiple, false);
    assert.equal(Boolean(config.singleLabel), Boolean(capability));
    const result = await current._updateObject(null, {});
    assert.deepEqual(result, {});
  });
}

test("multiple responses offer only compatible radios and persist an independent preset", async () => {
  const system = { capabilities: ["DEFENSE", "DODGE", "REACTION"], allowedResponses: responses };
  const current = sheet(system);
  const config = current.getData().responseConfiguration;
  assert.equal(config.multiple, true);
  assert.deepEqual(config.options.filter(option => option.available).map(option => option.value), ["DEFENSE", "DODGE"]);
  const result = await current._updateObject(null, {
    ...controls(responses), "system.responseCapability": "DODGE"
  });
  assert.equal(result["system.responseCapability"], "DODGE");
  assert.deepEqual(result["system.allowedResponses"], responses);
  assert.equal(Object.hasOwn(result, "system.capabilities"), false);
  assert.deepEqual(current.item.system, system);
});

test("removing a capability preserves the stored preset for warning, without auto-fix", async () => {
 const current = sheet({ capabilities: ["DEFENSE", "DODGE", "REACTION"], responseCapability: "DODGE" });
 const result = await current._updateObject(null, {"system.capabilities": ["DEFENSE", "REACTION"]});
 assert.equal(Object.hasOwn(result, "system.responseCapability"), false);
});

for (const preset of [null, "", "auto", "Automática", ...responses]) {
  test(`historical preset ${JSON.stringify(preset)} is preserved without editing`, async () => {
    const current = sheet({ capabilities: ["DODGE", "REACTION"], responseCapability: preset });
    assert.equal(current.getData().responseConfiguration.singleLabel, "Esquiva");
    assert.deepEqual(await current._updateObject(null, {}), {});
  });
}

test("multiple responses without a compatible preset require an explicit selection", async () => {
  for (const preset of [null, "", "auto", "Automática", "COUNTERATTACK"]) {
    const current = sheet({ capabilities: ["DEFENSE", "DODGE", "REACTION"], responseCapability: preset });
    assert.equal(current.getData().responseConfiguration.options.some(option => option.selected), false);
    assert.deepEqual(await current._updateObject(null, {}), {});
    assert.equal(Object.hasOwn(await current._updateObject(null, { "system.capabilities": ["DEFENSE", "DODGE", "REACTION"] }), "system.responseCapability"), false);
    assert.equal((await current._updateObject(null, { "system.responseCapability": "DODGE" }))["system.responseCapability"], "DODGE");
  }
});

test("damage locks opposition in view, submission and the existing authoritative resolver", async () => {
  const current = sheet({ resolutionResult: "damage", capabilities: ["OFFENSIVE"], requiresOpposition: false });
  assert.equal(current.getData().oppositionRequired, true);
  assert.equal(current.getData().showOppositionType, true);
  const result = await current._updateObject(null, { "system.requiresOpposition": false });
  assert.equal(result["system.requiresOpposition"], true);
  assert.equal(resolveActionDefinition(current.item).requiresOpposition, true);
  assert.equal(current.item.system.requiresOpposition, false);
});

test("utility opposition remains configurable", async () => {
  const current = sheet({ resolutionResult: "utility", capabilities: ["OFFENSIVE"], requiresOpposition: false });
  assert.equal(current.getData().oppositionRequired, false);
  const result = await current._updateObject(null, { "system.requiresOpposition": false });
  assert.equal(result["system.requiresOpposition"], false);
  assert.equal(resolveActionDefinition(current.item).requiresOpposition, false);
});

for (let count = 1; count <= 3; count++) {
  test(`opposition still intersects ${count} allowed responses with each response Item`, () => {
    const allowedResponses = responses.slice(0, count);
    for (const capability of responses) {
      const result = evaluateOppositionResponseEligibility({
        pendingAction: { id: "p", status: "waiting-defense", targetActorId: "a", actionDomain: "PHYSICAL", allowedResponses },
        actor: { id: "a", system: { identidad: { classId: "guerrero" } } },
        item: { type: "competencia", system: {
          capabilities: [capability, "REACTION"], responseCapability: capability, responseDomain: "PHYSICAL"
        } }
      });
      assert.equal(result.valid, allowedResponses.includes(capability), result.humanReason);
    }
  });
}
