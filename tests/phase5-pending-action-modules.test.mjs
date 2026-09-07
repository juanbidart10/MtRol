import test from "node:test";
import assert from "node:assert/strict";

globalThis.foundry = { utils: { escapeHTML: value => String(value).replaceAll("<", "&lt;") } };

const { PendingActionCache } = await import("../scripts/actions/pending-action-cache.js");
const { buildResolutionContent } = await import("../scripts/actions/pending-action-presentation.js");

test("PendingActionCache declara estado reconstruible y limpia locks transitorios", () => {
  const cache = new PendingActionCache();
  cache.actions.set("old", { id: "old" });
  cache.resolving.add("old");
  cache.attachingDefense.add("old");
  const values = cache.hydrate([{ id: "persisted", status: "waiting-defense" }]);
  assert.deepEqual(values, [{ id: "persisted", status: "waiting-defense" }]);
  assert.equal(cache.actions.has("old"), false);
  assert.equal(cache.resolving.size, 0);
  assert.equal(cache.attachingDefense.size, 0);
});

test("presentación resuelta deriva controles sin mutar dominio", () => {
  const pending = {
    id: "pending",
    status: "resolved",
    requiresOpposition: true,
    sourceItemName: "Ataque <físico>",
    sourceActorName: "A",
    targetActorName: "B",
    targetActorUuid: "Actor.b",
    winnerResolutionResult: "damage",
    damage: { available: true, rolled: false, status: "available", mode: "enabled" },
    reactionMovement: { status: "available" }
  };
  const snapshot = structuredClone(pending);
  const content = buildResolutionContent(pending, {
    success: true,
    reason: "attacker-higher",
    attackerTotal: 12,
    defenderTotal: 8
  });
  assert.match(content, /mtrol-resolved-damage/);
  assert.match(content, /mtrol-close-reaction-movement/);
  assert.match(content, /Ataque &lt;físico>/);
  assert.deepEqual(pending, snapshot);
});

