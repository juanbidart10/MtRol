import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

let generatedId = 0;
const chatMessages = [];
const actors = new Map();

globalThis.foundry = {
  utils: {
    randomID: () => `consumable-${++generatedId}`,
    escapeHTML: value => String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
  }
};

const gm = { id: "gm", isGM: true, active: true };
const owner = { id: "owner", isGM: false, active: true };
const observer = { id: "observer", isGM: false, active: true };

globalThis.game = {
  user: gm,
  users: [gm, owner, observer],
  socket: { emit() {} },
  system: { id: "mtrol" }
};

globalThis.ui = {
  notifications: { warn() {}, error() {} }
};

globalThis.fromUuid = async uuid => actors.get(uuid) ?? null;
globalThis.ChatMessage = {
  getSpeaker: ({ actor }) => ({ actor: actor.id }),
  async create(data) {
    const message = { id: `message-${chatMessages.length + 1}`, ...data };
    chatMessages.push(message);
    return message;
  }
};

const {
  getConsumableConfiguration,
  resetConsumableServiceForTests,
  useConsumable,
  useConsumableAuthoritative
} = await import("../scripts/items/consumable-service.js");

const {
  resetActorResourceServiceForTests
} = await import("../scripts/actors/actor-resource-service.js");

const {
  buildConsumableChatCardContent
} = await import("../scripts/ui/consumable-chat-card.js");

function createActor({
  id = "hero",
  hp = 20,
  hpMax = 50,
  mp = 20,
  mpMax = 50,
  ownerIds = ["owner"]
} = {}) {
  const items = [];
  items.get = itemId => items.find(item => item.id === itemId) ?? null;

  const actor = {
    id,
    uuid: `Actor.${id}`,
    name: `Actor ${id}`,
    type: "personaje",
    items,
    system: {
      vitales: {
        hp: { value: hp, max: hpMax },
        mp: { value: mp, max: mpMax }
      },
      equipamiento: {}
    },
    updates: [],
    deletions: [],
    testUserPermission(user, level) {
      return level === "OWNER" && ownerIds.includes(user.id);
    },
    async update(changes, options = {}) {
      this.updates.push({ changes: structuredClone(changes), options });
      for (const resource of ["hp", "mp"]) {
        const path = `system.vitales.${resource}.value`;
        if (path in changes) this.system.vitales[resource].value = changes[path];
      }
      for (const [path, value] of Object.entries(changes)) {
        if (path.startsWith("system.equipamiento.")) {
          this.system.equipamiento[path.split(".").at(-1)] = value;
        }
      }
    },
    async deleteEmbeddedDocuments(type, ids) {
      assert.equal(type, "Item");
      this.deletions.push([...ids]);
      for (const itemId of ids) {
        const index = items.findIndex(item => item.id === itemId);
        if (index >= 0) items.splice(index, 1);
      }
    }
  };

  actors.set(actor.uuid, actor);
  return actor;
}

function addConsumable(actor, {
  id = "potion",
  name = "Poción configurable",
  quantity = 5,
  operation = "restore",
  resource = "hp",
  amount = 10,
  tipoObjeto = "consumible",
  includeQuantity = true
} = {}) {
  const system = {
    tipoObjeto,
    peso: 1,
    consumible: { operacion: operation, recurso: resource, valor: amount }
  };
  if (includeQuantity) system.cantidad = quantity;

  const item = {
    id,
    uuid: `${actor.uuid}.Item.${id}`,
    parent: actor,
    name,
    img: "icons/potion.webp",
    type: "objeto",
    system: structuredClone(system),
    _source: { system: structuredClone(system) },
    updates: [],
    async update(changes) {
      this.updates.push(structuredClone(changes));
      if ("system.cantidad" in changes) {
        this.system.cantidad = changes["system.cantidad"];
        this._source.system.cantidad = changes["system.cantidad"];
      }
    }
  };
  actor.items.push(item);
  return item;
}

async function authoritativeUse(actor, item, requestingUserId = "owner", transactionId = "use-1") {
  return useConsumableAuthoritative({
    actorUuid: actor.uuid,
    itemId: item.id,
    transactionId
  }, {
    requestingUserId,
    trustedActor: actor,
    trustedItem: item
  });
}

test.beforeEach(() => {
  generatedId = 0;
  actors.clear();
  chatMessages.length = 0;
  game.user = gm;
  resetActorResourceServiceForTests();
  resetConsumableServiceForTests();
});

for (const scenario of [
  { title: "HP 20/50 +10 produce 30/50", resource: "hp", before: 20, max: 50, amount: 10, after: 30, restored: 10, overflow: 0 },
  { title: "HP 45/50 +10 se limita a 50/50", resource: "hp", before: 45, max: 50, amount: 10, after: 50, restored: 5, overflow: 5 },
  { title: "HP 50/50 +10 no consume al estar al máximo", resource: "hp", before: 50, max: 50, amount: 10, after: 50, restored: 0, overflow: 10, noConsume: true },
  { title: "MP 20/50 +10 produce 30/50", resource: "mp", before: 20, max: 50, amount: 10, after: 30, restored: 10, overflow: 0 },
  { title: "MP 40/50 +15 se limita a 50/50", resource: "mp", before: 40, max: 50, amount: 15, after: 50, restored: 10, overflow: 5 },
  { title: "MP 50/50 +10 no consume al estar al máximo", resource: "mp", before: 50, max: 50, amount: 10, after: 50, restored: 0, overflow: 10, noConsume: true }
]) {
  test(scenario.title, async () => {
    const actor = createActor({
      hp: scenario.resource === "hp" ? scenario.before : 20,
      hpMax: scenario.resource === "hp" ? scenario.max : 50,
      mp: scenario.resource === "mp" ? scenario.before : 20,
      mpMax: scenario.resource === "mp" ? scenario.max : 50
    });
    const item = addConsumable(actor, {
      resource: scenario.resource,
      amount: scenario.amount
    });

    const result = await authoritativeUse(actor, item);

    assert.equal(actor.system.vitales[scenario.resource].value, scenario.after);
    assert.equal(result.after, scenario.after);
    assert.equal(result.restored, scenario.restored);
    assert.equal(result.overflow, scenario.overflow);
    assert.ok(result.after <= result.max);
    assert.equal(item.system.cantidad, scenario.noConsume ? 5 : 4);
    assert.equal(result.reasonCode, scenario.noConsume ? "RESOURCE_AT_MAXIMUM" : null);
    assert.equal(chatMessages.length, 1);
  });
}

test("los stacks 5 y 2 reducen exactamente una unidad", async () => {
  for (const [index, quantity] of [5, 2].entries()) {
    const actor = createActor({ id: `stack-${quantity}` });
    const item = addConsumable(actor, { quantity });
    const result = await authoritativeUse(actor, item, "owner", `stack-use-${index}`);
    assert.equal(item.system.cantidad, quantity - 1);
    assert.equal(result.remainingQuantity, quantity - 1);
  }
});

test("la última unidad usa la eliminación segura y no deja Items fantasma", async () => {
  const actor = createActor();
  const item = addConsumable(actor, { quantity: 1 });
  const result = await authoritativeUse(actor, item);

  assert.equal(result.itemDeleted, true);
  assert.equal(result.remainingQuantity, 0);
  assert.equal(actor.items.get(item.id), null);
  assert.deepEqual(actor.deletions, [[item.id]]);
  assert.equal(chatMessages.length, 1);
});

test("GM y Owner pueden usar; un usuario sin ownership no puede", async () => {
  const gmActor = createActor({ id: "gm-actor", ownerIds: [] });
  const gmItem = addConsumable(gmActor);
  await authoritativeUse(gmActor, gmItem, "gm", "gm-use");
  assert.equal(gmItem.system.cantidad, 4);

  const ownerActor = createActor({ id: "owner-actor" });
  const ownerItem = addConsumable(ownerActor);
  await authoritativeUse(ownerActor, ownerItem, "owner", "owner-use");
  assert.equal(ownerItem.system.cantidad, 4);

  const deniedActor = createActor({ id: "denied-actor" });
  const deniedItem = addConsumable(deniedActor);
  await assert.rejects(
    authoritativeUse(deniedActor, deniedItem, "observer", "denied-use"),
    /OWNER/
  );
  assert.equal(deniedActor.system.vitales.hp.value, 20);
  assert.equal(deniedItem.system.cantidad, 5);
});

test("el target siempre es el Actor que contiene el Item y no acepta selección externa", async () => {
  const source = createActor({ id: "source", hp: 10 });
  const other = createActor({ id: "other", hp: 3 });
  const item = addConsumable(source, { amount: 5 });
  await authoritativeUse(source, item);

  assert.equal(source.system.vitales.hp.value, 15);
  assert.equal(other.system.vitales.hp.value, 3);
  await assert.rejects(
    useConsumableAuthoritative({
      actorUuid: source.uuid,
      itemId: item.id,
      transactionId: "forged-target",
      targetActorUuid: other.uuid
    }, { requestingUserId: "owner" }),
    /Payload de consumible inválido/
  );
});

test("cada intención crea una Card y el uso sin efecto conserva su unidad", async () => {
  const fullActor = createActor({ id: "full", hp: 50 });
  const fullItem = addConsumable(fullActor, { quantity: 2 });
  const fullResult = await authoritativeUse(fullActor, fullItem, "owner", "full-use");
  assert.equal(chatMessages.length, 1);
  assert.match(chatMessages[0].content, /ya se encontraba al máximo/);
  assert.match(chatMessages[0].content, /Unidades restantes: <strong>2<\/strong>/);

  const lastActor = createActor({ id: "last", hp: 45 });
  const lastItem = addConsumable(lastActor, { quantity: 1, amount: 10 });
  const lastResult = await authoritativeUse(lastActor, lastItem, "owner", "last-use");
  assert.equal(chatMessages.length, 2);
  assert.equal(fullResult.cardMessageId, "message-1");
  assert.equal(lastResult.cardMessageId, "message-2");
  assert.match(chatMessages[1].content, /Excedente perdido: <strong>5 HP<\/strong>/);
  assert.match(chatMessages[1].content, /Unidades restantes: <strong>0<\/strong>/);
});

test("la Card sólo presenta el resultado resuelto y escapa contenido", () => {
  const html = buildConsumableChatCardContent({
    actorName: "<Actor>",
    itemName: "<Poción>",
    itemImg: "potion.webp",
    resource: "mp",
    before: 40,
    max: 50,
    after: 50,
    amount: 15,
    restored: 10,
    overflow: 5,
    remainingQuantity: 2
  });
  assert.match(html, /40 \/ 50 → 50 \/ 50/);
  assert.match(html, /Potencia: <strong>\+15 MP<\/strong>/);
  assert.match(html, /Restauración efectiva: <strong>\+10 MP<\/strong>/);
  assert.doesNotMatch(html, /<Actor>|<Poción>/);
});

test("doble clic concurrente ejecuta una restauración, un descuento y una Card", async () => {
  const actor = createActor({ hp: 20 });
  const item = addConsumable(actor, { quantity: 5 });
  let releaseUpdate;
  const gate = new Promise(resolve => { releaseUpdate = resolve; });
  const originalUpdate = actor.update.bind(actor);
  let resourceWrites = 0;
  actor.update = async (changes, options) => {
    if ("system.vitales.hp.value" in changes) {
      resourceWrites += 1;
      await gate;
    }
    return originalUpdate(changes, options);
  };

  const first = useConsumable(actor, item);
  const second = useConsumable(actor, item);
  releaseUpdate();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(firstResult.transactionId, secondResult.transactionId);
  assert.equal(resourceWrites, 1);
  assert.equal(actor.system.vitales.hp.value, 30);
  assert.equal(item.system.cantidad, 4);
  assert.equal(chatMessages.length, 1);
});

test("configuraciones inválidas y cantidad ausente o cero no modifican el Actor", async () => {
  const cases = [
    { operation: "damage" },
    { resource: "dharma" },
    { amount: 0 },
    { amount: Number.NaN },
    { quantity: 0 },
    { includeQuantity: false }
  ];

  for (const [index, itemOptions] of cases.entries()) {
    const actor = createActor({ id: `invalid-${index}` });
    const item = addConsumable(actor, itemOptions);
    const configuration = getConsumableConfiguration(item);
    assert.equal(configuration.valid, false);
    await assert.rejects(
      authoritativeUse(actor, item, "owner", `invalid-use-${index}`)
    );
    assert.equal(actor.system.vitales.hp.value, 20);
    assert.equal(actor.system.vitales.mp.value, 20);
    assert.equal(chatMessages.length, 0);
  }
});

test("un fallo ambiguo al descontar cantidad exige recovery sin rollback ciego", async () => {
  const actor = createActor({ hp: 20 });
  const item = addConsumable(actor);
  item.update = async () => { throw new Error("falló cantidad"); };

  await assert.rejects(authoritativeUse(actor, item), error => error.reasonCode === "RECOVERY_REQUIRED");
  assert.equal(actor.system.vitales.hp.value, 30);
  assert.equal(item.system.cantidad, 5);
  assert.equal(chatMessages.length, 0);
});

test("la integración mantiene UI, socket y schema aditivos", async () => {
  const [schema, sheet, template, sockets, commands, inspector] = await Promise.all([
    readFile(new URL("../models/objeto-model.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/sheets/actors/personaje-sheet.js", import.meta.url), "utf8"),
    readFile(new URL("../templates/actors/personaje-sheet.html", import.meta.url), "utf8"),
    readFile(new URL("../scripts/core/sockets.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/runtime/transaction-commands.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/items/inventory-inspector-view-model.js", import.meta.url), "utf8")
  ]);

  assert.match(schema, /consumible: new fields\.SchemaField/);
  assert.match(sheet, /\.off\("click"\)[\s\S]*_onUseConsumable/);
  assert.match(template, /mtrol-consumable-use/);
  assert.match(sockets, /dispatchTransactionSocketCommand/);
  assert.match(commands, /mtrolUseConsumable:\s*"consumable\.use"/);
  assert.match(inspector, /canUse: consumable\.valid && canUserUseConsumable/);
});
