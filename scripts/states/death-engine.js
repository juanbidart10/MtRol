const DEATH_TRANSITION_DATA = new Map();
const DEATH_STATUS_CANDIDATES = [
  "dead",
  "defeated",
  "death",
  "muerto",
  "derrotado"
];

let deathHooksRegistered = false;
const syncingActors = new Set();
const playedDeathFxKeys = new Set();
const actorDeathFxKeys = new Map();

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getHpValue(actor) {
  return toNumber(actor?.system?.vitales?.hp?.value, 0);
}

function getChangedHpValue(changes) {
  if (!changes || typeof changes !== "object") return undefined;

  if (Object.prototype.hasOwnProperty.call(changes, "system.vitales.hp.value")) {
    return changes["system.vitales.hp.value"];
  }

  if (foundry.utils.hasProperty(changes, "system.vitales.hp.value")) {
    return foundry.utils.getProperty(changes, "system.vitales.hp.value");
  }

  return changes.system?.vitales?.hp?.value;
}

function getStatusEffects() {
  const effects =
    CONFIG.statusEffects ?? [];

  if (effects instanceof Map) return Array.from(effects.values());
  return Array.from(effects);
}

function getStatusId(effect) {
  if (typeof effect === "string") return effect;
  return effect?.id ?? effect?._id ?? effect?.statusId ?? null;
}

function getSpecialStatusId(value) {
  return typeof value === "string" ? value : getStatusId(value);
}

function getStatusSearchText(effect) {
  return [
    getStatusId(effect),
    effect?.name,
    effect?.label,
    effect?.title
  ].map(normalizeText);
}

function statusHasCandidate(effect, candidate) {
  const normalizedCandidate =
    normalizeText(candidate);

  if (effect?.statuses?.has?.(candidate)) return true;
  if (effect?.statuses?.has?.(normalizedCandidate)) return true;

  return getStatusSearchText(effect)
    .some(text => text === normalizedCandidate);
}

export function resolveDeathStatusId() {
  const specialStatus =
    getSpecialStatusId(CONFIG.specialStatusEffects?.DEFEATED) ??
    getSpecialStatusId(CONFIG.specialStatusEffects?.dead) ??
    getSpecialStatusId(CONFIG.specialStatusEffects?.DEAD) ??
    null;

  if (specialStatus) return specialStatus;

  const effects =
    getStatusEffects();

  for (const candidate of DEATH_STATUS_CANDIDATES) {
    const exactMatch =
      effects.find(effect => normalizeText(getStatusId(effect)) === candidate);

    if (exactMatch) return getStatusId(exactMatch);
  }

  for (const candidate of DEATH_STATUS_CANDIDATES) {
    const statusMatch =
      effects.find(effect => effect?.statuses?.has?.(candidate));

    if (statusMatch) return getStatusId(statusMatch) ?? candidate;
  }

  for (const candidate of DEATH_STATUS_CANDIDATES) {
    const labelMatch =
      effects.find(effect => statusHasCandidate(effect, candidate));

    if (labelMatch) return getStatusId(labelMatch);
  }

  console.warn("MTROL | No se encontro un estado nativo de muerte/derrota.");
  return null;
}

function actorHasStatus(actor, statusId) {
  if (!actor || !statusId) return false;
  if (actor.statuses?.has?.(statusId)) return true;

  return actor.effects?.some(effect =>
    effect.statuses?.has?.(statusId) ||
    effect.getFlag?.("core", "statusId") === statusId
  ) ?? false;
}

function canManageActorDeath(actor) {
  return game.user?.isGM === true || actor?.isOwner === true;
}

function isVisibleToken(token) {
  if (!token) return false;
  if (token.object?.visible === false) return false;
  if (token.visible === false) return false;
  return true;
}

async function resolveTargetToken(tokenUuid) {
  if (!tokenUuid) return null;

  try {
    return await fromUuid(tokenUuid);
  } catch (error) {
    console.warn("MTROL | No se pudo resolver token objetivo para muerte.", error);
    return null;
  }
}

function getFallbackTokens(actor) {
  return actor?.getActiveTokens?.()
    ?.filter(isVisibleToken) ?? [];
}

function getTokenFxKey(actor, token) {
  return token?.uuid ??
    token?.document?.uuid ??
    `${actor?.uuid ?? "actor"}:${token?.id ?? token?.document?.id ?? "token"}`;
}

function getSequencerDatabase() {
  return globalThis.Sequencer?.Database ??
    globalThis.Sequencer?.database ??
    null;
}

function databaseHasEntry(database, entry) {
  if (!database || !entry) return false;

  try {
    if (typeof database.entryExists === "function") return database.entryExists(entry);
    if (typeof database.exists === "function") return database.exists(entry);
    if (typeof database.getEntry === "function") return Boolean(database.getEntry(entry));
    if (typeof database.get === "function") return Boolean(database.get(entry));
  } catch (_error) {
    return false;
  }

  return false;
}

function resolveDeathFxResource() {
  const database =
    getSequencerDatabase();

  const candidates = [
    "jb2a.smoke.puff.centered.dark_black",
    "jb2a.smoke.puff.centered.grey",
    "jb2a.energy_strands.overlay.dark_red.01",
    "jb2a.impact.ground_crack.dark_red.01"
  ];

  return candidates.find(candidate => databaseHasEntry(database, candidate)) ?? null;
}

export async function playDeathFx(token) {
  try {
    if (!game.modules.get("sequencer")?.active) return false;
    if (typeof globalThis.Sequence !== "function") return false;
    if (!isVisibleToken(token)) return false;

    const resource =
      resolveDeathFxResource();

    if (!resource) {
      if (game.user?.isGM) {
        console.warn("MTROL | FX de muerte omitido: no se encontro recurso Sequencer disponible.");
      }
      return false;
    }

    await new Sequence()
      .effect()
      .file(resource)
      .atLocation(token)
      .scale(0.85)
      .fadeIn(120)
      .fadeOut(350)
      .duration(1500)
      .play();

    return true;
  } catch (error) {
    console.warn("MTROL | FX de muerte omitido por error controlado.", error);
    return false;
  }
}

async function playDeathFxOnce(actor, tokens) {
  for (const token of tokens) {
    const key =
      getTokenFxKey(actor, token);

    if (playedDeathFxKeys.has(key)) continue;

    playedDeathFxKeys.add(key);

    const actorKeys =
      actorDeathFxKeys.get(actor.uuid) ?? new Set();

    actorKeys.add(key);
    actorDeathFxKeys.set(actor.uuid, actorKeys);

    await playDeathFx(token);
  }
}

function clearDeathFxKeys(actor) {
  const actorKeys =
    actorDeathFxKeys.get(actor.uuid);

  if (!actorKeys) return;

  for (const key of actorKeys) {
    playedDeathFxKeys.delete(key);
  }

  actorDeathFxKeys.delete(actor.uuid);
}

async function setDeathStatus(actor, statusId, active) {
  const currentlyActive =
    actorHasStatus(actor, statusId);

  if (currentlyActive === active) return false;

  syncingActors.add(actor.uuid);

  try {
    await actor.toggleStatusEffect(statusId, {
      active,
      overlay: true
    });
  } finally {
    syncingActors.delete(actor.uuid);
  }

  return true;
}

export async function syncDeathState(actor, options = {}) {
  if (!actor || !canManageActorDeath(actor)) return false;
  if (syncingActors.has(actor.uuid) || options.mtrolDeathSync === true) return false;

  const previousHp =
    toNumber(options.previousHp, getHpValue(actor));

  const currentHp =
    toNumber(options.currentHp, getHpValue(actor));

  const died =
    previousHp > 0 && currentHp <= 0;

  const revived =
    previousHp <= 0 && currentHp > 0;

  if (!died && !revived) return false;

  const statusId =
    resolveDeathStatusId();

  if (!statusId) return false;

  if (died) {
    await setDeathStatus(actor, statusId, true);

    const targetToken =
      await resolveTargetToken(options.mtrolDeathTargetTokenUuid);

    const tokens =
      targetToken
        ? [targetToken]
        : getFallbackTokens(actor);

    await playDeathFxOnce(actor, tokens);
    return true;
  }

  if (revived) {
    await setDeathStatus(actor, statusId, false);
    clearDeathFxKeys(actor);
    return true;
  }

  return false;
}

export async function applyDeadIfNeeded(actor, options = {}) {
  return syncDeathState(actor, {
    ...options,
    previousHp: options.previousHp ?? 1,
    currentHp: getHpValue(actor)
  });
}

function rememberPreviousHp(actor, changes, options = {}) {
  const changedHp =
    getChangedHpValue(changes);

  if (changedHp === undefined) return;

  DEATH_TRANSITION_DATA.set(actor.uuid, {
    previousHp: getHpValue(actor),
    mtrolDeathTargetTokenUuid: options.mtrolDeathTargetTokenUuid ?? null
  });
}

function consumePreviousHp(actor) {
  const data =
    DEATH_TRANSITION_DATA.get(actor.uuid);

  DEATH_TRANSITION_DATA.delete(actor.uuid);
  return data;
}

export function installMtrolDeathApi() {
  game.mtrol = game.mtrol || {};
  game.mtrol.states = game.mtrol.states || {};
  game.mtrol.states.applyDeadIfNeeded = applyDeadIfNeeded;
  game.mtrol.states.syncDeathState = syncDeathState;

  if (deathHooksRegistered) return;

  Hooks.on("preUpdateActor", (actor, changes, options = {}) => {
    if (!canManageActorDeath(actor)) return;
    if (syncingActors.has(actor.uuid)) return;
    rememberPreviousHp(actor, changes, options);
  });

  Hooks.on("updateActor", (actor, _changes, options = {}) => {
    if (!canManageActorDeath(actor)) return;
    if (syncingActors.has(actor.uuid)) return;

    const data =
      consumePreviousHp(actor);

    if (!data) return;

    syncDeathState(actor, {
      ...data,
      currentHp: getHpValue(actor),
      mtrolDeathTargetTokenUuid:
        data.mtrolDeathTargetTokenUuid ??
        options.mtrolDeathTargetTokenUuid ??
        null
    }).catch(error => {
      console.warn("MTROL | No se pudo sincronizar muerte automatica.", error);
    });
  });

  deathHooksRegistered = true;
}
