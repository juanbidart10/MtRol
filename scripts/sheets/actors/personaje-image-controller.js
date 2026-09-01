export async function setPersonajeFullBodyImage(actor, path, { user = game.user } = {}) {
  if (!user?.isGM) throw new Error("Sólo el GM puede cambiar la imagen corporal.");
  const selectedPath = String(path ?? "").trim();
  if (!selectedPath && path !== "") return { changed: false };
  await actor.update({ "system.identidad.fullBodyImage": selectedPath });
  return { changed: true, path: selectedPath };
}

export async function setCompetenceImage(item, path, { user = game.user } = {}) {
  if (!user?.isGM) throw new Error("Sólo el GM puede cambiar la imagen de una competencia.");
  if (!item || item.type !== "competencia") throw new Error("La Competencia no es válida.");
  const selectedPath = String(path ?? "").trim();
  if (!selectedPath) return { changed: false };
  await item.update({ img: selectedPath });
  return { changed: true, path: selectedPath };
}

