export const MTROL_3D_MODULE_ID = "levels-3d-preview";

export const MTROL_3D_CAMERA_PRESETS = {
  isometric: {
    label: "Isometrica",
    distanceMultiplier: 8,
    rotation: Math.PI / 4,
    heightRatio: 0.68,
    horizontalRatio: 1,
    zoom: 1,
    speed: 0.05
  },
  combat: {
    label: "Combate",
    distanceMultiplier: 17,
    rotation: Math.PI / 4,
    heightRatio: 1.55,
    horizontalRatio: 0.72,
    zoom: 0.95,
    speed: 0.05
  },
  top: {
    label: "Cenital",
    distanceMultiplier: 24,
    rotation: 0,
    heightRatio: 1,
    horizontalRatio: 0,
    topOffsetRatio: 0.01,
    zoom: 1,
    speed: 0.05,
    topdown: true
  },
  close: {
    label: "Cercana",
    distanceMultiplier: 2.2,
    rotation: Math.PI / 4,
    heightRatio: 0.42,
    horizontalRatio: 0.78,
    zoom: 1.25,
    speed: 0.06
  },
  tactical: {
    label: "Tactica Legacy",
    alias: "combat",
    distanceMultiplier: 17,
    rotation: Math.PI / 4,
    heightRatio: 1.55,
    horizontalRatio: 0.72,
    zoom: 0.95,
    speed: 0.05
  }
};
