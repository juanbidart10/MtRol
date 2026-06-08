import {
  MTROL_3D_CAMERA_PRESETS,
  MTROL_3D_MODULE_ID
} from "./mtrol-3d-config.js";

const WARN_PREFIX = "MTROL 3D |";
const DEG_TO_RAD = Math.PI / 180;

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

function getTokenCenter(token) {
  const document = token?.document ?? token;

  return {
    x: token?.center?.x ?? document?.x ?? 0,
    y: token?.center?.y ?? document?.y ?? 0,
    z: document?.elevation ?? token?.elevation ?? 0
  };
}

function degreesToRadians(value) {
  return Number(value ?? 0) * DEG_TO_RAD;
}

function callFirst(targets, methodNames, ...args) {
  for (const target of targets) {
    if (!target) continue;

    for (const methodName of methodNames) {
      const method = target?.[methodName];

      if (typeof method !== "function") continue;

      return method.call(target, ...args);
    }
  }

  return null;
}

function applyCameraData(api, preset) {
  let applied = false;

  const targets = [
    api,
    api?.camera,
    api?.controls,
    api?.scene,
    api?.renderer
  ];

  const camera =
    api?.camera ?? api?.controls?.object ?? api?.renderer?.camera ?? null;

  if (camera?.position?.set) {
    camera.position.set(
      preset.position.x,
      preset.position.y,
      preset.position.z
    );
    applied = true;
  } else if (camera?.position) {
    Object.assign(camera.position, preset.position);
    applied = true;
  }

  if (camera?.rotation?.set) {
    camera.rotation.set(
      degreesToRadians(preset.rotation.x),
      degreesToRadians(preset.rotation.y),
      degreesToRadians(preset.rotation.z)
    );
    applied = true;
  } else if (camera?.rotation) {
    camera.rotation.x = degreesToRadians(preset.rotation.x);
    camera.rotation.y = degreesToRadians(preset.rotation.y);
    camera.rotation.z = degreesToRadians(preset.rotation.z);
    applied = true;
  }

  if ("zoom" in preset && camera) {
    camera.zoom = preset.zoom;
    applied = true;

    if (typeof camera.updateProjectionMatrix === "function") {
      camera.updateProjectionMatrix();
    }
  }

  const apiResult =
    callFirst(
    targets,
    ["setCamera", "setCameraPosition", "moveCamera", "updateCamera"],
    preset
  );

  if (apiResult !== null) applied = true;

  callFirst(targets, ["render", "refresh", "update"]);

  if (!applied) {
    warn(
      "No se encontro una forma segura de mover la camara en la API 3D detectada. Inspeccionar: game.Levels3DPreview, canvas.scene?.levels3d, canvas?.levels3d, game.modules.get(\"levels-3d-preview\")?.api."
    );
  }

  return applied;
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
      globalThis.canvas ?? null;

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
        "3D Canvas esta activo, pero no se encontro una API clara. Inspeccionar: game.Levels3DPreview, canvas.scene?.levels3d, canvas?.levels3d, game.modules.get(\"levels-3d-preview\")?.api."
      );
    }

    return api;
  } catch (error) {
    warn("Error detectando la API de 3D Canvas.", error);
    return null;
  }
}

export function setCameraPreset(presetName) {
  try {
    if (!is3DCanvasActive()) {
      warn("3D Canvas no esta activo. No se aplico preset de camara.");
      return false;
    }

    const preset =
      MTROL_3D_CAMERA_PRESETS[presetName];

    if (!preset) {
      warn(`Preset de camara inexistente: ${presetName}`);
      return false;
    }

    const api =
      get3DCanvas();

    if (!api) return false;

    return applyCameraData(api, preset);
  } catch (error) {
    warn(`Error aplicando preset de camara: ${presetName}`, error);
    return false;
  }
}

export function resetCamera() {
  try {
    if (!is3DCanvasActive()) {
      warn("3D Canvas no esta activo. No se reinicio la camara.");
      return false;
    }

    const api =
      get3DCanvas();

    if (!api) return false;

    const result =
      callFirst(
        [api, api?.camera, api?.controls],
        ["resetCamera", "reset", "resetView"]
      );

    if (result !== null) return true;

    return setCameraPreset("isometric");
  } catch (error) {
    warn("Error reiniciando la camara 3D.", error);
    return false;
  }
}

export function focusToken3D(token) {
  try {
    if (!is3DCanvasActive()) {
      warn("3D Canvas no esta activo. No se enfoco token.");
      return false;
    }

    if (!token) {
      warn("No hay token para enfocar.");
      return false;
    }

    const api =
      get3DCanvas();

    if (!api) return false;

    const result =
      callFirst(
        [api, api?.camera, api?.controls],
        ["focusToken", "setTarget", "lookAtToken", "centerOnToken"],
        token
      );

    if (result !== null) return true;

    const center =
      getTokenCenter(token);

    const lookAtResult =
      callFirst(
        [api, api?.camera, api?.controls],
        ["lookAt", "target"],
        center.x,
        center.y,
        center.z
      );

    if (lookAtResult !== null) return true;

    warn(
      "No se encontro metodo para enfocar token en la API 3D detectada. Inspeccionar: game.Levels3DPreview, canvas.scene?.levels3d, canvas?.levels3d, game.modules.get(\"levels-3d-preview\")?.api."
    );

    return false;
  } catch (error) {
    warn("Error enfocando token 3D.", error);
    return false;
  }
}

export function followSelectedToken() {
  try {
    if (!is3DCanvasActive()) {
      warn("3D Canvas no esta activo. No se activo seguimiento.");
      return false;
    }

    game.mtrol3d._followEnabled = true;

    const foundryCanvas =
      globalThis.canvas ?? null;

    const token =
      foundryCanvas?.tokens?.controlled?.[0] ?? null;

    if (token) focusToken3D(token);

    return true;
  } catch (error) {
    warn("Error activando seguimiento 3D.", error);
    return false;
  }
}

export function stopFollowSelectedToken() {
  try {
    if (!is3DCanvasActive()) {
      warn("3D Canvas no esta activo. No se desactivo seguimiento 3D.");
      return false;
    }

    if (game.mtrol3d) {
      game.mtrol3d._followEnabled = false;
    }

    return true;
  } catch (error) {
    warn("Error desactivando seguimiento 3D.", error);
    return false;
  }
}

export function installMtrol3DApi() {
  try {
    game.mtrol3d = {
      isActive: is3DCanvasActive,
      setCameraPreset,
      resetCamera,
      followSelectedToken,
      stopFollowSelectedToken,
      focusToken3D,
      presets: MTROL_3D_CAMERA_PRESETS,
      _followEnabled: false
    };

    return true;
  } catch (error) {
    warn("No se pudo instalar game.mtrol3d.", error);
    return false;
  }
}
