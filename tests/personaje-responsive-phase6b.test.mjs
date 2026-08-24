import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sheetPath = new URL("../scripts/sheets/actors/personaje-sheet.js", import.meta.url);
const resizePath = new URL("../scripts/sheets/mtrol-resize-handle.js", import.meta.url);
const shellStylePath = new URL("../styles/sheets/personaje.css", import.meta.url);
const premiumStylePath = new URL("../styles/sheets/personaje-premium.css", import.meta.url);
const inventoryStylePath = new URL("../styles/sheets/inventory-workspace.css", import.meta.url);
const progressionStylePath = new URL("../styles/sheets/progresion.css", import.meta.url);
const skillsStylePath = new URL("../styles/sheets/competencias.css", import.meta.url);

test("PersonajeSheet conserva resize bidimensional con mínimos explícitos", async () => {
  const [sheet, resize] = await Promise.all([
    readFile(sheetPath, "utf8"),
    readFile(resizePath, "utf8")
  ]);

  assert.match(sheet, /MTROL_PERSONAJE_INITIAL_WIDTH = 700/);
  assert.match(sheet, /MTROL_PERSONAJE_MIN_WIDTH = 480/);
  assert.match(sheet, /MTROL_PERSONAJE_MIN_HEIGHT = 520/);
  assert.match(sheet, /resizable:\s*true/);
  assert.match(resize, /sheet\?\.options\?\.minWidth/);
  assert.match(resize, /sheet\?\.options\?\.minHeight/);
  assert.match(resize, /sheet\.setPosition\(\{\s*width,\s*height\s*\}\)/);
});

test("el contenedor real de la ventana gobierna ancho y alto", async () => {
  const shell = await readFile(shellStylePath, "utf8");

  assert.match(shell, /\.window-content[\s\S]*?container-name:\s*mtrol-sheet;[\s\S]*?container-type:\s*size;/);
  assert.match(shell, /\.mtrol-personaje-sheet\s*\{[\s\S]*?min-width:\s*0 !important;[\s\S]*?min-height:\s*0 !important;/);
});

test("los cuatro estados coordinados usan 1100, 760 y 520", async () => {
  const premium = await readFile(premiumStylePath, "utf8");

  assert.match(premium, /XL > 1100, L <= 1100, M <= 760, S <= 520/);
  assert.match(premium, /@container mtrol-sheet \(max-width: 1100px\)/);
  assert.match(premium, /@container mtrol-sheet \(max-width: 760px\)/);
  assert.match(premium, /@container mtrol-sheet \(max-width: 520px\)/);
  assert.match(premium, /@container mtrol-sheet \(max-height: 780px\)/);
  assert.match(premium, /@container mtrol-sheet \(max-height: 620px\)/);
});

test("header y navegación redistribuyen contenido sin truncar texto", async () => {
  const premium = await readFile(premiumStylePath, "utf8");

  assert.match(premium, /max-width: 1100px[\s\S]*?\.mtrol-hero-subtitle\s*\{[\s\S]*?flex-wrap:\s*wrap;[\s\S]*?white-space:\s*normal;/);
  assert.match(premium, /max-width: 760px[\s\S]*?\.mtrol-master-header\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(premium, /max-width: 760px[\s\S]*?\.mtrol-main-tabs\s*\{[\s\S]*?repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(premium, /max-width: 520px[\s\S]*?\.mtrol-main-tabs\s*\{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/);
});

test("Inventario mantiene 40/60 y apila antes de comprimir su contenido", async () => {
  const inventory = await readFile(inventoryStylePath, "utf8");

  assert.match(inventory, /grid-template-columns:\s*minmax\(230px, 2fr\) minmax\(300px, 3fr\)/);
  assert.match(inventory, /@container mtrol-inventory \(max-width: 720px\)[\s\S]*?\.mtrol-inventory-main\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(inventory, /@container mtrol-inventory \(max-width: 520px\)/);
});

test("buscador y filtro comparten fila y se apilan en ancho estrecho", async () => {
  const inventory = await readFile(inventoryStylePath, "utf8");

  assert.match(inventory, /\.mtrol-inventory-browser-header\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 2fr\) minmax\(112px, 1fr\)/);
  assert.match(inventory, /max-width: 520px[\s\S]*?\.mtrol-inventory-browser-header\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(inventory, /\.mtrol-inventory-browser-header input,[\s\S]*?\.mtrol-inventory-browser-header select[\s\S]*?width:\s*100%/);
  assert.match(inventory, /\.mtrol-inventory-weight\s*\{[\s\S]*?flex-wrap:\s*wrap;/);
});

test("la tabla estrecha conserva nombre, cantidad y total", async () => {
  const inventory = await readFile(inventoryStylePath, "utf8");
  const narrow = inventory.match(/@container mtrol-inventory \(max-width: 520px\)[\s\S]*$/)?.[0] ?? "";

  assert.match(narrow, /th:nth-child\(3\),[\s\S]*?td:nth-child\(3\)[\s\S]*?display:\s*none/);
  assert.doesNotMatch(narrow, /(?:th|td):first-child[\s\S]{0,80}display:\s*none/);
  assert.doesNotMatch(narrow, /(?:th|td):nth-child\(2\)[\s\S]{0,80}display:\s*none/);
  assert.doesNotMatch(narrow, /(?:th|td):nth-child\(4\)[\s\S]{0,80}display:\s*none/);
});

test("el stage responde al contenedor y nunca aplica escala global", async () => {
  const inventory = await readFile(inventoryStylePath, "utf8");

  assert.match(inventory, /\.mtrol-inventory-equipment\s*\{[\s\S]*?container-type:\s*inline-size;/);
  const desktopStage = inventory.match(/\.mtrol-personaje-sheet \.mtrol-equipment-stage\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(desktopStage, /height:\s*auto/);
  assert.doesNotMatch(desktopStage, /height:\s*clamp\([^\n]*cqi/);
  assert.match(inventory, /height:\s*clamp\(400px, 82cqi, 540px\)/);
  assert.match(inventory, /grid-template-areas:\s*[\s\S]*?"character character"[\s\S]*?"slots-left slots-right"/);
  assert.match(inventory, /grid-template-rows:\s*minmax\(300px, 82cqi\) auto/);
  assert.doesNotMatch(inventory, /transform:\s*scale|\bzoom\s*:/);
  assert.doesNotMatch(inventory, /\b\d+(?:\.\d+)?(?:vw|vh)\b/);
});

test("el filtro nativo conserva contraste oscuro en control y opciones", async () => {
  const inventory = await readFile(inventoryStylePath, "utf8");

  assert.match(inventory, /\.mtrol-inventory-filter\s*\{[\s\S]*?color-scheme:\s*dark/);
  assert.match(inventory, /\.mtrol-inventory-filter option\s*\{[\s\S]*?color:\s*#eadfca;[\s\S]*?background-color:\s*#171215/);
  assert.match(inventory, /\.mtrol-inventory-filter option:checked\s*\{[\s\S]*?color:\s*#f2dfa8;[\s\S]*?background-color:\s*#541820/);
});

test("el scroll tiene propietarios explícitos y no compite entre paneles", async () => {
  const [shell, inventory] = await Promise.all([
    readFile(shellStylePath, "utf8"),
    readFile(inventoryStylePath, "utf8")
  ]);

  assert.match(shell, /\.window-content[\s\S]*?overflow:\s*hidden !important/);
  assert.match(shell, /\.sheet-body,[\s\S]*?overflow:\s*hidden/);
  assert.match(shell, /\.mtrol-tab-personaje,[\s\S]*?overflow-y:\s*auto;[\s\S]*?overflow-x:\s*hidden/);
  assert.match(inventory, /\.mtrol-inventory-list-region\s*\{[\s\S]*?overflow-y:\s*auto;[\s\S]*?overflow-x:\s*hidden/);
  assert.match(inventory, /\.mtrol-inventory-detail-panel\s*\{[\s\S]*?overflow:\s*hidden/);
  assert.match(inventory, /\.mtrol-inventory-inspector-description p\s*\{[\s\S]*?overflow-y:\s*auto/);
});

test("1366x768 activa composición compacta sin desbordar Inventario", async () => {
  const [premium, inventory] = await Promise.all([
    readFile(premiumStylePath, "utf8"),
    readFile(inventoryStylePath, "utf8")
  ]);

  assert.match(premium, /@container mtrol-sheet \(max-height: 780px\)[\s\S]*?\.mtrol-hero-portrait\s*{[\s\S]*?104px/);
  assert.match(premium, /max-height: 780px[\s\S]*?\.mtrol-main-tabs \.item\s*{[\s\S]*?min-height:\s*36px/);
  assert.match(inventory, /@container mtrol-sheet \(max-height: 780px\)[\s\S]*?\.mtrol-inventory-main\s*{[\s\S]*?overflow:\s*hidden/);
  assert.match(inventory, /max-height: 780px[\s\S]*?grid-template-rows:\s*auto minmax\(82px, 1fr\) minmax\(52px, \.65fr\)/);
});

test("Progresión y Competencias responden a la hoja, no al viewport", async () => {
  const [progression, skills] = await Promise.all([
    readFile(progressionStylePath, "utf8"),
    readFile(skillsStylePath, "utf8")
  ]);

  assert.match(progression, /@container mtrol-sheet \(max-width: 760px\)/);
  assert.match(progression, /@container mtrol-sheet \(max-width: 520px\)/);
  assert.match(skills, /@container mtrol-competencias \(max-width: 540px\)/);
  assert.doesNotMatch(progression, /@media \(max-width:/);
  assert.doesNotMatch(skills, /@media \(max-width:/);
});
