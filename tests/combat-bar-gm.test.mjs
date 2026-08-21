import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const warnings = [];
const metrics = {
  actorUpdates: 0,
  creates: 0,
  createdDocuments: [],
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
  metrics.createdDocuments = [];
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

  async _updateObject(_event, formData) {
    return structuredClone(formData);
  }

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
const progressionStyleSource = await readFile(
  new URL("../styles/sheets/progresion.css", import.meta.url),
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
  tipo = "",
  formula = ""
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
      descripcion: "",
      formula
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
    tipo: "habilidad-combate",
    formula: "1d10 + 1"
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
      recursos: { nivel: 1, exp: 0, mvp: 0, dharma: 2, karma: 0 },
      progression: {
        missionsCompleted: 0,
        dungeonsCompleted: 0,
        meritCredits: 0,
        defeatedLevel5Enemy: false,
        dmApproval: false
      },
      pendingAdvancement: {
        attributePoints: 0,
        competencePoints: 0
      },
      orbs: [],
      vitales: {
        hp: { value: 10, max: 10 },
        mp: { value: 10, max: 10 }
      },
      equipamiento: {}
    },
    async update() {
      metrics.actorUpdates++;
    },
    async createEmbeddedDocuments(documentName, documents) {
      metrics.creates++;
      metrics.createdDocuments.push({
        documentName,
        documents: structuredClone(documents)
      });
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
  assert.equal(gmContext.progressionEvaluation.nextLevel, 2);
  assert.equal(gmContext.progressionEvaluation.eligible, false);

  game.user.isGM = false;
  const playerContext = sheet.getData();

  assert.equal(playerContext.esGM, false);
  assert.deepEqual(playerContext.habilidadesCombate, []);
  assert.equal(playerContext.habilidadesEquipadasCombate.length, 1);
  assert.equal(playerContext.habilidadesEquipadasCombate[0].id, "combat");
  assert.equal(playerContext.habilidadesEquipadasCombate[0].mtrolDharmaEnabled, true);
  assert.equal(playerContext.habilidadesEquipadasCombate[0].mtrolRollFormula, "1d10 + 1");
  assert.equal(playerContext.competenciasGenerales[0].mtrolDharmaEligible, false);
});

test("solo el GM puede editar HP/MP aunque el jugador sea Owner", () => {
  const actor = createActor();
  const sheet = new PersonajeSheet(actor);

  game.user.isGM = true;
  assert.equal(sheet.getData().puedeEditarVitales, true);

  game.user.isGM = false;
  actor.isOwner = true;
  assert.equal(sheet.getData().puedeEditarVitales, false);
  actor.isOwner = false;
  assert.equal(sheet.getData().puedeEditarVitales, false);
});

test("el submit de jugador elimina HP/MP value y max sin perder otros campos permitidos", async () => {
  game.user.isGM = false;
  const sheet = new PersonajeSheet(createActor());
  const submitted = await sheet._updateObject(null, {
    "system.vitales.hp.value": 1,
    "system.vitales.hp.max": 999,
    "system.vitales.mp.value": 2,
    "system.vitales.mp.max": 999,
    "system.recursos.mvp": 99,
    "system.progression.missionsCompleted": 99,
    "system.progression.dungeonsCompleted": 99,
    "system.progression.meritCredits": 99,
    "system.progression.defeatedLevel5Enemy": true,
    "system.progression.dmApproval": true,
    "system.pendingAdvancement.attributePoints": 99,
    "system.pendingAdvancement.competencePoints": 99,
    "system.nombrePublico": "Permitido"
  });

  assert.deepEqual(submitted, {
    "system.nombrePublico": "Permitido"
  });
});

test("el submit GM conserva HP/MP y campos administrativos de progresión", async () => {
  game.user.isGM = true;
  const sheet = new PersonajeSheet(createActor());
  const submitted = await sheet._updateObject(null, {
    "system.vitales.hp.value": 8,
    "system.vitales.hp.max": 12,
    "system.vitales.mp.value": 7,
    "system.vitales.mp.max": 11,
    "system.recursos.mvp": 27,
    "system.progression.missionsCompleted": 5,
    "system.progression.dungeonsCompleted": 1,
    "system.progression.meritCredits": 8,
    "system.progression.defeatedLevel5Enemy": true,
    "system.progression.dmApproval": true
  });

  assert.equal(Object.keys(submitted).length, 10);
  assert.equal(submitted["system.vitales.hp.max"], 12);
  assert.equal(submitted["system.vitales.mp.max"], 11);
  assert.equal(submitted["system.recursos.mvp"], 27);
  assert.equal(submitted["system.progression.missionsCompleted"], 5);
  assert.equal(submitted["system.progression.dmApproval"], true);
});

test("la UI de Fase 3 usa evaluación dinámica, checklist y controles protegidos", () => {
  assert.match(templateSource, /progressionEvaluation\.expProgress\.text/);
  assert.match(templateSource, /progressionEvaluation\.expProgress\.percent/);
  assert.match(templateSource, /progressionEvaluation\.requirements/);
  assert.match(templateSource, /{{#if esGM}}\s*<div class="progresion-admin-grid">[\s\S]*?system\.progression\.missionsCompleted/);
  assert.match(templateSource, /{{#if esGM}}\s*<div class="progresion-admin-grid">[\s\S]*?system\.progression\.dmApproval/);
  assert.match(progressionStyleSource, /width:\s*var\(--progresion-exp, 0%\)/);
  assert.doesNotMatch(progressionStyleSource, /\.progresion-exp-bar span\s*{[^}]*width:\s*42%/s);
  assert.doesNotMatch(templateSource, /subir(?:-|\s+)?de(?:-|\s+)?nivel[^<]*<button/i);
});

test("el contexto visual conserva valores reales y sólo transforma presentación", () => {
  const actor = createActor();
  actor.system.recursos.nivel = 2;
  actor.system.recursos.exp = 18750;
  actor.system.recursos.mvp = 27;

  const context = new PersonajeSheet(actor).getData();
  const mvp = context.progressionEvaluation.requirements.find(requirement => requirement.key === "mvp");
  const exp = context.progressionEvaluation.requirements.find(requirement => requirement.key === "exp");

  assert.deepEqual({
    label: mvp.label,
    icon: mvp.icon,
    valueText: mvp.valueText,
    stateLabel: mvp.stateLabel,
    met: mvp.met
  }, {
    label: "MVP",
    icon: "fa-trophy",
    valueText: "27 / 20",
    stateLabel: "COMPLETADO",
    met: true
  });
  assert.equal(exp.label, "EXPERIENCIA");
  assert.equal(exp.valueText, "18.750 / 15.000");
});

test("Fase 4 expone level-up sólo en bloque GM y mejoras pending sin edición directa", () => {
  assert.match(templateSource, /{{#if esGM}}[\s\S]*?{{#if progressionEvaluation\.eligible}}[\s\S]*?class="mtrol-level-up"/);
  assert.match(templateSource, /{{#if mtrolPendingAdvancement\.hasAny}}/);
  assert.match(templateSource, /class="mtrol-pending-attribute-select"/);
  assert.match(templateSource, /class="mtrol-pending-competence-select"/);
  assert.doesNotMatch(templateSource, /name="system\.pendingAdvancement\./);
});

test("contexto pending ofrece sólo competencias estrictas bajo cap", () => {
  const actor = createActor();
  actor.system.pendingAdvancement = { attributePoints: 2, competencePoints: 1 };
  actor.system.atributos.fuerza = 5;
  actor.items[0].system.nivel = 5;
  actor.items.push(createCompetencia({ id: "spell", categoria: "hechizo" }));

  const context = new PersonajeSheet(actor).getData();

  assert.equal(context.mtrolPendingAdvancement.hasAny, true);
  assert.equal(context.mtrolPendingAdvancement.attributePoints, 2);
  assert.equal(context.mtrolPendingAdvancement.attributeOptions.some(option => option.key === "fuerza"), false);
  assert.equal(context.mtrolPendingAdvancement.competenceOptions.some(option => option.id === "combat"), false);
  assert.equal(context.mtrolPendingAdvancement.competenceOptions.some(option => option.id === "spell"), false);
  assert.equal(context.mtrolPendingAdvancement.competenceOptions.some(option => option.id === "general"), true);
});

test("selects de Progresión definen tinta y fondos contrastantes en todos sus estados", () => {
  assert.match(progressionStyleSource, /\.mtrol-tab-progresion\s+select\s*{[^}]*color:\s*#f(?:ff0c2|3e3b0)/s);
  assert.match(progressionStyleSource, /\.mtrol-tab-progresion\s+select:focus\s*{/);
  assert.match(progressionStyleSource, /\.mtrol-tab-progresion\s+select\s+option\s*{[^}]*background:/s);
  assert.match(progressionStyleSource, /\.mtrol-tab-progresion\s+select\s+option:checked\s*{/);
});

test("Fase 5 prepara múltiples Orbes por ID estable y tipos disponibles sin duplicados", () => {
  const actor = createActor();
  actor.system.orbs = [
    { id: "ignis-one", type: "ignis", level: 5 },
    { id: "aqua-one", type: "aqua", level: 4 }
  ];

  const context = new PersonajeSheet(actor).getData();

  assert.deepEqual(context.mtrolOrbs.map(orb => ({
    id: orb.id,
    type: orb.type,
    level: orb.level,
    levelName: orb.levelName,
    rollBonus: orb.rollBonus
  })), [
    { id: "ignis-one", type: "ignis", level: 5, levelName: "Primordial", rollBonus: 5 },
    { id: "aqua-one", type: "aqua", level: 4, levelName: "Ancestral", rollBonus: 2 }
  ]);
  assert.equal(context.mtrolOrbAddOptions.some(option => option.value === "ignis"), false);
  assert.equal(context.mtrolOrbAddOptions.some(option => option.value === "aqua"), false);
  assert.match(context.mtrolOrbs[0].passiveName, /Calcinatio/);
});

test("Fase 5 expone administración de Orbes sólo dentro del bloque GM", () => {
  assert.match(templateSource, /class="progresion-orb-row" data-orb-id="{{id}}"/);
  assert.match(templateSource, /{{#if \.\.\/esGM}}[\s\S]*?class="mtrol-orb-type"[\s\S]*?class="mtrol-orb-delete"/);
  assert.match(templateSource, /{{#if esGM}}[\s\S]*?class="mtrol-orb-add"/);
  assert.doesNotMatch(templateSource, /name="system\.orbs/);
  assert.match(templateSource, /Pasiva: {{passiveName}}/);
  assert.match(templateSource, /Bonus de tirada: \+{{rollBonus}}/);
});

test("Dharma cero deshabilita Atributos, Competencias y Combate en el contexto", () => {
  const actor = createActor();
  actor.system.recursos.dharma = 0;
  const context = new PersonajeSheet(actor).getData();

  assert.equal(context.mtrolDharmaEnabled, false);
  assert.equal(context.habilidadesEquipadasCombate[0].mtrolDharmaEnabled, false);
  assert.equal(context.competenciasGenerales[0].mtrolDharmaEnabled, false);
  assert.match(context.mtrolDharmaTitle, /No tienes Dharma/);
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
    ".mtrol-level-up",
    ".add-habilidad-combate",
    ".habilidad-combate-equip",
    ".habilidad-combate-unequip",
    ".competencia-up",
    ".competencia-down",
    ".mtrol-orb-add",
    ".mtrol-orb-type, .mtrol-orb-level",
    ".mtrol-orb-delete"
  ];

  game.user.isGM = false;
  const playerHarness = createHtmlHarness();
  sheet.activateListeners(playerHarness.html);
  const playerSelectors = registeredSelectors(playerHarness.registrations);

  for (const selector of adminSelectors) {
    assert.equal(playerSelectors.has(selector), false, selector);
  }
  assert.equal(playerSelectors.has(".competencia-roll"), true);
  assert.equal(playerSelectors.has(".mtrol-dharma-prepare"), true);
  assert.equal(playerSelectors.has(".mtrol-combat-card"), true);
  assert.equal(playerSelectors.has(".mtrol-combat-card-detail"), true);
  assert.equal(playerSelectors.has(".mtrol-spend-pending-attribute"), true);
  assert.equal(playerSelectors.has(".mtrol-spend-pending-competence"), true);

  game.user.isGM = true;
  const gmHarness = createHtmlHarness();
  sheet.activateListeners(gmHarness.html);
  const gmSelectors = registeredSelectors(gmHarness.registrations);

  for (const selector of adminSelectors) {
    assert.equal(gmSelectors.has(selector), true, selector);
  }
  assert.equal(gmSelectors.has(".mtrol-dharma-prepare"), true);
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

test("un jugador sin GM activo aborta una competencia con coste antes de tirar o emitir sockets", async () => {
  resetMetrics();
  game.user = { id: "player", isGM: false, targets: new Set() };
  game.users = [
    { id: "player", isGM: false, active: true }
  ];

  const sheet = new PersonajeSheet(createActor());

  await sheet._onCompetenciaRoll(createEvent("combat"));

  assert.deepEqual(warnings, [
    "Se requiere un GM conectado para resolver esta acción."
  ]);
  assert.equal(metrics.socketEmits, 0);
  assert.equal(metrics.actorUpdates, 0);
});

test("el GM sólo nivela Competencias reales y conserva el resto de la administración", async () => {
  resetMetrics();
  game.user.isGM = true;

  const actor = createActor();
  const item = actor.items.get("combat");
  const sheet = new PersonajeSheet(actor);
  const event = createEvent();

  await sheet._onAddHabilidadCombate(event);
  await sheet._onCompetenciaUp(event);
  await sheet._onCompetenciaDown(event);
  await sheet._onCompetenciaUp(createEvent("general"));
  await sheet._onCompetenciaDown(createEvent("general"));
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
  assert.deepEqual(warnings, [
    "Este Item no es una competencia de progresión.",
    "Este Item no es una competencia de progresión."
  ]);
});

test("los payloads de creación de Competencia y Habilidad de Combate delegan Rol al schema", async () => {
  resetMetrics();
  game.user.isGM = true;

  const sheet = new PersonajeSheet(createActor());
  const event = createEvent();

  await sheet._onAddCompetencia(event);
  await sheet._onAddHabilidadCombate(event);

  assert.equal(metrics.creates, 2);
  assert.equal(metrics.createdDocuments.length, 2);

  const [competencia, combate] = metrics.createdDocuments.map(entry => {
    assert.equal(entry.documentName, "Item");
    assert.equal(entry.documents.length, 1);
    return entry.documents[0];
  });

  assert.equal(competencia.system.categoria, "competencia");
  assert.equal(combate.system.categoria, "combate");
  assert.equal(Object.hasOwn(competencia.system, "rol"), false);
  assert.equal(Object.hasOwn(combate.system, "rol"), false);

  for (const created of [competencia, combate]) {
    assert.equal(created.system.damageResolution, "immediate");
    assert.equal(created.system.damageMode, "automatic");
    assert.equal(created.system.damageCostType, "none");
  }
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
