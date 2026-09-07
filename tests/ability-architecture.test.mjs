import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const {
  normalizeAbilityDamageConfig
} = await import("../scripts/actions/ability-config.js");

test("la configuración declarativa de daño conserva defaults legacy contextuales", () => {
  assert.deepEqual(
    normalizeAbilityDamageConfig({
      requiresOpposition: false,
      ejecutaDanio: true
    }),
    {
      executesDamage: true,
      resolution: "onOppositionWin",
      mode: "enabled",
      costType: "none",
      additionalMpCost: 0
    }
  );

  assert.deepEqual(
    normalizeAbilityDamageConfig({
      requiresOpposition: true,
      ejecutaDanio: true
    }),
    {
      executesDamage: true,
      resolution: "onOppositionWin",
      mode: "enabled",
      costType: "none",
      additionalMpCost: 0
    }
  );
});

test("la configuración canónica de Explosión se resuelve sin depender del nombre", () => {
  const configured = normalizeAbilityDamageConfig({
    requiresOpposition: true,
    ejecutaDanio: true,
    damageResolution: "onOppositionWin",
    damageMode: "enabled",
    damageCostType: "basic"
  });

  assert.equal(configured.resolution, "onOppositionWin");
  assert.equal(configured.mode, "enabled");
  assert.equal(configured.additionalMpCost, 1);
});

test("una resolución de daño conserva oposición y lanzamiento manual", () => {
  const configured = normalizeAbilityDamageConfig({
    requiresOpposition: false,
    ejecutaDanio: true,
    damageResolution: "onOppositionWin",
    damageMode: "enabled",
    damageCostType: "basic"
  });

  assert.equal(configured.resolution, "onOppositionWin");
  assert.equal(configured.mode, "enabled");
  assert.equal(configured.additionalMpCost, 1);
});

test("la Item Sheet expone Rol, costo calculado y UI contextual sin Elemento/Rareza", async () => {
  const template = await readFile(
    new URL("../templates/items/competencia-sheet.html", import.meta.url),
    "utf8"
  );

  assert.match(template, /name="system\.rol"/);
  assert.doesNotMatch(template, /name="system\.costeMP"/);
  assert.match(template, /Costo Base/i);
  assert.match(template, /name="system\.damageResolution"/);
  assert.match(template, /name="system\.damageMode"/);
  assert.match(template, /name="system\.damageCostType"/);
  assert.doesNotMatch(template, /name="system\.elemento"/);
  assert.doesNotMatch(template, /name="system\.rareza"/);
});

test("el schema conserva legacy y agrega las dimensiones nuevas con defaults seguros", async () => {
  const schema = await readFile(
    new URL("../models/competencia-model.js", import.meta.url),
    "utf8"
  );

  assert.match(schema, /rol:\s*new fields\.StringField/);
  assert.match(schema, /damageResolution:\s*new fields\.StringField/);
  assert.match(schema, /damageMode:\s*new fields\.StringField/);
  assert.match(schema, /damageCostType:\s*new fields\.StringField/);
  assert.match(schema, /elemento:\s*new fields\.StringField/);
  assert.match(schema, /rareza:\s*new fields\.StringField/);
});
