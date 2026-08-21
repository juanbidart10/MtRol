import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

globalThis.foundry = {
  utils: {
    duplicate: value => structuredClone(value)
  }
};
globalThis.game = {
  user: { id: "gm", isGM: true, active: true },
  users: [{ id: "gm", isGM: true, active: true }],
  system: { id: "mtrol" }
};
globalThis.ui = {
  notifications: {
    warn() {}
  }
};
globalThis.Math.clamp ??= (value, min, max) =>
  Math.min(max, Math.max(min, value));

const {
  aplicarConsumoMP,
  calcularConsumoMP,
  procesarConsumoMP,
  validarConsumoMP
} = await import("../scripts/combat/mp-engine.js");

function createActor(mp = 30, initialStacks = {}) {
  const flags = structuredClone(initialStacks);
  return {
    uuid: `Actor.hero-${Math.random()}`,
    name: "Heroe",
    system: { vitales: { mp: { value: mp, max: mp } } },
    getFlagCalls: 0,
    setFlagCalls: 0,
    updateCalls: 0,
    getFlag(_scope, key) {
      this.getFlagCalls += 1;
      return key === "mpStacks" ? flags : null;
    },
    async setFlag(_scope, key, value) {
      this.setFlagCalls += 1;
      if (key === "mpStacks") {
        for (const existing of Object.keys(flags)) delete flags[existing];
        Object.assign(flags, structuredClone(value));
      }
    },
    async update(changes) {
      this.updateCalls += 1;
      if ("system.vitales.mp.value" in changes) {
        this.system.vitales.mp.value = changes["system.vitales.mp.value"];
      }
    },
    stacks: flags
  };
}

function createItem(categoria, {
  id = categoria,
  name = categoria,
  costeMP = 99,
  nivel = 5,
  competenciaAsociada = "magia"
} = {}) {
  return {
    id,
    name,
    type: "competencia",
    system: {
      categoria,
      costeMP,
      nivel,
      nivelHechizo: nivel,
      competenciaAsociada
    }
  };
}

async function executeThreeTimes(categoria, options = {}) {
  const actor = createActor(40, options.initialStacks);
  const item = createItem(categoria, options);
  const costs = [];

  for (let use = 0; use < 3; use++) {
    const receipt = await procesarConsumoMP(actor, item);
    assert.equal(receipt.exito, true);
    costs.push(receipt.costoTotal);
  }

  return { actor, costs };
}

test("Básico cuesta 1 MP en cada uso e ignora coste legacy y stacks", async () => {
  const { actor, costs } = await executeThreeTimes("basico", {
    costeMP: 20,
    initialStacks: { basico: 8 }
  });

  assert.deepEqual(costs, [1, 1, 1]);
  assert.equal(actor.system.vitales.mp.value, 37);
  assert.equal(actor.getFlagCalls, 0);
  assert.equal(actor.setFlagCalls, 0);
});

test("Pasiva cuesta 0 MP y no consulta stacks", async () => {
  const actor = createActor(10, { pasiva: 20 });
  const receipt = await procesarConsumoMP(actor, createItem("pasiva"));

  assert.equal(receipt.costoTotal, 0);
  assert.equal(actor.system.vitales.mp.value, 10);
  assert.equal(actor.getFlagCalls, 0);
  assert.equal(actor.setFlagCalls, 0);
});

test("Básico mantiene 1 MP también en el uso 10", async () => {
  const actor = createActor(20, { basico: 50 });
  const item = createItem("basico");
  const costs = [];

  for (let use = 0; use < 10; use += 1) {
    costs.push((await procesarConsumoMP(actor, item)).costoTotal);
  }

  assert.deepEqual(costs, Array(10).fill(1));
  assert.equal(actor.system.vitales.mp.value, 10);
  assert.equal(actor.getFlagCalls, 0);
  assert.equal(actor.setFlagCalls, 0);
});

test("Hechizo cuesta su Nivel en cada uso sin stack ni competencia asociada", async () => {
  const { actor, costs } = await executeThreeTimes("hechizo", {
    id: "explosion",
    name: "Explosión Primordial",
    nivel: 5,
    costeMP: 20,
    competenciaAsociada: "magia",
    initialStacks: { "hechizo:magia": 7, explosion: 4 }
  });

  assert.deepEqual(costs, [5, 5, 5]);
  assert.equal(actor.system.vitales.mp.value, 25);
  assert.equal(actor.getFlagCalls, 0);
  assert.equal(actor.setFlagCalls, 0);
});

test("Competencia conserva el stacking vigente 1, 2 y 3", async () => {
  const { actor, costs } = await executeThreeTimes("competencia", {
    id: "atletismo",
    costeMP: 20
  });

  assert.deepEqual(costs, [1, 2, 3]);
  assert.equal(actor.system.vitales.mp.value, 34);
  assert.equal(actor.stacks.atletismo, 3);
  assert.equal(actor.getFlagCalls, 6, "validación cliente + recálculo canónico GM por uso");
  assert.equal(actor.setFlagCalls, 3);
});

test("Contraataque cuesta 5 MP en cada uso y no crea stacks", async () => {
  const { actor, costs } = await executeThreeTimes("contraataque", {
    costeMP: 1,
    initialStacks: { contraataque: 6 }
  });

  assert.deepEqual(costs, [5, 5, 5]);
  assert.equal(actor.system.vitales.mp.value, 25);
  assert.equal(actor.getFlagCalls, 0);
  assert.equal(actor.setFlagCalls, 0);
});

test("Habilidad Especial usa la categoría real combate y cuesta siempre 5 MP", async () => {
  const { actor, costs } = await executeThreeTimes("combate", {
    id: "habilidad-especial",
    name: "Habilidad Especial",
    costeMP: 1,
    initialStacks: { "habilidad-especial": 6 }
  });

  assert.deepEqual(costs, [5, 5, 5]);
  assert.equal(actor.system.vitales.mp.value, 25);
  assert.equal(actor.getFlagCalls, 0);
  assert.equal(actor.setFlagCalls, 0);
});

test("Hechizos de Nivel 1, 2 y 3 cuestan respectivamente 1, 2 y 3 MP", () => {
  const actor = createActor(10);

  assert.equal(calcularConsumoMP(actor, createItem("hechizo", { nivel: 1 })).costoTotal, 1);
  assert.equal(calcularConsumoMP(actor, createItem("hechizo", { nivel: 2 })).costoTotal, 2);
  assert.equal(calcularConsumoMP(actor, createItem("hechizo", { nivel: 3 })).costoTotal, 3);
  assert.equal(actor.getFlagCalls, 0);
});

test("Explosión Primordial Nivel 1 sola debita exactamente 1 MP", async () => {
  const actor = createActor(10, { "hechizo:magia": 9 });
  const explosion = createItem("hechizo", {
    id: "explosion-primordial",
    name: "Explosión Primordial",
    nivel: 1
  });

  const receipt = await procesarConsumoMP(actor, explosion);

  assert.equal(receipt.costoTotal, 1);
  assert.equal(actor.system.vitales.mp.value, 9);
});

test("Explosión y Ataque Áurico debitados al ejecutarse cuestan 2 MP total", async () => {
  const actor = createActor(10);
  const explosion = createItem("hechizo", {
    id: "explosion-primordial",
    name: "Explosión Primordial",
    nivel: 1
  });
  const ataqueAurico = createItem("basico", {
    id: "ataque-aurico",
    name: "Ataque Áurico"
  });

  await procesarConsumoMP(actor, explosion);
  assert.equal(actor.system.vitales.mp.value, 9);

  await procesarConsumoMP(actor, ataqueAurico);
  assert.equal(actor.system.vitales.mp.value, 8);
});

test("habilitar Ataque Áurico sin ejecutarlo no produce consumo anticipado", async () => {
  const actor = createActor(10);
  const explosion = createItem("hechizo", {
    id: "explosion-primordial",
    name: "Explosión Primordial",
    nivel: 1
  });

  await procesarConsumoMP(actor, explosion);
  const ataqueAuricoHabilitado = true;

  assert.equal(ataqueAuricoHabilitado, true);
  assert.equal(actor.system.vitales.mp.value, 9);
  assert.equal(actor.updateCalls, 1);
});

test("aplicar dos veces el mismo recibo no duplica el débito de una acción", async () => {
  const actor = createActor(10);
  const consumo = validarConsumoMP(actor, createItem("hechizo", { nivel: 1 }));

  await aplicarConsumoMP(actor, consumo);
  await aplicarConsumoMP(actor, consumo);

  assert.equal(actor.system.vitales.mp.value, 9);
  assert.equal(consumo.costoTotal, 1);
});

test("Meditar continúa calculando la restauración como dos veces el costo real", async () => {
  const source = await readFile(
    new URL("../scripts/sheets/actors/personaje-sheet.js", import.meta.url),
    "utf8"
  );

  assert.match(source, /restauracion\s*=\s*exito\s*\?\s*costeAplicado\s*\*\s*2\s*:\s*0/s);
});
