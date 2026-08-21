import {
  getOrbDefinition,
  getOrbLevelName
} from "./orb-registry.js";

export function getOrbLevelRollBonus(level) {
  if (Number(level) === 5) return 5;
  if (Number(level) === 4) return 2;
  return 0;
}

export function resolveSpellOrbRollBonus(actor, item) {
  const empty = {
    type: null,
    name: null,
    level: null,
    levelName: null,
    bonus: 0
  };

  if (item?.type !== "competencia") return empty;
  if (String(item.system?.categoria ?? "").trim().toLowerCase() !== "hechizo") {
    return empty;
  }

  const type = String(item.system?.orbType ?? "").trim().toLowerCase();
  const definition = getOrbDefinition(type);
  if (!definition) return empty;

  const ownedOrb = Array.from(actor?.system?.orbs ?? [])
    .find(orb => orb?.type === type) ?? null;
  if (!ownedOrb) return empty;

  const level = Number(ownedOrb.level);
  return {
    type,
    name: definition.name,
    level,
    levelName: getOrbLevelName(level),
    bonus: getOrbLevelRollBonus(level)
  };
}
