import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sheetSource = await readFile(
  new URL("../scripts/sheets/actors/personaje-sheet.js", import.meta.url),
  "utf8"
);
const templateSource = await readFile(
  new URL("../templates/actors/personaje-sheet.html", import.meta.url),
  "utf8"
);
const styleSource = await readFile(
  new URL("../styles/sheets/progresion.css", import.meta.url),
  "utf8"
);
const variablesSource = await readFile(
  new URL("../styles/ui/variables.css", import.meta.url),
  "utf8"
);

test("el descriptor visual cubre todas las claves sin modificar progression-engine", () => {
  const expected = {
    mvp: ["MVP", "fa-trophy"],
    exp: ["EXPERIENCIA", "fa-star"],
    missionsCompleted: ["MISIÓN COMPLETADA", "fa-scroll"],
    dungeonsCompleted: ["DUNGEON COMPLETADO", "fa-dungeon"],
    attributesAtFive: ["ATRIBUTOS EN 5", "fa-chart-bar"],
    competencesAtLeastThree: ["COMPETENCIA NIVEL 3", "fa-book-open"],
    competencesAtFive: ["COMPETENCIAS EN 5", "fa-book-open"],
    meritCredits: ["CRÉDITOS POR MÉRITO", "fa-coins"],
    defeatedLevel5Enemy: ["ENEMIGO NIVEL 5 DERROTADO", "fa-skull-crossbones"],
    dmApproval: ["APROBACIÓN DM", "fa-shield-alt"]
  };

  for (const [key, [label, icon]] of Object.entries(expected)) {
    assert.match(sheetSource, new RegExp(`${key}:[\\s\\S]*?label:\\s*"${label}"[\\s\\S]*?icon:\\s*"${icon}"`));
  }
  assert.match(sheetSource, /requirements:\s*evaluation\.requirements\.map/);
});

test("la sección usa encabezado, objetivo y estado máximo exactos", () => {
  assert.match(templateSource, /REQUISITOS PARA SUBIR DE NIVEL/);
  assert.match(templateSource, /Objetivo actual: Nivel {{progressionEvaluation\.level}}[^<]*{{progressionEvaluation\.nextLevel}}/);
  assert.match(templateSource, /NIVEL M&Aacute;XIMO ALCANZADO/i);
});

test("cada fila expone icono, label, progreso y estado independientes", () => {
  assert.match(templateSource, /class="progresion-requirement-identity"[\s\S]*?class="fas {{icon}}"[\s\S]*?{{label}}/);
  assert.match(templateSource, /class="progresion-requirement-value"[^>]*>{{valueText}}/);
  assert.match(templateSource, /class="progresion-requirement-state"[\s\S]*?{{stateLabel}}/);
  assert.match(templateSource, /{{#if met}}fa-check{{else}}fa-circle{{\/if}}/);
  assert.match(sheetSource, /stateLabel:\s*requirement\.met\s*\?\s*"COMPLETADO"\s*:\s*"PENDIENTE"/);
  assert.match(sheetSource, /isBoolean\s*\?\s*"—"/);
});

test("los controles administrativos de requisitos sólo se renderizan para GM", () => {
  assert.match(templateSource, /{{#if esGM}}\s*<div class="progresion-admin-grid">[\s\S]*?<\/div>\s*{{\/if}}/);
});

test("requisitos y Orbes reutilizan Morpheus como única familia tipográfica", () => {
  assert.match(variablesSource, /--mtrol-font-title:\s*\n?\s*"Morpheus"/);
  assert.doesNotMatch(styleSource, /@font-face/);
  assert.match(styleSource, /\.progresion-section--requirements,[\s\S]*?\.progresion-orbs\s*\{[\s\S]*?font-family:\s*var\(--mtrol-font-title\)/);
  assert.match(styleSource, /\.mtrol-tab-progresion select\s*\{[\s\S]*?font-family:\s*var\(--mtrol-font-title\)/);
  assert.match(styleSource, /\.progresion-orb-add button\s*\{[\s\S]*?font-family:\s*var\(--mtrol-font-title\)/);
});

test("el layout mantiene tres zonas, estados y adaptación responsive", () => {
  assert.match(styleSource, /\.progresion-requirements li\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) minmax\([^;]+\) minmax\([^;]+\)/);
  assert.match(styleSource, /\.progresion-requirements li\.is-complete::after/);
  assert.match(styleSource, /\.progresion-requirement-state[\s\S]*?text-transform:\s*uppercase/);
  assert.match(styleSource, /@media \(max-width: 560px\)[\s\S]*?\.progresion-requirements li/);
});

test("Orbes conserva estado vacío, selects oscuros y alta alineada", () => {
  assert.match(templateSource, /Este Actor no posee Orbes otorgados\./);
  assert.match(templateSource, />\+ AGREGAR ORBE</i);
  assert.match(styleSource, /\.progresion-orb-main,[\s\S]*?\.progresion-orb-add\s*\{[\s\S]*?align-items:\s*center/);
  assert.match(styleSource, /\.mtrol-tab-progresion select\s*\{[\s\S]*?color-scheme:\s*dark/);
});
