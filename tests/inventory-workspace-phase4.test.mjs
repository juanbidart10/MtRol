import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const templatePath = new URL("../templates/actors/personaje-sheet.html", import.meta.url);
const sheetPath = new URL("../scripts/sheets/actors/personaje-sheet.js", import.meta.url);
const stylePath = new URL("../styles/sheets/inventory-workspace.css", import.meta.url);

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
    randomID: () => "phase4"
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

function createCollection(items = []) {
  const collection = [...items];
  collection.get = id => collection.find(item => item.id === id) ?? null;
  return collection;
}

function createObject(id, overrides = {}) {
  return {
    id,
    uuid: `Actor.phase4.Item.${id}`,
    name: overrides.name ?? id,
    type: "objeto",
    img: "icons/svg/item-bag.svg",
    system: {
      tipoObjeto: overrides.tipoObjeto ?? "general",
      equipable: overrides.equipable ?? true,
      equipado: overrides.equipado ?? false,
      slot: overrides.slot ?? "extra",
      cantidad: overrides.cantidad ?? 1,
      peso: overrides.peso ?? 1,
      defensa: 0,
      defensaBase: 0,
      danio: "",
      descripcion: ""
    },
    sheet: { render() {} }
  };
}

function createActor({ items = [], equipamiento = {}, owner = true } = {}) {
  return {
    id: "phase4",
    uuid: "Actor.phase4",
    name: "Phase 4",
    type: "personaje",
    img: "icons/svg/mystery-man.svg",
    isOwner: owner,
    items: createCollection(items),
    system: {
      identidad: { clase: "", classId: "" },
      atributos: { fuerza: 3, resistencia: 2, inteligencia: 2 },
      recursos: { nivel: 1, exp: 0, mvp: 0, dharma: 0, karma: 0 },
      progression: {
        missionsCompleted: 0,
        dungeonsCompleted: 0,
        meritCredits: 0,
        defeatedLevel5Enemy: false,
        dmApproval: false
      },
      pendingAdvancement: { attributePoints: 0, competencePoints: 0 },
      orbs: [],
      vitales: { hp: { value: 10, max: 10 }, mp: { value: 10, max: 10 } },
      resourceModifiers: {
        hp: { value: 0, label: "" },
        mp: { value: 0, label: "" }
      },
      equipamiento
    },
    testUserPermission(user, permission) {
      return permission === "OWNER" && owner && user?.id === game.user.id;
    },
    async update() {},
    async createEmbeddedDocuments() {},
    async updateEmbeddedDocuments() {},
    async deleteEmbeddedDocuments() {},
    async unsetFlag() {},
    getActiveTokens() { return []; }
  };
}

test("PersonajeSheet conecta el ViewModel para Actor vacio", () => {
  const context = new PersonajeSheet(createActor()).getData();

  assert.equal(context.inventoryView.slots.length, 10);
  assert.equal(context.inventoryView.slots.every(slot => slot.item === null), true);
  assert.deepEqual(Object.keys(context.inventoryView.categories), [
    "armas", "armaduras", "consumibles", "materiales", "objetos"
  ]);
  assert.equal(context.inventoryView.weight.capacity, 30);
  assert.equal("puedeGestionarEquipamiento" in context, false);
});

test("PersonajeSheet conserva inventario, equipamiento y referencia rota en el contexto", () => {
  const sword = createObject("sword", { name: "Espada", tipoObjeto: "arma", slot: "manoDer" });
  const potion = createObject("potion", { name: "Poción", tipoObjeto: "consumible", equipable: false, peso: 2, cantidad: 3 });
  const context = new PersonajeSheet(createActor({
    items: [sword, potion],
    equipamiento: { manoDer: sword.id, cabeza: "missing" }
  })).getData();

  assert.equal(context.inventoryView.equipment.manoDer, sword);
  assert.deepEqual(context.inventoryView.categories.armas, []);
  assert.equal(context.inventoryView.categories.consumibles[0], potion);
  assert.equal(context.inventoryView.itemMetrics.potion.totalWeight, 6);
  assert.equal(context.inventoryView.slots.find(slot => slot.id === "cabeza").broken, true);
  assert.equal(context.inventoryView.weight.current, 7);
});

test("PersonajeSheet resuelve el Inspector por el unico ID efimero", () => {
  const sword = createObject("selected-sword", {
    name: "Espada seleccionada",
    tipoObjeto: "arma",
    slot: "manoDer"
  });
  const sheet = new PersonajeSheet(createActor({ items: [sword] }));
  sheet._mtrolSelectedItemId = sword.id;

  const context = sheet.getData();

  assert.equal(context.selectedInventoryItemId, sword.id);
  assert.equal(context.inventoryInspector.selected, true);
  assert.equal(context.inventoryInspector.item, sword);
  assert.equal("action" in context.inventoryInspector, false);
  assert.equal(sheet.actor.system._mtrolSelectedItemId, undefined);
});

test("PersonajeSheet limpia seleccion eliminada, destruida o transferida en el siguiente render", () => {
  const selected = createObject("gone");
  const actor = createActor({ items: [selected] });
  const sheet = new PersonajeSheet(actor);
  sheet._mtrolSelectedItemId = selected.id;
  actor.items.splice(0, 1);

  const context = sheet.getData();

  assert.equal(sheet._mtrolSelectedItemId, null);
  assert.equal(context.selectedInventoryItemId, null);
  assert.equal(context.inventoryInspector.selected, false);
  assert.equal(context.inventoryInspector.item, null);
});

test("la plantilla contiene una sola ruta, slots iterados y categorias alimentadas por inventoryView", async () => {
  const template = await readFile(templatePath, "utf8");

  assert.equal((template.match(/data-tab="inventario"/g) ?? []).length, 2);
  assert.doesNotMatch(template, /data-tab="equipamiento"/);
  assert.equal((template.match(/class="mtrol-inventory-workspace"/g) ?? []).length, 1);
  assert.match(template, /#each inventoryView\.slotsLeft as \|slot\|/);
  assert.match(template, /#each inventoryView\.slotsRight as \|slot\|/);
  assert.match(template, /#each inventoryView\.items as \|inventoryItem\|/);
  assert.match(template, /#each inventoryView\.filterDefinitions as \|filter\|/);
  assert.doesNotMatch(template, /objetosInventario/);
  assert.doesNotMatch(template, /slotsEquipamiento/);
  assert.doesNotMatch(template, /inventario\.(usados|maximos|libres|sobrecargado)/);
  assert.match(template, /inventoryView\.weight\.current/);
  assert.match(template, /inventoryView\.weight\.capacity/);
  assert.match(template, /inventoryView\.weight\.state/);
  assert.match(template, /class="mtrol-inventory-search"[\s\S]*?placeholder="Buscar objeto\.\.\."/);
  assert.doesNotMatch(template, /class="mtrol-inventory-search"[^>]*disabled/);
  assert.match(template, /Seleccion&aacute; un objeto para ver sus detalles\./);
  assert.doesNotMatch(template, /class="mtrol-equip-slot/);
});

test("los controles mutantes respetan los bloques de permisos de Fase 3", async () => {
  const template = await readFile(templatePath, "utf8");

  assert.match(template, /{{#if esGM}}[\s\S]*?class="item-create-objeto"/);
  assert.match(template, /{{#if @root\.esGM}}[\s\S]*?class="[^"]*\bitem-edit\b[^"]*"/);
  assert.match(template, /{{#if @root\.esGM}}[\s\S]*?class="[^"]*\bitem-delete\b[^"]*"/);
  assert.doesNotMatch(template, /class="item-(?:un)?equip"/);
  assert.match(template, /mtrol-draggable-objeto/);
});

test("el CSS define 40/60, breakpoint apilado y scroll interno sin escalado", async () => {
  const style = await readFile(stylePath, "utf8");
  const sheet = await readFile(sheetPath, "utf8");

  assert.match(style, /grid-template-columns:\s*minmax\(230px, 2fr\) minmax\(300px, 3fr\)/);
  assert.match(style, /@container mtrol-inventory \(max-width: 720px\)/);
  assert.match(style, /\.mtrol-inventory-main\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(style, /\.mtrol-inventory-list-region\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.doesNotMatch(style, /transform:\s*scale/);
  assert.match(sheet, /context\.inventoryView = buildInventoryViewModel\(this\.actor\)/);
  assert.match(sheet, /\.mtrol-inventory-filter/);
  assert.doesNotMatch(sheet, /\.mtrol-inventory-category/);
});
