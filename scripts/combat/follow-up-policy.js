import { getAttributeMovementFollowUpForClass } from "../actors/class-registry.js";
import { measureSquareGridTokenDistance } from "../trade/trade-proximity-service.js";

function sameActor(actor, actorUuid) {
  return Boolean(actor && actorUuid && (actor.uuid === actorUuid || actor.id === actorUuid));
}

function documentValues(collection) {
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection?.contents)) return collection.contents;
  if (typeof collection?.values === "function") return Array.from(collection.values());
  return Array.from(collection ?? []);
}

export function tokenDocument(value) {
  return value?.document ?? value ?? null;
}

export function getActorTurnToken(actor, context = {}) {
  if (!actor) return null;
  if (sameActor(context.actor, actor.uuid)) {
    const combatToken = tokenDocument(context.combatant?.token);
    if (combatToken) return combatToken;
    const sceneToken = context.combatant?.tokenId
      ? context.combat?.scene?.tokens?.get?.(context.combatant.tokenId) ??
        globalThis.canvas?.scene?.tokens?.get?.(context.combatant.tokenId)
      : null;
    if (sceneToken) return tokenDocument(sceneToken);
  }
  return tokenDocument(actor.getActiveTokens?.()[0]);
}

function tokenDisposition(token) {
  const value = Number(tokenDocument(token)?.disposition);
  return Number.isFinite(value) ? value : null;
}

export function tokensAreEnemies(sourceToken, targetToken) {
  const source = tokenDisposition(sourceToken);
  const target = tokenDisposition(targetToken);
  return source !== null && target !== null && source !== 0 && target !== 0 && source * target < 0;
}

function tokensInScene(token) {
  const document = tokenDocument(token);
  return documentValues(document?.parent?.tokens ?? globalThis.canvas?.scene?.tokens)
    .map(tokenDocument)
    .filter(Boolean);
}

export function isTokenAtMeleeRange(sourceToken, targetToken) {
  const source = tokenDocument(sourceToken);
  const target = tokenDocument(targetToken);
  if (!source || !target || source.parent !== target.parent) return false;
  const squareType = globalThis.CONST?.GRID_TYPES?.SQUARE ?? 1;
  const gridType = Number(source.parent?.grid?.type ?? squareType);
  if (gridType !== squareType) return false;
  const size = Number(source.parent?.grid?.size ?? globalThis.canvas?.grid?.size ?? 0);
  return Number.isFinite(size) && size > 0 &&
    measureSquareGridTokenDistance(source, target, { size }) <= 1;
}

export function getEnemiesInAttackRange(actor, token = null, context = {}) {
  const sourceToken = tokenDocument(token) ?? getActorTurnToken(actor, context);
  if (!sourceToken) return [];
  return tokensInScene(sourceToken).filter(candidate =>
    candidate.uuid !== sourceToken.uuid &&
    !sameActor(candidate.actor, actor?.uuid) &&
    tokensAreEnemies(sourceToken, candidate) &&
    isTokenAtMeleeRange(sourceToken, candidate)
  );
}

export function isAttributeFollowUpAttack(item) {
  return item?.system?.categoria !== "hechizo" &&
    ["attack", "basicAttack", "combatSkill"].includes(item?.system?.actionType);
}

export function resolveAttributeMovementFollowUp(actor) {
  return getAttributeMovementFollowUpForClass(actor?.system?.identidad?.classId);
}

export function evaluateAttributeFollowUpTarget({ actor, targetToken, context = {}, state = {} } = {}) {
  if (!context.combat || !sameActor(context.actor, actor?.uuid) || !state.followUpAttackAvailable) {
    return { allowed: true, reason: null };
  }
  const sourceToken = getActorTurnToken(actor, context);
  const target = tokenDocument(targetToken);
  if (!target || !tokensAreEnemies(sourceToken, target) || !isTokenAtMeleeRange(sourceToken, target)) {
    return {
      allowed: false,
      reason: "El ataque posterior al movimiento debe dirigirse a un enemigo a alcance válido."
    };
  }
  return { allowed: true, reason: null };
}

