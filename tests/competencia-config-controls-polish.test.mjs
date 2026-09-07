import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  evaluateOppositionResponseEligibility,
  getOppositionActionDefinition
} from "../scripts/actions/opposition-policy.js";

const template = await readFile(
  new URL("../templates/items/competencia-sheet.html", import.meta.url),
  "utf8"
);
const css = await readFile(
  new URL("../styles/sheets/competencia.css", import.meta.url),
  "utf8"
);

test("los controles conservan nombres, cardinalidad y valores persistentes", () => {
  assert.match(template, /type="checkbox" name="mtrolCapability\.{{value}}"/);
  assert.match(template, /type="radio" name="system\.resolutionResult" value="{{value}}"/);
  assert.match(template, /mtrol-toggle-chip/);
  assert.doesNotMatch(template, /<select name="system\.(capabilities|resolutionResult)"/);
  assert.match(template, /type="checkbox" name="mtrolAllowedResponse\.{{value}}" {{checked selected}}/);
  assert.match(template, /type="radio" name="system\.responseCapability" value="{{value}}"/);
  assert.match(template, /name="mtrolResponseControls"/);
  assert.doesNotMatch(template, /<select name="system\.(allowedResponses|responseCapability)"/);
  assert.doesNotMatch(template, /Capability de respuesta preset|>Automática</);
});

test("selects simples y multiselects comparten una base legible sin overflow horizontal", () => {
  assert.match(css, /\.mtrol-competencia-sheet select\s*\{[\s\S]*?min-height:\s*40px;/);
  assert.match(css, /\.mtrol-competencia-sheet select\s*\{[\s\S]*?font-size:\s*13px;[\s\S]*?line-height:\s*1\.35;/);
  assert.match(css, /select\[multiple\]\s*\{[\s\S]*?max-width:\s*100%;[\s\S]*?overflow-x:\s*hidden;/);
  assert.match(css, /select\[multiple\] option\s*\{[\s\S]*?min-height:\s*30px;[\s\S]*?padding:\s*6px 8px;/);
});

test("el multiselect conserva scrollbar integrado para listas cortas o largas", () => {
  assert.match(css, /scrollbar-width:\s*thin;/);
  assert.match(css, /select\[multiple\]::\-webkit-scrollbar\s*\{[\s\S]*?width:\s*8px;/);
  assert.match(css, /select\[multiple\]::\-webkit-scrollbar-track/);
  assert.match(css, /select\[multiple\]::\-webkit-scrollbar-thumb/);
  assert.doesNotMatch(css, /select\[multiple\][^{]*\{[^}]*overflow-y:\s*hidden;/);
});

test("capabilities, allowedResponses y preset mantienen contratos independientes", () => {
  const responseItem = {
    id: "response",
    uuid: "Actor.defender.Item.response",
    type: "competencia",
    system: {
      capabilities: ["DEFENSE", "DODGE", "REACTION"],
      allowedResponses: ["COUNTERATTACK"],
      responseCapability: "DODGE"
    }
  };
  const original = structuredClone(responseItem.system);
  const definition = getOppositionActionDefinition(responseItem);

  assert.deepEqual(definition.capabilities, ["DEFENSE", "DODGE", "REACTION"]);
  assert.deepEqual(definition.allowedResponses, ["COUNTERATTACK"]);
  assert.deepEqual(responseItem.system, original);

  const result = evaluateOppositionResponseEligibility({
    pendingAction: {
      id: "pending",
      status: "waiting-defense",
      targetActorId: "defender",
      targetActorUuid: "Actor.defender",
      actionDomain: "PHYSICAL",
      allowedResponses: ["DODGE"]
    },
    actor: {
      id: "defender",
      uuid: "Actor.defender",
      system: { identidad: { classId: "guerrero" } }
    },
    item: responseItem,
    guard: { allowed: true, reactive: true, opposition: { id: "pending" } }
  });

  assert.equal(result.valid, true);
  assert.equal(result.selectedCapability, "DODGE");
  assert.deepEqual(responseItem.system, original);
});
