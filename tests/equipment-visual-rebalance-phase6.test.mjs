import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const templatePath = new URL("../templates/actors/personaje-sheet.html", import.meta.url);
const stylePath = new URL("../styles/sheets/inventory-workspace.css", import.meta.url);
const sheetPath = new URL("../scripts/sheets/actors/personaje-sheet.js", import.meta.url);

function cssBlock(style, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return style.match(new RegExp(`${escaped}\\s*\\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";
}

test("personaje conserva la fuente 5A y una imagen completa sin crop", async () => {
  const template = await readFile(templatePath, "utf8");
  const style = await readFile(stylePath, "utf8");
  const image = cssBlock(style, ".mtrol-personaje-sheet .mtrol-equipment-character-image");

  assert.match(template, /src="{{equipmentCharacterImage\.src}}"/);
  assert.match(image, /object-fit:\s*contain/);
  assert.match(image, /object-position:\s*center/);
  assert.doesNotMatch(image, /object-fit:\s*cover/);
});

test("frame e imagen neutralizan borde, fondo, outline y sombra rigidos", async () => {
  const style = await readFile(stylePath, "utf8");
  const frame = cssBlock(style, ".mtrol-personaje-sheet .mtrol-equipment-character-image-frame");
  const image = cssBlock(style, ".mtrol-personaje-sheet .mtrol-equipment-character-image");

  for (const block of [frame, image]) {
    assert.match(block, /border:\s*0/);
    assert.match(block, /outline:\s*0/);
    assert.match(block, /background:\s*transparent/);
    assert.match(block, /box-shadow:\s*none/);
    assert.doesNotMatch(block, /black|rgba\(0,\s*0,\s*0/);
  }
});

test("grid usa cinco slots por lateral y conserva la perspectiva de manos", async () => {
  const [style, template] = await Promise.all([
    readFile(stylePath, "utf8"),
    readFile(templatePath, "utf8")
  ]);

  assert.match(style, /grid-template-areas:\s*"slots-left character slots-right"/);
  assert.match(style, /grid-template-rows:\s*repeat\(5,/);
  assert.match(template, /slotsLeft/);
  assert.match(template, /slotsRight/);
  assert.match(template, /mtrol-equipment-slots-left[\s\S]*?slotsLeft/);
  assert.match(template, /mtrol-equipment-slots-right[\s\S]*?slotsRight/);
});

test("safe area central domina el ancho y aumenta todavia mas al apilar", async () => {
  const style = await readFile(stylePath, "utf8");
  const stage = cssBlock(style, ".mtrol-personaje-sheet .mtrol-equipment-stage");
  const stacked = style.match(
    /@container mtrol-inventory \(max-width: 720px\)\s*\{[\s\S]*?\.mtrol-personaje-sheet \.mtrol-equipment-stage\s*\{[\s\S]*?\n  \}/
  )?.[0] ?? "";

  assert.match(stage, /minmax\(52px, \.72fr\)[\s\S]*?2\.35fr[\s\S]*?minmax\(52px, \.72fr\)/);
  assert.match(stacked, /minmax\(54px, \.68fr\)[\s\S]*?2\.5fr[\s\S]*?minmax\(54px, \.68fr\)/);
  const frame = cssBlock(style, ".mtrol-personaje-sheet .mtrol-equipment-character-image-frame");
  assert.match(frame, /width:\s*100%/);
  assert.match(frame, /height:\s*100%/);
});

test("slots reducen presencia pero mantienen hitbox y delimitacion funcional", async () => {
  const style = await readFile(stylePath, "utf8");
  const slot = cssBlock(style, ".mtrol-personaje-sheet .mtrol-inventory-equipment-slot");

  assert.match(slot, /max-width:\s*clamp\(48px, 9cqi, 58px\)/);
  assert.match(slot, /min-width:\s*48px/);
  assert.match(slot, /min-height:\s*54px/);
  assert.match(slot, /padding:\s*clamp\(2px, \.35cqi, 3px\)/);
  assert.match(slot, /border:\s*1px solid rgba\(190, 160, 102, \.2\)/);
  assert.match(slot, /background:\s*rgba\(0, 0, 0, \.12\)/);
});

test("slots orbitan hacia el centro sin solaparse ni escalar el stage", async () => {
  const style = await readFile(stylePath, "utf8");
  const stage = cssBlock(style, ".mtrol-personaje-sheet .mtrol-equipment-stage");

  assert.match(style, /\.mtrol-equipment-slots-left \.mtrol-inventory-equipment-slot\s*\{[\s\S]*?justify-self:\s*end/);
  assert.match(style, /\.mtrol-equipment-slots-right \.mtrol-inventory-equipment-slot\s*\{[\s\S]*?justify-self:\s*start/);
  assert.match(stage, /overflow:\s*hidden/);
  assert.doesNotMatch(stage, /transform:\s*scale/);
  assert.doesNotMatch(style, /transform:\s*scale\(/);
});

test("controles GM quedan en la cabecera y ligados a los handlers 5A", async () => {
  const template = await readFile(templatePath, "utf8");
  const sheet = await readFile(sheetPath, "utf8");
  const character = template.match(
    /<figure class="mtrol-equipment-character"[\s\S]*?<\/figure>/
  )?.[0] ?? "";

  const header = template.match(/<header class="mtrol-equipment-header">[\s\S]*?<\/header>/)?.[0] ?? "";
  assert.doesNotMatch(character, /button|mtrol-equipment-character-controls/);
  assert.match(header, /{{#if esGM}}[\s\S]*?mtrol-equipment-character-change/);
  assert.match(header, /{{#if equipmentCharacterImage\.custom}}[\s\S]*?mtrol-equipment-character-remove/);
  assert.match(header, /aria-label="Cambiar imagen de equipamiento"/);
  assert.match(header, /aria-label="Quitar imagen corporal"/);
  assert.match(character, /title="Imagen recomendada:/);
  assert.doesNotMatch(character, /<small>Recomendado:/);
  assert.match(sheet, /\.mtrol-equipment-character-change[\s\S]*?_onChangeEquipmentCharacterImage/);
  assert.match(sheet, /\.mtrol-equipment-character-remove[\s\S]*?_onRemoveEquipmentCharacterImage/);
  assert.match(sheet, /new foundry\.applications\.apps\.FilePicker\.implementation/);
});

test("Inspector conserva selección y traslada allí las acciones GM", async () => {
  const template = await readFile(templatePath, "utf8");
  const inspector = template.match(
    /<aside class="mtrol-inventory-detail-panel"[\s\S]*?<\/aside>/
  )?.[0] ?? "";

  assert.match(inspector, /inventoryInspector\.selected/);
  assert.match(inspector, /{{#if @root\.esGM}}[\s\S]*?item-edit[\s\S]*?item-delete/);
  assert.doesNotMatch(inspector, /item-equip|item-unequip|inventoryInspector\.action/);
  assert.match(inspector, /inventoryInspector\.description/);
  assert.match(template, /selectedInventoryItemId/);
  assert.match(template, /inventoryFilter/);
});
