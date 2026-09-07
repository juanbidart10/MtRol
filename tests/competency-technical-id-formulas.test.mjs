import test from "node:test";
import assert from "node:assert/strict";

const warnings = [];
const originalWarn = console.warn;
console.warn = (...args) => warnings.push(args);

const {
  MTROL_COMPETENCY_CATALOG,
  MTROL_COMPETENCY_TECHNICAL_IDS,
  getCanonicalTechnicalIdByName,
  getCompetencyFormula
} = await import("../scripts/competencies/competency-catalog.js");

const {
  mtrolPrepararRollData
} = await import("../scripts/rolls/formula-parser.js");

const {
  migrateCompetencyTechnicalIds,
  planCompetencyTechnicalIdMigration
} = await import("../scripts/migrations/competency-technical-id-migration.js");

test.after(() => {
  console.warn = originalWarn;
});

const EXPECTED_IDS = [
  "apunalar", "combate_con_armas", "combate_sin_armas", "combate_a_distancia",
  "defensa_con_escudos", "evasion", "clarividencia", "cosmologia", "magia",
  "necromancia", "meditar", "simbologia", "carpinteria", "cocina", "comercio",
  "estructuras", "herreria", "joyeria", "robotica", "sastreria", "transportes",
  "alquimia", "medicina", "domar", "orientacion", "caceria", "recoleccion",
  "tramperia", "buceo", "cartografia", "monturas", "arqueologia", "supervivencia",
  "botanica", "interpretacion", "higiene", "bebidas", "etiqueta", "historia",
  "hacking", "investigar", "mitologia", "musica", "ocultarse", "politica", "robar"
];

function competence(name, technicalId, nivel, id = technicalId || name) {
  return {
    id,
    uuid: `Item.${id}`,
    type: "competencia",
    name,
    system: { technicalId, nivel }
  };
}

function actor(items, atributos = { inteligencia: 3 }) {
  return {
    id: "actor-1",
    uuid: "Actor.actor-1",
    items,
    system: {
      atributos,
      recursos: {},
      vitales: {},
      equipamiento: {}
    },
    getRollData() {
      return {};
    }
  };
}

function expand(formula, data) {
  return formula.replace(/@([a-zA-Z0-9_.]+)/g, (_match, path) => {
    let value = data;
    for (const key of path.split(".")) value = value?.[key];
    return String(value ?? 0);
  });
}

test("el catálogo canónico contiene exactamente los 46 technicalId oficiales y únicos", () => {
  assert.equal(MTROL_COMPETENCY_CATALOG.length, 46);
  assert.deepEqual(MTROL_COMPETENCY_TECHNICAL_IDS, EXPECTED_IDS);
  assert.equal(new Set(MTROL_COMPETENCY_TECHNICAL_IDS).size, 46);
});

test("el mapeo explícito reconoce nombres canónicos y variantes seguras", () => {
  const cases = {
    "Apuñalar": "apunalar",
    "Combate con Armas": "combate_con_armas",
    "Combate con armas": "combate_con_armas",
    "Magia": "magia",
    "Simbología": "simbologia",
    "Alquimia": "alquimia",
    "Arqueología": "arqueologia",
    "Interpretación": "interpretacion",
    "Política": "politica"
  };
  for (const [name, technicalId] of Object.entries(cases)) {
    assert.equal(getCanonicalTechnicalIdByName(name), technicalId);
  }
  assert.equal(getCanonicalTechnicalIdByName("Magia superior"), null);
});

test("una única tabla autoritativa convierte niveles 1–5 a fórmulas", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5].map(getCompetencyFormula),
    ["1d4 + 1", "1d6 + 2", "1d8 + 3", "1d10 + 4", "1d12 + 5"]
  );
  for (const invalid of [0, -1, 6, 99, null, "x", 2.5]) {
    assert.equal(getCompetencyFormula(invalid), null);
  }
});

test("@competencias expande dados, atributos, múltiples referencias, precedencia y ausentes", () => {
  const currentActor = actor([
    competence("Magia", "magia", 5, "magic"),
    competence("Simbología", "simbologia", 4, "symbols")
  ]);
  const { data } = mtrolPrepararRollData(currentActor);

  assert.equal(expand("@competencias.magia", data), "(1d12 + 5)");
  assert.equal(expand("1d20 + @competencias.magia", data), "1d20 + (1d12 + 5)");
  assert.equal(
    expand("@atributos.inteligencia + @competencias.magia", data),
    "3 + (1d12 + 5)"
  );
  assert.equal(
    expand("@competencias.magia + @competencias.simbologia", data),
    "(1d12 + 5) + (1d10 + 4)"
  );
  assert.equal(expand("2 * @competencias.magia", data), "2 * (1d12 + 5)");
  assert.equal(expand("@competencias.magia / 2", data), "(1d12 + 5) / 2");
  assert.equal(expand("@competencias.alquimia", data), "0");
});

test("la identidad técnica sobrevive al renombre del Item", () => {
  const item = competence("Magia", "magia", 3, "magic");
  assert.equal(expand("@competencias.magia", mtrolPrepararRollData(actor([item])).data), "(1d8 + 3)");
  item.name = "Arcanismo";
  assert.equal(expand("@competencias.magia", mtrolPrepararRollData(actor([item])).data), "(1d8 + 3)");
});

test("la Roll conserva 1d20 y 1d12 como términos de dado reales", () => {
  class FormulaProbeRoll {
    constructor(formula, data) {
      this.formula = expand(formula, data);
      this.terms = [...this.formula.matchAll(/(\d+)d(\d+)/gi)].map(match => ({
        number: Number(match[1]),
        faces: Number(match[2])
      }));
    }
  }
  const { data } = mtrolPrepararRollData(actor([
    competence("Magia", "magia", 5, "magic")
  ]));
  const roll = new FormulaProbeRoll("1d20 + @competencias.magia", data);
  assert.deepEqual(roll.terms, [{ number: 1, faces: 20 }, { number: 1, faces: 12 }]);
});

test("nivel inválido y technicalId duplicado resuelven defensivamente a 0", () => {
  const invalid = mtrolPrepararRollData(actor([
    competence("Magia", "magia", 99, "invalid")
  ])).data;
  assert.equal(invalid.competencias.magia, 0);

  const duplicate = mtrolPrepararRollData(actor([
    competence("Magia", "magia", 5, "one"),
    competence("Arcanismo", "magia", 4, "two")
  ])).data;
  assert.equal(duplicate.competencias.magia, 0);
  assert.ok(warnings.length >= 2);
});

test("la migración es determinista, idempotente y preserva el resto del Item", async () => {
  const magic = competence("Magia", "", 4, "magic");
  magic.img = "magic.webp";
  magic.flags = { module: { preserved: true } };
  magic.system.formula = "1d20";

  const currentActor = actor([magic]);
  const updates = [];
  currentActor.updateEmbeddedDocuments = async (_type, entries) => {
    updates.push(...entries);
    for (const entry of entries) {
      const item = currentActor.items.find(candidate => candidate.id === entry._id);
      item.system.technicalId = entry["system.technicalId"];
    }
  };

  const first = await migrateCompetencyTechnicalIds({ actors: [currentActor], worldItems: [] });
  const second = await migrateCompetencyTechnicalIds({ actors: [currentActor], worldItems: [] });

  assert.equal(first.actorsMigrated, 1);
  assert.equal(first.itemsMigrated, 1);
  assert.equal(second.actorsMigrated, 0);
  assert.equal(second.itemsMigrated, 0);
  assert.equal(updates.length, 1);
  assert.equal(magic.system.technicalId, "magia");
  assert.equal(magic.name, "Magia");
  assert.equal(magic.system.nivel, 4);
  assert.equal(magic.system.formula, "1d20");
  assert.equal(magic.img, "magic.webp");
  assert.deepEqual(magic.flags, { module: { preserved: true } });
});

test("la migración no elige duplicados ni altera IDs desconocidos", () => {
  const currentActor = actor([
    competence("Magia", "", 5, "one"),
    competence("Arcanismo", "magia", 4, "two"),
    competence("Simbología", "legacy-simbolos", 3, "unknown")
  ]);
  const plan = planCompetencyTechnicalIdMigration({ actors: [currentActor] });
  assert.equal(plan.operations.length, 0);
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0].technicalId, "magia");
  assert.equal(plan.unknownTechnicalIds.length, 1);
  assert.equal(plan.unknownTechnicalIds[0].technicalId, "legacy-simbolos");
});
