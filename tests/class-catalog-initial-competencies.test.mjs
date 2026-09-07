import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const {
  MTROL_CLASS_DOMAINS,
  MTROL_CLASS_IDS,
  getAllClassDefinitions,
  getAttributeMovementFollowUpForClass,
  getClassDefinition,
  getCounterattackPolicyForClass,
  getEffectiveClassDomain,
  getResourceProfileForClass,
  validateClassCatalog
} = await import("../scripts/actors/class-registry.js");

const {
  prepareClassInitialCompetencyGrant,
  resolveClassApplication
} = await import("../scripts/actors/class-initial-competency-service.js");

const {
  isCanonicalCompetencyTechnicalId
} = await import("../scripts/competencies/competency-catalog.js");

const {
  mtrolPrepararRollData
} = await import("../scripts/rolls/formula-parser.js");

function item(technicalId, level = 1, name = technicalId, id = technicalId) {
  return {
    id,
    uuid: `Actor.test.Item.${id}`,
    name,
    type: "competencia",
    system: { technicalId, nivel: level }
  };
}

function actor(items = []) {
  return {
    uuid: "Actor.test",
    items,
    system: {
      atributos: {}, recursos: {}, vitales: {}, equipamiento: {}, identidad: {}
    },
    getRollData: () => ({})
  };
}

const EXPECTED = Object.freeze({
  asesino: ["combate_con_armas", "evasion", "apunalar"],
  bandido: ["combate_con_armas", "evasion", "apunalar"],
  caballero: ["combate_con_armas", "defensa_con_escudos", "etiqueta"],
  cazador: ["combate_a_distancia", "orientacion", "supervivencia"],
  comerciante: ["comercio", "etiqueta", "politica"],
  espadachin: ["combate_con_armas", "evasion", "supervivencia"],
  explorador: ["transportes", "cartografia", "orientacion"],
  guerrero: ["combate_con_armas", "defensa_con_escudos", "supervivencia"],
  inventor: ["carpinteria", "simbologia", "comercio"],
  ladron: ["robar", "politica", "comercio"],
  monje: ["combate_sin_armas", "meditar", "simbologia"],
  ninja: ["combate_con_armas", "combate_a_distancia", "evasion"],
  paladin: ["combate_con_armas", "defensa_con_escudos", "monturas"],
  valkiria: ["combate_con_armas", "medicina", "monturas"],
  alquimista: ["alquimia", "magia", "botanica"],
  clerigo: ["combate_con_armas", "magia", "meditar"],
  bardo: ["musica", "magia", "evasion"],
  nigromante: ["necromancia", "simbologia", "magia"],
  bruja: ["magia", "clarividencia", "medicina"],
  chaman: ["botanica", "meditar", "magia"],
  druida: ["magia", "domar", "mitologia"],
  guardian: ["cosmologia", "magia", "orientacion"],
  hechicero: ["simbologia", "magia", "tramperia"],
  mago: ["magia", "simbologia", "meditar"],
  oraculo: ["clarividencia", "magia", "orientacion"]
});

test("ClassCatalog contiene 26 IDs únicos: 14 physical, 3 hybrid, 8 magical y Aprendiz", () => {
  const definitions = getAllClassDefinitions();
  assert.equal(definitions.length, 26);
  assert.equal(new Set(MTROL_CLASS_IDS).size, 26);
  assert.equal(definitions.filter(entry => entry.domain === "physical").length, 14);
  assert.equal(definitions.filter(entry => entry.domain === "hybrid").length, 3);
  assert.equal(definitions.filter(entry => entry.domain === "magical").length, 8);
  assert.equal(definitions.filter(entry => entry.technicalId === "aprendiz").length, 1);
  assert.deepEqual(validateClassCatalog(), { valid: true, errors: [] });
});

test("las 25 clases normales declaran exactamente las Competencias canónicas solicitadas en nivel 1", () => {
  for (const [classId, expectedIds] of Object.entries(EXPECTED)) {
    const definition = getClassDefinition(classId);
    assert.deepEqual(
      definition.initialCompetencies.map(entry => entry.technicalId),
      expectedIds,
      classId
    );
    assert.ok(definition.initialCompetencies.every(entry => entry.level === 1));
    assert.equal(new Set(expectedIds).size, 3);
    assert.ok(expectedIds.every(isCanonicalCompetencyTechnicalId));
  }
});

test("Mago, Guerrero, Alquimista y Clérigo producen Items completos con technicalId", () => {
  for (const classId of ["mago", "guerrero", "alquimista", "clerigo"]) {
    const plan = prepareClassInitialCompetencyGrant(actor(), { classId });
    assert.equal(plan.createData.length, 3);
    for (const created of plan.createData) {
      assert.equal(created.type, "competencia");
      assert.equal(created.system.nivel, 1);
      assert.equal(created.system.categoria, "competencia");
      assert.ok(isCanonicalCompetencyTechnicalId(created.system.technicalId));
    }
  }
});

test("aplicar Mago es idempotente, conserva nivel y deduplica por technicalId tras renombre", () => {
  const currentActor = actor([item("magia", 3, "Arcanismo")]);
  const first = prepareClassInitialCompetencyGrant(currentActor, { classId: "mago" });
  assert.deepEqual(first.missing.map(entry => entry.technicalId), ["simbologia", "meditar"]);
  assert.equal(first.existing[0].technicalId, "magia");

  currentActor.items.push(...first.createData.map(data => item(
    data.system.technicalId,
    data.system.nivel,
    data.name
  )));
  const second = prepareClassInitialCompetencyGrant(currentActor, { classId: "mago" });
  assert.equal(second.createData.length, 0);
  assert.equal(currentActor.items.find(entry => entry.system.technicalId === "magia").system.nivel, 3);
  assert.equal(currentActor.items.find(entry => entry.system.technicalId === "magia").name, "Arcanismo");
});

test("cambiar de Mago a Guerrero conserva Competencias históricas", () => {
  const currentActor = actor(["magia", "simbologia", "meditar"].map(id => item(id)));
  const warrior = prepareClassInitialCompetencyGrant(currentActor, { classId: "guerrero" });
  assert.deepEqual(
    warrior.missing.map(entry => entry.technicalId),
    ["combate_con_armas", "defensa_con_escudos", "supervivencia"]
  );
  assert.equal(currentActor.items.length, 3);
});

test("duplicado histórico se reporta, no crea un tercero y no impide los otros grants", () => {
  const currentActor = actor([
    item("magia", 1, "Magia", "magic-one"),
    item("magia", 2, "Arcanismo", "magic-two")
  ]);
  const plan = prepareClassInitialCompetencyGrant(currentActor, { classId: "mago" });
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0].technicalId, "magia");
  assert.deepEqual(plan.missing.map(entry => entry.technicalId), ["simbologia", "meditar"]);
});

test("Aprendiz exige tres selecciones únicas canónicas y domain explícito", () => {
  const definition = getClassDefinition("aprendiz");
  assert.deepEqual(definition.competencySelection, { count: 3, initialLevel: 1, unique: true });

  for (const domain of Object.values(MTROL_CLASS_DOMAINS)) {
    const application = resolveClassApplication({
      classId: "aprendiz",
      classDomain: domain,
      competencySelections: ["magia", "medicina", "evasion"]
    });
    assert.equal(application.domain, domain);
    assert.ok(application.competencies.every(entry => entry.level === 1));
    assert.equal(getEffectiveClassDomain("aprendiz", domain), domain);
    assert.ok(getResourceProfileForClass("aprendiz", domain));
  }

  for (const options of [
    { classDomain: null, competencySelections: ["magia", "medicina", "evasion"] },
    { classDomain: "physical", competencySelections: ["magia", "magia", "evasion"] },
    { classDomain: "physical", competencySelections: ["magia", "medicina"] },
    { classDomain: "physical", competencySelections: ["magia", "medicina", "inexistente"] }
  ]) {
    assert.throws(() => resolveClassApplication({ classId: "aprendiz", ...options }));
  }
});

test("una elección de Aprendiz ya poseída cuenta pero no se duplica ni aumenta", () => {
  const currentActor = actor([item("magia", 4, "Arcanismo")]);
  const plan = prepareClassInitialCompetencyGrant(currentActor, {
    classId: "aprendiz",
    classDomain: "magical",
    competencySelections: ["magia", "medicina", "evasion"]
  });
  assert.deepEqual(plan.existing.map(entry => entry.technicalId), ["magia"]);
  assert.deepEqual(plan.missing.map(entry => entry.technicalId), ["medicina", "evasion"]);
  assert.equal(currentActor.items[0].system.nivel, 4);
});

test("una Competencia creada por Mago integra @competencias sin tocar el resolver", () => {
  const plan = prepareClassInitialCompetencyGrant(actor(), { classId: "mago" });
  const currentActor = actor(plan.createData.map((data, index) => ({
    ...structuredClone(data), id: `created-${index}`
  })));
  const { data } = mtrolPrepararRollData(currentActor);
  assert.equal(data.competencias.magia, "(1d4 + 1)");
});

test("domain canónico conserva políticas existentes y Aprendiz nunca lo infiere", () => {
  assert.equal(getClassDefinition("mago").domain, "magical");
  assert.equal(getClassDefinition("guerrero").domain, "physical");
  assert.equal(getClassDefinition("clerigo").domain, "hybrid");
  assert.equal(getEffectiveClassDomain("aprendiz"), null);
  assert.equal(getResourceProfileForClass("aprendiz"), null);
  assert.equal(getAttributeMovementFollowUpForClass("aprendiz", "physical"), "attack-if-in-range");
  assert.equal(getAttributeMovementFollowUpForClass("aprendiz", "magical"), "none");
  assert.deepEqual(
    getCounterattackPolicyForClass("aprendiz", "hybrid").counterattackDomains,
    ["PHYSICAL"]
  );
});

test("el selector existente delega Aprendiz a un diálogo mínimo sin crear Items desde PersonajeSheet", async () => {
  const [sheet, dialog] = await Promise.all([
    readFile(new URL("../scripts/sheets/actors/personaje-sheet.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/ui/apprentice-class-dialog.js", import.meta.url), "utf8")
  ]);
  assert.match(sheet, /input\.value === "aprendiz"/);
  assert.match(sheet, /promptApprenticeClassConfiguration\(\)/);
  assert.doesNotMatch(sheet, /createCanonicalCompetencyItemData/);
  assert.match(dialog, /name="classDomain"/);
  assert.equal((dialog.match(/name="competency\$\{index\}"/g) ?? []).length, 2);
  assert.match(dialog, /\[1, 2, 3\]/);
});
