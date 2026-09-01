import test from "node:test";
import assert from "node:assert/strict";

globalThis.CONST = { GRID_TYPES: { SQUARE: 1 } };

const {
  evaluateAttributeFollowUpTarget,
  getEnemiesInAttackRange,
  isAttributeFollowUpAttack,
  resolveAttributeMovementFollowUp
} = await import("../scripts/combat/follow-up-policy.js");

function fixture() {
  const scene = { grid: { type: 1, size: 100 }, tokens: [] };
  const actor = { uuid: "Actor.a", id: "a", system: { identidad: { classId: "guerrero" } } };
  const enemyActor = { uuid: "Actor.b", id: "b" };
  const source = { uuid: "Token.a", x: 0, y: 0, width: 1, height: 1, disposition: 1, actor, parent: scene };
  const enemy = { uuid: "Token.b", x: 100, y: 100, width: 1, height: 1, disposition: -1, actor: enemyActor, parent: scene };
  const far = { uuid: "Token.c", x: 300, y: 0, width: 1, height: 1, disposition: -1, actor: enemyActor, parent: scene };
  scene.tokens = [source, enemy, far];
  actor.getActiveTokens = () => [source];
  return { scene, actor, source, enemy, far };
}

test("follow-up sólo admite ataques físicos declarados", () => {
  assert.equal(isAttributeFollowUpAttack({ system: { categoria: "combate", actionType: "attack" } }), true);
  assert.equal(isAttributeFollowUpAttack({ system: { categoria: "hechizo", actionType: "attack" } }), false);
  assert.equal(isAttributeFollowUpAttack({ system: { categoria: "combate", actionType: "movement" } }), false);
});

test("policy de clase se resuelve exclusivamente desde class-registry", () => {
  assert.equal(resolveAttributeMovementFollowUp({ system: { identidad: { classId: "guerrero" } } }), "attack-if-in-range");
  assert.equal(resolveAttributeMovementFollowUp({ system: { identidad: { classId: "mago" } } }), "none");
});

test("alcance encuentra sólo enemigos adyacentes y valida target exacto", () => {
  const { actor, source, enemy, far } = fixture();
  const context = { combat: { id: "combat" }, actor, combatant: { token: source } };
  assert.deepEqual(getEnemiesInAttackRange(actor, source, context), [enemy]);
  assert.equal(evaluateAttributeFollowUpTarget({
    actor, targetToken: enemy, context, state: { followUpAttackAvailable: true }
  }).allowed, true);
  assert.equal(evaluateAttributeFollowUpTarget({
    actor, targetToken: far, context, state: { followUpAttackAvailable: true }
  }).allowed, false);
});

