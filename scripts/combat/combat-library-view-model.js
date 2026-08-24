import {
  MTROL_CATEGORIES,
  normalizarCategoria
} from "../core/categories.js";

const MTROL_COMBAT_NATURES = Object.freeze({
  MAGICAL: "magical",
  PHYSICAL: "physical"
});

function toNonNegativeInteger(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.trunc(numeric));
}

export function classifyCombatActionNature(action) {
  const damageType = String(action?.system?.damageType ?? "")
    .trim()
    .toLowerCase();

  if (damageType === MTROL_COMBAT_NATURES.MAGICAL) {
    return MTROL_COMBAT_NATURES.MAGICAL;
  }

  if (damageType === MTROL_COMBAT_NATURES.PHYSICAL) {
    return MTROL_COMBAT_NATURES.PHYSICAL;
  }

  return normalizarCategoria(action?.system?.categoria) === MTROL_CATEGORIES.HECHIZO
    ? MTROL_COMBAT_NATURES.MAGICAL
    : MTROL_COMBAT_NATURES.PHYSICAL;
}

export function prepareCombatLibraryAction(action) {
  const mpCost = toNonNegativeInteger(action?.mtrolMpCost);
  const cooldown = toNonNegativeInteger(action?.system?.cooldown);
  const stack = toNonNegativeInteger(action?.mtrolMpStack);
  const showMp = mpCost > 0;
  const showCooldown = cooldown > 0;
  const showStack = action?.mtrolMpStackable === true;

  return {
    ...action,
    mtrolCombatNature: classifyCombatActionNature(action),
    mtrolShowMp: showMp,
    mtrolMpCost: mpCost,
    mtrolShowCooldown: showCooldown,
    mtrolCooldown: cooldown,
    mtrolShowStack: showStack,
    mtrolStack: stack,
    mtrolShowMeta: showMp || showCooldown || showStack
  };
}

export function buildCombatLibraryViewModel(actions = []) {
  const magicalActions = [];
  const physicalActions = [];
  const preparedActions = [];

  for (const action of Array.from(actions ?? [])) {
    const prepared = prepareCombatLibraryAction(action);
    preparedActions.push(prepared);

    if (prepared.mtrolCombatNature === MTROL_COMBAT_NATURES.MAGICAL) {
      magicalActions.push(prepared);
    } else {
      physicalActions.push(prepared);
    }
  }

  return {
    actions: preparedActions,
    magicalActions,
    physicalActions,
    groups: [
      { id: "magical", label: "MÁGICAS", actions: magicalActions },
      { id: "physical", label: "FÍSICAS", actions: physicalActions }
    ].filter(group => group.actions.length > 0),
    empty: magicalActions.length === 0 && physicalActions.length === 0
  };
}
