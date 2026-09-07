import { createEffectContext } from "../effects/effect-context.js";
import { resolveEffects } from "../effects/effect-resolver.js";
import {
  MTROL_EFFECT_PHASES,
  MTROL_EFFECT_TYPES
} from "../effects/effect-types.js";
import { resolveActivePassives } from "../effects/passive-assignment-resolver.js";
import { getRacialPassiveDefinition } from "../races/racial-passive-catalog.js";
import { runActorResourceTransaction } from "./actor-resource-service.js";
import { preUpdateActorDispatcher } from "../core/hook-dispatcher.js";

export const MTROL_BASE_AWAKENING_CAPACITY = 1;
export const AWAKENING_INTERNAL_UPDATE_OPTION = "mtrolAwakeningTransition";

function actorWithRaceOverride(actor, raceIdOverride) {
  if (!raceIdOverride) return actor;
  return {
    ...actor,
    system: {
      ...(actor?.system ?? {}),
      identidad: { ...(actor?.system?.identidad ?? {}), raceId: raceIdOverride }
    }
  };
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function levelOf(actor) {
  const level = Number(actor?.system?.recursos?.nivel ?? 1);
  return Number.isInteger(level) && level >= 1 ? level : 1;
}

export function resolveAwakeningCapacity(actor, { raceIdOverride = null } = {}) {
  return resolveEffects(createEffectContext({
    phase: MTROL_EFFECT_PHASES.AWAKENING_CAPACITY_POLICY,
    sourceActor: actorWithRaceOverride(actor, raceIdOverride),
    policyValue: MTROL_BASE_AWAKENING_CAPACITY,
    metadata: { raceIdOverride }
  }));
}

export function getEffectiveAwakeningCapacity(actor, options = {}) {
  return resolveAwakeningCapacity(actor, options).value;
}

export function getDerivedAwakeningGrants(actor, {
  raceIdOverride = null,
  grantedBy = "system",
  grantedAt = Date.now()
} = {}) {
  const resolution = resolveAwakeningCapacity(actor, { raceIdOverride });
  const grants = [];
  for (const applied of resolution.appliedEffects) {
    if (applied.effectType !== MTROL_EFFECT_TYPES.GRANT_AWAKENING_SLOT) continue;
    const count = Math.max(0, Math.trunc(Number(applied.delta) || 0));
    for (let slot = 0; slot < count; slot++) {
      grants.push(Object.freeze({
        grantId: `passive:${applied.passiveId}:effect:${applied.effectIndex}:slot:${slot}`,
        source: "racialPassive",
        sourcePassiveId: applied.passiveId,
        grantedAtLevel: levelOf(actor),
        grantedBy,
        grantedAt,
        reason: "Slot adicional concedido por pasiva racial."
      }));
    }
  }
  return Object.freeze(grants);
}

export function planDerivedAwakeningGrantUpdate(actor, options = {}) {
  const current = array(actor?.system?.awakening?.grants);
  const existingIds = new Set(current.map(grant => grant?.grantId));
  const additions = getDerivedAwakeningGrants(actor, options)
    .filter(grant => !existingIds.has(grant.grantId));
  return Object.freeze({
    changed: additions.length > 0,
    additions: Object.freeze(additions),
    grants: Object.freeze([...current, ...additions])
  });
}

export function getAwakeningState(actor, options = {}) {
  const persistedGrants = array(actor?.system?.awakening?.grants);
  const persistedIds = new Set(persistedGrants.map(grant => grant?.grantId));
  const virtualDerived = getDerivedAwakeningGrants(actor, options)
    .filter(grant => !persistedIds.has(grant.grantId));
  const grants = [...persistedGrants, ...virtualDerived];
  const selections = array(actor?.system?.awakening?.selections);
  const consumed = new Set(selections.map(selection => selection?.grantId));
  const capacity = getEffectiveAwakeningCapacity(actor, options);
  return Object.freeze({
    capacity,
    grants: Object.freeze(grants),
    selections: Object.freeze(selections),
    granted: grants.length,
    selected: selections.length,
    availableGrantedSlots: grants.filter(grant => !consumed.has(grant.grantId)).length,
    overCapacity: grants.length > capacity || selections.length > capacity,
    virtualDerivedGrantIds: Object.freeze(virtualDerived.map(grant => grant.grantId))
  });
}

export function validateAwakeningSelection(actor, passiveId, options = {}) {
  const passive = getRacialPassiveDefinition(passiveId);
  const state = getAwakeningState(actor, options);
  const activeIds = new Set(resolveActivePassives(actor).passives.map(entry => entry.technicalId));
  const selectedIds = new Set(state.selections.map(selection => selection.passiveId));
  const errors = [];
  if (!passive) errors.push("PASSIVE_UNKNOWN");
  if (passive && passive.unlockLevel > levelOf(actor)) errors.push("PASSIVE_LEVEL_LOCKED");
  if (passive?.awakeningEligible === false) errors.push("PASSIVE_NOT_AWAKENING_ELIGIBLE");
  if (activeIds.has(passiveId) || selectedIds.has(passiveId)) errors.push("PASSIVE_DUPLICATE");
  if (state.availableGrantedSlots < 1) errors.push("AWAKENING_GRANT_UNAVAILABLE");
  return Object.freeze({ eligible: errors.length === 0, errors: Object.freeze(errors), state, passive });
}

function getUser(userId) {
  if (typeof game.users?.get === "function") return game.users.get(userId);
  return Array.from(game.users ?? []).find(user => user.id === userId) ?? null;
}

export async function grantAwakeningSlotAuthoritative(payload = {}, {
  requestingUserId = game.user?.id,
  trustedActor = null
} = {}) {
  const allowed = new Set(["actorUuid", "transactionId", "reason", "source"]);
  const unexpected = Object.keys(payload).filter(key => !allowed.has(key));
  if (unexpected.length) throw new Error(`Payload de Despertar inválido: ${unexpected.join(", ")}.`);
  const user = getUser(requestingUserId);
  if (!user?.isGM) throw new Error("Sólo un GM puede otorgar un Despertar.");
  const actor = trustedActor?.uuid === payload.actorUuid
    ? trustedActor
    : await fromUuid(String(payload.actorUuid ?? ""));
  if (!actor) throw new Error("No se encontró el Actor para otorgar Despertar.");
  const source = payload.source ?? "normalNarrative";
  if (!["normalNarrative", "gmOverride"].includes(source)) {
    throw new Error("El source del grant GM no es válido.");
  }

  return runActorResourceTransaction(actor, {
    transactionId: payload.transactionId,
    origin: "awakening-grant",
    tracksWrites: true
  }, async (canonicalActor, { beforeWrite }) => {
    const state = getAwakeningState(canonicalActor);
    if (state.granted >= state.capacity) {
      throw new Error("La capacidad de Despertar del Actor ya está completa.");
    }
    const grantId = `gm:${payload.transactionId}`;
    const persisted = array(canonicalActor.system?.awakening?.grants);
    if (persisted.some(grant => grant.grantId === grantId)) {
      return { authorized: true, changed: false, grantId, state: getAwakeningState(canonicalActor) };
    }
    const grant = {
      grantId,
      source,
      sourcePassiveId: null,
      grantedAtLevel: levelOf(canonicalActor),
      grantedBy: user.id,
      grantedAt: Date.now(),
      reason: String(payload.reason ?? "")
    };
    await beforeWrite();
    await canonicalActor.update({
      "system.awakening.grants": [...persisted, grant]
    }, { [AWAKENING_INTERNAL_UPDATE_OPTION]: true });
    return { authorized: true, changed: true, grantId, grant, state: getAwakeningState(canonicalActor) };
  });
}

export function guardActorAwakeningUpdate(_actor, changes, options = {}) {
  if (options[AWAKENING_INTERNAL_UPDATE_OPTION] === true) return true;
  for (const key of Object.keys(changes ?? {})) {
    if (key === "system.awakening" || key.startsWith("system.awakening.")) delete changes[key];
  }
  if (changes?.system?.awakening) delete changes.system.awakening;
  return Object.keys(changes ?? {}).length > 0;
}

let installed = false;
export function installAwakeningAuthorityHooks() {
  if (installed) return;
  preUpdateActorDispatcher.subscribe("awakening.guard", guardActorAwakeningUpdate, {
    priority: 8,
    critical: true
  });
  installed = true;
}
