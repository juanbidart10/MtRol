import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  formulaHasDharmaEligibleDice
} from "../scripts/rolls/dharma-engine.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const template = await readFile(
  resolve(projectRoot, "templates/actors/personaje-sheet.html"),
  "utf8"
);
const sheetSource = await readFile(
  resolve(projectRoot, "scripts/sheets/actors/personaje-sheet.js"),
  "utf8"
);
const css = await readFile(
  resolve(projectRoot, "styles/ui/dharma-selector.css"),
  "utf8"
);

function sectionCount(section) {
  return (
    template.match(new RegExp(`data-mtrol-section="${section}"`, "g")) ?? []
  ).length;
}

test("Atributos, Competencias y Combate contienen el mismo patrón Gastar Dharma → Ejecutar", () => {
  assert.equal(sectionCount("atributos"), 9);
  assert.equal(sectionCount("competencias"), 1);
  assert.equal(sectionCount("combate"), 2);
  assert.equal((template.match(/class="mtrol-action-formula"/g) ?? []).length, 12);

  const controls = template.match(
    /<div class="mtrol-dharma-action[^"]*"[\s\S]*?<\/div>/g
  ) ?? [];

  assert.equal(controls.length, 12);

  for (const control of controls) {
    const prepareIndex = control.indexOf("mtrol-dharma-prepare");
    const executeIndex = control.indexOf("mtrol-action-execute");
    assert.ok(prepareIndex >= 0, "cada acción ofrece preparación");
    assert.ok(executeIndex > prepareIndex, "Ejecutar aparece después de Gastar Dharma");
    assert.match(control, /data-mtrol-action-key=/);
    assert.match(control, /data-mtrol-formula=/);
    assert.match(control, /data-mtrol-dharma-eligible=/);
  }
});

test("la UI deshabilita Dharma por saldo o fórmula sin habilitar Rolls técnicos", () => {
  assert.match(template, /mtrol-dharma-prepare[^>]*\{\{#unless mtrolDharmaEnabled\}\}disabled/);
  assert.match(template, /mtrol-dharma-prepare[^>]*\{\{#unless this\.mtrolDharmaEnabled\}\}disabled/);
  assert.doesNotMatch(template, /localizaci[oó]n[^<]*mtrol-dharma-prepare/i);
  assert.doesNotMatch(template, /desempate[^<]*mtrol-dharma-prepare/i);
  assert.doesNotMatch(template, /desgaste[^<]*mtrol-dharma-prepare/i);

  assert.equal(formulaHasDharmaEligibleDice("1d4 + 1"), false);
  assert.equal(formulaHasDharmaEligibleDice("2d10 + 1d8 + 4"), true);
  assert.equal(formulaHasDharmaEligibleDice("1d20"), true);
  assert.equal(formulaHasDharmaEligibleDice("daño fijo 8"), false);
});

test("las tres secciones comparten selector, mapa transitorio y handlers centrales", () => {
  assert.equal((sheetSource.match(/selectDharmaSpendForRoll\s*\(/g) ?? []).length, 1);
  assert.equal((sheetSource.match(/new Map\(\)/g) ?? []).length >= 1, true);
  assert.match(sheetSource, /html\.find\("\.mtrol-dharma-prepare"\)/);
  assert.match(sheetSource, /_getPreparedDharmaSpend\(event\)/);
  assert.match(sheetSource, /_executeAtributoRoll\(attr,\s*\{\s*dharmaSpend/s);
  assert.match(sheetSource, /resolverCompetencia\(\{[\s\S]*?dharmaSpend/);
  assert.doesNotMatch(sheetSource, /_onRollAtributoDharma/);
});

test("el CSS usa un componente compartido y conserva la jerarquía vertical", () => {
  assert.match(css, /\.mtrol-dharma-action\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*1fr/s);
  assert.match(css, /\.mtrol-dharma-action \.mtrol-dharma-prepare/);
  assert.match(css, /\.mtrol-dharma-action \.mtrol-action-execute/);
  assert.match(css, /data-mtrol-dharma-prepared="true"/);
  assert.doesNotMatch(css, /mtrol-dharma-burn-atributo/);
});
