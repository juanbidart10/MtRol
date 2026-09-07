import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const warnings = [];
const metrics = {
  actorUpdates: 0,
  actorUpdatePayloads: [],
  actorUpdateOptions: [],
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
  metrics.actorUpdatePayloads = [];
  metrics.actorUpdateOptions = [];
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

let randomIdSequence = 0;
let dialogDecision = "cancel";

globalThis.Dialog = class MockDialog {
  constructor(options) { this.options = options; }
  render() {
    this.options.buttons[dialogDecision]?.callback?.();
    return this;
  }
};

globalThis.foundry = {
  applications: {
    apps: {
      FilePicker: {
        implementation: class MockFilePicker {
          static selectedPath = "";

          constructor(options) {
            this.options = options;
          }

          async browse() {
            if (this.constructor.selectedPath) {
              await this.options.callback(this.constructor.selectedPath);
            }
          }
        }
      }
    }
  },
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
    randomID: () => `request-id-${++randomIdSequence}`
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
const personajeStyleSource = await readFile(
  new URL("../styles/sheets/personaje.css", import.meta.url),
  "utf8"
);

function applyItemUpdate(item, changes) {
  for (const [path, value] of Object.entries(changes)) {
    if (path === "img") item.img = value;
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

function applyActorUpdate(actor, changes) {
  for (const [path, value] of Object.entries(changes)) {
    const parts = path.split(".");
    let target = actor;
    for (const part of parts.slice(0, -1)) {
      target[part] ??= {};
      target = target[part];
    }
    target[parts.at(-1)] = value;
  }
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
      identidad: { clase: "", classId: "" },
      atributos: { fuerza: 1, resistencia: 2, inteligencia: 4 },
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
      resourceModifiers: {
        hp: { value: 0, label: "" },
        mp: { value: 0, label: "" }
      },
      equipamiento: {}
    },
    async update(changes, options = {}) {
      metrics.actorUpdates++;
      metrics.actorUpdatePayloads.push(structuredClone(changes));
      metrics.actorUpdateOptions.push(structuredClone(options));
      applyActorUpdate(this, changes);
    },
    async createEmbeddedDocuments(documentName, documents) {
      metrics.creates++;
      metrics.createdDocuments.push({
        documentName,
        documents: structuredClone(documents)
      });
      const created = documents.map((document, index) => ({
        ...structuredClone(document),
        id: `created-${items.length + index + 1}`
      }));
      items.push(...created);
      return created;
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

function createResourceConfigEvent(configKey, value) {
  const eventMetrics = { prevented: 0, stopped: 0, immediate: 0 };
  return {
    eventMetrics,
    preventDefault() {
      eventMetrics.prevented++;
    },
    stopPropagation() {
      eventMetrics.stopped++;
    },
    stopImmediatePropagation() {
      eventMetrics.immediate++;
    },
    currentTarget: {
      value,
      dataset: { configKey }
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
  assert.equal(playerContext.combatLibrary.groups.length, 1);
  assert.equal(playerContext.combatLibrary.physicalActions[0].id, "combat");
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

test("Fase 5 prepara las 26 Clases canónicas y nunca infiere desde el label legacy", () => {
  const actor = createActor();
  actor.system.identidad.clase = "Mago";
  actor.system.identidad.classId = "";

  game.user.isGM = true;
  const legacyContext = new PersonajeSheet(actor).getData();

  assert.equal(legacyContext.classOptions.length, 26);
  assert.equal(legacyContext.selectedClassId, "");
  assert.equal(legacyContext.selectedClassLabel, "Sin clase seleccionada");
  assert.equal(legacyContext.canManageClass, true);
  assert.equal(legacyContext.canManageResourceModifiers, true);
  assert.deepEqual(
    legacyContext.classOptions.slice(0, 3).map(option => option.id),
    ["asesino", "bandido", "caballero"]
  );
  assert.equal(
    legacyContext.classOptions.find(option => option.id === "mago")?.label,
    "Mago"
  );
  assert.equal(
    legacyContext.classOptions.find(option => option.id === "espadachin")?.label,
    "Espadachín"
  );
  assert.equal(legacyContext.classOptions.some(option => option.selected), false);

  actor.system.identidad.classId = "mago";
  actor.system.identidad.clase = "Texto legacy incorrecto";
  const activeContext = new PersonajeSheet(actor).getData();
  assert.equal(activeContext.selectedClassId, "mago");
  assert.equal(activeContext.selectedClassLabel, "Mago");
  assert.equal(
    activeContext.classOptions.find(option => option.id === "mago")?.selected,
    true
  );

  game.user.isGM = false;
  const playerContext = new PersonajeSheet(actor).getData();
  assert.equal(playerContext.selectedClassLabel, "Mago");
  assert.equal(playerContext.canManageClass, false);
  assert.equal(playerContext.canManageResourceModifiers, false);
});

test("Fase 5 usa controles semánticos sin names persistentes y mantiene permisos visuales", () => {
  assert.match(templateSource, /{{#if canManageClass}}[\s\S]*?<select[^>]*class="[^"]*mtrol-class-select[^"]*"/);
  assert.match(templateSource, /{{#each classOptions}}[\s\S]*?value="{{id}}"/);
  assert.match(templateSource, /{{#if selected}}selected{{\/if}}/);
  assert.match(templateSource, /{{else}}[\s\S]*?class="mtrol-class-readonly"[\s\S]*?{{selectedClassLabel}}/);
  assert.match(templateSource, /{{#if canManageResourceModifiers}}[\s\S]*?class="mtrol-resource-admin"/);
  assert.match(templateSource, /{{#each resourceModifierEntries}}/);
  assert.match(templateSource, /class="mtrol-resource-modifier-add"/);
  assert.match(templateSource, /class="mtrol-resource-modifier-delete"/);
  assert.match(templateSource, /class="mtrol-resource-admin-footer"[\s\S]*?class="mtrol-resource-modifier-add"/);
  assert.match(templateSource, /data-resource="hp" data-field="value"/);
  assert.match(templateSource, /data-resource="hp" data-field="label"/);
  assert.match(templateSource, /data-resource="mp" data-field="value"/);
  assert.match(templateSource, /data-resource="mp" data-field="label"/);
  assert.doesNotMatch(templateSource, /name="system\.identidad\.classId"/);
  assert.doesNotMatch(templateSource, /name="system\.resourceModifiers\./);
  assert.match(templateSource, /name="system\.vitales\.hp\.max"[\s\S]*?{{#unless puedeEditarVitalesMax}}disabled/);
  assert.match(templateSource, /name="system\.vitales\.mp\.max"[\s\S]*?{{#unless puedeEditarVitalesMax}}disabled/);
  assert.match(personajeStyleSource, /\.mtrol-resource-admin-entry\s*{[\s\S]*?grid-template-columns:\s*repeat\(2,/);
  assert.match(personajeStyleSource, /\.mtrol-resource-admin-entry\s*{[\s\S]*?grid-template-areas:\s*"hp mp"/);
  assert.match(personajeStyleSource, /\.mtrol-resource-modifier-delete\s*{[\s\S]*?right:\s*7px\s*!important[\s\S]*?left:\s*auto\s*!important/);
  assert.match(personajeStyleSource, /@container mtrol-sheet \(max-width: 520px\)[\s\S]*?\.mtrol-resource-admin-entry\s*{[\s\S]*?grid-template-columns:\s*1fr/);
});

test("handler GM de Clase usa una única escritura autoritativa y detiene el submit genérico", async () => {
  resetMetrics();
  const actor = createActor();
  actor.system.recursos.nivel = 3;
  actor.system.vitales.hp = { value: 27, max: 30 };
  actor.system.vitales.mp = { value: 19, max: 25 };
  const sheet = new PersonajeSheet(actor);

  game.user = { id: "gm", isGM: true, targets: new Set() };
  game.users = [game.user];
  const event = createResourceConfigEvent("classId", "mago");

  await sheet._onClassResourceConfigurationChange(event);

  assert.equal(metrics.actorUpdates, 1);
  assert.equal(metrics.actorUpdateOptions[0].mtrolClassResourceTransition, true);
  assert.equal(actor.system.identidad.classId, "mago");
  assert.equal(actor.system.identidad.clase, "Mago");
  assert.deepEqual(actor.system.vitales.hp, { value: 37, max: 40 });
  assert.deepEqual(actor.system.vitales.mp, { value: 64, max: 70 });
  assert.deepEqual(event.eventMetrics, { prevented: 1, stopped: 1, immediate: 1 });
  assert.equal(sheet.getData().selectedClassLabel, "Mago");
  assert.equal(sheet.getData().puedeEditarVitalesMax, false);
  assert.equal(metrics.sheetRenders, 0);
});

test("handlers GM de modifier y label realizan una escritura por intención sin calcular en Sheet", async () => {
  resetMetrics();
  const actor = createActor();
  actor.system.identidad = { classId: "mago", clase: "Mago" };
  actor.system.recursos.nivel = 3;
  actor.system.vitales.hp = { value: 37, max: 40 };
  actor.system.vitales.mp = { value: 64, max: 70 };
  const sheet = new PersonajeSheet(actor);

  game.user = { id: "gm", isGM: true, targets: new Set() };
  game.users = [game.user];

  await sheet._onClassResourceConfigurationChange(
    createResourceConfigEvent("hpModifier", "10")
  );
  assert.equal(metrics.actorUpdates, 1);
  assert.equal(actor.system.resourceModifiers.hp.value, 10);
  assert.deepEqual(actor.system.vitales.hp, { value: 47, max: 50 });

  await sheet._onClassResourceConfigurationChange(
    createResourceConfigEvent("mpModifier", "10")
  );
  assert.equal(metrics.actorUpdates, 2);
  assert.equal(actor.system.resourceModifiers.mp.value, 10);
  assert.deepEqual(actor.system.vitales.mp, { value: 74, max: 80 });

  const vitalsBeforeLabel = structuredClone(actor.system.vitales);
  await sheet._onClassResourceConfigurationChange(
    createResourceConfigEvent("hpModifierLabel", "Bendición de Dios")
  );
  assert.equal(metrics.actorUpdates, 3);
  assert.equal(actor.system.resourceModifiers.hp.label, "Bendición de Dios");
  assert.deepEqual(actor.system.vitales, vitalsBeforeLabel);
  assert.equal(
    Object.keys(metrics.actorUpdatePayloads[2]).some(path => path.startsWith("system.vitales.")),
    false
  );

  await sheet._onClassResourceConfigurationChange(
    createResourceConfigEvent("hpModifier", "0")
  );
  await sheet._onClassResourceConfigurationChange(
    createResourceConfigEvent("mpModifier", "0")
  );
  assert.equal(metrics.actorUpdates, 5);
  assert.deepEqual(actor.system.vitales.hp, { value: 37, max: 40 });
  assert.deepEqual(actor.system.vitales.mp, { value: 64, max: 70 });
});

test("handler administrativo invocado por Player no escribe", async () => {
  resetMetrics();
  const actor = createActor();
  const sheet = new PersonajeSheet(actor);
  game.user = { id: "player", isGM: false, targets: new Set() };
  game.users = [game.user];

  await sheet._onClassResourceConfigurationChange(
    createResourceConfigEvent("classId", "mago")
  );

  assert.equal(metrics.actorUpdates, 0);
  assert.match(warnings.at(-1), /Solo un GM/);
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
    "system.identidad.classId": "mago",
    "system.resourceModifiers.hp.value": 100,
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
    "system.progression.dmApproval": true,
    "system.identidad.classId": "mago",
    "system.resourceModifiers.hp.value": 100,
    "system.resourceModifiers.mp.label": "forjado"
  });

  assert.equal(Object.keys(submitted).length, 10);
  assert.equal(submitted["system.vitales.hp.max"], 12);
  assert.equal(submitted["system.vitales.mp.max"], 11);
  assert.equal(submitted["system.recursos.mvp"], 27);
  assert.equal(submitted["system.progression.missionsCompleted"], 5);
  assert.equal(submitted["system.progression.dmApproval"], true);
  assert.equal(Object.hasOwn(submitted, "system.identidad.classId"), false);
  assert.equal(Object.keys(submitted).some(key => key.startsWith("system.resourceModifiers")), false);
});

test("la UI de Fase 3 usa evaluación dinámica, checklist y controles protegidos", () => {
  assert.match(templateSource, /progressionEvaluation\.globalProgress\.text/);
  assert.match(templateSource, /progressionEvaluation\.globalProgress\.percent/);
  assert.match(templateSource, /progressionEvaluation\.requirements/);
  assert.match(templateSource, /{{#if esGM}}\s*<div class="progresion-admin-grid">[\s\S]*?system\.progression\.missionsCompleted/);
  assert.match(templateSource, /{{#if esGM}}\s*<div class="progresion-admin-grid">[\s\S]*?system\.progression\.dmApproval/);
  assert.match(progressionStyleSource, /width:\s*var\(--progresion-global-progress, 0%\)/);
  assert.doesNotMatch(progressionStyleSource, /\.progresion-global-progress[^}]*width:\s*42%/s);
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
  assert.match(templateSource, /{{#if esGM}}[\s\S]*?class="mtrol-level-up progresion-ascension-orb/);
  assert.match(templateSource, /{{#if mtrolPendingAdvancement\.hasAny}}/);
  assert.match(templateSource, /class="mtrol-pending-attribute-select"/);
  assert.match(templateSource, /class="mtrol-pending-competence-select"/);
  assert.doesNotMatch(templateSource, /name="system\.pendingAdvancement\./);
});

test("el Orbe cancela con cero escrituras y confirma mediante el servicio autoritativo", async () => {
  const actor = createActor();
  actor.system.recursos.exp = 1000;
  actor.system.recursos.mvp = 1;
  actor.system.progression.missionsCompleted = 1;
  actor.items.get("general").system.nivel = 3;
  game.user = { id: "gm", isGM: true, targets: new Set() };
  game.users = [game.user];
  const sheet = new PersonajeSheet(actor);
  const button = { disabled: false, isConnected: true };
  const event = { preventDefault() {}, currentTarget: button };

  resetMetrics();
  dialogDecision = "cancel";
  assert.equal(await sheet._onLevelUp(event), false);
  assert.equal(metrics.actorUpdates, 0);
  assert.equal(actor.system.recursos.nivel, 1);

  dialogDecision = "confirm";
  assert.equal(await sheet._onLevelUp(event), true);
  assert.equal(metrics.actorUpdates, 1);
  assert.equal(actor.system.recursos.nivel, 2);
  assert.equal(actor.system.pendingAdvancement.attributePoints, 1);
  assert.equal(actor.system.pendingAdvancement.competencePoints, 1);
  assert.equal(actor.system.vitales.hp.max, 20);
  assert.equal(actor.system.vitales.mp.max, 20);
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
  assert.match(templateSource, /class="progresion-orb-detail-label">Pasiva:<\/span>[\s\S]*?class="progresion-orb-passive-name">{{passiveName}}/);
  assert.match(templateSource, /class="progresion-orb-detail-label">Bonus de tirada:<\/span>[\s\S]*?class="progresion-orb-bonus-value">\+{{rollBonus}}/);
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

test("PersonajeSheet conserva la biblioteca ejecutable y restaura la Barra de Combate solo para GM", () => {
  const combatTab = templateSource.match(
    /<div class="tab mtrol-tab-combate"[\s\S]*?<!-- TAB COMPETENCIAS -->/
  )?.[0] ?? "";

  assert.match(combatTab, /{{#each combatLibrary\.actions}}/);
  assert.match(combatTab, /competencia-roll/);
  assert.match(combatTab, /{{#if esGM}}[\s\S]*?Barra de Combate/);
  assert.match(combatTab, /add-habilidad-combate/);
  assert.match(combatTab, /habilidad-combate-equip/);
  assert.match(combatTab, /habilidad-combate-unequip/);
  assert.match(combatTab, /combat-skills-bar/);
  assert.doesNotMatch(combatTab, /mtrol-combat-card-detail/);
});

test("los listeners administrativos solo se registran para el GM", () => {
  const actor = createActor();
  const sheet = new PersonajeSheet(actor);
  const adminSelectors = [
    ".mtrol-class-resource-control",
    ".mtrol-resource-modifier-entry-control",
    ".mtrol-resource-modifier-add",
    ".mtrol-resource-modifier-delete",
    ".mtrol-level-up",
    ".mtrol-destiny-segment.is-editable[data-resource][data-value]",
    ".competencia-up",
    ".competencia-down",
    ".mtrol-orb-add",
    ".mtrol-orb-type, .mtrol-orb-level",
    ".mtrol-orb-delete",
    ".add-competencia",
    ".competencia-image-edit"
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
  assert.equal(playerSelectors.has(".mtrol-combat-card"), false);
  assert.equal(playerSelectors.has(".mtrol-combat-card-detail"), false);
  assert.equal(playerSelectors.has(".add-habilidad-combate"), false);
  assert.equal(playerSelectors.has(".habilidad-combate-equip"), false);
  assert.equal(playerSelectors.has(".habilidad-combate-unequip"), false);
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
  assert.equal(gmSelectors.has(".add-habilidad-combate"), true);
  assert.equal(gmSelectors.has(".habilidad-combate-equip"), true);
  assert.equal(gmSelectors.has(".habilidad-combate-unequip"), true);
});

test("solo GM cambia y persiste la imagen propia de una competencia", async () => {
  resetMetrics();
  const actor = createActor();
  const sheet = new PersonajeSheet(actor);
  const FilePicker = foundry.applications.apps.FilePicker.implementation;
  FilePicker.selectedPath = "icons/skills/athletics.webp";

  game.user.isGM = false;
  assert.equal(await sheet._onChangeCompetenciaImage(createEvent("general")), false);
  assert.equal(metrics.itemUpdates.length, 0);
  assert.match(warnings.at(-1), /Solo el Game Master/);

  game.user.isGM = true;
  assert.equal(await sheet._onChangeCompetenciaImage(createEvent("general")), true);
  assert.deepEqual(metrics.itemUpdates, [{ img: "icons/skills/athletics.webp" }]);
  assert.equal(actor.items.get("general").img, "icons/skills/athletics.webp");
  FilePicker.selectedPath = "";
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
    assert.equal(created.system.damageResolution, "onOppositionWin");
    assert.equal(created.system.damageMode, "enabled");
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
