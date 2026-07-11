import {
  MTROL_3D_CAMERA_PRESETS,
  MTROL_3D_MODULE_ID
} from "./mtrol-3d-config.js";

import {
  getMtrol3DCameraPreferences,
  MTROL_3D_CAMERA_VIEW_CHOICES,
  notifyMtrol3DCamera,
  setMtrolDefault3DCameraView
} from "./mtrol-3d-settings.js";

const WARN_PREFIX = "MTROL 3D |";

const cameraState = {
  followEnabled: false,
  currentView: null,
  targetTokenId: null,
  gameCameraLogged: false
};

function warn(message, data = null) {
  if (data) {
    console.warn(`${WARN_PREFIX} ${message}`, data);
    return;
  }

  console.warn(`${WARN_PREFIX} ${message}`);
}

function getModule() {
  try {
    return game.modules.get(MTROL_3D_MODULE_ID) ?? null;
  } catch (error) {
    warn("No se pudo consultar el modulo 3D Canvas.", error);
    return null;
  }
}

function getCanvas() {
  return globalThis.canvas ?? null;
}

function getSceneCenter() {
  const foundryCanvas =
    getCanvas();

  const dimensions =
    foundryCanvas?.scene?.dimensions;

  if (dimensions) {
    return {
      x: dimensions.sceneX + (dimensions.sceneWidth / 2),
      y: dimensions.sceneY + (dimensions.sceneHeight / 2),
      z: 0
    };
  }

  return {
    x: foundryCanvas?.stage?.pivot?.x ?? 0,
    y: foundryCanvas?.stage?.pivot?.y ?? 0,
    z: 0
  };
}

function getGridSize() {
  return Number(getCanvas()?.grid?.size ?? 100) || 100;
}

function getSelectedToken() {
  return getCanvas()?.tokens?.controlled?.[0] ?? null;
}

function getTokenFromId(tokenId) {
  if (!tokenId) return null;
  return getCanvas()?.tokens?.get(tokenId) ?? null;
}

function getTokenCenter(token) {
  const document =
    token?.document ?? token;

  return {
    x: token?.center?.x ?? document?.x ?? 0,
    y: token?.center?.y ?? document?.y ?? 0,
    z: document?.elevation ?? token?.elevation ?? 0
  };
}

function resolveToken(tokenOrNull = null) {
  if (tokenOrNull) return tokenOrNull?.object ?? tokenOrNull;

  if (cameraState.targetTokenId) {
    const followedToken =
      getTokenFromId(cameraState.targetTokenId);

    if (followedToken) return followedToken;
  }

  return getSelectedToken();
}

function resolveTarget(tokenOrPoint = null) {
  const token =
    resolveToken(tokenOrPoint);

  if (token?.id || token?.document?.id) {
    return {
      token,
      tokenId: token.id ?? token.document?.id ?? null,
      point: getTokenCenter(token),
      animateTarget: token
    };
  }

  if (tokenOrPoint && typeof tokenOrPoint === "object") {
    const point = {
      x: Number(tokenOrPoint.x ?? 0),
      y: Number(tokenOrPoint.y ?? 0),
      z: Number(tokenOrPoint.z ?? tokenOrPoint.elevation ?? 0)
    };

    return {
      token: null,
      tokenId: null,
      point,
      animateTarget: point
    };
  }

  const point =
    getSceneCenter();

  return {
    token: null,
    tokenId: null,
    point,
    animateTarget: point
  };
}

function getPreset(viewName) {
  return MTROL_3D_CAMERA_PRESETS[viewName] ?? null;
}

function getPresetOptions(viewName, options = {}) {
  const preset =
    getPreset(viewName);

  if (!preset) return null;

  const gridSize =
    getGridSize();

  const distance =
    Number(
      options.distance ??
      preset.distance ??
      (gridSize * Number(preset.distanceMultiplier ?? 10))
    );

  const rotation =
    Number(options.rotation ?? preset.rotation ?? Math.PI / 4);

  const speed =
    Number(options.speed ?? preset.speed ?? 0.05);

  return {
    ...preset,
    distance,
    rotation,
    speed,
    topdown: options.topdown ?? preset.topdown ?? false
  };
}

function callFirst(targets, methodNames, ...args) {
  for (const target of targets) {
    if (!target) continue;

    for (const methodName of methodNames) {
      const method =
        target?.[methodName];

      if (typeof method !== "function") continue;

      return method.call(target, ...args);
    }
  }

  return null;
}

function getCamera(api) {
  return api?.camera ?? api?.controls?.object ?? api?.renderer?.camera ?? null;
}

function getControls(api) {
  return api?.controls ?? null;
}

function getThree(api) {
  return api?.THREE ?? globalThis.THREE ?? null;
}

function createVector3(api, x = 0, y = 0, z = 0) {
  const Vector3 =
    getThree(api)?.Vector3;

  if (typeof Vector3 === "function") {
    return new Vector3(x, y, z);
  }

  const clonedVector =
    getCamera(api)?.position?.clone?.() ??
    getControls(api)?.target?.clone?.() ??
    null;

  if (clonedVector) {
    clonedVector.x = x;
    clonedVector.y = y;
    clonedVector.z = z;
    return clonedVector;
  }

  return {
    x,
    y,
    z,
    clone() {
      return createVector3(api, this.x, this.y, this.z);
    }
  };
}

function cloneVector3(api, vector) {
  if (typeof vector?.clone === "function") return vector.clone();
  return createVector3(api, Number(vector?.x ?? 0), Number(vector?.y ?? 0), Number(vector?.z ?? 0));
}

function getToken3D(api, token) {
  const tokenId =
    token?.id ?? token?.document?.id ?? null;

  return tokenId ? api?.tokens?.[tokenId] ?? null : null;
}

function getPoint3D(api, point) {
  const factor =
    Number(api?.factor ?? getGridSize()) || getGridSize();

  return createVector3(
    api,
    Number(point?.x ?? 0) / factor,
    Number(point?.z ?? point?.elevation ?? 0) / factor,
    Number(point?.y ?? 0) / factor
  );
}

function get3DTokenPosition(api, token) {
  const token3D =
    getToken3D(api, token);

  const meshPosition =
    token3D?.mesh?.position ?? null;

  if (meshPosition) {
    return cloneVector3(api, meshPosition);
  }

  if (token3D?.head) {
    return cloneVector3(api, token3D.head);
  }

  const center =
    getTokenCenter(token);

  return getPoint3D(api, center);
}

function resolve3DLookAt(api, resolvedTarget) {
  if (resolvedTarget.token) {
    return get3DTokenPosition(api, resolvedTarget.token);
  }

  if (resolvedTarget.point) {
    return getPoint3D(api, resolvedTarget.point);
  }

  return createVector3(api, 0, 0, 0);
}

function applyVector(targetVector, values) {
  if (!targetVector) return false;

  if (typeof targetVector.set === "function") {
    targetVector.set(values.x, values.y, values.z);
    return true;
  }

  targetVector.x = values.x;
  targetVector.y = values.y;
  targetVector.z = values.z;
  return true;
}

function buildPresetCameraPosition(api, viewName, lookAt, presetOptions) {
  const distance3d =
    presetOptions.distance / (Number(api?.factor ?? getGridSize()) || getGridSize());

  if (viewName === "top" || presetOptions.topdown) {
    return createVector3(
      api,
      lookAt.x,
      lookAt.y + distance3d,
      lookAt.z + (distance3d * Number(presetOptions.topOffsetRatio ?? 0.02))
    );
  }

  const height =
    distance3d * Number(presetOptions.heightRatio ?? 0.7);

  const horizontalDistance =
    distance3d * Number(presetOptions.horizontalRatio ?? 1);

  return createVector3(
    api,
    lookAt.x - (horizontalDistance * Math.cos(presetOptions.rotation)),
    lookAt.y + height,
    lookAt.z + (horizontalDistance * Math.sin(presetOptions.rotation))
  );
}

function getPresetHeight(api, viewName, presetOptions) {
  const distance3d =
    presetOptions.distance / (Number(api?.factor ?? getGridSize()) || getGridSize());

  if (viewName === "top" || presetOptions.topdown) return distance3d;

  return distance3d * Number(presetOptions.heightRatio ?? 0.7);
}

function vectorToLogData(vector) {
  return {
    x: Number(vector?.x ?? 0),
    y: Number(vector?.y ?? 0),
    z: Number(vector?.z ?? 0)
  };
}

function applyCameraZoom(api, presetOptions) {
  const camera =
    getCamera(api);

  if (!camera || !("zoom" in presetOptions)) return;

  camera.zoom = presetOptions.zoom;

  if (typeof camera.updateProjectionMatrix === "function") {
    camera.updateProjectionMatrix();
  }
}

function logGameCameraState(api) {
  if (!api?.GameCamera?.enabled || cameraState.gameCameraLogged) return;

  console.log("MTROL | 3D Camera GameCamera active");
  cameraState.gameCameraLogged = true;
}

function applyCameraViaAnimateTarget(api, cameraPosition, lookAt, presetOptions) {
  if (!api || !("_animateCameraTarget" in api)) return false;

  api._animateCameraTarget = api._animateCameraTarget || {};
  api._animateCameraTarget.cameraPosition = cameraPosition;
  api._animateCameraTarget.cameraLookat = lookAt;
  api._animateCameraTarget.speed = presetOptions.speed;

  applyCameraZoom(api, presetOptions);

  if (presetOptions.logDiagnostics) {
    console.log("MTROL | 3D Camera applied via animate target");
  }

  return true;
}

function applyDirectCameraFallback(api, cameraPosition, lookAt, presetOptions) {
  const camera =
    getCamera(api);

  const controls =
    getControls(api);

  if (!camera && !controls) return false;

  let applied = false;

  if (camera?.position) {
    applied = applyVector(camera.position, cameraPosition) || applied;
  }

  if (controls?.target) {
    applied = applyVector(controls.target, lookAt) || applied;
  }

  if (typeof camera?.lookAt === "function") {
    camera.lookAt(lookAt.x, lookAt.y, lookAt.z);
    applied = true;
  }

  if (typeof controls?.update === "function") {
    controls.update();
  }

  applyCameraZoom(api, presetOptions);

  callFirst([api, api?.renderer], ["render", "refresh", "update"]);

  if (applied && presetOptions.logDiagnostics) {
    console.log("MTROL | 3D Camera applied via direct fallback");
  }

  return applied;
}

function applyPresetCamera(api, viewName, resolvedTarget, presetOptions) {
  const lookAt =
    resolve3DLookAt(api, resolvedTarget);

  const cameraPosition =
    buildPresetCameraPosition(api, viewName, lookAt, presetOptions);

  logGameCameraState(api);

  const applied =
    applyCameraViaAnimateTarget(api, cameraPosition, lookAt, presetOptions) ||
    applyDirectCameraFallback(api, cameraPosition, lookAt, presetOptions);

  if (applied && presetOptions.logDiagnostics) {
    console.log("MTROL | Camera preset applied", {
      view: viewName,
      distance: presetOptions.distance,
      height: getPresetHeight(api, viewName, presetOptions),
      lookAt: vectorToLogData(lookAt)
    });
  }

  return applied;
}

function applyAnimatedCamera(api, resolvedTarget, presetOptions) {
  if (resolvedTarget.token) return false;

  const animateCamera =
    api?.helpers?.animateCamera;

  if (typeof animateCamera !== "function") return false;

  animateCamera.call(
    api.helpers,
    resolvedTarget.animateTarget,
    {
      distance: presetOptions.distance,
      rotation: presetOptions.rotation,
      speed: presetOptions.speed,
      topdown: presetOptions.topdown
    }
  );

  return true;
}

function applyNativeFocus(api, resolvedTarget, presetOptions) {
  if (resolvedTarget.token && typeof api?.setCameraToControlled === "function") {
    api.setCameraToControlled(resolvedTarget.token);
    return true;
  }

  const focusCameraToPosition =
    api?.helpers?.focusCameraToPosition;

  if (typeof focusCameraToPosition !== "function") return false;

  const lookAt =
    resolve3DLookAt(api, resolvedTarget);

  const cameraPosition =
    buildPresetCameraPosition(api, "isometric", lookAt, presetOptions);

  focusCameraToPosition.call(
    api.helpers,
    cameraPosition,
    lookAt,
    presetOptions.speed
  );

  return true;
}

function softInactiveWarning(action) {
  warn(`3D Canvas no esta activo. No se ejecuto: ${action}.`);
}

export function is3DCanvasActive() {
  try {
    return getModule()?.active === true;
  } catch (error) {
    warn("Error validando si 3D Canvas esta activo.", error);
    return false;
  }
}

export function get3DCanvas() {
  try {
    if (!is3DCanvasActive()) return null;

    const moduleApi =
      game.modules.get(MTROL_3D_MODULE_ID)?.api ?? null;

    const foundryCanvas =
      getCanvas();

    const candidates = [
      game.Levels3DPreview,
      foundryCanvas?.scene?.levels3d,
      foundryCanvas?.levels3d,
      moduleApi
    ];

    const api =
      candidates.find(candidate => !!candidate) ?? null;

    if (!api) {
      warn(
        "3D Canvas esta activo, pero no se encontro una API clara. Inspeccionar game.Levels3DPreview."
      );
    }

    return api;
  } catch (error) {
    warn("Error detectando la API de 3D Canvas.", error);
    return null;
  }
}

function setView(viewName, options = {}) {
  try {
    if (!is3DCanvasActive()) {
      softInactiveWarning(`camera.${viewName}`);
      return false;
    }

    const shouldLogDiagnostics =
      options.reason !== "follow" && viewName !== cameraState.currentView;

    const basePresetOptions =
      getPresetOptions(viewName, options);

    if (!basePresetOptions) {
      warn(`Vista de camara inexistente: ${viewName}`);
      return false;
    }

    const presetOptions = {
      ...basePresetOptions,
      logDiagnostics: shouldLogDiagnostics
    };

    const api =
      get3DCanvas();

    if (!api) return false;

    const resolvedTarget =
      resolveTarget(options.target ?? options.token ?? null);

    const applied =
      applyPresetCamera(api, viewName, resolvedTarget, presetOptions);

    if (!applied) {
      warn("No se encontro una forma segura de mover la camara 3D.");
      return false;
    }

    cameraState.currentView = viewName;
    cameraState.targetTokenId = resolvedTarget.tokenId ?? cameraState.targetTokenId;

    if (shouldLogDiagnostics) {
      console.log(`MTROL | 3D Camera view: ${viewName}`);
    }

    return true;
  } catch (error) {
    warn(`Error aplicando vista de camara: ${viewName}`, error);
    return false;
  }
}

function focus(tokenOrPoint = null, options = {}) {
  try {
    if (!is3DCanvasActive()) {
      softInactiveWarning("camera.focus");
      return false;
    }

    const api =
      get3DCanvas();

    if (!api) return false;

    const resolvedTarget =
      resolveTarget(tokenOrPoint);

    const presetOptions =
      getPresetOptions(options.view ?? cameraState.currentView ?? "isometric", options) ??
      getPresetOptions("isometric", options);

    const viewName =
      options.view ?? cameraState.currentView ?? "isometric";

    const applied =
      applyNativeFocus(api, resolvedTarget, presetOptions) ||
      applyAnimatedCamera(api, resolvedTarget, presetOptions) ||
      applyPresetCamera(api, viewName, resolvedTarget, presetOptions);

    if (!applied) {
      warn("No se encontro una forma segura de enfocar la camara 3D.");
      return false;
    }

    cameraState.targetTokenId = resolvedTarget.tokenId ?? cameraState.targetTokenId;
    return true;
  } catch (error) {
    warn("Error enfocando camara 3D.", error);
    return false;
  }
}

function follow(tokenOrNull = null, options = {}) {
  try {
    if (!is3DCanvasActive()) {
      softInactiveWarning("camera.follow");
      return false;
    }

    const token =
      resolveToken(tokenOrNull);

    if (!token) {
      warn("No hay token seleccionado para seguir.");
      return false;
    }

    cameraState.followEnabled = true;
    cameraState.targetTokenId = token.id ?? token.document?.id ?? null;

    if (game.mtrol3d) game.mtrol3d._followEnabled = true;

    const viewName =
      options.view ?? cameraState.currentView ?? "isometric";

    setView(
      viewName,
      {
        ...options,
        target: token,
        reason: options.reason ?? "follow"
      }
    );

    console.log("MTROL | 3D Camera follow enabled");
    return true;
  } catch (error) {
    warn("Error activando seguimiento 3D.", error);
    return false;
  }
}

function stopFollow() {
  cameraState.followEnabled = false;
  cameraState.targetTokenId = null;

  if (game.mtrol3d) game.mtrol3d._followEnabled = false;

  console.log("MTROL | 3D Camera follow disabled");
  return true;
}

function reset(options = {}) {
  try {
    if (!is3DCanvasActive()) {
      softInactiveWarning("camera.reset");
      return false;
    }

    const api =
      get3DCanvas();

    if (!api) return false;

    const token =
      resolveToken(options.token ?? null);

    if (token && typeof api?.setCameraToControlled === "function") {
      api.setCameraToControlled(token);
      cameraState.currentView = "reset";
      cameraState.targetTokenId = token.id ?? token.document?.id ?? cameraState.targetTokenId;
      return true;
    }

    const nativeReset =
      callFirst(
        [api, api?.camera, api?.controls],
        ["resetCamera", "reset", "resetView"],
        options.topdown === true
      );

    if (nativeReset !== null) {
      cameraState.currentView = "reset";
      return true;
    }

    const resolvedTarget =
      resolveTarget(options.target ?? options.token ?? null);

    const presetOptions =
      getPresetOptions(options.view ?? "isometric", options);

    const applied =
      applyNativeFocus(api, resolvedTarget, presetOptions) ||
      applyAnimatedCamera(api, resolvedTarget, presetOptions) ||
      applyPresetCamera(api, options.view ?? "isometric", resolvedTarget, presetOptions);

    if (!applied) return false;

    cameraState.currentView = "reset";
    cameraState.targetTokenId = resolvedTarget.tokenId ?? cameraState.targetTokenId;
    return true;
  } catch (error) {
    warn("Error reiniciando la camara 3D.", error);
    return false;
  }
}

function getState() {
  return {
    active: is3DCanvasActive(),
    followEnabled: cameraState.followEnabled,
    currentView: cameraState.currentView,
    targetTokenId: cameraState.targetTokenId
  };
}

function getUserPreferences() {
  return getMtrol3DCameraPreferences();
}

function applyDefault(options = {}) {
  try {
    const preferences =
      getUserPreferences();

    const applied =
      setView(
        preferences.defaultView,
        {
          ...options,
          reason: options.reason ?? "default"
        }
      );

    if (!applied) return false;

    if (preferences.autoFollow) {
      const token =
        resolveToken(options.token ?? null);

      if (token) {
        follow(
          token,
          {
            view: preferences.defaultView,
            reason: "follow"
          }
        );
      }
    }

    return true;
  } catch (error) {
    warn("Error aplicando camara 3D predeterminada.", error);
    return false;
  }
}

async function saveCurrentAsDefault() {
  try {
    const currentView =
      cameraState.currentView;

    if (!MTROL_3D_CAMERA_VIEW_CHOICES[currentView]) {
      notifyMtrol3DCamera("MTROL 3D | No hay una vista valida para guardar.", "warn");
      return false;
    }

    const saved =
      await setMtrolDefault3DCameraView(currentView);

    if (!saved) return false;

    notifyMtrol3DCamera(`MTROL 3D | Vista predeterminada guardada: ${MTROL_3D_CAMERA_VIEW_CHOICES[currentView]}.`);
    return true;
  } catch (error) {
    warn("Error guardando vista 3D predeterminada.", error);
    return false;
  }
}

function toggleFollow(options = {}) {
  if (cameraState.followEnabled) return stopFollow();

  if (!resolveToken(options.token ?? null)) {
    notifyMtrol3DCamera("MTROL 3D | Selecciona un token para activar seguimiento.", "warn");
    return false;
  }

  return follow(null, options);
}

export const mtrol3dCameraApi = {
  setView,
  isometric: options => setView("isometric", options),
  combat: options => setView("combat", options),
  close: options => setView("close", options),
  top: options => setView("top", options),
  focus,
  follow,
  stopFollow,
  reset,
  applyDefault,
  saveCurrentAsDefault,
  toggleFollow,
  getUserPreferences,
  getState
};

export function setCameraPreset(presetName, options = {}) {
  const viewName =
    presetName === "tactical" ? "combat" : presetName;

  return mtrol3dCameraApi.setView(viewName, options);
}

export function resetCamera(options = {}) {
  return mtrol3dCameraApi.reset(options);
}

export function focusToken3D(token, options = {}) {
  return mtrol3dCameraApi.focus(token, options);
}

export function followSelectedToken(options = {}) {
  return mtrol3dCameraApi.follow(null, options);
}

export function stopFollowSelectedToken() {
  return mtrol3dCameraApi.stopFollow();
}

export function refreshFollowTarget(token = null, options = {}) {
  if (!cameraState.followEnabled) return false;

  const followToken =
    token ??
    getTokenFromId(cameraState.targetTokenId) ??
    getSelectedToken();

  if (!followToken) return false;

  const tokenId =
    followToken.id ?? followToken.document?.id ?? null;

  if (cameraState.targetTokenId && tokenId && tokenId !== cameraState.targetTokenId) {
    return false;
  }

  return mtrol3dCameraApi.setView(
    cameraState.currentView ?? "isometric",
    {
      ...options,
      target: followToken,
      reason: options.reason ?? "follow"
    }
  );
}

export function installMtrol3DApi() {
  try {
    game.mtrol3d = game.mtrol3d || {};

    Object.assign(game.mtrol3d, {
      isActive: is3DCanvasActive,
      setCameraPreset,
      resetCamera,
      followSelectedToken,
      stopFollowSelectedToken,
      focusToken3D,
      camera: mtrol3dCameraApi,
      presets: MTROL_3D_CAMERA_PRESETS,
      _followEnabled: cameraState.followEnabled
    });

    console.log("MTROL | 3D Camera ready");
    return true;
  } catch (error) {
    warn("No se pudo instalar game.mtrol3d.", error);
    return false;
  }
}
