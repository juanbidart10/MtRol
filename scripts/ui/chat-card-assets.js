const unresolvedFamilyAudit = new Set();

export const MTROL_CARD_ASSETS = Object.freeze({
  spell: "systems/mtrol/assets/ui/chat/cards-premium/v10/spell.png",
  damagePhysical: "systems/mtrol/assets/ui/chat/cards-premium/v10/damage-physical.png",
  critical: "systems/mtrol/assets/ui/chat/cards-premium/v10/critical.png",
  attack: "systems/mtrol/assets/ui/chat/cards-premium/v10/attack.png",
  defense: "systems/mtrol/assets/ui/chat/cards-premium/v10/defense.png",
  fumble: "systems/mtrol/assets/ui/chat/cards-premium/v10/fumble.png"
});

export const MTROL_DESTINY_CARD_ASSETS = Object.freeze({
  dharma: "systems/mtrol/assets/ui/chat/cards-premium/v3/special/dharma-card.png",
  karma: "systems/mtrol/assets/ui/chat/cards-premium/v3/special/karma-card.png"
});

export function resolveMtrolDestinyCardAsset(type) {
  const normalized = String(type ?? "").trim().toLowerCase();
  return MTROL_DESTINY_CARD_ASSETS[normalized] ?? null;
}

export const MTROL_CARD_FAMILIES = Object.freeze([
  "attack", "defense", "damagePhysical", "spell"
]);

export const MTROL_CARD_STATES = Object.freeze(["normal", "critical", "fumble"]);

export const MTROL_CARD_FAMILY_LABELS = Object.freeze({
  attack: "Ataque",
  defense: "Defensa",
  damagePhysical: "Daño físico",
  spell: "Hechizo"
});

const ATTACK_ACTIONS = new Set([
  "attack", "basicattack", "combatskill", "counterattack", "contraataque",
  "combate", "basico", "offense", "ofensiva"
]);

const DEFENSE_ACTIONS = new Set([
  "defense", "defensa", "block", "bloqueo", "dodge", "esquiva", "parry"
]);

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function includesAny(values, candidates) {
  return values.some(value => candidates.has(value));
}

function warnUnclassifiedFamily(value) {
  const unresolved = String(value ?? "").trim() || "(sin clasificación)";
  if (unresolvedFamilyAudit.has(unresolved)) return;

  unresolvedFamilyAudit.add(unresolved);
  console.warn(
    `MTROL | Familia de card no clasificada: ${unresolved}. Se usa attack como fallback visual.`
  );
}

export function normalizeMtrolCardFamily(family) {
  const normalized = normalizeText(family);
  const aliases = {
    damage: "damagePhysical",
    damagephysical: "damagePhysical",
    "damage-physical": "damagePhysical",
    dano: "damagePhysical",
    danio: "damagePhysical",
    "dano-fisico": "damagePhysical",
    "danio-fisico": "damagePhysical"
  };
  const resolved = aliases[normalized] ?? normalized;

  if (MTROL_CARD_FAMILIES.includes(resolved)) return resolved;
  warnUnclassifiedFamily(family);
  return "attack";
}

export function getMtrolCardAssetAudit() {
  return Array.from(unresolvedFamilyAudit);
}

export function resolveMtrolCardState({
  state = "normal",
  critical = false,
  fumble = false
} = {}) {
  if (fumble === true || state === "fumble") return "fumble";
  if (critical === true || state === "critical") return "critical";
  return "normal";
}

export function resolveMtrolCardAsset({
  family = "attack",
  state = "normal",
  critical = false,
  fumble = false
} = {}) {
  const safeState = resolveMtrolCardState({ state, critical, fumble });
  if (safeState === "fumble") return MTROL_CARD_ASSETS.fumble;
  if (safeState === "critical") return MTROL_CARD_ASSETS.critical;

  return MTROL_CARD_ASSETS[normalizeMtrolCardFamily(family)] ?? MTROL_CARD_ASSETS.attack;
}

export function formatMtrolCardFormula(formula) {
  const source = String(formula ?? "").trim();
  if (!source) return "";

  return source
    .replace(/\b(\d*)[dD](\d+)\b/g, (_match, count, faces) => `${count}D${faces}`)
    .replace(/\s*(\*\*|[+\-*/%])\s*/g, " $1 ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleUpperCase("es");
}

function normalizeDharmaTrace(trace = {}) {
  const termIndex = Number(trace.termIndex);
  const resultIndex = Number(trace.resultIndex);
  const faces = Number(trace.faces);
  const naturalResult = Number(trace.naturalResult);
  const effectiveResult = Number(trace.effectiveResult);
  const finalResult = trace.finalResult === null
    ? null
    : Number(trace.finalResult);

  if (
    !Number.isInteger(termIndex) || termIndex < 0 ||
    !Number.isInteger(resultIndex) || resultIndex < 0 ||
    !Number.isInteger(faces) || faces < 1 ||
    !Number.isInteger(naturalResult)
  ) return null;

  return {
    termIndex,
    resultIndex,
    faces,
    naturalResult,
    effectiveResult: Number.isFinite(effectiveResult) ? effectiveResult : naturalResult,
    finalResult: Number.isFinite(finalResult) ? finalResult : null,
    fumblePrevented: trace.fumblePrevented === true,
    naturalCritical: trace.naturalCritical === true,
    criticalResolvedResult: trace.criticalResolvedResult !== null &&
      trace.criticalResolvedResult !== undefined &&
      Number.isFinite(Number(trace.criticalResolvedResult))
      ? Number(trace.criticalResolvedResult)
      : null,
    dharmaBonus: Number(trace.dharmaBonus ?? 0),
    dharmaBonusAfterCritical: Number(trace.dharmaBonusAfterCritical ?? 0)
  };
}

function normalizeDharmaMetadata(dharma) {
  if (!dharma || !Array.isArray(dharma.traces)) return null;

  const traces = dharma.traces
    .map(normalizeDharmaTrace)
    .filter(Boolean);
  const used = Number(dharma.used);

  if (!Number.isInteger(used) || used < 1 || traces.length !== used) {
    return null;
  }

  return {
    used,
    traces
  };
}

function normalizeOrbBonusMetadata(orbBonus) {
  if (!orbBonus || Number(orbBonus.bonus) <= 0) return null;
  const level = Number(orbBonus.level);
  const bonus = Number(orbBonus.bonus);
  if (!orbBonus.type || !orbBonus.name || !Number.isInteger(level)) return null;
  if (![2, 5].includes(bonus)) return null;

  return {
    type: String(orbBonus.type),
    name: String(orbBonus.name),
    level,
    levelName: String(orbBonus.levelName ?? ""),
    bonus
  };
}

function normalizeOrbPassiveBonusMetadata(passiveBonus) {
  if (!passiveBonus || Number(passiveBonus.bonus) <= 0) return null;
  const sources = Array.from(passiveBonus.sources ?? [])
    .filter(source => source?.orbType && source?.passiveName && Number(source?.bonus) === 5)
    .map(source => ({
      orbType: String(source.orbType),
      passiveName: String(source.passiveName),
      bonus: 5
    }));
  const bonus = sources.reduce((sum, source) => sum + source.bonus, 0);
  if (bonus !== Number(passiveBonus.bonus)) return null;
  return { bonus, sources };
}

export function classifyMtrolCardFamily(context = {}) {
  const explicit = normalizeText(context.family);
  if (explicit) return normalizeMtrolCardFamily(explicit);

  const actionType = normalizeText(context.actionType ?? context.item?.system?.actionType);
  const defenseType = normalizeText(context.defenseType ?? context.item?.system?.defenseType);
  const effect = normalizeText(context.effect ?? context.item?.system?.effect);
  const category = normalizeText(
    context.category ?? context.categoria ?? context.item?.system?.categoria
  );
  const type = normalizeText(context.type ?? context.item?.type);

  if (
    actionType === "spell" || type === "spell" ||
    ["spell", "hechizo", "magia"].includes(category)
  ) return "spell";

  if (
    actionType === "damage" || effect === "damage" ||
    ["damage", "damagephysical", "dano", "danio", "dano-fisico", "danio-fisico", "localizacion"].includes(category)
  ) return "damagePhysical";

  if (
    includesAny([actionType, defenseType, category], DEFENSE_ACTIONS) ||
    ["shield", "resistance", "will"].includes(defenseType)
  ) return "defense";

  if (includesAny([actionType, category], ATTACK_ACTIONS)) return "attack";

  warnUnclassifiedFamily(
    context.family ?? actionType ?? category ?? type ?? "(sin clasificación)"
  );
  return "attack";
}

export function buildMtrolCardMetadata(data = {}, rolls = []) {
  const normalizedRolls = Array.isArray(rolls)
    ? rolls.filter(Boolean)
    : rolls
      ? [rolls]
      : [];
  const firstRoll = normalizedRolls[0] ?? null;
  const family = classifyMtrolCardFamily(data);
  const rawFormula = String(
    data.rawFormula ?? data.formula ?? firstRoll?.formula ?? ""
  );

  const metadata = {
    version: 10,
    family,
    state: resolveMtrolCardState(data),
    title: String(data.title ?? data.label ?? "Tirada MtROL"),
    category: String(data.categoryLabel ?? MTROL_CARD_FAMILY_LABELS[family]),
    rawFormula,
    formula: formatMtrolCardFormula(rawFormula),
    total: data.total ?? firstRoll?.total ?? null,
    rollCount: normalizedRolls.length
  };

  const dharma = normalizeDharmaMetadata(data.dharma);
  if (dharma) metadata.dharma = dharma;

  const orbBonus = normalizeOrbBonusMetadata(data.orbBonus);
  if (orbBonus) metadata.orbBonus = orbBonus;

  const orbPassiveBonus = normalizeOrbPassiveBonusMetadata(data.orbPassiveBonus);
  if (orbPassiveBonus) metadata.orbPassiveBonus = orbPassiveBonus;

  return metadata;
}
