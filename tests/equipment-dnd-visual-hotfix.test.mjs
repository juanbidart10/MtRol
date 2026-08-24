import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  MTROL_EQUIPMENT_LEFT_SLOTS,
  MTROL_EQUIPMENT_RIGHT_SLOTS
} from "../scripts/items/inventory-view-model.js";

const templatePath = new URL("../templates/actors/personaje-sheet.html", import.meta.url);
const stylePath = new URL("../styles/sheets/inventory-workspace.css", import.meta.url);
const sheetPath = new URL("../scripts/sheets/actors/personaje-sheet.js", import.meta.url);
const enginePath = new URL("../scripts/items/equipment-engine.js", import.meta.url);

test("la composición declara cinco slots exactos a cada lado", () => {
  assert.deepEqual([...MTROL_EQUIPMENT_LEFT_SLOTS], [
    "cabeza", "hombros", "brazos", "manoDer", "piernas"
  ]);
  assert.deepEqual([...MTROL_EQUIPMENT_RIGHT_SLOTS], [
    "cuello", "extra", "pecho", "manoIzq", "pies"
  ]);
});

test("template separa laterales, personaje y slots limpios", async () => {
  const template = await readFile(templatePath, "utf8");
  const equipment = template.match(
    /<section class="mtrol-inventory-equipment"[\s\S]*?<section class="mtrol-inventory-browser"/
  )?.[0] ?? "";
  const character = equipment.match(
    /<figure class="mtrol-equipment-character"[\s\S]*?<\/figure>/
  )?.[0] ?? "";

  assert.match(equipment, /mtrol-equipment-slots-left[\s\S]*?inventoryView\.slotsLeft/);
  assert.match(equipment, /mtrol-equipment-character[\s\S]*?equipmentCharacterImage\.src/);
  assert.match(equipment, /mtrol-equipment-slots-right[\s\S]*?inventoryView\.slotsRight/);
  assert.doesNotMatch(equipment, /mtrol-equipment-slot-actions/);
  assert.doesNotMatch(character, /button|figcaption/);
});

test("Equipar y Desequipar desaparecen de la UI pero la autoridad permanece", async () => {
  const [template, engine, sheet] = await Promise.all([
    readFile(templatePath, "utf8"),
    readFile(enginePath, "utf8"),
    readFile(sheetPath, "utf8")
  ]);

  assert.doesNotMatch(template, /class="item-equip"|class="item-unequip"/);
  assert.match(engine, /export async function equiparObjeto/);
  assert.match(engine, /export async function desequiparObjeto/);
  assert.match(sheet, /_handleInternalItemDrop[\s\S]*?equiparObjeto\(this\.actor, item\)/);
  assert.match(sheet, /_handleInternalItemDrop[\s\S]*?desequiparObjeto\(this\.actor, item\)/);
});

test("Editar y Eliminar existen sólo en el Inspector condicionado a GM", async () => {
  const template = await readFile(templatePath, "utf8");
  const inspector = template.match(
    /<aside class="mtrol-inventory-detail-panel"[\s\S]*?<\/aside>/
  )?.[0] ?? "";
  const slots = template.match(
    /<div class="mtrol-equipment-stage">[\s\S]*?<\/section>/
  )?.[0] ?? "";

  assert.match(inspector, /{{#if @root\.esGM}}[\s\S]*?class="[^"]*\bitem-edit\b[^"]*"[\s\S]*?class="[^"]*\bitem-delete\b[^"]*"/);
  assert.doesNotMatch(inspector, /item-equip|item-unequip/);
  assert.doesNotMatch(slots, /class="item-edit"|class="item-delete"/);
});

test("controles de imagen GM están en la cabecera, nunca sobre el cuerpo", async () => {
  const [template, sheet] = await Promise.all([
    readFile(templatePath, "utf8"),
    readFile(sheetPath, "utf8")
  ]);
  const header = template.match(/<header class="mtrol-equipment-header">[\s\S]*?<\/header>/)?.[0] ?? "";
  const character = template.match(/<figure class="mtrol-equipment-character"[\s\S]*?<\/figure>/)?.[0] ?? "";

  assert.match(header, /{{#if esGM}}[\s\S]*?mtrol-equipment-character-change/);
  assert.match(header, /equipmentCharacterImage\.custom[\s\S]*?mtrol-equipment-character-remove/);
  assert.doesNotMatch(character, /mtrol-equipment-character-(?:change|remove|controls)/);
  assert.match(sheet, /new foundry\.applications\.apps\.FilePicker\.implementation/);
});

test("personaje domina el ancho, está centrado y conserva imagen transparente", async () => {
  const style = await readFile(stylePath, "utf8");

  assert.match(style, /grid-template-columns:\s*minmax\(52px, \.72fr\) minmax\(0, 2\.35fr\) minmax\(52px, \.72fr\)/);
  assert.match(style, /\.mtrol-equipment-character\s*\{[\s\S]*?display:\s*flex;[\s\S]*?align-items:\s*center;[\s\S]*?justify-content:\s*center;/);
  assert.match(style, /\.mtrol-equipment-character-image\s*\{[\s\S]*?object-fit:\s*contain;[\s\S]*?object-position:\s*center;/);
  assert.match(style, /\.mtrol-equipment-character-image-frame\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;/);
});

test("modo estrecho coloca personaje arriba y parejas 2×5 debajo", async () => {
  const style = await readFile(stylePath, "utf8");
  const compact = style.match(
    /@container mtrol-inventory \(max-width: 520px\)[\s\S]*$/
  )?.[0] ?? "";

  assert.match(compact, /grid-template-areas:[\s\S]*?"character character"[\s\S]*?"slots-left slots-right"/);
  assert.match(compact, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(style, /\.mtrol-equipment-slots\s*\{[\s\S]*?grid-template-rows:\s*repeat\(5,/);
  assert.match(compact, /min-height:\s*58px/);
});

test("feedback DnD es discreto, limpio y mantiene hitbox cómoda", async () => {
  const style = await readFile(stylePath, "utf8");

  assert.match(style, /min-width:\s*48px/);
  assert.match(style, /min-height:\s*54px/);
  assert.match(style, /cursor:\s*grab/);
  assert.match(style, /cursor:\s*grabbing/);
  assert.match(style, /\.is-drop-compatible/);
  assert.match(style, /\.is-drop-incompatible/);
  assert.match(style, /\.mtrol-inventory-list-region\.is-drop-unequip/);
  assert.doesNotMatch(style, /transform:\s*scale\(|\bzoom\s*:/);
});
