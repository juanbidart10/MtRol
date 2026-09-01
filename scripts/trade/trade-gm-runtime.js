const monitors = new Map();
let historyApp = null;
let registered = false;
const TERMINAL = new Set(["COMPLETED", "CANCELLED", "INVALID"]);
let tradeApi = null;

export function configureTradeGMRuntimeApi(api) {
  if (!api || typeof api.getGMMonitorView !== "function" || typeof api.getAuditHistory !== "function") {
    throw new TypeError("Trade GM Runtime requiere la API canónica de Trade.");
  }
  tradeApi = api;
}

function api() {
  if (!tradeApi) throw new Error("Trade GM Runtime no fue configurado durante setup.");
  return tradeApi;
}

export function getOpenTradeGMMonitor(sessionId) {
  return monitors.get(String(sessionId ?? "")) ?? null;
}

export function countOpenTradeGMMonitors() {
  return monitors.size;
}

export async function openTradeGMMonitor(sessionId) {
  if (!game.user?.isGM) throw new Error("La supervisión de comercio es exclusiva para GM.");
  const id = String(sessionId ?? "").trim();
  if (!id) return null;
  const existing = monitors.get(id);
  if (existing) {
    existing.render?.();
    existing.bringToTop?.();
    return existing;
  }
  const { MtrolTradeGMMonitorApp } = await import("../ui/trade-gm-monitor-app.js");
  const app = new MtrolTradeGMMonitorApp(id, { api: api(), onClosed: () => monitors.delete(id) });
  monitors.set(id, app);
  app.render({ force: true });
  return app;
}

export async function openTradeAuditHistory() {
  if (!game.user?.isGM) throw new Error("El historial de comercio es exclusivo para GM.");
  if (historyApp) {
    historyApp.render?.();
    historyApp.bringToTop?.();
    return historyApp;
  }
  const { MtrolTradeAuditHistoryApp } = await import("../ui/trade-audit-history-app.js");
  historyApp = new MtrolTradeAuditHistoryApp({ api: api(), onClosed: () => { historyApp = null; } });
  historyApp.render({ force: true });
  return historyApp;
}

export function registerTradeGMRuntimeHooks() {
  if (registered) return;
  registered = true;
  Hooks.on("mtrolTradeSessionUpdated", (session, reason) => {
    if (!game.user?.isGM) return;
    Hooks.callAll("mtrolTradeGMSessionUpdated", session, reason);
  });
  Hooks.on("mtrolTradeGMSessionUpdated", (session, reason) => {
    if (!game.user?.isGM || !session?.id) return;
    const monitor = monitors.get(session.id);
    if (TERMINAL.has(session.state)) {
      monitor?.setTerminalSnapshot?.(session);
      monitor?.render?.();
      ui.notifications?.info?.(`Comercio ${session.state}: ${session.participants?.participantA?.actorName ?? "A"} ↔ ${session.participants?.participantB?.actorName ?? "B"}`);
      return;
    }
    if (session.state === "REQUESTED") {
      ui.notifications?.info?.("Nueva solicitud de comercio P2P.");
      return;
    }
    if (session.state === "NEGOTIATING" && reason === "session-accepted") {
      // Foundry does not await hook return values: terminate this host-owned
      // Promise here so an import/render failure cannot become unhandled.
      void openTradeGMMonitor(session.id).catch(error => {
        logger.warn("TRADE_UI", "trade GM monitor open failed", {
          transactionId: session.transactionId ?? null,
          command: "trade.monitor.open",
          status: "failed",
          reasonCode: "TRADE_MONITOR_OPEN_FAILED",
          error
        });
      });
      return;
    }
    monitor?.render?.();
  });
  Hooks.on("mtrolTradeAuditCreated", () => historyApp?.render?.());
}
import { logger } from "../utils/logger.js";
