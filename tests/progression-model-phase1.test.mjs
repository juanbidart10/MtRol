import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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

class MockNumberField extends MockField {
  validate(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError("must be a finite number");
    }
    if (this.options.integer === true && !Number.isInteger(value)) {
      throw new TypeError("must be an integer");
    }
    if (value < this.options.min || value > this.options.max) {
      throw new RangeError("outside allowed range");
    }
    return true;
  }
}

class MockArrayField extends MockField {
  constructor(element, options = {}) {
    super(options);
    this.element = element;
  }
}

globalThis.foundry = {
  data: {
    fields: {
      StringField: MockField,
      NumberField: MockNumberField,
      BooleanField: MockField,
      SchemaField: MockSchemaField,
      ArrayField: MockArrayField,
      HTMLField: MockField
    }
  },
  abstract: {
    TypeDataModel: class {
      static migrateData(source) {
        return source;
      }
    }
  }
};

const { PersonajeDataModel } =
  await import("../models/personaje-model.js");
const { CompetenciaDataModel } =
  await import("../models/competencia-model.js");
const {
  MTROL_ORB_AUTOMATION_MODES,
  MTROL_ORB_IDS,
  MTROL_ORB_REGISTRY,
  getOrbDefinition
} = await import("../scripts/progression/orb-registry.js");
const {
  getAttributeCap,
  getCompetenceCap
} = await import("../scripts/progression/progression-caps.js");

test("migración legacy conserva recursos, vitales y atributos sin inferir contenedores ausentes", () => {
  const legacy = {
    recursos: { nivel: 3, exp: 18750, mvp: 27 },
    vitales: {
      hp: { value: 4, max: 20, temp: 0 },
      mp: { value: 30, max: 100, temp: 0 }
    },
    atributos: { fuerza: 6, aura: 5 }
  };
  const migrated = PersonajeDataModel.migrateData(structuredClone(legacy));

  assert.equal(migrated.recursos.nivel, 3);
  assert.equal(migrated.recursos.exp, 18750);
  assert.equal(migrated.recursos.mvp, 27);
  assert.deepEqual(migrated.vitales, legacy.vitales);
  assert.deepEqual(migrated.atributos, legacy.atributos);
  assert.equal(Object.hasOwn(migrated, "progression"), false);
  assert.equal(Object.hasOwn(migrated, "pendingAdvancement"), false);
  assert.equal(Object.hasOwn(migrated, "orbs"), false);
  assert.equal(Object.hasOwn(migrated, "alignment"), false);
  assert.equal(migrated.atributos.fuerza, 6, "Fase 1 no clamplea legacy");
});

test("migración parcial no materializa defaults que puedan borrar progreso persistido", () => {
  const partial = {
    identidad: { titulo: "Cambio inocuo" }
  };

  const migrated = PersonajeDataModel.migrateData(structuredClone(partial));

  assert.deepEqual(migrated, partial);
  assert.equal(Object.hasOwn(migrated, "progression"), false);
  assert.equal(Object.hasOwn(migrated, "pendingAdvancement"), false);
  assert.equal(Object.hasOwn(migrated, "orbs"), false);
  assert.equal(Object.hasOwn(migrated, "alignment"), false);
});

test("schema contractual agrega classId y modificadores GM con defaults seguros", () => {
  const schema = PersonajeDataModel.defineSchema();

  assert.ok(schema.identidad.fields.classId, "falta system.identidad.classId");
  assert.ok(schema.identidad.fields.fullBodyImage, "falta system.identidad.fullBodyImage");
  assert.ok(schema.resourceModifiers, "falta system.resourceModifiers");
  assert.equal(schema.identidad.fields.classId.options.initial, "");
  assert.equal(schema.identidad.fields.fullBodyImage.options.initial, "");
  assert.equal(schema.resourceModifiers.fields.hp.fields.value.options.initial, 0);
  assert.equal(schema.resourceModifiers.fields.hp.fields.label.options.initial, "");
  assert.equal(schema.resourceModifiers.fields.mp.fields.value.options.initial, 0);
  assert.equal(schema.resourceModifiers.fields.mp.fields.label.options.initial, "");
});

test("migrateData parcial no materializa classId ni resourceModifiers fuera del payload", () => {
  const partial = { identidad: { titulo: "Cambio parcial" } };
  const migrated = PersonajeDataModel.migrateData(structuredClone(partial));

  assert.deepEqual(migrated, partial);
  assert.equal(Object.hasOwn(migrated.identidad, "classId"), false);
  assert.equal(Object.hasOwn(migrated, "resourceModifiers"), false);
});

test("migrateData no convierte texto legacy inequívoco en classId durante una carga normal", () => {
  const legacy = { identidad: { clase: "Mago" } };
  const migrated = PersonajeDataModel.migrateData(structuredClone(legacy));

  assert.deepEqual(migrated, legacy);
  assert.equal(Object.hasOwn(migrated.identidad, "classId"), false);
});

test("migración Actor es idempotente y preserva progreso, Orbes, IDs y puntos", () => {
  const configured = {
    progression: {
      missionsCompleted: 4,
      dungeonsCompleted: 1,
      meritCredits: 8,
      defeatedLevel5Enemy: true,
      dmApproval: true
    },
    pendingAdvancement: {
      attributePoints: 2,
      competencePoints: 3
    },
    orbs: [
      { id: "orb-ignis-a", type: "ignis", level: 5 },
      { id: "orb-aqua-b", type: "aqua", level: 2 }
    ],
    alignment: {
      type: "arcano",
      unlocked: true
    }
  };

  const once = PersonajeDataModel.migrateData(structuredClone(configured));
  const twice = PersonajeDataModel.migrateData(structuredClone(once));

  assert.deepEqual(once, configured);
  assert.deepEqual(twice, once);
  assert.deepEqual(once.orbs.map(orb => orb.id), ["orb-ignis-a", "orb-aqua-b"]);
});

test("schema Actor usa tipos estrictos, Orbes 1–5 y Alineamiento sin autoactivación", () => {
  const schema = PersonajeDataModel.defineSchema();
  const orbFields = schema.orbs.element.fields;
  const alignmentFields = schema.alignment.fields;

  assert.deepEqual(schema.orbs.options.initial, []);
  assert.equal(orbFields.id.options.required, true);
  assert.equal(orbFields.level.options.integer, true);
  assert.equal(orbFields.level.options.min, 1);
  assert.equal(orbFields.level.options.max, 5);
  assert.doesNotThrow(() => orbFields.level.validate(1));
  assert.doesNotThrow(() => orbFields.level.validate(5));
  assert.throws(() => orbFields.level.validate(0), /outside allowed range/);
  assert.throws(() => orbFields.level.validate(6), /outside allowed range/);
  assert.deepEqual(orbFields.type.options.choices, MTROL_ORB_IDS);
  assert.equal(alignmentFields.type.options.initial, null);
  assert.deepEqual(alignmentFields.type.options.choices, [
    "tanque",
    "soporte",
    "arcano",
    "destructor",
    "dungeoner"
  ]);
  assert.equal(alignmentFields.unlocked.options.initial, false);
});

test("registry declara exactamente los 16 IDs estables sin nivel ni lógica activa", () => {
  assert.deepEqual(MTROL_ORB_IDS, [
    "ignis", "aqua", "terran", "aeris", "animal", "corpus",
    "herban", "mentem", "imagem", "gravitae", "protego", "ulghur",
    "oscuritae", "lux", "portal", "tempus"
  ]);
  assert.equal(Object.keys(MTROL_ORB_REGISTRY).length, 16);

  for (const id of MTROL_ORB_IDS) {
    const definition = getOrbDefinition(id);
    assert.equal(definition.id, id);
    assert.ok(definition.name);
    assert.ok(definition.passiveName);
    assert.ok(definition.passiveDescription);
    assert.ok(MTROL_ORB_AUTOMATION_MODES.includes(definition.automationMode));
    assert.deepEqual(definition.weaknesses, []);
    assert.equal(Object.hasOwn(definition, "level"), false);
    assert.equal(Object.hasOwn(definition, "bonus"), false);
  }
});

test("Competencia legacy queda sin asociación o clasificación inferida", () => {
  const legacy = {
    nivel: 4,
    categoria: "hechizo",
    formula: "1d10 + @atributos.aura",
    danio: "2d10",
    elemento: "Fuego narrativo",
    descripcion: "Un hechizo de Ignis"
  };
  const migrated = CompetenciaDataModel.migrateData(structuredClone(legacy));

  assert.equal(migrated.nivel, 4);
  assert.equal(migrated.categoria, "hechizo");
  assert.equal(migrated.formula, legacy.formula);
  assert.equal(migrated.danio, legacy.danio);
  assert.equal(migrated.elemento, legacy.elemento);
  assert.equal(migrated.descripcion, legacy.descripcion);
  assert.equal(Object.hasOwn(migrated, "orbType"), false);
  assert.equal(migrated.damageType, null);
  assert.equal(migrated.damageElement, null);
  assert.deepEqual(migrated.spellTags, []);
});

test("clasificación de Competencia es canónica, nullable y no activa modificadores", () => {
  const schema = CompetenciaDataModel.defineSchema();

  assert.deepEqual(schema.orbType.options.choices, MTROL_ORB_IDS);
  assert.equal(schema.orbType.options.initial, null);
  assert.deepEqual(schema.damageType.options.choices, ["physical", "magical"]);
  assert.equal(schema.damageType.options.initial, null);
  assert.deepEqual(schema.damageElement.options.choices, ["fire"]);
  assert.equal(schema.damageElement.options.initial, null);
  assert.deepEqual(schema.spellTags.options.initial, []);
  assert.deepEqual(schema.spellTags.element.options.choices, ["sensory", "destructive"]);
});

test("clasificación configurada se preserva y su migración es idempotente", () => {
  const configured = {
    nivel: 5,
    categoria: "hechizo",
    orbType: "ignis",
    damageType: "magical",
    damageElement: "fire",
    spellTags: ["destructive"]
  };

  const once = CompetenciaDataModel.migrateData(structuredClone(configured));
  const twice = CompetenciaDataModel.migrateData(structuredClone(once));

  assert.equal(once.orbType, "ignis");
  assert.equal(once.damageType, "magical");
  assert.equal(once.damageElement, "fire");
  assert.deepEqual(once.spellTags, ["destructive"]);
  assert.deepEqual(twice, once);
});

test("caps centrales permanecen en 5 sin modificar al Actor", () => {
  const actor = { system: { atributos: { fuerza: 9 } } };

  assert.equal(getAttributeCap(actor), 5);
  assert.equal(getCompetenceCap(actor), 5);
  assert.equal(actor.system.atributos.fuerza, 9);
});

test("Fase 1 no conecta el modelo nuevo con tiradas, MP, combate o daño", async () => {
  const runtimeFiles = [
    "../scripts/rolls/mtrol-rolls.js",
    "../scripts/combat/mp-engine.js",
    "../scripts/actions/action-engine.js",
    "../scripts/actions/action-damage-engine.js",
    "../scripts/combat/damage-localized.js",
    "../scripts/combat/damage-authorized.js"
  ];

  for (const relativePath of runtimeFiles) {
    const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
    assert.doesNotMatch(source, /orbType|system\?\.orbs|system\.orbs|alignment\.type/);
  }
});
