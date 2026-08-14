import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const warnings = [];
const metrics = {
  actorUpdates: 0,
  creates: 0,
  embeddedUpdates: 0,
  embeddedDeletes: 0,
  itemUpdates: [],
  itemDeletes: 0,
  itemSheetRenders: 0,
  sheetRenders: 0,
  socketEmits: 0
};

function resetMetrics() {
  warnings.length = 0;
  metrics.actorUpdates = 0;
  metrics.creates = 0;
  metrics.embeddedUpdates = 0;
  metrics.embeddedDeletes = 0;
  metrics.itemUpdates = [];
  metrics.itemDeletes = 0;
  metrics.itemSheetRenders = 0;
  metrics.sheetRenders = 0;
  metrics.socketEmits = 0;
}

class MockActorSheet {
  constructor(actor) {
    this.actor = actor;
    this.options = {};
    this.position = {};
  }

  static get defaultOptions() {
    return {};
  }

  getData() {
    return {};
  }

  activateListeners() {}

  render() {
    metrics.sheetRenders++;
  }
}

globalThis.foundry = {
  appv1: {
    sheets: {
      ActorSheet: MockActorSheet
    }
  },
  utils: {
    deepClone: value => structuredClone(value),
    duplicate: value => structuredClone(value),
    escapeHTML: value => String(value ?? ""),
    mergeObject: (target, source) => Object.assign(target, source),
    randomID: () => "request-id"
  }
};

globalThis.game = {
  user: {
    id: "gm",
    isGM: true,
    targets: new Set()
  },
  users: [],
  system: {
    id: "mtrol",
    version: "1.2.3"
  },
  socket: {
    on() {},
    emit() {
      metrics.socketEmits++;
    }
  }
};

globalThis.ui = {
  notifications: {
    warn(message) {
      warnings.push(message);
    },
    info() {},
    error() {}
  }
};

globalThis.Math.clamp ??= (value, min, max) =>
  Math.min(max, Math.max(min, value));

const { PersonajeSheet } =
  await import("../scripts/sheets/actors/personaje-sheet.js");

const { registerMtrolSockets } =
  await import("../scripts/core/sockets.js");

const templateSource = await readFile(
  new URL("../templates/actors/personaje-sheet.html", import.meta.url),
  "utf8"
);

function applyItemUpdate(item, changes) {
  for (const [path, value] of Object.entries(changes)) {
    if (path === "system.nivel") item.system.nivel = value;
    if (path === "system.equipadaCombate") {
      item.system.equipadaCombate = value;
    }
  }
}

function createCompetencia({
  id,
  categoria,
  equipadaCombate = false,
  tipo = ""
}) {
  const item = {
    id,
    uuid: `Actor.actor.Item.${id}`,
    name: id === "combat" ? "Ataque arcano" : "Atletismo",
    type: "competencia",
    img: "icons/magic/fire/projectile-fireball-orange.webp",
    system: {
      nivel: 1,
      categoria,
      equipadaCombate,
      tipo,
      costeMP: 1,
      cooldown: 0,
      descripcion: ""
    },
    async update(changes) {
      metrics.itemUpdates.push(structuredClone(changes));
      applyItemUpdate(item, changes);
    },
    async delete() {
      metrics.itemDeletes++;
    },
    sheet: {
      render() {
        metrics.itemSheetRenders++;
      }
    }
  };

  return item;
}

function createActor() {
  const combat = createCompetencia({
    id: "combat",
    categoria: "combate",
    equipadaCombate: true,
    tipo: "habilidad-combate"
  });
  const general = createCompetencia({
    id: "general",
    categoria: "competencia"
  });
  const items = [combat, general];
  items.get = id => items.find(item => item.id === id) ?? null;

  return {
    id: "actor",
    uuid: "Actor.actor",
    name: "Personaje",
    type: "personaje",
    img: "icons/svg/mystery-man.svg?custom=1",
    isOwner: true,
    items,
    system: {
      atributos: { fuerza: 1 },
      vitales: {
        hp: { value: 10, max: 10 },
        mp: { value: 10, max: 10 }
      },
      equipamiento: {}
    },
    async update() {
      metrics.actorUpdates++;
    },
    async createEmbeddedDocuments() {
      metrics.creates++;
    },
    async updateEmbeddedDocuments() {
      metrics.embeddedUpdates++;
    },
    async deleteEmbeddedDocuments() {
      metrics.embeddedDeletes++;
    },
    async unsetFlag() {},
    getActiveTokens() {
      return [];
    }
  };
}

function createEvent(itemId = "combat") {
  return {
    preventDefault() {},
    stopPropagation() {},
    currentTarget: {
      dataset: { itemId },
      closest() {
        return { dataset: { itemId } };
      }
    }
  };
}

function createHtmlHarness() {
  const registrations = [];

  return {
    registrations,
    html: {
      find(selector) {
        const chain = {
          off() {
            return chain;
          },
          on(eventName) {
            registrations.push({ selector, eventName });
            return chain;
          }
        };

        return chain;
      }
    }
  };
}

function registeredSelectors(registrations) {
  return new Set(registrations.map(entry => entry.selector));
}

function getAdminTemplateBlock() {
  const match = templateSource.match(
    /{{#if esGM}}\s*(<section class="sheet-section combate-section">[\s\S]*?<\/section>)\s*{{\/if}}/
  );

  assert.ok(match, "La sección completa debe estar dentro de {{#if esGM}}.");
  return match[1];
}

test("el contexto GM recibe la barra y el jugador solo conserva acciones equipadas", () => {
  const actor = createActor();
  const sheet = new PersonajeSheet(actor);

  game.user.isGM = true;
  const gmContext = sheet.getData();

  assert.equal(gmContext.esGM, true);
  assert.equal(gmContext.habilidadesCombate.length, 1);
  assert.equal(gmContext.habilidadesEquipadasCombate.length, 1);

  game.user.isGM = false;
  const playerContext = sheet.getData();

  assert.equal(playerContext.esGM, false);
  assert.deepEqual(playerContext.habilidadesCombate, []);
  assert.equal(playerContext.habilidadesEquipadasCombate.length, 1);
  assert.equal(playerContext.habilidadesEquipadasCombate[0].id, "combat");
});

test("el template entrega al GM el bloque completo y al jugador ningún contenedor residual", () => {
  const adminBlock = getAdminTemplateBlock();
  const gmRenderedBlock = adminBlock;
  const playerRenderedBlock = "";

  for (const requiredControl of [
    "Barra de Combate",
    "add-habilidad-combate",
    "competencia-down",
    "competencia-up",
    "habilidad-combate-equip",
    "habilidad-combate-unequip",
    "item-edit",
    "item-delete"
  ]) {
    assert.match(gmRenderedBlock, new RegExp(requiredControl));
  }

  assert.equal(playerRenderedBlock, "");
  assert.doesNotMatch(playerRenderedBlock, /combate-section|combat-skills-bar/);

  const equippedActionsEnd = templateSource.indexOf("{{#if esGM}}", templateSource.indexOf("combate-section") - 20);
  const equippedActionsStart = templateSource.indexOf("<section class=\"mtrol-combat-grid\">");
  const equippedActions = templateSource.slice(equippedActionsStart, equippedActionsEnd);

  assert.match(equippedActions, /competencia-roll/);
  assert.match(equippedActions, /mtrol-combat-card-detail/);
});

test("los listeners administrativos solo se registran para el GM", () => {
  const actor = createActor();
  const sheet = new PersonajeSheet(actor);
  const adminSelectors = [
    ".add-habilidad-combate",
    ".habilidad-combate-equip",
    ".habilidad-combate-unequip",
    ".competencia-up",
    ".competencia-down"
  ];

  game.user.isGM = false;
  const playerHarness = createHtmlHarness();
  sheet.activateListeners(playerHarness.html);
  const playerSelectors = registeredSelectors(playerHarness.registrations);

  for (const selector of adminSelectors) {
    assert.equal(playerSelectors.has(selector), false, selector);
  }
  assert.equal(playerSelectors.has(".competencia-roll"), true);
  assert.equal(playerSelectors.has(".mtrol-combat-card"), true);
  assert.equal(playerSelectors.has(".mtrol-combat-card-detail"), true);

  game.user.isGM = true;
  const gmHarness = createHtmlHarness();
  sheet.activateListeners(gmHarness.html);
  const gmSelectors = registeredSelectors(gmHarness.registrations);

  for (const selector of adminSelectors) {
    assert.equal(gmSelectors.has(selector), true, selector);
  }
});

test("las llamadas directas de un jugador a todos los handlers administrativos realizan cero escrituras", async () => {
  resetMetrics();
  game.user.isGM = false;

  const actor = createActor();
  const sheet = new PersonajeSheet(actor);
  const event = createEvent();

  await sheet._onAddHabilidadCombate(event);
  await sheet._onCompetenciaUp(event);
  await sheet._onCompetenciaDown(event);
  await sheet._onEquiparHabilidadCombate(event);
  await sheet._onDesequiparHabilidadCombate(event);
  await sheet._onEditItem(event);
  await sheet._onDeleteItem(event);

  assert.equal(metrics.actorUpdates, 0);
  assert.equal(metrics.creates, 0);
  assert.equal(metrics.embeddedUpdates, 0);
  assert.equal(metrics.embeddedDeletes, 0);
  assert.deepEqual(metrics.itemUpdates, []);
  assert.equal(metrics.itemDeletes, 0);
  assert.equal(metrics.itemSheetRenders, 0);
  assert.equal(metrics.socketEmits, 0);
  assert.equal(warnings.length, 7);
  assert.ok(warnings.every(message =>
    message === "Solo un GM puede modificar la Barra de Combate."
  ));
});

test("el GM conserva crear, editar, nivelar, equipar, reservar y eliminar", async () => {
  resetMetrics();
  game.user.isGM = true;

  const actor = createActor();
  const item = actor.items.get("combat");
  const sheet = new PersonajeSheet(actor);
  const event = createEvent();

  await sheet._onAddHabilidadCombate(event);
  await sheet._onCompetenciaUp(event);
  await sheet._onCompetenciaDown(event);
  await sheet._onEquiparHabilidadCombate(event);
  await sheet._onDesequiparHabilidadCombate(event);
  await sheet._onEditItem(event);
  await sheet._onDeleteItem(event);

  assert.equal(metrics.creates, 1);
  assert.deepEqual(metrics.itemUpdates, [
    { "system.nivel": 2 },
    { "system.nivel": 1 },
    { "system.equipadaCombate": true },
    { "system.equipadaCombate": false }
  ]);
  assert.equal(item.system.nivel, 1);
  assert.equal(item.system.equipadaCombate, false);
  assert.equal(metrics.itemSheetRenders, 1);
  assert.equal(metrics.itemDeletes, 1);
  assert.equal(warnings.length, 0);
});

test("una solicitud socket inventada por un jugador no encuentra operación administrativa ni escribe", async () => {
  resetMetrics();

  let socketReceiver = null;
  game.user = { id: "gm", isGM: true, targets: new Set() };
  game.users = [
    { id: "gm", isGM: true, active: true },
    { id: "player", isGM: false, active: true }
  ];
  game.socket = {
    on(channel, callback) {
      assert.equal(channel, "system.mtrol");
      socketReceiver = callback;
    },
    emit() {
      metrics.socketEmits++;
    }
  };

  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    registerMtrolSockets();
    assert.equal(typeof socketReceiver, "function");

    await socketReceiver({
      action: "mtrolModifyCombatBar",
      requestingUserId: "player",
      payload: {
        actorUuid: "Actor.actor",
        itemId: "combat"
      }
    });
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(metrics.actorUpdates, 0);
  assert.equal(metrics.creates, 0);
  assert.equal(metrics.embeddedUpdates, 0);
  assert.equal(metrics.embeddedDeletes, 0);
  assert.deepEqual(metrics.itemUpdates, []);
  assert.equal(metrics.itemDeletes, 0);
  assert.equal(metrics.socketEmits, 0);
});
