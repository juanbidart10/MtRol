import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  GROUND_APPEARANCE_MODE,
  GROUND_SCHEMA_VERSION,
  GROUND_VISIBILITY
} from "../scripts/ground/ground-schema.js";
import {
  GroundPersistencePrimitive
} from "../scripts/ground/ground-repository.js";
import {
  GROUND_ADMIN_ALPHA,
  GROUND_FALLBACK_IMG,
  GROUND_SIZE_FACTOR,
  GROUND_SORT_LAYER,
  buildGroundRenderModel,
  computeGroundSpriteScale,
  createGroundCanvasLayerClass,
  diffGroundRenderModels,
  isGroundPublicProjectionUpdate,
  registerGroundCanvasHooks,
  registerGroundCanvasLayer,
  shouldRenderGround
} from "../scripts/ground/ground-canvas-renderer.js";

const GROUND_A = "ground:world-one:AbCdEfGhIjKlMnOpQrStUvWx";
const GROUND_B = "ground:world-one:BbCdEfGhIjKlMnOpQrStUvWx";

function projection(overrides = {}) {
  return {
    schemaVersion: GROUND_SCHEMA_VERSION,
    groundId: GROUND_A,
    sceneId: "scene-a",
    position: { x: 100, y: 200 },
    visibility: GROUND_VISIBILITY.REVEALED,
    pickupEnabled: true,
    appearance: { mode: GROUND_APPEARANCE_MODE.REAL, img: "items/relic.webp" },
    ...overrides
  };
}

function envelope(records = {}) {
  return { schemaVersion: GROUND_SCHEMA_VERSION, revision: 1, sceneId: "scene-a", records };
}

class FakeContainer {
  constructor() {
    this.children = [];
    this.position = { x: 0, y: 0, set: (x, y) => { this.position.x = x; this.position.y = y; } };
    this.destroyed = false;
    this.destroyOptions = null;
  }
  addChild(child) { this.children.push(child); child.parent = this; return child; }
  removeChild(child) { this.children = this.children.filter(candidate => candidate !== child); child.parent = null; return child; }
  destroy(options) {
    this.destroyed = true;
    this.destroyOptions = options;
    if (options?.children) for (const child of this.children) child.destroy?.(options);
    this.children = [];
  }
}

class FakeSprite {
  constructor(texture) {
    this.texture = texture;
    this.eventMode = "auto";
    this.alpha = 1;
    this.anchor = { x: 0, y: 0, set: value => { this.anchor.x = value; this.anchor.y = value; } };
    this.scale = { x: 1, y: 1, set: value => { this.scale.x = value; this.scale.y = value; } };
    this.destroyed = false;
    this.destroyOptions = null;
  }
  destroy(options) { this.destroyed = true; this.destroyOptions = options; }
}

class FakeGraphics {
  constructor() { this.visible = true; this.eventMode = "auto"; this.destroyed = false; }
  lineStyle() { return this; }
  beginFill() { return this; }
  drawCircle() { return this; }
  moveTo() { return this; }
  lineTo() { return this; }
  endFill() { return this; }
  destroy() { this.destroyed = true; }
}

class FakeCanvasLayer extends FakeContainer {
  static get layerOptions() { return { name: "", zIndex: 0 }; }
  async _draw() { this.baseDrawn = true; }
  async _tearDown() { this.baseTornDown = true; }
}

const fakePixi = { Container: FakeContainer, Sprite: FakeSprite, Graphics: FakeGraphics };

function makeLayer({ records = [projection()], isGM = false, sceneId = "scene-a", gridSize = 100,
  loadTexture = async () => ({ valid: true, width: 200, height: 100 }), readError = null } = {}) {
  const calls = { reads: 0, loads: [], warnings: [] };
  const reader = Object.freeze({
    getPublicGroundForScene(requestedSceneId) {
      calls.reads++;
      if (readError) throw readError;
      assert.equal(requestedSceneId, sceneId);
      return structuredClone(records);
    }
  });
  const canvas = { ready: true, scene: { id: sceneId }, dimensions: { size: gridSize } };
  const Layer = createGroundCanvasLayerClass({
    CanvasLayerClass: FakeCanvasLayer,
    pixi: fakePixi,
    createPublicReader: () => reader,
    loadTexture: async src => { calls.loads.push(src); return loadTexture(src); },
    getCanvas: () => canvas,
    getIsGM: () => isGM,
    log: { warn: (...args) => calls.warnings.push(args), error: (...args) => calls.warnings.push(args) }
  });
  return { layer: new Layer(), Layer, calls, canvas, reader };
}

test("G2 public-only read never touches Authority", () => {
  let authorityReads = 0;
  const publicStorage = {
    read: () => envelope({ [GROUND_A]: projection() }),
    async write() { throw new Error("write forbidden"); }
  };
  const authorityStorage = {
    read() { authorityReads++; throw new Error("authority read forbidden"); },
    async write() { throw new Error("write forbidden"); }
  };
  const repository = new GroundPersistencePrimitive({ publicStorage, authorityStorage });
  const result = repository.getPublicGroundForScene("scene-a");
  assert.equal(authorityReads, 0);
  assert.deepEqual(result, [projection()]);
  result[0].position.x = 999;
  assert.equal(repository.getPublicGroundForScene("scene-a")[0].position.x, 100);
});

test("G2 visibility pure policy covers Player and GM", () => {
  assert.equal(shouldRenderGround(GROUND_VISIBILITY.INVISIBLE, false), false);
  assert.equal(shouldRenderGround(GROUND_VISIBILITY.INVISIBLE, true), true);
  for (const visibility of [GROUND_VISIBILITY.HIDDEN, GROUND_VISIBILITY.REVEALED]) {
    assert.equal(shouldRenderGround(visibility, false), true);
    assert.equal(shouldRenderGround(visibility, true), true);
  }
});

test("G2 render model uses center coordinates, 0.4 grid size and public appearance", () => {
  const real = buildGroundRenderModel(projection(), { sceneId: "scene-a", isGM: false, gridSize: 125 });
  assert.equal(real.x, 100);
  assert.equal(real.y, 200);
  assert.equal(real.anchor, 0.5);
  assert.equal(real.targetSize, 50);
  assert.equal(real.img, "items/relic.webp");
  assert.equal(real.administrative, false);
  assert.equal(real.alpha, 1);
  const generic = buildGroundRenderModel(projection({
    appearance: { mode: GROUND_APPEARANCE_MODE.GENERIC, img: "icons/generic.webp" }
  }), { sceneId: "scene-a", isGM: false, gridSize: 100 });
  assert.equal(generic.img, "icons/generic.webp");
});

test("G2 INVISIBLE Player is omitted and GM gets administrative alpha", () => {
  const hidden = projection({ visibility: GROUND_VISIBILITY.INVISIBLE });
  assert.equal(buildGroundRenderModel(hidden, { sceneId: "scene-a", isGM: false, gridSize: 100 }), null);
  const gm = buildGroundRenderModel(hidden, { sceneId: "scene-a", isGM: true, gridSize: 100 });
  assert.equal(gm.administrative, true);
  assert.equal(gm.alpha, GROUND_ADMIN_ALPHA);
});

test("G2 sceneId filtering omits projections from another Scene", () => {
  assert.equal(buildGroundRenderModel(projection({ sceneId: "scene-b" }), {
    sceneId: "scene-a", isGM: false, gridSize: 100
  }), null);
});

test("G2 sprite scale preserves aspect ratio and rejects invalid dimensions", () => {
  assert.equal(computeGroundSpriteScale({ width: 200, height: 100 }, 40), 0.2);
  assert.equal(computeGroundSpriteScale({ width: 100, height: 200 }, 40), 0.2);
  assert.equal(computeGroundSpriteScale({ width: 0, height: 100 }, 40), null);
  assert.equal(computeGroundSpriteScale({ width: 100, height: Number.NaN }, 40), null);
});

test("G2 diff classifies add, remove, position, appearance and unchanged", () => {
  const a = buildGroundRenderModel(projection(), { sceneId: "scene-a", isGM: false, gridSize: 100 });
  const b = buildGroundRenderModel(projection({ groundId: GROUND_B }), {
    sceneId: "scene-a", isGM: false, gridSize: 100
  });
  const moved = buildGroundRenderModel(projection({ position: { x: 101, y: 200 } }), {
    sceneId: "scene-a", isGM: false, gridSize: 100
  });
  const changedImg = buildGroundRenderModel(projection({
    appearance: { mode: "REAL", img: "items/new.webp" }
  }), { sceneId: "scene-a", isGM: false, gridSize: 100 });
  assert.deepEqual(diffGroundRenderModels(new Map(), new Map([[GROUND_A, a]])).added, [GROUND_A]);
  assert.deepEqual(diffGroundRenderModels(new Map([[GROUND_A, a]]), new Map()).removed, [GROUND_A]);
  assert.deepEqual(diffGroundRenderModels(new Map([[GROUND_A, a]]), new Map([[GROUND_A, moved]])).changed,
    [GROUND_A]);
  assert.deepEqual(diffGroundRenderModels(new Map([[GROUND_A, a]]), new Map([[GROUND_A, changedImg]])).changed,
    [GROUND_A]);
  const stable = diffGroundRenderModels(new Map([[GROUND_A, a], [GROUND_B, b]]),
    new Map([[GROUND_A, structuredClone(a)], [GROUND_B, structuredClone(b)]]));
  assert.deepEqual(stable.unchanged, [GROUND_A, GROUND_B]);
  assert.deepEqual(stable.added, []);
  assert.deepEqual(stable.changed, []);
  assert.deepEqual(stable.removed, []);
});

test("G2 initial draw creates centered non-interactive sprite at size 0.4 grid", async () => {
  const { layer, calls } = makeLayer();
  await layer._draw({});
  assert.equal(calls.reads, 1);
  assert.equal(layer.sortLayer, GROUND_SORT_LAYER);
  assert.equal(layer.constructor.layerOptions.name, "ground");
  assert.equal(layer.eventMode, "none");
  assert.equal(layer.interactiveChildren, false);
  const entry = layer.spriteEntries.get(GROUND_A);
  assert.ok(entry);
  assert.deepEqual({ x: entry.container.position.x, y: entry.container.position.y }, { x: 100, y: 200 });
  assert.deepEqual({ x: entry.sprite.anchor.x, y: entry.sprite.anchor.y }, { x: 0.5, y: 0.5 });
  assert.equal(entry.sprite.scale.x, 0.2);
  assert.equal(entry.sprite.scale.y, 0.2);
  assert.equal(entry.sprite.eventMode, "none");
});

test("G2 failed source texture uses fallback", async () => {
  const { layer, calls } = makeLayer({ loadTexture: async src =>
    src === GROUND_FALLBACK_IMG ? { valid: true, width: 100, height: 100 } : null });
  await layer._draw({});
  assert.deepEqual(calls.loads, ["items/relic.webp", GROUND_FALLBACK_IMG]);
  assert.ok(layer.spriteEntries.has(GROUND_A));
  assert.ok(calls.warnings.length >= 1);
});

test("G2 source and fallback failure isolates one Ground", async () => {
  const good = projection({ groundId: GROUND_B, appearance: { mode: "REAL", img: "items/good.webp" } });
  const { layer } = makeLayer({
    records: [projection(), good],
    loadTexture: async src => src === "items/good.webp" ? { valid: true, width: 64, height: 64 } : null
  });
  await layer._draw({});
  assert.equal(layer.spriteEntries.has(GROUND_A), false);
  assert.equal(layer.spriteEntries.has(GROUND_B), true);
});

test("G2 unchanged records retain sprite identity while position updates in place", async () => {
  const records = [projection()];
  const fx = makeLayer({ records });
  await fx.layer._draw({});
  const first = fx.layer.spriteEntries.get(GROUND_A).sprite;
  await fx.layer.sync();
  assert.strictEqual(fx.layer.spriteEntries.get(GROUND_A).sprite, first);
  records[0].position = { x: 350, y: 450 };
  await fx.layer.sync();
  const moved = fx.layer.spriteEntries.get(GROUND_A);
  assert.strictEqual(moved.sprite, first);
  assert.deepEqual({ x: moved.container.position.x, y: moved.container.position.y }, { x: 350, y: 450 });
});

test("G2 appearance change replaces only the changed sprite", async () => {
  const records = [projection(), projection({ groundId: GROUND_B })];
  const fx = makeLayer({ records });
  await fx.layer._draw({});
  const a = fx.layer.spriteEntries.get(GROUND_A).sprite;
  const b = fx.layer.spriteEntries.get(GROUND_B).sprite;
  records[0].appearance = { mode: "REAL", img: "items/new.webp" };
  await fx.layer.sync();
  assert.notStrictEqual(fx.layer.spriteEntries.get(GROUND_A).sprite, a);
  assert.strictEqual(fx.layer.spriteEntries.get(GROUND_B).sprite, b);
});

test("G2 async generation fencing ignores late stale texture", async () => {
  let releaseOld;
  const oldTexture = new Promise(resolve => { releaseOld = resolve; });
  const records = [projection({ appearance: { mode: "REAL", img: "items/old.webp" } })];
  const fx = makeLayer({ records, loadTexture: src => src === "items/old.webp"
    ? oldTexture : Promise.resolve({ valid: true, width: 100, height: 100 }) });
  const firstSync = fx.layer._draw({});
  await Promise.resolve();
  records[0].appearance = { mode: "REAL", img: "items/new.webp" };
  await fx.layer.sync();
  releaseOld({ valid: true, width: 100, height: 100 });
  await firstSync;
  assert.equal(fx.layer.spriteEntries.get(GROUND_A).model.img, "items/new.webp");
});

test("G2 Scene switch and teardown clear sprites without destroying shared textures", async () => {
  const texture = { valid: true, width: 100, height: 100, destroyed: false };
  const fx = makeLayer({ loadTexture: async () => texture });
  await fx.layer._draw({});
  const entry = fx.layer.spriteEntries.get(GROUND_A);
  fx.canvas.scene = { id: "scene-b" };
  await fx.layer._tearDown({ nextScene: fx.canvas.scene });
  assert.equal(fx.layer.spriteEntries.size, 0);
  assert.equal(fx.layer.sceneId, null);
  assert.equal(entry.container.destroyed, true);
  assert.deepEqual(entry.container.destroyOptions, { children: true, texture: false, baseTexture: false });
  assert.equal(texture.destroyed, false);
});

test("G2 corrupt public read fails closed and clears stale sprites", async () => {
  const fx = makeLayer();
  await fx.layer._draw({});
  fx.layer.publicReader = { getPublicGroundForScene() { throw new Error("corrupt"); } };
  await fx.layer.sync();
  assert.equal(fx.layer.spriteEntries.size, 0);
  assert.ok(fx.calls.warnings.length >= 1);
});

test("G2 updateScene hook ignores unrelated changes and syncs Ground flag once", async () => {
  const callbacks = new Map();
  const hooks = { on(name, callback) { callbacks.set(name, callback); return 1; } };
  let syncs = 0;
  const canvas = { ready: true, scene: { id: "scene-a" }, ground: { async sync() { syncs++; } } };
  registerGroundCanvasHooks({ hooks, getCanvas: () => canvas, log: { warn() {} } });
  assert.equal(callbacks.size, 1);
  assert.equal(callbacks.has("updateScene"), true);
  callbacks.get("updateScene")({ id: "scene-a" }, { name: "Unrelated" });
  await Promise.resolve();
  assert.equal(syncs, 0);
  callbacks.get("updateScene")({ id: "scene-b" }, { flags: { mtrol: { groundPublicProjections: {} } } });
  await Promise.resolve();
  assert.equal(syncs, 0);
  callbacks.get("updateScene")({ id: "scene-a" }, { flags: { mtrol: { groundPublicProjections: {} } } });
  await Promise.resolve();
  assert.equal(syncs, 1);
  assert.equal(isGroundPublicProjectionUpdate({ flags: { mtrol: { groundPublicProjections: {} } } }), true);
  assert.equal(isGroundPublicProjectionUpdate({ flags: { mtrol: { other: {} } } }), false);
});

test("G2 registration is idempotent and collision does not overwrite", () => {
  const config = { Canvas: { layers: {} } };
  const first = registerGroundCanvasLayer({
    config, CanvasLayerClass: FakeCanvasLayer, pixi: fakePixi,
    createPublicReader: () => ({ getPublicGroundForScene: () => [] }),
    loadTexture: async () => null, getCanvas: () => null, getIsGM: () => false,
    log: { error() {} }
  });
  assert.equal(first.status, "REGISTERED");
  assert.equal(config.Canvas.layers.ground.group, "primary");
  assert.equal(config.Canvas.layers.ground.layerClass.mtrolGroundCanvasLayer, true);
  const second = registerGroundCanvasLayer({ config, log: { error() {} } });
  assert.equal(second.status, "ALREADY_REGISTERED");
  const incompatible = class Incompatible {};
  const collisionConfig = { Canvas: { layers: { ground: { layerClass: incompatible, group: "interface" } } } };
  const collision = registerGroundCanvasLayer({ collisionConfig, config: collisionConfig, log: { error() {} } });
  assert.equal(collision.status, "COLLISION");
  assert.strictEqual(collisionConfig.Canvas.layers.ground.layerClass, incompatible);
});

test("G2 500-record diff is stable and unchanged models are not recreated", () => {
  const current = new Map();
  for (let index = 0; index < 500; index++) {
    const groundId = `ground:world-one:${String(index).padStart(24, "A")}`;
    const model = buildGroundRenderModel(projection({ groundId, position: { x: index, y: index } }), {
      sceneId: "scene-a", isGM: false, gridSize: 100
    });
    current.set(groundId, model);
  }
  const desired = new Map(Array.from(current, ([id, model]) => [id, structuredClone(model)]));
  const diff = diffGroundRenderModels(current, desired);
  assert.equal(diff.unchanged.length, 500);
  assert.equal(diff.added.length + diff.changed.length + diff.removed.length, 0);
});

test("G2 structural safety barrier excludes mutation and optional integration dependencies", async () => {
  const source = await readFile(new URL("../scripts/ground/ground-canvas-renderer.js", import.meta.url), "utf8");
  for (const forbidden of [
    "ground-lifecycle-service", "ground-reconciliation-service", "authority-service", "command-registry",
    "receipt-store", "ground-receipt-scope", "shared-reservation-ledger", "/trade/", "item-transfer-data",
    "item-piles", "sequencer", "jb2a", "TokenMagic", "TileDocument", "TokenDocument", "DrawingDocument",
    ".updatePublic(", ".updateAuthority(", ".replacePublicProjection(", ".createEmbeddedDocuments(",
    ".deleteEmbeddedDocuments(", "Actor.update", "Item.update"
  ]) assert.equal(source.includes(forbidden), false, `forbidden renderer dependency/call: ${forbidden}`);
});

test("G2 approved constants remain exact", () => {
  assert.equal(GROUND_SIZE_FACTOR, 0.4);
  assert.equal(GROUND_SORT_LAYER, 650);
  assert.equal(GROUND_FALLBACK_IMG, "icons/svg/item-bag.svg");
});
