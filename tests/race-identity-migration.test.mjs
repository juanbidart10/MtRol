import test from "node:test";
import assert from "node:assert/strict";

const {
  migrateRaceIdentities,
  planRaceIdentityMigration
} = await import("../scripts/migrations/race-identity-migration.js");

function actor({ id, raceId = "", label = "", attributes = { fuerza: 4, aura: 3 } }) {
  return {
    id,
    uuid: `Actor.${id}`,
    system: { identidad: { raceId, raza: label }, atributos: structuredClone(attributes) },
    updates: [],
    async update(changes) {
      this.updates.push(structuredClone(changes));
      this.system.identidad.raceId = changes["system.identidad.raceId"];
      this.system.identidad.raza = changes["system.identidad.raza"];
    }
  };
}

test("migración exacta asigna raceId sin tocar atributos y la segunda ejecución es no-op", async () => {
  const historical = actor({ id: "historical", label: "Gnomo" });
  const before = structuredClone(historical.system.atributos);
  const first = await migrateRaceIdentities({ actors: [historical] });
  const second = await migrateRaceIdentities({ actors: [historical] });
  assert.equal(first.actorsMigrated, 1);
  assert.equal(first.raceIdsAssigned, 1);
  assert.equal(first.attributesModified, 0);
  assert.equal(second.actorsMigrated, 0);
  assert.equal(historical.system.identidad.raceId, "gnomo");
  assert.deepEqual(historical.system.atributos, before);
  assert.equal(historical.updates.length, 1);
});

test("technicalId válido gana prioridad; inválidos y labels desconocidos se reportan", () => {
  const valid = actor({ id: "valid", raceId: "gnomo", label: "Texto cambiado" });
  const invalid = actor({ id: "invalid", raceId: "gnomish", label: "Gnomo" });
  const unknown = actor({ id: "unknown", label: "Semielfo" });
  const plan = planRaceIdentityMigration({ actors: [valid, invalid, unknown] });
  assert.equal(plan.operations.length, 0);
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0].raceId, "gnomish");
  assert.equal(plan.unknownLabels.length, 1);
  assert.equal(plan.unknownLabels[0].label, "Semielfo");
});

