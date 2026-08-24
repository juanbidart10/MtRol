import test from "node:test";
import assert from "node:assert/strict";

globalThis.foundry = { utils: { randomID: () => `tx-${Math.random()}` } };

const users = [
  { id: "gm", isGM: true },
  { id: "owner", isGM: false }
];

globalThis.game = { user: users[0], users };
const actors = new Map();
globalThis.fromUuid = async uuid => actors.get(uuid) ?? null;

const {
  resetActorResourceServiceForTests,
  setActorSpiritualResource,
  setActorSpiritualResourceAuthoritative
} = await import("../scripts/actors/actor-resource-service.js");

function makeActor({ karma = 0, dharma = 0 } = {}) {
  const actor = {
    uuid: `Actor.${Math.random()}`,
    system: { recursos: { karma, dharma, exp: 99 } },
    updates: [],
    async update(changes, options) {
      this.updates.push({ changes: structuredClone(changes), options: structuredClone(options) });
      for (const [path, value] of Object.entries(changes)) {
        const resource = path.split(".").at(-1);
        this.system.recursos[resource] = value;
      }
    }
  };
  actors.set(actor.uuid, actor);
  return actor;
}

function payload(actor, resource, value) {
  return { actorUuid: actor.uuid, transactionId: `manual-${resource}-${value}-${Math.random()}`, resource, value };
}

test.beforeEach(() => {
  resetActorResourceServiceForTests();
  game.user = users[0];
});

for (const scenario of [
  ["karma", 0, 3], ["karma", 4, 2], ["karma", 2, 5],
  ["dharma", 0, 4], ["dharma", 5, 1]
]) {
  test(`GM fija ${scenario[0]} ${scenario[1]} → ${scenario[2]} por valor absoluto`, async () => {
    const actor = makeActor({ [scenario[0]]: scenario[1] });
    await setActorSpiritualResource(actor, scenario[0], scenario[2]);

    assert.equal(actor.system.recursos[scenario[0]], scenario[2]);
    assert.equal(actor.system.recursos.exp, 99);
    assert.equal(actor.updates.length, 1);
    assert.deepEqual(actor.updates[0].changes, { [`system.recursos.${scenario[0]}`]: scenario[2] });
    assert.equal(actor.updates[0].options.mtrolResourceOrigin, "gm-resource-set");
  });
}

test("rechaza límites, fracciones y recursos desconocidos", async () => {
  const actor = makeActor({ karma: 2, dharma: 3 });
  for (const [resource, value] of [["karma", -1], ["dharma", 6], ["karma", 2.5], ["estres", 2]]) {
    await assert.rejects(
      setActorSpiritualResourceAuthoritative(payload(actor, resource, value), { requestingUserId: "gm" }),
      /karma|dharma|enteros/i
    );
  }
  assert.deepEqual(actor.system.recursos, { karma: 2, dharma: 3, exp: 99 });
  assert.equal(actor.updates.length, 0);
});

test("Owner es rechazado y el Actor permanece intacto", async () => {
  const actor = makeActor({ karma: 4 });
  game.user = users[1];

  await assert.rejects(
    setActorSpiritualResourceAuthoritative(payload(actor, "karma", 1), { requestingUserId: "owner" }),
    /GM/
  );
  assert.equal(actor.system.recursos.karma, 4);
  assert.equal(actor.updates.length, 0);
});

test("edición manual 4 → 5 sólo escribe el recurso y no dispone de ruta de ChatMessage", async () => {
  let cards = 0;
  globalThis.ChatMessage = { create: async () => { cards++; } };
  const actor = makeActor({ dharma: 4 });

  await setActorSpiritualResource(actor, "dharma", 5);

  assert.equal(actor.system.recursos.dharma, 5);
  assert.equal(cards, 0);
});
