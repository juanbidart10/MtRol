import {
  MTROL_ORB_IDS
} from "./orb-registry.js";

function requestingUser(options = {}) {
  const id = options.requestingUserId ?? options.userId ?? game.user?.id;
  return game.users?.get?.(id) ??
    Array.from(game.users ?? []).find(user => user.id === id) ??
    null;
}

function hasPath(changes, flatPath, nestedPath) {
  const flatKeys = Object.keys(changes ?? {});
  const deletionPath = `${nestedPath.slice(0, -1).join(".")}.-=${nestedPath.at(-1)}`;
  if (flatKeys.some(key => key === flatPath || key.startsWith(`${flatPath}.`) || key === deletionPath)) {
    return true;
  }
  let cursor = changes;
  for (const part of nestedPath.slice(0, -1)) {
    if (!cursor || !Object.hasOwn(cursor, part)) return false;
    cursor = cursor[part];
  }
  const leaf = nestedPath.at(-1);
  return !!cursor && (Object.hasOwn(cursor, leaf) || Object.hasOwn(cursor, `-=${leaf}`));
}

function getPathValue(changes, flatPath, nestedPath) {
  if (Object.hasOwn(changes ?? {}, flatPath)) return changes[flatPath];
  let cursor = changes;
  for (const part of nestedPath) cursor = cursor?.[part];
  return cursor;
}

export function validateOrbCollection(orbs) {
  if (!Array.isArray(orbs)) return false;
  const ids = new Set();
  const types = new Set();

  for (const orb of orbs) {
    const id = String(orb?.id ?? "").trim();
    const type = String(orb?.type ?? "").trim();
    const level = Number(orb?.level);
    if (!id || ids.has(id)) return false;
    if (!MTROL_ORB_IDS.includes(type) || types.has(type)) return false;
    if (!Number.isInteger(level) || level < 1 || level > 5) return false;
    ids.add(id);
    types.add(type);
  }
  return true;
}

export function guardActorOrbUpdate(changes, options = {}) {
  if (!hasPath(changes, "system.orbs", ["system", "orbs"])) return true;
  if (requestingUser(options)?.isGM !== true) return false;
  return validateOrbCollection(
    getPathValue(changes, "system.orbs", ["system", "orbs"])
  );
}

export function guardCompetenciaOrbUpdate(item, changes, options = {}) {
  if (item?.type !== "competencia") return true;
  if (!hasPath(changes, "system.orbType", ["system", "orbType"])) return true;
  if (requestingUser(options)?.isGM !== true) return false;
  const type = getPathValue(changes, "system.orbType", ["system", "orbType"]);
  return type === null || type === "" || MTROL_ORB_IDS.includes(type);
}

export function installMtrolOrbAuthorityHooks() {
  Hooks.on("preUpdateActor", (_actor, changes, options, userId) => {
    const allowed = guardActorOrbUpdate(changes, {
      ...options,
      requestingUserId: userId
    });
    if (!allowed) ui.notifications.warn("Sólo un GM puede administrar Orbes.");
    return allowed;
  });

  Hooks.on("preUpdateItem", (item, changes, options, userId) => {
    const allowed = guardCompetenciaOrbUpdate(item, changes, {
      ...options,
      requestingUserId: userId
    });
    if (!allowed) ui.notifications.warn("Sólo un GM puede asociar un hechizo a un Orbe.");
    return allowed;
  });
}
