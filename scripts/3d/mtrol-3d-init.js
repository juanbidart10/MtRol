import {
  installMtrol3DApi,
  is3DCanvasActive,
  refreshFollowTarget
} from "./mtrol-3d-camera.js";
import { updateTokenDispatcher } from "../core/hook-dispatcher.js";
import { logger } from "../utils/logger.js";

import {
  getMtrol3DCameraPreferences,
  getMtrol3DVisualPreferences,
  registerMtrol3DCameraSettings,
  registerMtrol3DVisualSettings
} from "./mtrol-3d-settings.js";

import {
  registerMtrol3DCameraKeybindings
} from "./mtrol-3d-keybindings.js";

import {
  applyConfiguredVisualPreview,
  installMtrol3DVisualApi
} from "./mtrol-3d-visual.js";

let applyDefaultTimeout = null;
let applyVisualTimeout = null;

function scheduleApplyDefaultCamera() {
  const preferences =
    getMtrol3DCameraPreferences();

  if (!preferences.applyOnSceneLoad) return;

  if (applyDefaultTimeout) {
    globalThis.clearTimeout(applyDefaultTimeout);
  }

  applyDefaultTimeout = globalThis.setTimeout(() => {
    applyDefaultTimeout = null;

    if (!is3DCanvasActive()) return;

    game.mtrol3d?.camera?.applyDefault?.({
      reason: "scene-load"
    });
  }, 750);
}

function scheduleApplyVisualPreset() {
  const preferences =
    getMtrol3DVisualPreferences();

  if (!preferences.applyOnSceneLoad) return;

  if (applyVisualTimeout) {
    globalThis.clearTimeout(applyVisualTimeout);
  }

  applyVisualTimeout = globalThis.setTimeout(() => {
    applyVisualTimeout = null;

    if (!is3DCanvasActive()) return;

    applyConfiguredVisualPreview();
  }, 900);
}

export function initMtrol3D() {
  registerMtrol3DCameraSettings();
  registerMtrol3DVisualSettings();
  registerMtrol3DCameraKeybindings();
  installMtrol3DApi();
  installMtrol3DVisualApi();

  Hooks.once("ready", () => {
    if (!is3DCanvasActive()) {
      logger.warn("3D", "3D Canvas inactive; safe mode enabled", {
        status: "safe-mode",
        reasonCode: "CANVAS_3D_INACTIVE"
      });
      return;
    }

    logger.debug("3D", "3D Canvas detected; camera ready");
  });

  Hooks.on("canvasReady", () => {
    scheduleApplyDefaultCamera();
    scheduleApplyVisualPreset();
  });

  Hooks.on("3DCanvasSceneReady", () => {
    scheduleApplyDefaultCamera();
    scheduleApplyVisualPreset();
  });

  Hooks.on("controlToken", (token, controlled) => {
    if (!controlled) return;
    if (!game.mtrol3d?.camera?.getState()?.followEnabled) return;

    refreshFollowTarget(token);
  });

  updateTokenDispatcher.subscribe("3d.follow-token", (tokenDocument, changes) => {
    if (!game.mtrol3d?.camera?.getState()?.followEnabled) return;
    if (!("x" in changes) && !("y" in changes) && !("elevation" in changes)) return;

    refreshFollowTarget(tokenDocument?.object ?? null);
  }, { priority: 300, critical: false });
}
