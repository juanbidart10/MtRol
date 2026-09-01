import { integrationObservability } from "./integration-observability.js";
import { logger } from "../utils/logger.js";

export class LifecycleCoordinator {
  constructor({ observability = integrationObservability, log = logger } = {}) {
    this.observability = observability;
    this.log = log;
    this.completed = new Set();
    this.inFlight = new Map();
  }

  async run(phase, operation) {
    if (this.completed.has(phase)) return { phase, duplicate: true };
    if (this.inFlight.has(phase)) return this.inFlight.get(phase);
    const task = (async () => {
      const startedAt = globalThis.performance?.now?.() ?? Date.now();
      this.log?.debug?.("LIFECYCLE", "phase started", { phase });
      await operation();
      this.completed.add(phase);
      this.observability.record("lifecycle", phase, {
        duration: (globalThis.performance?.now?.() ?? Date.now()) - startedAt,
        status: "completed"
      });
      this.log?.debug?.("LIFECYCLE", "phase completed", { phase });
      return { phase, duplicate: false };
    })();
    this.inFlight.set(phase, task);
    try {
      return await task;
    } finally {
      this.inFlight.delete(phase);
    }
  }
}

export const mtrolLifecycle = new LifecycleCoordinator();
