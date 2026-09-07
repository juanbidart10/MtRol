import { resolveActivePassives } from "./passive-assignment-resolver.js";
import { logger } from "../utils/logger.js";

/** Derived view only. Providers are the same extension point used by active passives. */
export function resolveNarrativeCapabilities(actor, options = {}) {
  const { passives, diagnostics } = resolveActivePassives(actor, options);
  return {
    capabilities: collectNarrativeCapabilities(passives, { log: options.log ?? logger }),
    diagnostics
  };
}

export function collectNarrativeCapabilities(passives = [], { log = logger } = {}) {
  const capabilities = new Map();
  for (const passive of passives) {
    for (const effect of passive.effects ?? []) {
      if (effect.type !== "CAPABILITY" || effect.mode !== "narrative" ||
          effect.requiresGmResolution !== true) continue;
      if (!/^[a-z][a-z0-9_]*$/.test(effect.capability ?? "") ||
          !effect.displayName || !effect.description) {
        log?.warnOnce?.("CAPABILITY", "invalid narrative capability metadata", {
          passiveId: passive.technicalId, capabilityId: effect.capability ?? null
        }, { key: `narrative-capability:${passive.technicalId}:${effect.capability}` });
        continue;
      }
      const previous = capabilities.get(effect.capability);
      if (previous) {
        if (!previous.passiveIds.includes(passive.technicalId)) previous.passiveIds.push(passive.technicalId);
        continue;
      }
      capabilities.set(effect.capability, {
        technicalId: effect.capability,
        passiveId: passive.technicalId,
        passiveIds: [passive.technicalId],
        displayName: effect.displayName,
        description: effect.description,
        mode: "narrative",
        requiresGmResolution: true
      });
    }
  }
  return Object.freeze(Array.from(capabilities.values(), capability => Object.freeze({
    ...capability, passiveIds: Object.freeze(capability.passiveIds)
  })));
}
