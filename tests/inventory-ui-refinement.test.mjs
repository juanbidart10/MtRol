import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class MockActorSheet {
  constructor(actor) {
    this.actor = actor;
    this.options = {};
    this.position = {};
    this.renderCount = 0;
  }

  static get defaultOptions() { return {}; }
  getData() { return {}; }
  activateListeners() {}
  render() { this.renderCount += 1; }
}

globalThis.foundry = {
  appv1: { sheets: { ActorSheet: MockActorSheet } },
  utils: {
    deepClone: value => structuredClone(value),
    duplicate: value => structuredClone(value),
    escapeHTML: value => String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;"),
    mergeObject: (target, source) => Object.assign(target, source),
    randomID: () => "inventory-refinement"
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
const {
  buildCarrySegments,
  buildInventoryViewModel
} = await import("../scripts/items/inventory-view-model.js");
const {
  inventoryItemMatchesSearch,
  normalizeInventorySearchTerm,
  resolveInventoryFilterResult
} = await import("../scripts/items/inventory-search.js");

const templatePath = new URL("../templates/actors/personaje-sheet.html", import.meta.url);
const stylePath = new URL("../styles/sheets/inventory-workspace.css", import.meta.url);
const sheetPath = new URL("../scripts/sheets/actors/personaje-sheet.js", import.meta.url);

const SLOT_IDS = [
  "cabeza", "cuello", "hombros", "brazos", "pecho",
  "piernas", "pies", "manoIzq", "manoDer", "extra"
];

function collection(items = []) {
  const result = [...items];
  result.get = id => result.find(item => item.id === id) ?? null;
  return result;
}

function actorWith(items = [], equipamiento = {}) {
  return {
    id: "refinement",
    uuid: "Actor.refinement",
    type: "personaje",
    isOwner: true,
    items: collection(items),
    system: {
      atributos: { fuerza: 3 },
      equipamiento: Object.fromEntries(
        SLOT_IDS.map(slot => [slot, equipamiento[slot] ?? ""])
      )
    },
    async update() {}
  };
}

function item(id, options = {}) {
  let deletes = 0;
  let updates = 0;
  return {
    id,
    uuid: `Actor.refinement.Item.${id}`,
    name: options.name ?? id,
    img: options.img ?? "icons/svg/item-bag.svg",
    type: "objeto",
    system: {
      tipoObjeto: options.tipoObjeto ?? "general",
      equipable: options.equipable ?? false,
      equipado: false,
      slot: options.slot ?? "",
      peso: options.peso ?? 0,
      cantidad: 1,
      danio: options.danio,
      defensa: options.defensa
    },
    async update() { updates += 1; },
    async delete() { deletes += 1; },
    get deletes() { return deletes; },
    get updates() { return updates; }
  };
}

test("la búsqueda normaliza mayúsculas y acentos y sólo consulta el nombre", () => {
  assert.equal(normalizeInventorySearchTerm("  PÓCIMA  "), "pocima");
  assert.equal(inventoryItemMatchesSearch({ name: "Pócima mayor" }, "POCIMA"), true);
  assert.equal(inventoryItemMatchesSearch({ name: "Espada", system: { descripcion: "pocima" } }, "pocima"), false);
});

test("la búsqueda canónica prioriza categoría activa y luego el orden global estable", () => {
  const view = {
    categoryDefinitions: [
      { id: "armas" }, { id: "armaduras" }, { id: "consumibles" },
      { id: "materiales" }, { id: "objetos" }
    ],
    categories: {
      armas: [{ name: "Arco solar" }],
      armaduras: [{ name: "Armadura solar" }],
      consumibles: [{ name: "Pócima" }],
      materiales: [],
      objetos: [{ name: "Sol portátil" }]
    }
  };

  assert.equal(resolveInventoryFilterResult(view, { filter: "objetos", searchTerm: "sol" }).filter, "objetos");
  assert.equal(resolveInventoryFilterResult(view, { filter: "consumibles", searchTerm: "sol" }).filter, "armas");
  assert.equal(resolveInventoryFilterResult(view, { filter: "materiales", searchTerm: "ausente" }).filter, "materiales");
  assert.equal(resolveInventoryFilterResult(view, { filter: "materiales", searchTerm: "" }).filter, "materiales");
});

test("los diez segmentos derivan exclusivamente del ratio con ceil y clamp", () => {
  for (const [ratio, expected] of [[0, 0], [0.01, 1], [0.5, 5], [0.9, 9], [0.91, 10], [1, 10], [2, 10], [-1, 0]]) {
    const presentation = buildCarrySegments(ratio);
    assert.equal(presentation.segments.length, 10);
    assert.equal(presentation.filled, expected);
    assert.equal(presentation.segments.filter(segment => segment.filled).length, expected);
  }
});

test("slots exponen icono genérico y tooltip nativo con estadísticas reales", () => {
  const sword = item("sword", {
    name: "Espada larga",
    tipoObjeto: "arma",
    equipable: true,
    slot: "manoDer",
    peso: 2,
    danio: "1d8"
  });
  const armor = item("armor", {
    name: "Coraza",
    tipoObjeto: "armadura",
    equipable: true,
    slot: "pecho",
    peso: 7,
    defensa: 3
  });
  const view = buildInventoryViewModel(actorWith(
    [sword, armor],
    { manoDer: sword.id, pecho: armor.id }
  ));

  assert.match(view.slots.find(slot => slot.id === "cabeza").icon, /^fa-/);
  assert.match(view.slots.find(slot => slot.id === "manoDer").tooltip, /Espada larga[\s\S]*Tipo: Arma[\s\S]*Peso: 2[\s\S]*Daño: 1d8/);
  assert.match(view.slots.find(slot => slot.id === "pecho").tooltip, /Defensa: 3/);
});

test("Inspector cierra por repetición, botón y Escape sin escrituras del Actor", () => {
  const actor = actorWith();
  let actorWrites = 0;
  actor.update = async () => { actorWrites += 1; };
  const sheet = new PersonajeSheet(actor);
  const selectable = {
    dataset: { itemId: "same" },
    classList: { toggle() {} }
  };
  const workspace = { querySelectorAll: () => [selectable] };
  selectable.closest = () => workspace;
  const click = {
    preventDefault() {},
    target: { closest: () => null },
    currentTarget: selectable
  };

  sheet._mtrolSelectedItemId = "same";
  sheet._onInventoryItemSelect(click);
  assert.equal(sheet._mtrolSelectedItemId, null);

  sheet._mtrolSelectedItemId = "same";
  sheet._onInventoryInspectorClose({ preventDefault() {} });
  assert.equal(sheet._mtrolSelectedItemId, null);

  let prevented = 0;
  sheet._mtrolSelectedItemId = "same";
  sheet._onInventoryInspectorKeydown({
    key: "Escape",
    preventDefault() { prevented += 1; },
    stopPropagation() {}
  });
  assert.equal(sheet._mtrolSelectedItemId, null);
  assert.equal(prevented, 1);
  assert.equal(actorWrites, 0);
});

test("Escape sin selección no intercepta el teclado", () => {
  const sheet = new PersonajeSheet(actorWith());
  let prevented = 0;
  sheet._onInventoryInspectorKeydown({
    key: "Escape",
    preventDefault() { prevented += 1; },
    stopPropagation() { prevented += 1; }
  });
  assert.equal(prevented, 0);
});

test("cancelar borrado desde Inspector produce cero mutaciones y conserva selección", async () => {
  const target = item("keep-me");
  const actor = actorWith([target]);
  let actorWrites = 0;
  actor.update = async () => { actorWrites += 1; };
  const sheet = new PersonajeSheet(actor);
  sheet._mtrolSelectedItemId = target.id;
  sheet._confirmInventoryItemDeletion = async () => false;

  const result = await sheet._onDeleteItem({
    preventDefault() {},
    currentTarget: {
      dataset: { confirmDelete: "true" },
      closest: () => ({ dataset: { itemId: target.id } })
    }
  });

  assert.equal(result, false);
  assert.equal(target.deletes, 0);
  assert.equal(target.updates, 0);
  assert.equal(actorWrites, 0);
  assert.equal(sheet._mtrolSelectedItemId, target.id);
});

test("el borrado usa Dialog de Foundry con Confirmar y Cancelar", async () => {
  let dialogConfig = null;
  globalThis.Dialog = class {
    constructor(config) { dialogConfig = config; }
    render() { return this; }
  };
  const sheet = new PersonajeSheet(actorWith());
  const confirmation = sheet._confirmInventoryItemDeletion(item("dialog", { name: "<Casco>" }));

  assert.equal(dialogConfig.title, "Eliminar objeto");
  assert.deepEqual(Object.keys(dialogConfig.buttons), ["confirm", "cancel"]);
  assert.match(dialogConfig.content, /&lt;Casco&gt;/);
  dialogConfig.buttons.cancel.callback();
  assert.equal(await confirmation, false);
});

test("confirmar borrado reutiliza desequipado seguro antes de delete", async () => {
  const [source, controller] = await Promise.all([
    readFile(sheetPath, "utf8"),
    readFile(new URL("../scripts/sheets/actors/personaje-inventory-controller.js", import.meta.url), "utf8")
  ]);
  const handler = source.match(/async _onDeleteItem\(event\)[\s\S]*?\n  _confirmInventoryItemDeletion/)?.[0] ?? "";

  assert.match(handler, /confirmDelete[\s\S]*?_confirmInventoryItemDeletion/);
  assert.match(handler, /deleteSheetItem/);
  assert.ok(controller.indexOf("desequiparObjeto") < controller.indexOf("item.delete"));
});

test("la vista previa DnD contiene sólo icono y nombre y se limpia", async () => {
  const appended = [];
  const makeNode = tag => ({
    tag,
    children: [],
    append(...children) { this.children.push(...children); },
    remove() { this.removed = true; }
  });
  const documentRoot = {
    body: { appendChild(node) { appended.push(node); } },
    createElement: makeNode
  };
  const sheet = new PersonajeSheet(actorWith());
  sheet.element = [{ ownerDocument: documentRoot }];
  let dragImage = null;
  sheet._setItemDragPreview({ setDragImage(node) { dragImage = node; } }, item("drag", { name: "Daga" }));

  assert.equal(dragImage, appended[0]);
  assert.equal(dragImage.children.map(child => child.tag).join(","), "img,span");
  assert.equal(dragImage.children[1].textContent, "Daga");
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(dragImage.removed, true);
});

test("template y CSS cumplen jerarquía, iconografía, pie y feedback visual", async () => {
  const [template, style] = await Promise.all([
    readFile(templatePath, "utf8"),
    readFile(stylePath, "utf8")
  ]);
  const mainEnd = template.indexOf("</div>\n\n        <footer class=\"mtrol-inventory-weight");
  const footerStart = template.indexOf("<footer class=\"mtrol-inventory-weight");
  const browserHeader = template.match(/<div class="mtrol-inventory-browser-header">[\s\S]*?<\/div>/)?.[0] ?? "";
  const carryRules = style.match(/\.mtrol-personaje-sheet \.mtrol-inventory-weight\s*\{[\s\S]*?\n\}/g) ?? [];

  assert.ok(mainEnd >= 0 && footerStart > mainEnd);
  assert.doesNotMatch(template, /mtrol-inventory-workspace-main/);
  assert.doesNotMatch(browserHeader, /<h3[^>]*>Inventario<\/h3>/);
  assert.match(browserHeader, /class="mtrol-inventory-search"/);
  assert.match(template, /class="mtrol-inventory-filter"/);
  assert.doesNotMatch(template, /class="mtrol-inventory-category/);
  assert.match(template, /title="{{slot\.tooltip}}"/);
  assert.match(template, /data-confirm-delete="true"/);
  assert.match(template, /mtrol-inventory-inspector-close/);
  assert.match(template, /class="mtrol-inventory-equipment" aria-label="Equipamiento del personaje"/);
  assert.doesNotMatch(template, />Equipamiento<\/h3>/);
  assert.match(template, /for="mtrol-pending-attribute-\{\{actor\.id\}\}"/);
  assert.match(template, /id="mtrol-pending-attribute-\{\{actor\.id\}\}"/);
  assert.match(template, /for="mtrol-pending-competence-\{\{actor\.id\}\}"/);
  assert.match(template, /id="mtrol-pending-competence-\{\{actor\.id\}\}"/);
  assert.doesNotMatch(template, /data-item-name=|data-item-category=/);
  assert.match(template, /#each inventoryCarry\.segments/);
  assert.match(style, /grid-template-columns:\s*repeat\(10,/);
  assert.equal(carryRules.some(rule => /flex-wrap:\s*wrap/.test(rule)), true);
  assert.equal(carryRules.some(rule => /position:\s*(absolute|fixed)/.test(rule)), false);
  assert.match(style, /\.mtrol-item-drag-preview/);
  assert.match(style, /\.is-drop-compatible[\s\S]*?border-color:\s*rgba\(216, 194, 122/);
});
