import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { prepareFiveSegmentResource } from "../scripts/ui/resource-segments.js";

const templatePath = new URL("../templates/actors/personaje-sheet.html", import.meta.url);
const sheetPath = new URL("../scripts/sheets/actors/personaje-sheet.js", import.meta.url);
const stylePath = new URL("../styles/sheets/personaje-premium.css", import.meta.url);
const entryStylePath = new URL("../styles/mtrol.css", import.meta.url);

const assetPaths = [
  "backgrounds/bg-personaje-main.webp",
  "backgrounds/bg-personaje-dim.webp",
  "portrait/portrait-frame-runtime.webp",
  "portrait/portrait-frame-master.png",
  "header/name-divider-top.png",
  "header/name-divider-bottom.png",
  "resources/hp-frame.png",
  "resources/mp-frame.png",
  "resources/hp-icon.png",
  "resources/mp-icon.png",
  "resources/karma-dharma-5-segment-guide.png",
  "tabs/runtime/personaje-48.webp",
  "tabs/runtime/combate-48.webp",
  "tabs/runtime/competencias-48.webp",
  "tabs/runtime/equipamiento-48.webp",
  "tabs/runtime/inventario-48.webp",
  "tabs/runtime/progresion-48.webp"
];

test("the Personaje premium package exposes every approved stable asset", async () => {
  await Promise.all(assetPaths.map(relativePath => access(
    new URL(`../assets/ui/personaje-premium/${relativePath}`, import.meta.url)
  )));
});

test("the shared navigation exposes the unified five-route architecture", async () => {
  const template = await readFile(templatePath, "utf8");
  const tabs = [...template.matchAll(/<a class="item" data-tab="([^"]+)"/g)]
    .map(match => match[1]);

  assert.deepEqual(tabs, [
    "personaje",
    "combate",
    "competencias",
    "inventario",
    "progresion"
  ]);
});

test("all five sheet sections share the Personaje premium background", async () => {
  const style = await readFile(stylePath, "utf8");
  const sharedBackground = style.match(/\.mtrol-sheet-body-v2 > :is\([\s\S]*?\)\s*\{[\s\S]*?bg-personaje-main\.webp[\s\S]*?\}/)?.[0] ?? "";

  for (const tabClass of [
    "mtrol-tab-personaje",
    "mtrol-tab-combate",
    "mtrol-tab-competencias",
    "mtrol-tab-inventario",
    "mtrol-tab-progresion"
  ]) {
    assert.ok(sharedBackground.includes(`.${tabClass}`), `missing shared background for ${tabClass}`);
  }

  assert.match(sharedBackground, /center \/ cover fixed no-repeat !important/);
});

test("portrait particles are active while destiny effects expose dormant semantic hooks", async () => {
  const template = await readFile(templatePath, "utf8");
  const style = await readFile(stylePath, "utf8");

  assert.match(template, /mtrol-particle-field--portrait mtrol-particle-field--gold is-active/);
  assert.equal((template.match(/class="mtrol-particle"/g) ?? []).length, 25);
  assert.match(template, /data-mtrol-particle-target="dharma"[\s\S]*?data-mtrol-particle-trigger="critical-counter-change"/);
  assert.match(template, /data-mtrol-particle-target="karma"[\s\S]*?data-mtrol-particle-trigger="fumble-counter-change"/);
  assert.match(style, /@keyframes mtrolPortraitParticleFloat/);
  assert.match(style, /@keyframes mtrolPortraitParticleRush/);
  assert.match(style, /\.mtrol-particle-field--portrait \.mtrol-particle\s*\{[\s\S]*?animation-duration:\s*2\.05s/);
  assert.match(style, /\.mtrol-particle-field--event:not\(\.is-active\) \.mtrol-particle/);
  assert.doesNotMatch(template, /mtrol-particle-field--event[^\n]*is-active/);
});

test("Karma and Dharma render five data-driven segments without changing actor data", async () => {
  const template = await readFile(templatePath, "utf8");
  const sheet = await readFile(sheetPath, "utf8");

  assert.match(sheet, /context\.mtrolKarmaDisplay = prepareFiveSegmentResource/);
  assert.match(sheet, /context\.mtrolDharmaDisplay = prepareFiveSegmentResource/);
  assert.match(template, /#each mtrolKarmaDisplay\.segments/);
  assert.match(template, /#each mtrolDharmaDisplay\.segments/);
  assert.match(template, /data-resource="{{resource}}" data-value="{{value}}"/);
  assert.match(sheet, /setActorSpiritualResource/);
  assert.match(sheet, /requestedValue === currentValue[\s\S]*?Math\.max\(0, requestedValue - 1\)/);
  assert.match(sheet, /\.mtrol-destiny-segment\.is-editable\[data-resource\]\[data-value\]/);
  assert.doesNotMatch(sheet, /actor\.update\([^)]*(karma|dharma)/is);
});

test("the five-segment model maps every supported Karma/Dharma value exactly", () => {
  for (let value = 0; value <= 5; value++) {
    const display = prepareFiveSegmentResource(value);
    assert.equal(display.value, value);
    assert.equal(display.segments.length, 5);
    assert.equal(display.segments.filter(segment => segment.active).length, value);
    assert.deepEqual(display.segments.map(segment => segment.position), [1, 2, 3, 4, 5]);
    assert.deepEqual(display.segments.map(segment => segment.value), [1, 2, 3, 4, 5]);
  }

  const editable = prepareFiveSegmentResource(2, { resource: "karma", editable: true });
  assert.equal(editable.segments.every(segment => segment.resource === "karma"), true);
  assert.deepEqual(editable.segments.map(segment => segment.editable), [true, true, true, true, false]);

  assert.equal(prepareFiveSegmentResource(-1).value, 0);
  assert.equal(prepareFiveSegmentResource(6).value, 5);
});

test("functional portrait, vital, attribute, Dharma and identity hooks remain present", async () => {
  const template = await readFile(templatePath, "utf8");

  for (const contract of [
    'class="profile-img"',
    'data-edit="img"',
    'class="mtrol-vital-field"',
    'data-vital="hp"',
    'data-vital="mp"',
    'class="mtrol-dharma-prepare"',
    'mtrol-roll-atributo',
    'data-mtrol-action-key="attribute:',
    'name="system.identidad.titulo"',
    'name="system.identidad.raza"',
    'name="system.identidad.profesion"',
    'name="system.identidad.maestria"',
    'name="system.identidad.edad"'
  ]) {
    assert.ok(template.includes(contract), `missing functional contract: ${contract}`);
  }
});

test("the corrective sheet sizing docks each fresh open at the left edge", async () => {
  const sheet = await readFile(sheetPath, "utf8");

  assert.match(sheet, /MTROL_PERSONAJE_INITIAL_WIDTH = 700/);
  assert.match(sheet, /MTROL_PERSONAJE_MIN_WIDTH = 480/);
  assert.match(sheet, /MTROL_PERSONAJE_MIN_HEIGHT = 520/);
  assert.match(sheet, /left:\s*0/);
  assert.match(sheet, /querySelector\?\.\("#ui-top"\)/);
  assert.match(sheet, /height:\s*Math\.max\([\s\S]*?viewportHeight - top - MTROL_PERSONAJE_VIEWPORT_GAP/);
  assert.match(sheet, /render\(force = false, options = \{\}\)[\s\S]*?if \(!this\.rendered\)/);
  assert.match(sheet, /minWidth:\s*MTROL_PERSONAJE_MIN_WIDTH/);
  assert.match(sheet, /resizable:\s*true/);
});

test("HP and MP use the MP geometry as their sole clipped ornamental frame", async () => {
  const template = await readFile(templatePath, "utf8");
  const style = await readFile(stylePath, "utf8");
  const sheet = await readFile(sheetPath, "utf8");

  assert.equal((template.match(/class="mtrol-vital-bar resource-bar"/g) ?? []).length, 2);
  assert.equal((template.match(/class="mtrol-vital-track resource-bar__track"/g) ?? []).length, 2);
  assert.equal((template.match(/resource-bar__fill/g) ?? []).length, 2);
  assert.equal((template.match(/class="mtrol-vital-frame resource-bar__frame"/g) ?? []).length, 2);
  assert.equal((template.match(/resources\/mp-frame\.png/g) ?? []).length, 2);
  assert.doesNotMatch(template, /resources\/hp-frame\.png/);
  assert.equal((template.match(/class="mtrol-vital-icon-image"/g) ?? []).length, 2);
  assert.match(template, /personaje-premium\/resources\/hp-icon\.png/);
  assert.match(template, /personaje-premium\/resources\/mp-icon\.png/);
  assert.doesNotMatch(template, /<div class="mtrol-vital-icon">(?:&hearts;|&diams;)/);
  assert.match(style, /\.mtrol-vital-icon\s*\{[\s\S]*?width:\s*38px;[\s\S]*?height:\s*38px;[\s\S]*?overflow:\s*hidden/);
  assert.match(style, /\.mtrol-vital-icon-image\s*\{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;[\s\S]*?object-fit:\s*contain/);
  assert.match(style, /\.mtrol-vital-content\s*\{[\s\S]*?display:\s*contents/);
  assert.match(style, /\.mtrol-vital-top\s*\{[\s\S]*?justify-content:\s*center;[\s\S]*?gap:\s*7px/);
  assert.match(style, /\.mtrol-vital-top label,[\s\S]*?\.mtrol-vital-current input\.mtrol-vital-field\s*\{[\s\S]*?color:\s*#cfb46f;[\s\S]*?font-size:\s*12px/);
  assert.match(style, /\.resource-bar\s*\{[\s\S]*?aspect-ratio:\s*512 \/ 128;[\s\S]*?background:\s*transparent/);
  assert.match(style, /\.resource-bar::after\s*\{[\s\S]*?content:\s*none;[\s\S]*?display:\s*none/);
  assert.match(style, /\.resource-bar__track\s*\{[\s\S]*?inset:\s*19\.5% 18% 34%;[\s\S]*?overflow:\s*hidden;[\s\S]*?background:\s*transparent/);
  assert.match(style, /\.resource-bar__frame\s*\{[\s\S]*?z-index:\s*2;[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%/);
  assert.match(style, /width:\s*clamp\(0%,\s*var\(--mtrol-vital-percent, 0%\),\s*100%\)/);
  assert.match(style, /\.resource-bar__fill\.hp-fill\s*\{[\s\S]*?#4b2025[\s\S]*?#351217/);
  assert.match(style, /\.resource-bar__fill\.mp-fill\s*\{[\s\S]*?#172d45[\s\S]*?#0d2033/);
  assert.match(sheet, /Math\.clamp\(\(value \/ max\) \* 100, 0, 100\)/);

  const visualPercentage = (current, max) => max <= 0
    ? 0
    : Math.min(Math.max((current / max) * 100, 0), 100);

  for (const [resource, max, values] of [
    ["HP", 65, [0, 1, 32, 64, 65]],
    ["MP", 40, [0, 1, 20, 39, 40]]
  ]) {
    for (const current of values) {
      assert.equal(
        visualPercentage(current, max),
        (current / max) * 100,
        `${resource} ${current}/${max}`
      );
    }
  }
});

test("Gastar Dharma has gold normal, hover, and disabled states", async () => {
  const style = await readFile(stylePath, "utf8");

  assert.match(style, /\.mtrol-dharma-prepare\s*\{[\s\S]*?background:\s*linear-gradient\(180deg, #c9a65f/);
  assert.match(style, /\.mtrol-dharma-prepare:hover:not\(:disabled\)[\s\S]*?background:\s*linear-gradient\(180deg, #d8b872/);
  assert.match(style, /\.mtrol-dharma-prepare:disabled\s*\{[\s\S]*?background:\s*linear-gradient\(180deg, #9d8552[\s\S]*?opacity:\s*\.55/);
  assert.match(style, /\.mtrol-action-execute\s*\{[\s\S]*?background:\s*linear-gradient\(180deg, rgba\(113, 29, 34, \.86\), rgba\(55, 12, 16, \.9\)\)/);
});

test("attributes form one ordered 3 by 3 visual grid without category headings", async () => {
  const template = await readFile(templatePath, "utf8");
  const style = await readFile(stylePath, "utf8");

  assert.equal((template.match(/class="atributo mtrol-attribute-card"/g) ?? []).length, 9);
  assert.match(style, /\.mtrol-personaje-sheet \.mtrol-atributos-premium\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3/);
  assert.match(style, /\.mtrol-personaje-sheet \.mtrol-attribute-group\s*\{\s*display:\s*contents/);
  assert.match(style, /\.mtrol-personaje-sheet \.mtrol-attribute-group-header\s*\{\s*display:\s*none/);
});

test("header, tabs and the active tab maintain the fixed-shell scroll contract", async () => {
  const style = await readFile(stylePath, "utf8");

  assert.match(style, /grid-template-columns:\s*165px minmax\(0, 1fr\)/);
  assert.match(style, /\.mtrol-personaje-sheet \.mtrol-hero-portrait\s*\{[\s\S]*?width:\s*165px;[\s\S]*?height:\s*165px/);
  assert.match(style, /\.mtrol-personaje-sheet \.mtrol-main-tabs\s*\{[\s\S]*?grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(style, /\.mtrol-personaje-sheet \.mtrol-main-tabs \.item\s*\{[\s\S]*?min-height:\s*60px/);
  assert.doesNotMatch(style, /\.mtrol-personaje-sheet \.mtrol-tab-icon/);
  assert.match(style, /\.mtrol-personaje-sheet \.mtrol-sheet-body-v2\s*\{[\s\S]*?overflow:\s*hidden/);
  assert.match(style, /\.mtrol-personaje-sheet \.mtrol-sheet-body-v2 > \.tab\.active\s*\{[\s\S]*?overflow-y:\s*auto/);
});

test("the MVP stylesheet is scoped, tokenized and loaded last", async () => {
  const style = await readFile(stylePath, "utf8");
  const entryStyle = await readFile(entryStylePath, "utf8");
  const template = await readFile(templatePath, "utf8");

  for (const token of [
    "--mtrol-gold:",
    "--mtrol-gold-muted:",
    "--mtrol-crimson:",
    "--mtrol-bg:",
    "--mtrol-panel:",
    "--mtrol-border:",
    "--mtrol-text:",
    "--mtrol-muted:"
  ]) {
    assert.ok(style.includes(token), `missing token: ${token}`);
  }

  assert.match(style, /\.mtrol-personaje-sheet \.mtrol-tab-personaje/);
  assert.match(style, /personaje-premium\/backgrounds\/bg-personaje-main\.webp/);
  assert.match(style, /personaje-premium\/portrait\/portrait-frame-runtime\.webp/);
  assert.equal((template.match(/personaje-premium\/resources\/mp-frame\.png/g) ?? []).length, 2);
  assert.doesNotMatch(template, /personaje-premium\/resources\/hp-frame\.png/);
  assert.ok(
    entryStyle.lastIndexOf('personaje-premium.css') > entryStyle.lastIndexOf('destiny-cards.css'),
    "premium Personaje overrides must load after existing sheet/combat styles"
  );
});
