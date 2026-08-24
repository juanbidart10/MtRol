export const MTROL_COMPETENCE_LEVEL_CAP = 5;

export function buildCompetenceLevelDisplay(level) {
  const numeric = Number(level);
  const value = Number.isFinite(numeric)
    ? Math.min(MTROL_COMPETENCE_LEVEL_CAP, Math.max(0, Math.trunc(numeric)))
    : 0;

  return {
    value,
    label: `Nivel ${value}/${MTROL_COMPETENCE_LEVEL_CAP}`,
    markers: Array.from(
      { length: MTROL_COMPETENCE_LEVEL_CAP },
      (_unused, index) => ({
        position: index + 1,
        active: index < value
      })
    )
  };
}
