import {
  normalizeContextualModifiers
} from "./combat-ability-policy.js";

export const LEVEL_DIFFERENCE_MODIFIER = Object.freeze({
  sourceId: "mtrol.gm.level-difference",
  sourceType: "gm-level-difference",
  label: "Diferencia de nivel",
  value: -5
});

export async function adjudicateLevelDifferenceModifier({ enabled = false } = {}) {
  if (!enabled) return Object.freeze({ initial: [], damage: [] });
  if (globalThis.game?.user?.isGM !== true) {
    throw new Error("Sólo el GM puede adjudicar Diferencia de nivel.");
  }
  const selection = await Dialog.wait({
    title: "Modifier contextual de GM",
    content: `<p>Aplicar <strong>-5 Diferencia de nivel</strong> únicamente a esta ejecución.</p>
      <label><input type="checkbox" name="initial"> Fórmula inicial</label>
      <label><input type="checkbox" name="damage"> Damage Formula</label>`,
    buttons: {
      confirm: {
        label: "Adjudicar",
        callback: html => ({
          initial: Boolean(html.querySelector?.('[name="initial"]')?.checked ?? html.find?.('[name="initial"]')?.prop?.("checked")),
          damage: Boolean(html.querySelector?.('[name="damage"]')?.checked ?? html.find?.('[name="damage"]')?.prop?.("checked"))
        })
      },
      cancel: { label: "Sin modifier", callback: () => null }
    },
    close: () => null
  });
  return Object.freeze({
    initial: selection?.initial
      ? normalizeContextualModifiers([LEVEL_DIFFERENCE_MODIFIER], { allowGmOnly: true })
      : [],
    damage: selection?.damage
      ? normalizeContextualModifiers([LEVEL_DIFFERENCE_MODIFIER], { allowGmOnly: true })
      : []
  });
}
