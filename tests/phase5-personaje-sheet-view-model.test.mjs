import test from "node:test";
import assert from "node:assert/strict";

Math.clamp ??= (value, min, max) => Math.min(max, Math.max(min, value));

const {
  calcularPorcentajeVital,
  esHabilidadBarraCombate,
  formulaCompetenciaPorNivel,
  getCombatBanner,
  getSafeImageSrc,
  prepareProgressionEvaluationForSheet
} = await import("../scripts/sheets/actors/personaje-sheet-view-model.js");

test("view model de progresión transforma labels y selección sin mutar evaluación", () => {
  const evaluation = {
    eligible: false,
    requirements: [
      { key: "mvp", current: 2, required: 3, met: false },
      { key: "dmApproval", current: false, required: true, met: true }
    ]
  };
  const result = prepareProgressionEvaluationForSheet(evaluation, "dmApproval");
  assert.equal(result.requirements[0].label, "MVP");
  assert.equal(result.requirements[0].valueText, "2 / 3");
  assert.equal(result.requirements[1].selected, true);
  assert.equal(result.selectedRequirement.key, "dmApproval");
  assert.equal(evaluation.requirements[1].selected, undefined);
});

test("view model conserva fórmulas legacy por nivel", () => {
  assert.equal(formulaCompetenciaPorNivel(1), "1d4 + 1");
  assert.equal(formulaCompetenciaPorNivel(5), "1d12 + 5");
  assert.equal(formulaCompetenciaPorNivel(99), "1d4 + 1");
});

test("imágenes inválidas usan fallback y banners default no se presentan como custom", () => {
  assert.equal(getSafeImageSrc("", "fallback.webp"), "fallback.webp");
  assert.equal(getSafeImageSrc(" custom.webp ", "fallback.webp"), "custom.webp");
  assert.equal(getCombatBanner({ id: "i", img: "icons/svg/item-bag.svg" }, "fallback.webp"), "fallback.webp");
});

test("vitales y clasificación de barra son sólo presentación", () => {
  assert.equal(calcularPorcentajeVital({ value: 5, max: 20 }), 25);
  assert.equal(calcularPorcentajeVital({ value: 5, max: 0 }), 0);
  assert.equal(esHabilidadBarraCombate({ type: "competencia", system: { categoria: "combate" } }), true);
  assert.equal(esHabilidadBarraCombate({ type: "objeto", system: { categoria: "combate" } }), false);
});

