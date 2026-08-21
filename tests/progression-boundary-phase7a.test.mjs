import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  isProgressionCompetence
} from "../scripts/progression/progression-competence.js";

import {
  evaluateProgression
} from "../scripts/actors/progression-engine.js";

function makeItem({
  id,
  type = "competencia",
  categoria,
  tipo = "",
  nivel = 5
}) {
  return {
    id,
    type,
    system: { categoria, tipo, nivel }
  };
}

function makeActor(items) {
  return {
    system: {
      recursos: { nivel: 1, exp: 0, mvp: 0 },
      progression: {},
      atributos: {}
    },
    items
  };
}

test("clasificación central acepta sólo Competencias reales", () => {
  assert.equal(isProgressionCompetence(makeItem({
    id: "real",
    categoria: "competencia"
  })), true);
  assert.equal(isProgressionCompetence(makeItem({
    id: "normalized",
    categoria: "  CoMpEtEnCiA  "
  })), true, "la categoría canónica conserva la normalización actual");

  for (const item of [
    makeItem({ id: "spell", categoria: "hechizo" }),
    makeItem({ id: "combat-category", categoria: "combate" }),
    makeItem({ id: "combat-kind", categoria: "competencia", tipo: "habilidad-combate" }),
    makeItem({ id: "passive", categoria: "pasiva" }),
    makeItem({ id: "basic", categoria: "basico" }),
    makeItem({ id: "counter", categoria: "contraataque" }),
    makeItem({ id: "object", type: "objeto", categoria: "competencia" })
  ]) {
    assert.equal(isProgressionCompetence(item), false, item.id);
  }
});

test("legacy ambiguo no se reclasifica ni se infiere por nombre", () => {
  assert.equal(isProgressionCompetence({
    id: "legacy-no-category",
    name: "Atletismo",
    type: "competencia",
    system: { nivel: 4 }
  }), false);
  assert.equal(isProgressionCompetence({
    id: "legacy-empty-category",
    name: "Competencia legendaria",
    type: "competencia",
    system: { categoria: "", nivel: 5 }
  }), false);
  assert.equal(isProgressionCompetence({
    id: "legacy-no-system",
    name: "Competencia",
    type: "competencia"
  }), false);
});

test("progression-engine cuenta Competencias reales y excluye familias ajenas", () => {
  const evaluation = evaluateProgression(makeActor([
    makeItem({ id: "real-three", categoria: "competencia", nivel: 3 }),
    makeItem({ id: "real-five", categoria: "competencia", nivel: 5 }),
    makeItem({ id: "spell-five", categoria: "hechizo", nivel: 5 }),
    makeItem({ id: "combat-five", categoria: "combate", tipo: "habilidad-combate", nivel: 5 }),
    makeItem({ id: "passive-five", categoria: "pasiva", nivel: 5 }),
    makeItem({ id: "legacy-five", categoria: undefined, nivel: 5 })
  ]));

  assert.equal(evaluation.counts.competencesAtLeastThree, 2);
  assert.equal(evaluation.counts.competencesAtFive, 1);
});

test("Sheet y servicio reutilizan el helper para Pending y controles GM", async () => {
  const sheet = await readFile(
    new URL("../scripts/sheets/actors/personaje-sheet.js", import.meta.url),
    "utf8"
  );
  const template = await readFile(
    new URL("../templates/actors/personaje-sheet.html", import.meta.url),
    "utf8"
  );
  const service = await readFile(
    new URL("../scripts/actors/progression-advancement-service.js", import.meta.url),
    "utf8"
  );

  assert.match(sheet, /\.filter\(item => isProgressionCompetence\(item\)\s*&&\s*Number\(item\.system\?\.nivel\)\s*<\s*competenceCap\)/);
  assert.match(sheet, /mtrolIsProgressionCompetence:\s*isProgressionCompetence\(item\)/);
  assert.match(sheet, /if\s*\(!isProgressionCompetence\(item\)\)\s*\{/);
  assert.match(template, /{{#if this\.mtrolIsProgressionCompetence}}[\s\S]*?competencia-down/);
  assert.match(template, /{{#if this\.mtrolIsProgressionCompetence}}[\s\S]*?competencia-up/);
  assert.match(service, /const item = canonicalActor\.items\?\.get\?\.\(itemId\) \?\? null;[\s\S]*?if \(!isProgressionCompetence\(item\)\)/);
});

test("los cuatro selects de Progresión comparten contraste y foco legibles", async () => {
  const template = await readFile(
    new URL("../templates/actors/personaje-sheet.html", import.meta.url),
    "utf8"
  );
  const css = await readFile(
    new URL("../styles/sheets/progresion.css", import.meta.url),
    "utf8"
  );

  for (const selectorClass of [
    "mtrol-pending-attribute-select",
    "mtrol-pending-competence-select",
    "mtrol-orb-type",
    "mtrol-orb-level"
  ]) {
    assert.match(template, new RegExp(`class="[^"]*${selectorClass}`));
  }
  assert.match(css, /\.mtrol-tab-progresion select\s*\{[\s\S]*?color:[\s\S]*?background:/);
  assert.match(css, /\.mtrol-tab-progresion select:focus\s*\{[\s\S]*?outline:/);
  assert.match(css, /\.mtrol-tab-progresion select option\s*\{[\s\S]*?color:[\s\S]*?background:/);
});

test("Orbes otorgados conserva naming y pulido visual mínimo", async () => {
  const registry = await readFile(
    new URL("../scripts/progression/orb-registry.js", import.meta.url),
    "utf8"
  );
  const template = await readFile(
    new URL("../templates/actors/personaje-sheet.html", import.meta.url),
    "utf8"
  );
  const css = await readFile(
    new URL("../styles/sheets/progresion.css", import.meta.url),
    "utf8"
  );

  assert.match(registry, /id:\s*"ignis"[\s\S]*?name:\s*"Ignis"/);
  assert.match(template, /class="progresion-orb-empty"/);
  assert.match(css, /\.progresion-orb-main,[\s\S]*?\.progresion-orb-add\s*\{[\s\S]*?align-items:\s*center/);
  assert.match(css, /\.progresion-orb-empty\s*\{[\s\S]*?text-align:\s*center/);
});
