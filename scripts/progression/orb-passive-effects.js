function ownedOrbTypes(actor) {
  return new Set(
    Array.from(actor?.system?.orbs ?? [])
      .map(orb => String(orb?.type ?? "").trim().toLowerCase())
      .filter(Boolean)
  );
}

function isSpell(item) {
  return item?.type === "competencia"
    && String(item.system?.categoria ?? "").trim().toLowerCase() === "hechizo";
}

export function resolveOrbRollPassiveBonus(actor, item) {
  const orbs = ownedOrbTypes(actor);
  const sources = [];
  const add = (orbType, passiveName) => sources.push({
    orbType,
    passiveName,
    bonus: 5
  });

  if (
    orbs.has("aeris")
    && item?.system?.actionType === "defense"
    && item.system?.defenseType === "dodge"
  ) {
    add("aeris", "Conjugatio");
  }

  if (isSpell(item)) {
    const tags = new Set(Array.from(item.system?.spellTags ?? []));
    if (orbs.has("mentem") && tags.has("sensory")) add("mentem", "Fragmentum");
    if (orbs.has("gravitae") && tags.has("destructive")) add("gravitae", "Centrum");
  }

  return {
    bonus: sources.reduce((sum, source) => sum + source.bonus, 0),
    sources
  };
}

export function applyOrbDamagePassives({
  damage,
  sourceActor = null,
  targetActor = null,
  sourceItem = null
} = {}) {
  let current = Math.max(0, Number(damage) || 0);
  const sources = [];
  const sourceOrbs = ownedOrbTypes(sourceActor);
  const targetOrbs = ownedOrbTypes(targetActor);
  const damageType = sourceItem?.system?.damageType ?? null;
  const damageElement = sourceItem?.system?.damageElement ?? null;
  const apply = (orbType, passiveName, operation) => {
    const before = current;
    current = Math.max(0, operation(current));
    sources.push({ orbType, passiveName, before, after: current });
  };

  if (sourceOrbs.has("ignis") && damageElement === "fire") {
    apply("ignis", "Calcinatio", value => Math.floor(value * 1.05));
  }
  if (sourceOrbs.has("oscuritae")) {
    apply("oscuritae", "Vis Mortem", value => Math.floor(value * 1.05));
  }
  if (targetOrbs.has("corpus") && damageType === "physical") {
    apply("corpus", "Corporis", value => Math.floor(value * 0.95));
  }
  if (targetOrbs.has("imagem") && damageType === "magical") {
    apply("imagem", "Delusio", value => Math.max(0, value - 5));
  }

  return { damage: current, sources };
}
