import {
  MTROL_3D_MODULE_ID
} from "./mtrol-3d-config.js";

import {
  getMtrol3DVisualPreferences,
  MTROL_3D_VISUAL_PRESET_CHOICES,
  notifyMtrol3DCamera
} from "./mtrol-3d-settings.js";

const SYSTEM_ID = "mtrol";
const BACKUP_FLAG = "visual3DBackup";

const SCENE_FLAG_KEYS = [
  "sceneTint",
  "timeSync",
  "sunPosition",
  "exposure",
  "sunDistance",
  "sunTilt",
  "ambientLightIntensity",
  "ambientLightColor",
  "shadowBias",
  "enableFog",
  "fogColor",
  "fogDistance",
  "bloom",
  "bloomThreshold",
  "bloomStrength",
  "bloomRadius"
];

const CLIENT_SETTING_KEYS = [
  "softShadows",
  "shadowQuality",
  "enableShaders",
  "enableEffects",
  "dofblur"
];

const VISUAL_PRESETS = {
  softShadows: {
    label: "Sombras suaves 2.5D",
    sceneFlags: {
      sceneTint: "#ffffff",
      timeSync: "off",
      sunPosition: 12,
      exposure: 0.72,
      sunDistance: 5,
      sunTilt: 0,
      ambientLightIntensity: 0.58,
      ambientLightColor: "#ffffff",
      shadowBias: -0.000018,
      enableFog: false,
      bloom: false,
      bloomThreshold: 1,
      bloomStrength: 0,
      bloomRadius: 0
    },
    clientSettings: {
      softShadows: true,
      shadowQuality: 2,
      enableShaders: true,
      enableEffects: true,
      dofblur: "off"
    }
  },
  performance: {
    label: "Rendimiento",
    sceneFlags: {
      sceneTint: "#ffffff",
      timeSync: "off",
      sunPosition: 12,
      exposure: 0.7,
      sunDistance: 0,
      sunTilt: 0,
      ambientLightIntensity: 0.65,
      ambientLightColor: "#ffffff",
      shadowBias: -0.000018,
      enableFog: false,
      bloom: false,
      bloomThreshold: 1,
      bloomStrength: 0,
      bloomRadius: 0
    },
    clientSettings: {
      softShadows: false,
      shadowQuality: 0,
      enableShaders: true,
      enableEffects: false,
      dofblur: "off"
    }
  },
  cinematic: {
    label: "Cinematica",
    sceneFlags: {
      sceneTint: "#fff6dc",
      timeSync: "off",
      sunPosition: 9,
      exposure: 0.9,
      sunDistance: 9,
      sunTilt: 0.18,
      ambientLightIntensity: 0.32,
      ambientLightColor: "#ffe8b8",
      shadowBias: -0.000018,
      enableFog: false,
      bloom: true,
      bloomThreshold: 0.85,
      bloomStrength: 0.18,
      bloomRadius: 0.25
    },
    clientSettings: {
      softShadows: true,
      shadowQuality: 4,
      enableShaders: true,
      enableEffects: true,
      dofblur: "off"
    }
  }
};

function warn(message, data = null) {
  if (data) {
    console.warn(`MTROL 3D Visual | ${message}`, data);
    return;
  }

  console.warn(`MTROL 3D Visual | ${message}`);
}

function getScene() {
  return globalThis.canvas?.scene ?? null;
}

function getApi() {
  return globalThis.game?.Levels3DPreview ?? null;
}

function is3DActive() {
  return globalThis.game?.modules?.get(MTROL_3D_MODULE_ID)?.active === true &&
    getApi()?._active === true;
}

function getSceneFlagSnapshot(scene = getScene()) {
  const flags =
    scene?.flags?.[MTROL_3D_MODULE_ID] ?? {};

  return Object.fromEntries(
    SCENE_FLAG_KEYS.map(key => [
      key,
      {
        exists: Object.prototype.hasOwnProperty.call(flags, key),
        value: flags[key]
      }
    ])
  );
}

function getSceneFlagValues(scene = getScene()) {
  const flags =
    scene?.flags?.[MTROL_3D_MODULE_ID] ?? {};

  return Object.fromEntries(
    SCENE_FLAG_KEYS.map(key => [key, flags[key]])
  );
}

function getClientSettingSnapshot() {
  return Object.fromEntries(
    CLIENT_SETTING_KEYS.map(key => [
      key,
      {
        exists: globalThis.game?.settings?.settings?.has?.(`${MTROL_3D_MODULE_ID}.${key}`) ?? false,
        value: getClientSetting(key)
      }
    ])
  );
}

function getClientSettingValues() {
  return Object.fromEntries(
    CLIENT_SETTING_KEYS.map(key => [key, getClientSetting(key)])
  );
}

function getClientSetting(key) {
  try {
    return globalThis.game.settings.get(MTROL_3D_MODULE_ID, key);
  } catch (error) {
    return undefined;
  }
}

async function setClientSetting(key, value) {
  if (!(globalThis.game?.settings?.settings?.has?.(`${MTROL_3D_MODULE_ID}.${key}`) ?? false)) {
    return false;
  }

  await globalThis.game.settings.set(MTROL_3D_MODULE_ID, key, value);
  return true;
}

function getPreset(presetName) {
  if (presetName === "none") return null;
  return VISUAL_PRESETS[presetName] ?? null;
}

function requireActiveSceneAnd3D(actionName) {
  if (!getScene()) {
    notifyMtrol3DCamera("MTROL 3D Visual | No hay escena activa.", "warn");
    return false;
  }

  if (!is3DActive()) {
    notifyMtrol3DCamera(`MTROL 3D Visual | Canvas 3D no esta activo para ${actionName}.`, "warn");
    return false;
  }

  return true;
}

function applyRuntimeLighting(sceneFlags) {
  const api =
    getApi();

  const globalIllumination =
    api?.lights?.globalIllumination ?? null;

  if (globalIllumination?.setTarget) {
    globalIllumination.setTarget(
      {
        color: sceneFlags.sceneTint,
        time: sceneFlags.sunPosition,
        distance: sceneFlags.sunDistance,
        exposure: sceneFlags.exposure,
        tilt: sceneFlags.sunTilt
      },
      false
    );
  }

  const ambientLight =
    globalIllumination?.ambientLight ?? null;

  if (ambientLight) {
    ambientLight.intensity = Number(sceneFlags.ambientLightIntensity ?? ambientLight.intensity ?? 0);
    ambientLight.color?.set?.(sceneFlags.ambientLightColor ?? "#ffffff");
    if (ambientLight.intensity > 0) api?.scene?.add?.(ambientLight);
  }

  const sunlight =
    globalIllumination?.global?.sunlight ?? null;

  if (sunlight?.shadow && sceneFlags.shadowBias !== undefined) {
    sunlight.shadow.bias = Number(sceneFlags.shadowBias);
  }
}

function applyRuntimeClientSettings(clientSettings) {
  const api =
    getApi();

  const renderer =
    api?.renderer ?? null;

  if (renderer?.shadowMap && clientSettings.softShadows !== undefined) {
    const three =
      api?.THREE ?? globalThis.THREE;

    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = clientSettings.softShadows
      ? three?.PCFSoftShadowMap ?? renderer.shadowMap.type
      : three?.PCFShadowMap ?? renderer.shadowMap.type;
  }

  const shadowQuality =
    Number(clientSettings.shadowQuality);

  const sunlight =
    api?.lights?.globalIllumination?.global?.sunlight ?? null;

  if (sunlight?.shadow && Number.isFinite(shadowQuality)) {
    sunlight.castShadow = shadowQuality > 0;
    sunlight.shadow.mapSize.width = 1024 * shadowQuality;
    sunlight.shadow.mapSize.height = 1024 * shadowQuality;
    sunlight.shadow.map?.dispose?.();
    sunlight.shadow.map = null;
  }
}

function applyRuntimeEnvironment(sceneFlags) {
  const api =
    getApi();

  if (!api?.scene) return;

  if (sceneFlags.enableFog === false) {
    api.scene.fog = null;
  }

  if (sceneFlags.bloom === false && api.bloomPass && api.composer?.removePass) {
    api.composer.removePass(api.bloomPass);
  }

  if (sceneFlags.exposure !== undefined && api.renderer) {
    api.renderer.toneMappingExposure = Number(sceneFlags.exposure);
  }
}

function applyRuntimePresetData(preset) {
  applyRuntimeLighting(preset.sceneFlags);
  applyRuntimeClientSettings(preset.clientSettings);
  applyRuntimeEnvironment(preset.sceneFlags);
  getApi()?.renderer?.render?.(getApi()?.scene, getApi()?.camera);
}

async function ensureBackup() {
  const scene =
    getScene();

  if (!scene || !globalThis.game?.user?.isGM) return false;

  const existing =
    scene.getFlag(SYSTEM_ID, BACKUP_FLAG);

  if (existing) return true;

  await scene.setFlag(SYSTEM_ID, BACKUP_FLAG, {
    module: MTROL_3D_MODULE_ID,
    sceneId: scene.id,
    createdAt: new Date().toISOString(),
    sceneFlags: getSceneFlagSnapshot(scene),
    clientSettings: getClientSettingSnapshot()
  });

  return true;
}

async function updateSceneFlags(sceneFlags) {
  const scene =
    getScene();

  const current =
    { ...(scene?.flags?.[MTROL_3D_MODULE_ID] ?? {}) };

  await scene.update({
    flags: {
      [MTROL_3D_MODULE_ID]: {
        ...current,
        ...sceneFlags
      }
    }
  });
}

async function applyClientSettings(clientSettings) {
  for (const [key, value] of Object.entries(clientSettings)) {
    await setClientSetting(key, value);
  }
}

async function applyPreset(presetName, options = {}) {
  try {
    if (!requireActiveSceneAnd3D(presetName)) return false;

    if (!globalThis.game?.user?.isGM) {
      notifyMtrol3DCamera("MTROL 3D Visual | Solo el GM puede guardar presets visuales en la escena.", "warn");
      return false;
    }

    const preset =
      getPreset(presetName);

    if (!preset) {
      notifyMtrol3DCamera(`MTROL 3D Visual | Preset inexistente: ${presetName}.`, "warn");
      return false;
    }

    await ensureBackup();
    await updateSceneFlags(preset.sceneFlags);
    await applyClientSettings(preset.clientSettings);
    await globalThis.game.settings.set(SYSTEM_ID, "visualPreset3D", presetName);

    applyRuntimePresetData(preset);

    if (options.notify !== false) {
      notifyMtrol3DCamera(`MTROL 3D Visual | Preset aplicado: ${preset.label}.`);
    }

    return true;
  } catch (error) {
    warn(`Error aplicando preset ${presetName}.`, error);
    return false;
  }
}

function getState() {
  const scene =
    getScene();

  const api =
    getApi();

  const globalIllumination =
    api?.lights?.globalIllumination ?? null;

  const sunlight =
    globalIllumination?.global?.sunlight ?? null;

  return {
    active: is3DActive(),
    module: {
      id: MTROL_3D_MODULE_ID,
      active: globalThis.game?.modules?.get(MTROL_3D_MODULE_ID)?.active === true,
      version: globalThis.game?.modules?.get(MTROL_3D_MODULE_ID)?.version ?? null
    },
    scene: {
      id: scene?.id ?? null,
      name: scene?.name ?? null,
      flags: getSceneFlagValues(scene),
      backupExists: Boolean(scene?.getFlag?.(SYSTEM_ID, BACKUP_FLAG))
    },
    clientSettings: getClientSettingValues(),
    runtime: {
      rendererShadowMapEnabled: api?.renderer?.shadowMap?.enabled ?? null,
      rendererShadowMapType: api?.renderer?.shadowMap?.type ?? null,
      toneMappingExposure: api?.renderer?.toneMappingExposure ?? null,
      fogEnabled: Boolean(api?.scene?.fog),
      bloomEnabled: Boolean(api?.bloomPass),
      ambientLightIntensity: globalIllumination?.ambientLight?.intensity ?? null,
      sunlightIntensity: sunlight?.intensity ?? null,
      sunlightCastShadow: sunlight?.castShadow ?? null,
      sunlightShadowMapSize: sunlight?.shadow?.mapSize
        ? {
          width: sunlight.shadow.mapSize.width,
          height: sunlight.shadow.mapSize.height
        }
        : null
    },
    preferences: getMtrol3DVisualPreferences()
  };
}

function previewPreset(presetName) {
  try {
    if (presetName === "none") return true;
    if (!requireActiveSceneAnd3D(`preview ${presetName}`)) return false;

    const preset =
      getPreset(presetName);

    if (!preset) {
      notifyMtrol3DCamera(`MTROL 3D Visual | Preset inexistente: ${presetName}.`, "warn");
      return false;
    }

    applyRuntimePresetData(preset);
    notifyMtrol3DCamera(`MTROL 3D Visual | Preview aplicado: ${preset.label}.`);
    return true;
  } catch (error) {
    warn(`Error previsualizando preset ${presetName}.`, error);
    return false;
  }
}

async function resetVisualPreset() {
  try {
    if (!requireActiveSceneAnd3D("reset visual")) return false;

    if (!globalThis.game?.user?.isGM) {
      notifyMtrol3DCamera("MTROL 3D Visual | Solo el GM puede restaurar presets visuales guardados.", "warn");
      return false;
    }

    const scene =
      getScene();

    const backup =
      scene.getFlag(SYSTEM_ID, BACKUP_FLAG);

    if (!backup) {
      notifyMtrol3DCamera("MTROL 3D Visual | No hay backup visual previo para esta escena.", "warn");
      return false;
    }

    for (const [key, entry] of Object.entries(backup.sceneFlags ?? {})) {
      if (entry?.exists) {
        await scene.setFlag(MTROL_3D_MODULE_ID, key, entry.value);
      } else {
        await scene.unsetFlag(MTROL_3D_MODULE_ID, key);
      }
    }

    for (const [key, entry] of Object.entries(backup.clientSettings ?? {})) {
      if (entry?.exists) await setClientSetting(key, entry.value);
    }

    notifyMtrol3DCamera("MTROL 3D Visual | Preset visual restaurado desde backup.");
    return true;
  } catch (error) {
    warn("Error restaurando preset visual.", error);
    return false;
  }
}

function setObjectShadowState(root, castShadow, receiveShadow = true) {
  let count = 0;

  root?.traverse?.(child => {
    if (!child || !("castShadow" in child)) return;

    child.castShadow = castShadow;
    if ("receiveShadow" in child) child.receiveShadow = receiveShadow;
    count += 1;
  });

  return count;
}

function optimizeSceneShadows({ mode = "balanced" } = {}) {
  try {
    if (!requireActiveSceneAnd3D(`optimizeSceneShadows ${mode}`)) return false;

    const api =
      getApi();

    const tokens =
      Object.values(api?.tokens ?? {});

    const tiles =
      Object.values(api?.tiles ?? {});

    let touched = 0;

    if (mode === "off") {
      touched += tokens.reduce((total, token3d) => total + setObjectShadowState(token3d.mesh, false, true), 0);
      touched += tiles.reduce((total, tile3d) => total + setObjectShadowState(tile3d.mesh, false, true), 0);
    } else if (mode === "tokens-only") {
      touched += tokens.reduce((total, token3d) => total + setObjectShadowState(token3d.mesh, true, true), 0);
      touched += tiles.reduce((total, tile3d) => total + setObjectShadowState(tile3d.mesh, false, true), 0);
    } else if (mode === "important-only") {
      touched += tokens.reduce((total, token3d) => total + setObjectShadowState(token3d.mesh, true, true), 0);
      touched += tiles.reduce((total, tile3d) => {
        const important =
          tile3d.tile?.document?.getFlag?.(SYSTEM_ID, "important3DShadow") === true ||
          tile3d.tile?.document?.getFlag?.(MTROL_3D_MODULE_ID, "castShadow") === true;

        return total + setObjectShadowState(tile3d.mesh, important, true);
      }, 0);
    } else {
      touched += tokens.reduce((total, token3d) => total + setObjectShadowState(token3d.mesh, true, true), 0);
      touched += tiles.reduce((total, tile3d) => total + setObjectShadowState(tile3d.mesh, true, true), 0);
    }

    notifyMtrol3DCamera(`MTROL 3D Visual | Sombras optimizadas (${mode}): ${touched} meshes.`);
    return true;
  } catch (error) {
    warn("Error optimizando sombras runtime.", error);
    return false;
  }
}

export const mtrol3dVisualApi = {
  getState,
  applySoftShadowsPreset: options => applyPreset("softShadows", options),
  applyPerformancePreset: options => applyPreset("performance", options),
  applyCinematicPreset: options => applyPreset("cinematic", options),
  resetVisualPreset,
  previewPreset,
  optimizeSceneShadows,
  presets: VISUAL_PRESETS
};

export function installMtrol3DVisualApi() {
  try {
    globalThis.game.mtrol3d = globalThis.game.mtrol3d || {};

    Object.assign(globalThis.game.mtrol3d, {
      visual: mtrol3dVisualApi
    });

    console.log("MTROL | 3D Visual ready");
    return true;
  } catch (error) {
    warn("No se pudo instalar game.mtrol3d.visual.", error);
    return false;
  }
}

export function applyConfiguredVisualPreview() {
  const preferences =
    getMtrol3DVisualPreferences();

  if (!preferences.applyOnSceneLoad || preferences.visualPreset === "none") return false;

  return previewPreset(preferences.visualPreset);
}
