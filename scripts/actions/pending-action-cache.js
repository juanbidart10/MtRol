export class PendingActionCache {
  constructor() {
    // Todos estos contenedores son caches locales reconstruibles; nunca Source of Truth.
    this.actions = new Map();
    this.resolving = new Set();
    this.attachingDefense = new Set();
  }

  hydrate(values = []) {
    this.actions.clear();
    for (const value of values) {
      if (value?.id) this.actions.set(value.id, value);
    }
    this.resolving.clear();
    this.attachingDefense.clear();
    return this.values();
  }

  values() {
    return Array.from(this.actions.values());
  }

  clearTransientLocks() {
    this.resolving.clear();
    this.attachingDefense.clear();
  }
}

export const pendingActionCache = new PendingActionCache();

