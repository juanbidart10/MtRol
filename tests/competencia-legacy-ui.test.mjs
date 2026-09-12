import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class ItemSheet {
  constructor(item) { this.item = item; this.updates = []; }
  getData() { return {}; }
  async _updateObject(_event, data) {
    this.updates.push(structuredClone(data));
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
const template = await readFile(new URL("../templates/items/competencia-sheet.html", import.meta.url), "utf8");
const visible = ["OFFENSIVE", "DEFENSE", "DODGE", "COUNTERATTACK", "REACTION"];
function sheet(system, embedded = false) {
  return new CompetenciaSheet({ type: "competencia", name: "Regression", img: "icons/svg/item-bag.svg",
    parent: embedded ? { system: {}, getFlag: () => ({}) } : null,
    flags: { mtrol: { preserved: true } }, system: structuredClone(system) });
}
function form(current) {
  return { "system.nivel": current.item.system.nivel ?? 1, "system.formula": current.item.system.formula ?? "1d10",
    mtrolCapabilityControls: "true", mtrolResponseControls: "true",
    ...Object.fromEntries(visible.map(value => [`mtrolCapability.${value}`, current.item.system.capabilities?.includes(value) ?? false])) };
}
function baseline(current) {
  const data = form(current);
  current._renderedSubmission = { item: current.item, data: structuredClone(data) };
  return data;
}

test("A: hidden MOVEMENT and unknown entries survive adding and removing visible chips", async () => {
  const current = sheet({ capabilities: ["MOVEMENT", "FUTURE"], responseCapability: null });
  let data = baseline(current); data["mtrolCapability.DEFENSE"] = true;
  await current._updateObject(null, data);
  assert.deepEqual(current.item.system.capabilities, ["MOVEMENT", "FUTURE", "DEFENSE"]);
  assert.equal(current.item.system.responseCapability, null);
  data = baseline(current); data["mtrolCapability.DEFENSE"] = false;
  await current._updateObject(null, data);
  assert.deepEqual(current.item.system.capabilities, ["MOVEMENT", "FUTURE"]);
});

for (const oppositionType of ["free", "dodge"]) {
  test(`B-F: isolated visible edit preserves every hidden field (${oppositionType})`, async () => {
    const system = { nivel: 1, formula: "1d10", capabilities: ["MOVEMENT"], actionType: "utility",
      resolutionResult: "movement", oppositionType, responseDomain: "MAGICAL", responseCapability: null,
      requiresOpposition: false, allowedResponses: [], defenseType: "custom", rol: "mobility", effect: "buff",
      actionIdentity: null, damageResolution: "historical-value", damageMode: "historical-mode" };
    for (const [key, value] of [["nivel", 2], ["formula", "2d10"]]) {
      const current = sheet(system); const data = baseline(current); data[`system.${key}`] = value;
      const saved = await current._updateObject(null, data);
      assert.deepEqual(saved, { [`system.${key}`]: value });
      assert.deepEqual(current.item.system, { ...system, [key]: value });
      assert.equal(current.getData().legacyConfiguration.showOpposition, false);
      assert.equal(current.getData().legacyConfiguration.showResponseDomain, false);
    }
  });
}

for (const capability of ["DEFENSE", "DODGE", "COUNTERATTACK"]) {
  test(`G-I: ${capability} without REACTION warns without mutation`, () => {
    const current = sheet({ capabilities: [capability], responseCapability: null });
    const before = structuredClone(current.item);
    assert.equal(current.getData().legacyConfiguration.missingReaction, true);
    assert.deepEqual(current.item, before);
    assert.equal(current.updates.length, 0);
    assert.match(template, /data-mtrol-reaction-warning {{#unless legacyConfiguration.missingReaction}}hidden/);
  });
}

test("J: Esquiva Aurica exposes raw/effective inheritance without materializing it", async () => {
  const current = sheet({ capabilities: [], actionType: "defense", defenseType: "custom", oppositionType: "free",
    resolutionResult: "defense", responseCapability: null });
  const info = current.getData().legacyConfiguration;
  assert.equal(info.inherited, true); assert.equal(info.showOpposition, true);
  assert.equal(info.raw, "[]"); assert.equal(info.effective, '["DEFENSE","REACTION"]');
  assert.equal(info.missingReaction, false);
  const data = baseline(current); data["system.formula"] = "2d10";
  assert.deepEqual(await current._updateObject(null, data), { "system.formula": "2d10" });
  assert.deepEqual(current.item.system.capabilities, []);
});

const historical = [
  ["Muro de Fuego", "movement", "movement", []], ["Orbe Aumentado", "utility", "utility", []],
  ["Orbe Control", "utility", "utility", ["MOVEMENT", ...visible]],
  ["Explosión Mágica", "combatSkill", "utility", []],
  ["Aliento de Dragon", "combatSkill", "damage", ["OFFENSIVE", "COUNTERATTACK"]],
  ["Esquiva Aurica", "defense", "defense", []], ["Simbología", "utility", "utility", []],
  ["magia", "utility", "utility", []], ["Meditar", "utility", "utility", []],
  ["Modern hidden movement", "utility", "movement", ["MOVEMENT"]]
];
for (const [name, actionType, resolutionResult, capabilities] of historical) {
  for (const embedded of [false, true]) {
    test(`K-O: render/unchanged close submission preserves system/flags: ${name}, embedded=${embedded}`, async () => {
      const current = sheet({ actionType, resolutionResult, capabilities, responseCapability: null,
        responseDomain: null, oppositionType: "free", requiresOpposition: false, allowedResponses: [] }, embedded);
      const before = structuredClone({ system: current.item.system, flags: current.item.flags });
      current.getData(); const data = baseline(current);
      assert.deepEqual(await current._updateObject(null, data), {});
      assert.equal(current.updates.length, 0);
      assert.deepEqual({ system: current.item.system, flags: current.item.flags }, before);
    });
  }
}

test("obsolete preset is reported and preserved; hidden constants have no controls", async () => {
  const current = sheet({ capabilities: ["DEFENSE"], responseCapability: "COUNTERATTACK" });
  assert.equal(current.getData().legacyConfiguration.invalidPreset, true);
  const data = baseline(current); data["mtrolCapability.REACTION"] = true;
  await current._updateObject(null, data);
  assert.equal(current.item.system.responseCapability, "COUNTERATTACK");
  assert.doesNotMatch(template, /name="system\.(damageResolution|damageMode)"/);
  assert.deepEqual(current.getData().capabilityGroups.flatMap(group => group.options.map(option => option.value)), visible);
  assert.match(template, /Usar dominio de la habilidad/);
  assert.match(template, /Avanzado \/ Compatibilidad/);
  for (const field of ["actionType", "oppositionType", "defenseType", "rol", "effect", "actionIdentity"]) {
    assert.equal(template.split(`name="system.${field}"`).length - 1, 1);
  }
});
