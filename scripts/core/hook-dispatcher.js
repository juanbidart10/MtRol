import { integrationObservability } from "./integration-observability.js";
import { logger } from "../utils/logger.js";

export class HookDispatcher {
  constructor(name, { observability = integrationObservability, log = logger } = {}) {
    this.name = name;
    this.observability = observability;
    this.log = log;
    this.subscribers = new Map();
  }

  subscribe(id, handler, { priority = 100, critical = false } = {}) {
    if (!id || typeof handler !== "function") throw new TypeError("Subscriber de hook inválido.");
    if (this.subscribers.has(id)) return false;
    this.subscribers.set(id, { id, handler, priority: Number(priority), critical: critical === true });
    return true;
  }

  ordered() {
    return Array.from(this.subscribers.values())
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  }

  dispatchSync(...args) {
    this.observability.record("hook", this.name, { subscribers: this.subscribers.size });
    if (this.name.startsWith("update")) {
      this.observability.record("document-update", this.name.slice("update".length) || "Document");
    }
    for (const subscriber of this.ordered()) {
      const startedAt = globalThis.performance?.now?.() ?? Date.now();
      try {
        const result = subscriber.handler(...args);
        if (result && typeof result.then === "function") {
          throw new Error("Un subscriber síncrono devolvió una Promise.");
        }
        this.observability.record("subscriber", subscriber.id, {
          hookName: this.name,
          duration: (globalThis.performance?.now?.() ?? Date.now()) - startedAt,
          status: result === false ? "blocked" : "completed"
        });
        if (result === false && subscriber.critical) return false;
      } catch (error) {
        this.log?.[subscriber.critical ? "error" : "warn"]?.("HOOK", "hook subscriber failed", {
          hookName: this.name,
          subscriber: subscriber.id,
          critical: subscriber.critical,
          error: error.message
        });
        if (subscriber.critical) return false;
      }
    }
    return true;
  }

  async dispatch(...args) {
    this.observability.record("hook", this.name, { subscribers: this.subscribers.size });
    if (this.name.startsWith("update")) {
      this.observability.record("document-update", this.name.slice("update".length) || "Document");
    }
    for (const subscriber of this.ordered()) {
      const startedAt = globalThis.performance?.now?.() ?? Date.now();
      try {
        const result = await subscriber.handler(...args);
        this.observability.record("subscriber", subscriber.id, {
          hookName: this.name,
          duration: (globalThis.performance?.now?.() ?? Date.now()) - startedAt,
          status: result === false ? "blocked" : "completed"
        });
        if (result === false && subscriber.critical) return false;
      } catch (error) {
        this.log?.[subscriber.critical ? "error" : "warn"]?.("HOOK", "hook subscriber failed", {
          hookName: this.name,
          subscriber: subscriber.id,
          critical: subscriber.critical,
          error: error.message
        });
        if (subscriber.critical) throw error;
      }
    }
    return true;
  }
}

export const preUpdateTokenDispatcher = new HookDispatcher("preUpdateToken");
export const updateTokenDispatcher = new HookDispatcher("updateToken");
export const preUpdateActorDispatcher = new HookDispatcher("preUpdateActor");
export const updateActorDispatcher = new HookDispatcher("updateActor");
export const preUpdateItemDispatcher = new HookDispatcher("preUpdateItem");
export const updateItemDispatcher = new HookDispatcher("updateItem");

let coreHooksRegistered = false;

export function registerFoundryHookAdapters() {
  if (coreHooksRegistered) return false;
  Hooks.on("preUpdateActor", (...args) => preUpdateActorDispatcher.dispatchSync(...args));
  Hooks.on("updateActor", (...args) => {
    updateActorDispatcher.dispatch(...args).catch(error => logger.error("HOOK", "updateActor dispatcher aborted", {
      hookName: "updateActor",
      error: error.message
    }));
  });
  Hooks.on("preUpdateItem", (...args) => preUpdateItemDispatcher.dispatchSync(...args));
  Hooks.on("updateItem", (...args) => {
    updateItemDispatcher.dispatch(...args).catch(error => logger.error("HOOK", "updateItem dispatcher aborted", {
      hookName: "updateItem",
      error: error.message
    }));
  });
  Hooks.on("preUpdateToken", (...args) => preUpdateTokenDispatcher.dispatchSync(...args));
  Hooks.on("updateToken", (...args) => {
    updateTokenDispatcher.dispatch(...args).catch(error => logger.error("HOOK", "updateToken dispatcher aborted", {
      hookName: "updateToken",
      error: error.message
    }));
  });
  coreHooksRegistered = true;
  return true;
}

// Compatibility alias for modules loaded before the Actor/Item adapters were consolidated.
export const registerTokenHookAdapters = registerFoundryHookAdapters;
