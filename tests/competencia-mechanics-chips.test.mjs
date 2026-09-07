import test from "node:test";
import assert from "node:assert/strict";
import { OPPOSITION_CAPABILITIES } from "../scripts/actions/opposition-policy.js";
import { MTROL_RESOLUTION_RESULTS } from "../scripts/actions/ability-config.js";

class ItemSheet {
  constructor(item) { this.item = item; }
  getData() { return {}; }
  async _updateObject(_event, data) {
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith("system.")) this.item.system[key.slice(7)] = structuredClone(value);
    }
    return data;
  }
}
globalThis.foundry = { appv1: { sheets: { ItemSheet } }, utils: { duplicate: structuredClone } };
globalThis.game = { user: { isGM: true }, system: { id: "mtrol" } };
globalThis.ui = { notifications: { warn() {} } };
const { CompetenciaSheet } = await import("../scripts/sheets/items/competencia-sheet.js");
const capabilities = Object.values(OPPOSITION_CAPABILITIES);
function sheet(system = {}) {
  return new CompetenciaSheet({ name: "Habilidad", img: "icons/svg/item-bag.svg", system });
}
function submitChips(selected, result = "utility") {
  return { mtrolCapabilityControls: "true", "system.resolutionResult": result,
    ...Object.fromEntries(capabilities.map(value => [`mtrolCapability.${value}`, selected.includes(value)])) };
}

for (const selected of [[], ["OFFENSIVE"], ["DEFENSE", "REACTION"], ["DODGE", "REACTION", "MOVEMENT"], ["OFFENSIVE", "COUNTERATTACK", "REACTION"], capabilities]) {
  test(`capability model-render-submit-model roundtrip: ${JSON.stringify(selected)}`, async () => {
    const current = sheet({ capabilities: selected, resolutionResult: "utility", responseCapability: selected.includes("DEFENSE") ? "DEFENSE" : null });
    const context = current.getData();
    assert.deepEqual(context.capabilityOptions.filter(option => option.selected).map(option => option.value), selected);
    assert.deepEqual(context.capabilityGroups.flatMap(group => group.options.map(option => option.value)), capabilities);
    const form = submitChips(context.capabilityOptions.filter(option => option.selected).map(option => option.value));
    if (selected.length === capabilities.length) form["system.responseCapability"] = "DEFENSE";
    const saved = await current._updateObject(null, form);
    assert.deepEqual(current.item.system.capabilities, selected);
    assert.deepEqual(saved["system.capabilities"], selected);
    assert.ok(Object.keys(saved).every(key => !key.startsWith("mtrolCapability")));
    assert.deepEqual(current.getData().capabilityOptions.filter(option => option.selected).map(option => option.value), selected);
  });
}

test("historical capability order survives saving without changes", async () => {
  const current = sheet({ capabilities: ["REACTION", "OFFENSIVE"], resolutionResult: "utility" });
  await current._updateObject(null, submitChips(["OFFENSIVE", "REACTION"]));
  assert.deepEqual(current.item.system.capabilities, ["REACTION", "OFFENSIVE"]);
});

test("unchecking removes stale capability and selecting adds the new one", async () => {
  const current = sheet({ capabilities: ["OFFENSIVE", "REACTION"] });
  await current._updateObject(null, submitChips(["OFFENSIVE", "MOVEMENT"]));
  assert.deepEqual(current.item.system.capabilities, ["OFFENSIVE", "MOVEMENT"]);
});

test("empty explicit capabilities render empty even with legacy offensive behavior", async () => {
  const current = sheet({ capabilities: [], actionType: "attack", resolutionResult: "utility" });
  assert.equal(current.getData().capabilityOptions.some(option => option.selected), false);
  await current._updateObject(null, submitChips([]));
  assert.deepEqual(current.item.system.capabilities, []);
});

for (const result of MTROL_RESOLUTION_RESULTS) {
  test(`single consequence roundtrip: ${result}`, async () => {
    const current = sheet({ capabilities: ["OFFENSIVE"], resolutionResult: result });
    const options = current.getData().resolutionOptions;
    assert.deepEqual(options.filter(option => option.selected).map(option => option.value), [result]);
    await current._updateObject(null, submitChips(["OFFENSIVE"], options.find(option => option.selected).value));
    assert.equal(current.item.system.resolutionResult, result);
    assert.deepEqual(current.item.system.capabilities, ["OFFENSIVE"]);
    assert.equal(current.getData().resolutionOptions.filter(option => option.selected).length, 1);
  });
}

test("consequence does not accept null, empty, an array or unknown values", async () => {
  for (const result of [null, "", [], ["damage", "defense"], "other"]) {
    await assert.rejects(sheet()._updateObject(null, { "system.resolutionResult": result }), /única consecuencia/);
  }
});

test("Dodge + movement and unusual Dodge + damage stay independent", async () => {
  for (const result of ["movement", "damage"]) {
    const selected = ["DODGE", "REACTION", "MOVEMENT"];
    const current = sheet({ capabilities: selected, resolutionResult: result });
    await current._updateObject(null, submitChips(selected, result));
    assert.deepEqual(current.item.system.capabilities, selected);
    assert.equal(current.item.system.resolutionResult, result);
    assert.equal(current.getData().resolutionOptions.find(option => option.selected).value, result);
  }
});

test("counterattack retains response preset and domain with damage", async () => {
  const selected = ["OFFENSIVE", "COUNTERATTACK", "REACTION"];
  const current = sheet({ capabilities: selected, resolutionResult: "damage", responseCapability: "COUNTERATTACK", responseDomain: "MAGICAL" });
  await current._updateObject(null, submitChips(selected, "damage"));
  assert.equal(current.item.system.responseCapability, "COUNTERATTACK");
  assert.equal(current.item.system.responseDomain, "MAGICAL");
  assert.equal(current.item.system.requiresOpposition, true);
});
