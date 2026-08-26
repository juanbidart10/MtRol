import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  MTROL_BODY_SLOTS
} from "../scripts/constants/body-slots.js";

import {
  buildInventoryInspectorViewModel,
  resolveInventoryInspectorItem
} from "../scripts/items/inventory-inspector-view-model.js";

function createCollection(items = []) {
  const collection = [...items];
  collection.get = id => collection.find(item => item.id === id) ?? null;
  return collection;
}

function createItem(id, system = {}, overrides = {}) {
  return {
    id,
    uuid: `Actor.inspector.Item.${id}`,
    name: overrides.name ?? id,
    img: overrides.img ?? "icons/example.webp",
    type: "objeto",
    system: {
      tipoObjeto: "general",
      cantidad: 1,
      peso: 0,
      equipable: false,
      equipado: false,
      slot: "",
      descripcion: "",
      defensa: 0,
      defensaBase: 0,
      danio: "",
      material: "",
      valor: 0,
      ...system
    }
  };
}

function createActor(items = [], equipamiento = {}) {
  return {
    id: "inspector",
    type: "personaje",
    items: createCollection(items),
    system: {
      equipamiento: Object.fromEntries(
        MTROL_BODY_SLOTS.map(slot => [slot, equipamiento[slot] ?? ""])
      )
    }
  };
}

function statsByLabel(stats) {
  return Object.fromEntries(stats.map(stat => [stat.label, stat.value]));
}

const templatePath = new URL("../templates/actors/personaje-sheet.html", import.meta.url);
const stylePath = new URL("../styles/sheets/inventory-workspace.css", import.meta.url);
const sheetPath = new URL("../scripts/sheets/actors/personaje-sheet.js", import.meta.url);

test("sin seleccion prepara un Inspector vacio y no persiste estado", () => {
  const actor = createActor();

  assert.equal(resolveInventoryInspectorItem(actor, null), null);
  assert.deepEqual(buildInventoryInspectorViewModel(actor, null), {
    selected: false,
    itemId: null,
    item: null,
    stats: [],
    typeStats: []
  });
  assert.equal("_mtrolSelectedItemId" in actor.system, false);
});

test("resuelve exclusivamente por ID embebido y tolera IDs eliminados o arbitrarios", () => {
  const sword = createItem("sword", {}, { name: "Espada" });
  const actor = createActor([sword]);

  assert.equal(resolveInventoryInspectorItem(actor, "sword"), sword);
  assert.equal(resolveInventoryInspectorItem(actor, "Espada"), null);
  assert.equal(resolveInventoryInspectorItem(actor, "missing"), null);
  actor.items.splice(0, 1);
  assert.equal(resolveInventoryInspectorItem(actor, "sword"), null);
});

test("expone datos comunes, pesos autoritativos, descripcion escapable e imagen", () => {
  const item = createItem("long", {
    cantidad: 3,
    peso: 2.5,
    descripcion: "<b>No se inyecta</b>\nSegunda linea"
  }, {
    name: "Nombre muy largo que el Inspector debe envolver",
    img: "  icons/long.webp  "
  });
  const view = buildInventoryInspectorViewModel(createActor([item]), item);

  assert.equal(view.selected, true);
  assert.equal(view.itemId, "long");
  assert.equal(view.item, item);
  assert.equal(view.name, item.name);
  assert.equal(view.img, "icons/long.webp");
  assert.equal(view.tipoLabel, "Objeto");
  assert.equal(view.description, item.system.descripcion);
  assert.equal(view.quantity, 3);
  assert.equal(view.weight, 2.5);
  assert.equal(view.totalWeight, 7.5);
  assert.deepEqual(statsByLabel(view.stats), {
    Cantidad: 3,
    "Peso unitario": 2.5,
    "Peso total": 7.5
  });
});

test("imagen invalida usa el fallback de Item", () => {
  for (const img of ["", "null", "undefined", "[object Object]"]) {
    const item = createItem(`bad-${img}`, {}, { img });
    assert.equal(
      buildInventoryInspectorViewModel(createActor([item]), item).img,
      "icons/svg/item-bag.svg"
    );
  }
});

test("mapea tipos conocidos y desconocidos sin modificar tipoObjeto", () => {
  const expected = {
    arma: "Arma",
    armadura: "Armadura",
    escudo: "Escudo",
    consumible: "Consumible",
    material: "Material",
    general: "Objeto",
    llave: "Objeto",
    moneda: "Objeto",
    futuro: "Objeto"
  };

  for (const [tipoObjeto, label] of Object.entries(expected)) {
    const item = createItem(tipoObjeto, { tipoObjeto });
    const view = buildInventoryInspectorViewModel(createActor([item]), item);
    assert.equal(view.tipoObjeto, tipoObjeto);
    assert.equal(view.tipoLabel, label);
    assert.equal(item.system.tipoObjeto, tipoObjeto);
  }
});

test("muestra solo los campos especificos reales y relevantes de cada tipo", () => {
  const weapon = createItem("weapon", { tipoObjeto: "arma", danio: "1d8" });
  const armor = createItem("armor", { tipoObjeto: "armadura", defensa: 4, defensaBase: 6 });
  const shield = createItem("shield", { tipoObjeto: "escudo", defensa: 3, defensaBase: 5 });
  const material = createItem("material", { tipoObjeto: "material", material: "hierro", valor: 12 });
  const consumable = createItem("consumable", { tipoObjeto: "consumible" });
  const actor = createActor([weapon, armor, shield, material, consumable]);

  assert.deepEqual(statsByLabel(buildInventoryInspectorViewModel(actor, weapon).typeStats), {
    "Daño": "1d8"
  });
  assert.deepEqual(statsByLabel(buildInventoryInspectorViewModel(actor, armor).typeStats), {
    Defensa: 4,
    "Defensa base": 6
  });
  assert.deepEqual(statsByLabel(buildInventoryInspectorViewModel(actor, shield).typeStats), {
    Defensa: 3,
    "Defensa base": 5
  });
  assert.deepEqual(statsByLabel(buildInventoryInspectorViewModel(actor, material).typeStats), {
    Material: "hierro",
    Valor: 12
  });
  assert.deepEqual(buildInventoryInspectorViewModel(actor, consumable).typeStats, []);
});

test("slot efectivo procede del Actor y no de system.slot ni system.equipado", () => {
  const item = createItem("authority", {
    equipable: true,
    equipado: false,
    slot: "cabeza"
  });
  const actor = createActor([item], { cuello: item.id });
  const view = buildInventoryInspectorViewModel(actor, item);

  assert.equal(view.equipped, true);
  assert.equal(view.declaredSlot, "cabeza");
  assert.equal(view.declaredSlotLabel, "Cabeza");
  assert.equal(view.effectiveSlot, "cuello");
  assert.equal(view.effectiveSlotLabel, "Cuello");
  assert.equal("action" in view, false);
});

test("Inspector no prepara acciones legacy de equipar ni desequipar", () => {
  const equipped = createItem("equipped", { equipable: true, slot: "cabeza" });
  const inventory = createItem("inventory", { equipable: true, slot: "pies" });
  const invalid = createItem("invalid", { equipable: true, slot: "fuera" });
  const actor = createActor([equipped, inventory, invalid], { cabeza: equipped.id });

  for (const item of [equipped, inventory, invalid]) {
    const view = buildInventoryInspectorViewModel(actor, item);
    assert.equal("action" in view, false);
    assert.equal("canManageEquipment" in view, false);
    assert.equal("canEditItem" in view, false);
  }

  const item = createItem("invalid", { equipable: true, slot: "fuera" });
  const view = buildInventoryInspectorViewModel(
    createActor([item]),
    item
  );

  assert.equal(view.declaredSlotLabel, "");
});

test("template contiene Inspector data-driven, texto seguro y acciones administrativas GM", async () => {
  const template = await readFile(templatePath, "utf8");
  const inspector = template.match(
    /<aside class="mtrol-inventory-detail-panel"[\s\S]*?<\/aside>/
  )?.[0] ?? "";

  assert.match(inspector, /inventoryInspector\.selected/);
  assert.match(inspector, /inventoryInspector\.img/);
  assert.match(inspector, /inventoryInspector\.name/);
  assert.match(inspector, /inventoryInspector\.tipoLabel/);
  assert.match(inspector, /#each inventoryInspector\.stats/);
  assert.match(inspector, /#each inventoryInspector\.typeStats/);
  assert.match(inspector, /\{\{inventoryInspector\.description\}\}/);
  assert.doesNotMatch(inspector, /\{\{\{inventoryInspector\.description\}\}\}/);
  assert.match(inspector, /#if inventoryInspector\.consumable\.canUse[\s\S]*?mtrol-consumable-use[\s\S]*?USAR/);
  assert.match(inspector, /{{#if @root\.esGM}}[\s\S]*?item-edit[\s\S]*?item-delete/);
  assert.equal((inspector.match(/mtrol-inventory-asset-button/g) ?? []).length, 3);
  assert.doesNotMatch(inspector, /item-equip|item-unequip|Enviar al chat/i);
});

test("Sheet limpia IDs invalidos, conserva filtro efimero y retira handlers legacy", async () => {
  const source = await readFile(sheetPath, "utf8");

  assert.match(source, /resolveInventoryInspectorItem\([\s\S]*?this\._mtrolSelectedItemId/);
  assert.match(source, /if \(this\._mtrolSelectedItemId && !selectedInventoryItem\)[\s\S]*?this\._mtrolSelectedItemId = null/);
  assert.match(source, /this\._mtrolInventoryFilter = result\.filter/);
  assert.match(source, /this\._mtrolInventoryFilter \?\? "all"/);
  assert.doesNotMatch(source, /_onEquipItem|_onUnequipItem|html\.find\("\.item-equip"\)|html\.find\("\.item-unequip"\)/);
  assert.match(source, /_handleInternalItemDrop[\s\S]*?equiparObjeto\(this\.actor, item\)/);
  assert.match(source, /_handleInternalItemDrop[\s\S]*?desequiparObjeto\(this\.actor, item\)/);
});

test("CSS limita el Inspector, permite nombres largos y preserva descripcion", async () => {
  const style = await readFile(stylePath, "utf8");

  assert.match(style, /\.mtrol-inventory-detail-panel\s*\{[\s\S]*?max-height:[\s\S]*?overflow-y:\s*auto/);
  assert.match(style, /\.mtrol-inventory-inspector-header h4\s*\{[\s\S]*?overflow-wrap:\s*anywhere/);
  assert.match(style, /\.mtrol-inventory-inspector-description p\s*\{[\s\S]*?white-space:\s*pre-wrap/);
  assert.match(style, /\.mtrol-inventory-inspector-admin\s*\{[\s\S]*?flex-wrap:\s*wrap/);
  assert.match(style, /\.mtrol-inventory-inspector-stats dt,[\s\S]*?\.mtrol-inventory-inspector-stats dd\s*\{[\s\S]*?color:\s*var\(--mtrol-text/);
  assert.match(style, /\.mtrol-inventory-inspector-admin \.mtrol-inventory-asset-button\s*\{[\s\S]*?combat-execute-normal\.png/);
  assert.match(style, /\.mtrol-inventory-asset-button:hover\s*\{[\s\S]*?combat-execute-hover\.png/);
  assert.match(style, /\.mtrol-inventory-asset-button:active\s*\{[\s\S]*?combat-execute-active\.png/);
});
