import {
  installMtrolDebugApi
} from "./debug.js";

import {
  initializeTradeAuthority,
  recoverTradeTransactionsAuthoritative
} from "../trade/trade-authority.js";

import {
  reconcileActiveTurn
} from "../combat/turn-system.js";

import {
  hydratePendingActionsFromRuntime,
  recoverPendingActionPresentation
} from "../actions/action-engine.js";

import {
  recoveryCoordinator
} from "../runtime/runtime-foundation.js";

import {
  isPrimaryActiveGM
} from "./socket-requests.js";

import {
  logger
} from "../utils/logger.js";

import { recoverMovementTransactions } from "../combat/movement-service.js";

import {
  migrateCompetencyTechnicalIds
} from "../migrations/competency-technical-id-migration.js";

import {
  migrateRaceIdentities
} from "../migrations/race-identity-migration.js";
import { migrateAwakeningFoundation } from "../migrations/awakening-foundation-migration.js";

let recoveryHooksInstalled = false;
let authorityRecoveryScheduled = false;

async function recoverActorRuntime() {
  // Include loaded synthetic Actors; their receipts belong to the Token Actor,
  // not to the base world Actor. This list is rebuilt, never authoritative RAM.
  const actors = new Map();
  for (const actor of Array.from(game.actors?.values?.() ?? game.actors ?? [])) {
    if (actor?.uuid) actors.set(actor.uuid, actor);
  }
  for (const scene of Array.from(game.scenes?.values?.() ?? game.scenes ?? [])) {
    for (const token of Array.from(scene.tokens?.values?.() ?? scene.tokens ?? [])) {
      if (token.actor?.uuid) actors.set(token.actor.uuid, token.actor);
    }
  }
  return recoveryCoordinator.recoverActorTransactions(actors.values(), {
    isPrimaryGM: isPrimaryActiveGM(), notify: message => ui.notifications?.warn?.(message)
  });
}

async function recoverActiveCombatRuntime() {
  if (!game.combat) return null;
  recoveryCoordinator.configure({
    hydrateCache: hydratePendingActionsFromRuntime,
    recoverPresentation: recoverPendingActionPresentation
  });
  return recoveryCoordinator.recover(game.combat, {
    authorityUserId: game.user?.id ?? null,
    isPrimaryGM: isPrimaryActiveGM(),
    notify: message => ui.notifications?.warn?.(message)
  });
}

function installRuntimeRecoveryHooks() {
  if (recoveryHooksInstalled) return;
  recoveryHooksInstalled = true;
  Hooks.on("updateUser", (_user, changes) => {
    if (!("active" in (changes ?? {})) || !isPrimaryActiveGM()) return;
    if (authorityRecoveryScheduled) return;
    authorityRecoveryScheduled = true;
    queueMicrotask(async () => {
      authorityRecoveryScheduled = false;
      try {
        await recoverActiveCombatRuntime();
        await recoverMovementTransactions(game.combat);
        await recoverActorRuntime();
      } catch (error) {
        logger.error("RECOVERY", "authority change recovery failed", {
          combatId: game.combat?.id ?? null,
          error: error.message
        });
      }
    });
  });
}

// =========================
// MTROL - READY
// =========================

export async function readyMtrol() {

  // =====================================
  // API GLOBAL
  // =====================================

  game.mtrol = game.mtrol || {};

  installMtrolDebugApi();
  if (isPrimaryActiveGM()) {
    await migrateCompetencyTechnicalIds();
    await migrateRaceIdentities();
    await migrateAwakeningFoundation();
  }
  const tradeAuthority = await initializeTradeAuthority();
  if (tradeAuthority.primary) await recoverTradeTransactionsAuthoritative();
  await reconcileActiveTurn();
  installRuntimeRecoveryHooks();
  await recoverActiveCombatRuntime();
  await recoverMovementTransactions(game.combat);
  await recoverActorRuntime();
}
