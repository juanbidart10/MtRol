// =========================
// MTROL - INIT
// =========================

// ---------- FOUNDRY V14+ NAMESPACES ----------
const { ActorSheet, ItemSheet } = foundry.appv1.sheets;

const ActorsCollection =
  foundry.documents.collections.Actors;

const ItemsCollection =
  foundry.documents.collections.Items;

// =========================
// SHEETS
// =========================

import {
  PersonajeSheet
} from "../sheets/actors/personaje-sheet.js";

import {
  CompetenciaSheet
} from "../sheets/items/competencia-sheet.js";

import {
  ObjetoSheet
} from "../sheets/items/objeto-sheet.js";

// =========================
// DATA MODELS
// =========================

import {
  PersonajeDataModel
} from "../../models/personaje-model.js";

import {
  CompetenciaDataModel
} from "../../models/competencia-model.js";

import {
  ObjetoDataModel
} from "../../models/objeto-model.js";

// =========================
// DAMAGE AUTHORIZED
// =========================

import {
  aplicarDanioCanonicoAutorizado,
  aplicarDanioLocalizadoAutorizado
} from "../combat/damage-authorized.js";

import {
  registerMtrolDebugSetting
} from "./debug.js";

import {
  configureAmbientFxApp,
  installMtrolAmbientFxApi
} from "../scene-fx/ambient-fx-manager.js";

import { MtrolAmbientFxApp } from "../scene-fx/ambient-fx-app.js";

import {
  completeReactionMovementAuthoritative,
  getPendingOppositionForActor,
  getReactionMovementForActor,
  installMtrolActionsApi,
  registerOppositionChatHandler
} from "../actions/action-engine.js";

import {
  registerResolvedDamageChatHandler
} from "../actions/action-damage-engine.js";

import {
  registerMtrolPremiumRollCards
} from "../ui/chat-roll-card-renderer.js";

import {
  installMtrolStatesApi
} from "../states/state-engine.js";

import {
  installMtrolDeathApi
} from "../states/death-engine.js";

import {
  installMtrolOrbAuthorityHooks
} from "../progression/orb-authority.js";

import {
  installMtrolClassResourceAuthorityHooks
} from "../actors/class-resource-service.js";

import {
  installMtrolRaceAuthorityHooks
} from "../actors/race-service.js";
import { installAwakeningAuthorityHooks } from "../actors/awakening-service.js";

import {
  installTradeApi
} from "../trade/trade-api.js";

import {
  configureTurnActionIntegration,
  installMtrolTurnApi
} from "../combat/turn-system.js";

import {
  installSpecialAbilityApi
} from "../combat/special-ability-service.js";

import {
  installMtrolLoggerApi
} from "../utils/logger.js";

import {
  registerOppositionCommands
} from "../runtime/opposition-commands.js";

import { registerTransactionCommands } from "../runtime/transaction-commands.js";
import { registerTradeCommands } from "../runtime/trade-commands.js";
import { registerStateCommands } from "../runtime/state-commands.js";
import { registerProgressionCommands } from "../runtime/progression-commands.js";
import { registerActionCommands } from "../runtime/action-commands.js";
import { registerOrbCommands } from "../runtime/orb-commands.js";
import { registerNarrativeCapabilityCommands } from "../runtime/narrative-capability-commands.js";
import { mtrolRoll } from "../rolls/mtrol-rolls.js";
import { authorityService } from "./authority-service.js";
import { integrationObservability } from "./integration-observability.js";
import { registerTradeRuntimeSetting } from "../trade/trade-runtime-repository.js";

// =========================
// INIT MTROL
// =========================

export async function initMtrol() {

  // =========================
  // ACTOR MODELS
  // =========================

  CONFIG.Actor.dataModels = {
    personaje: PersonajeDataModel,
    character: PersonajeDataModel
  };

  CONFIG.Actor.typeLabels = {
    personaje: "Personaje",
    character: "Personaje Legacy"
  };

  CONFIG.Actor.defaultType =
    "personaje";

  // =========================
  // ITEM MODELS
  // =========================

  CONFIG.Item.dataModels = {
    competencia: CompetenciaDataModel,
    objeto: ObjetoDataModel,
    item: ObjetoDataModel
  };

  CONFIG.Item.typeLabels = {
    competencia: "Competencia",
    objeto: "Objeto",
    item: "Objeto Legacy"
  };

  CONFIG.Item.defaultType =
    "objeto";

  // =========================
  // UNREGISTER CORE SHEETS
  // =========================

  ActorsCollection.unregisterSheet(
    "core",
    ActorSheet
  );

  ItemsCollection.unregisterSheet(
    "core",
    ItemSheet
  );

  // =========================
  // REGISTER ACTOR SHEETS
  // =========================

  ActorsCollection.registerSheet(
    "mtrol",
    PersonajeSheet,
    {
      types: ["personaje", "character"],
      makeDefault: true
    }
  );

  // =========================
  // REGISTER ITEM SHEETS
  // =========================

  ItemsCollection.registerSheet(
    "mtrol",
    CompetenciaSheet,
    {
      types: ["competencia"],
      makeDefault: true
    }
  );

  ItemsCollection.registerSheet(
    "mtrol",
    ObjetoSheet,
    {
      types: ["objeto", "item"],
      makeDefault: true
    }
  );

  // =========================
  // GLOBAL MTROL API
  // =========================

  game.mtrol =
    game.mtrol || {};

  registerTradeRuntimeSetting();

  installMtrolLoggerApi();

  game.mtrol.roll ??= mtrolRoll;
  game.mtrol.integration ??= {};
  game.mtrol.integration.getPrimaryGMId ??= () => authorityService.resolvePrimaryGM()?.id ?? null;
  game.mtrol.integration.getMetrics ??= () => integrationObservability.snapshot();
  game.mtrol.integration.configureMetrics ??= options => integrationObservability.configure(options);
  game.mtrol.integration.resetMetrics ??= () => integrationObservability.reset();

  game.mtrol.aplicarDanioAutorizado =
    aplicarDanioCanonicoAutorizado;

  game.mtrol.aplicarDanioLocalizadoAutorizado =
    aplicarDanioLocalizadoAutorizado;

  installTradeApi();
  installMtrolTurnApi();
  installSpecialAbilityApi();

  registerMtrolDebugSetting();
  configureAmbientFxApp(MtrolAmbientFxApp);
  installMtrolAmbientFxApi();
  installMtrolStatesApi();
  installMtrolDeathApi();
  installMtrolOrbAuthorityHooks();
  installMtrolClassResourceAuthorityHooks();
  installMtrolRaceAuthorityHooks();
  installAwakeningAuthorityHooks();
  configureTurnActionIntegration({
    getPendingOppositionForActor,
    getReactionMovementForActor,
    completeReactionMovementAuthoritative
  });
  installMtrolActionsApi();
  registerOppositionCommands();
  registerTransactionCommands();
  registerTradeCommands();
  registerStateCommands();
  registerProgressionCommands();
  registerActionCommands();
  registerOrbCommands();
  registerNarrativeCapabilityCommands();
  registerOppositionChatHandler();
  registerResolvedDamageChatHandler();
  registerMtrolPremiumRollCards();

  // =========================
  // PATCH TEMPORAL
  // DEFAULT ACTOR TYPE
  // =========================

  Hooks.on("preCreateActor", (actor) => {

    if (actor.type) return true;

    logger.warn("ADAPTER", "Actor sin type; se aplica el tipo por defecto", {
      adapter: "preCreateActor",
      actorUuid: actor.uuid ?? null,
      defaultType: "personaje"
    });

    actor.updateSource({
      type: "personaje"
    });

    return true;

  });

  // =========================
  // PATCH TEMPORAL
  // DEFAULT ITEM TYPE
  // =========================

  Hooks.on("preCreateItem", (item) => {

    if (item.type) return true;

    logger.warn("ADAPTER", "Item sin type; se aplica el tipo por defecto", {
      adapter: "preCreateItem",
      itemUuid: item.uuid ?? null,
      defaultType: "objeto"
    });

    item.updateSource({
      type: "objeto"
    });

    return true;

  });
}
