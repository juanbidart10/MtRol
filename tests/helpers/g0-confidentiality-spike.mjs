// Manual Foundry-only instrumentation. Never imported by the system runtime.
export const SENTINEL = "MTROL_SECRET_GROUND_TEST_7F3A";
const FLAG = "g0ConfidentialityProbe";
const SETTING = "g0ConfidentialityProbe";

function requireWorld(worldId, gm) {
  if (!worldId || game.world.id !== worldId || game.version !== "14.365") {
    throw new Error("Require explicit isolated world ID and Foundry 14.365.");
  }
  if (gm && !game.user.isGM) throw new Error("GM required.");
  if (!gm && game.user.isGM) throw new Error("Use an actual Player client.");
}

function registerSetting() {
  if (!game.settings.settings.has(`mtrol.${SETTING}`)) {
    game.settings.register("mtrol", SETTING, { scope: "world", config: false, type: String, default: "" });
  }
}

export async function setup({ worldId, isolatedWorldConfirmed = false } = {}) {
  requireWorld(worldId, true);
  if (!isolatedWorldConfirmed) throw new Error("Confirm a disposable isolated test world.");
  registerSetting();
  if (game.settings.get("mtrol", SETTING)) throw new Error("Existing probe; clean it before another run.");
  const marker = `${SENTINEL}:${foundry.utils.randomID()}`;
  const flags = { mtrol: { [FLAG]: marker } };
  const ownership = { default: 0 };
  const evidence = { worldId, marker, sceneId: null, actorId: null, itemId: null, journalId: null };
  // Keep the partial manifest available if setup fails; cleanup is explicit.
  globalThis.mtrolG0ProbeManifest = evidence;
  const scene = await Scene.create({ name: "G0 disposable confidentiality probe", active: false,
    navigation: false, ownership, flags });
  evidence.sceneId = scene.id;
  const [tile] = await scene.createEmbeddedDocuments("Tile", [{
    x: 0, y: 0, width: 100, height: 100, hidden: true,
    texture: { src: "icons/svg/item-bag.svg" }, flags
  }]);
  evidence.tileId = tile.id;
  const actor = await Actor.create({ name: "G0 disposable Actor", type: "personaje", ownership, flags });
  evidence.actorId = actor.id;
  const [embedded] = await actor.createEmbeddedDocuments("Item", [{ name: "G0 embedded Item", type: "objeto",
    system: { cantidad: 1, descripcion: marker }, flags }]);
  evidence.embeddedItemId = embedded.id;
  const item = await Item.create({ name: "G0 disposable Item", type: "objeto", ownership,
    system: { cantidad: 1, descripcion: marker }, flags });
  evidence.itemId = item.id;
  const journal = await JournalEntry.create({ name: "G0 disposable Journal", ownership, flags,
    pages: [{ name: "G0 page", type: "text", text: { content: `<p>${marker}</p>` }, flags }] });
  evidence.journalId = journal.id;
  await game.settings.set("mtrol", SETTING, marker);
  return structuredClone(evidence);
}

export function observe({ worldId } = {}) {
  requireWorld(worldId, false);
  const events = [];
  const listeners = ["modifyDocument", "modifyDocumentBatch", "system.mtrol"].map(event => {
    const listener = data => {
      if (JSON.stringify(data)?.includes(SENTINEL)) events.push({ event, at: Date.now(), containsSentinel: true });
    };
    game.socket.on(event, listener);
    return [event, listener];
  });
  return { events, stop: () => listeners.forEach(([event, listener]) => game.socket.off(event, listener)) };
}

export function inspect(manifest) {
  requireWorld(manifest.worldId, false);
  registerSetting();
  const scene = game.scenes.get(manifest.sceneId);
  const actor = game.actors.get(manifest.actorId);
  const sources = {
    scene: scene?.toObject(), tile: scene?.tiles.get(manifest.tileId)?.toObject(),
    actorWithoutOwnership: actor?.toObject(), embeddedItem: actor?.items.get(manifest.embeddedItemId)?.toObject(),
    itemWithoutOwnership: game.items.get(manifest.itemId)?.toObject(),
    journalWithoutOwnership: game.journal.get(manifest.journalId)?.toObject(),
    worldSetting: game.settings.get("mtrol", SETTING)
  };
  return {
    version: game.version, userId: game.user.id, isGM: game.user.isGM,
    checks: Object.entries(sources).map(([surface, value]) => ({ surface,
      present: value !== undefined, containsSentinel: JSON.stringify(value)?.includes(manifest.marker) ?? false })),
    // This is the retained bootstrap object, not a captured Network response.
    retainedBootstrapContainsSentinel: JSON.stringify(game.data)?.includes(manifest.marker) ?? false
  };
}

export async function cleanup(manifest) {
  requireWorld(manifest.worldId, true);
  for (const [collection, id] of [[game.scenes, manifest.sceneId], [game.actors, manifest.actorId],
    [game.items, manifest.itemId], [game.journal, manifest.journalId]]) {
    const document = collection.get(id);
    if (document && document.getFlag("mtrol", FLAG) !== manifest.marker) {
      throw new Error("Refusing to delete a document not owned by this probe.");
    }
    if (document) await document.delete();
  }
  const setting = game.settings.storage.get("world").find(entry => entry.key === `mtrol.${SETTING}`);
  if (setting && game.settings.get("mtrol", SETTING) === manifest.marker) await setting.delete();
}
