import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

globalThis.foundry = { utils: { deepClone: structuredClone, duplicate: structuredClone } };
const { buildTradeAppRenderContext } = await import("../scripts/trade/trade-app-view-model.js");

const template = await readFile(new URL("../templates/apps/trade-app.html", import.meta.url), "utf8");
const css = await readFile(new URL("../styles/ui/trade-dialog.css", import.meta.url), "utf8");
const appSource = await readFile(new URL("../scripts/ui/trade-app.js", import.meta.url), "utf8");
const runtimeSource = await readFile(new URL("../scripts/trade/trade-runtime.js", import.meta.url), "utf8");

function fixture({ state = "NEGOTIATING", ownConfirmed = false, rivalConfirmed = false, invalid = false } = {}) {
  const ownEntry = { itemUuid: "Actor.a.Item.p", itemId: "p", name: "Poción", img: "p.webp", quantity: 2, tipoObjeto: "consumible", invalid, invalidReason: invalid ? "Cantidad insuficiente" : null };
  const rivalEntry = { itemUuid: "Actor.b.Item.c", itemId: "c", name: "Moneda", img: "c.webp", quantity: 4, tipoObjeto: "moneda", invalid: false };
  const session = { id: "ui", state, revision: 3, participants: { participantA: { actorName: "A", actorImg: "a.webp" }, participantB: { actorName: "B", actorImg: "b.webp" } } };
  const view = {
    participantKey: "participantA", rivalKey: "participantB", ownOffer: [ownEntry], rivalOffer: [rivalEntry],
    privateInventory: { items: [{ itemUuid: ownEntry.itemUuid, availableIncludingSession: 10 }] },
    confirmations: { own: ownConfirmed, rival: rivalConfirmed },
    canEditOffer: ["NEGOTIATING", "READY"].includes(state), hasInvalidEntry: invalid
  };
  return { session, view };
}

test("7-01 no renderiza inventario rival", () => { assert.doesNotMatch(template, /otherInventory|targetInventory|rivalInventory/); });
test("7-02 sección Mi Inventario es privada y explícita", () => { assert.match(template, /Mi inventario/); assert.match(template, /el rival no recibe esta lista/); });
test("7-03 Mi Oferta contiene controles propios", () => { assert.match(template, /Mi oferta/); assert.match(template, /data-action="remove"/); });
test("7-04 Oferta rival es solo lectura", () => { assert.match(template, /Oferta de \{\{uiState\.otherName\}\}/); assert.match(template, /solo lectura/); });
test("7-05 equipped deshabilita añadir", () => { assert.match(template, /\{\{#unless tradeable\}\}disabled/); });
test("7-06 cantidad parcial usa input con máximos", () => { assert.match(template, /max="\{\{availableIncludingSession\}\}"/); });
test("7-07 retirar está disponible sólo en oferta propia", () => { assert.equal((template.match(/data-action="remove"/g) ?? []).length, 1); });
test("7-08 editar cantidad respeta uiState.canEdit", () => { assert.match(template, /data-action="update"[\s\S]*uiState\.canEdit/); });
test("7-09 inspector es cerrable y read-only", () => { assert.match(template, /data-action="close-inspector"/); assert.match(template, /Solo lectura/); assert.match(appSource, /event\.key === "Escape"/); });

test("7-10 confirmación A bloquea visualmente hasta modificar", () => { const { session, view } = fixture({ ownConfirmed: true }); const context = buildTradeAppRenderContext({ session, view }); assert.equal(context.uiState.canEdit, false); assert.equal(context.uiState.canUnlockConfirmedOffer, true); });
test("7-11 confirmación B se refleja", () => { const { session, view } = fixture({ rivalConfirmed: true }); assert.equal(buildTradeAppRenderContext({ session, view }).uiState.otherConfirmed, true); });
test("7-12 desbloquear oferta permite reset explícito", () => { const { session, view } = fixture({ ownConfirmed: true }); assert.equal(buildTradeAppRenderContext({ session, view, editingConfirmedOffer: true }).uiState.canEdit, true); });
test("7-13 estado inválido deshabilita confirmar y muestra razón", () => { const { session, view } = fixture({ invalid: true }); const context = buildTradeAppRenderContext({ session, view }); assert.equal(context.uiState.canConfirm, false); assert.equal(context.myOffer[0].invalidReason, "Cantidad insuficiente"); });
test("7-14 READY se representa", () => { const { session, view } = fixture({ state: "READY", ownConfirmed: true, rivalConfirmed: true }); assert.equal(buildTradeAppRenderContext({ session, view }).uiState.ready, true); });
test("7-15 EXECUTING deshabilita interacción", () => { const { session, view } = fixture({ state: "EXECUTING" }); const context = buildTradeAppRenderContext({ session, view }); assert.equal(context.uiState.executing, true); assert.equal(context.uiState.interactionDisabled, true); });
test("7-16 CANCELLED cierra ventana runtime", () => { assert.match(runtimeSource, /TERMINAL_STATES[\s\S]*CANCELLED/); assert.match(runtimeSource, /await closeTradeApp/); });
test("7-17 COMPLETED muestra feedback antes de cerrar", () => { assert.match(runtimeSource, /COMPLETED[\s\S]*Intercambio completado/); });
test("7-18 unilateral vacía se explica como válida", () => { assert.match(template, /comercio unilateral es válido/i); });
test("7-19 una sesión conserva una sola Trade App", () => { assert.match(runtimeSource, /activeTradeApps\.get/); assert.match(runtimeSource, /if \(existing\)/); });
test("7-20 responsive usa container queries y evita overflow crítico", () => { assert.match(css, /container-type:\s*inline-size/); assert.match(css, /@container \(max-width: 700px\)/); assert.match(css, /overflow:\s*hidden/); });
