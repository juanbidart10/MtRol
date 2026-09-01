import { isProgressionCompetence } from "./progression-competence.js";

export async function adjustCompetenceLevel(item, delta, { user = game.user } = {}) {
  if (!user?.isGM) throw new Error("Sólo el GM puede modificar niveles de Competencia.");
  if (!isProgressionCompetence(item)) {
    throw new Error("Este Item no es una competencia de progresión.");
  }
  const current = Number(item.system?.nivel || 1);
  const level = Math.min(5, Math.max(1, current + Math.trunc(Number(delta) || 0)));
  if (level === current) return { changed: false, level };
  await item.update({ "system.nivel": level });
  return { changed: true, level };
}
