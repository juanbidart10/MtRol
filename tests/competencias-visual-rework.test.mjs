import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buildCompetenceLevelDisplay,
  MTROL_COMPETENCE_LEVEL_CAP
} from "../scripts/items/competencia-presentation.js";

const template = await readFile(
  new URL("../templates/actors/personaje-sheet.html", import.meta.url),
  "utf8"
);
const style = await readFile(
  new URL("../styles/sheets/competencias.css", import.meta.url),
  "utf8"
);
const sheet = await readFile(
  new URL("../scripts/sheets/actors/personaje-sheet.js", import.meta.url),
  "utf8"
);
const frame = await readFile(
  new URL("../assets/ui/competencias/competencia-frame.png", import.meta.url)
);
const competenceTab = template.match(
  /<div class="tab mtrol-tab-competencias"[\s\S]*?<!-- TAB INVENTARIO UNIFICADO -->/
)?.[0] ?? "";

test("nivel visual siempre expone cinco posiciones y clampa 0–5", () => {
  assert.equal(MTROL_COMPETENCE_LEVEL_CAP, 5);

  for (const [input, expected] of [[0, 0], [1, 1], [3, 3], [5, 5], [9, 5], [-2, 0]]) {
    const display = buildCompetenceLevelDisplay(input);
    assert.equal(display.value, expected);
    assert.equal(display.markers.length, 5);
    assert.equal(display.markers.filter(marker => marker.active).length, expected);
    assert.deepEqual(display.markers.map(marker => marker.position), [1, 2, 3, 4, 5]);
  }
});

test("template conserva cards y respeta la jerarquía visual acordada", () => {
  assert.match(competenceTab, /class="mtrol-competencias-section" aria-label="Competencias"/);
  assert.doesNotMatch(competenceTab, />Competencias<\/h2>/);
  assert.doesNotMatch(style, /\.mtrol-competencias-header h2/);

  for (const selector of [
    "competencia-medallion",
    "competencia-medallion-image",
    "competencia-medallion-frame",
    "competencia-info",
    "mtrol-competencia-actions",
    "competencia-level",
    "competencia-admin-controls"
  ]) {
    assert.match(competenceTab, new RegExp(selector));
  }

  const row = competenceTab.match(
    /<article class="competencia-row[\s\S]*?<\/article>/
  )?.[0] ?? "";
  const order = [
    "competencia-medallion",
    "competencia-info",
    "competencia-admin-controls",
    "competencia-level",
    "mtrol-competencia-actions"
  ].map(selector => row.indexOf(selector));
  assert.ok(order.every(index => index >= 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.doesNotMatch(competenceTab, /cooldown|STACK|CD 0/i);
});

test("la fila muestra el próximo costo calculado por el mismo view-model del engine", () => {
  assert.match(competenceTab, /class="competencia-mp-cost"[\s\S]*?MP \{\{this\.mtrolMpCost\}\}/);
  assert.match(sheet, /mtrolMpCost:\s*mpCost\.costoTotal/);
  assert.match(style, /\.competencia-mp-cost\s*\{/);
});

test("marco e imagen usan capas independientes sin persistir el overlay", () => {
  assert.match(competenceTab, /src="{{this\.imgSeguro}}"/);
  assert.match(competenceTab, /assets\/ui\/competencias\/competencia-frame\.png/);
  assert.match(style, /\.competencia-medallion-image\s*\{[\s\S]*?object-fit:\s*cover[\s\S]*?border-radius:\s*50%/);
  assert.match(style, /\.competencia-medallion-frame\s*\{[\s\S]*?z-index:\s*2[\s\S]*?pointer-events:\s*none/);
  assert.doesNotMatch(sheet, /item\.update\(\{[^}]*competencia-frame/);
});

test("asset final conserva dimensiones fuente y transparencia", () => {
  assert.equal(frame.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(frame.readUInt32BE(16), 1290);
  assert.equal(frame.readUInt32BE(20), 1219);
  assert.ok([4, 6].includes(frame[25]), "el marco debe conservar canal alpha");

});

test("Competencias reutiliza directamente los botones de Combate", () => {
  for (const asset of [
    "combat-dharma-inactive.png",
    "combat-execute-normal.png",
    "combat-execute-hover.png",
    "combat-execute-active.png"
  ]) {
    assert.match(style, new RegExp(asset.replace(".", "\\.")));
  }
});

test("edición de imagen y administración permanecen dentro de permisos GM", () => {
  assert.match(competenceTab, /{{#if \.\.\/esGM}}[\s\S]*?competencia-image-edit/);
  assert.match(competenceTab, /{{#if \.\.\/esGM}}[\s\S]*?competencia-down[\s\S]*?competencia-up/);
  assert.match(competenceTab, /{{#if \.\.\/esGM}}[\s\S]*?competencia-admin-controls[\s\S]*?item-edit[\s\S]*?item-delete/);
  assert.match(sheet, /_onChangeCompetenciaImage[\s\S]*?if \(!game\.user\.isGM\)/);
  assert.match(sheet, /new foundry\.applications\.apps\.FilePicker\.implementation\([\s\S]*?document: item/);
  assert.match(sheet, /await item\.update\(\{ img: selectedPath \}\)/);
  assert.match(sheet, /item\.type === "competencia" && !game\.user\.isGM/);
});

test("layout rectangular responde en amplio, medio y reducido sin convertir la card en vertical", () => {
  const rowRule = style.match(/\.mtrol-personaje-sheet \.competencia-row\s*\{[^}]*\}/)?.[0] ?? "";
  assert.match(style, /grid-template-columns:\s*126px minmax\(126px, 1fr\) minmax\(126px, 154px\) minmax\(142px, 172px\)/);
  assert.match(style, /grid-template-areas:\s*"media info level actions"/);
  assert.match(style, /\.competencia-medallion\s*\{[\s\S]*?width:\s*126px[\s\S]*?height:\s*126px/);
  assert.match(style, /\.competencia-info\s*\{[\s\S]*?align-items:\s*center[\s\S]*?justify-content:\s*center[\s\S]*?text-align:\s*center/);
  assert.match(style, /@container mtrol-competencias \(max-width: 820px\)[\s\S]*?grid-template-areas:[\s\S]*?media info actions[\s\S]*?media level actions/);
  assert.match(style, /@container mtrol-competencias \(max-width: 540px\)[\s\S]*?grid-template-areas:[\s\S]*?media info[\s\S]*?level level[\s\S]*?actions actions/);
  assert.match(style, /@container mtrol-competencias \(max-width: 540px\)[\s\S]*?\.competencia-medallion\s*\{[\s\S]*?width:\s*112px[\s\S]*?height:\s*112px/);
  assert.doesNotMatch(rowRule, /aspect-ratio:/);
  assert.doesNotMatch(style, /transform:\s*scale\(/);
});
