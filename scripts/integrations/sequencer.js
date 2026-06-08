// =========================
// MTROL - SEQUENCER ENGINE
// =========================
// Motor centralizado de FX para competencias/habilidades.
// Compatibilidad legacy: solo FX persistentes de competencias con prefijo mtrol-fx-.
// MTROL Ambient FX V1 vive en scene-fx/ambient-fx-manager.js con prefijo mtrol-ambient-.
// Los FX persistentes de competencias se guardan como datos de Scene.
// Sequencer solo renderiza el estado local de la escena activa.
// =========================

const MTROL_FX_PREFIX = "mtrol-fx-";
const MTROL_FX_FLAG = "persistentFx";
const MTROL_LEGACY_FX_FLAG = "persistentSequencerFx";
const MTROL_SCENE_FX_DURATION = 20 * 24 * 60 * 60 * 1000;

let suppressFlagRemoval = false;
let effectManagerPatched = false;
const activeMtrolFxNames = new Set();

function getFlagScope() {
  return game.system?.id ?? "mtrol";
}

function normalizeId(value, fallback = "fx") {
  const text = String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return text || fallback;
}

function getCurrentSceneId() {
  return canvas?.scene?.id ?? null;
}

function getTokenId(token) {
  return token?.document?.id ?? token?.id ?? null;
}

function tokenBelongsToScene(token, sceneId = getCurrentSceneId()) {
  if (!token || !sceneId) return false;

  const tokenSceneId =
    token.document?.parent?.id ??
    token.scene?.id ??
    token.parent?.id ??
    null;

  return tokenSceneId === sceneId;
}

function isMtrolFxName(name) {
  return String(name ?? "").startsWith(MTROL_FX_PREFIX);
}

function isMtrolPersistentFxName(name) {
  return String(name ?? "").startsWith(MTROL_FX_PREFIX);
}

function rememberActiveMtrolFxName(name) {
  if (isMtrolPersistentFxName(name)) {
    activeMtrolFxNames.add(name);
  }
}

function forgetActiveMtrolFxName(name) {
  if (isMtrolPersistentFxName(name)) {
    activeMtrolFxNames.delete(name);
  }
}

function isPersistentFxConfig(fx = {}) {
  return fx.persistent === true ||
    fx.persistente === true ||
    fx.persistir === true;
}

export function getMtrolPersistentFxName({
  sceneId,
  tokenId = null,
  actorId = null,
  itemId = null,
  tipo = "fx"
} = {}) {
  return [
    "mtrol",
    "fx",
    normalizeId(sceneId, "scene"),
    normalizeId(tokenId ?? actorId, "actor"),
    normalizeId(itemId ?? tipo, "item"),
    normalizeId(tipo, "fx")
  ].join("-");
}

export function isMtrolFxFromCurrentScene(name) {
  const sceneId = getCurrentSceneId();
  if (!sceneId || !isMtrolFxName(name)) return false;

  return String(name).includes(`-${normalizeId(sceneId, "scene")}-`);
}

function getEffectMetadata(effect) {
  return effect?.data?.metadata ??
    effect?.data?.flags?.mtrol ??
    effect?.source?.metadata ??
    effect?.source?.flags?.mtrol ??
    effect?.document?.flags?.mtrol ??
    {};
}

function getEffectSceneId(effect) {
  return effect?.data?.sceneId ??
    effect?.source?.sceneId ??
    effect?.document?.sceneId ??
    getEffectMetadata(effect)?.sceneId ??
    null;
}

function isMtrolOwnedEffect(effect) {
  const name = getEffectName(effect);
  if (isMtrolFxName(name)) return true;

  const metadata = getEffectMetadata(effect);
  return metadata?.system === "mtrol";
}

function mtrolFxBelongsToScene(effect, sceneId) {
  if (!sceneId) return false;

  const effectSceneId =
    getEffectSceneId(effect);

  if (effectSceneId) return effectSceneId === sceneId;

  const name =
    typeof effect === "string" ? effect : getEffectName(effect);

  return isMtrolFxName(name) &&
    String(name).includes(`-${normalizeId(sceneId, "scene")}-`);
}

function getEffectId(effect) {
  return effect?.id ??
    effect?.data?._id ??
    effect?.data?.id ??
    effect?.source?._id ??
    effect?.source?.id ??
    effect?.document?.id ??
    null;
}

function getSequencerEffectManager() {
  if (!game.modules.get("sequencer")?.active) return null;
  return globalThis.Sequencer?.EffectManager ?? null;
}

function getSequencerEffects() {
  const manager = getSequencerEffectManager();
  if (!manager) return [];

  if (manager.effects instanceof Map) {
    return Array.from(manager.effects.values());
  }

  if (Array.isArray(manager.effects)) {
    return manager.effects;
  }

  if (typeof manager.getEffects === "function") {
    return manager.getEffects() ?? [];
  }

  return [];
}

function getEffectName(effect) {
  if (typeof effect?.name === "string") return effect.name;
  if (typeof effect?.data?.name === "string") return effect.data.name;
  if (typeof effect?.source?.name === "string") return effect.source.name;
  if (typeof effect?.document?.name === "string") return effect.document.name;
  return "";
}

function getNamesFromEndArgs(args) {
  const names = [];

  for (const arg of args) {
    if (typeof arg === "string") names.push(arg);
    if (Array.isArray(arg)) names.push(...arg.filter(value => typeof value === "string"));
    if (typeof arg?.name === "string") names.push(arg.name);
    if (Array.isArray(arg?.name)) names.push(...arg.name.filter(value => typeof value === "string"));
  }

  return names;
}

async function endSequencerEffectByName(name) {
  const manager = getSequencerEffectManager();
  if (!manager || !name) return;

  if (typeof manager.endEffects === "function") {
    await manager.endEffects({ name }, false);
  }
}

async function stopRenderedSequencerEffects(effects) {
  const manager = getSequencerEffectManager();
  if (typeof manager?.endEffects !== "function") return;

  const validEffects =
    effects.filter(effect => effect && (typeof effect === "string" || typeof effect === "object"));

  if (!validEffects.length) return;

  const ids =
    validEffects
      .map(getEffectId)
      .filter(id => typeof id === "string" && id);

  if (ids.length && typeof manager._endManyEffects === "function") {
    await manager._endManyEffects(ids);
    return;
  }

  const names =
    Array.from(new Set(
      validEffects
        .map(effect => typeof effect === "string" ? effect : getEffectName(effect))
        .filter(name => typeof name === "string" && name)
    ));

  if (names.length) {
    await Promise.allSettled(
      names.map(name => manager.endEffects({ name }, false))
    );
    return;
  }

  await manager.endEffects({ effects: validEffects }, false);
}

async function removePersistentFxFlagByName(name) {
  if (!isMtrolFxName(name)) return;

  const scope = getFlagScope();

  for (const scene of game.scenes ?? []) {
    const stored =
      foundry.utils.duplicate(scene.getFlag(scope, MTROL_FX_FLAG) ?? []);

    const next =
      stored.filter(entry => entry?.name !== name);

    if (next.length === stored.length) continue;

    if (next.length) {
      await scene.setFlag(scope, MTROL_FX_FLAG, next);
    } else {
      await scene.unsetFlag(scope, MTROL_FX_FLAG);
    }
  }
}

function patchSequencerEffectManager() {
  const manager = getSequencerEffectManager();
  if (!manager || effectManagerPatched) return;

  for (const methodName of ["endEffects", "endEffect"]) {
    if (typeof manager[methodName] !== "function") continue;

    const original = manager[methodName].bind(manager);

    manager[methodName] = async (...args) => {
      const names = getNamesFromEndArgs(args)
        .filter(isMtrolFxName);

      const result = await original(...args);

      if (!suppressFlagRemoval) {
        for (const name of names) {
          await removePersistentFxFlagByName(name);
          forgetActiveMtrolFxName(name);
        }
      }

      return result;
    };
  }

  effectManagerPatched = true;
}

async function migrateLegacySceneFxFlags(scene) {
  if (!scene) return [];

  const scope = getFlagScope();
  const current =
    scene.getFlag(scope, MTROL_FX_FLAG);

  if (Array.isArray(current)) return current;

  if (current && typeof current === "object") {
    const migrated = Object.values(current);
    await scene.setFlag(scope, MTROL_FX_FLAG, migrated);
    return migrated;
  }

  const legacy =
    scene.getFlag(scope, MTROL_LEGACY_FX_FLAG);

  if (!legacy) return [];

  const migrated =
    Array.isArray(legacy)
      ? legacy
      : Object.values(legacy);

  await scene.setFlag(scope, MTROL_FX_FLAG, migrated);
  await scene.unsetFlag(scope, MTROL_LEGACY_FX_FLAG);

  return migrated;
}

async function rememberPersistentFx(scene, data) {
  if (!scene || !data?.name) return;

  const stored =
    await migrateLegacySceneFxFlags(scene);

  const next =
    stored.filter(entry => entry?.name !== data.name);

  next.push(data);

  await scene.setFlag(
    getFlagScope(),
    MTROL_FX_FLAG,
    next
  );
}

function hasActiveEffect(name) {
  return getSequencerEffects()
    .some(effect => getEffectName(effect) === name);
}

async function endAllActiveMtrolSequencerFx() {
  const effects = getSequencerEffects();
  const names = new Set(activeMtrolFxNames);
  const effectsToEnd = [];

  for (const effect of effects) {
    const name = getEffectName(effect);
    if (isMtrolFxName(name)) {
      names.add(name);
      effectsToEnd.push(effect);
    }
  }

  suppressFlagRemoval = true;

  try {
    await stopRenderedSequencerEffects(effectsToEnd);

    for (const name of names) {
      await endSequencerEffectByName(name);
      forgetActiveMtrolFxName(name);
    }
  } finally {
    suppressFlagRemoval = false;
  }
}

export async function syncMtrolCompetenciaPersistentFX(activeSceneId = getCurrentSceneId()) {
  if (!activeSceneId) return;

  const effects = getSequencerEffects();
  const names = new Set(activeMtrolFxNames);
  const effectsToEnd = [];

  for (const effect of effects) {
    if (!isMtrolOwnedEffect(effect)) continue;
    if (mtrolFxBelongsToScene(effect, activeSceneId)) continue;

    const name = getEffectName(effect);
    if (isMtrolFxName(name)) names.add(name);

    effectsToEnd.push(effect);
  }

  for (const name of activeMtrolFxNames) {
    if (String(name).includes(`-${normalizeId(activeSceneId, "scene")}-`)) continue;
    names.add(name);
  }

  suppressFlagRemoval = true;

  try {
    await stopRenderedSequencerEffects(effectsToEnd);

    for (const name of names) {
      if (String(name).includes(`-${normalizeId(activeSceneId, "scene")}-`)) continue;

      await endSequencerEffectByName(name);
      forgetActiveMtrolFxName(name);
    }
  } finally {
    suppressFlagRemoval = false;
  }
}

export async function teardownMtrolSequencerFX() {
  try {
    if (!game.modules.get("sequencer")?.active) return;

    patchSequencerEffectManager();
    await endAllActiveMtrolSequencerFx();
  } catch (error) {
    console.error("MtRol | Error finalizando FX locales al salir de escena:", error);
  }
}

async function playSceneFx(data) {
  if (!data?.file || !data?.name) return;

  const sceneId = getCurrentSceneId();
  if (!sceneId || data.sceneId !== sceneId) return;

  const token =
    canvas.tokens?.get(data.tokenId);

  if (!tokenBelongsToScene(token, sceneId)) return;
  if (hasActiveEffect(data.name)) return;

  const seq =
    new Sequence();

  const effect =
    seq.effect()
      .file(data.file)
      .atLocation(token)
      .scale(data.scale ?? 1)
      .fadeIn(data.fadeIn ?? 300)
      .fadeOut(data.fadeOut ?? 300)
      .duration(data.duration ?? MTROL_SCENE_FX_DURATION);

  if (typeof effect.name === "function") {
    effect.name(data.name);
  }

  rememberActiveMtrolFxName(data.name);

  await seq.play();
}

async function restoreCurrentSceneMtrolPersistentFX() {
  const scene = canvas?.scene;
  if (!scene) return;

  const sceneId = scene.id;
  const stored =
    await migrateLegacySceneFxFlags(scene);

  for (const data of stored) {
    if (!data?.name || data.sceneId !== sceneId) continue;
    if (!isMtrolFxName(data.name)) continue;

    await playSceneFx(data);
  }
}

export async function restoreMtrolCompetenciaPersistentFX() {
  try {
    if (!game.modules.get("sequencer")?.active) return;

    patchSequencerEffectManager();
    const activeSceneId =
      getCurrentSceneId();

    await syncMtrolCompetenciaPersistentFX(activeSceneId);
    await restoreCurrentSceneMtrolPersistentFX();
  } catch (error) {
    console.error("MtRol | Error sincronizando FX persistentes por escena:", error);
  }
}

function buildSceneFxData({
  sceneId,
  token,
  actor,
  item,
  tipo,
  file,
  scale,
  duration = MTROL_SCENE_FX_DURATION
}) {
  const tokenId = getTokenId(token);
  const name = getMtrolPersistentFxName({
    sceneId,
    tokenId,
    actorId: actor?.id,
    itemId: item?.id,
    tipo
  });

  return {
    sceneId,
    tokenId,
    actorId: actor?.id ?? null,
    itemId: item?.id ?? null,
    file,
    tipo,
    scale,
    duration,
    name,
    system: "mtrol",
    metadata: {
      system: "mtrol",
      sceneId
    },
    flags: {
      mtrol: {
        system: "mtrol",
        sceneId
      }
    }
  };
}

async function prepareEffect(effect, data, { persistent = false, duration = null } = {}) {
  if (persistent) {
    if (data?.sceneId !== getCurrentSceneId()) return;

    if (typeof effect.name === "function") {
      effect.name(data.name);
    }

    rememberActiveMtrolFxName(data.name);
    await rememberPersistentFx(canvas.scene, data);
    effect.duration(data.duration ?? MTROL_SCENE_FX_DURATION);
    return;
  }

  if (duration !== null) {
    effect.duration(duration);
  }
}

export function registerMtrolSequencerHooks() {
  Hooks.on("preUpdateUser", async (user, changes) => {
    if (user.id !== game.user.id) return;
    if (!foundry.utils.hasProperty(changes, "viewedScene")) return;

    await teardownMtrolSequencerFX();
  });

  Hooks.on("canvasTearDown", teardownMtrolSequencerFX);
  Hooks.on("canvasInit", teardownMtrolSequencerFX);
  Hooks.on("canvasReady", restoreMtrolCompetenciaPersistentFX);

  const removeFlagFromEndedEffect = async effect => {
    if (suppressFlagRemoval) return;

    const name = getEffectName(effect);
    if (!isMtrolFxName(name)) return;

    forgetActiveMtrolFxName(name);
    await removePersistentFxFlagByName(name);
  };

  Hooks.on("endedSequencerEffect", removeFlagFromEndedEffect);
  Hooks.on("sequencerEffectEnded", removeFlagFromEndedEffect);
  Hooks.on("deleteSequencerEffect", removeFlagFromEndedEffect);
}

export async function playCompetenciaFX(
  actor,
  item,
  targetToken = null
) {
  try {
    if (!game.modules.get("sequencer")?.active) {
      console.warn("MtRol | Sequencer no esta activo.");
      return;
    }

    patchSequencerEffectManager();

    const fx =
      item.system?.fx ?? {};

    const fxAutocast =
      fx.autocast ?? "";

    const fxProyectil =
      fx.proyectil ?? "";

    const fxTarget =
      fx.target ?? "";

    const fxLegacy =
      fx.visual ?? "";

    const fxSonido =
      fx.sonido ?? "";

    const duracion =
      Number(fx.duracion ?? 5000);

    const escala =
      Number(fx.escala ?? 1);

    const persistent =
      isPersistentFxConfig(fx);

    const sceneId =
      getCurrentSceneId();

    if (!sceneId) {
      console.warn("MtRol | FX cancelado: no hay escena activa en canvas.");
      return;
    }

    const casterToken =
      actor.getActiveTokens()[0];

    if (!casterToken) {
      ui.notifications.warn(
        "Coloca un token del actor en la escena para visualizar FX."
      );
      return;
    }

    if (!tokenBelongsToScene(casterToken, sceneId)) {
      console.warn("MtRol | FX cancelado: el token caster no pertenece a la escena activa.", {
        sceneId,
        tokenId: getTokenId(casterToken)
      });
      return;
    }

    if (targetToken && !tokenBelongsToScene(targetToken, sceneId)) {
      console.warn("MtRol | FX target cancelado: el token objetivo no pertenece a la escena activa.", {
        sceneId,
        tokenId: getTokenId(targetToken)
      });
      targetToken = null;
    }

    const seq = new Sequence();

    if (fxSonido) {
      seq.sound()
        .file(fxSonido)
        .volume(0.6);
    }

    if (fxAutocast) {
      const data = buildSceneFxData({
        sceneId,
        token: casterToken,
        actor,
        item,
        tipo: "autocast",
        file: fxAutocast,
        scale: escala
      });

      const effect = seq.effect()
        .file(fxAutocast)
        .atLocation(casterToken)
        .scale(escala)
        .fadeIn(300)
        .fadeOut(300);

      await prepareEffect(effect, data, {
        persistent,
        duration: duracion
      });
    }

    if (fxProyectil && targetToken) {
      const data = buildSceneFxData({
        sceneId,
        token: casterToken,
        actor,
        item,
        tipo: "proyectil",
        file: fxProyectil,
        scale: escala,
        duration: duracion
      });

      const effect = seq.effect()
        .file(fxProyectil)
        .atLocation(casterToken)
        .stretchTo(targetToken)
        .scale(escala);

      await prepareEffect(effect, data, {
        persistent: false,
        duration: duracion
      });
    }

    if (fxTarget && targetToken) {
      const data = buildSceneFxData({
        sceneId,
        token: targetToken,
        actor: targetToken.actor ?? actor,
        item,
        tipo: "target",
        file: fxTarget,
        scale: escala
      });

      const effect = seq.effect()
        .file(fxTarget)
        .atLocation(targetToken)
        .scale(escala)
        .fadeIn(300)
        .fadeOut(300);

      await prepareEffect(effect, data, {
        persistent,
        duration: duracion
      });
    }

    if (
      !fxAutocast &&
      !fxProyectil &&
      !fxTarget &&
      fxLegacy
    ) {
      const locationToken =
        targetToken ?? casterToken;

      const data = buildSceneFxData({
        sceneId,
        token: locationToken,
        actor: locationToken.actor ?? actor,
        item,
        tipo: "legacy",
        file: fxLegacy,
        scale: escala
      });

      const effect = seq.effect()
        .file(fxLegacy)
        .atLocation(locationToken)
        .scale(escala)
        .fadeIn(300)
        .fadeOut(300);

      await prepareEffect(effect, data, {
        persistent,
        duration: duracion
      });
    }

    await seq.play();
  } catch (error) {
    console.error(
      "MtRol | Error ejecutando FX:",
      error
    );
  }
}
