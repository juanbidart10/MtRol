import test from "node:test";
import assert from "node:assert/strict";

const lifecycle = [];
let baseRestoreCalls = 0;
let actorUpdates = 0;
let itemUpdates = 0;

function asCollection(elements = []) {
  const collection = [...elements];
  collection.each = callback => collection.forEach((element, index) => callback(index, element));
  return collection;
}

function createHtml(entries = {}) {
  const elements = new Map(
    Object.entries(entries).map(([selector, scrollTop]) => [selector, [{ scrollTop }]])
  );
  return {
    length: 1,
    find(selector) {
      return asCollection(elements.get(selector));
    },
    scrollTop(selector) {
      return elements.get(selector)?.[0]?.scrollTop;
    },
    setScrollTop(selector, scrollTop) {
      const element = elements.get(selector)?.[0];
      if (element) element.scrollTop = scrollTop;
    }
  };
}

class MockActorSheet {
  constructor(actor) {
    this.actor = actor;
    this.options = this.constructor.defaultOptions;
    this._scrollPositions = null;
    this.rendered = true;
  }

  static get defaultOptions() {
    return { scrollY: [] };
  }

  render() {
    return this;
  }

  _saveScrollPositions(html) {
    lifecycle.push("capture");
    this._scrollPositions = this.options.scrollY.reduce((positions, selector) => {
      positions[selector] = Array.from(html.find(selector), element => element.scrollTop);
      return positions;
    }, {});
  }

  _restoreScrollPositions(html) {
    lifecycle.push("restore");
    baseRestoreCalls += 1;
    for (const selector of this.options.scrollY) {
      html.find(selector).each((index, element) => {
        element.scrollTop = this._scrollPositions?.[selector]?.[index] || 0;
      });
    }
  }

  rerender(previousHtml, nextHtml) {
    this._saveScrollPositions(previousHtml);
    lifecycle.push("replace");
    this._restoreScrollPositions(nextHtml);
  }

  async close() {
    this._scrollPositions = null;
  }
}

globalThis.foundry = {
  appv1: { sheets: { ActorSheet: MockActorSheet } },
  applications: {
    apps: {
      FilePicker: { implementation: class MockFilePicker {} }
    }
  },
  utils: {
    deepClone: value => structuredClone(value),
    duplicate: value => structuredClone(value),
    escapeHTML: value => String(value ?? ""),
    mergeObject: (target, source) => Object.assign(target, source),
    randomID: () => "scroll-test"
  }
};
globalThis.game = {
  user: { id: "gm", isGM: true, targets: new Set() },
  users: [],
  system: { id: "mtrol", version: "test" }
};
globalThis.ui = {
  notifications: { warn() {}, info() {}, error() {} }
};
globalThis.Dialog = class MockDialog {};

const { PersonajeSheet } = await import("../scripts/sheets/actors/personaje-sheet.js");

const selectors = PersonajeSheet.defaultOptions.scrollY;
const personajeSelector = selectors.find(selector => selector.includes('data-tab="personaje"'));
const competenciasSelector = selectors.find(selector => selector.includes('data-tab="competencias"'));
const inventarioSelector = selectors.find(selector => selector.includes('data-tab="inventario"'));
const inventoryListSelector = ".mtrol-inventory-list-region";

function createSheet() {
  const actor = {
    async update() {
      actorUpdates += 1;
    }
  };
  const item = {
    async update() {
      itemUpdates += 1;
    }
  };
  return { sheet: new PersonajeSheet(actor), actor, item };
}

test.beforeEach(() => {
  lifecycle.length = 0;
  baseRestoreCalls = 0;
  actorUpdates = 0;
  itemUpdates = 0;
});

test("primer render no intenta restaurar una posición inexistente", () => {
  const { sheet } = createSheet();
  const html = createHtml({ [personajeSelector]: 0 });

  sheet._restoreScrollPositions(html);

  assert.equal(baseRestoreCalls, 0);
  assert.deepEqual(lifecycle, []);
});

test("rerender captura antes del reemplazo y restaura después", () => {
  const { sheet } = createSheet();
  const previousHtml = createHtml({ [competenciasSelector]: 420 });
  const nextHtml = createHtml({ [competenciasSelector]: 0 });

  sheet.rerender(previousHtml, nextHtml);

  assert.deepEqual(lifecycle, ["capture", "replace", "restore"]);
  assert.equal(nextHtml.scrollTop(competenciasSelector), 420);
});

test("dos renders consecutivos conservan la posición más reciente", () => {
  const { sheet } = createSheet();
  const firstHtml = createHtml({ [competenciasSelector]: 310 });
  const secondHtml = createHtml({ [competenciasSelector]: 0 });
  const thirdHtml = createHtml({ [competenciasSelector]: 0 });

  sheet.rerender(firstHtml, secondHtml);
  secondHtml.setScrollTop(competenciasSelector, 575);
  sheet.rerender(secondHtml, thirdHtml);

  assert.equal(thirdHtml.scrollTop(competenciasSelector), 575);
});

test("cada tab conserva una clave estable y no recibe el scroll de otra tab", () => {
  const { sheet } = createSheet();
  const previousHtml = createHtml({
    [competenciasSelector]: 360,
    [inventarioSelector]: 740,
    [inventoryListSelector]: 215
  });
  const nextHtml = createHtml({
    [competenciasSelector]: 0,
    [inventarioSelector]: 0,
    [inventoryListSelector]: 0
  });

  sheet.rerender(previousHtml, nextHtml);

  assert.equal(nextHtml.scrollTop(competenciasSelector), 360);
  assert.equal(nextHtml.scrollTop(inventarioSelector), 740);
  assert.equal(nextHtml.scrollTop(inventoryListSelector), 215);
});

test("cierre y reapertura no reutilizan estado de scroll obsoleto", async () => {
  const { sheet } = createSheet();
  sheet._saveScrollPositions(createHtml({ [personajeSelector]: 280 }));

  await sheet.close();
  sheet._restoreScrollPositions(createHtml({ [personajeSelector]: 0 }));
  const { sheet: reopenedSheet } = createSheet();
  reopenedSheet._restoreScrollPositions(createHtml({ [personajeSelector]: 0 }));

  assert.equal(sheet._scrollPositions, null);
  assert.equal(reopenedSheet._scrollPositions, null);
  assert.equal(baseRestoreCalls, 0);
});

test("la preservación no registra listeners ni duplica efectos entre renders", () => {
  const { sheet } = createSheet();
  const previousHtml = createHtml({ [personajeSelector]: 100 });
  const nextHtml = createHtml({ [personajeSelector]: 0 });
  const finalHtml = createHtml({ [personajeSelector]: 0 });

  sheet.rerender(previousHtml, nextHtml);
  sheet.rerender(nextHtml, finalHtml);

  assert.equal(baseRestoreCalls, 2);
  assert.equal(Object.hasOwn(sheet, "_mtrolScrollListener"), false);
});

test("preservar scroll no produce Actor.update ni Item.update adicionales", () => {
  const { sheet } = createSheet();

  sheet.rerender(
    createHtml({ [personajeSelector]: 125 }),
    createHtml({ [personajeSelector]: 0 })
  );

  assert.equal(actorUpdates, 0);
  assert.equal(itemUpdates, 0);
});
