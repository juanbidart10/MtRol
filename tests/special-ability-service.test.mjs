import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buildSpecialAbilitySlotView,
  findSpecialAbilitySlotForItem,
  resolveSpecialAbilitySlot,
  validateSpecialAbilityExecution
} from "../scripts/combat/special-ability-service.js";

function ability(id, name, {
  key = "",
  handler = "default",
  cooldown = 0
} = {}) {
  return {
    id,
    uuid: `Actor.actor.Item.${id}`,
    type: "competencia",
    name,
    img: `icons/${id}.webp`,
    system: { specialAbilityKey: key, specialAbilityHandler: handler, cooldown }
  };
}

function actor({ classId = "mago", items = [], slots = {} } = {}) {
  const collection = [...items];
  collection.get = id => collection.find(item => item.id === id) ?? null;
  return {
    id: "actor",
    uuid: "Actor.actor",
    system: { identidad: { classId } },
    items: collection,
    flags: { mtrol: { specialAbilities: slots } },
    getFlag: (_scope, key) => key === "specialAbilities" ? slots : null
  };
}

test("fase 3A: Mago resuelve sus dos referencias estables sin duplicar Items", () => {
  const control = ability("control", "Nombre narrativo", { key: "orbe-control" });
  const aumentado = ability("aumentado", "Orbe Aumentado");
  const subject = actor({ items: [control, aumentado] });
  assert.equal(resolveSpecialAbilitySlot(subject, 1).item, control);
  assert.equal(resolveSpecialAbilitySlot(subject, 2).item, aumentado);
  assert.equal(resolveSpecialAbilitySlot(subject, 1).handler, "orb-contextual");
});

test("fase 3A: los slots nacen bloqueados y una referencia ausente se informa inválida", () => {
  const first = resolveSpecialAbilitySlot(actor(), 1);
  assert.equal(first.locked, true);
  assert.equal(first.invalidReference, true);
  const empty = resolveSpecialAbilitySlot(actor({ classId: "guerrero" }), 1);
  assert.equal(empty.configured, false);
  assert.equal(empty.invalidReference, false);
});

test("fase 3A: override por Actor prevalece y persiste aunque cambie la Clase", () => {
  const custom = ability("custom", "Especial narrativa");
  const slots = { 1: { unlocked: true, overrideItemUuid: custom.uuid } };
  const subject = actor({ classId: "guerrero", items: [custom], slots });
  const resolved = resolveSpecialAbilitySlot(subject, 1);
  assert.equal(resolved.item, custom);
  assert.equal(resolved.source, "override");
  assert.equal(resolved.unlocked, true);
  assert.equal(resolved.handler, "default");
});

test("fase 3A: lock y referencia real se validan antes de ejecutar", () => {
  const control = ability("control", "Orbe Control", { key: "orbe-control" });
  const locked = actor({ items: [control] });
  assert.throws(() => validateSpecialAbilityExecution(locked, control, { slot: 1, mode: "attack" }), /bloqueada/);
  const unlocked = actor({ items: [control], slots: { 1: { unlocked: true } } });
  assert.equal(validateSpecialAbilityExecution(unlocked, control, { slot: 1, mode: "movement" }).item, control);
  assert.throws(() => validateSpecialAbilityExecution(unlocked, control, { slot: 1, mode: "stun" }), /no está disponible/);
});

test("fase 3A: cooldown y guard del turno determinan la disponibilidad visual", () => {
  const control = ability("control", "Orbe Control", { key: "orbe-control", cooldown: 1 });
  const subject = actor({ items: [control], slots: { 1: { unlocked: true } } });
  const view = buildSpecialAbilitySlotView(subject, 1, {
    getCooldownStatus: () => ({ available: false, availableAtRound: 5, roundsRemaining: 1 }),
    getActionGuard: () => ({ allowed: true })
  });
  assert.equal(view.canUse, false);
  assert.equal(view.status, "En enfriamiento");
  assert.equal(findSpecialAbilitySlotForItem(subject, control).slot, 1);
});

test("V1: un jugador no recibe datos sensibles de un slot bloqueado y el GM sí", () => {
  const control = ability("control", "Secreto del Orbe", {
    key: "orbe-control",
    handler: "orb-contextual",
    cooldown: 3
  });
  const subject = actor({ items: [control] });
  const playerView = buildSpecialAbilitySlotView(subject, 1, { viewerIsGM: false });
  assert.equal(playerView.name, "Habilidad bloqueada");
  assert.equal(playerView.item, null);
  assert.equal(playerView.itemId, null);
  assert.equal(playerView.itemUuid, null);
  assert.equal(playerView.cooldown, null);
  assert.equal(playerView.handler, null);
  assert.doesNotMatch(JSON.stringify(playerView), /Secreto del Orbe|orb-contextual/);

  const gmView = buildSpecialAbilitySlotView(subject, 1, { viewerIsGM: true });
  assert.equal(gmView.name, "Secreto del Orbe");
  assert.equal(gmView.item, control);
  assert.equal(gmView.cooldown, 3);
});

test("fase 3A: integración reutiliza turnos, fórmula, daño y preparación existentes", async () => {
  const [sheet, turn, engine, template, hooks] = await Promise.all([
    readFile(new URL("../scripts/sheets/actors/personaje-sheet.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/combat/turn-system.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/combat/competencia-engine.js", import.meta.url), "utf8"),
    readFile(new URL("../templates/actors/personaje-sheet.html", import.meta.url), "utf8"),
    readFile(new URL("../scripts/core/hooks.js", import.meta.url), "utf8")
  ]);
  assert.match(sheet, /selectOrbContextualMode/);
  assert.match(sheet, /resolverCompetencia\(\{[\s\S]*actionMode/);
  assert.match(turn, /validateSpecialAbilityExecution/);
  assert.match(turn, /applyCanonicalMovementGrantAuthoritative/);
  assert.match(turn, /grantExtraMovement\(current, resolution, \{[\s\S]*fullAction: true,[\s\S]*source: "movement-action"/);
  assert.match(engine, /actionMode !== "movement"/);
  assert.match(template, /data-special-slot="\{\{slot\}\}"/);
  assert.match(hooks, /installSpecialAbilityAuthorityHooks\(\)/);
});
