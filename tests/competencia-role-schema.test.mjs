import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class MockField {
  constructor(options = {}) {
    this.options = options;
  }
}

class MockStringField extends MockField {
  validate(value) {
    if (value === null) {
      if (this.options.nullable === true) return true;
      throw new Error("may not be null");
    }

    if (typeof value !== "string") throw new Error("must be a string");
    if (value.length === 0 && this.options.blank !== true) {
      throw new Error("may not be a blank string");
    }
    if (this.options.choices && !this.options.choices.includes(value)) {
      throw new Error("is not a valid choice");
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
      StringField: MockStringField,
      NumberField: MockField,
      BooleanField: MockField,
      SchemaField: MockField,
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

const { CompetenciaDataModel } =
  await import("../models/competencia-model.js");

test("Rol es metadata opcional: null y ausencia son válidos", () => {
  const schema = CompetenciaDataModel.defineSchema();
  const role = schema.rol;

  assert.equal(role.options.required, false);
  assert.equal(role.options.nullable, true);
  assert.equal(role.options.initial, null);
  assert.doesNotThrow(() => role.validate(null));

  const legacy = CompetenciaDataModel.migrateData({
    nivel: 3,
    categoria: "competencia"
  });

  assert.equal(legacy.rol, null);
  assert.doesNotThrow(() => role.validate(legacy.rol));
});

test("Rol vacío legacy se normaliza a null y un rol válido se conserva", () => {
  const role = CompetenciaDataModel.defineSchema().rol;
  const blank = CompetenciaDataModel.migrateData({ rol: "" });
  const configured = CompetenciaDataModel.migrateData({ rol: "offensive" });

  assert.equal(blank.rol, null);
  assert.equal(configured.rol, "offensive");
  assert.doesNotThrow(() => role.validate(configured.rol));
});

test("un Hechizo nuevo admite Rol null y conserva un Rol configurado al reabrirse", () => {
  const role = CompetenciaDataModel.defineSchema().rol;
  const created = CompetenciaDataModel.migrateData({
    nivel: 1,
    categoria: "hechizo",
    rol: null
  });
  const reopened = CompetenciaDataModel.migrateData({
    ...created,
    rol: "offensive"
  });

  assert.equal(created.rol, null);
  assert.doesNotThrow(() => role.validate(created.rol));
  assert.equal(reopened.rol, "offensive");
  assert.doesNotThrow(() => role.validate(reopened.rol));
});

test("un Rol ajeno al enum continúa rechazándose controladamente", () => {
  const role = CompetenciaDataModel.defineSchema().rol;

  assert.throws(
    () => role.validate("banana"),
    /valid choice/
  );
});

test("los constructores usan el default del schema y la Sheet convierte Sin definir a null", async () => {
  const source = await readFile(
    new URL("../scripts/sheets/actors/personaje-sheet.js", import.meta.url),
    "utf8"
  );
  const itemSheet = await readFile(
    new URL("../scripts/sheets/items/competencia-sheet.js", import.meta.url),
    "utf8"
  );

  assert.doesNotMatch(source, /rol:\s*""/);
  assert.match(itemSheet, /formData\["system\.rol"\]\s*=\s*null/);
});

test("todos los nuevos campos tienen defaults compatibles con su enum", () => {
  const schema = CompetenciaDataModel.defineSchema();

  assert.equal(schema.rol.options.initial, null);
  assert.equal(schema.damageResolution.options.initial, "immediate");
  assert.equal(schema.damageMode.options.initial, "automatic");
  assert.equal(schema.damageCostType.options.initial, "none");

  assert.ok(schema.damageResolution.options.choices.includes("immediate"));
  assert.ok(schema.damageMode.options.choices.includes("automatic"));
  assert.ok(schema.damageCostType.options.choices.includes("none"));
});
