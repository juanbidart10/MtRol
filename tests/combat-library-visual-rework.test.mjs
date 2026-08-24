import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildCombatLibraryViewModel,
  classifyCombatActionNature,
  prepareCombatLibraryAction
} from "../scripts/combat/combat-library-view-model.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const template = await readFile(
  resolve(projectRoot, "templates/actors/personaje-sheet.html"),
  "utf8"
);
const style = await readFile(
  resolve(projectRoot, "styles/combat/combat-tab.css"),
  "utf8"
);
const premiumStyle = await readFile(
  resolve(projectRoot, "styles/sheets/personaje-premium.css"),
  "utf8"
);
const sheetSource = await readFile(
  resolve(projectRoot, "scripts/sheets/actors/personaje-sheet.js"),
  "utf8"
);

function action(id, {
  categoria = "combate",
  damageType = null,
  mp = 0,
  cooldown = 0,
  stackable = false,
  stack = 0
} = {}) {
  return {
    id,
    name: `Acción ${id}`,
    system: { categoria, damageType, cooldown },
    mtrolMpCost: mp,
    mtrolMpStackable: stackable,
    mtrolMpStack: stack
  };
}

test("la naturaleza usa damageType explícito y categoría hechizo sin inferir por nombre", () => {
  assert.equal(classifyCombatActionNature(action("spell", { categoria: "hechizo" })), "magical");
  assert.equal(classifyCombatActionNature(action("magic-damage", { damageType: "magical" })), "magical");
  assert.equal(classifyCombatActionNature(action("physical-spell", {
    categoria: "hechizo",
    damageType: "physical"
  })), "physical");
  assert.equal(classifyCombatActionNature({
    name: "Tormenta Arcana",
    system: { categoria: "combate" }
  }), "physical");
});

test("presentación omite MP/CD sin significado y expone stack autoritativo incluso en cero", () => {
  const quiet = prepareCombatLibraryAction(action("quiet"));
  assert.equal(quiet.mtrolShowMeta, false);
  assert.equal(quiet.mtrolShowMp, false);
  assert.equal(quiet.mtrolShowCooldown, false);
  assert.equal(quiet.mtrolShowStack, false);

  const mechanical = prepareCombatLibraryAction(action("mechanical", {
    mp: 3,
    cooldown: 2,
    stackable: true,
    stack: 0
  }));
  assert.equal(mechanical.mtrolShowMeta, true);
  assert.equal(mechanical.mtrolMpCost, 3);
  assert.equal(mechanical.mtrolCooldown, 2);
  assert.equal(mechanical.mtrolShowStack, true);
  assert.equal(mechanical.mtrolStack, 0);
});

test("ViewModel conserva naturaleza mecánica y expone una colección visual unificada", () => {
  const actions = Array.from({ length: 18 }, (_value, index) => action(
    String(index),
    { categoria: index % 3 === 0 ? "hechizo" : "combate" }
  ));
  const view = buildCombatLibraryViewModel(actions);

  assert.equal(view.groups.length, 2);
  assert.equal(view.magicalActions.length, 6);
  assert.equal(view.physicalActions.length, 12);
  assert.equal(view.actions.length, 18);
  assert.deepEqual(view.actions.map(entry => entry.id), actions.map(entry => entry.id));
  assert.deepEqual(view.groups.map(group => group.label), ["MÁGICAS", "FÍSICAS"]);
  assert.equal(view.empty, false);

  const physicalOnly = buildCombatLibraryViewModel([action("one")]);
  assert.deepEqual(physicalOnly.groups.map(group => group.id), ["physical"]);
  assert.equal(buildCombatLibraryViewModel([]).empty, true);
});

test("template usa biblioteca premium, navegación textual y Barra administrativa GM", () => {
  const combatTab = template.match(
    /<div class="tab mtrol-tab-combate"[\s\S]*?<!-- TAB COMPETENCIAS -->/
  )?.[0] ?? "";
  const navigation = template.match(
    /<nav class="sheet-tabs tabs mtrol-main-tabs"[\s\S]*?<\/nav>/
  )?.[0] ?? "";

  assert.equal((navigation.match(/<a class="item" data-tab=/g) ?? []).length, 5);
  assert.doesNotMatch(navigation, /<img|mtrol-tab-icon/);
  assert.match(combatTab, /{{#each combatLibrary\.actions}}/);
  assert.doesNotMatch(combatTab, /mtrol-combat-group|MÁGICAS|FÍSICAS/);
  assert.match(combatTab, /class="mtrol-combat-card-artwork"/);
  assert.match(combatTab, /class="mtrol-combat-card-artwork-gradient"/);
  assert.match(combatTab, /class="mtrol-combat-card-content"/);
  assert.match(combatTab, /class="mtrol-combat-card-frame"/);
  assert.match(combatTab, />Ejecutar<\/button>/);
  assert.match(combatTab, />Quemar Dharma<\/span>/);
  assert.doesNotMatch(combatTab, />Combate<\/h2>|Ver detalle/);
  assert.match(combatTab, /{{#if esGM}}[\s\S]*?Barra de Combate/);
  assert.match(combatTab, /combat-skills-bar/);
  assert.doesNotMatch(combatTab, /mtrol-combat-card-school|mtrol-combat-card-level/);
});

test("CSS conserva proporciones y limita fluidamente el tamaño de las cards", () => {
  assert.match(style, /grid-template-columns:\s*repeat\(auto-fit, minmax\(150px, 200px\)\)/);
  assert.match(style, /@container mtrol-combat-library \(max-width: 760px\)[\s\S]*?repeat\(auto-fit, minmax\(145px, 190px\)\)/);
  assert.match(style, /@container mtrol-combat-library \(max-width: 480px\)[\s\S]*?repeat\(auto-fit, minmax\(138px, 180px\)\)/);
  assert.match(style, /@container mtrol-sheet \(max-height: 780px\)[\s\S]*?max-width:\s*175px/);
  assert.match(style, /\.mtrol-personaje-sheet \.mtrol-combat-card\s*\{[\s\S]*?aspect-ratio:\s*910 \/ 1464/);
  assert.match(style, /\.mtrol-personaje-sheet \.mtrol-combat-card\s*\{[\s\S]*?width:\s*100%/);
  assert.match(style, /\.mtrol-personaje-sheet \.mtrol-combat-card\s*\{[\s\S]*?max-width:\s*200px/);
  assert.match(style, /\.mtrol-tab-combate :is\([\s\S]*?text-decoration:\s*none !important/);
  assert.match(style, /\.mtrol-combat-card-name\s*\{[\s\S]*?font-family:[^;]*Morpheus[\s\S]*?linear-gradient/);
  assert.match(style, /\.mtrol-combat-card-artwork-image\s*\{[\s\S]*?object-fit:\s*cover/);
  assert.match(style, /\.mtrol-combat-card-frame\s*\{[\s\S]*?object-fit:\s*contain[\s\S]*?pointer-events:\s*none/);
  assert.match(style, /transparent 48%[\s\S]*?rgba\(4, 4, 6, \.58\) 77%[\s\S]*?#030305 100%/);
  assert.doesNotMatch(style, /transform:\s*scale\([^\)]*\)\s*;[^}]*\.mtrol-combat-grid/);
});

test("botones usan assets extraídos y Dharma reacciona al estado efímero real", () => {
  for (const asset of [
    "combat-card-frame.png",
    "combat-dharma-inactive.png",
    "combat-execute-normal.png",
    "combat-execute-hover.png",
    "combat-execute-active.png"
  ]) {
    assert.match(`${style}\n${template}`, new RegExp(asset.replace(".", "\\.")));
  }

  assert.match(style, /data-mtrol-dharma-prepared="true"[\s\S]*?sepia\(1\)/);
  assert.match(sheetSource, /control\.dataset\.mtrolDharmaPrepared = context \? "true" : "false"/);
  assert.match(sheetSource, /button\?\.setAttribute\?\.\("aria-pressed", context \? "true" : "false"\)/);
  assert.match(sheetSource, /isCombatAction[\s\S]*?"Quemar Dharma"/);
});

test("assets finales conservan PNG RGBA y dimensiones fuente", async () => {
  const expected = new Map([
    ["combat-card-frame.png", [910, 1464]],
    ["combat-dharma-inactive.png", [900, 226]],
    ["combat-execute-normal.png", [900, 226]],
    ["combat-execute-hover.png", [900, 226]],
    ["combat-execute-active.png", [900, 226]]
  ]);

  for (const [name, [width, height]] of expected) {
    const png = await readFile(resolve(projectRoot, "assets/ui/combat", name));
    assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
    assert.equal(png.readUInt32BE(16), width);
    assert.equal(png.readUInt32BE(20), height);
    assert.ok([4, 6].includes(png[25]), `${name} debe conservar canal alpha`);
  }
});

test("PersonajeSheet reutiliza coste/stack existentes y navegación ocupa cinco columnas", () => {
  assert.match(sheetSource, /const mpCost = calcularConsumoMP\(actor, item\)/);
  assert.match(sheetSource, /mtrolMpStackable:\s*mpCost\.stackea === true/);
  assert.match(sheetSource, /mtrolMpStack:\s*mpCost\.stackAnterior/);
  assert.match(sheetSource, /context\.combatLibrary = buildCombatLibraryViewModel/);
  assert.doesNotMatch(sheetSource, /maxActions/);
  assert.match(premiumStyle, /grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(premiumStyle, /\.mtrol-personaje-sheet \.mtrol-tab-icon/);
});
