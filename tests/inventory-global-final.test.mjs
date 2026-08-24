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
    randomID: () => "inventory-global-final"
  }
};

globalThis.game = {
  user: { id: "gm", isGM: true, targets: new Set() },
  users: [],
  system: { id: "mtrol", version: "1.2.5" },
  socket: { emit() {}, on() {} }
};

globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };
globalThis.Math.clamp ??= (value, min, max) => Math.min(max, Math.max(min, value));

const { PersonajeSheet } = await import("../scripts/sheets/actors/personaje-sheet.js");
const { buildInventoryViewModel } = await import("../scripts/items/inventory-view-model.js");
const {
  getFilteredInventoryItems,
  resolveInventoryFilterResult
} = await import("../scripts/items/inventory-search.js");

const templatePath = new URL("../templates/actors/personaje-sheet.html", import.meta.url);
const inventoryStylePath = new URL("../styles/sheets/inventory-workspace.css", import.meta.url);
const personajeStylePath = new URL("../styles/sheets/personaje.css", import.meta.url);
const premiumStylePath = new URL("../styles/sheets/personaje-premium.css", import.meta.url);
const competenciasStylePath = new URL("../styles/sheets/competencias.css", import.meta.url);
const progresionStylePath = new URL("../styles/sheets/progresion.css", import.meta.url);
const atributosStylePath = new URL("../styles/sheets/atributos.css", import.meta.url);
const combatStylePath = new URL("../styles/combat/combat-tab.css", import.meta.url);
const sheetPath = new URL("../scripts/sheets/actors/personaje-sheet.js", import.meta.url);

const SLOTS = [
  "cabeza", "cuello", "hombros", "brazos", "pecho",
  "piernas", "pies", "manoIzq", "manoDer", "extra"
];

function item(id, name, tipoObjeto = "general", options = {}) {
  return {
    id,
    uuid: `Actor.global.Item.${id}`,
    name,
    type: "objeto",
    img: "icons/svg/item-bag.svg",
    system: {
      tipoObjeto,
      equipable: options.equipable ?? false,
      equipado: options.equipado ?? false,
      slot: options.slot ?? "",
      peso: options.peso ?? 0,
      cantidad: 1
    }
  };
}

function actorWith(items, equipment = {}) {
  const collection = [...items];
  collection.get = id => collection.find(candidate => candidate.id === id) ?? null;
  return {
    id: "global",
    uuid: "Actor.global",
    type: "personaje",
    isOwner: true,
    items: collection,
    system: {
      atributos: { fuerza: 5 },
      equipamiento: Object.fromEntries(SLOTS.map(slot => [slot, equipment[slot] ?? ""]))
    }
  };
}

function fixture() {
  const items = [
    item("potion", "Pócima", "consumible"),
    item("shield", "Escudo", "escudo"),
    item("unknown", "Ábaco", "futuro"),
    item("sword", "Espada", "arma", { equipable: true, slot: "manoDer" }),
    item("armor", "Casco eterno", "armadura", { equipable: true, slot: "cabeza" }),
    item("ore", "Mineral", "material")
  ];
  return buildInventoryViewModel(actorWith(items));
}

test("ViewModel expone Todos más cinco filtros exactos", () => {
  assert.deepEqual(fixture().filterDefinitions.map(filter => filter.label), [
    "Todos", "Armas", "Armaduras", "Consumibles", "Materiales", "Objetos"
  ]);
  assert.deepEqual(fixture().filterDefinitions.map(filter => filter.id), [
    "all", "armas", "armaduras", "consumibles", "materiales", "objetos"
  ]);
});

test("lista global mezcla categorías, conserva A-Z y excluye equipados", () => {
  const equipped = item("equipped", "Aardvark equipado", "arma", {
    equipable: true,
    slot: "manoDer"
  });
  const actor = actorWith([
    item("z", "Zafiro", "material"),
    item("a", "Ábaco", "general"),
    item("m", "Martillo", "arma"),
    equipped
  ], { manoDer: equipped.id });
  const view = buildInventoryViewModel(actor);

  assert.deepEqual(view.items.map(entry => entry.id), ["a", "m", "z"]);
  assert.equal(view.items.includes(equipped), false);
  assert.equal(Object.values(view.categories).flat().includes(equipped), false);
});

test("mapping del filtro conserva escudo, general y desconocido", () => {
  const view = fixture();
  assert.equal(view.categories.armaduras.some(entry => entry.id === "shield"), true);
  assert.equal(view.categories.objetos.some(entry => entry.id === "unknown"), true);
});

test("filtro manual devuelve sólo su categoría y mantiene orden", () => {
  const view = fixture();
  assert.deepEqual(
    getFilteredInventoryItems(view, { filter: "armaduras" }).map(entry => entry.name),
    ["Casco eterno", "Escudo"]
  );
});

test("búsqueda mantiene filtro con coincidencias y hace fallback global sin ellas", () => {
  const view = fixture();
  assert.equal(resolveInventoryFilterResult(view, {
    filter: "armaduras",
    searchTerm: "ESCUDO"
  }).filter, "armaduras");

  const fallback = resolveInventoryFilterResult(view, {
    filter: "consumibles",
    searchTerm: "casco"
  });
  assert.equal(fallback.filter, "armaduras");
  assert.deepEqual(fallback.items.map(entry => entry.id), ["armor"]);
});

test("Todos permanece global y la coincidencia múltiple respeta el orden estable", () => {
  const view = fixture();
  const all = resolveInventoryFilterResult(view, { filter: "all", searchTerm: "a" });
  assert.equal(all.filter, "all");

  view.categories.armas.push(item("arma-sol", "Sol de acero", "arma"));
  view.categories.armaduras.push(item("armor-sol", "Casco solar", "armadura"));
  assert.equal(resolveInventoryFilterResult(view, {
    filter: "consumibles",
    searchTerm: "sol"
  }).filter, "armas");
});

test("vaciar búsqueda conserva filtro y muestra todos sus Items", () => {
  const result = resolveInventoryFilterResult(fixture(), {
    filter: "materiales",
    searchTerm: ""
  });
  assert.equal(result.filter, "materiales");
  assert.deepEqual(result.items.map(entry => entry.id), ["ore"]);
});

test("filtrar y buscar no limpian el Inspector ni persisten documentos", () => {
  const view = fixture();
  const actor = actorWith(view.items);
  const sheet = new PersonajeSheet(actor);
  sheet._mtrolSelectedItemId = "armor";
  const rows = view.items.map(entry => ({ dataset: { itemId: entry.id }, hidden: false }));
  const filterControl = { value: "consumibles" };
  const noResults = { classList: { toggle() {} } };
  const workspace = {
    querySelectorAll: selector => selector === ".mtrol-inventory-item-row" ? rows : [],
    querySelector: selector => selector === ".mtrol-inventory-filter" ? filterControl : noResults
  };
  const select = { value: "consumibles", closest: () => workspace };

  sheet._onInventoryFilterChange({ currentTarget: select });
  assert.equal(sheet._mtrolSelectedItemId, "armor");
  assert.equal(sheet._mtrolInventoryFilter, "consumibles");

  const input = { value: "casco", closest: () => workspace };
  sheet._onInventorySearchInput({ currentTarget: input });
  assert.equal(sheet._mtrolSelectedItemId, "armor");
  assert.equal(sheet._mtrolInventoryFilter, "armaduras");
  assert.equal(filterControl.value, "armaduras");
});

test("markup usa una tabla global y retira navegación permanente", async () => {
  const template = await readFile(templatePath, "utf8");
  const browser = template.match(/<section class="mtrol-inventory-browser"[\s\S]*?<\/section>\s*<\/div>/)?.[0] ?? "";

  assert.match(browser, /class="mtrol-inventory-search"/);
  assert.match(browser, /class="mtrol-inventory-filter"/);
  assert.match(browser, /#each inventoryView\.filterDefinitions/);
  assert.match(browser, /#each inventoryView\.items/);
  assert.equal((browser.match(/<table class="mtrol-inventory-table">/g) ?? []).length, 1);
  assert.doesNotMatch(browser, /mtrol-inventory-categories|mtrol-inventory-category-panel|role="tablist"/);
  assert.doesNotMatch(browser, /<h3[^>]*>Inventario<\/h3>/);
  assert.doesNotMatch(template, /id="mtrol-inventory-title"[^>]*>Inventario<\/h2>/);
  assert.match(browser, /mtrol-inventory-detail-panel/);
});

test("listener y estado antiguos de categorías fueron retirados", async () => {
  const source = await readFile(sheetPath, "utf8");
  assert.doesNotMatch(source, /_mtrolActiveInventoryCategory|_onInventoryCategoryChange|_setInventoryCategoryInWorkspace/);
  assert.doesNotMatch(source, /html\.find\("\.mtrol-inventory-category"\)/);
  assert.match(source, /_mtrolInventoryFilter/);
  assert.match(source, /_onInventoryFilterChange/);
  assert.match(source, /resolveInventoryFilterResult/);
});

test("responsive coloca búsqueda y filtro 2:1 y los apila sin overflow", async () => {
  const style = await readFile(inventoryStylePath, "utf8");
  assert.match(style, /\.mtrol-inventory-browser-header\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 2fr\) minmax\(112px, 1fr\)/);
  assert.match(style, /max-width: 520px[\s\S]*?\.mtrol-inventory-browser-header\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(style, /\.mtrol-inventory-list-region\s*\{[\s\S]*?overflow-x:\s*hidden/);
  assert.match(style, /th:nth-child\(3\),[\s\S]*?td:nth-child\(3\)[\s\S]*?display:\s*none/);
  assert.match(style, /\.mtrol-inventory-workspace\s*\{[\s\S]*?font-family:\s*var\(--mtrol-font-title, "Morpheus"\), serif/);
  assert.doesNotMatch(style, /\.mtrol-equipment-header h3/);
});

test("PersonajeSheet no conserva subrayados ornamentales de títulos", async () => {
  const [personaje, premium, inventory, competencias, progresion, atributos, combat] = await Promise.all([
    readFile(personajeStylePath, "utf8"),
    readFile(premiumStylePath, "utf8"),
    readFile(inventoryStylePath, "utf8"),
    readFile(competenciasStylePath, "utf8"),
    readFile(progresionStylePath, "utf8"),
    readFile(atributosStylePath, "utf8"),
    readFile(combatStylePath, "utf8")
  ]);
  const allStyles = [personaje, premium, inventory, competencias, progresion, atributos, combat].join("\n");

  assert.doesNotMatch(allStyles, /text-decoration:\s*underline/);
  assert.doesNotMatch(personaje, /\.mtrol-section-title\s*\{[\s\S]*?border-bottom:\s*1px/);
  assert.doesNotMatch(premium, /\.mtrol-main-tabs \.item\s*\{[\s\S]*?border-bottom:\s*1px/);
  assert.doesNotMatch(premium, /\.mtrol-tab-personaje \.mtrol-tab-header\s*\{[\s\S]*?border-bottom:\s*1px/);
  assert.doesNotMatch(progresion, /\.progresion-section-header\s*\{[\s\S]*?border-bottom:\s*1px/);
  assert.match(premium, /\.mtrol-hero-nameplate::after\s*\{[\s\S]*?display:\s*none/);
  assert.match(premium, /\.mtrol-master-header::before\s*\{[\s\S]*?display:\s*none/);
  assert.match(premium, /:is\(h1, h2, h3, h4, h5, h6\)::before[\s\S]*?content:\s*none/);
  assert.match(atributos, /\.mtrol-attribute-group-header::before,[\s\S]*?content:\s*none/);
  assert.doesNotMatch(combat, /\.mtrol-combat-title::before|\.mtrol-title-line/);
  assert.doesNotMatch(combat, /\.combate-section h2\s*\{[\s\S]*?border-bottom:\s*1px/);
});

test("footer, Inspector, drag source y selección permanecen en su arquitectura", async () => {
  const template = await readFile(templatePath, "utf8");
  const mainEnd = template.indexOf("</div>\n\n        <footer class=\"mtrol-inventory-weight");
  const footerStart = template.indexOf("<footer class=\"mtrol-inventory-weight");

  assert.ok(mainEnd >= 0 && footerStart > mainEnd);
  assert.match(template, /mtrol-draggable-objeto/);
  assert.match(template, /selectedInventoryItemId/);
  assert.match(template, /mtrol-inventory-inspector-close/);
  assert.match(template, /data-confirm-delete="true"/);
  assert.match(template, /#each inventoryCarry\.segments/);
});
