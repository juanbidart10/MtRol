import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const warnings = [];

class MockItemSheet {
  constructor(item) {
    this.item = item;
    this.options = {};
    this.position = {};
  }

  static get defaultOptions() { return {}; }
  getData() { return {}; }
  activateListeners() {}
  async _updateObject(_event, formData) { return structuredClone(formData); }
}

globalThis.foundry = {
  appv1: { sheets: { ItemSheet: MockItemSheet } },
  utils: {
    duplicate: value => structuredClone(value),
    mergeObject: (target, source) => Object.assign(target, source)
  }
};
globalThis.game = {
  user: { id: "player", isGM: false },
  system: { id: "mtrol" }
};
globalThis.ui = {
  notifications: {
    warn(message) { warnings.push(message); }
  }
};

const { CompetenciaSheet } =
  await import("../scripts/sheets/items/competencia-sheet.js");

const templateSource = await readFile(
  new URL("../templates/items/competencia-sheet.html", import.meta.url),
  "utf8"
);

function createItem() {
  return {
    id: "ability",
    name: "Habilidad",
    img: "icons/svg/item-bag.svg",
    system: {},
    parent: null
  };
}

test.beforeEach(() => {
  warnings.length = 0;
});

test("jugador puede abrir CompetenciaSheet pero sus controles quedan read-only", () => {
  game.user.isGM = false;
  const controls = [
    { disabled: false },
    { disabled: false }
  ];
  const editableImage = {
    removed: false,
    removeAttribute(name) { if (name === "data-edit") this.removed = true; }
  };
  const root = {
    closest() { return null; },
    querySelectorAll(selector) {
      return selector === "[data-edit]" ? [editableImage] : controls;
    }
  };

  new CompetenciaSheet(createItem()).activateListeners({ 0: root });

  assert.ok(controls.every(control => control.disabled));
  assert.equal(editableImage.removed, true);
});

test("jugador no puede guardar campos estructurales de Competencia", async () => {
  game.user.isGM = false;
  const result = await new CompetenciaSheet(createItem())._updateObject(null, {
    "system.orbType": "fuego",
    "system.damageType": "magical",
    "system.damageElement": "fire",
    "system.spellTags": ["destructive"]
  });

  assert.equal(result, false);
  assert.equal(warnings.length, 1);
});

test("GM conserva la edición estructural de Competencia", async () => {
  game.user.isGM = true;
  const formData = {
    "system.categoria": "hechizo",
    "system.orbType": "ignis",
    "system.damageType": "magical",
    "system.damageElement": "fire",
    "system.spellTags": ["destructive"]
  };
  const result = await new CompetenciaSheet(createItem())._updateObject(null, formData);

  assert.deepEqual(result, formData);
  assert.equal(warnings.length, 0);
});

test("GM no puede persistir un orbType fuera del registro canónico", async () => {
  game.user.isGM = true;
  await assert.rejects(
    new CompetenciaSheet(createItem())._updateObject(null, {
      "system.categoria": "hechizo",
      "system.orbType": "fuego"
    }),
    /registro canónico/i
  );
});

test("una Competencia no hechizo no aplica mecánicamente orbType", async () => {
  game.user.isGM = true;
  const result = await new CompetenciaSheet(createItem())._updateObject(null, {
    "system.categoria": "competencia",
    "system.orbType": "ignis"
  });

  assert.equal(result["system.orbType"], null);
});

test("la Item Sheet ofrece asociación canónica sólo para categoría hechizo", () => {
  const item = createItem();
  item.system = { categoria: "hechizo", orbType: "aqua" };
  const context = new CompetenciaSheet(item).getData();

  assert.equal(context.showOrbAssociation, true);
  assert.equal(context.orbOptions.length, 16);
  assert.equal(context.orbOptions.find(option => option.value === "aqua").selected, true);
  assert.match(templateSource, /{{#if showOrbAssociation}}/);
  assert.match(templateSource, /name="system\.orbType"/);
  assert.doesNotMatch(templateSource, /system\.elemento/);
});
