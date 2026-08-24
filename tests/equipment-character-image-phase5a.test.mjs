import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const CANCEL_PICKER = Symbol("cancel-picker");
const metrics = {
  updates: [],
  pickerBrowses: 0,
  pickerOptions: [],
  warnings: [],
  errors: []
};
let pickerSelection = CANCEL_PICKER;

class MockField {
  constructor(options = {}) {
    this.options = options;
  }
}

class MockSchemaField extends MockField {
  constructor(fields = {}, options = {}) {
    super(options);
    this.fields = fields;
  }
}

class MockArrayField extends MockField {
  constructor(element, options = {}) {
    super(options);
    this.element = element;
  }
}

class MockActorSheet {
  constructor(actor) {
    this.actor = actor;
    this.options = {};
    this.position = { top: 20, left: 30 };
  }

  static get defaultOptions() { return {}; }
  getData() { return {}; }
  activateListeners() {}
  render() {}
}

class MockFilePicker {
  constructor(options) {
    this.options = options;
    metrics.pickerOptions.push(options);
  }

  async browse() {
    metrics.pickerBrowses += 1;
    if (pickerSelection !== CANCEL_PICKER) {
      await this.options.callback(pickerSelection);
    }
  }
}

globalThis.foundry = {
  data: {
    fields: {
      StringField: MockField,
      NumberField: MockField,
      BooleanField: MockField,
      SchemaField: MockSchemaField,
      ArrayField: MockArrayField,
      HTMLField: MockField
    }
  },
  abstract: {
    TypeDataModel: class {
      static migrateData(source) { return source; }
    }
  },
  appv1: { sheets: { ActorSheet: MockActorSheet } },
  applications: {
    apps: {
      FilePicker: { implementation: MockFilePicker }
    }
  },
  utils: {
    deepClone: value => structuredClone(value),
    duplicate: value => structuredClone(value),
    escapeHTML: value => String(value ?? ""),
    mergeObject: (target, source) => Object.assign(target, source),
    randomID: () => "phase5a"
  }
};

globalThis.game = {
  user: { id: "gm", isGM: true, targets: new Set() },
  users: [],
  system: { id: "mtrol", version: "1.2.5" },
  socket: { emit() {}, on() {} }
};

globalThis.ui = {
  notifications: {
    warn(message) { metrics.warnings.push(message); },
    info() {},
    error(message) { metrics.errors.push(message); }
  }
};

globalThis.Math.clamp ??= (value, min, max) =>
  Math.min(max, Math.max(min, value));

const { PersonajeDataModel } = await import("../models/personaje-model.js");
const { PersonajeSheet } = await import("../scripts/sheets/actors/personaje-sheet.js");

function resetMetrics() {
  metrics.updates = [];
  metrics.pickerBrowses = 0;
  metrics.pickerOptions = [];
  metrics.warnings = [];
  metrics.errors = [];
  pickerSelection = CANCEL_PICKER;
}

function createCollection(items = []) {
  const collection = [...items];
  collection.get = id => collection.find(item => item.id === id) ?? null;
  return collection;
}

function applyUpdate(actor, changes) {
  for (const [path, value] of Object.entries(changes)) {
    if (path === "system.identidad.fullBodyImage") {
      actor.system.identidad.fullBodyImage = value;
    }
  }
}

function createActor({ fullBodyImage, includeField = true, rejectUpdate = false } = {}) {
  const identidad = { titulo: "", clase: "", classId: "" };
  if (includeField) identidad.fullBodyImage = fullBodyImage ?? "";
  const item = {
    id: "sword",
    uuid: "Actor.phase5a.Item.sword",
    name: "Espada",
    type: "objeto",
    img: "icons/svg/item-bag.svg",
    system: {
      tipoObjeto: "arma",
      equipable: true,
      equipado: false,
      slot: "manoDer",
      cantidad: 1,
      peso: 2
    }
  };

  return {
    id: "phase5a",
    uuid: "Actor.phase5a",
    name: "Phase 5A",
    type: "personaje",
    img: "portraits/original.webp",
    prototypeToken: { texture: { src: "tokens/original.webp" } },
    token: { texture: { src: "tokens/placed.webp" } },
    isOwner: true,
    items: createCollection([item]),
    system: {
      identidad,
      atributos: { fuerza: 3, resistencia: 2, inteligencia: 2 },
      recursos: { nivel: 1, exp: 0, mvp: 0, dharma: 0, karma: 0 },
      progression: {
        missionsCompleted: 0,
        dungeonsCompleted: 0,
        meritCredits: 0,
        defeatedLevel5Enemy: false,
        dmApproval: false
      },
      pendingAdvancement: { attributePoints: 0, competencePoints: 0 },
      orbs: [],
      vitales: { hp: { value: 10, max: 10 }, mp: { value: 10, max: 10 } },
      resourceModifiers: {
        hp: { value: 0, label: "" },
        mp: { value: 0, label: "" }
      },
      equipamiento: {}
    },
    testUserPermission() { return true; },
    async update(changes) {
      metrics.updates.push(structuredClone(changes));
      if (rejectUpdate) throw new Error("update rejected");
      applyUpdate(this, changes);
    },
    async createEmbeddedDocuments() {},
    async updateEmbeddedDocuments() {},
    async deleteEmbeddedDocuments() {},
    async unsetFlag() {},
    getActiveTokens() { return []; }
  };
}

function createEvent() {
  return { preventDefault() {} };
}

test.beforeEach(resetMetrics);

test("DataModel declara system.identidad.fullBodyImage con default vacio sin migrar legacy", () => {
  const schema = PersonajeDataModel.defineSchema();
  const legacy = { identidad: { titulo: "Legacy" } };

  assert.ok(schema.identidad.fields.fullBodyImage);
  assert.equal(schema.identidad.fields.fullBodyImage.options.initial, "");
  assert.deepEqual(PersonajeDataModel.migrateData(structuredClone(legacy)), legacy);
});

test("contexto usa fullBodyImage personalizada y mantiene actor.img como retrato", () => {
  const actor = createActor({ fullBodyImage: "characters/full-body.webp" });
  const context = new PersonajeSheet(actor).getData();

  assert.deepEqual(context.equipmentCharacterImage, {
    src: "characters/full-body.webp",
    custom: true,
    fallback: false
  });
  assert.equal(context.actorImg, "portraits/original.webp");
  assert.equal(actor.img, "portraits/original.webp");
});

test("contexto usa actor.img como fallback para campo vacio o Actor antiguo", () => {
  const emptyActor = createActor({ fullBodyImage: "" });
  const legacyActor = createActor({ includeField: false });

  for (const actor of [emptyActor, legacyActor]) {
    const context = new PersonajeSheet(actor).getData();
    assert.deepEqual(context.equipmentCharacterImage, {
      src: "portraits/original.webp",
      custom: false,
      fallback: true
    });
  }

  assert.equal(Object.hasOwn(emptyActor.system.identidad, "fullBodyImage"), true);
  assert.equal(Object.hasOwn(legacyActor.system.identidad, "fullBodyImage"), false);
});

test("GM selecciona una imagen mediante FilePicker y solo actualiza fullBodyImage", async () => {
  const actor = createActor();
  const originalItems = structuredClone([...actor.items]);
  const originalEquipment = structuredClone(actor.system.equipamiento);
  const originalToken = structuredClone(actor.prototypeToken);
  const originalPlacedToken = structuredClone(actor.token);
  pickerSelection = "characters/new-body.png";

  assert.equal(await new PersonajeSheet(actor)._onChangeEquipmentCharacterImage(createEvent()), true);

  assert.equal(metrics.pickerBrowses, 1);
  assert.equal(metrics.pickerOptions[0].type, "image");
  assert.equal(metrics.pickerOptions[0].document, actor);
  assert.deepEqual(metrics.updates, [{
    "system.identidad.fullBodyImage": "characters/new-body.png"
  }]);
  assert.equal(actor.system.identidad.fullBodyImage, "characters/new-body.png");
  assert.equal(actor.img, "portraits/original.webp");
  assert.deepEqual(actor.prototypeToken, originalToken);
  assert.deepEqual(actor.token, originalPlacedToken);
  assert.deepEqual(actor.system.equipamiento, originalEquipment);
  assert.deepEqual([...actor.items], originalItems);
});

test("cancelar el FilePicker no produce update", async () => {
  const actor = createActor();

  await new PersonajeSheet(actor)._onChangeEquipmentCharacterImage(createEvent());

  assert.equal(metrics.pickerBrowses, 1);
  assert.deepEqual(metrics.updates, []);
  assert.equal(actor.system.identidad.fullBodyImage, "");
});

test("un fallo de persistencia no deja estado parcial", async () => {
  const actor = createActor({ rejectUpdate: true });
  pickerSelection = "characters/rejected.webp";

  await new PersonajeSheet(actor)._onChangeEquipmentCharacterImage(createEvent());

  assert.equal(actor.system.identidad.fullBodyImage, "");
  assert.equal(metrics.errors.length, 1);
  assert.equal(actor.img, "portraits/original.webp");
  assert.equal(actor.prototypeToken.texture.src, "tokens/original.webp");
  assert.equal(actor.token.texture.src, "tokens/placed.webp");
});

test("GM quita solo la referencia corporal y el contexto vuelve al fallback", async () => {
  const actor = createActor({ fullBodyImage: "characters/custom.webp" });
  const originalToken = structuredClone(actor.prototypeToken);

  assert.equal(await new PersonajeSheet(actor)._onRemoveEquipmentCharacterImage(createEvent()), true);
  assert.deepEqual(metrics.updates, [{ "system.identidad.fullBodyImage": "" }]);
  assert.equal(actor.img, "portraits/original.webp");
  assert.deepEqual(actor.prototypeToken, originalToken);
  assert.deepEqual(new PersonajeSheet(actor).getData().equipmentCharacterImage, {
    src: "portraits/original.webp",
    custom: false,
    fallback: true
  });
});

test("Owner y Observer no pueden abrir picker ni cambiar o quitar la imagen por llamada directa", async () => {
  for (const user of [
    { id: "owner", isGM: false },
    { id: "observer", isGM: false }
  ]) {
    resetMetrics();
    game.user = { ...user, targets: new Set() };
    const actor = createActor({ fullBodyImage: "characters/custom.webp" });
    pickerSelection = "characters/forbidden.webp";
    const sheet = new PersonajeSheet(actor);

    assert.equal(await sheet._onChangeEquipmentCharacterImage(createEvent()), false);
    assert.equal(await sheet._onRemoveEquipmentCharacterImage(createEvent()), false);
    assert.equal(metrics.pickerBrowses, 0);
    assert.deepEqual(metrics.updates, []);
    assert.equal(actor.system.identidad.fullBodyImage, "characters/custom.webp");
  }
  game.user = { id: "gm", isGM: true, targets: new Set() };
});

test("template separa retrato, imagen corporal y controles administrativos", async () => {
  const template = await readFile(
    new URL("../templates/actors/personaje-sheet.html", import.meta.url),
    "utf8"
  );

  assert.match(template, /class="profile-img"[\s\S]*?src="{{actorImg}}"/);
  assert.match(template, /class="mtrol-equipment-character-image"[\s\S]*?src="{{equipmentCharacterImage\.src}}"/);
  assert.equal((template.match(/src="{{actorImg}}"/g) ?? []).length, 1);
  assert.match(template, /{{#if esGM}}[\s\S]*?mtrol-equipment-character-change/);
  assert.match(template, /{{#if equipmentCharacterImage\.custom}}[\s\S]*?mtrol-equipment-character-remove/);
  assert.doesNotMatch(template, /Usando retrato como imagen provisional/);
  assert.match(template, /title="Imagen recomendada:/);
  assert.match(template, /aria-label="Cambiar imagen de equipamiento"/);
  assert.match(template, /aria-label="Quitar imagen corporal"/);
});

test("implementacion usa FilePicker v14, guardas GM y CSS contain centrado", async () => {
  const sheet = await readFile(
    new URL("../scripts/sheets/actors/personaje-sheet.js", import.meta.url),
    "utf8"
  );
  const style = await readFile(
    new URL("../styles/sheets/inventory-workspace.css", import.meta.url),
    "utf8"
  );

  assert.match(sheet, /new foundry\.applications\.apps\.FilePicker\.implementation\(/);
  assert.match(sheet, /await picker\.browse\(\)/);
  assert.match(sheet, /_onChangeEquipmentCharacterImage[\s\S]*?if \(!game\.user\.isGM\)/);
  assert.match(sheet, /_onRemoveEquipmentCharacterImage[\s\S]*?if \(!game\.user\.isGM\)/);
  assert.doesNotMatch(sheet, /prototypeToken[\s\S]*?fullBodyImage|fullBodyImage[\s\S]*?prototypeToken/);
  assert.match(style, /\.mtrol-equipment-character-image\s*\{[\s\S]*?object-fit:\s*contain;[\s\S]*?object-position:\s*center/);
});
