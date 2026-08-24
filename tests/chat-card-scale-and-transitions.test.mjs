import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("todas las familias de cards de chat aumentan 15% desde la escala anterior", async () => {
  const css = await readFile(
    new URL("../styles/combat/combat-chat.css", import.meta.url),
    "utf8"
  );

  assert.match(
    css,
    /\.chat-message\s+:is\(\.mtrol-chat-card,\s*\.mtrol-roll-card,\s*\.mtrol-destiny-card\)\s*{[^}]*zoom:\s*\.575/s
  );
});

test("el cambio de sección usa una transición breve y respeta movimiento reducido", async () => {
  const css = await readFile(
    new URL("../styles/animations/transitions.css", import.meta.url),
    "utf8"
  );

  assert.match(css, /\.mtrol-sheet-body-v2\s*>\s*\.tab\.active\s*{[^}]*animation:\s*mtrolSectionEnter\s+\.2s/s);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?animation:\s*none/);
});
