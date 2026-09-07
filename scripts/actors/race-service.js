import {
  getRaceDefinition,
  isValidRaceId
} from "../races/race-catalog.js";

import { getAttributeCap } from "../progression/progression-caps.js";

import {
  runActorResourceTransaction
} from "./actor-resource-service.js";

import {
  CLASS_RESOURCE_INTERNAL_UPDATE_OPTION
} from "./class-resource-service.js";

import { preUpdateActorDispatcher } from "../core/hook-dispatcher.js";
import {
  AWAKENING_INTERNAL_UPDATE_OPTION,
  planDerivedAwakeningGrantUpdate
} from "./awakening-service.js";

export const RACE_IDENTITY_INTERNAL_UPDATE_OPTION = "mtrolRaceIdentityTransition";

const RACE_PROTECTED_PATHS = Object.freeze([
  "system.identidad.raceId",
  "system.identidad.raza",
  "system.raceCreationGrant"
]);

const ATTRIBUTE_KEYS = Object.freeze([
  "resistencia", "carisma", "fuerza", "inteligencia", "voluntad",
  "aura", "percepcion", "destreza", "suerte"
]);

function createTransactionId(prefix) {
  const id = foundry.utils.randomID?.() ?? crypto.randomUUID();
  return `${prefix}-${id}`;
}

function getUser(userId) {
  if (typeof game.users?.get === "function") return game.users.get(userId);
  return Array.from(game.users ?? []).find(user => user.id === userId) ?? null;
}

function assertGmRequest(requestingUserId) {
  if (!getUser(requestingUserId)?.isGM) {
    throw new Error("Sólo un GM puede modificar Raza o aplicar beneficios raciales de creación.");
  }
}

function assertExactKeys(value, allowed, label) {
  const unexpected = Object.keys(value ?? {}).filter(key => !allowed.has(key));
  if (unexpected.length) throw new Error(`${label} contiene campos inválidos: ${unexpected.join(", ")}.`);
}

function getCanonicalActor(payload, trustedActor = null) {
  if (trustedActor && trustedActor.uuid === payload.actorUuid) return Promise.resolve(trustedActor);
  return fromUuid(String(payload.actorUuid ?? ""));
}

function deletePath(changes, path) {
  delete changes[path];
  const parts = path.split(".");
  let cursor = changes;
  for (const part of parts.slice(0, -1)) {
    if (!cursor?.[part] || typeof cursor[part] !== "object") return;
    cursor = cursor[part];
  }
  delete cursor[parts.at(-1)];
}

function deletePathAndChildren(changes, path) {
  deletePath(changes, path);
  for (const key of Object.keys(changes ?? {})) {
    if (key.startsWith(`${path}.`)) delete changes[key];
  }
}

export function getRaceCreationGrantState(actor) {
  const grant = actor?.system?.raceCreationGrant ?? {};
  return Object.freeze({
    applied: grant.applied === true,
    sourceRaceId: String(grant.sourceRaceId ?? "").trim()
  });
}

export async function updateActorRaceIdentityAuthoritative(payload = {}, {
  requestingUserId = game.user?.id,
  trustedActor = null
} = {}) {
  assertExactKeys(payload, new Set(["actorUuid", "transactionId", "expectedRaceId", "raceId"]), "El payload racial");
  assertGmRequest(requestingUserId);
  if (!isValidRaceId(payload.raceId)) throw new Error("La Raza solicitada no existe.");

  const actor = await getCanonicalActor(payload, trustedActor);
  if (!actor) throw new Error("No se encontró el Actor para actualizar su Raza.");

  return runActorResourceTransaction(actor, {
    transactionId: payload.transactionId,
    origin: "race-identity-update",
    tracksWrites: true
  }, async (canonicalActor, { beforeWrite }) => {
    const currentRaceId = String(canonicalActor.system?.identidad?.raceId ?? "");
    if (currentRaceId !== String(payload.expectedRaceId ?? "")) {
      throw new Error("La Raza del Actor cambió; se canceló la operación duplicada.");
    }
    const definition = getRaceDefinition(payload.raceId);
    const awakeningGrantPlan = planDerivedAwakeningGrantUpdate(canonicalActor, {
      raceIdOverride: definition.technicalId,
      grantedBy: requestingUserId
    });
    const update = {
      "system.identidad.raceId": definition.technicalId,
      "system.identidad.raza": definition.displayName
    };
    if (awakeningGrantPlan.changed) {
      update["system.awakening.grants"] = awakeningGrantPlan.grants;
    }
    await beforeWrite();
    await canonicalActor.update(update, {
      [RACE_IDENTITY_INTERNAL_UPDATE_OPTION]: true,
      [AWAKENING_INTERNAL_UPDATE_OPTION]: true
    });
    return {
      authorized: true,
      raceId: definition.technicalId,
      previousRaceId: currentRaceId,
      creationGrantApplied: getRaceCreationGrantState(canonicalActor).applied,
      awakeningGrantIds: awakeningGrantPlan.additions.map(grant => grant.grantId)
    };
  });
}

export async function applyRaceCreationBenefitsAuthoritative(payload = {}, {
  requestingUserId = game.user?.id,
  trustedActor = null
} = {}) {
  assertExactKeys(payload, new Set(["actorUuid", "transactionId", "expectedRaceId"]), "El payload de creación racial");
  assertGmRequest(requestingUserId);

  const actor = await getCanonicalActor(payload, trustedActor);
  if (!actor) throw new Error("No se encontró el Actor para aplicar sus beneficios raciales.");

  return runActorResourceTransaction(actor, {
    transactionId: payload.transactionId,
    origin: "race-creation-grant",
    tracksWrites: true
  }, async (canonicalActor, { beforeWrite }) => {
    const currentRaceId = String(canonicalActor.system?.identidad?.raceId ?? "");
    if (currentRaceId !== String(payload.expectedRaceId ?? "")) {
      throw new Error("La Raza del Actor cambió; se canceló la aplicación.");
    }
    const definition = getRaceDefinition(currentRaceId);
    if (!definition) throw new Error("El Actor no posee una Raza canónica para aplicar.");

    const historicalGrant = getRaceCreationGrantState(canonicalActor);
    if (historicalGrant.applied) {
      return {
        authorized: true,
        applied: false,
        alreadyApplied: true,
        sourceRaceId: historicalGrant.sourceRaceId
      };
    }

    const proposedAttributes = {};
    const violations = [];
    const attributeCap = getAttributeCap(canonicalActor, { raceIdOverride: currentRaceId });
    for (const [attribute, bonus] of Object.entries(definition.creationAttributeBonuses)) {
      if (!ATTRIBUTE_KEYS.includes(attribute)) throw new Error(`La Raza declara un atributo desconocido: ${attribute}.`);
      const current = Number(canonicalActor.system?.atributos?.[attribute]);
      if (!Number.isFinite(current)) throw new Error(`El atributo ${attribute} no posee un valor válido.`);
      const proposed = current + Number(bonus);
      proposedAttributes[attribute] = proposed;
      if (proposed > attributeCap) violations.push({ attribute, current, bonus, proposed });
    }
    if (violations.length) {
      const detail = violations.map(entry => `${entry.attribute}: ${entry.current} + ${entry.bonus} = ${entry.proposed}`).join("; ");
      const error = new Error(`Los beneficios raciales exceden el cap ${attributeCap}: ${detail}. No se aplicó ningún cambio.`);
      error.reasonCode = "RACE_CREATION_ATTRIBUTE_CAP_EXCEEDED";
      error.violations = violations;
      throw error;
    }

    const update = {
      "system.raceCreationGrant.applied": true,
      "system.raceCreationGrant.sourceRaceId": definition.technicalId
    };
    for (const [attribute, value] of Object.entries(proposedAttributes)) {
      update[`system.atributos.${attribute}`] = value;
    }

    await beforeWrite();
    await canonicalActor.update(update, {
      [RACE_IDENTITY_INTERNAL_UPDATE_OPTION]: true,
      [CLASS_RESOURCE_INTERNAL_UPDATE_OPTION]: true
    });
    return {
      authorized: true,
      applied: true,
      alreadyApplied: false,
      sourceRaceId: definition.technicalId,
      attributes: proposedAttributes
    };
  });
}

export function guardActorRaceUpdate(_actor, changes, options = {}) {
  if (options[RACE_IDENTITY_INTERNAL_UPDATE_OPTION] === true) return true;
  for (const path of RACE_PROTECTED_PATHS) deletePathAndChildren(changes, path);
  return Object.keys(changes ?? {}).length > 0;
}

let authorityHookInstalled = false;

export function installMtrolRaceAuthorityHooks() {
  if (authorityHookInstalled) return;
  preUpdateActorDispatcher.subscribe("race.guard", guardActorRaceUpdate, { priority: 9, critical: true });
  authorityHookInstalled = true;
}

export function createRaceTransactionId(prefix = "race") {
  return createTransactionId(prefix);
}
