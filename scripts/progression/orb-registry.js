export const MTROL_ORB_AUTOMATION_MODES = Object.freeze([
  "automatic",
  "conditional",
  "narrative"
]);

function defineOrb({
  id,
  name,
  passiveName,
  passiveDescription,
  automationMode
}) {
  return Object.freeze({
    id,
    name,
    passiveName,
    passiveDescription,
    automationMode,
    weaknesses: Object.freeze([])
  });
}

export const MTROL_ORB_REGISTRY = Object.freeze({
  ignis: defineOrb({
    id: "ignis",
    name: "Ignis",
    passiveName: "Calcinatio",
    passiveDescription: "+5% al daño de fuego.",
    automationMode: "automatic"
  }),
  aqua: defineOrb({
    id: "aqua",
    name: "Aqua",
    passiveName: "Vitalis",
    passiveDescription: "Regenera 5% de HP por turno dentro del agua.",
    automationMode: "conditional"
  }),
  terran: defineOrb({
    id: "terran",
    name: "Terran",
    passiveName: "Lapis",
    passiveDescription: "+5 Defensa Mágica estando sobre suelo.",
    automationMode: "conditional"
  }),
  aeris: defineOrb({
    id: "aeris",
    name: "Aeris",
    passiveName: "Conjugatio",
    passiveDescription: "+5 Esquiva.",
    automationMode: "automatic"
  }),
  animal: defineOrb({
    id: "animal",
    name: "Animal",
    passiveName: "Invocatio",
    passiveDescription: "+5 daño con criaturas.",
    automationMode: "conditional"
  }),
  corpus: defineOrb({
    id: "corpus",
    name: "Corpus",
    passiveName: "Corporis",
    passiveDescription: "Reduce 5% del daño físico total.",
    automationMode: "automatic"
  }),
  herban: defineOrb({
    id: "herban",
    name: "Herban",
    passiveName: "Viriditas",
    passiveDescription: "+5 a creación de Alquimia.",
    automationMode: "conditional"
  }),
  mentem: defineOrb({
    id: "mentem",
    name: "Mentem",
    passiveName: "Fragmentum",
    passiveDescription: "+5 a hechizos Sensoriales.",
    automationMode: "automatic"
  }),
  imagem: defineOrb({
    id: "imagem",
    name: "Imagem",
    passiveName: "Delusio",
    passiveDescription: "Reduce 5 puntos del daño mágico final.",
    automationMode: "automatic"
  }),
  gravitae: defineOrb({
    id: "gravitae",
    name: "Gravitae",
    passiveName: "Centrum",
    passiveDescription: "+5 a hechizos Destructivos.",
    automationMode: "automatic"
  }),
  protego: defineOrb({
    id: "protego",
    name: "Protego",
    passiveName: "Obice",
    passiveDescription: "+5 Defensa Física y +5 Defensa Mágica.",
    automationMode: "conditional"
  }),
  ulghur: defineOrb({
    id: "ulghur",
    name: "Ulghur",
    passiveName: "Anima",
    passiveDescription: "+1 turno por ronda a voluntad.",
    automationMode: "narrative"
  }),
  oscuritae: defineOrb({
    id: "oscuritae",
    name: "Oscuritae",
    passiveName: "Vis Mortem",
    passiveDescription: "+5% daño; la resurrección y pérdida del Orbe son narrativas.",
    automationMode: "automatic"
  }),
  lux: defineOrb({
    id: "lux",
    name: "Lux",
    passiveName: "Vis Vitae",
    passiveDescription: "Permite resurrecciones bajo resolución narrativa del GM.",
    automationMode: "narrative"
  }),
  portal: defineOrb({
    id: "portal",
    name: "Portal",
    passiveName: "Vis Interstitium",
    passiveDescription: "Las marcas colocadas en objetivos se vuelven permanentes.",
    automationMode: "narrative"
  }),
  tempus: defineOrb({
    id: "tempus",
    name: "Tempus",
    passiveName: "Vis Momentum",
    passiveDescription: "Convierte un espacio en un ámbito fuera del tiempo.",
    automationMode: "narrative"
  })
});

export const MTROL_ORB_IDS =
  Object.freeze(Object.keys(MTROL_ORB_REGISTRY));

export const MTROL_ORB_LEVEL_NAMES = Object.freeze({
  1: "Latente",
  2: "Despertado",
  3: "Resonante",
  4: "Ancestral",
  5: "Primordial"
});

export function getOrbDefinition(orbType) {
  return MTROL_ORB_REGISTRY[orbType] ?? null;
}

export function getOrbLevelName(level) {
  return MTROL_ORB_LEVEL_NAMES[Number(level)] ?? "";
}
