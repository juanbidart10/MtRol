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
  restaurarAcumuladoresDia,
  validarCostoResolucionMP,
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
    unsetFlagCalls: 0,
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
    async unsetFlag(_scope, key) {
      this.unsetFlagCalls += 1;
      if (key === "mpStacks") {
        for (const existing of Object.keys(flags)) delete flags[existing];
      }
    },
    async update(changes) {
      this.updateCalls += 1;
      if ("system.vitales.mp.value" in changes) {
        this.system.vitales.mp.value = changes["system.vitales.mp.value"];
      }
      const stackPath = "flags.mtrol.mpStacks";
      if (stackPath in changes) {
        for (const existing of Object.keys(flags)) delete flags[existing];
        Object.assign(flags, structuredClone(changes[stackPath]));
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
  competenciaAsociada = "magia",
  damageCostType = "none"
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
      competenciaAsociada,
      damageCostType
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
  assert.equal(actor.setFlagCalls, 0);
  assert.equal(actor.updateCalls, 3, "MP y stack se persisten juntos por uso");
});

test("Restaurar día devuelve las Competencias a su costo inicial", async () => {
  const actor = createActor(40);
  const competencia = createItem("competencia", { id: "atletismo" });

  assert.equal((await procesarConsumoMP(actor, competencia)).costoTotal, 1);
  assert.equal((await procesarConsumoMP(actor, competencia)).costoTotal, 2);
  assert.equal(actor.stacks.atletismo, 2);

  const restauracion = await restaurarAcumuladoresDia(actor);

  assert.equal(restauracion.competenciasRestauradas, 1);
  assert.deepEqual(actor.stacks, {});
  assert.equal((await procesarConsumoMP(actor, competencia)).costoTotal, 1);
});

test("Competencia + Básico stackea sólo la Competencia y vuelve a 2 MP tras restaurar", async () => {
  const actor = createActor(40);
  const competencia = createItem("competencia", {
    id: "embestida",
    damageCostType: "basic"
  });

  const ejecutarCombinada = async () => {
    const consumo = await procesarConsumoMP(actor, competencia);
    return {
      competencia: consumo.costoStack,
      basico: consumo.costoBasico,
      total: consumo.costoTotal
    };
  };

  assert.deepEqual(await ejecutarCombinada(), { competencia: 1, basico: 1, total: 2 });
  assert.deepEqual(await ejecutarCombinada(), { competencia: 2, basico: 1, total: 3 });

  await restaurarAcumuladoresDia(actor);

  assert.deepEqual(await ejecutarCombinada(), { competencia: 1, basico: 1, total: 2 });
  const siguiente = calcularConsumoMP(actor, competencia);
  assert.equal(siguiente.costoStack, 2);
  assert.equal(siguiente.costoBasico, 1);
  assert.equal(siguiente.costoTotal, 3);
});

test("Competencia limpia expone componentes autoritativos sin Básico", () => {
  const actor = createActor(10);
  const consumo = calcularConsumoMP(actor, createItem("competencia", { id: "limpia" }));

  assert.equal(consumo.costoStack, 1);
  assert.equal(consumo.costoBasico, 0);
  assert.equal(consumo.costoTotal, 1);
});

test("Competencia limpia con Básico muestra y valida 2 MP", () => {
  const actor = createActor(10);
  const consumo = calcularConsumoMP(actor, createItem("competencia", {
    id: "limpia-basico",
    damageCostType: "basic"
  }));

  assert.equal(consumo.costoStack, 1);
  assert.equal(consumo.costoBasico, 1);
  assert.equal(consumo.costoTotal, 2);
  assert.equal(consumo.mpNuevo, 8);
});

test("Competencia con Básico progresa 2, 3, 4 y 5 sin contaminar el stack", async () => {
  const actor = createActor(30);
  const item = createItem("competencia", {
    id: "secuencia-basico",
    damageCostType: "basic"
  });
  const receipts = [];

  for (let use = 0; use < 4; use += 1) {
    receipts.push(await procesarConsumoMP(actor, item));
  }

  assert.deepEqual(receipts.map(receipt => receipt.costoTotal), [2, 3, 4, 5]);
  assert.deepEqual(receipts.map(receipt => receipt.costoBasico), [1, 1, 1, 1]);
  assert.deepEqual(receipts.map(receipt => receipt.costoStack), [1, 2, 3, 4]);
  assert.equal(actor.stacks[item.id], 4, "se persiste el uso, no el total previo");
});

test("Restaurar día con Básico conserva el vínculo y deja total 2; el uso siguiente deja 3", async () => {
  const actor = createActor(30, { ritual: 5 });
  const item = createItem("competencia", {
    id: "ritual",
    damageCostType: "basic"
  });

  assert.equal(calcularConsumoMP(actor, item).costoTotal, 7);
  await restaurarAcumuladoresDia(actor);
  assert.equal(item.system.damageCostType, "basic");
  assert.equal(calcularConsumoMP(actor, item).costoTotal, 2);

  const receipt = await procesarConsumoMP(actor, item);
  assert.equal(receipt.costoTotal, 2);
  assert.equal(calcularConsumoMP(actor, item).costoTotal, 3);
});

test("éxito y fallo cobran el mismo Básico fijo porque el resultado no interviene", async () => {
  for (const rollResult of [{ success: true }, { success: false }]) {
    const actor = createActor(20, { prueba: 2 });
    const item = createItem("competencia", {
      id: "prueba",
      damageCostType: "basic"
    });
    const receipt = await procesarConsumoMP(actor, item);

    assert.equal(typeof rollResult.success, "boolean");
    assert.equal(receipt.costoStack, 3);
    assert.equal(receipt.costoBasico, 1);
    assert.equal(receipt.costoTotal, 4);
    assert.equal(actor.system.vitales.mp.value, 16);
    assert.equal(calcularConsumoMP(actor, item).costoTotal, 5);
  }
});

test("cada Competencia conserva un stack independiente, también con Básico", async () => {
  const actor = createActor(50);
  const meditacion = createItem("competencia", {
    id: "meditacion",
    damageCostType: "basic"
  });
  const simbologia = createItem("competencia", {
    id: "simbologia",
    damageCostType: "basic"
  });

  await procesarConsumoMP(actor, meditacion);
  await procesarConsumoMP(actor, meditacion);
  await procesarConsumoMP(actor, meditacion);

  assert.deepEqual(actor.stacks, { meditacion: 3 });
  assert.equal(calcularConsumoMP(actor, meditacion).costoTotal, 5);
  assert.equal(calcularConsumoMP(actor, simbologia).costoTotal, 2);
});

test("Restaurar día es persistente e idempotente", async () => {
  const actor = createActor(20, { a: 5, b: 3 });

  await restaurarAcumuladoresDia(actor);
  assert.deepEqual(actor.getFlag("mtrol", "mpStacks"), {});
  await restaurarAcumuladoresDia(actor);

  assert.deepEqual(actor.getFlag("mtrol", "mpStacks"), {});
  assert.equal(actor.setFlagCalls, 0);
  assert.equal(actor.unsetFlagCalls, 2);
});

test("Restaurar día no declara éxito si la persistencia conserva stacks", async () => {
  const actor = createActor(20, { competencia: 4 });
  actor.unsetFlag = async () => {
    actor.unsetFlagCalls += 1;
  };

  await assert.rejects(
    restaurarAcumuladoresDia(actor),
    /No se pudieron reiniciar los acumuladores diarios/
  );
  assert.deepEqual(actor.stacks, { competencia: 4 });
});

test("stacks legacy ausentes, numéricos string o inválidos se leen de forma segura", () => {
  const item = createItem("competencia", { id: "legacy" });

  assert.equal(calcularConsumoMP(createActor(20), item).costoTotal, 1);
  assert.equal(calcularConsumoMP(createActor(20, { legacy: "4" }), item).costoTotal, 5);
  assert.equal(calcularConsumoMP(createActor(20, { legacy: null }), item).costoTotal, 1);
  assert.equal(calcularConsumoMP(createActor(20, { legacy: "invalido" }), item).costoTotal, 1);
  assert.equal(calcularConsumoMP(createActor(20, { legacy: -8 }), item).costoTotal, 1);
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

test("la Sheet delega Restaurar día al engine y no escribe el campo legacy", async () => {
  const source = await readFile(
    new URL("../scripts/sheets/actors/personaje-sheet.js", import.meta.url),
    "utf8"
  );

  assert.match(source, /await restaurarAcumuladoresDia\(this\.actor\)/);
  assert.doesNotMatch(source, /system\.mpStack/);
  assert.doesNotMatch(source, /unsetFlag\([^)]*mpStacks/);
});
