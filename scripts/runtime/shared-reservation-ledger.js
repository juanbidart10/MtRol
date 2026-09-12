/** Canonical, persisted inventory reservations shared by all MtRol domains. */
export const RESERVATION_STATES = Object.freeze({
  RESERVED: "RESERVED", COMMITTING: "COMMITTING", RECOVERY_REQUIRED: "RECOVERY_REQUIRED",
  COMMITTED: "COMMITTED", ROLLED_BACK: "ROLLED_BACK", RELEASED: "RELEASED"
});
const ACTIVE = [RESERVATION_STATES.RESERVED, RESERVATION_STATES.COMMITTING, RESERVATION_STATES.RECOVERY_REQUIRED];
const clone = value => globalThis.foundry?.utils?.deepClone?.(value) ?? structuredClone(value);
const required = (v, name) => { const s = String(v ?? "").trim(); if (!s) throw new TypeError(`Falta ${name}.`); return s; };
const qty = v => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw new RangeError("La cantidad reservada debe ser un entero mayor que cero."); return n; };
const errorWithCode = (message, reasonCode) => Object.assign(new Error(message), { reasonCode });
const resourceKey = (actorUuid, itemUuid) => `${encodeURIComponent(required(actorUuid, "actorUuid"))}::${encodeURIComponent(required(itemUuid, "itemUuid"))}`;
const stableValue = value => Array.isArray(value) ? value.map(stableValue) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])])) : value;
const evidenceFingerprint = value => JSON.stringify(stableValue(value));

export function reservationFingerprint({ domain, actorUuid, itemUuid, quantity, payload = null } = {}) {
  return JSON.stringify({ domain: required(domain, "domain"), actorUuid: required(actorUuid, "actorUuid"), itemUuid: required(itemUuid, "itemUuid"), quantity: qty(quantity), payload });
}

export class SharedReservationLedger {
  constructor({ repository = null, now = () => Date.now(), authority = null } = {}) {
    this.repository = repository; this.now = now; this.authority = authority; this.reservations = new Map(); this.mutations = new Map(); this.quarantines = new Map(); this.queue = Promise.resolve();
  }
  setAuthorityService(authority) { this.authority = authority; return this; }
  hydrate(runtime = {}) { this.reservations = new Map(Object.entries(runtime.reservations ?? {}).map(([id, value]) => [id, clone(value)])); this.mutations = new Map(Object.entries(runtime.reservationMutations ?? {}).map(([id, value]) => [id, clone(value)])); this.quarantines = new Map(Object.entries(runtime.resourceCapacityQuarantines ?? {}).map(([id, value]) => [id, clone(value)])); return this.list(); }
  async hydrateFromPersistence() { return this.hydrate(await this.repository?.ensure?.() ?? {}); }
  list({ activeOnly = false } = {}) { return [...this.reservations.values()].filter(r => !activeOnly || ACTIVE.includes(r.state)).map(clone); }
  get(operationId) { return clone(this.reservations.get(String(operationId)) ?? null); }
  getResourceQuarantine(actorUuid, itemUuid) { return clone(this.quarantines.get(resourceKey(actorUuid, itemUuid)) ?? null); }
  listResourceQuarantines() { return [...this.quarantines.values()].map(clone); }
  async quarantineResource(input, { authorityContext = null } = {}) {
    return this.#mutate(async (_draft, _mutationDraft, quarantineDraft) => {
      const actorUuid = required(input?.actorUuid, "actorUuid");
      const itemUuid = required(input?.itemUuid, "itemUuid");
      const reason = required(input?.reason, "reason");
      if (reason !== "LEGACY_RESERVATION_CONFLICT") throw errorWithCode("Razón de cuarentena no soportada.", "QUARANTINE_REASON_INVALID");
      if (authorityContext) this.authority?.validateWriteContext(authorityContext);
      const key = resourceKey(actorUuid, itemUuid);
      const observation = clone(input.evidence ?? {});
      const fingerprint = evidenceFingerprint(observation);
      const current = quarantineDraft[key];
      if (current) {
        if (!current.evidence.some(entry => entry.fingerprint === fingerprint)) {
          current.evidence.push({ fingerprint, observedAt: this.now(), data: observation });
          current.revision += 1; current.updatedAt = this.now();
        }
        if (authorityContext) this.authority?.validateWriteContext(authorityContext);
        return current;
      }
      const created = {
        actorUuid, itemUuid, reason, state: "ACTIVE", revision: 0,
        authorityGeneration: authorityContext?.generation ?? null,
        evidence: [{ fingerprint, observedAt: this.now(), data: observation }],
        createdAt: this.now(), updatedAt: this.now()
      };
      if (authorityContext) this.authority?.validateWriteContext(authorityContext);
      quarantineDraft[key] = created;
      return created;
    });
  }
  reservedQuantity(actorUuid, itemUuid, { excludeOperationId = null } = {}) { if (!String(itemUuid ?? "").trim()) return 0; return this.list({ activeOnly: true }).filter(r => r.actorUuid === actorUuid && r.itemUuid === itemUuid && r.operationId !== excludeOperationId).reduce((n, r) => n + r.quantity, 0); }
  async reserve(input, { realQuantity, authorityContext = null } = {}) {
    return this.#mutate(async (draft, _mutationDraft, quarantineDraft) => {
      const operationId = required(input?.operationId, "operationId");
      const fingerprint = input.fingerprint ?? reservationFingerprint(input);
      const previous = draft[operationId];
      if (previous) { if (previous.fingerprint !== fingerprint) throw new Error("El operationId ya fue utilizado con otro fingerprint."); return previous; }
      if (authorityContext) this.authority?.validateWriteContext(authorityContext);
      if (quarantineDraft[resourceKey(input.actorUuid, input.itemUuid)]?.state === "ACTIVE") throw errorWithCode("La capacidad del recurso está en cuarentena.", "CAPACITY_QUARANTINED");
      const available = Number(await realQuantity?.(input.actorUuid, input.itemUuid));
      if (authorityContext) this.authority?.validateWriteContext(authorityContext);
      if (!Number.isFinite(available) || available < 0) throw new RangeError("La cantidad real del Item no es válida.");
      const used = Object.values(draft).filter(r => ACTIVE.includes(r.state) && r.actorUuid === String(input.actorUuid) && r.itemUuid === String(input.itemUuid)).reduce((n, r) => n + r.quantity, 0);
      const quantity = qty(input.quantity); if (used + quantity > available) throw new Error("Cantidad no disponible: existe una reserva incompatible.");
      const record = { operationId, domain: required(input.domain, "domain"), actorUuid: required(input.actorUuid, "actorUuid"), itemUuid: required(input.itemUuid, "itemUuid"), quantity, state: RESERVATION_STATES.RESERVED, fingerprint, authorityGeneration: authorityContext?.generation ?? input.authorityGeneration ?? null, revision: 0, evidence: clone(input.evidence ?? {}), createdAt: this.now(), updatedAt: this.now() };
      draft[operationId] = record; return record;
    });
  }
  async mutateReservationSet(input, { realQuantity, authorityContext = null } = {}) {
    return this.#mutate(async (draft, mutationDraft, quarantineDraft) => {
      const mutationId = required(input?.mutationId, "mutationId");
      const mutationFingerprint = required(input?.mutationFingerprint, "mutationFingerprint");
      const priorMutation = mutationDraft[mutationId];
      if (priorMutation) {
        if (priorMutation.fingerprint !== mutationFingerprint) {
          throw errorWithCode("El mutationId ya fue utilizado con otro fingerprint.", "RESERVATION_MUTATION_CONFLICT");
        }
        return { ...clone(priorMutation.result), idempotent: true };
      }

      const operations = Array.isArray(input?.operations) ? input.operations : [];
      if (!operations.length) throw new TypeError("La mutación de reservas no puede estar vacía.");
      const operationIds = operations.map(operation => required(operation?.operationId, "operationId"));
      if (new Set(operationIds).size !== operationIds.length) {
        throw errorWithCode("La mutación contiene una identidad de reserva duplicada.", "RESERVATION_DUPLICATE_IDENTITY");
      }
      if (authorityContext) this.authority?.validateWriteContext(authorityContext);

      for (const operation of operations) {
        const record = operation.type?.toUpperCase() === "CREATE" ? operation : draft[operation.operationId];
        if (record && quarantineDraft[resourceKey(record.actorUuid, record.itemUuid)]?.state === "ACTIVE") {
          throw errorWithCode("La capacidad del recurso está en cuarentena.", "CAPACITY_QUARANTINED");
        }
      }

      const simulated = clone(draft);
      for (const operation of operations) {
        const type = required(operation?.type, "tipo de mutación").toUpperCase();
        const current = draft[operation.operationId] ?? null;
        if (type === "CREATE") {
          if (current) throw errorWithCode("La identidad de reserva ya existe y no puede revivirse.", "RESERVATION_IDENTITY_CONFLICT");
          const quantity = qty(operation.quantity);
          simulated[operation.operationId] = {
            operationId: operation.operationId,
            domain: required(operation.domain, "domain"),
            actorUuid: required(operation.actorUuid, "actorUuid"),
            itemUuid: required(operation.itemUuid, "itemUuid"),
            quantity,
            state: RESERVATION_STATES.RESERVED,
            fingerprint: operation.fingerprint ?? reservationFingerprint(operation),
            authorityGeneration: authorityContext?.generation ?? operation.authorityGeneration ?? null,
            revision: 0,
            evidence: clone(operation.evidence ?? {}),
            createdAt: this.now(),
            updatedAt: this.now()
          };
          continue;
        }
        if (!current) throw errorWithCode("La reserva no existe.", "RESERVATION_NOT_FOUND");
        if (Number(operation.expectedRevision) !== Number(current.revision)) {
          throw errorWithCode("La revisión esperada no coincide con la reserva vigente.", "RESERVATION_STALE_REVISION");
        }
        if (type === "REPLACE") {
          if (current.state !== RESERVATION_STATES.RESERVED) throw errorWithCode("El estado de la reserva no permite modificar cantidad.", "RESERVATION_STATE_CONFLICT");
          simulated[operation.operationId] = {
            ...clone(current), quantity: qty(operation.quantity), revision: Number(current.revision) + 1,
            evidence: operation.evidence ? { ...current.evidence, ...clone(operation.evidence) } : clone(current.evidence), updatedAt: this.now()
          };
          continue;
        }
        if (type === "REACQUIRE") {
          if (current.state !== RESERVATION_STATES.RELEASED) throw errorWithCode("Sólo una reserva RELEASED puede readquirir capacidad.", "RESERVATION_STATE_CONFLICT");
          simulated[operation.operationId] = {
            ...clone(current), state: RESERVATION_STATES.RESERVED, quantity: qty(operation.quantity),
            revision: Number(current.revision) + 1,
            evidence: operation.evidence ? { ...current.evidence, ...clone(operation.evidence) } : clone(current.evidence),
            updatedAt: this.now()
          };
          continue;
        }
        if (type === "RELEASE") {
          if (current.state !== RESERVATION_STATES.RESERVED) throw errorWithCode("El estado de la reserva no permite liberación pre-efecto.", "RESERVATION_STATE_CONFLICT");
          simulated[operation.operationId] = {
            ...clone(current), state: RESERVATION_STATES.RELEASED, revision: Number(current.revision) + 1,
            evidence: operation.evidence ? { ...current.evidence, ...clone(operation.evidence) } : clone(current.evidence), updatedAt: this.now()
          };
          continue;
        }
        throw errorWithCode(`Tipo de mutación de reserva no soportado: ${type}.`, "RESERVATION_MUTATION_TYPE_INVALID");
      }

      const resourceKeys = [...new Set(operations.map(operation => {
        const record = simulated[operation.operationId] ?? draft[operation.operationId];
        return `${record.actorUuid}\u0000${record.itemUuid}`;
      }))];
      for (const resourceKey of resourceKeys) {
        const [actorUuid, itemUuid] = resourceKey.split("\u0000");
        const real = Number(await realQuantity?.(actorUuid, itemUuid));
        if (!Number.isFinite(real) || real < 0) throw new RangeError("La cantidad real del Item no es válida.");
        const reserved = Object.values(simulated)
          .filter(record => ACTIVE.includes(record.state) && record.actorUuid === actorUuid && record.itemUuid === itemUuid)
          .reduce((sum, record) => sum + record.quantity, 0);
        if (reserved > real) throw errorWithCode("Cantidad no disponible: existe una reserva incompatible.", "RESERVATION_CAPACITY_CONFLICT");
      }
      if (authorityContext) this.authority?.validateWriteContext(authorityContext);

      for (const operationId of operationIds) draft[operationId] = clone(simulated[operationId]);
      const reservations = operationIds.map(operationId => clone(draft[operationId]));
      const result = { changed: true, idempotent: false, mutationId, reservations };
      mutationDraft[mutationId] = { fingerprint: mutationFingerprint, result: clone(result), createdAt: this.now() };
      return result;
    });
  }
  async reacquireReservation(input, context = {}) {
    const result = await this.mutateReservationSet({
      mutationId: input?.mutationId,
      mutationFingerprint: input?.mutationFingerprint,
      operations: [{
        type: "REACQUIRE",
        operationId: input?.operationId,
        expectedRevision: input?.expectedRevision,
        quantity: input?.quantity,
        evidence: input?.evidence
      }]
    }, context);
    return { ...result, reservation: result.reservations[0] };
  }
  async replaceReservation(input, context = {}) {
    const batch = await this.replaceReservationsBatch({
      mutationId: input?.mutationId,
      mutationFingerprint: input?.mutationFingerprint,
      entries: [input]
    }, context);
    return { ...batch, reservation: batch.reservations[0] };
  }
  async replaceReservationsBatch(input, { realQuantity, authorityContext = null } = {}) {
    return this.#mutate(async (draft, mutationDraft, quarantineDraft) => {
      const mutationId = required(input?.mutationId, "mutationId");
      const mutationFingerprint = required(input?.mutationFingerprint, "mutationFingerprint");
      const entries = Array.isArray(input?.entries) ? input.entries : [];
      if (!entries.length) throw new TypeError("El batch de reservas no puede estar vacío.");
      const ids = entries.map(entry => required(entry?.operationId, "operationId"));
      if (new Set(ids).size !== ids.length) throw errorWithCode("El batch contiene una identidad de reserva duplicada.", "RESERVATION_DUPLICATE_IDENTITY");
      for (const operationId of ids) {
        if (!draft[operationId]) throw errorWithCode("La reserva no existe.", "RESERVATION_NOT_FOUND");
      }
      const priorMutation = mutationDraft[mutationId];
      if (priorMutation) {
        if (priorMutation.fingerprint !== mutationFingerprint) throw errorWithCode("El mutationId ya fue utilizado con otro fingerprint.", "RESERVATION_MUTATION_CONFLICT");
        return { ...clone(priorMutation.result), idempotent: true };
      }
      if (authorityContext) this.authority?.validateWriteContext(authorityContext);

      for (const operationId of ids) {
        const record = draft[operationId];
        if (quarantineDraft[resourceKey(record.actorUuid, record.itemUuid)]?.state === "ACTIVE") {
          throw errorWithCode("La capacidad del recurso está en cuarentena.", "CAPACITY_QUARANTINED");
        }
      }

      const proposed = new Map();
      for (const entry of entries) {
        const current = draft[entry.operationId];
        if (!current) throw errorWithCode("La reserva no existe.", "RESERVATION_NOT_FOUND");
        if (Number(entry.expectedRevision) !== Number(current.revision)) throw errorWithCode("La revisión esperada no coincide con la reserva vigente.", "RESERVATION_STALE_REVISION");
        if (current.state !== RESERVATION_STATES.RESERVED) throw errorWithCode("El estado de la reserva no permite modificar cantidad.", "RESERVATION_STATE_CONFLICT");
        proposed.set(entry.operationId, { ...clone(current), quantity: qty(entry.quantity) });
      }

      const itemKeys = [...new Set(entries.map(entry => {
        const current = draft[entry.operationId];
        return `${current.actorUuid}\u0000${current.itemUuid}`;
      }))];
      for (const itemKey of itemKeys) {
        const [actorUuid, itemUuid] = itemKey.split("\u0000");
        const real = Number(await realQuantity?.(actorUuid, itemUuid));
        if (!Number.isFinite(real) || real < 0) throw new RangeError("La cantidad real del Item no es válida.");
        const total = Object.values(draft).filter(r => ACTIVE.includes(r.state) && r.actorUuid === actorUuid && r.itemUuid === itemUuid).reduce((sum, current) => sum + (proposed.get(current.operationId)?.quantity ?? current.quantity), 0);
        if (total > real) throw errorWithCode("Cantidad no disponible: existe una reserva incompatible.", "RESERVATION_CAPACITY_CONFLICT");
      }
      if (authorityContext) this.authority?.validateWriteContext(authorityContext);

      const reservations = entries.map(entry => {
        const current = draft[entry.operationId];
        const next = proposed.get(entry.operationId);
        next.revision = Number(current.revision) + 1;
        next.updatedAt = this.now();
        if (entry.evidence) next.evidence = { ...next.evidence, ...clone(entry.evidence) };
        draft[entry.operationId] = next;
        return clone(next);
      });
      const result = { changed: true, idempotent: false, mutationId, reservations };
      mutationDraft[mutationId] = { fingerprint: mutationFingerprint, result: clone(result), createdAt: this.now() };
      return result;
    });
  }
  async transition(operationId, state, { authorityContext = null, evidence = null } = {}) {
    const legal = {
      [RESERVATION_STATES.RESERVED]: [RESERVATION_STATES.RESERVED, RESERVATION_STATES.COMMITTING, RESERVATION_STATES.RELEASED, RESERVATION_STATES.RECOVERY_REQUIRED],
      [RESERVATION_STATES.COMMITTING]: [RESERVATION_STATES.COMMITTED, RESERVATION_STATES.ROLLED_BACK, RESERVATION_STATES.RECOVERY_REQUIRED],
      [RESERVATION_STATES.RECOVERY_REQUIRED]: [RESERVATION_STATES.COMMITTED, RESERVATION_STATES.ROLLED_BACK]
    };
    if (!Object.values(RESERVATION_STATES).includes(state)) throw new Error("Estado de reserva inválido.");
    return this.#mutate(async (draft, _mutationDraft, quarantineDraft) => {
      const r = draft[required(operationId, "operationId")]; if (!r) throw new Error("La reserva no existe.");
      if (authorityContext) this.authority?.validateWriteContext(authorityContext);
      if (r.state === state) return r;
      if (quarantineDraft[resourceKey(r.actorUuid, r.itemUuid)]?.state === "ACTIVE" && state !== RESERVATION_STATES.RECOVERY_REQUIRED) {
        throw errorWithCode("La capacidad del recurso está en cuarentena.", "CAPACITY_QUARANTINED");
      }
      if (!legal[r.state]?.includes(state)) throw errorWithCode("Transición de reserva no permitida.", "RESERVATION_STATE_CONFLICT");
      r.state = state; r.revision += 1; r.updatedAt = this.now(); if (evidence) r.evidence = { ...r.evidence, ...clone(evidence) }; return r;
    });
  }
  async release(id, options) { return this.transition(id, RESERVATION_STATES.RELEASED, options); }
  async commit(id, options) { return this.transition(id, RESERVATION_STATES.COMMITTED, options); }
  async rollback(id, options) { return this.transition(id, RESERVATION_STATES.ROLLED_BACK, options); }
  async recoveryRequired(id, options) { return this.transition(id, RESERVATION_STATES.RECOVERY_REQUIRED, options); }
  async #mutate(mutator) { const run = this.queue.catch(() => undefined).then(async () => { if (!this.repository) { const draft = Object.fromEntries([...this.reservations].map(([k,v]) => [k, clone(v)])); const mutationDraft = Object.fromEntries([...this.mutations].map(([k,v]) => [k, clone(v)])); const quarantineDraft = Object.fromEntries([...this.quarantines].map(([k,v]) => [k, clone(v)])); const result = await mutator(draft, mutationDraft, quarantineDraft); this.reservations = new Map(Object.entries(draft)); this.mutations = new Map(Object.entries(mutationDraft)); this.quarantines = new Map(Object.entries(quarantineDraft)); return clone(result); } const result = await this.repository.mutate(this.repository.target, async draft => { draft.reservations ??= {}; draft.reservationMutations ??= {}; draft.resourceCapacityQuarantines ??= {}; const value = await mutator(draft.reservations, draft.reservationMutations, draft.resourceCapacityQuarantines); draft.reservations = clone(draft.reservations); draft.reservationMutations = clone(draft.reservationMutations); draft.resourceCapacityQuarantines = clone(draft.resourceCapacityQuarantines); return value; }); this.hydrate(result.runtime); return clone(result.value); }); this.queue = run; return run; }
}
