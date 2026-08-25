import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const cssUrl = new URL("../styles/ui/trade-dialog.css", import.meta.url);
const css = await readFile(cssUrl, "utf8");
const template = await readFile(new URL("../templates/apps/trade-app.html", import.meta.url), "utf8");

test("9-01 reutiliza el fondo arcano existente", async () => { assert.match(css, /assets\/ui\/mtrol-arcane-bg\.webp/); await access(new URL("../assets/ui/mtrol-arcane-bg.webp", import.meta.url)); });
test("9-02 reutiliza marco de retrato existente", async () => { assert.match(css, /portrait-frame-runtime\.webp/); await access(new URL("../assets/ui/personaje-premium/portrait/portrait-frame-runtime.webp", import.meta.url)); });
test("9-03 reutiliza separador del header", async () => { assert.match(css, /name-divider-bottom\.png/); await access(new URL("../assets/ui/personaje-premium/header/name-divider-bottom.png", import.meta.url)); });
test("9-04 conserva tipografía Morpheus mediante variable MTROL", () => { assert.match(css, /var\(--mtrol-font-title\)/); });
test("9-05 cards dan jerarquía a imagen, nombre, cantidad y tipo", () => { assert.match(template, /mtrol-trade-runtime__item/); assert.match(template, /<img src="\{\{img\}\}"/); assert.match(template, /×\{\{quantity\}\}/); });
test("9-06 confirmar y cancelar tienen jerarquías distintas", () => { assert.match(template, /class="is-primary" data-action="confirm"/); assert.match(template, /class="is-cancel" data-action="cancel"/); assert.match(css, /\.is-primary/); assert.match(css, /\.is-cancel/); });
test("9-07 confirmación no depende sólo del color", () => { assert.match(css, /content: "✓ CONFIRMADO"/); assert.match(template, /CONFIRMADO/); });
test("9-08 EXECUTING posee feedback discreto y reduced-motion", () => { assert.match(css, /mtrol-trade-processing/); assert.match(css, /prefers-reduced-motion/); });
test("9-09 invalidación identifica la entrada problemática", () => { assert.match(template, /\{\{invalidReason\}\}/); assert.match(css, /\.is-invalid/); });
test("9-10 responsive conserva acciones principales", () => { assert.match(css, /@container \(max-width: 520px\)/); assert.match(css, /__actions button[\s\S]*flex:/); });
