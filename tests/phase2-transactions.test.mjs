import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

globalThis.foundry = {
  utils: {
    deepClone: value => value === undefined ? undefined : structuredClone(value),
    randomID: () => "phase2-id"
  }
};
globalThis.game = {
  actors: { get: () => null },
  combats: { get: () => null },
  users: { get: () => ({ id: "gm", isGM: true }) },
  user: { id: "gm", isGM: true },
  combat: null
};

const { ReceiptStore, getReceiptFromRuntime } = await import("../scripts/runtime/receipt-store.js");
const { TransactionCoordinator } = await import("../scripts/runtime/transaction-coordinator.js");
const {
  NON_COMBAT_RECEIPT_MAX_AGE_MS,
  NON_COMBAT_RECEIPT_MAX_COUNT,
  pruneActorReceiptsForTests
} = await import("../scripts/runtime/actor-runtime-repository.js");
const { getCompetenceExecutionModes } = await import("../scripts/actions/competence-mode-service.js");
const { aplicarDanioCanonicoAutorizado } = await import("../scripts/combat/damage-authorized.js");

class MemoryRepository {
  constructor() {
    this.runtime = { revision: 0, receipts: {} };
  }
  read() { return structuredClone(this.runtime); }
  async mutate(_target, mutator) {
    const draft = structuredClone(this.runtime);
    const value = await mutator(draft, { revision: draft.revision });
    draft.revision += 1;
    this.runtime = draft;
    return { runtime: structuredClone(draft), value };
  }
}

test("TransactionCoordinator devuelve el mismo resultado y aplica side effects una vez", async () => {
  const repository = new MemoryRepository();
  const store = new ReceiptStore({ repository });
  const coordinator = new TransactionCoordinator({ combatReceiptStore: store, actorReceiptStore: store });
  const actor = { uuid: "Actor.a" };
  let writes = 0;
  const execute = () => coordinator.execute({ actor }, {
    transactionId: "tx-once",
    command: "resource.test",
    prepare: async () => ({ before: 5, after: 4 }),
    apply: async ({ prepared, checkpoint }) => {
      writes += 1;
      await checkpoint("written", { after: prepared.after });
      return { ok: true, value: prepared.after };
    }
  });
  assert.deepEqual(await execute(), { ok: true, value: 4 });
  assert.deepEqual(await execute(), { ok: true, value: 4 });
  assert.equal(writes, 1);
  assert.equal(getReceiptFromRuntime(repository.runtime, "tx-once").status, "completed");
});

test("daño canónico con mismo transactionId muta armadura y HP una sola vez", async () => {
  const armor = {
    id: "armor",
    uuid: "Actor.target.Item.armor",
    type: "objeto",
    name: "Armadura",
    system: { defensa: 4 },
    updates: 0,
    async update(changes) {
      this.updates += 1;
      this.system.defensa = changes["system.defensa"];
    }
  };
  const items = [armor];
  items.get = id => items.find(item => item.id === id) ?? null;
  const target = {
    id: "target",
    uuid: "Actor.target",
    system: {
      vitales: { hp: { value: 20, max: 20 } },
      equipamiento: { pecho: "armor" }
    },
    items,
    hpWrites: 0,
    deletions: 0,
    async update(changes) {
      if ("system.vitales.hp.value" in changes) {
        this.hpWrites += 1;
        this.system.vitales.hp.value = changes["system.vitales.hp.value"];
      }
    },
    async deleteEmbeddedDocuments(_type, ids) {
      this.deletions += 1;
      for (const id of ids) {
        const index = items.findIndex(item => item.id === id);
        if (index >= 0) items.splice(index, 1);
      }
    }
  };
  const args = {
    targetActor: target,
    transactionId: "damage-once",
    payload: { danio: 6, slot: "pecho", numeroLocalizacion: 5 }
  };
  const first = await aplicarDanioCanonicoAutorizado(args);
  const replay = await aplicarDanioCanonicoAutorizado(args);
  assert.deepEqual(replay, first);
  assert.equal(target.deletions, 1);
  assert.equal(target.hpWrites, 1);
  assert.equal(target.system.vitales.hp.value, 18);
});

test("retención no-combate combina 128 receipts y 30 días", () => {
  const now = Date.now();
  const receipts = {};
  for (let index = 0; index < 140; index += 1) {
    receipts[`recent-${index}`] = { status: "completed", updatedAt: now - index };
  }
  receipts.expired = { status: "completed", updatedAt: now - NON_COMBAT_RECEIPT_MAX_AGE_MS - 1 };
  const retained = pruneActorReceiptsForTests(receipts, now);
  assert.equal(Object.keys(retained).length, NON_COMBAT_RECEIPT_MAX_COUNT);
  assert.equal(retained.expired, undefined);
  assert.ok(retained["recent-0"]);
  assert.equal(retained["recent-139"], undefined);
});

test("competencia multimodo depende de metadata y no del nombre Meditar", () => {
  const modes = getCompetenceExecutionModes({
    name: "Cualquier nombre",
    system: {
      executionModes: [
        { modeId: "RECOVER_MP", label: "Recuperar", strategy: "recover-mp" },
        { modeId: "ASTRAL_PROJECTION", label: "Astral", strategy: "narrative" }
      ]
    }
  });
  assert.deepEqual(modes.map(mode => mode.modeId), ["RECOVER_MP", "ASTRAL_PROJECTION"]);
  assert.deepEqual(getCompetenceExecutionModes({ name: "Meditar", system: {} }), []);
});

test("API de daño se instala sólo en init y ready no la sobrescribe", () => {
  const init = fs.readFileSync(new URL("../scripts/core/init.js", import.meta.url), "utf8");
  const ready = fs.readFileSync(new URL("../scripts/core/ready.js", import.meta.url), "utf8");
  assert.match(init, /aplicarDanioCanonicoAutorizado/);
  assert.doesNotMatch(ready, /game\.mtrol\.aplicarDanioAutorizado\s*=/);
});

test("Fase 2 no introduce otro nextTurn real", () => {
  const files = fs.readdirSync(new URL("../scripts/combat/", import.meta.url))
    .filter(name => name.endsWith(".js"));
  const occurrences = files.flatMap(name => {
    const source = fs.readFileSync(new URL(`../scripts/combat/${name}`, import.meta.url), "utf8");
    return source.match(/\.nextTurn\s*\(/g) ?? [];
  });
  assert.equal(occurrences.length, 1);
});
