const DEFAULT_LIMIT = 500;

export class IntegrationObservability {
  constructor({ enabled = false, limit = DEFAULT_LIMIT } = {}) {
    this.enabled = enabled;
    this.limit = limit;
    this.events = [];
    this.counts = new Map();
  }

  configure({ enabled = this.enabled, limit = this.limit } = {}) {
    this.enabled = enabled === true;
    this.limit = Math.max(1, Math.trunc(Number(limit) || DEFAULT_LIMIT));
    return this.snapshot();
  }

  record(kind, name, metadata = {}) {
    const key = `${kind}:${name}`;
    this.counts.set(key, Number(this.counts.get(key) ?? 0) + 1);
    if (!this.enabled) return;
    this.events.push({ kind, name, at: Date.now(), ...metadata });
    if (this.events.length > this.limit) this.events.splice(0, this.events.length - this.limit);
  }

  snapshot() {
    return {
      enabled: this.enabled,
      counts: Object.fromEntries(this.counts),
      events: this.events.map(event => ({ ...event }))
    };
  }

  reset() {
    this.events.length = 0;
    this.counts.clear();
  }
}

export const integrationObservability = new IntegrationObservability();
