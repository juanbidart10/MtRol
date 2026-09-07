import test from "node:test";
import assert from "node:assert/strict";

globalThis.foundry = {
  utils: {
    deepClone: value => value === undefined ? undefined : structuredClone(value),
    randomID: () => "effect-expansion"
  }
};

function actor(raceId, { hp = 20, hpMax = 20, mp = 0, mpMax = 10 } = {}) {
  const items = [];
  items.get = id => items.find(item => item.id === id) ?? null;
  return {
    id: raceId,
    uuid: `Actor.${raceId}`,
    documentName: "Actor",
    flags: { mtrol: {} },
    system: {
      identidad: { raceId },
      atributos: {
        fuerza: 2, destreza: 2, resistencia: 2, inteligencia: 2, voluntad: 2,
        suerte: 2, carisma: 2, aura: 2, percepcion: 2
      },
      vitales: {
        hp: { value: hp, max: hpMax },
        mp: { value: mp, max: mpMax }
      },
      equipamiento: {}
    },
    items,
    async update(changes) {
      for (const [path, value] of Object.entries(changes)) {
        if (path === "system.vitales.hp.value") this.system.vitales.hp.value = value;
        if (path === "system.vitales.mp.value") this.system.vitales.mp.value = value;
      }
    },
    async setFlag(_scope, key, value) {
      this.flags.mtrol[key] = structuredClone(value);
    }
  };
}

const combat = {
  id: "combat-effect-expansion",
  uuid: "Combat.effect-expansion",
  started: true,
  round: 1,
  turn: 0,
  flags: { mtrol: {} },
  combatants: [],
  turns: [],
  async update(changes) {
    if (changes["flags.mtrol.runtime"]) this.flags.mtrol.runtime = structuredClone(changes["flags.mtrol.runtime"]);
  }
};

globalThis.game = {
  user: { id: "gm", isGM: true },
  users: { get: () => ({ id: "gm", isGM: true }) },
  actors: { get: () => null },
  combat,
  combats: { get: id => id === combat.id ? combat : null }
};

const {
  resolveGameplayRollEffects,
  resolveInitiativeEffects
} = await import("../scripts/effects/effect-pipeline.js");
const {
  aplicarDanioCanonicoAutorizado,
  resolveAfterDamageEffects
} = await import("../scripts/combat/damage-authorized.js");

test("Frenesí deriva el umbral inclusivo desde HP persistido", () => {
  assert.equal(resolveGameplayRollEffects(actor("draconiano", { hp: 25, hpMax: 100 }), 12).value, 24);
  assert.equal(resolveGameplayRollEffects(actor("draconiano", { hp: 26, hpMax: 100 }), 12).value, 12);
  assert.equal(resolveGameplayRollEffects(actor("draconiano", { hp: 0, hpMax: 100 }), 12).value, 24);
});

test("Instinto es contextual, único y no muta atributos", () => {
  const source = actor("animalium");
  const before = structuredClone(source.system.atributos);
  const result = resolveInitiativeEffects(source, 12);
  assert.equal(result.value, 22);
  assert.equal(result.appliedEffects.length, 1);
  assert.deepEqual(source.system.atributos, before);
});

test("DAMAGE_TO_RESOURCE usa daño efectivo, floor final y metadata Aura explícita", () => {
  const fairy = actor("hada", { mp: 2, mpMax: 10 });
  const target = actor("humano");
  assert.equal(resolveAfterDamageEffects({
    sourceActor: fairy,
    targetActor: target,
    damageApplied: 7,
    damageSourceAttribute: "aura"
  }).resolution.resourceIntents.length, 0);
  const valid = resolveAfterDamageEffects({
    sourceActor: fairy,
    targetActor: target,
    damageApplied: 15,
    damageSourceAttribute: "aura"
  }).resolution;
  assert.equal(valid.resourceIntents[0].amount, 1);
  assert.equal(resolveAfterDamageEffects({
    sourceActor: fairy,
    targetActor: target,
    damageApplied: 15,
    damageSourceAttribute: null
  }).resolution.resourceIntents.length, 0);
});

test("Virtus restaura MP después del commit y el replay usa la misma operación hija", async () => {
  const fairy = actor("hada", { mp: 1, mpMax: 10 });
  const target = actor("humano", { hp: 30, hpMax: 30 });
  const args = {
    attackerActor: fairy,
    targetActor: target,
    transactionId: "virtus-parent",
    payload: {
      danio: 20,
      slot: "pecho",
      numeroLocalizacion: 5,
      damageSourceAttribute: "aura"
    }
  };
  const first = await aplicarDanioCanonicoAutorizado(args);
  const replay = await aplicarDanioCanonicoAutorizado(args);
  assert.equal(target.system.vitales.hp.value, 10);
  assert.equal(fairy.system.vitales.mp.value, 3);
  assert.equal(first.result.afterDamageEffects.operations[0].resourceDelta, 2);
  assert.equal(
    replay.result.afterDamageEffects.operations[0].transactionId,
    first.result.afterDamageEffects.operations[0].transactionId
  );
  assert.equal(first.result.afterDamageEffects.operations[0].parentTransactionId, "virtus-parent");
});

test("el replay conserva los efectos del daño original aunque la Raza cambie", async () => {
  const source = actor("hada", { hp: 10, hpMax: 20, mp: 0, mpMax: 10 });
  const target = actor("humano", { hp: 20, hpMax: 20 });
  const args = {
    attackerActor: source,
    targetActor: target,
    transactionId: "race-change-parent",
    payload: { danio: 20, slot: "pecho", numeroLocalizacion: 5, damageSourceAttribute: "aura" }
  };
  await aplicarDanioCanonicoAutorizado(args);
  assert.equal(source.system.vitales.mp.value, 2);
  source.system.identidad.raceId = "maldito";
  await aplicarDanioCanonicoAutorizado(args);
  assert.equal(source.system.vitales.hp.value, 10, "el daño viejo no adquiere Maldición al repetirse");
  assert.equal(source.system.vitales.mp.value, 2, "Virtus tampoco se duplica");
});

test("Maldición respeta cap, excluye auto-daño y usa sólo HP realmente perdido", async () => {
  const cursed = actor("maldito", { hp: 19, hpMax: 20 });
  const target = actor("humano", { hp: 7, hpMax: 7 });
  const receipt = await aplicarDanioCanonicoAutorizado({
    attackerActor: cursed,
    targetActor: target,
    transactionId: "maldicion-parent",
    payload: { danio: 20, slot: "pecho", numeroLocalizacion: 5 }
  });
  assert.equal(receipt.result.hpPerdido, 20, "el resultado legado conserva el daño calculado");
  assert.equal(target.system.vitales.hp.value, 0);
  assert.equal(cursed.system.vitales.hp.value, 20, "25% de 7 hace floor a 1 y respeta el máximo");
  assert.equal(receipt.result.afterDamageEffects.operations[0].damageApplied, 7);

  const self = actor("maldito", { hp: 20, hpMax: 20 });
  await aplicarDanioCanonicoAutorizado({
    attackerActor: self,
    targetActor: self,
    transactionId: "maldicion-self",
    payload: { danio: 8, slot: "pecho", numeroLocalizacion: 5 }
  });
  assert.equal(self.system.vitales.hp.value, 12);
});

test("detección, vuelo y posesión permanecen declarativos y sin handler", async () => {
  const source = await import("../scripts/races/racial-passive-catalog.js");
  assert.equal(source.getRacialPassiveDefinition("instinto_racial").effects[1].type, "CAPABILITY");
  assert.equal(source.getRacialPassiveDefinition("instinto_racial").effects[1].mode, "narrative");
  assert.equal(source.getRacialPassiveDefinition("virtus").effects[0].capability, "flight");
  assert.equal(source.getRacialPassiveDefinition("maldicion").effects[1].capability, "possession");
});
