// =========================
// MTROL - HOOKS
// =========================

import {
  installMtrolInitiativeAdapter
} from "../combat/initiative-foundry-adapter.js";

import {
  registrarHooksPesoMtrol
} from "./mtrol-carry-weight.js";

import {
  registerMtrolSequencerHooks
} from "../integrations/sequencer.js";

import {
  registerMtrolAmbientFxHooks
} from "../scene-fx/ambient-fx-manager.js";

import {
  registerTradeLifecycleHooks
} from "../trade/trade-hooks.js";

import {
  registerMtrolTurnHooks
} from "../combat/turn-system.js";

import {
  installSpecialAbilityAuthorityHooks
} from "../combat/special-ability-service.js";

import { registerFoundryHookAdapters } from "./hook-dispatcher.js";
import { actorRuntimeRepository } from "../runtime/runtime-foundation.js";
import { logger } from "../utils/logger.js";
import { registerGroundCanvasHooks } from "../ground/ground-canvas-renderer.js";

let actorRuntimeCacheHooksRegistered = false;

function evictActorRuntimeCache(actor, lifecycleReason) {
  if (!actor) return;
  void actorRuntimeRepository.evict(actor).catch(error => {
    logger.warn("RUNTIME_CACHE", "Actor runtime cache eviction failed", {
      command: "actor-runtime-cache.evict",
      actorUuid: actor.uuid ?? null,
      status: "isolated",
      reasonCode: "ACTOR_RUNTIME_CACHE_EVICTION_FAILED",
      lifecycleReason,
      error
    });
  });
}

function registerActorRuntimeCacheLifecycleHooks() {
  if (actorRuntimeCacheHooksRegistered) return false;
  actorRuntimeCacheHooksRegistered = true;
  Hooks.on("deleteActor", actor => evictActorRuntimeCache(actor, "ACTOR_DELETED"));
  Hooks.on("deleteToken", token => {
    const linked = token?.actorLink === true || token?.document?.actorLink === true;
    if (!linked) evictActorRuntimeCache(token?.actor, "SYNTHETIC_ACTOR_DELETED");
  });
  return true;
}

export function registerHooks() {
  registerFoundryHookAdapters();
  registerGroundCanvasHooks();
  registerActorRuntimeCacheLifecycleHooks();
  registrarHooksPesoMtrol();
  registerMtrolSequencerHooks();
  registerMtrolAmbientFxHooks();
  registerTradeLifecycleHooks();
  registerMtrolTurnHooks();
  installSpecialAbilityAuthorityHooks();
  installMtrolInitiativeAdapter();
}
