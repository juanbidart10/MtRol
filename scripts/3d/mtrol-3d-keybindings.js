import {
  notifyMtrol3DCamera
} from "./mtrol-3d-settings.js";

const SYSTEM_ID = "mtrol";
const ALT_MODIFIER = "Alt";

function getCameraApi(actionName) {
  const cameraApi =
    game.mtrol3d?.camera ?? null;

  if (!cameraApi) {
    notifyMtrol3DCamera("MTROL 3D | API de camara no disponible.", "warn");
    console.warn("MTROL 3D | API de camara no disponible.");
    return null;
  }

  if (!game.mtrol3d?.isActive?.()) {
    notifyMtrol3DCamera(`MTROL 3D | Canvas 3D no esta activo para ${actionName}.`, "warn");
    return null;
  }

  return cameraApi;
}

function registerCameraKeybinding(name, label, key, onDown) {
  game.keybindings.register(SYSTEM_ID, name, {
    name: label,
    hint: "Atajo de camara 3D de MTROL.",
    editable: [
      {
        key,
        modifiers: [ALT_MODIFIER]
      }
    ],
    restricted: false,
    onDown,
    precedence: globalThis.CONST?.KEYBINDING_PRECEDENCE?.NORMAL
  });
}

function runCameraAction(actionName, callback) {
  const cameraApi =
    getCameraApi(actionName);

  if (!cameraApi) return true;

  callback(cameraApi);
  return true;
}

export function registerMtrol3DCameraKeybindings() {
  registerCameraKeybinding(
    "cameraIsometric",
    "MTROL 3D | Camara isometrica",
    "KeyI",
    () => runCameraAction("camara isometrica", camera => camera.isometric())
  );

  registerCameraKeybinding(
    "cameraCombat",
    "MTROL 3D | Camara de combate",
    "KeyC",
    () => runCameraAction("camara de combate", camera => camera.combat())
  );

  registerCameraKeybinding(
    "cameraClose",
    "MTROL 3D | Camara cercana",
    "KeyV",
    () => runCameraAction("camara cercana", camera => camera.close())
  );

  registerCameraKeybinding(
    "cameraTop",
    "MTROL 3D | Camara cenital",
    "KeyT",
    () => runCameraAction("camara cenital", camera => camera.top())
  );

  registerCameraKeybinding(
    "cameraToggleFollow",
    "MTROL 3D | Alternar seguimiento",
    "KeyF",
    () => runCameraAction("seguimiento", camera => camera.toggleFollow())
  );

  registerCameraKeybinding(
    "cameraReset",
    "MTROL 3D | Reset camara",
    "KeyR",
    () => runCameraAction("reset de camara", camera => camera.reset())
  );

  registerCameraKeybinding(
    "cameraSaveDefault",
    "MTROL 3D | Guardar vista predeterminada",
    "KeyS",
    () => runCameraAction("guardar vista predeterminada", camera => camera.saveCurrentAsDefault())
  );
}
