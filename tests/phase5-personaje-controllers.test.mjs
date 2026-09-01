import test from "node:test";
import assert from "node:assert/strict";

const {
  createCombatAbilityData,
  createCompetenceData,
  createObjectData,
  createSheetItem,
  setCombatBarEquipped
} = await import("../scripts/sheets/actors/personaje-inventory-controller.js");
const { adjustCompetenceLevel } = await import("../scripts/progression/competence-level-service.js");
const {
  setCompetenceImage,
  setPersonajeFullBodyImage
} = await import("../scripts/sheets/actors/personaje-image-controller.js");

const gm = { id: "gm", isGM: true };
const player = { id: "player", isGM: false };

test("factories conservan defaults contractuales de creación", () => {
  assert.equal(createCompetenceData().system.actionType, "utility");
  assert.equal(createCombatAbilityData().system.actionType, "combatSkill");
  assert.equal(createCombatAbilityData().system.equipadaCombate, false);
  assert.equal(createObjectData().system.cantidad, 1);
});

test("controller crea y equipa sólo con permiso GM", async () => {
  const writes = [];
  const actor = { async createEmbeddedDocuments(type, data) { writes.push({ type, data }); return data; } };
  const item = { async update(changes) { writes.push(changes); } };
  await createSheetItem(actor, createObjectData(), { user: gm });
  await setCombatBarEquipped(item, true, { user: gm });
  assert.equal(writes.length, 2);
  await assert.rejects(() => createSheetItem(actor, createObjectData(), { user: player }), /exclusiva para GM/);
  assert.equal(writes.length, 2);
});

test("servicio de nivel conserva clamp 1–5 y rechaza Item ajeno", async () => {
  const item = {
    type: "competencia",
    system: { categoria: "competencia", nivel: 5 },
    async update(changes) { this.system.nivel = changes["system.nivel"]; }
  };
  assert.equal((await adjustCompetenceLevel(item, 1, { user: gm })).changed, false);
  item.system.nivel = 2;
  assert.equal((await adjustCompetenceLevel(item, -1, { user: gm })).level, 1);
  await assert.rejects(
    () => adjustCompetenceLevel({ type: "objeto", system: {} }, 1, { user: gm }),
    /no es una competencia/
  );
});

test("controller de imágenes encapsula las únicas escrituras visuales", async () => {
  const actorWrites = [];
  const itemWrites = [];
  const actor = { async update(changes) { actorWrites.push(changes); } };
  const item = { type: "competencia", async update(changes) { itemWrites.push(changes); } };
  await setPersonajeFullBodyImage(actor, " body.webp ", { user: gm });
  await setCompetenceImage(item, "skill.webp", { user: gm });
  assert.deepEqual(actorWrites[0], { "system.identidad.fullBodyImage": "body.webp" });
  assert.deepEqual(itemWrites[0], { img: "skill.webp" });
  await assert.rejects(() => setPersonajeFullBodyImage(actor, "x", { user: player }), /Sólo el GM/);
});

