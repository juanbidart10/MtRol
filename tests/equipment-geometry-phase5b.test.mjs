import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class MockActorSheet {
  constructor(actor) {
    this.actor = actor;
    this.options = {};
    this.position = {};
  }

  static get defaultOptions() { return {}; }
  getData() { return {}; }
  activateListeners() {}
  render() {}
}

globalThis.foundry = {
  appv1: { sheets: { ActorSheet: MockActorSheet } },
  utils: {
    deepClone: value => structuredClone(value),
    duplicate: value => structuredClone(value),
    escapeHTML: value => String(value ?? ""),
    mergeObject: (target, source) => Object.assign(target, source),
    randomID: () => "phase5b"
  }
};

globalThis.game = {
  user: { id: "gm", isGM: true, targets: new Set() },
  users: [],
  system: { id: "mtrol", version: "1.2.5" },
  socket: { emit() {}, on() {} }
};

globalThis.ui = {
  notifications: { warn() {}, info() {}, error() {} }
};

globalThis.Math.clamp ??= (value, min, max) =>
  Math.min(max, Math.max(min, value));

const { PersonajeSheet } = await import("../scripts/sheets/actors/personaje-sheet.js");
const { buildInventoryViewModel } = await import("../scripts/items/inventory-view-model.js");

const templatePath = new URL("../templates/actors/personaje-sheet.html", import.meta.url);
const stylePath = new URL("../styles/sheets/inventory-workspace.css", import.meta.url);
const sheetPath = new URL("../scripts/sheets/actors/personaje-sheet.js", import.meta.url);

function createCollection(items = []) {
  const collection = [...items];
  collection.get = id => collection.find(item => item.id === id) ?? null;
  return collection;
}

function createViewActor() {
  return {
    id: "geometry",
    uuid: "Actor.geometry",
    type: "personaje",
    items: createCollection(),
    system: {
      atributos: { fuerza: 3 },
      equipamiento: {}
    }
  };
}

function createSelectable(itemId) {
  const classes = new Set();
  return {
    dataset: itemId ? { itemId } : {},
    classList: {
      toggle(name, active) {
        if (active) classes.add(name);
        else classes.delete(name);
      },
      contains(name) { return classes.has(name); }
    }
  };
}

test("grid declara la geometria hibrida completa mediante areas semanticas", async () => {
  const style = await readFile(stylePath, "utf8");

  assert.match(style, /grid-template-areas:\s*"slots-left character slots-right"/);
  assert.match(style, /grid-template-columns:\s*minmax\(52px, \.72fr\) minmax\(0, 2\.35fr\) minmax\(52px, \.72fr\)/);
  assert.match(style, /\.mtrol-equipment-slots\s*\{[\s\S]*?grid-template-rows:\s*repeat\(5,/);
});

test("ViewModel conserva diez IDs y perspectiva visual de ambas manos", () => {
  const slots = buildInventoryViewModel(createViewActor()).slots;
  const labels = Object.fromEntries(slots.map(slot => [slot.id, slot.label]));

  assert.equal(slots.length, 10);
  assert.deepEqual(slots.map(slot => slot.id), [
    "cabeza", "cuello", "hombros", "brazos", "pecho",
    "piernas", "pies", "manoIzq", "manoDer", "extra"
  ]);
  assert.equal(labels.manoDer, "Arma 1");
  assert.equal(labels.manoIzq, "Arma 2");
  assert.equal(labels.pies, "Botas");
});

test("template itera slots y conserva vacio, ocupado, broken y fallback de imagen", async () => {
  const template = await readFile(templatePath, "utf8");

  assert.match(template, /#each inventoryView\.slotsLeft as \|slot\|/);
  assert.match(template, /#each inventoryView\.slotsRight as \|slot\|/);
  assert.match(template, /data-slot="{{slot\.id}}"/);
  assert.match(template, /mtrol-equipment-slot--{{slot\.id}}/);
  assert.match(template, /is-equipped[\s\S]*?is-empty[\s\S]*?is-broken/);
  assert.match(template, /src="{{slot\.item\.img}}"[\s\S]*?data-fallback="icons\/svg\/item-bag\.svg"/);
  assert.match(template, /title="{{slot\.item\.name}}"/);
  assert.match(template, /mtrol-equipment-slot-placeholder/);
  assert.match(template, /Referencia rota/);
});

test("personaje central usa exclusivamente el contexto resuelto y no contiene controles", async () => {
  const template = await readFile(templatePath, "utf8");
  const characterBlock = template.match(
    /<figure class="mtrol-equipment-character"[^>]*>[\s\S]*?<\/figure>/
  )?.[0] ?? "";

  assert.match(characterBlock, /equipmentCharacterImage\.src/);
  assert.doesNotMatch(characterBlock, /actor\.img|actorImg/);
  assert.doesNotMatch(characterBlock, /button|mtrol-equipment-character-controls/);
  assert.match(template, /mtrol-equipment-header[\s\S]*?mtrol-equipment-character-change/);
  assert.match(template, /mtrol-equipment-header[\s\S]*?mtrol-equipment-character-remove/);
});

test("seleccion UI es unica, efimera y un slot vacio la limpia", () => {
  const sheet = new PersonajeSheet({});
  const occupiedSlot = createSelectable("sword");
  const inventoryRow = createSelectable("potion");
  const emptySlot = createSelectable(null);
  const controls = [occupiedSlot, inventoryRow, emptySlot];
  const workspace = {
    querySelectorAll(selector) {
      assert.equal(selector, ".mtrol-inventory-selectable");
      return controls;
    }
  };
  for (const control of controls) control.closest = () => workspace;

  const eventFor = control => ({
    preventDefault() {},
    target: { closest() { return null; } },
    currentTarget: control
  });

  sheet._onInventoryItemSelect(eventFor(occupiedSlot));
  assert.equal(sheet._mtrolSelectedItemId, "sword");
  assert.equal(occupiedSlot.classList.contains("is-selected"), true);
  assert.equal(inventoryRow.classList.contains("is-selected"), false);

  sheet._onInventoryItemSelect(eventFor(inventoryRow));
  assert.equal(sheet._mtrolSelectedItemId, "potion");
  assert.equal(occupiedSlot.classList.contains("is-selected"), false);
  assert.equal(inventoryRow.classList.contains("is-selected"), true);

  sheet._onInventoryItemSelect(eventFor(emptySlot));
  assert.equal(sheet._mtrolSelectedItemId, null);
  assert.equal(controls.some(control => control.classList.contains("is-selected")), false);
});

test("seleccion ignora botones y no registra doble click ni abre ItemSheet", async () => {
  const sheetSource = await readFile(sheetPath, "utf8");
  const sheet = new PersonajeSheet({});
  sheet._mtrolSelectedItemId = "existing";

  sheet._onInventoryItemSelect({
    target: { closest(selector) { return selector === "button, a" ? {} : null; } },
    currentTarget: createSelectable("other"),
    preventDefault() { throw new Error("no debe seleccionar desde una accion"); }
  });

  assert.equal(sheet._mtrolSelectedItemId, "existing");
  assert.match(sheetSource, /html\.find\("\.mtrol-inventory-selectable"\)[\s\S]*?\.on\("click", this\._onInventoryItemSelect/);
  assert.doesNotMatch(sheetSource, /\.mtrol-inventory-selectable[\s\S]{0,160}dblclick/);
  assert.doesNotMatch(sheetSource, /\.mtrol-inventory-selectable[\s\S]{0,240}_onEquipmentSlotOpen/);
});

test("responsive apila antes del colapso, limita el crecimiento por ancho y evita escalado", async () => {
  const style = await readFile(stylePath, "utf8");
  const stageBlock = style.match(
    /\.mtrol-personaje-sheet \.mtrol-equipment-stage\s*\{[\s\S]*?\n\}/
  )?.[0] ?? "";

  assert.match(style, /@container mtrol-inventory \(max-width: 720px\)/);
  assert.match(style, /max-width:\s*clamp\(48px, 9cqi, 58px\)/);
  assert.match(stageBlock, /height:\s*auto/);
  assert.doesNotMatch(stageBlock, /height:\s*clamp\([^\n]*cqi/);
  assert.match(style, /height:\s*clamp\(400px, 82cqi, 540px\)/);
  assert.doesNotMatch(style, /\b\d+(?:\.\d+)?vh\b/);
  assert.match(stageBlock, /overflow:\s*hidden/);
  assert.doesNotMatch(stageBlock, /overflow-x:\s*(auto|scroll)/);
  assert.doesNotMatch(style, /transform:\s*scale/);
});
