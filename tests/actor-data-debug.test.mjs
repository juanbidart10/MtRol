import test from "node:test";
import assert from "node:assert/strict";

globalThis.game = {
  user: {
    id: "gm",
    isGM: true
  }
};

globalThis.ui = {
  windows: {}
};

const debugModule =
  await import("../scripts/core/actor-data-debug.js");

function createItem({
  id,
  name,
  type = "objeto",
  tipoObjeto = "general",
  equipado = false,
  slot = "",
  cantidad = 1,
  material = "",
  peso = 0,
  slots = 0,
  categoria = "competencia",
  equipadaCombate = false
}) {
  return {
    id,
    uuid: `Actor.actor-debug.Item.${id}`,
    name,
    type,
    system: {
      tipoObjeto,
      equipado,
      slot,
      cantidad,
      material,
      peso,
      slots,
      categoria,
      equipadaCombate
    },
    update() {
      throw new Error("La auditoria no debe actualizar items.");
    },
    delete() {
      throw new Error("La auditoria no debe eliminar items.");
    }
  };
}

function createActor() {
  const items = [
    createItem({ id: "inventory", name: "Mochila", peso: 5 }),
    createItem({
      id: "equipped",
      name: "Espada",
      equipado: true,
      slot: "manoDer",
      peso: 10
    }),
    createItem({
      id: "ghost",
      name: "Mineral de Plata Fortificada",
      tipoObjeto: "material",
      equipado: true,
      peso: 20
    }),
    createItem({
      id: "skill",
      name: "Atletismo",
      type: "competencia",
      peso: 99
    })
  ];

  items.get = id => items.find(item => item.id === id) ?? null;

  return {
    id: "actor-debug",
    uuid: "Actor.actor-debug",
    name: "Actor Debug",
    type: "personaje",
    system: {
      atributos: { fuerza: 5 },
      equipamiento: {
        manoDer: "equipped"
      }
    },
    items,
    update() {
      throw new Error("La auditoria no debe actualizar actores.");
    },
    createEmbeddedDocuments() {
      throw new Error("La auditoria no debe crear documentos.");
    },
    deleteEmbeddedDocuments() {
      throw new Error("La auditoria no debe eliminar documentos.");
    }
  };
}

function installVisibleSheet(actor) {
  const weightElement = {
    textContent: "Peso actual: 50 / 50"
  };

  const root = {
    querySelectorAll(selector) {
      return selector.includes("mtrol-tab-inventario")
        ? [weightElement]
        : [];
    }
  };

  globalThis.ui.windows = {
    debugSheet: {
      appId: "debugSheet",
      actor,
      element: [root]
    }
  };
}

test("las cinco funciones se instalan dentro de game.mtrol.debug", () => {
  const api = {};
  debugModule.installActorDataDebugApi(api);

  for (const name of [
    "auditActor",
    "auditItems",
    "findGhostItems",
    "compareWeight",
    "auditCollections"
  ]) {
    assert.equal(typeof api[name], "function");
  }
});

test("la auditoria explica UI, colecciones visibles y peso fantasma sin mutar", () => {
  const actor = createActor();
  installVisibleSheet(actor);

  const report = debugModule.auditActor(actor);
  const ghosts = debugModule.findGhostItems(actor);
  const comparison = debugModule.compareWeight(actor);
  const items = debugModule.auditItems(actor);
  const collections = debugModule.auditCollections(actor);

  assert.equal(report.pesoMostradoSheet.pesoActual, 50);
  assert.equal(report.pesoCalculado, 35);
  assert.equal(report.pesoInventario, 5);
  assert.equal(report.pesoEquipamiento, 10);
  assert.equal(report.pesoGhost, 20);

  assert.deepEqual(
    ghosts.map(item => item.nombre),
    ["Mineral de Plata Fortificada"]
  );
  assert.equal(ghosts[0].participaCalculoPeso, true);
  assert.equal(ghosts[0].pesoAportado, 20);

  assert.equal(comparison.pesoPersistido, 35);
  assert.equal(comparison.pesoCalculado, 35);
  assert.equal(comparison.pesoMostradoUI, 50);

  assert.equal(items.find(item => item.id === "skill").subtotal, 0);
  assert.equal(collections.inventario.length, 1);
  assert.equal(collections.itemsEnSlots, undefined);
  assert.equal(collections.objetosOcultos.length, 1);
});

test("las auditorias rechazan ejecucion para usuarios no GM", () => {
  const actor = createActor();
  globalThis.game.user.isGM = false;

  assert.throws(
    () => debugModule.auditItems(actor),
    /Solo el GM/
  );

  globalThis.game.user.isGM = true;
});
