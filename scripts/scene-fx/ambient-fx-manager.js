// =========================
// MTROL - AMBIENT FX MANAGER
// =========================
// Fuente de verdad: scene.flags.mtrol.ambientFx
// Sequencer/JB2A solo renderizan la escena activa.
// =========================

import {
  MtrolAmbientFxApp
} from "./ambient-fx-app.js";

const MTROL_AMBIENT_FX_FLAG = "ambientFx";
const MTROL_AMBIENT_FX_PREFIX = "mtrol-ambient-";
const MTROL_AMBIENT_PREVIEW_PREFIX = "mtrol-preview-";
const MTROL_AMBIENT_DURATION = 20 * 24 * 60 * 60 * 1000;
const MTROL_AMBIENT_ALLOWED_PATHS = /^(modules|systems|world)\//i;
const MTROL_AMBIENT_UI_BUTTON = "mtrolAmbientFx";

let ambientFxApp = null;
let ambientFxUiButtonRegistered = false;
let ambientFxUiWarningShown = false;

function getFlagScope() {
  return game.system?.id ?? "mtrol";
}

function getCurrentScene() {
  return canvas?.scene ?? null;
}

function getScene(sceneId = getCurrentScene()?.id) {
  return sceneId ? game.scenes?.get(sceneId) ?? null : getCurrentScene();
}

function normalizeId(value, fallback = "fx") {
  const text = String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return text || fallback;
}

function getDefaultCanvasPosition() {
  return {
    x: canvas?.stage?.pivot?.x || 0,
    y: canvas?.stage?.pivot?.y || 0
  };
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toBoolean(value) {
  return value === true || value === "true" || value === "on" || value === "1";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getSequencerEffectManager() {
  if (!game.modules.get("sequencer")?.active) return null;
  return globalThis.Sequencer?.EffectManager ?? null;
}

function normalizeAmbientFilePath(path) {
  return String(path ?? "").trim().replace(/^\/+/, "");
}

function warnMissingFile(path) {
  const message = `MTROL Ambient FX | Archivo no encontrado: ${path}`;
  ui.notifications.warn(message);
  console.warn(message);
}

function validateAmbientFilePath(path) {
  const file = normalizeAmbientFilePath(path);

  if (!file) {
    ui.notifications.warn("MTROL Ambient FX | El file path no puede estar vacio.");
    return null;
  }

  if (!MTROL_AMBIENT_ALLOWED_PATHS.test(file)) {
    ui.notifications.warn("MTROL Ambient FX | El file path debe empezar con modules/, systems/ o world/.");
    return null;
  }

  if (!/\.webm(?:[?#].*)?$/i.test(file)) {
    ui.notifications.warn("MTROL Ambient FX V1 solo admite efectos visuales .webm.");
    return null;
  }

  return file;
}

export async function checkAmbientFxFile(path) {
  const file = validateAmbientFilePath(path);
  if (!file) return null;

  try {
    const response = await fetch(file, { method: "HEAD", cache: "no-store" });
    if (response.ok) return file;

    warnMissingFile(file);
    return null;
  } catch (error) {
    console.warn("MTROL Ambient FX | Error al validar archivo", error);
    ui.notifications.warn(`MTROL Ambient FX | Archivo no encontrado: ${file}`);
    return null;
  }
}

function getSequencerEffects() {
  const manager = getSequencerEffectManager();
  if (!manager) return [];

  if (manager.effects instanceof Map) return Array.from(manager.effects.values());
  if (Array.isArray(manager.effects)) return manager.effects;
  if (typeof manager.getEffects === "function") return manager.getEffects() ?? [];

  return [];
}

function getEffectName(effect) {
  if (typeof effect?.name === "string") return effect.name;
  if (typeof effect?.data?.name === "string") return effect.data.name;
  if (typeof effect?.source?.name === "string") return effect.source.name;
  if (typeof effect?.document?.name === "string") return effect.document.name;
  return "";
}

function getAmbientFxName(sceneId, id) {
  return `${MTROL_AMBIENT_FX_PREFIX}${normalizeId(sceneId, "scene")}-${normalizeId(id, "fx")}`;
}

function isMtrolAmbientName(name) {
  return String(name ?? "").startsWith(MTROL_AMBIENT_FX_PREFIX);
}

function normalizeAmbientFxData(data = {}, scene = getCurrentScene()) {
  const sceneId =
    scene?.id ?? getCurrentScene()?.id;
  const position =
    getDefaultCanvasPosition();

  if (!sceneId) {
    throw new Error("MTROL Ambient FX necesita una escena activa.");
  }

  const id =
    normalizeId(data.id ?? foundry.utils.randomID(), "fx");

  return {
    id,
    sceneId,
    name: getAmbientFxName(sceneId, id),
    label: String(data.label ?? data.name ?? "Ambient FX").trim() || "Ambient FX",
    file: normalizeAmbientFilePath(data.file),
    x: toNumber(data.x, position.x),
    y: toNumber(data.y, position.y),
    scale: toNumber(data.scale, 1),
    opacity: clamp(toNumber(data.opacity ?? data.alpha, 1), 0, 1),
    rotation: toNumber(data.rotation, 0),
    belowTokens: toBoolean(data.belowTokens),
    aboveLighting: toBoolean(data.aboveLighting),
    createdBy: data.createdBy ?? game.user?.id ?? null,
    createdAt: data.createdAt ?? Date.now()
  };
}

async function readSceneAmbientFx(scene = getCurrentScene()) {
  if (!scene) return [];

  const stored =
    scene.getFlag(getFlagScope(), MTROL_AMBIENT_FX_FLAG) ?? [];

  if (Array.isArray(stored)) return foundry.utils.deepClone(stored);
  if (stored && typeof stored === "object") return foundry.utils.deepClone(Object.values(stored));

  return [];
}

async function writeSceneAmbientFx(scene, effects) {
  if (!scene) return;

  if (effects.length) {
    await scene.setFlag(getFlagScope(), MTROL_AMBIENT_FX_FLAG, effects);
  } else {
    await scene.unsetFlag(getFlagScope(), MTROL_AMBIENT_FX_FLAG);
  }
}

function getActiveAmbientFxNames() {
  return getSequencerEffects()
    .map(getEffectName)
    .filter(isMtrolAmbientName);
}

function hasActiveAmbientFx(name) {
  return getActiveAmbientFxNames().includes(name);
}

async function endByName(name) {
  const manager = getSequencerEffectManager();
  if (typeof manager?.endEffects !== "function") return;
  if (!isMtrolAmbientName(name) && !String(name ?? "").startsWith(MTROL_AMBIENT_PREVIEW_PREFIX)) return;

  await manager.endEffects({ name }, false);
}

function applyOptionalSequencerLayerMethods(effect, data) {
  if (data.belowTokens && typeof effect.belowTokens === "function") {
    effect.belowTokens(true);
  }

  if (data.aboveLighting && typeof effect.aboveLighting === "function") {
    effect.aboveLighting(true);
  }
}

async function playAmbientFxData(data, { persist = true, preview = false } = {}) {
  if (!game.modules.get("sequencer")?.active) {
    ui.notifications.warn("Sequencer no esta activo.");
    console.warn("MTROL Ambient FX | Sequencer no esta activo.");
    return null;
  }

  const file =
    await checkAmbientFxFile(data?.file);

  if (!file) {
    return null;
  }

  const sceneId =
    getCurrentScene()?.id;

  if (!sceneId || data.sceneId !== sceneId) return null;

  const name =
    preview ? `${MTROL_AMBIENT_PREVIEW_PREFIX}${sceneId}-${foundry.utils.randomID()}` : data.name;

  if (!preview && hasActiveAmbientFx(name)) return null;

  try {
    const effectData =
      normalizeAmbientFxData({ ...data, file }, getCurrentScene());

    const sequence =
      new Sequence();

    const effect =
      sequence.effect()
        .file(effectData.file)
        .atLocation({ x: effectData.x, y: effectData.y })
        .scale(effectData.scale)
        .opacity(effectData.opacity)
        .rotate(effectData.rotation)
        .name(name);

    applyOptionalSequencerLayerMethods(effect, effectData);

    if (persist) {
      effect.duration(MTROL_AMBIENT_DURATION);
      effect.persist();
    } else {
      effect.duration(2500);
    }

    await sequence.play();
    return name;
  } catch (error) {
    console.warn("MTROL Ambient FX | Error capturado al reproducir", error);
    ui.notifications.warn("MTROL Ambient FX | No se pudo reproducir el FX.");
    return null;
  }
}

export async function addAmbientFx(data = {}) {
  try {
    const scene =
      getCurrentScene();

    if (!scene) {
      ui.notifications.warn("No hay una escena activa para guardar Ambient FX.");
      return null;
    }

    const effectData =
      normalizeAmbientFxData(data, scene);

    const file =
      await checkAmbientFxFile(effectData.file);

    if (!file) {
      return null;
    }

    effectData.file = file;

    const stored =
      await readSceneAmbientFx(scene);

    const next =
      stored.filter(effect => effect?.id !== effectData.id && effect?.name !== effectData.name);

    next.push(effectData);

    await writeSceneAmbientFx(scene, next);

    await endByName(effectData.name);
    await playAmbientFxData(effectData, { persist: true });

    ui.notifications.info("FX guardado correctamente");

    return effectData;
  } catch (error) {
    console.warn("MTROL Ambient FX | Error capturado al guardar", error);
    ui.notifications.warn("MTROL Ambient FX | No se pudo guardar el FX.");
    return null;
  }
}

export async function removeAmbientFx(id) {
  try {
    const scene =
      getCurrentScene();

    if (!scene || !id) return false;

    const stored =
      await readSceneAmbientFx(scene);

    const target =
      stored.find(effect => effect?.id === id || effect?.name === id);

    if (!target) return false;

    await endByName(target.name);
    await writeSceneAmbientFx(
      scene,
      stored.filter(effect => effect?.id !== target.id)
    );

    ui.notifications.info("FX eliminado");

    return true;
  } catch (error) {
    console.warn("MTROL Ambient FX | Error capturado al eliminar", error);
    ui.notifications.warn("MTROL Ambient FX | No se pudo eliminar el FX.");
    return false;
  }
}

export async function stopAmbientFx(id) {
  const scene =
    getCurrentScene();

  if (!scene || !id) return false;

  const stored =
    await readSceneAmbientFx(scene);

  const target =
    stored.find(effect => effect?.id === id || effect?.name === id);

  if (!target) return false;

  await endByName(target.name);
  return true;
}

export async function listAmbientFx(sceneId = getCurrentScene()?.id) {
  return readSceneAmbientFx(getScene(sceneId));
}

export async function playSceneAmbientFx(sceneId = getCurrentScene()?.id) {
  const scene =
    getScene(sceneId);

  if (!scene || scene.id !== getCurrentScene()?.id) return [];

  const stored =
    await readSceneAmbientFx(scene);

  const played = [];

  for (const effectData of stored) {
    if (effectData?.sceneId !== scene.id) continue;
    if (!effectData?.name || !isMtrolAmbientName(effectData.name)) continue;

    const name =
      await playAmbientFxData(effectData, { persist: true });

    if (name) played.push(name);
  }

  return played;
}

export async function stopActiveAmbientFx() {
  const names =
    Array.from(new Set(getActiveAmbientFxNames()));

  await Promise.allSettled(
    names.map(name => endByName(name))
  );

  return names;
}

export async function refreshSceneAmbientFx() {
  try {
    await stopActiveAmbientFx();
    return playSceneAmbientFx(getCurrentScene()?.id);
  } catch (error) {
    console.warn("MTROL Ambient FX | Error capturado al refrescar", error);
    ui.notifications.warn("MTROL Ambient FX | No se pudo refrescar la escena.");
    return [];
  }
}

export async function previewAmbientFx(data = {}) {
  const scene =
    getCurrentScene();

  if (!scene) return null;

  const effectData =
    normalizeAmbientFxData(data, scene);

  return playAmbientFxData(effectData, {
    persist: false,
    preview: true
  });
}

export function openManager() {
  if (!game.user?.isGM) {
    ui.notifications.warn("Solo el GM puede abrir MTROL Ambient FX.");
    return null;
  }

  ambientFxApp ??= new MtrolAmbientFxApp();
  ambientFxApp.render(true);
  return ambientFxApp;
}

export async function listSceneFx() {
  return listAmbientFx(getCurrentScene()?.id);
}

export async function stopAllMtrolAmbientFx() {
  return stopActiveAmbientFx();
}

export function installMtrolAmbientFxApi() {
  game.mtrol = game.mtrol || {};

  game.mtrol.fx = {
    addAmbientFx,
    removeAmbientFx,
    stopAmbientFx,
    listAmbientFx,
    playSceneAmbientFx,
    stopActiveAmbientFx,
    refreshSceneAmbientFx,
    previewAmbientFx,
    openManager
  };

  game.mtrol.fxDebug = {
    listSceneFx,
    stopAllMtrolAmbientFx,
    refresh: refreshSceneAmbientFx
  };
}

function getAmbientFxToolData() {
  return {
    name: MTROL_AMBIENT_UI_BUTTON,
    title: "MTROL Ambient FX",
    icon: "fas fa-wand-magic-sparkles",
    button: true,
    type: "button",
    visible: game.user.isGM,
    order: 999,
    onClick: () => game.mtrol.fx.openManager()
  };
}

function hasTool(tools) {
  if (!tools) return false;
  if (Array.isArray(tools)) return tools.some(tool => tool?.name === MTROL_AMBIENT_UI_BUTTON);
  if (tools instanceof Map) return tools.has(MTROL_AMBIENT_UI_BUTTON);
  if (typeof tools.has === "function") return tools.has(MTROL_AMBIENT_UI_BUTTON);
  return Boolean(tools[MTROL_AMBIENT_UI_BUTTON]);
}

function getSceneControlContainer(controls) {
  if (controls?.controls && controls.controls !== controls) return controls.controls;
  if (controls?.controlGroups && controls.controlGroups !== controls) return controls.controlGroups;
  return controls;
}

function getControlEntries(controls) {
  const container =
    getSceneControlContainer(controls);

  if (!container) return [];

  if (Array.isArray(container)) {
    return container.map((control, index) => [control?.name ?? String(index), control]);
  }

  if (container instanceof Map || typeof container?.entries === "function") {
    return Array.from(container.entries());
  }

  if (typeof container?.values === "function") {
    return Array.from(container.values()).map((control, index) => [control?.name ?? String(index), control]);
  }

  if (typeof container === "object") {
    return Object.entries(container);
  }

  return [];
}

function addToolToControl(control, tool = getAmbientFxToolData()) {
  if (!control) return false;

  if (!control.tools) control.tools = [];
  if (hasTool(control.tools)) return true;

  if (Array.isArray(control.tools)) {
    control.tools.push(tool);
    return true;
  }

  if (control.tools instanceof Map) {
    control.tools.set(MTROL_AMBIENT_UI_BUTTON, tool);
    return true;
  }

  if (typeof control.tools.set === "function") {
    control.tools.set(MTROL_AMBIENT_UI_BUTTON, tool);
    return true;
  }

  control.tools[MTROL_AMBIENT_UI_BUTTON] = tool;
  return true;
}

function getPreferredSceneControl(controls) {
  const names = ["tiles", "token", "tokens", "lighting", "walls", "drawings", "sounds", "notes"];
  const entries =
    getControlEntries(controls);

  return names
    .map(name => entries.find(([key, control]) => key === name || control?.name === name)?.[1])
    .find(Boolean) ?? entries[0]?.[1] ?? null;
}

function createMtrolControlGroup(tool = getAmbientFxToolData(), arrayTools = true) {
  return {
    name: "mtrol",
    title: "MTROL",
    icon: "fas fa-wand-magic-sparkles",
    visible: true,
    layer: "controls",
    tools: arrayTools ? [tool] : { [MTROL_AMBIENT_UI_BUTTON]: tool },
    activeTool: MTROL_AMBIENT_UI_BUTTON
  };
}

function hasAmbientFxToolInControls(controls) {
  return getControlEntries(controls)
    .some(([, control]) => hasTool(control?.tools));
}

function addMtrolControlGroup(controls, tool) {
  const container =
    getSceneControlContainer(controls);

  if (Array.isArray(container)) {
    container.push(createMtrolControlGroup(tool, true));
    return true;
  }

  if (container instanceof Map || typeof container?.set === "function") {
    container.set("mtrol", createMtrolControlGroup(tool, false));
    return true;
  }

  if (container && typeof container === "object") {
    container.mtrol = createMtrolControlGroup(tool, false);
    return true;
  }

  return false;
}

function addSceneControlButton(controls) {
  console.log("MTROL Ambient FX | controls raw", controls);
  console.log("MTROL Ambient FX | controls constructor", controls?.constructor?.name);

  if (!game.user?.isGM) return;
  if (hasAmbientFxToolInControls(controls)) return;

  const tool =
    getAmbientFxToolData();
  const target =
    getPreferredSceneControl(controls);

  if (addToolToControl(target, tool)) return;

  if (!addMtrolControlGroup(controls, tool)) {
    scheduleAmbientFxUiFallback();
  }
}

function openAmbientFxManagerFromButton(event) {
  event?.preventDefault?.();
  game.mtrol?.fx?.openManager();
}

function addAmbientFxDirectoryButton(app, html) {
  if (!game.user?.isGM) return;

  const root = html?.[0] ?? html;
  if (!root?.querySelector) return;
  if (root.querySelector("[data-action='mtrolAmbientFxDirectory']")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "mtrol-ambient-directory-button";
  button.dataset.action = "mtrolAmbientFxDirectory";
  button.title = "MTROL Ambient FX";
  button.innerHTML = "<i class=\"fas fa-wand-magic-sparkles\"></i><span>MTROL Ambient FX</span>";
  button.addEventListener("click", openAmbientFxManagerFromButton);

  const target =
    root.querySelector(".directory-header") ??
    root.querySelector("header") ??
    root;

  target.append(button);
  ambientFxUiButtonRegistered = true;
}

function hasAmbientFxUiButtonElement() {
  if (typeof document === "undefined" || !document.querySelector) return false;

  return Boolean(document.querySelector([
    "[data-action='mtrolAmbientFxCanvas']",
    "[data-action='mtrolAmbientFxDirectory']",
    "[data-tool='mtrolAmbientFx']",
    "[data-control='mtrolAmbientFx']",
    "[title='MTROL Ambient FX']",
    "[aria-label='MTROL Ambient FX']"
  ].join(",")));
}

function addAmbientFxCanvasButton() {
  if (!game.user?.isGM) return;
  if (typeof document === "undefined" || !document.body) return;
  if (hasAmbientFxUiButtonElement()) {
    ambientFxUiButtonRegistered = true;
    return;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "mtrol-ambient-canvas-button";
  button.dataset.action = "mtrolAmbientFxCanvas";
  button.title = "MTROL Ambient FX";
  button.innerHTML = "<i class=\"fas fa-wand-magic-sparkles\"></i><span>MTROL Ambient FX</span>";
  button.addEventListener("click", openAmbientFxManagerFromButton);

  document.body.append(button);
  ambientFxUiButtonRegistered = true;
}

function warnMissingAmbientFxUiButton() {
  if (hasAmbientFxUiButtonElement()) {
    ambientFxUiButtonRegistered = true;
    return;
  }

  if (!game.user?.isGM || ambientFxUiButtonRegistered || ambientFxUiWarningShown) return;

  ambientFxUiWarningShown = true;
  console.warn("MTROL Ambient FX | No se pudo registrar botón UI, usar game.mtrol.fx.openManager()");
}

function scheduleAmbientFxUiFallback() {
  if (!game.user?.isGM) return;
  if (typeof window === "undefined") return;

  window.setTimeout(() => {
    addAmbientFxCanvasButton();
    warnMissingAmbientFxUiButton();
  }, 500);
}

export function registerMtrolAmbientFxHooks() {
  Hooks.on("getSceneControlButtons", addSceneControlButton);
  Hooks.on("renderSceneDirectory", addAmbientFxDirectoryButton);
  Hooks.on("ready", scheduleAmbientFxUiFallback);
  Hooks.on("canvasReady", scheduleAmbientFxUiFallback);

  Hooks.on("canvasTearDown", () => stopActiveAmbientFx().catch(error => {
    console.warn("MTROL Ambient FX | Error capturado al detener por cambio de escena", error);
  }));
  Hooks.on("canvasInit", () => stopActiveAmbientFx().catch(error => {
    console.warn("MTROL Ambient FX | Error capturado al detener por inicializacion de canvas", error);
  }));
  Hooks.on("canvasReady", () => playSceneAmbientFx(getCurrentScene()?.id).catch(error => {
    console.warn("MTROL Ambient FX | Error capturado al reproducir escena", error);
  }));
}
