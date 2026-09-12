import { logger } from "../utils/logger.js";
import { RuntimeRepository } from "./runtime-repository.js";
import { ReceiptStore } from "./receipt-store.js";
import { CommandRegistry } from "./command-registry.js";
import { RecoveryCoordinator } from "./recovery-coordinator.js";
import { ActorRuntimeRepository } from "./actor-runtime-repository.js";
import { TransactionCoordinator } from "./transaction-coordinator.js";
import { authorityService } from "../core/authority-service.js";

export const runtimeRepository = new RuntimeRepository({ logger });
export const receiptStore = new ReceiptStore({
  repository: runtimeRepository,
  logger,
  compactCompletedReceipts: true
});
export const actorRuntimeRepository = new ActorRuntimeRepository({ logger });
export const actorReceiptStore = new ReceiptStore({
  repository: actorRuntimeRepository,
  logger
});
export const transactionCoordinator = new TransactionCoordinator({
  combatReceiptStore: receiptStore,
  actorReceiptStore,
  authority: authorityService,
  logger,
  relatedScopes: scope => {
    if (!scope.actor) return [];
    const combats = Array.from(globalThis.game?.combats?.values?.() ?? []);
    if (globalThis.game?.combat && !combats.includes(game.combat)) combats.push(game.combat);
    return [
      ...(scope.combat ? [{ actor: scope.actor }] : []),
      ...combats.filter(combat => combat !== scope.combat).map(combat => ({ combat, actor: scope.actor }))
    ];
  },
  notify: message => {
    if (globalThis.game?.user?.isGM) globalThis.ui?.notifications?.warn?.(message);
  }
});
export const commandRegistry = new CommandRegistry({
  receiptStore,
  logger,
  resolveCombat: combatId => runtimeRepository.resolveCombat(combatId),
  resolveActor: actorId => game.actors?.get?.(actorId) ?? null
});
export const recoveryCoordinator = new RecoveryCoordinator({
  repository: runtimeRepository,
  receiptStore,
  actorRepository: actorRuntimeRepository,
  actorReceiptStore,
  logger
});
