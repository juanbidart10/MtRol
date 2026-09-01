import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const files = [
  "scripts/actions/action-definition-resolver.js",
  "scripts/actions/action-cooldown-service.js",
  "scripts/actions/pending-action-cache.js",
  "scripts/actions/pending-action-presentation.js",
  "scripts/combat/follow-up-policy.js",
  "scripts/combat/turn-state-repository.js",
  "scripts/combat/turn-advance-service.js",
  "scripts/combat/turn-tracker-adapter.js",
  "scripts/sheets/actors/personaje-item-drag-policy.js",
  "scripts/sheets/actors/personaje-sheet-view-model.js",
  "scripts/sheets/actors/personaje-inventory-controller.js",
  "scripts/sheets/actors/personaje-image-controller.js",
  "scripts/progression/competence-level-service.js"
];

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("nuevos módulos no importan God Objects ni crean ciclos ocultos", async () => {
  for (const path of files) {
    const content = await source(path);
    assert.doesNotMatch(content, /from\s+["'][^"']*personaje-sheet\.js["']/);
    assert.doesNotMatch(content, /from\s+["'][^"']*action-engine\.js["']/);
    if (!path.endsWith("personaje-sheet-view-model.js")) {
      assert.doesNotMatch(content, /from\s+["'][^"']*turn-system\.js["']/);
    }
  }
});

test("PersonajeSheet delega mutaciones documentales de negocio", async () => {
  const sheet = await source("scripts/sheets/actors/personaje-sheet.js");
  assert.doesNotMatch(sheet, /createEmbeddedDocuments|deleteEmbeddedDocuments|await\s+item\.update|await\s+this\.actor\.update/);
  for (const delegation of [
    "createSheetItem", "importDroppedItem", "deleteSheetItem",
    "setCombatBarEquipped", "adjustCompetenceLevel",
    "setPersonajeFullBodyImage", "setCompetenceImage"
  ]) {
    assert.match(sheet, new RegExp(delegation));
  }
});

test("compatibilidad pública y nextTurn invariant permanecen", async () => {
  const [actions, turns, advance] = await Promise.all([
    source("scripts/actions/action-engine.js"),
    source("scripts/combat/turn-system.js"),
    source("scripts/combat/turn-advance-service.js")
  ]);
  assert.match(actions, /resolveActionDefinition as getActionDefinitionFromItem/);
  assert.match(turns, /getActionCooldownStatus as getItemCooldownStatus/);
  assert.equal((`${actions}\n${turns}\n${advance}`.match(/\.nextTurn\(\)/g) ?? []).length, 1);
});

