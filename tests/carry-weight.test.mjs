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
  calcularPesoMaximoPorFuerza,
  puedeCargarItem,
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
  const apilado = createItem({ peso: 3, cantidad: 2 });
  const equipado = createItem({ peso: 4, equipado: true });
  const actor = createActor({
    items: [
      apilado,
      equipado,
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

  equipado.system.equipado = false;

  assert.equal(calcularCargaActor(actor).pesoActual, 10);
  assert.equal(apilado.system.cantidad, 2);
});

test("peso cero no cae a slots y el fallback legacy exige ausencia del campo", () => {
  const modernZero = createItem({
    peso: 0,
    slots: 1,
    cantidad: 7,
    material: "pluma"
  });
  const legacy = createItem({ slots: 2, cantidad: 3 });
  delete legacy.system.peso;
  const invalid = createItem({ peso: "invalido", slots: 99, cantidad: 1 });

  const carga = calcularCargaActor(createActor({
    items: [modernZero, legacy, invalid]
  }));

  assert.equal(carga.pesoActual, 6);
});

test("la capacidad respeta la tabla completa de fuerza y el exceso estricto", () => {
  const cases = [
    { fuerza: 0, capacidad: 10 },
    { fuerza: 1, capacidad: 10 },
    { fuerza: 2, capacidad: 20 },
    { fuerza: 3, capacidad: 30 },
    { fuerza: 4, capacidad: 40 },
    { fuerza: 5, capacidad: 50 }
  ];

  for (const { fuerza, capacidad } of cases) {
    assert.equal(calcularPesoMaximoPorFuerza(fuerza), capacidad);

    const alLimite = calcularCargaActor(createActor({
      fuerza,
      items: [createItem({ peso: capacidad })]
    }));
    const excedido = calcularCargaActor(createActor({
      fuerza,
      items: [createItem({ peso: capacidad + 0.01 })]
    }));

    assert.equal(alLimite.pesoMaximo, capacidad);
    assert.equal(alLimite.sobrecargado, false);
    assert.equal(excedido.pesoActual, capacidad + 0.01);
    assert.equal(excedido.sobrecargado, true);
  }
});

test("una fuerza inv\u00e1lida no se convierte silenciosamente en fuerza cero", () => {
  assert.throws(
    () => calcularPesoMaximoPorFuerza("invalida"),
    /fuerza debe ser un valor numérico válido/i
  );
  assert.throws(
    () => calcularCargaActor(createActor({ fuerza: null })),
    /fuerza debe ser un valor numérico válido/i
  );
});

test("el movimiento permite el l\u00edmite exacto y bloquea cualquier exceso", () => {
  warnings.length = 0;
  registrarHooksPesoMtrol();

  const preUpdateToken =
    registeredHooks.get("preUpdateToken");

  const cases = [
    { fuerza: 0, capacidad: 10 },
    { fuerza: 1, capacidad: 10 },
    { fuerza: 2, capacidad: 20 },
    { fuerza: 3, capacidad: 30 },
    { fuerza: 4, capacidad: 40 },
    { fuerza: 5, capacidad: 50 }
  ];

  for (const { fuerza, capacidad } of cases) {
    for (const { peso, permitido } of [
      { peso: 0, permitido: true },
      { peso: capacidad, permitido: true },
      { peso: capacidad + 0.01, permitido: false }
    ]) {
      const token = {
        x: 0,
        y: 0,
        elevation: 0,
        actor: createActor({
          fuerza,
          items: [createItem({ peso })]
        })
      };

      assert.equal(
        preUpdateToken(token, { x: 100 }, {}, "player"),
        permitido,
        `fuerza ${fuerza}, peso ${peso}`
      );
    }
  }

  assert.equal(warnings.length, 6);
});

test("al volver al l\u00edmite o por debajo, el movimiento se recupera de inmediato", () => {
  const preUpdateToken =
    registeredHooks.get("preUpdateToken");

  const item = createItem({ peso: 10.01 });
  const token = {
    x: 0,
    y: 0,
    elevation: 0,
    actor: createActor({
      fuerza: 1,
      items: [item]
    })
  };

  assert.equal(preUpdateToken(token, { x: 100 }, {}, "player"), false);

  item.system.peso = 10;
  assert.equal(preUpdateToken(token, { x: 100 }, {}, "player"), true);

  item.system.peso = 9;
  assert.equal(preUpdateToken(token, { x: 100 }, {}, "player"), true);
});

test("recibir un objeto con exceso conserva el objeto y restringe el movimiento", () => {
  registrarHooksPesoMtrol();

  const actor = createActor({ fuerza: 1 });
  const recibido = createItem({ peso: 10.01 });

  assert.equal(registeredHooks.has("preCreateItem"), false);
  assert.equal(puedeCargarItem(actor, recibido), true);

  actor.items.push(recibido);

  assert.equal(actor.items.includes(recibido), true);
  assert.equal(calcularCargaActor(actor).sobrecargado, true);

  const preUpdateToken = registeredHooks.get("preUpdateToken");
  const token = { x: 0, y: 0, elevation: 0, actor };

  assert.equal(preUpdateToken(token, { y: 100 }, {}, "player"), false);
  assert.equal(actor.items.includes(recibido), true);
});

test("destruir el objeto actualiza el peso y libera el movimiento", () => {
  const item = createItem({ peso: 10.01 });
  const actor = createActor({ fuerza: 1, items: [item] });
  const token = { x: 0, y: 0, elevation: 0, actor };
  const preUpdateToken = registeredHooks.get("preUpdateToken");

  assert.equal(preUpdateToken(token, { x: 100 }, {}, "player"), false);

  actor.items.splice(actor.items.indexOf(item), 1);

  assert.equal(calcularCargaActor(actor).pesoActual, 0);
  assert.equal(preUpdateToken(token, { x: 100 }, {}, "player"), true);
});

test("el bloqueo permite GM y cambios sin desplazamiento", () => {
  const preUpdateToken =
    registeredHooks.get("preUpdateToken");

  const overloadedToken = {
    x: 0,
    y: 0,
    elevation: 0,
    actor: createActor({
      fuerza: 1,
      items: [createItem({ peso: 10.01 })]
    })
  };

  assert.equal(preUpdateToken(overloadedToken, { x: 100 }, {}, "gm"), true);
  assert.equal(preUpdateToken(overloadedToken, { rotation: 90 }, {}, "player"), true);
});
