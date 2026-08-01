import test from "node:test";
import assert from "node:assert/strict";

const registeredHooks = new Map();
const warnings = [];

globalThis.Hooks = {
  on(name, callback) {
    registeredHooks.set(name, callback);
  }
};

globalThis.game = {
  user: {
    id: "player",
    isGM: false
  },
  users: new Map([
    ["player", { id: "player", isGM: false }],
    ["gm", { id: "gm", isGM: true }]
  ])
};

globalThis.ui = {
  notifications: {
    warn(message) {
      warnings.push(message);
    }
  }
};

const {
  calcularCargaActor,
  registrarHooksPesoMtrol
} = await import("../scripts/core/mtrol-carry-weight.js");

function createItem({
  type = "objeto",
  peso = 0,
  cantidad = 1,
  material = "",
  slots = 0,
  equipado = false
} = {}) {
  return {
    type,
    system: {
      peso,
      cantidad,
      material,
      slots,
      equipado
    }
  };
}

function createActor({ fuerza = 2, items = [] } = {}) {
  return {
    type: "personaje",
    system: {
      atributos: { fuerza }
    },
    items
  };
}

test("la carga solo suma objetos f\u00edsicos embebidos y no duplica equipados", () => {
  const actor = createActor({
    items: [
      createItem({ peso: 3, cantidad: 2 }),
      createItem({ peso: 4, equipado: true }),
      createItem({ type: "competencia", peso: 99 }),
      createItem({ type: "competencia", peso: 99, equipado: true })
    ]
  });

  assert.deepEqual(calcularCargaActor(actor), {
    pesoActual: 10,
    pesoMaximo: 20,
    pesoLibre: 10,
    sobrecargado: false
  });
});

test("el estado visual usa el umbral inclusivo 49/50, 50/50 y 51/50", () => {
  const cases = [
    { peso: 49, expected: false },
    { peso: 50, expected: true },
    { peso: 51, expected: true }
  ];

  for (const { peso, expected } of cases) {
    const carga = calcularCargaActor(createActor({
      fuerza: 5,
      items: [createItem({ peso })]
    }));

    assert.equal(carga.pesoActual, peso);
    assert.equal(carga.pesoMaximo, 50);
    assert.equal(carga.sobrecargado, expected);
  }
});

test("el bloqueo previo impide movimiento del jugador con peso igual al m\u00e1ximo", () => {
  warnings.length = 0;
  registrarHooksPesoMtrol();

  const preUpdateToken =
    registeredHooks.get("preUpdateToken");

  const token = {
    x: 0,
    y: 0,
    elevation: 0,
    actor: createActor({
      fuerza: 1,
      items: [createItem({ peso: 10 })]
    })
  };

  assert.equal(
    preUpdateToken(token, { x: 100 }, {}, "player"),
    false
  );
  assert.deepEqual(warnings, [
    "El personaje est\u00e1 sobrecargado y no puede desplazarse."
  ]);
});

test("el bloqueo permite GM, cambios sin desplazamiento y actores bajo capacidad", () => {
  const preUpdateToken =
    registeredHooks.get("preUpdateToken");

  const fullToken = {
    x: 0,
    y: 0,
    elevation: 0,
    actor: createActor({
      fuerza: 1,
      items: [createItem({ peso: 10 })]
    })
  };

  const lightToken = {
    ...fullToken,
    actor: createActor({
      fuerza: 1,
      items: [createItem({ peso: 9 })]
    })
  };

  assert.equal(preUpdateToken(fullToken, { x: 100 }, {}, "gm"), true);
  assert.equal(preUpdateToken(fullToken, { rotation: 90 }, {}, "player"), true);
  assert.equal(preUpdateToken(lightToken, { y: 100 }, {}, "player"), true);
});
