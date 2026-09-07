const PASSIVE_SOURCE = [
  {
    technicalId: "prodigio", displayName: "Prodigio", sourceRaceId: "humano", unlockLevel: 1,
    description: "Puede aprender Competencias al doble de velocidad.",
    effects: [{
      type: "COMPETENCY_PROGRESSION_MULTIPLIER", multiplier: 2,
      subject: "source", priority: 100, applicationScope: "self", polarity: "beneficial"
    }]
  },
  {
    technicalId: "comunicacion_animal", displayName: "Comunicación Animal", sourceRaceId: "elfo", unlockLevel: 1,
    description: "Puede hablar con animales.",
    effects: [{
      type: "CAPABILITY", capability: "speak_with_animals", mode: "narrative",
      requiresGmResolution: true, displayName: "Comunicación Animal",
      description: "Intento comunicarme con un animal. El GM decide si es posible y qué responde."
    }]
  },
  {
    technicalId: "maldito_alimentacion", displayName: "Maldito", sourceRaceId: "elfo_oscuro", unlockLevel: 1,
    description: "Se alimenta de seres vivos, robando juventud y HP para recuperarse; cantidades, límites y consecuencias a criterio del GM.",
    effects: [{
      type: "CAPABILITY", capability: "feed_on_living_being", mode: "narrative",
      requiresGmResolution: true, displayName: "Alimentarse",
      description: "Intento alimentarme de un ser vivo. El GM determina cantidades, límites y consecuencias; no se recuperan recursos automáticamente."
    }]
  },
  {
    technicalId: "inquebrantable", displayName: "Inquebrantable", sourceRaceId: "enano", unlockLevel: 1,
    description: "Reduce daño en combate según Resistencia.",
    effects: [{
      type: "FLAT_DAMAGE_REDUCTION_FROM_ATTRIBUTE", attribute: "resistencia", multiplier: 2,
      subject: "target", requiresCombat: true, priority: 100
    }]
  },
  {
    technicalId: "sed_de_batalla", displayName: "Sed de Batalla", sourceRaceId: "orco", unlockLevel: 2,
    description: "La Fuerza aumenta ×1.5 al calcular daño en combate.",
    effects: [{
      type: "ATTRIBUTE_DAMAGE_MULTIPLIER", attribute: "fuerza", multiplier: 1.5,
      subject: "source", requiresCombat: true, priority: 100
    }]
  },
  {
    technicalId: "elemental", displayName: "Elemental", sourceRaceId: "gnomo", unlockLevel: 2,
    description: "El Aura aumenta ×1.5 al calcular daño.",
    effects: [{
      type: "ATTRIBUTE_DAMAGE_MULTIPLIER", attribute: "aura", multiplier: 1.5,
      subject: "source", requiresCombat: false, priority: 100
    }]
  },
  {
    technicalId: "anima", displayName: "Ánima", sourceRaceId: "sellado", unlockLevel: 2,
    description: "Puede desarmar y malear su propio cuerpo.",
    effects: [{
      type: "CAPABILITY", capability: "reshape_own_body", mode: "narrative",
      requiresGmResolution: true, displayName: "Ánima",
      description: "Intento modificar mi propio cuerpo con Ánima. El GM decide el resultado narrativo."
    }]
  },
  {
    technicalId: "frenesi", displayName: "Frenesí", sourceRaceId: "draconiano", unlockLevel: 2,
    description: "Si HP baja al 25%, las tiradas se multiplican ×2.", gmNote: true,
    effects: [{
      type: "CONDITIONAL_ROLL_MULTIPLIER", condition: "hpPercentage <= 0.25", multiplier: 2,
      subject: "source", priority: 100
    }]
  },
  {
    technicalId: "instinto_racial", displayName: "Instinto", sourceRaceId: "animalium", unlockLevel: 3,
    description: "Mejora la iniciativa y permite detectar objetivos ocultos.",
    effects: [
      { type: "INITIATIVE_BONUS", value: 10, subject: "source", priority: 100 },
      {
        type: "CAPABILITY", capability: "see_hidden_targets", mode: "narrative",
        requiresGmResolution: true, displayName: "Detectar Ocultos",
        description: "Intento detectar objetivos ocultos. Sólo el GM decide qué información revelar."
      }
    ]
  },
  {
    technicalId: "virtus", displayName: "Virtus", sourceRaceId: "hada", unlockLevel: 3,
    description: "Permite volar y convierte daño de Aura en MP.",
    effects: [
      {
        type: "CAPABILITY", capability: "flight", mode: "narrative",
        requiresGmResolution: true, displayName: "Vuelo",
        description: "Intento utilizar Vuelo. El GM decide cómo se representa, sin movimiento o altura automáticos."
      },
      {
        type: "DAMAGE_TO_RESOURCE", damageSourceAttribute: "aura", resource: "mp",
        percentage: 0.10, subject: "source", priority: 100,
        applicationScope: "self", polarity: "beneficial"
      }
    ]
  },
  {
    technicalId: "maldicion", displayName: "Maldición", sourceRaceId: "maldito", unlockLevel: 3,
    description: "Absorbe daño como HP propio y permite posesión.", tags: ["curse"],
    effects: [
      {
        type: "DAMAGE_TO_RESOURCE", resource: "hp", percentage: 0.25,
        subject: "source", priority: 100, applicationScope: "self",
        polarity: "beneficial", tags: ["curse"]
      },
      { type: "CAPABILITY", capability: "possession" }
    ]
  },
  {
    technicalId: "bendicion", displayName: "Bendición", sourceRaceId: "bendito", unlockLevel: 3,
    description: "Otorga inmunidad a pasivas raciales y maldiciones.",
    effects: [{
      type: "EFFECT_IMMUNITY",
      subject: "source",
      priority: 100,
      applicationScope: "self",
      polarity: "beneficial",
      protectedApplicationScope: "target",
      protectedPolarity: "hostile",
      filters: [{ sourceCategory: "racialPassive" }, { tag: "curse" }]
    }]
  },
  {
    technicalId: "trascendental", displayName: "Trascendental", sourceRaceId: "espectral", unlockLevel: 3,
    description: "Revive como Sellado, con recarga de 10 partidas, y permite posesión.",
    effects: [
      { type: "REVIVE" },
      { type: "RACE_TRANSFORMATION", targetRaceId: "sellado" },
      { type: "STATEFUL_COOLDOWN", value: 10, unit: "sessions" },
      { type: "CAPABILITY", capability: "possession" }
    ]
  },
  {
    technicalId: "subyugador", displayName: "Subyugador", sourceRaceId: "oscuro", unlockLevel: 4,
    description: "Concede un slot adicional de Despertar a elección.",
    effects: [{
      type: "GRANT_AWAKENING_SLOT", value: 1, additional: true,
      subject: "source", priority: 100, applicationScope: "self", polarity: "beneficial"
    }]
  },
  {
    technicalId: "celestial", displayName: "Celestial", sourceRaceId: "iluminado", unlockLevel: 4,
    description: "Concede un slot adicional de Despertar a elección.",
    effects: [{
      type: "GRANT_AWAKENING_SLOT", value: 1, additional: true,
      subject: "source", priority: 100, applicationScope: "self", polarity: "beneficial"
    }]
  },
  {
    technicalId: "infinito", displayName: "Infinito", sourceRaceId: "eterno", unlockLevel: 5,
    description: "Duplica estadísticas al subir de nivel y declara cap de atributos 10.",
    effects: [
      {
        type: "PROGRESSION_MULTIPLIER", multiplier: 2,
        subject: "source", priority: 100, applicationScope: "self", polarity: "beneficial"
      },
      {
        type: "ATTRIBUTE_CAP_OVERRIDE", value: 10,
        subject: "source", priority: 100, applicationScope: "self", polarity: "beneficial"
      }
    ]
  }
];

function freezeDefinition(definition) {
  return Object.freeze({
    ...definition,
    tags: Object.freeze([...(definition.tags ?? [])]),
    effects: Object.freeze(definition.effects.map(effect => Object.freeze({
      ...effect,
      ...(effect.resources ? { resources: Object.freeze([...effect.resources]) } : {}),
      ...(effect.tags ? { tags: Object.freeze([...effect.tags]) } : {}),
      ...(effect.filters ? {
        filters: Object.freeze(effect.filters.map(filter => Object.freeze({ ...filter })))
      } : {})
    })))
  });
}

const PASSIVE_DEFINITIONS = Object.freeze(PASSIVE_SOURCE.map(freezeDefinition));

export const MTROL_RACIAL_PASSIVE_IDS = Object.freeze(
  PASSIVE_DEFINITIONS.map(definition => definition.technicalId)
);

export const MTROL_RACIAL_PASSIVE_CATALOG = Object.freeze(Object.fromEntries(
  PASSIVE_DEFINITIONS.map(definition => [definition.technicalId, definition])
));

export function getRacialPassiveDefinition(technicalId) {
  return MTROL_RACIAL_PASSIVE_CATALOG[String(technicalId ?? "").trim()] ?? null;
}

export function getAllRacialPassiveDefinitions() {
  return PASSIVE_DEFINITIONS;
}
