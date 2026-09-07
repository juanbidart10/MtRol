import { getRaceDefinition } from "../races/race-catalog.js";
import { getRacialPassiveDefinition } from "../races/racial-passive-catalog.js";
import { logger } from "../utils/logger.js";

export const racePassiveSourceProvider = Object.freeze({
  id: "race",
  resolve(actor) {
    const raceId = String(actor?.system?.identidad?.raceId ?? "").trim();
    if (!raceId) return { passiveIds: [], diagnostics: [] };
    const race = getRaceDefinition(raceId);
    if (!race) {
      return {
        passiveIds: [],
        diagnostics: [{ code: "RACE_ID_UNKNOWN", providerId: "race", raceId }]
      };
    }
    return { passiveIds: [race.basePassiveId], diagnostics: [] };
  }
});

export function resolveActivePassives(actor, {
  providers = [racePassiveSourceProvider],
  log = logger
} = {}) {
  const passiveIds = [];
  const diagnostics = [];
  for (const provider of providers) {
    const result = provider.resolve(actor) ?? {};
    passiveIds.push(...(result.passiveIds ?? []));
    diagnostics.push(...(result.diagnostics ?? []));
  }

  const passives = [];
  const seen = new Set();
  for (const passiveId of passiveIds) {
    if (seen.has(passiveId)) continue;
    seen.add(passiveId);
    const passive = getRacialPassiveDefinition(passiveId);
    if (!passive) {
      diagnostics.push({ code: "PASSIVE_ID_UNKNOWN", passiveId });
      continue;
    }
    passives.push(passive);
  }

  for (const diagnostic of diagnostics) {
    log?.warnOnce?.("EFFECT", "active passive resolution diagnostic", {
      actorUuid: actor?.uuid ?? null,
      ...diagnostic
    }, { key: `active-passive:${actor?.uuid ?? "actor"}:${diagnostic.code}:${diagnostic.raceId ?? diagnostic.passiveId ?? ""}` });
  }

  return Object.freeze({
    passives: Object.freeze(passives),
    diagnostics: Object.freeze(diagnostics.map(entry => Object.freeze({ ...entry })))
  });
}

