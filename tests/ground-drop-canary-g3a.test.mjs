import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { AuthorityService } from "../scripts/core/authority-service.js";
import { CommandRegistry } from "../scripts/runtime/command-registry.js";
import { ReceiptIdentityConflictError, ReceiptStore } from "../scripts/runtime/receipt-store.js";
import { TransactionCoordinator } from "../scripts/runtime/transaction-coordinator.js";
import {
  GROUND_AUTHORITY_FLAG,
  GROUND_PUBLIC_FLAG,
  GroundPersistencePrimitive,
  GroundSceneFlagStorage
} from "../scripts/ground/ground-repository.js";
import { GroundSceneReceiptRepository, createGroundReceiptScope } from "../scripts/ground/ground-receipt-scope.js";
import { reconstructItemTransferData } from "../scripts/items/item-transfer-data.js";
import {
  GROUND_COMMAND,
  GROUND_SOCKET_ACTION,
  dispatchGroundSocketCommand,
  getGroundCommandForSocketAction,
  registerGroundCommands
} from "../scripts/runtime/ground-commands.js";
import {
  buildGroundDropIntent,
  createGroundDropCanvasHandler,
  createItemPilesGroundDropVeto,
  registerGroundDropAdapterHooks,
  shouldClaimGroundDrop
} from "../scripts/ground/ground-drop-adapter.js";

const GROUND_ID = "ground:world-one:G3ACanaryGround000000001";
const ACTOR_UUID = "Actor.source";
const ITEM_UUID = `${ACTOR_UUID}.Item.source-item`;

const clone = value => structuredClone(value);

class FakeScene {
  constructor(id = "scene-a") { this.id = id; this.flags = {}; this.writes = []; }
  getFlag(scope, key) { return this.flags[scope]?.[key] ?? null; }
  async setFlag(scope, key, value) {
    this.flags[scope] ??= {};
    this.flags[scope][key] = clone(value);
    this.writes.push(key);
    return this;
  }
}

function makeItem({ id = "source-item", type = "objeto", parent = null, quantity = 1 } = {}) {
  const item = {
    id,
    _id: id,
    uuid: parent ? `${parent.uuid}.Item.${id}` : `Item.${id}`,
    documentName: "Item",
    name: "Espada Canary",
    type,
    img: "items/real-sword.webp",
    parent,
    system: { cantidad: quantity, equipado: false, slot: "", marker: "server-real" },
    flags: { mtrol: { source: "real" } },
    effects: [{ _id: "effect", name: "Real effect" }],
    updateCalls: 0,
    deleteCalls: 0,
    update() { this.updateCalls += 1; throw new Error("source update forbidden"); },
    delete() { this.deleteCalls += 1; throw new Error("source delete forbidden"); },
    toObject() {
      return clone({
        _id: this.id, name: this.name, type: this.type, img: this.img,
        system: this.system, flags: this.flags, effects: this.effects
      });
    }
  };
  return item;
}

function makeActor({ id = "source", type = "personaje", ownerIds = ["owner"] } = {}) {
  const actor = {
    id,
    uuid: `Actor.${id}`,
    documentName: "Actor",
    type,
    isToken: false,
    system: { equipamiento: {} },
    items: new Map(),
    ownership: Object.fromEntries(ownerIds.map(userId => [userId, 3])),
    itemMutationCalls: 0,
    testUserPermission(user, level) { return level === "OWNER" && ownerIds.includes(user?.id); },
    updateEmbeddedDocuments() { this.itemMutationCalls += 1; throw new Error("source mutation forbidden"); },
    deleteEmbeddedDocuments() { this.itemMutationCalls += 1; throw new Error("source mutation forbidden"); }
  };
  const item = makeItem({ parent: actor });
  actor.items.set(item.id, item);
  return { actor, item };
}

function realDrag(item, extra = {}) {
  return {
    type: "Item",
    uuid: item.uuid,
    actorId: item.parent.id,
    itemId: item.id,
    mtrolInternal: {
      source: "mtrol-personaje-sheet",
      actorId: item.parent.id,
      itemId: item.id,
      slotOrigin: ""
    },
    x: 123.5,
    y: 456.25,
    ...extra
  };
}

function usersFixture() {
  const users = [
    { id: "gm", isGM: true, active: true, viewedScene: "scene-a" },
    { id: "owner", isGM: false, active: true, viewedScene: "scene-a" },
    { id: "observer", isGM: false, active: true, viewedScene: "scene-a" },
    { id: "limited", isGM: false, active: true, viewedScene: "scene-a" },
    { id: "none", isGM: false, active: true, viewedScene: "scene-a" }
  ];
  users.get = id => users.find(user => user.id === id) ?? null;
  return users;
}

async function commandFixture({ authorityOverride = {}, lifecycleOverride = null } = {}) {
  const scene = new FakeScene();
  const scenes = new Map([[scene.id, scene]]);
  const { actor, item } = makeActor();
  const foreign = makeActor({ id: "foreign", ownerIds: [] });
  const documents = new Map([
    [actor.uuid, actor], [item.uuid, item],
    [foreign.actor.uuid, foreign.actor], [foreign.item.uuid, foreign.item]
  ]);
  const users = usersFixture();
  const authorityService = {
    resolveUser: id => users.get(id),
    isPrimaryGM: () => true,
    createWriteContext: () => ({ authorityUserId: "gm", generation: "1:gm" }),
    validateWriteContext: () => true,
    assertActorOwnership(candidate, userId) {
      const user = users.get(userId);
      if (user?.isGM) return true;
      if (!candidate.testUserPermission(user, "OWNER")) {
        throw Object.assign(new Error("not owner"), { reasonCode: "ACTOR_NOT_OWNED" });
      }
      return true;
    },
    ...authorityOverride
  };
  const resolveScene = id => scenes.get(id) ?? null;
  const repository = new GroundPersistencePrimitive({
    publicStorage: new GroundSceneFlagStorage({ flagKey: GROUND_PUBLIC_FLAG, recordKind: "public", resolveScene }),
    authorityStorage: new GroundSceneFlagStorage({ flagKey: GROUND_AUTHORITY_FLAG, recordKind: "authority", resolveScene })
  });
  const receiptRepository = new GroundSceneReceiptRepository({ resolveScene });
  const receiptStore = new ReceiptStore({ repository: receiptRepository });
  const registry = new CommandRegistry({ receiptStore, observability: null });
  const transactionCoordinator = new TransactionCoordinator({ combatReceiptStore: receiptStore, authority: authorityService });
  let pendingCalls = 0;
  let activationCalls = 0;
  let publicationCalls = 0;
  const lifecycleTrace = { pendingInputs: [], publicPatches: [] };
  const createLifecycle = assertAuthority => lifecycleOverride ?? {
    async createPendingGround(input) {
      pendingCalls += 1;
      lifecycleTrace.pendingInputs.push(clone(input));
      const { GroundLifecycleService } = await import("../scripts/ground/ground-lifecycle-service.js");
      return new GroundLifecycleService({ repository, idFactory: () => GROUND_ID, assertAuthority })
        .createPendingGround(input);
    },
    async activateGround(...args) {
      activationCalls += 1;
      const { GroundLifecycleService } = await import("../scripts/ground/ground-lifecycle-service.js");
      return new GroundLifecycleService({ repository, idFactory: () => GROUND_ID, assertAuthority })
        .activateGround(...args);
    },
    async updateGroundPublicState(...args) {
      publicationCalls += 1;
      lifecycleTrace.publicPatches.push(clone(args[2]));
      const { GroundLifecycleService } = await import("../scripts/ground/ground-lifecycle-service.js");
      return new GroundLifecycleService({ repository, idFactory: () => GROUND_ID, assertAuthority })
        .updateGroundPublicState(...args);
    }
  };
  const dependencies = {
    authorityService,
    repository,
    resolveScene,
    resolveUuid: uuid => Promise.resolve(documents.get(uuid) ?? null),
    createReceiptTarget: sceneId => createGroundReceiptScope(sceneId, { repository: receiptRepository }),
    transactionCoordinator,
    createGroundId: () => GROUND_ID,
    createLifecycle,
    now: () => 1700000000000,
    logger: { warn() {}, error() {}, info() {} }
  };
  registerGroundCommands(registry, dependencies);
  return {
    scene, scenes, actor, item, foreign, users, documents, repository, registry,
    receiptStore, authorityService, dependencies,
    counts: () => ({ pendingCalls, activationCalls, publicationCalls }), lifecycleTrace
  };
}

const dropPayload = (overrides = {}) => ({
  sourceActorUuid: ACTOR_UUID,
  sourceItemUuid: ITEM_UUID,
  sceneId: "scene-a",
  position: { x: 123.5, y: 456.25 },
  ...overrides
});

const envelope = (transactionId, payload = dropPayload()) => ({
  command: GROUND_COMMAND.DROP,
  transactionId,
  payload
});

const context = (requestingUserId = "owner", isPrimaryGM = true) => ({ requestingUserId, isPrimaryGM });

function sourceFingerprint(actor, item) {
  return JSON.stringify({
    inventory: [...actor.items.values()].map(entry => entry.toObject()),
    item: item.toObject(),
    quantity: item.system.cantidad,
    equipped: item.system.equipado,
    slot: item.system.slot,
    effects: item.effects
  });
}

test("G3A claim reconoce sólo Item embebido objeto/item de Actor MTROL", () => {
  for (const type of ["objeto", "item"]) {
    const { actor, item } = makeActor();
    item.type = type;
    assert.equal(shouldClaimGroundDrop(realDrag(item), { resolveUuid: uuid => uuid === item.uuid ? item : null }), true);
    assert.deepEqual(buildGroundDropIntent({ scene: { id: "scene-a" } }, realDrag(item), {
      resolveUuid: uuid => uuid === item.uuid ? item : null
    }), {
      sourceActorUuid: actor.uuid,
      sourceItemUuid: item.uuid,
      sceneId: "scene-a",
      position: { x: 123.5, y: 456.25 }
    });
  }
  const { actor, item } = makeActor();
  item.type = "competencia";
  assert.equal(shouldClaimGroundDrop(realDrag(item), { resolveUuid: () => item }), false);
  item.type = "objeto";
  assert.equal(shouldClaimGroundDrop({ ...realDrag(item), type: "Actor" }, { resolveUuid: () => item }), false);
  assert.equal(shouldClaimGroundDrop({ type: "Item", uuid: "Item.world" }, { resolveUuid: () => makeItem() }), false);
  assert.equal(shouldClaimGroundDrop({ type: "Item", uuid: "Compendium.x.y.Item.i" }, { resolveUuid: () => makeItem() }), false);
  assert.equal(shouldClaimGroundDrop(null, { resolveUuid: () => item }), false);
  assert.equal(shouldClaimGroundDrop({ type: "Item" }, { resolveUuid: () => item }), false);
  assert.equal(actor.items.get(item.id), item);
});

test("G3A dropCanvasData reclama sincrónicamente y envía sólo el intent permitido", async () => {
  const { item } = makeActor();
  const calls = [];
  const handler = createGroundDropCanvasHandler({
    resolveUuid: () => item,
    transactionIdFactory: () => "drop-tx",
    requestPrimary: (...args) => { calls.push(args); return Promise.resolve({ ok: true }); },
    notifyError: () => {}
  });
  assert.equal(handler.constructor.name, "Function");
  const result = handler({ scene: { id: "scene-a" } }, realDrag(item));
  assert.equal(result, false);
  await Promise.resolve();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], GROUND_SOCKET_ACTION.DROP);
  assert.deepEqual(calls[0][1], dropPayload());
  assert.deepEqual(calls[0][2], { transactionId: "drop-tx", notifyOnTimeout: false });
  assert.deepEqual(Object.keys(calls[0][1]).sort(), ["position", "sceneId", "sourceActorUuid", "sourceItemUuid"]);
  assert.doesNotMatch(JSON.stringify(calls[0][1]), /system|flags|effects|itemSnapshot|requestingUserId|quantity/);
});

test("G3B.0 timeout de ACK reintenta una vez con el mismo transactionId", async () => {
  const { item } = makeActor();
  const calls = [];
  const errors = [];
  const handler = createGroundDropCanvasHandler({
    resolveUuid: () => item,
    transactionIdFactory: () => "ack-retry-tx",
    requestPrimary: async (...args) => {
      calls.push(args);
      return calls.length === 1
        ? { ok: false, reasonCode: "SOCKET_TIMEOUT", error: "late" }
        : { ok: true, result: { groundId: GROUND_ID } };
    },
    notifyError: error => errors.push(error)
  });
  assert.equal(handler({ scene: { id: "scene-a" } }, realDrag(item)), false);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls.length, 2);
  assert.equal(calls[0][2].transactionId, "ack-retry-tx");
  assert.equal(calls[1][2].transactionId, "ack-retry-tx");
  assert.deepEqual(errors, []);
});

test("G3A Item Piles veto comparte elegibilidad, es síncrono y no llama su API", () => {
  const { actor, item } = makeActor();
  const veto = createItemPilesGroundDropVeto({ resolveUuid: () => item });
  assert.equal(veto.constructor.name, "Function");
  assert.equal(veto(actor, false, { uuid: item.uuid, item: item.toObject(), quantity: 1 }, false), false);
  assert.equal(veto(false, false, { uuid: item.uuid, item: item.toObject(), quantity: 1 }, false), false);
  item.type = "competencia";
  assert.equal(veto(actor, false, { uuid: item.uuid, item: item.toObject(), quantity: 1 }, false), undefined);
});

test("G3A hook registration funciona con y sin Item Piles y registra una sola frontera", () => {
  const { item } = makeActor();
  const registrations = [];
  const Hooks = { on(name, callback) { registrations.push({ name, callback }); } };
  assert.equal(registerGroundDropAdapterHooks({ Hooks, game: { modules: new Map() }, resolveUuid: () => item }), true);
  assert.deepEqual(registrations.map(entry => entry.name), ["dropCanvasData"]);
  registrations.length = 0;
  const game = {
    modules: new Map([["item-piles", { active: true }]]),
    itempiles: { hooks: { ITEM: { PRE_DROP_DETERMINED: "item-piles.preDropItemDetermined" } } }
  };
  assert.equal(registerGroundDropAdapterHooks({ Hooks, game, resolveUuid: () => item, force: true }), true);
  assert.deepEqual(registrations.map(entry => entry.name), ["dropCanvasData", "item-piles.preDropItemDetermined"]);
  assert.equal(registrations[1].callback(item.parent, false, { uuid: item.uuid, item: item.toObject() }, false), false);
  assert.equal("API" in game.itempiles, false);
});

test("G3B.0 ground.drop delega el receipt exclusivamente a TransactionCoordinator", async () => {
  const fx = await commandFixture();
  const definition = fx.registry.handlers.get("ground.drop");
  assert.ok(definition);
  assert.equal(definition.scope, "world");
  assert.equal(definition.idempotent, false);
  assert.equal(getGroundCommandForSocketAction(GROUND_SOCKET_ACTION.DROP), GROUND_COMMAND.DROP);
  const dispatched = await dispatchGroundSocketCommand({
    action: GROUND_SOCKET_ACTION.DROP,
    transactionId: "socket-drop",
    requestingUserId: "owner",
    payload: dropPayload()
  }, { registry: fx.registry, dependencies: fx.dependencies, isPrimaryGM: () => true });
  assert.equal(dispatched.handled, true);
  assert.equal(dispatched.result.lifecycle, "ACTIVE");
});

test("G3A strict payload rechaza campos privilegiados, position extra y números no finitos", async () => {
  const fx = await commandFixture();
  for (const field of ["actorId", "itemId", "name", "img", "system", "flags", "effects", "quantity",
    "itemSnapshot", "lifecycle", "visibility", "pickupEnabled", "appearance", "createdBy", "provenance",
    "requestingUserId", "authorityUserId", "unknown"]) {
    await assert.rejects(fx.registry.dispatch(envelope(`bad-${field}`, dropPayload({ [field]: "forged" })), context()),
      error => error.reasonCode === "GROUND_COMMAND_PAYLOAD_INVALID");
  }
  for (const position of [
    { x: NaN, y: 1 }, { x: Infinity, y: 1 }, { x: -Infinity, y: 1 }, { x: "10", y: 1 },
    { x: 1, y: 2, z: 3 }
  ]) {
    await assert.rejects(fx.registry.dispatch(envelope(`bad-position-${String(position.x)}`, dropPayload({ position })), context()),
      error => error.reasonCode === "GROUND_COMMAND_PAYLOAD_INVALID");
  }
});

test("G3A valida Primary, Scene y viewedScene antes de resolver/mutar source", async () => {
  const fx = await commandFixture();
  const before = sourceFingerprint(fx.actor, fx.item);
  await assert.rejects(fx.registry.dispatch(envelope("no-primary"), context("owner", false)), /Primary GM/);
  await assert.rejects(fx.registry.dispatch(envelope("missing-scene", dropPayload({ sceneId: "missing" })), context()),
    error => error.reasonCode === "GROUND_SCENE_NOT_FOUND");
  fx.users.get("owner").viewedScene = "other";
  await assert.rejects(fx.registry.dispatch(envelope("stale-scene"), context()),
    error => error.reasonCode === "GROUND_DROP_SCENE_STALE");
  assert.equal(sourceFingerprint(fx.actor, fx.item), before);
});

test("G3A resuelve Actor/Item autoritativos, exige ownership y relación exacta", async () => {
  const fx = await commandFixture();
  for (const userId of ["observer", "limited", "none"]) {
    await assert.rejects(fx.registry.dispatch(envelope(`ownership-${userId}`), context(userId)),
      error => error.reasonCode === "ACTOR_NOT_OWNED");
  }
  await assert.rejects(fx.registry.dispatch(envelope("actor-missing", dropPayload({ sourceActorUuid: "Actor.missing" })), context()),
    error => error.reasonCode === "GROUND_SOURCE_ACTOR_NOT_FOUND");
  await assert.rejects(fx.registry.dispatch(envelope("item-missing", dropPayload({ sourceItemUuid: `${ACTOR_UUID}.Item.missing` })), context()),
    error => error.reasonCode === "GROUND_SOURCE_ITEM_NOT_FOUND");
  await assert.rejects(fx.registry.dispatch(envelope("item-mismatch", dropPayload({ sourceItemUuid: fx.foreign.item.uuid })), context()),
    error => error.reasonCode === "GROUND_SOURCE_ITEM_MISMATCH");
  fx.item.type = "competencia";
  await assert.rejects(fx.registry.dispatch(envelope("unsupported"), context()),
    error => error.reasonCode === "GROUND_SOURCE_ITEM_UNSUPPORTED");
  fx.item.type = "objeto";
  fx.item.system.cantidad = 0;
  await assert.rejects(fx.registry.dispatch(envelope("no-quantity"), context()),
    error => error.reasonCode === "GROUND_SOURCE_ITEM_UNSUPPORTED");
});

test("G3B.0 rechaza equipado por flag o slot real y rechaza Actor synthetic", async () => {
  for (const state of ["flag", "slot", "synthetic"]) {
    const fx = await commandFixture();
    if (state === "flag") fx.item.system.equipado = "true";
    if (state === "slot") fx.actor.system.equipamiento.manoDer = fx.item.id;
    if (state === "synthetic") fx.actor.isToken = true;
    await assert.rejects(
      fx.registry.dispatch(envelope(`policy-${state}`), context()),
      error => error.reasonCode === (state === "synthetic"
        ? "GROUND_SYNTHETIC_SOURCE_UNSUPPORTED"
        : "GROUND_SOURCE_ITEM_EQUIPPED")
    );
    assert.deepEqual(fx.counts(), { pendingCalls: 0, activationCalls: 0, publicationCalls: 0 });
  }
});

test("G3B.0 crea PENDING invisible, activa y recién entonces publica REVEALED sin tocar source", async () => {
  const fx = await commandFixture();
  const before = sourceFingerprint(fx.actor, fx.item);
  const result = await fx.registry.dispatch(envelope("create-one"), context());
  const pair = fx.repository.read("scene-a", result.groundId);
  assert.equal(result.transactionId, "create-one");
  assert.equal(result.groundId, GROUND_ID);
  assert.equal(result.sceneId, "scene-a");
  assert.equal(result.lifecycle, "ACTIVE");
  assert.deepEqual(result.publicProjection.position, { x: 123.5, y: 456.25 });
  assert.equal(result.publicProjection.visibility, "REVEALED");
  assert.equal(result.publicProjection.pickupEnabled, false);
  assert.equal(fx.lifecycleTrace.pendingInputs[0].visibility, "INVISIBLE");
  assert.equal(fx.lifecycleTrace.pendingInputs[0].pickupEnabled, false);
  assert.deepEqual(fx.lifecycleTrace.publicPatches, [{ visibility: "REVEALED", pickupEnabled: false }]);
  assert.deepEqual(result.publicProjection.appearance, { mode: "REAL", img: fx.item.img });
  assert.equal(pair.authorityRecord.quantity, 1);
  assert.equal(pair.authorityRecord.lifecycle, "ACTIVE");
  assert.deepEqual(pair.authorityRecord.provenance, {
    sourceActorUuid: fx.actor.uuid,
    sourceItemUuid: fx.item.uuid,
    createdBy: "owner",
    createdAt: 1700000000000,
    operationId: "create-one"
  });
  assert.equal(pair.authorityRecord.itemSnapshot.item.system.marker, "server-real");
  assert.doesNotThrow(() => reconstructItemTransferData(pair.authorityRecord.itemSnapshot, {
    quantity: 1,
    destinationItemUuid: "Actor.destination.Item.destination"
  }));
  assert.equal("authorityRecord" in result, false);
  assert.doesNotMatch(JSON.stringify(result), /server-real|itemSnapshot|effects|system/);
  assert.equal(sourceFingerprint(fx.actor, fx.item), before);
  assert.equal(fx.item.updateCalls, 0);
  assert.equal(fx.item.deleteCalls, 0);
  assert.equal(fx.actor.itemMutationCalls, 0);
  assert.deepEqual(fx.counts(), { pendingCalls: 1, activationCalls: 1, publicationCalls: 1 });
});

test("G3A GM y Owner permitidos; replay/lost ACK no crea segundo Ground y payload cambiado conflictúa", async () => {
  const fx = await commandFixture();
  const request = envelope("lost-ack");
  const first = await fx.registry.dispatch(request, context("owner"));
  const replay = await fx.registry.dispatch(request, context("owner"));
  assert.deepEqual(replay, first);
  assert.deepEqual(fx.counts(), { pendingCalls: 1, activationCalls: 1, publicationCalls: 1 });
  await assert.rejects(fx.registry.dispatch(envelope("lost-ack", dropPayload({ position: { x: 1, y: 2 } })), context("owner")),
    ReceiptIdentityConflictError);

  const gmFx = await commandFixture();
  const gmResult = await gmFx.registry.dispatch(envelope("gm-drop"), context("gm"));
  assert.equal(gmResult.lifecycle, "ACTIVE");
});

test("G3A fallos de persistence, activation y authority conservan fingerprints de source", async () => {
  for (const scenario of ["persistence", "activation", "authority"]) {
    let pendingCalls = 0;
    const lifecycle = {
      async createPendingGround() {
        pendingCalls += 1;
        if (scenario === "persistence") throw Object.assign(new Error("persist failed"), { reasonCode: "GROUND_CREATE_FAILED" });
        return { status: "MATCHED", authorityRecord: { lifecycle: "PENDING", groundId: GROUND_ID } };
      },
      async activateGround() {
        if (scenario === "activation") throw Object.assign(new Error("activation failed"), { reasonCode: "GROUND_ACTIVATE_FAILED" });
        return { status: "MATCHED", authorityRecord: { lifecycle: "ACTIVE", groundId: GROUND_ID }, publicProjection: {} };
      },
      async updateGroundPublicState() {
        return { status: "MATCHED", authorityRecord: { lifecycle: "ACTIVE", groundId: GROUND_ID }, publicProjection: {} };
      }
    };
    const authorityOverride = scenario === "authority"
      ? { validateWriteContext: () => { throw Object.assign(new Error("stale"), { reasonCode: "AUTHORITY_CONTEXT_STALE" }); } }
      : {};
    const fx = await commandFixture({ authorityOverride, lifecycleOverride: lifecycle });
    const before = sourceFingerprint(fx.actor, fx.item);
    await assert.rejects(fx.registry.dispatch(envelope(`failure-${scenario}`), context()),
      error => ["GROUND_CREATE_FAILED", "GROUND_ACTIVATE_FAILED", "AUTHORITY_CONTEXT_STALE"].includes(error.reasonCode));
    assert.equal(sourceFingerprint(fx.actor, fx.item), before);
    assert.equal(fx.item.updateCalls, 0);
    assert.equal(fx.actor.itemMutationCalls, 0);
    assert.equal(pendingCalls, scenario === "authority" ? 0 : 1);
  }
});

test("G3A no amplía arquitectura ni contiene rutas de mutación source", async () => {
  const [adapter, commands, sockets] = await Promise.all([
    readFile(new URL("../scripts/ground/ground-drop-adapter.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/runtime/ground-commands.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/core/sockets.js", import.meta.url), "utf8")
  ]);
  const product = `${adapter}\n${commands}`;
  for (const forbidden of [
    /\.update\s*\(/, /\.delete\s*\(/, /updateEmbeddedDocuments/, /deleteEmbeddedDocuments/,
    /system\.cantidad\s*=/, /SharedReservationLedger/,
    /GroundDropManager|GroundDropEngine|GroundTransferCoordinator|GroundAuthorityService|GroundReceiptStore/
  ]) assert.doesNotMatch(product, forbidden);
  assert.doesNotMatch(product, /from .*trade|Trade/);
  assert.equal((sockets.match(/game\.socket\.on\("system\.mtrol"/g) ?? []).length, 1);
  assert.doesNotMatch(sockets, /system\.mtrol\.ground/);
});
