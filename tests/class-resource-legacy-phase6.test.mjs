import test from "node:test";
import assert from "node:assert/strict";

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
      static migrateData(source) {
        return source;
      }
    }
  }
};

const { PersonajeDataModel } = await import("../models/personaje-model.js");
const { getAllClassDefinitions } = await import("../scripts/actors/class-registry.js");

test("Fase 6 conserva cada label legacy inequívoco sin activar classId", () => {
  for (const definition of getAllClassDefinitions()) {
    const legacy = {
      identidad: { clase: definition.label },
      vitales: {
        hp: { value: 7, max: 31, temp: 2 },
        mp: { value: 9, max: 47, temp: 3 }
      }
    };

    const migrated = PersonajeDataModel.migrateData(structuredClone(legacy));

    assert.deepEqual(migrated, legacy, definition.label);
    assert.equal(Object.hasOwn(migrated.identidad, "classId"), false, definition.label);
    assert.equal(Object.hasOwn(migrated, "resourceModifiers"), false, definition.label);
  }
});

test("Fase 6 no infiere clases desde mayúsculas, tildes parciales o texto ambiguo", () => {
  for (const label of ["MAGO", "mago", "Espadachin", "Guerrero veterano", "Clase: Mago", ""] ) {
    const legacy = { identidad: { clase: label } };
    const migrated = PersonajeDataModel.migrateData(structuredClone(legacy));

    assert.deepEqual(migrated, legacy);
    assert.equal(Object.hasOwn(migrated.identidad, "classId"), false);
  }
});

test("Fase 6 preserva Actor sin identidad o Clase sin materializar el régimen nuevo", () => {
  for (const legacy of [{}, { identidad: {} }, { recursos: { nivel: 4 } }]) {
    const migrated = PersonajeDataModel.migrateData(structuredClone(legacy));
    assert.deepEqual(migrated, legacy);
    assert.equal(Object.hasOwn(migrated, "resourceModifiers"), false);
  }
});

test("Fase 6 preserva classId y modifiers ya configurados sin recalcular vitales", () => {
  const configured = {
    identidad: { clase: "Mago", classId: "mago" },
    resourceModifiers: {
      hp: { value: 10, label: "Recompensa narrativa" },
      mp: { value: -5, label: "Maldición" }
    },
    vitales: {
      hp: { value: 37, max: 50, temp: 4 },
      mp: { value: 59, max: 65, temp: 6 }
    }
  };

  const migrated = PersonajeDataModel.migrateData(structuredClone(configured));

  assert.deepEqual(migrated, configured);
});

test("Fase 6 es idempotente para legacy, parciales y configuración activa", () => {
  const fixtures = [
    { identidad: { clase: "Mago" }, vitales: { hp: { value: 3, max: 99 } } },
    { resourceModifiers: { hp: { label: "Sólo parcial" } } },
    {
      identidad: { clase: "Guerrero", classId: "guerrero" },
      resourceModifiers: {
        hp: { value: 5, label: "" },
        mp: { value: 0, label: "" }
      }
    }
  ];

  for (const fixture of fixtures) {
    const once = PersonajeDataModel.migrateData(structuredClone(fixture));
    const twice = PersonajeDataModel.migrateData(structuredClone(once));
    assert.deepEqual(twice, once);
  }
});
