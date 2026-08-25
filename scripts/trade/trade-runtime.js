const activeTradeApps = new Map();
const TERMINAL_STATES = new Set(["CANCELLED", "COMPLETED", "INVALID"]);
let hooksRegistered = false;

function participantKeyForCurrentUser(session) {
  return Object.entries(session?.participants ?? {})
    .find(([, participant]) => participant?.userId === game.user?.id)?.[0] ?? null;
}

function activeNonGmOwners(actor) {
  return game.users
    .filter(user => user.active && !user.isGM && actor.testUserPermission?.(user, "OWNER"))
    .sort((left, right) => String(left.name ?? left.id).localeCompare(String(right.name ?? right.id)));
}

function sourceTokenForActor(actor) {
  const syntheticToken = actor?.token?.document ?? actor?.token ?? null;
  if (syntheticToken?.uuid) return syntheticToken;
  const candidates = [
    ...(globalThis.canvas?.tokens?.controlled ?? []),
    ...(globalThis.canvas?.tokens?.placeables ?? [])
  ];
  const placeable = candidates.find(token =>
    String(token?.actor?.uuid ?? "") === String(actor?.uuid ?? "")
  );
  return placeable?.document ?? placeable ?? null;
}

export function getOpenTradeApp(sessionId) {
  return activeTradeApps.get(String(sessionId ?? "")) ?? null;
}

export function countOpenTradeApps() {
  return activeTradeApps.size;
}

export async function closeTradeApp(sessionId) {
  const id = String(sessionId ?? "");
  const app = activeTradeApps.get(id);
  if (!app) return false;
  activeTradeApps.delete(id);
  await app.close?.();
  return true;
}

export async function closeAllTradeApps() {
  const apps = [...activeTradeApps.values()];
  activeTradeApps.clear();
  await Promise.allSettled(apps.map(app => app.close?.()));
}

export async function openTradeApp(sessionId) {
  const id = String(sessionId ?? "").trim();
  if (!id) return null;

  const existing = activeTradeApps.get(id);
  if (existing) {
    existing.render?.();
    existing.bringToTop?.();
    return existing;
  }

  const session = game.mtrol?.trade?.getSession?.(id);
  if (!session || !participantKeyForCurrentUser(session) || TERMINAL_STATES.has(session.state)) {
    return null;
  }

  const { MtrolTradeApp } = await import("../ui/trade-app.js");
  const app = new MtrolTradeApp(id, {
    onClosed: () => activeTradeApps.delete(id)
  });
  activeTradeApps.set(id, app);
  app.render({ force: true });
  return app;
}

export async function requestTradeFromTarget({ sourceActor, targetToken }) {
  const targetActor = targetToken?.actor ?? null;
  if (!sourceActor || !targetActor) {
    ui.notifications.warn("Selecciona un token objetivo para solicitar comercio.");
    return null;
  }
  if (game.user?.isGM) {
    ui.notifications.warn("El GM puede observar comercios, pero no participa en ellos.");
    return null;
  }
  if (sourceActor.uuid === targetActor.uuid) {
    ui.notifications.warn("No se puede comerciar con el mismo Actor.");
    return null;
  }
  if (sourceActor.testUserPermission?.(game.user, "OWNER") !== true) {
    ui.notifications.warn("No posees OWNER sobre el Actor que inicia el comercio.");
    return null;
  }

  const targetOwner = activeNonGmOwners(targetActor)[0] ?? null;
  if (!targetOwner) {
    ui.notifications.warn("El Actor objetivo no tiene un jugador OWNER conectado.");
    return null;
  }

  const sourceToken = sourceTokenForActor(sourceActor);
  if (!sourceToken?.uuid) {
    ui.notifications.warn("Tu Actor debe tener un Token en la Scene para comerciar.");
    return null;
  }

  try {
    const session = await game.mtrol.trade.createSession({
      participantAActorUuid: sourceActor.uuid,
      participantATokenUuid: sourceToken.uuid,
      participantBActorUuid: targetActor.uuid,
      participantBTokenUuid: targetToken.document?.uuid ?? targetToken.uuid ?? null,
      participantBUserId: targetOwner.id
    });
    if (session?.id) await openTradeApp(session.id);
    ui.notifications.info("Solicitud de comercio enviada. Esperando aceptación.");
    return session;
  } catch (error) {
    ui.notifications.error(error.message ?? "No se pudo crear la solicitud de comercio.");
    return null;
  }
}

export async function handleTradeSessionRuntimeUpdate(session) {
  if (!participantKeyForCurrentUser(session)) return false;
  if (TERMINAL_STATES.has(session.state)) {
    if (session.state === "COMPLETED") ui.notifications.info("Intercambio completado.");
    if (session.state === "INVALID") ui.notifications.warn(
      session.invalidReason ? `Comercio finalizado: ${session.invalidReason}` : "El comercio quedó inválido."
    );
    await closeTradeApp(session.id);
    return true;
  }
  await openTradeApp(session.id);
  return true;
}

export function registerTradeRuntimeHooks() {
  if (hooksRegistered) return;
  hooksRegistered = true;

  Hooks.on("mtrolTradeSessionUpdated", session => {
    handleTradeSessionRuntimeUpdate(session);
  });

  Hooks.on("mtrolTradeAuthorityReset", () => closeAllTradeApps());
}
