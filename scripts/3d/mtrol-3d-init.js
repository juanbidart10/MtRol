import {
  focusToken3D,
  installMtrol3DApi,
  is3DCanvasActive
} from "./mtrol-3d-camera.js";

export function initMtrol3D() {
  installMtrol3DApi();

  Hooks.once("ready", () => {
    if (!is3DCanvasActive()) {
      console.warn(
        "MTROL 3D | 3D Canvas no esta activo. La capa 3D queda en modo seguro."
      );
      return;
    }

    console.log("MTROL 3D | 3D Canvas detectado. Camara experimental lista.");
  });

  Hooks.on("controlToken", (token, controlled) => {
    if (!controlled) return;
    if (!game.mtrol3d?._followEnabled) return;

    focusToken3D(token);
  });
}
