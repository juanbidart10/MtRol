import {
  GROUND_VISIBILITY,
  validateGroundPublicProjection
} from "./ground-schema.js";
import { createLevel1GroundPublicReader } from "./ground-repository.js";
import { logger } from "../utils/logger.js";

export const GROUND_SIZE_FACTOR = 0.4;
export const GROUND_SORT_LAYER = 650;
export const GROUND_ADMIN_ALPHA = 0.35;
export const GROUND_FALLBACK_IMG = "icons/svg/item-bag.svg";

const registeredHookTargets = new WeakSet();

function modelFingerprint(model) {
  return JSON.stringify([
    model.sceneId,
    model.x,
    model.y,
    model.img,
    model.targetSize,
    model.alpha,
    model.administrative,
    model.visibility,
    model.appearanceMode
  ]);
}

function entryModel(value) {
  return value?.model ?? value;
}

export function shouldRenderGround(visibility, isGM) {
  return visibility !== GROUND_VISIBILITY.INVISIBLE || isGM === true;
}

export function buildGroundRenderModel(projection, { sceneId, isGM = false, gridSize } = {}) {
  const value = validateGroundPublicProjection(projection);
  if (value.sceneId !== sceneId || !shouldRenderGround(value.visibility, isGM)) return null;
  const size = Number(gridSize);
  if (!Number.isFinite(size) || size <= 0) return null;
  const administrative = value.visibility === GROUND_VISIBILITY.INVISIBLE && isGM === true;
  const model = {
    groundId: value.groundId,
    sceneId: value.sceneId,
    x: value.position.x,
    y: value.position.y,
    anchor: 0.5,
    targetSize: size * GROUND_SIZE_FACTOR,
    visibility: value.visibility,
    appearanceMode: value.appearance.mode,
    img: value.appearance.img,
    administrative,
    alpha: administrative ? GROUND_ADMIN_ALPHA : 1
  };
  model.fingerprint = modelFingerprint(model);
  return model;
}

export function computeGroundSpriteScale(texture, targetSize) {
  const width = Number(texture?.width);
  const height = Number(texture?.height);
  const size = Number(targetSize);
  if (![width, height, size].every(Number.isFinite) || width <= 0 || height <= 0 || size <= 0) return null;
  return size / Math.max(width, height);
}

export function diffGroundRenderModels(current, desired) {
  const added = [];
  const removed = [];
  const changed = [];
  const unchanged = [];
  for (const groundId of current.keys()) {
    if (!desired.has(groundId)) removed.push(groundId);
  }
  for (const [groundId, desiredValue] of desired) {
    if (!current.has(groundId)) {
      added.push(groundId);
      continue;
    }
    const before = entryModel(current.get(groundId));
    const after = entryModel(desiredValue);
    if (before?.fingerprint === after?.fingerprint) unchanged.push(groundId);
    else changed.push(groundId);
  }
  return { added, removed, changed, unchanged };
}

function drawAdministrativeMarker(pixi, targetSize) {
  const marker = new pixi.Graphics();
  const radius = Math.max(3, targetSize * 0.12);
  marker.lineStyle({ width: Math.max(1, targetSize * 0.035), color: 0xFFD166, alpha: 0.95 });
  marker.beginFill(0x2B1D00, 0.7).drawCircle(targetSize * 0.32, -targetSize * 0.32, radius).endFill();
  marker.moveTo(targetSize * 0.27, -targetSize * 0.32)
    .lineTo(targetSize * 0.37, -targetSize * 0.32);
  marker.eventMode = "none";
  return marker;
}

export function createGroundCanvasLayerClass({
  CanvasLayerClass,
  pixi,
  createPublicReader = createLevel1GroundPublicReader,
  loadTexture = src => globalThis.foundry?.canvas?.loadTexture?.(src),
  getCanvas = () => globalThis.canvas ?? null,
  getIsGM = () => globalThis.game?.user?.isGM === true,
  log = logger
} = {}) {
  if (typeof CanvasLayerClass !== "function") throw new TypeError("Ground Canvas requiere CanvasLayer v14.");
  if (!pixi?.Container || !pixi?.Sprite || !pixi?.Graphics) throw new TypeError("Ground Canvas requiere PIXI v7.");
  if (typeof createPublicReader !== "function") throw new TypeError("Ground Canvas requiere public reader.");
  if (typeof loadTexture !== "function") throw new TypeError("Ground Canvas requiere texture loader.");

  class GroundCanvasLayer extends CanvasLayerClass {
    static mtrolGroundCanvasLayer = true;

    static get layerOptions() {
      return { ...super.layerOptions, name: "ground", zIndex: 0 };
    }

    constructor(...args) {
      super(...args);
      this.eventMode = "none";
      this.interactiveChildren = false;
      this.sortLayer = GROUND_SORT_LAYER;
      this.spriteEntries = new Map();
      this.desiredModels = new Map();
      this.generation = 0;
      this.sceneId = null;
      this.publicReader = createPublicReader();
    }

    async _draw(options) {
      await super._draw(options);
      this.eventMode = "none";
      this.interactiveChildren = false;
      this.sortLayer = GROUND_SORT_LAYER;
      await this.sync();
    }

    async sync() {
      const canvas = getCanvas();
      const sceneId = canvas?.scene?.id ?? null;
      const generation = ++this.generation;
      this.sceneId = sceneId;
      if (!sceneId) {
        this.#clearSprites();
        return { added: [], removed: [], changed: [], unchanged: [] };
      }

      let projections;
      try {
        projections = this.publicReader.getPublicGroundForScene(sceneId);
      } catch (error) {
        if (generation === this.generation && sceneId === this.sceneId) this.#clearSprites();
        log.warn("GROUND_CANVAS", "public Ground projection read failed", {
          command: "ground.canvas.sync",
          sceneId,
          status: "failed-closed",
          reasonCode: "GROUND_PUBLIC_READ_FAILED",
          error
        });
        return { added: [], removed: [], changed: [], unchanged: [] };
      }

      const desired = new Map();
      try {
        const isGM = getIsGM();
        const gridSize = canvas?.dimensions?.size ?? canvas?.grid?.size;
        for (const projection of projections) {
          const model = buildGroundRenderModel(projection, { sceneId, isGM, gridSize });
          if (model) desired.set(model.groundId, model);
        }
      } catch (error) {
        if (generation === this.generation && sceneId === this.sceneId) this.#clearSprites();
        log.warn("GROUND_CANVAS", "public Ground projection is corrupt", {
          command: "ground.canvas.derive",
          sceneId,
          status: "failed-closed",
          reasonCode: "GROUND_PUBLIC_PROJECTION_CORRUPT",
          error
        });
        return { added: [], removed: [], changed: [], unchanged: [] };
      }

      this.desiredModels = desired;
      const diff = diffGroundRenderModels(this.spriteEntries, desired);
      for (const groundId of diff.removed) this.#removeEntry(groundId);

      const toCreate = [...diff.added];
      for (const groundId of diff.changed) {
        const entry = this.spriteEntries.get(groundId);
        const model = desired.get(groundId);
        if (entry.model.img !== model.img || entry.model.administrative !== model.administrative) {
          this.#removeEntry(groundId);
          toCreate.push(groundId);
        } else this.#applyModel(entry, model);
      }

      await Promise.allSettled(toCreate.map(groundId =>
        this.#createEntry(desired.get(groundId), { generation, sceneId })
      ));
      return diff;
    }

    async _tearDown(options) {
      this.generation++;
      this.sceneId = null;
      this.desiredModels.clear();
      this.#clearSprites();
      await super._tearDown(options);
    }

    async #loadGroundTexture(model) {
      let texture = null;
      try {
        texture = await loadTexture(model.img);
      } catch (error) {
        log.warn("GROUND_CANVAS", "Ground texture load failed", {
          command: "ground.canvas.texture",
          groundId: model.groundId,
          file: model.img,
          status: "fallback",
          reasonCode: "GROUND_TEXTURE_LOAD_FAILED",
          error
        });
      }
      if (texture?.valid !== false && computeGroundSpriteScale(texture, model.targetSize) !== null) return texture;
      log.warn("GROUND_CANVAS", "Ground texture unavailable; using fallback", {
        command: "ground.canvas.texture",
        groundId: model.groundId,
        file: model.img,
        status: "fallback",
        reasonCode: "GROUND_TEXTURE_FALLBACK"
      });
      if (model.img === GROUND_FALLBACK_IMG) return null;
      try {
        texture = await loadTexture(GROUND_FALLBACK_IMG);
      } catch (error) {
        log.warn("GROUND_CANVAS", "Ground fallback texture load failed", {
          command: "ground.canvas.texture",
          groundId: model.groundId,
          file: GROUND_FALLBACK_IMG,
          status: "isolated",
          reasonCode: "GROUND_FALLBACK_LOAD_FAILED",
          error
        });
        return null;
      }
      if (texture?.valid !== false && computeGroundSpriteScale(texture, model.targetSize) !== null) return texture;
      log.warn("GROUND_CANVAS", "Ground fallback texture unavailable", {
        command: "ground.canvas.texture",
        groundId: model.groundId,
        file: GROUND_FALLBACK_IMG,
        status: "isolated",
        reasonCode: "GROUND_FALLBACK_UNAVAILABLE"
      });
      return null;
    }

    async #createEntry(model, { generation, sceneId }) {
      if (!model) return;
      const texture = await this.#loadGroundTexture(model);
      const stillDesired = this.desiredModels.get(model.groundId);
      if (!texture || generation !== this.generation || sceneId !== this.sceneId ||
          stillDesired?.fingerprint !== model.fingerprint) return;
      const scale = computeGroundSpriteScale(texture, model.targetSize);
      if (scale === null) return;
      const container = new pixi.Container();
      container.eventMode = "none";
      container.interactiveChildren = false;
      const sprite = container.addChild(new pixi.Sprite(texture));
      sprite.anchor.set(model.anchor);
      sprite.scale.set(scale);
      sprite.eventMode = "none";
      const marker = model.administrative
        ? container.addChild(drawAdministrativeMarker(pixi, model.targetSize))
        : null;
      const entry = { container, sprite, marker, model };
      this.#applyModel(entry, model);
      this.addChild(container);
      this.spriteEntries.set(model.groundId, entry);
    }

    #applyModel(entry, model) {
      entry.container.position.set(model.x, model.y);
      entry.sprite.alpha = model.alpha;
      const scale = computeGroundSpriteScale(entry.sprite.texture, model.targetSize);
      if (scale !== null) entry.sprite.scale.set(scale);
      if (entry.marker) entry.marker.visible = model.administrative;
      entry.model = model;
    }

    #removeEntry(groundId) {
      const entry = this.spriteEntries.get(groundId);
      if (!entry) return;
      if (entry.container.parent === this) this.removeChild(entry.container);
      entry.container.destroy({ children: true, texture: false, baseTexture: false });
      this.spriteEntries.delete(groundId);
    }

    #clearSprites() {
      for (const groundId of Array.from(this.spriteEntries.keys())) this.#removeEntry(groundId);
      this.desiredModels.clear();
    }
  }

  return GroundCanvasLayer;
}

export function registerGroundCanvasLayer({
  config = globalThis.CONFIG,
  CanvasLayerClass = globalThis.foundry?.canvas?.layers?.CanvasLayer,
  pixi = globalThis.PIXI,
  createPublicReader = createLevel1GroundPublicReader,
  loadTexture = src => globalThis.foundry?.canvas?.loadTexture?.(src),
  getCanvas = () => globalThis.canvas ?? null,
  getIsGM = () => globalThis.game?.user?.isGM === true,
  log = logger
} = {}) {
  const layers = config?.Canvas?.layers;
  if (!layers) throw new TypeError("CONFIG.Canvas.layers no está disponible.");
  const existing = layers.ground;
  if (existing?.layerClass?.mtrolGroundCanvasLayer === true) {
    return { status: "ALREADY_REGISTERED", layerClass: existing.layerClass };
  }
  if (existing) {
    log.error("GROUND_CANVAS", "Canvas layer key collision", {
      command: "ground.canvas.register",
      status: "rejected",
      reasonCode: "GROUND_CANVAS_LAYER_COLLISION"
    });
    return { status: "COLLISION", layerClass: existing.layerClass ?? null };
  }
  const layerClass = createGroundCanvasLayerClass({
    CanvasLayerClass, pixi, createPublicReader, loadTexture, getCanvas, getIsGM, log
  });
  layers.ground = { layerClass, group: "primary" };
  return { status: "REGISTERED", layerClass };
}

export function isGroundPublicProjectionUpdate(changes) {
  if (Object.hasOwn(changes ?? {}, "flags.mtrol.groundPublicProjections")) return true;
  return Object.hasOwn(changes?.flags?.mtrol ?? {}, "groundPublicProjections");
}

export function registerGroundCanvasHooks({
  hooks = globalThis.Hooks,
  getCanvas = () => globalThis.canvas ?? null,
  log = logger
} = {}) {
  if (!hooks || typeof hooks.on !== "function") throw new TypeError("Ground Canvas requiere Hooks.");
  if (registeredHookTargets.has(hooks)) return false;
  registeredHookTargets.add(hooks);
  hooks.on("updateScene", (scene, changes) => {
    const canvas = getCanvas();
    if (!canvas?.ready || canvas.scene?.id !== scene?.id || !isGroundPublicProjectionUpdate(changes)) return;
    const layer = canvas.ground ?? canvas.primary?.ground;
    if (typeof layer?.sync !== "function") return;
    void layer.sync().catch(error => log.warn("GROUND_CANVAS", "live Ground sync failed", {
      command: "ground.canvas.live-sync",
      sceneId: scene.id,
      status: "isolated",
      reasonCode: "GROUND_CANVAS_LIVE_SYNC_FAILED",
      error
    }));
  });
  return true;
}
