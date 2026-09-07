const DEFINITIONS = [
  ["Apuñalar", "apunalar"],
  ["Combate con Armas", "combate_con_armas"],
  ["Combate sin Armas", "combate_sin_armas"],
  ["Combate a Distancia", "combate_a_distancia"],
  ["Defensa con Escudos", "defensa_con_escudos"],
  ["Evasión", "evasion"],
  ["Clarividencia", "clarividencia"],
  ["Cosmología", "cosmologia"],
  ["Magia", "magia"],
  ["Necromancia", "necromancia"],
  ["Meditar", "meditar"],
  ["Simbología", "simbologia"],
  ["Carpintería", "carpinteria"],
  ["Cocina", "cocina"],
  ["Comercio", "comercio"],
  ["Estructuras", "estructuras"],
  ["Herrería", "herreria"],
  ["Joyería", "joyeria"],
  ["Robótica", "robotica"],
  ["Sastrería", "sastreria"],
  ["Transportes", "transportes"],
  ["Alquimia", "alquimia"],
  ["Medicina", "medicina"],
  ["Domar", "domar"],
  ["Orientación", "orientacion"],
  ["Cacería", "caceria"],
  ["Recolección", "recoleccion"],
  ["Trampería", "tramperia"],
  ["Buceo", "buceo"],
  ["Cartografía", "cartografia"],
  ["Monturas", "monturas"],
  ["Arqueología", "arqueologia"],
  ["Supervivencia", "supervivencia"],
  ["Botánica", "botanica"],
  ["Interpretación", "interpretacion"],
  ["Higiene", "higiene"],
  ["Bebidas", "bebidas"],
  ["Etiqueta", "etiqueta"],
  ["Historia", "historia"],
  ["Hacking", "hacking"],
  ["Investigar", "investigar"],
  ["Mitología", "mitologia"],
  ["Música", "musica"],
  ["Ocultarse", "ocultarse"],
  ["Política", "politica"],
  ["Robar", "robar"]
];

export const MTROL_COMPETENCY_CATALOG = Object.freeze(
  DEFINITIONS.map(([name, technicalId]) => Object.freeze({ name, technicalId }))
);

export const MTROL_COMPETENCY_TECHNICAL_IDS = Object.freeze(
  MTROL_COMPETENCY_CATALOG.map(entry => entry.technicalId)
);

const TECHNICAL_IDS = new Set(MTROL_COMPETENCY_TECHNICAL_IDS);

const LEVEL_FORMULAS = Object.freeze({
  1: "1d4 + 1",
  2: "1d6 + 2",
  3: "1d8 + 3",
  4: "1d10 + 4",
  5: "1d12 + 5"
});

export function normalizeCanonicalCompetencyName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .trim()
    .replace(/\s+/g, " ");
}

const TECHNICAL_ID_BY_NAME = new Map(
  MTROL_COMPETENCY_CATALOG.map(entry => [
    normalizeCanonicalCompetencyName(entry.name),
    entry.technicalId
  ])
);

export function isCanonicalCompetencyTechnicalId(value) {
  return typeof value === "string" && TECHNICAL_IDS.has(value.trim());
}

export function getCanonicalCompetencyDefinition(technicalId) {
  const normalized = String(technicalId ?? "").trim();
  return MTROL_COMPETENCY_CATALOG.find(entry => entry.technicalId === normalized) ?? null;
}

export function getCanonicalTechnicalIdByName(value) {
  return TECHNICAL_ID_BY_NAME.get(normalizeCanonicalCompetencyName(value)) ?? null;
}

export function getCompetencyFormula(level) {
  const numericLevel = Number(level);
  if (!Number.isInteger(numericLevel)) return null;
  return LEVEL_FORMULAS[numericLevel] ?? null;
}
