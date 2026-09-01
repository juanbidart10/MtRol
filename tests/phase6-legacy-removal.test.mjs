import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function javascriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? javascriptFiles(path) : entry.name.endsWith(".js") ? [path] : [];
  });
}

test("Fase 6 retira el comercio legacy aislado y su socket sin receptor", () => {
  assert.equal(existsSync(resolve(root, "scripts/items/trade-engine.js")), false);
  assert.equal(existsSync(resolve(root, "scripts/ui/trade-dialog.js")), false);

  for (const file of javascriptFiles(resolve(root, "scripts"))) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /mtrolEjecutarComercio|abrirDialogoComercioMtrol/);
  }
});

test("la compatibilidad visual trade-dialog.css permanece activa", () => {
  assert.equal(existsSync(resolve(root, "styles/ui/trade-dialog.css")), true);
  const css = readFileSync(resolve(root, "styles/mtrol.css"), "utf8");
  assert.match(css, /ui\/trade-dialog\.css/);
});
