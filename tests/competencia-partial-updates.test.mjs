import test from "node:test";
import assert from "node:assert/strict";

class Field { constructor(...args) { this.options = args.at(-1) ?? {}; } }
let forwarded;
let updates = 0;
class ItemSheet {
  constructor(item) { this.item = item; }
  async _updateObject(_event, data) { updates++; return structuredClone(data); }
}
globalThis.foundry = {
  data: { fields: new Proxy({}, { get: () => Field }) },
  abstract: { TypeDataModel: class {
    static migrateData(source, options) { forwarded = options; return source; }
  } },
  appv1: { sheets: { ItemSheet } },
  utils: { duplicate: structuredClone }
};
globalThis.game = { user: { isGM: true } };
globalThis.ui = { notifications: { warn() {} } };
const { CompetenciaDataModel: Model } = await import("../models/competencia-model.js");
const { CompetenciaSheet: Sheet } = await import("../scripts/sheets/items/competencia-sheet.js");

test("every schema field survives omission from every other field's patch", () => {
  const baseline = Object.fromEntries(Object.keys(Model.defineSchema()).map(key => [key, { sentinel: key }]));
  for (const key of Object.keys(baseline)) {
    const patch = { [key]: null };
    const options = { partial: true };
    const migrated = Model.migrateData(structuredClone(patch), options);
    assert.deepEqual(migrated, patch, key);
    assert.equal(forwarded, options);
    assert.deepEqual({ ...baseline, ...migrated }, { ...baseline, [key]: null });
  }
});

test("sequential partial patches preserve all omitted mechanics and explicit null", () => {
  let current = Model.migrateData({
    rol: "mobility", resolutionResult: "movement", responseCapability: null,
    capabilities: ["DODGE", "REACTION", "MOVEMENT"], allowedResponses: ["DEFENSE"],
    actionDomain: "MAGICAL", responseDomain: "PHYSICAL", formula: "2d10", nivel: 4,
    technicalId: "regression", damageFormula: "3d6", spellTags: ["fire"]
  });
  for (const patch of [
    { responseCapability: "DODGE" }, { responseCapability: "DEFENSE" },
    { responseCapability: null }, { resolutionResult: "movement" },
    { capabilities: ["DEFENSE", "REACTION"] }, { allowedResponses: [] },
    { responseCapability: "DEFENSE" }, { resolutionResult: "defense" }
  ]) {
    const before = structuredClone(current);
    current = { ...current, ...Model.migrateData(structuredClone(patch), { partial: true }) };
    assert.deepEqual(current, { ...before, ...patch });
  }
});

test("complete legacy migration still supplies defaults, then patches stay partial", () => {
  const legacy = Model.migrateData({ actionType: "attack", danio: "2d10" }, { partial: false });
  assert.equal(legacy.resolutionResult, "damage");
  assert.equal(legacy.damageFormula, "2d10");
  assert.equal(legacy.requiresOpposition, true);
  assert.equal(legacy.rol, null);
  assert.deepEqual(legacy.executionModes, []);
  assert.deepEqual(Model.migrateData({ responseCapability: null }, { partial: true }), { responseCapability: null });
  assert.deepEqual(Model.migrateData({}, { partial: true }), {});
  assert.equal(Model.migrateData({}).resolutionResult, "utility");
});

test("sheet partial submissions preserve omitted fields and explicit nullable values", async () => {
  const sheet = new Sheet({ system: { capabilities: ["DEFENSE"], responseCapability: "DEFENSE", rol: "mobility" } });
  for (const patch of [
    { "system.responseCapability": null }, { "system.resolutionResult": "movement" },
    { "system.damageSourceAttribute": null }, { name: "Renamed" }
  ]) assert.deepEqual(await sheet._updateObject(null, patch), patch);
});

test("unchanged rendered values never submit derived legacy normalization", async () => {
  const item = { system: { capabilities: [], responseCapability: null, rol: "mobility" } };
  const sheet = new Sheet(item);
  const form = {
    "system.responseCapability": "DEFENSE", "system.rol": "mobility",
    "system.damageSourceAttribute": "", "system.requiresOpposition": true,
    mtrolCapabilityControls: "true", mtrolResponseControls: "true",
    "mtrolAllowedResponse.DEFENSE": true
  };
  sheet._renderedSubmission = { item, data: structuredClone(form) };
  const before = updates;
  assert.deepEqual(await sheet._updateObject(null, form), {});
  assert.equal(updates, before);
  assert.deepEqual(await sheet._updateObject(null, { ...form, name: "New name" }), { name: "New name" });
  assert.equal(item.system.responseCapability, null);
  const unchecked = { ...form };
  delete unchecked["mtrolAllowedResponse.DEFENSE"];
  assert.deepEqual(await sheet._updateObject(null, unchecked), { "system.allowedResponses": [] });
  assert.deepEqual(form, sheet._renderedSubmission.data);
});

test("each sheet baseline belongs to its own Item", async () => {
  const a = new Sheet({ system: {} });
  const b = new Sheet({ system: {} });
  a._renderedSubmission = { item: a.item, data: { name: "A" } };
  assert.deepEqual(await b._updateObject(null, { name: "A" }), { name: "A" });
  a.item = b.item;
  assert.deepEqual(await a._updateObject(null, { name: "A" }), { name: "A" });
});
