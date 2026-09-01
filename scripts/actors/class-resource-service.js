import {
  calculateResourceTransition
} from "./class-resource-calculator.js";

import {
  getClassDefinition,
  isValidClassId
} from "./class-registry.js";

import {
  runActorResourceTransaction
} from "./actor-resource-service.js";
import { preUpdateActorDispatcher } from "../core/hook-dispatcher.js";

const INTERNAL_UPDATE_OPTION = "mtrolClassResourceTransition";

const CONFIG_CHANGE_KEYS = new Set([
  "classId",
  "hpModifier",
  "hpModifierLabel",
  "mpModifier",
  "mpModifierLabel",
  "resourceModifierEntries"
]);

const PERMANENT_CHANGE_KEYS = new Set([
  "level",
  "resistance",
  "intelligence"
]);

const CONFIG_PATHS = Object.freeze([
  "system.identidad.classId",
  "system.resourceModifiers",
  "system.resourceModifierEntries"
]);

const RESOURCE_MODIFIER_ENTRY_LIMIT = 50;
const RESOURCE_MODIFIER_ENTRY_KEYS = new Set(["id", "hp", "mp"]);
const RESOURCE_MODIFIER_VALUE_KEYS = new Set(["value", "label"]);

const ACTIVE_PERMANENT_PATHS = Object.freeze([
  "system.recursos.nivel",
  "system.atributos.resistencia",
  "system.atributos.inteligencia",
  "system.vitales.hp.max",
  "system.vitales.mp.max"
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
    throw new Error("Sólo un GM puede modificar Clase o recursos permanentes.");
  }
}

function assertExactKeys(value, allowed, label) {
  const unexpected = Object.keys(value ?? {}).filter(key => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new Error(`${label} contiene campos inválidos: ${unexpected.join(", ")}.`);
  }
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} debe ser un número finito.`);
  return number;
}

function sanitizeResourceModifierEntries(entries) {
  if (!Array.isArray(entries)) {
    throw new Error("Los modificadores de recursos deben ser una lista.");
  }
  if (entries.length > RESOURCE_MODIFIER_ENTRY_LIMIT) {
    throw new Error(`No se permiten más de ${RESOURCE_MODIFIER_ENTRY_LIMIT} modificadores.`);
  }

  const ids = new Set();
  return entries.map((entry, index) => {
    assertExactKeys(entry, RESOURCE_MODIFIER_ENTRY_KEYS, `El modificador ${index + 1}`);
    assertExactKeys(entry?.hp, RESOURCE_MODIFIER_VALUE_KEYS, `El HP del modificador ${index + 1}`);
    assertExactKeys(entry?.mp, RESOURCE_MODIFIER_VALUE_KEYS, `El MP del modificador ${index + 1}`);
    const id = String(entry?.id ?? "").trim();
    if (!id || ids.has(id)) {
      throw new Error("Cada modificador de recursos debe tener un identificador único.");
    }
    ids.add(id);
    return {
      id,
      hp: {
        value: finiteNumber(entry?.hp?.value ?? 0, `HP del modificador ${index + 1}`),
        label: String(entry?.hp?.label ?? "")
      },
      mp: {
        value: finiteNumber(entry?.mp?.value ?? 0, `MP del modificador ${index + 1}`),
        label: String(entry?.mp?.label ?? "")
      }
    };
  });
}

function aggregateResourceModifierEntries(entries) {
  return entries.reduce((totals, entry) => {
    totals.hp += Number(entry.hp.value);
    totals.mp += Number(entry.mp.value);
    return totals;
  }, { hp: 0, mp: 0 });
}

export function getActorResourceModifierEntries(actor, { includeEmpty = false } = {}) {
  const persisted = Array.from(actor?.system?.resourceModifierEntries ?? []);
  if (persisted.length > 0) return sanitizeResourceModifierEntries(persisted);

  const legacy = {
    id: "legacy-resource-modifier",
    hp: {
      value: Number(actor?.system?.resourceModifiers?.hp?.value ?? 0),
      label: String(actor?.system?.resourceModifiers?.hp?.label ?? "")
    },
    mp: {
      value: Number(actor?.system?.resourceModifiers?.mp?.value ?? 0),
      label: String(actor?.system?.resourceModifiers?.mp?.label ?? "")
    }
  };
  const hasLegacyValue = legacy.hp.value !== 0 || legacy.mp.value !== 0 ||
    legacy.hp.label.length > 0 || legacy.mp.label.length > 0;
  return hasLegacyValue || includeEmpty ? [legacy] : [];
}

function getCanonicalActor(payload, trustedActor = null) {
  if (trustedActor && trustedActor.uuid === payload.actorUuid) {
    return Promise.resolve(trustedActor);
  }
  return fromUuid(String(payload.actorUuid ?? ""));
}

export function extractActorClassResourceState(actor) {
  const entries = getActorResourceModifierEntries(actor);
  const entryTotals = aggregateResourceModifierEntries(entries);
  const hasEntries = entries.length > 0;
  return {
    classId: actor?.system?.identidad?.classId,
    level: actor?.system?.recursos?.nivel,
    resistance: actor?.system?.atributos?.resistencia,
    intelligence: actor?.system?.atributos?.inteligencia,
    hpModifier: hasEntries
      ? entryTotals.hp
      : actor?.system?.resourceModifiers?.hp?.value ?? 0,
    mpModifier: hasEntries
      ? entryTotals.mp
      : actor?.system?.resourceModifiers?.mp?.value ?? 0,
    hpValue: actor?.system?.vitales?.hp?.value,
    hpMax: actor?.system?.vitales?.hp?.max,
    mpValue: actor?.system?.vitales?.mp?.value,
    mpMax: actor?.system?.vitales?.mp?.max
  };
}

function buildIntendedState(oldState, changes = {}) {
  const entries = Object.hasOwn(changes, "resourceModifierEntries")
    ? sanitizeResourceModifierEntries(changes.resourceModifierEntries)
    : null;
  const entryTotals = entries ? aggregateResourceModifierEntries(entries) : null;
  return {
    ...oldState,
    ...(Object.hasOwn(changes, "classId") ? { classId: changes.classId } : {}),
    ...(Object.hasOwn(changes, "level")
      ? { level: finiteNumber(changes.level, "Nivel") }
      : {}),
    ...(Object.hasOwn(changes, "resistance")
      ? { resistance: finiteNumber(changes.resistance, "Resistencia") }
      : {}),
    ...(Object.hasOwn(changes, "intelligence")
      ? { intelligence: finiteNumber(changes.intelligence, "Inteligencia") }
      : {}),
    ...(Object.hasOwn(changes, "hpModifier")
      ? { hpModifier: finiteNumber(changes.hpModifier, "Modificador HP") }
      : {}),
    ...(Object.hasOwn(changes, "mpModifier")
      ? { mpModifier: finiteNumber(changes.mpModifier, "Modificador MP") }
      : {}),
    ...(entryTotals
      ? { hpModifier: entryTotals.hp, mpModifier: entryTotals.mp }
      : {})
  };
}

export function getActorResourceTransitionUpdate(actor, changes = {}) {
  const oldState = extractActorClassResourceState(actor);
  const intendedState = buildIntendedState(oldState, changes);
  const transition = calculateResourceTransition(oldState, intendedState);

  if (!transition.active) return { transition, changes: {} };

  return {
    transition,
    changes: {
      "system.vitales.hp.value": transition.hp.value,
      "system.vitales.hp.max": transition.hp.max,
      "system.vitales.mp.value": transition.mp.value,
      "system.vitales.mp.max": transition.mp.max
    }
  };
}

function assertExpectedState(current, expected = {}) {
  const checks = {
    classId: String(current.classId ?? ""),
    level: Number(current.level),
    resistance: Number(current.resistance),
    intelligence: Number(current.intelligence)
  };

  for (const [key, value] of Object.entries(expected)) {
    const normalized = key === "classId" ? String(value ?? "") : Number(value);
    if (checks[key] !== normalized) {
      throw new Error("El estado permanente del Actor cambió; se canceló la operación duplicada.");
    }
  }
}

export async function updateActorPermanentResourcesAuthoritative(payload = {}, {
  requestingUserId = game.user?.id,
  trustedActor = null
} = {}) {
  assertExactKeys(
    payload,
    new Set(["actorUuid", "transactionId", "expected", "changes"]),
    "El payload permanente"
  );
  assertGmRequest(requestingUserId);
  assertExactKeys(payload.changes, PERMANENT_CHANGE_KEYS, "La intención permanente");

  const actor = await getCanonicalActor(payload, trustedActor);
  if (!actor) throw new Error("No se encontró el Actor para actualizar sus recursos permanentes.");

  return runActorResourceTransaction(actor, {
    transactionId: payload.transactionId,
    origin: "permanent-resource-update",
    tracksWrites: true
  }, async (canonicalActor, { beforeWrite }) => {
    const current = extractActorClassResourceState(canonicalActor);
    assertExpectedState(current, payload.expected);
    const intended = buildIntendedState(current, payload.changes);
    const { transition, changes: vitalChanges } =
      getActorResourceTransitionUpdate(canonicalActor, payload.changes);
    const update = {};

    if (Object.hasOwn(payload.changes, "level")) {
      update["system.recursos.nivel"] = intended.level;
    }
    if (Object.hasOwn(payload.changes, "resistance")) {
      update["system.atributos.resistencia"] = intended.resistance;
    }
    if (Object.hasOwn(payload.changes, "intelligence")) {
      update["system.atributos.inteligencia"] = intended.intelligence;
    }
    Object.assign(update, vitalChanges);

    await beforeWrite();

    await canonicalActor.update(update, { [INTERNAL_UPDATE_OPTION]: true });
    return { authorized: true, transition };
  });
}

export async function updateActorResourceConfigurationAuthoritative(payload = {}, {
  requestingUserId = game.user?.id,
  trustedActor = null
} = {}) {
  assertExactKeys(
    payload,
    new Set(["actorUuid", "transactionId", "expectedClassId", "changes"]),
    "El payload de configuración"
  );
  assertGmRequest(requestingUserId);
  assertExactKeys(payload.changes, CONFIG_CHANGE_KEYS, "La configuración de recursos");

  const actor = await getCanonicalActor(payload, trustedActor);
  if (!actor) throw new Error("No se encontró el Actor para configurar sus recursos.");

  return runActorResourceTransaction(actor, {
    transactionId: payload.transactionId,
    origin: "class-resource-update",
    tracksWrites: true
  }, async (canonicalActor, { beforeWrite }) => {
    const current = extractActorClassResourceState(canonicalActor);
    if (String(current.classId ?? "") !== String(payload.expectedClassId ?? "")) {
      throw new Error("La Clase del Actor cambió; se canceló la operación duplicada.");
    }

    if (Object.hasOwn(payload.changes, "classId") &&
      !isValidClassId(payload.changes.classId)) {
      throw new Error("La Clase solicitada no existe.");
    }

    const update = {};
    let mechanicalChange = false;

    if (Object.hasOwn(payload.changes, "classId")) {
      const definition = getClassDefinition(payload.changes.classId);
      update["system.identidad.classId"] = definition.id;
      update["system.identidad.clase"] = definition.label;
      mechanicalChange = definition.id !== String(current.classId ?? "");
    }
    if (Object.hasOwn(payload.changes, "resourceModifierEntries")) {
      const entries = sanitizeResourceModifierEntries(payload.changes.resourceModifierEntries);
      const totals = aggregateResourceModifierEntries(entries);
      update["system.resourceModifierEntries"] = entries;
      update["system.resourceModifiers.hp.value"] = totals.hp;
      update["system.resourceModifiers.mp.value"] = totals.mp;
      update["system.resourceModifiers.hp.label"] = entries
        .map(entry => entry.hp.label.trim()).filter(Boolean).join("; ");
      update["system.resourceModifiers.mp.label"] = entries
        .map(entry => entry.mp.label.trim()).filter(Boolean).join("; ");
      mechanicalChange ||= totals.hp !== Number(current.hpModifier) ||
        totals.mp !== Number(current.mpModifier);
    }
    if (Object.hasOwn(payload.changes, "hpModifier")) {
      update["system.resourceModifiers.hp.value"] = finiteNumber(
        payload.changes.hpModifier,
        "Modificador HP"
      );
      mechanicalChange ||= update["system.resourceModifiers.hp.value"] !== Number(current.hpModifier);
    }
    if (Object.hasOwn(payload.changes, "mpModifier")) {
      update["system.resourceModifiers.mp.value"] = finiteNumber(
        payload.changes.mpModifier,
        "Modificador MP"
      );
      mechanicalChange ||= update["system.resourceModifiers.mp.value"] !== Number(current.mpModifier);
    }
    if (Object.hasOwn(payload.changes, "hpModifierLabel")) {
      update["system.resourceModifiers.hp.label"] = String(payload.changes.hpModifierLabel ?? "");
    }
    if (Object.hasOwn(payload.changes, "mpModifierLabel")) {
      update["system.resourceModifiers.mp.label"] = String(payload.changes.mpModifierLabel ?? "");
    }

    let transition = null;
    if (mechanicalChange) {
      const result = getActorResourceTransitionUpdate(canonicalActor, payload.changes);
      transition = result.transition;
      Object.assign(update, result.changes);
    }

    await beforeWrite();

    await canonicalActor.update(update, { [INTERNAL_UPDATE_OPTION]: true });
    return { authorized: true, transition };
  });
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
  for (const key of Object.keys(changes)) {
    if (key.startsWith(`${path}.`)) delete changes[key];
  }
}

export function guardActorClassResourceUpdate(actor, changes, options = {}, userId) {
  if (options[INTERNAL_UPDATE_OPTION] === true) return true;

  const user = getUser(userId);
  const isGm = user?.isGM === true;
  const active = isValidClassId(actor?.system?.identidad?.classId);

  for (const path of CONFIG_PATHS) deletePathAndChildren(changes, path);

  if (active || !isGm) {
    for (const path of ACTIVE_PERMANENT_PATHS) deletePath(changes, path);
  }

  return Object.keys(changes).length > 0;
}

let authorityHookInstalled = false;

export function installMtrolClassResourceAuthorityHooks() {
  if (authorityHookInstalled) return;
  preUpdateActorDispatcher.subscribe("class-resource.guard", (actor, changes, options, userId) =>
    guardActorClassResourceUpdate(actor, changes, options, userId),
  { priority: 10, critical: true });
  authorityHookInstalled = true;
}

export async function updateActorFromSheetAuthoritative(actor, formData) {
  assertGmRequest(game.user?.id);
  const semanticChanges = {};
  const mappings = [
    ["system.recursos.nivel", "level"],
    ["system.atributos.resistencia", "resistance"],
    ["system.atributos.inteligencia", "intelligence"]
  ];

  for (const [path, key] of mappings) {
    if (Object.hasOwn(formData, path)) semanticChanges[key] = formData[path];
  }

  return runActorResourceTransaction(actor, {
    transactionId: createTransactionId("sheet-permanent"),
    origin: "permanent-resource-update",
    tracksWrites: true
  }, async (canonicalActor, { beforeWrite }) => {
    const current = extractActorClassResourceState(canonicalActor);
    const update = { ...formData };
    deletePath(update, "system.identidad.classId");
    deletePathAndChildren(update, "system.resourceModifiers");
    deletePath(update, "system.vitales.hp.max");
    deletePath(update, "system.vitales.mp.max");

    const { transition, changes } =
      getActorResourceTransitionUpdate(canonicalActor, semanticChanges);

    for (const resource of ["hp", "mp"]) {
      const valuePath = `system.vitales.${resource}.value`;
      const maxPath = `system.vitales.${resource}.max`;
      if (!Object.hasOwn(formData, valuePath)) continue;

      const submitted = finiteNumber(formData[valuePath], `${resource.toUpperCase()} actual`);
      const previous = Number(current[`${resource}Value`]);
      if (submitted !== previous) {
        const maximum = Number(changes[maxPath] ?? current[`${resource}Max`]);
        changes[valuePath] = Math.min(maximum, Math.max(0, submitted));
      }
    }

    Object.assign(update, changes);
    await beforeWrite();
    await canonicalActor.update(update, { [INTERNAL_UPDATE_OPTION]: true });
    return { authorized: true, transition };
  });
}
