import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sheetSource = await readFile(new URL("../scripts/sheets/actors/personaje-sheet.js", import.meta.url), "utf8");
const sheetViewModelSource = await readFile(new URL("../scripts/sheets/actors/personaje-sheet-view-model.js", import.meta.url), "utf8");
const templateSource = await readFile(new URL("../templates/actors/personaje-sheet.html", import.meta.url), "utf8");
const styleSource = await readFile(new URL("../styles/sheets/progresion.css", import.meta.url), "utf8");
const variablesSource = await readFile(new URL("../styles/ui/variables.css", import.meta.url), "utf8");

test("descriptor visual conserva todas las claves y prepara un detalle seleccionado", () => {
  for (const key of [
    "mvp", "exp", "missionsCompleted", "dungeonsCompleted", "attributesAtFive",
    "competencesAtLeastThree", "competencesAtFive", "meritCredits",
    "defeatedLevel5Enemy", "dmApproval"
  ]) assert.match(sheetViewModelSource, new RegExp(`${key}:[\\s\\S]*?description:`));

  assert.match(sheetViewModelSource, /selectedRequirement = requirements\.find/);
  assert.match(sheetViewModelSource, /selected:\s*requirement\.key === selectedRequirement/);
});

test("elimina Ruta de ascenso y toda la representación interna de Estado espiritual", () => {
  const progressionTab = templateSource.match(/<div class="tab mtrol-tab-progresion"[\s\S]*?<\/form>/)?.[0] ?? "";

  assert.doesNotMatch(progressionTab, /RUTA DE ASCENSO|Ruta de ascenso/i);
  assert.doesNotMatch(progressionTab, /Estado espiritual|progresion-section--spiritual|progresion-score/i);
  assert.doesNotMatch(progressionTab, /system\.recursos\.(?:karma|dharma|estres|corrupcion)/);
  assert.doesNotMatch(styleSource, /progresion-(?:card--spiritual|card--dharma|card--karma|card--estres|card--corrupcion|score)/);
});

test("existe resumen real con nivel, objetivo y progreso global binario", () => {
  assert.match(templateSource, /class="progresion-summary"/);
  assert.match(templateSource, /Nivel actual[\s\S]*?progressionEvaluation\.level/);
  assert.match(templateSource, /Objetivo[\s\S]*?progressionEvaluation\.nextLevel/);
  assert.match(templateSource, /Progreso global[\s\S]*?progressionEvaluation\.globalProgress\.percent/);
  assert.match(templateSource, /--progresion-global-progress:/);
});

test("workspace mantiene timeline izquierdo y detalle derecho seleccionable", () => {
  assert.match(templateSource, /class="progresion-ascension-workspace"/);
  assert.match(templateSource, /class="progresion-requirements"/);
  assert.match(templateSource, /data-requirement-key="{{key}}"/);
  assert.match(templateSource, /class="progresion-section progresion-requirement-detail"/);
  assert.match(templateSource, /selectedRequirement\.description/);
  assert.match(styleSource, /\.progresion-ascension-workspace\s*\{[\s\S]*?grid-template-columns:/);
  assert.match(styleSource, /\.progresion-requirements::before/);
});

test("panel derecho evita redundancias y reserva el protagonismo gráfico al Orbe", () => {
  const detail = templateSource.match(/<aside class="progresion-section progresion-requirement-detail"[\s\S]*?<\/aside>/)?.[0] ?? "";
  assert.doesNotMatch(detail, /progresion-detail-icon|selectedRequirement\.icon/);
  assert.doesNotMatch(detail, /fa-check|fa-circle/);
  assert.match(detail, /selectedRequirement\.label[\s\S]*?selectedRequirement\.description[\s\S]*?progresion-detail-metrics[\s\S]*?Progreso[\s\S]*?Estado[\s\S]*?progresion-ascension-orb/);
  assert.match(styleSource, /\.progresion-detail-metrics\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styleSource, /\.progresion-ascension-orb\s*\{[\s\S]*?width:\s*clamp\(150px, 17cqi, 180px\)/);
});

test("el Orbe runtime es el único CTA de ascenso y expresa los tres estados", () => {
  const assetPath = "systems/mtrol/assets/ui/progression/orb-arcane/mtrol-orb-arcane-256.png";
  assert.equal((templateSource.match(new RegExp(assetPath, "g")) ?? []).length, 2, "una rama GM y una rama Owner");
  assert.match(templateSource, /class="mtrol-level-up progresion-ascension-orb/);
  assert.match(templateSource, /Completa todos los requisitos para subir de nivel/);
  assert.match(templateSource, /Ascender a Nivel {{progressionEvaluation\.nextLevel}}/);
  assert.match(templateSource, /sólo el GM puede ejecutar el ascenso/);
  assert.match(styleSource, /\.progresion-ascension-orb\.is-ready img/);
  assert.match(styleSource, /prefers-reduced-motion/);
});

test("beneficios, Orbes otorgados y Desarrollo del personaje permanecen", () => {
  assert.match(templateSource, /Beneficios del siguiente nivel/i);
  assert.match(templateSource, /progresion-benefit--attribute[\s\S]*?\+1[\s\S]*?Atributo/);
  assert.match(templateSource, /progresion-benefit--competence[\s\S]*?\+1[\s\S]*?Competencia/);
  assert.match(templateSource, /progresion-benefit--hp[\s\S]*?\+10[\s\S]*?HP m&aacute;x\./);
  assert.match(templateSource, /progresion-benefit--mp[\s\S]*?\+10[\s\S]*?MP m&aacute;x\./);
  assert.match(templateSource, /<h3>Orbes otorgados<\/h3>/);
  assert.match(templateSource, /<h3>Desarrollo del personaje<\/h3>/);
  assert.match(templateSource, /class="progresion-orb-row-icon"/);
  assert.equal((templateSource.match(/placeholder="Sin seleccionar"/g) ?? []).length, 2);
  assert.match(templateSource, /\{\{#each specialAbilitySlots\}\}/);
  assert.match(templateSource, /class="competencia-roll mtrol-special-ability-use"/);
  assert.match(styleSource, /\.progresion-lower-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(260px, 2fr\) minmax\(0, 3fr\)/);
});

test("V2 aumenta jerarquía real sin scale global", () => {
  assert.match(styleSource, /\.progresion-summary-stat:first-child strong\s*\{\s*font-size:\s*38px/);
  assert.match(styleSource, /\.progresion-global-progress\s*\{[\s\S]*?height:\s*12px/);
  assert.match(styleSource, /\.progresion-ascension-workspace\s*\{[\s\S]*?minmax\(300px, \.82fr\) minmax\(340px, 1\.18fr\)/);
  assert.match(styleSource, /\.progresion-requirements li\s*\{[\s\S]*?min-height:\s*66px/);
  assert.match(styleSource, /\.progresion-benefit\s*\{[\s\S]*?min-height:\s*clamp\(72px, 8cqi, 88px\)/);
  assert.doesNotMatch(styleSource, /\.mtrol-tab-progresion\s*\{[^}]*transform:\s*scale/);
});

test("Morpheus, selects y responsive conservan el contrato premium", () => {
  assert.match(variablesSource, /--mtrol-font-title:\s*\n?\s*"Morpheus"/);
  assert.doesNotMatch(styleSource, /@font-face/);
  assert.match(styleSource, /\.mtrol-tab-progresion select\s*\{[\s\S]*?font-family:\s*var\(--mtrol-font-title\)/);
  assert.match(styleSource, /@container mtrol-sheet \(max-width: 760px\)[\s\S]*?\.progresion-ascension-workspace/);
  assert.match(styleSource, /@container mtrol-sheet \(max-width: 520px\)[\s\S]*?\.progresion-benefits-grid/);
});

test("asset del CTA continúa siendo el PNG 256 por 256 aprobado", async () => {
  const png = await readFile(new URL("../assets/ui/progression/orb-arcane/mtrol-orb-arcane-256.png", import.meta.url));
  assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(png.readUInt32BE(16), 256);
  assert.equal(png.readUInt32BE(20), 256);
});
