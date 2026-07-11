export const MTROL_3D_CAMERA_SETTING_KEYS = {
  defaultView: "default3DCameraView",
  autoFollow: "autoFollow3DCamera",
  applyOnSceneLoad: "apply3DCameraOnSceneLoad",
  showNotifications: "show3DCameraNotifications"
};

export const MTROL_3D_VISUAL_SETTING_KEYS = {
  visualPreset: "visualPreset3D",
  applyOnSceneLoad: "applyVisualPresetOnSceneLoad"
};

export const MTROL_3D_CAMERA_VIEW_CHOICES = {
  isometric: "Isometrica",
  combat: "Combate",
  close: "Cercana",
  top: "Cenital"
};

export const MTROL_3D_VISUAL_PRESET_CHOICES = {
  softShadows: "Sombras suaves 2.5D",
  performance: "Rendimiento",
  cinematic: "Cinematica",
  none: "Ninguno"
};

const SYSTEM_ID = "mtrol";

function getSetting(key, fallback) {
  try {
    return game.settings.get(SYSTEM_ID, key);
  } catch (error) {
    console.warn(`MTROL 3D | No se pudo leer setting ${key}.`, error);
    return fallback;
  }
}

export function registerMtrol3DCameraSettings() {
  game.settings.register(SYSTEM_ID, MTROL_3D_CAMERA_SETTING_KEYS.defaultView, {
    name: "MTROL 3D | Vista de camara predeterminada",
    hint: "Preset de camara 3D que se aplica para este usuario.",
    scope: "client",
    config: true,
    type: String,
    choices: MTROL_3D_CAMERA_VIEW_CHOICES,
    default: "isometric"
  });

  game.settings.register(SYSTEM_ID, MTROL_3D_CAMERA_SETTING_KEYS.autoFollow, {
    name: "MTROL 3D | Seguir token automaticamente",
    hint: "Al aplicar la vista predeterminada, la camara intenta seguir el token seleccionado.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(SYSTEM_ID, MTROL_3D_CAMERA_SETTING_KEYS.applyOnSceneLoad, {
    name: "MTROL 3D | Aplicar camara al cargar escena",
    hint: "Aplica la vista 3D predeterminada cuando este usuario entra a una escena con Canvas 3D activo.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(SYSTEM_ID, MTROL_3D_CAMERA_SETTING_KEYS.showNotifications, {
    name: "MTROL 3D | Mostrar notificaciones de camara",
    hint: "Muestra avisos suaves al usar hotkeys y preferencias de camara.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
}

export function registerMtrol3DVisualSettings() {
  game.settings.register(SYSTEM_ID, MTROL_3D_VISUAL_SETTING_KEYS.visualPreset, {
    name: "MTROL 3D | Preset visual",
    hint: "Preset visual 2.5D usado para previews locales de Canvas 3D.",
    scope: "client",
    config: true,
    type: String,
    choices: MTROL_3D_VISUAL_PRESET_CHOICES,
    default: "softShadows"
  });

  game.settings.register(SYSTEM_ID, MTROL_3D_VISUAL_SETTING_KEYS.applyOnSceneLoad, {
    name: "MTROL 3D | Previsualizar preset visual al cargar escena",
    hint: "Aplica el preset visual elegido como preview local al entrar a una escena. No guarda cambios permanentes.",
    scope: "client",
    config: true,
    type: Boolean,
    default: false
  });
}

export function getMtrol3DCameraPreferences() {
  const defaultView =
    getSetting(MTROL_3D_CAMERA_SETTING_KEYS.defaultView, "isometric");

  return {
    defaultView: MTROL_3D_CAMERA_VIEW_CHOICES[defaultView] ? defaultView : "isometric",
    autoFollow: Boolean(getSetting(MTROL_3D_CAMERA_SETTING_KEYS.autoFollow, true)),
    applyOnSceneLoad: Boolean(getSetting(MTROL_3D_CAMERA_SETTING_KEYS.applyOnSceneLoad, true)),
    showNotifications: Boolean(getSetting(MTROL_3D_CAMERA_SETTING_KEYS.showNotifications, true))
  };
}

export async function setMtrolDefault3DCameraView(viewName) {
  if (!MTROL_3D_CAMERA_VIEW_CHOICES[viewName]) return false;

  await game.settings.set(
    SYSTEM_ID,
    MTROL_3D_CAMERA_SETTING_KEYS.defaultView,
    viewName
  );

  return true;
}

export function getMtrol3DVisualPreferences() {
  const visualPreset =
    getSetting(MTROL_3D_VISUAL_SETTING_KEYS.visualPreset, "softShadows");

  return {
    visualPreset: MTROL_3D_VISUAL_PRESET_CHOICES[visualPreset] ? visualPreset : "softShadows",
    applyOnSceneLoad: Boolean(getSetting(MTROL_3D_VISUAL_SETTING_KEYS.applyOnSceneLoad, false))
  };
}

export function notifyMtrol3DCamera(message, type = "info") {
  if (!getMtrol3DCameraPreferences().showNotifications) return;

  const notifications =
    globalThis.ui?.notifications ?? null;

  const notify =
    notifications?.[type] ?? notifications?.info;

  if (typeof notify === "function") {
    notify.call(notifications, message);
  }
}
