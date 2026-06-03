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
  aplicarDanioAutorizado,
  aplicarDanioLocalizadoAutorizado
} from "../combat/damage-authorized.js";

// =========================
// INIT MTROL
// =========================

export async function initMtrol() {

  console.log("=================================");
  console.log("MTROL | INIT");
  console.log("=================================");

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

  game.mtrol.aplicarDanioAutorizado =
    aplicarDanioAutorizado;

  game.mtrol.aplicarDanioLocalizadoAutorizado =
    aplicarDanioLocalizadoAutorizado;

  // =========================
  // PATCH TEMPORAL
  // DEFAULT ACTOR TYPE
  // =========================

  Hooks.on("preCreateActor", (actor) => {

    if (actor.type) return true;

    console.warn(
      "MTROL | Actor sin type detectado. Aplicando type por defecto: personaje"
    );

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

    console.warn(
      "MTROL | Item sin type detectado. Aplicando type por defecto: objeto"
    );

    item.updateSource({
      type: "objeto"
    });

    return true;

  });

  console.log("MTROL | Models registrados.");
  console.log("MTROL | Sheets registradas.");
  console.log("MTROL | Combat runtime registrado.");
  console.log("MTROL | INIT completado.");
}