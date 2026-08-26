export const TRADE_SESSION_STATES = Object.freeze({
  REQUESTED: "REQUESTED",
  NEGOTIATING: "NEGOTIATING",
  READY: "READY",
  EXECUTING: "EXECUTING",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  INVALID: "INVALID"
});

export const TRADE_PARTICIPANT_KEYS = Object.freeze([
  "participantA",
  "participantB"
]);

const ACTIVE_STATES = new Set([
  TRADE_SESSION_STATES.REQUESTED,
  TRADE_SESSION_STATES.NEGOTIATING,
  TRADE_SESSION_STATES.READY,
  TRADE_SESSION_STATES.EXECUTING
]);

const MUTABLE_OFFER_STATES = new Set([
  TRADE_SESSION_STATES.NEGOTIATING,
  TRADE_SESSION_STATES.READY
]);

function clone(value) {
  if (value === undefined) return undefined;
  return globalThis.foundry?.utils?.deepClone?.(value) ??
    globalThis.foundry?.utils?.duplicate?.(value) ??
    structuredClone(value);
}

function defaultIdFactory() {
  return globalThis.foundry?.utils?.randomID?.() ?? crypto.randomUUID();
}

function defaultNow() {
  return Date.now();
}

function normalizeRequiredString(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new TypeError(`Falta ${label}.`);
  return normalized;
}

function normalizeQuantity(value) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity <= 0) {
    throw new RangeError("La cantidad reservada debe ser un entero mayor que cero.");
  }
  return quantity;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, stableValue(value[key])])
  );
}

function operationFingerprint(action, payload) {
  return JSON.stringify(stableValue({ action, payload }));
}

function itemReferenceKey(reference) {
  const actorUuid = normalizeRequiredString(reference?.actorUuid, "actorUuid de la reserva");
  const itemUuid = String(reference?.itemUuid ?? "").trim();
  const itemId = String(reference?.itemId ?? "").trim();

  if (!itemUuid && !itemId) {
    throw new TypeError("La reserva necesita itemUuid o itemId.");
  }

  return itemUuid || `${actorUuid}::${itemId}`;
}

function normalizeParticipant(participant, key) {
  return {
    key,
    userId: normalizeRequiredString(participant?.userId, `userId de ${key}`),
    actorUuid: normalizeRequiredString(participant?.actorUuid, `actorUuid de ${key}`),
    actorName: String(participant?.actorName ?? "").trim(),
    actorImg: String(participant?.actorImg ?? "").trim() || "icons/svg/mystery-man.svg",
    tokenUuid: String(participant?.tokenUuid ?? "").trim() || null
  };
}

function emptyConfirmation() {
  return {
    confirmed: false,
    revision: null,
    confirmedAt: null
  };
}

function normalizeOfferEntries(entries, participant) {
  if (!Array.isArray(entries)) throw new TypeError("La oferta debe ser un arreglo.");

  const aggregated = new Map();

  for (const rawEntry of entries) {
    const reference = {
      actorUuid: participant.actorUuid,
      itemUuid: String(rawEntry?.itemUuid ?? "").trim() || null,
      itemId: String(rawEntry?.itemId ?? "").trim() || null
    };
    const key = itemReferenceKey(reference);
    const quantity = normalizeQuantity(rawEntry?.quantity);
    const current = aggregated.get(key);

    if (current) {
      current.quantity += quantity;
    } else {
      aggregated.set(key, {
        ...reference,
        quantity
      });
    }
  }

  return [...aggregated.values()].sort((left, right) =>
    itemReferenceKey(left).localeCompare(itemReferenceKey(right))
  );
}

function offersEqual(left, right) {
  return operationFingerprint("offer", left) === operationFingerprint("offer", right);
}

export class TradeSession {
  constructor({
    id,
    authority,
    participantA,
    participantB,
    createdAt
  }) {
    this.id = normalizeRequiredString(id, "sessionId");
    this.state = TRADE_SESSION_STATES.REQUESTED;
    this.authority = {
      gmUserId: normalizeRequiredString(authority?.gmUserId, "GM autoritativo"),
      epoch: normalizeRequiredString(authority?.epoch, "epoch de autoridad")
    };
    this.participants = {
      participantA: normalizeParticipant(participantA, "participantA"),
      participantB: normalizeParticipant(participantB, "participantB")
    };
    this.revision = 0;
    this.offers = {
      participantA: [],
      participantB: []
    };
    this.publicOffers = {
      participantA: [],
      participantB: []
    };
    this.confirmations = {
      participantA: emptyConfirmation(),
      participantB: emptyConfirmation()
    };
    this.reservations = [];
    this.invalidEntries = [];
    this.appliedOperations = [];
    this.createdAt = createdAt;
    this.updatedAt = createdAt;
    this.completedAt = null;
    this.cancelledAt = null;
    this.cancelledByUserId = null;
    this.cancelledByRole = null;
    this.cancelReason = null;
    this.invalidatedAt = null;
    this.invalidReason = null;
    this.execution = {
      executionId: null,
      revision: null,
      status: null,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      failureReason: null
    };
  }

  toObject() {
    return clone(this);
  }
}

export class TradeSessionStore {
  constructor({
    idFactory = defaultIdFactory,
    now = defaultNow,
    resolveRealQuantity = null,
    resolveOfferItem = null,
    onSessionCreated = null
  } = {}) {
    this.idFactory = idFactory;
    this.now = now;
    this.resolveRealQuantity = resolveRealQuantity;
    this.resolveOfferItem = resolveOfferItem;
    this.onSessionCreated = onSessionCreated;
    this.sessions = new Map();
    this.activeSessionByActor = new Map();
    this.reservationsByItem = new Map();
    this.operationReceipts = new Map();
    this.authority = { gmUserId: null, epoch: null };
  }

  setQuantityResolver(resolveRealQuantity) {
    this.resolveRealQuantity = resolveRealQuantity;
  }

  setOfferItemResolver(resolveOfferItem) {
    this.resolveOfferItem = resolveOfferItem;
  }

  getSession(sessionId) {
    const session = this.sessions.get(String(sessionId ?? ""));
    return session?.toObject?.() ?? clone(session) ?? null;
  }

  listSessions({ activeOnly = false } = {}) {
    return [...this.sessions.values()]
      .filter(session => !activeOnly || ACTIVE_STATES.has(session.state))
      .map(session => session.toObject());
  }

  getActiveSessionIdForActor(actorUuid) {
    return this.activeSessionByActor.get(String(actorUuid ?? "")) ?? null;
  }

  getReservationsForSession(sessionId) {
    return clone(this.sessions.get(String(sessionId ?? ""))?.reservations ?? []);
  }

  getReservationsForActorItem(actorUuid, itemReference) {
    const reference = {
      actorUuid,
      itemUuid: itemReference?.itemUuid,
      itemId: itemReference?.itemId
    };
    const key = itemReferenceKey(reference);
    const reservations = this.reservationsByItem.get(key);
    return reservations
      ? clone([...reservations.values()].filter(reservation =>
          reservation.actorUuid === String(actorUuid ?? "")
        ))
      : [];
  }

  getReservedQuantity(actorUuid, itemReference, { excludeSessionId = null } = {}) {
    return this.getReservationsForActorItem(actorUuid, itemReference)
      .filter(reservation => reservation.sessionId !== excludeSessionId)
      .reduce((total, reservation) => total + reservation.quantity, 0);
  }

  async getAvailability(actorUuid, itemReference, { sessionId = null } = {}) {
    if (typeof this.resolveRealQuantity !== "function") {
      throw new Error("No existe un resolvedor de cantidad real para el comercio.");
    }

    const reference = {
      actorUuid,
      itemUuid: itemReference?.itemUuid,
      itemId: itemReference?.itemId
    };
    const real = Number(await this.resolveRealQuantity(reference));
    if (!Number.isFinite(real) || real < 0) {
      throw new RangeError("La cantidad real del Item no es válida.");
    }

    const reservations = this.getReservationsForActorItem(actorUuid, reference);
    const reserved = reservations.reduce(
      (total, reservation) => total + reservation.quantity,
      0
    );
    const reservedBySession = reservations
      .filter(reservation => reservation.sessionId === sessionId)
      .reduce((total, reservation) => total + reservation.quantity, 0);

    return {
      actorUuid: String(actorUuid),
      itemUuid: reference.itemUuid ?? null,
      itemId: reference.itemId ?? null,
      real,
      reserved,
      reservedBySession,
      available: Math.max(0, real - reserved),
      availableIncludingSession: Math.max(0, real - reserved + reservedBySession)
    };
  }

  async createSession({
    participantA,
    participantB,
    authority,
    operationId
  }) {
    return this.#runIdempotent("create-session", operationId, {
      participantA,
      participantB,
      authority
    }, async () => {
      const normalizedA = normalizeParticipant(participantA, "participantA");
      const normalizedB = normalizeParticipant(participantB, "participantB");

      if (normalizedA.actorUuid === normalizedB.actorUuid) {
        throw new Error("Los participantes deben utilizar Actors distintos.");
      }
      if (normalizedA.userId === normalizedB.userId) {
        throw new Error("Los participantes deben ser usuarios distintos.");
      }

      for (const participant of [normalizedA, normalizedB]) {
        if (this.activeSessionByActor.has(participant.actorUuid)) {
          throw new Error("Uno de los Actors ya participa de un comercio activo.");
        }
      }

      const session = new TradeSession({
        id: this.idFactory(),
        authority,
        participantA: normalizedA,
        participantB: normalizedB,
        createdAt: this.now()
      });

      try {
        this.sessions.set(session.id, session);
        this.activeSessionByActor.set(normalizedA.actorUuid, session.id);
        this.activeSessionByActor.set(normalizedB.actorUuid, session.id);
        await this.onSessionCreated?.(session.toObject());
        this.#recordOperation(session, operationId);
        return session.toObject();
      } catch (error) {
        this.sessions.delete(session.id);
        this.#releaseSessionResources(session);
        throw error;
      }
    });
  }

  async acceptSession({ sessionId, participantKey = "participantB", requestingUserId, operationId }) {
    return this.#runSessionMutation("accept-session", operationId, {
      sessionId,
      participantKey,
      requestingUserId
    }, async session => {
      this.#assertParticipant(session, participantKey, requestingUserId);
      if (participantKey !== "participantB") {
        throw new Error("La solicitud debe aceptarla participantB.");
      }
      if (session.state !== TRADE_SESSION_STATES.REQUESTED) {
        throw new Error("La sesión ya no está pendiente de aceptación.");
      }

      session.state = TRADE_SESSION_STATES.NEGOTIATING;
      session.updatedAt = this.now();
      return session.toObject();
    });
  }

  async setOffer({ sessionId, participantKey, requestingUserId, entries, operationId }) {
    return this.#runSessionMutation("set-offer", operationId, {
      sessionId,
      participantKey,
      requestingUserId,
      entries
    }, async session => {
      const participant = this.#assertParticipant(session, participantKey, requestingUserId);
      if (!MUTABLE_OFFER_STATES.has(session.state)) {
        throw new Error("La sesión no admite cambios de oferta en su estado actual.");
      }

      const normalizedEntries = normalizeOfferEntries(entries, participant);
      const publicEntries = [];
      const hadInvalidEntries = session.invalidEntries.some(entry =>
        entry.participantKey === participantKey
      );

      for (const entry of normalizedEntries) {
        const resolved = typeof this.resolveOfferItem === "function"
          ? await this.resolveOfferItem({
              actorUuid: participant.actorUuid,
              itemUuid: entry.itemUuid,
              itemId: entry.itemId,
              quantity: entry.quantity
            })
          : null;
        const availability = await this.getAvailability(participant.actorUuid, entry, {
          sessionId: session.id
        });
        if (entry.quantity > availability.availableIncludingSession) {
          throw new Error("La cantidad ofrecida supera la disponibilidad real del Item.");
        }
        if (resolved?.publicSnapshot) publicEntries.push(clone(resolved.publicSnapshot));
      }

      if (offersEqual(session.offers[participantKey], normalizedEntries) && !hadInvalidEntries) {
        return session.toObject();
      }

      session.offers[participantKey] = clone(normalizedEntries);
      session.publicOffers[participantKey] = publicEntries;
      session.invalidEntries = session.invalidEntries.filter(entry =>
        entry.participantKey !== participantKey
      );
      session.revision += 1;
      session.state = TRADE_SESSION_STATES.NEGOTIATING;
      session.confirmations.participantA = emptyConfirmation();
      session.confirmations.participantB = emptyConfirmation();
      session.updatedAt = this.now();
      this.#rebuildSessionReservations(session);

      return session.toObject();
    });
  }

  async confirmSession({
    sessionId,
    participantKey,
    requestingUserId,
    revision,
    operationId
  }) {
    return this.#runSessionMutation("confirm-session", operationId, {
      sessionId,
      participantKey,
      requestingUserId,
      revision
    }, async session => {
      this.#assertParticipant(session, participantKey, requestingUserId);
      if (![TRADE_SESSION_STATES.NEGOTIATING, TRADE_SESSION_STATES.READY].includes(session.state)) {
        throw new Error("La sesión no admite confirmaciones en su estado actual.");
      }
      if (session.invalidEntries.length) {
        throw new Error("La oferta contiene entradas inválidas que deben corregirse.");
      }
      if (Number(revision) !== session.revision) {
        throw new Error("La confirmación no corresponde a la revisión vigente.");
      }

      session.confirmations[participantKey] = {
        confirmed: true,
        revision: session.revision,
        confirmedAt: this.now()
      };

      const bothCurrent = TRADE_PARTICIPANT_KEYS.every(key => {
        const confirmation = session.confirmations[key];
        return confirmation.confirmed === true && confirmation.revision === session.revision;
      });

      session.state = bothCurrent
        ? TRADE_SESSION_STATES.READY
        : TRADE_SESSION_STATES.NEGOTIATING;
      session.updatedAt = this.now();
      return session.toObject();
    });
  }

  async cancelSession({ sessionId, participantKey, requestingUserId, operationId }) {
    return this.#runSessionMutation("cancel-session", operationId, {
      sessionId,
      participantKey,
      requestingUserId
    }, async session => {
      this.#assertParticipant(session, participantKey, requestingUserId);
      if (session.state === TRADE_SESSION_STATES.CANCELLED) return session.toObject();
      if (session.state === TRADE_SESSION_STATES.EXECUTING) {
        throw new Error("Una ejecución en curso no puede cancelarse manualmente.");
      }
      if ([TRADE_SESSION_STATES.COMPLETED, TRADE_SESSION_STATES.INVALID].includes(session.state)) {
        throw new Error("La sesión ya terminó y no puede cancelarse.");
      }

      this.#finishSession(session, TRADE_SESSION_STATES.CANCELLED);
      session.cancelledByUserId = String(requestingUserId);
      session.cancelledByRole = "PLAYER";
      session.cancelReason = "participant-cancelled";
      return session.toObject();
    });
  }

  async cancelSessionByGM({ sessionId, authorityUserId, requestingUserId, reason, operationId }) {
    return this.#runSessionMutation("cancel-session-by-gm", operationId, {
      sessionId,
      authorityUserId,
      requestingUserId,
      reason: String(reason ?? "Cancelado por GM")
    }, async session => {
      this.#assertAuthority(session, authorityUserId);
      if (session.state === TRADE_SESSION_STATES.CANCELLED) return session.toObject();
      if (session.state === TRADE_SESSION_STATES.EXECUTING) {
        throw new Error("Una ejecución en curso no puede cancelarse manualmente.");
      }
      if ([TRADE_SESSION_STATES.COMPLETED, TRADE_SESSION_STATES.INVALID].includes(session.state)) {
        throw new Error("La sesión ya terminó y no puede cancelarse.");
      }
      this.#finishSession(session, TRADE_SESSION_STATES.CANCELLED);
      session.cancelledByUserId = normalizeRequiredString(requestingUserId, "GM que cancela");
      session.cancelledByRole = "GM";
      session.cancelReason = String(reason ?? "Cancelado por GM").trim().slice(0, 500) || "Cancelado por GM";
      return session.toObject();
    });
  }

  async beginExecution({ sessionId, authorityUserId, executionId, revision, operationId }) {
    return this.#runSessionMutation("begin-execution", operationId, {
      sessionId,
      authorityUserId,
      executionId,
      revision
    }, async session => {
      this.#assertAuthority(session, authorityUserId);
      if (session.state !== TRADE_SESSION_STATES.READY) {
        throw new Error("Solo una sesión READY puede comenzar a ejecutarse.");
      }
      if (Number(revision) !== session.revision) {
        throw new Error("La ejecución no corresponde a la revisión vigente.");
      }
      const bothCurrent = TRADE_PARTICIPANT_KEYS.every(key => {
        const confirmation = session.confirmations[key];
        return confirmation.confirmed === true && confirmation.revision === session.revision;
      });
      if (!bothCurrent) throw new Error("Ambos participantes deben confirmar la revisión vigente.");

      session.state = TRADE_SESSION_STATES.EXECUTING;
      session.updatedAt = this.now();
      session.execution = {
        executionId: normalizeRequiredString(executionId, "executionId"),
        revision: session.revision,
        status: TRADE_SESSION_STATES.EXECUTING,
        startedAt: session.updatedAt,
        completedAt: null,
        failedAt: null,
        failureReason: null
      };
      return session.toObject();
    });
  }

  async completeSession({ sessionId, authorityUserId, executionId, operationId }) {
    return this.#runSessionMutation("complete-session", operationId, {
      sessionId,
      authorityUserId,
      executionId
    }, async session => {
      this.#assertAuthority(session, authorityUserId);
      if (session.state === TRADE_SESSION_STATES.COMPLETED) return session.toObject();
      if (session.state !== TRADE_SESSION_STATES.EXECUTING) {
        throw new Error("Solo una sesión EXECUTING puede completarse.");
      }
      if (session.execution?.executionId !== String(executionId ?? "")) {
        throw new Error("El executionId no corresponde a la ejecución activa.");
      }
      session.execution.status = TRADE_SESSION_STATES.COMPLETED;
      session.execution.completedAt = this.now();
      this.#finishSession(session, TRADE_SESSION_STATES.COMPLETED);
      return session.toObject();
    });
  }

  async failExecution({ sessionId, authorityUserId, executionId, reason, operationId }) {
    return this.#runSessionMutation("fail-execution", operationId, {
      sessionId,
      authorityUserId,
      executionId,
      reason
    }, async session => {
      this.#assertAuthority(session, authorityUserId);
      if (session.state !== TRADE_SESSION_STATES.EXECUTING) {
        throw new Error("Solo una sesión EXECUTING puede registrar un fallo.");
      }
      if (session.execution?.executionId !== String(executionId ?? "")) {
        throw new Error("El executionId no corresponde a la ejecución activa.");
      }
      session.execution.status = TRADE_SESSION_STATES.INVALID;
      session.execution.failedAt = this.now();
      session.execution.failureReason = String(reason ?? "execution-failed");
      this.#finishSession(session, TRADE_SESSION_STATES.INVALID, reason ?? "execution-failed");
      return session.toObject();
    });
  }

  async invalidateOfferEntry({
    sessionId,
    authorityUserId,
    participantKey,
    itemUuid,
    itemId,
    reason,
    operationId
  }) {
    return this.#runSessionMutation("invalidate-offer-entry", operationId, {
      sessionId,
      authorityUserId,
      participantKey,
      itemUuid,
      itemId,
      reason
    }, async session => {
      this.#assertAuthority(session, authorityUserId);
      if (![TRADE_SESSION_STATES.NEGOTIATING, TRADE_SESSION_STATES.READY].includes(session.state)) {
        return session.toObject();
      }
      const offer = (session.offers?.[participantKey] ?? []).find(entry =>
        (itemUuid && entry.itemUuid === itemUuid) || (itemId && entry.itemId === itemId)
      );
      if (!offer) return session.toObject();
      const alreadyInvalid = session.invalidEntries.some(entry =>
        entry.participantKey === participantKey &&
        entry.itemUuid === offer.itemUuid &&
        entry.itemId === offer.itemId &&
        entry.reason === String(reason ?? "external-mutation")
      );
      if (alreadyInvalid) return session.toObject();

      session.invalidEntries = session.invalidEntries.filter(entry => !(
        entry.participantKey === participantKey &&
        entry.itemUuid === offer.itemUuid &&
        entry.itemId === offer.itemId
      ));
      session.invalidEntries.push({
        participantKey,
        itemUuid: offer.itemUuid,
        itemId: offer.itemId,
        quantity: offer.quantity,
        reason: String(reason ?? "external-mutation"),
        invalidatedAt: this.now()
      });
      session.revision += 1;
      session.state = TRADE_SESSION_STATES.NEGOTIATING;
      session.confirmations.participantA = emptyConfirmation();
      session.confirmations.participantB = emptyConfirmation();
      session.updatedAt = this.now();
      this.#rebuildSessionReservations(session);
      return session.toObject();
    });
  }

  async finishForLifecycle({ sessionId, authorityUserId, state, reason, operationId }) {
    return this.#runSessionMutation("finish-for-lifecycle", operationId, {
      sessionId,
      authorityUserId,
      state,
      reason
    }, async session => {
      this.#assertAuthority(session, authorityUserId);
      if (!ACTIVE_STATES.has(session.state)) return session.toObject();
      if (session.state === TRADE_SESSION_STATES.EXECUTING) {
        throw new Error("Una sesión EXECUTING debe resolverse por su coordinador transaccional.");
      }
      const terminalState = state === TRADE_SESSION_STATES.CANCELLED
        ? TRADE_SESSION_STATES.CANCELLED
        : TRADE_SESSION_STATES.INVALID;
      this.#finishSession(session, terminalState, reason);
      return session.toObject();
    });
  }

  async invalidateSession({ sessionId, authorityUserId, reason, operationId }) {
    return this.#runSessionMutation("invalidate-session", operationId, {
      sessionId,
      authorityUserId,
      reason
    }, async session => {
      this.#assertAuthority(session, authorityUserId);
      if (session.state === TRADE_SESSION_STATES.INVALID) return session.toObject();
      if ([TRADE_SESSION_STATES.COMPLETED, TRADE_SESSION_STATES.CANCELLED].includes(session.state)) {
        throw new Error("La sesión ya terminó y no puede invalidarse.");
      }
      this.#finishSession(session, TRADE_SESSION_STATES.INVALID, reason);
      return session.toObject();
    });
  }

  reconcileAuthority({ gmUserId, epoch, reason = "authority-changed" } = {}) {
    const normalizedGmId = String(gmUserId ?? "").trim() || null;
    const normalizedEpoch = String(epoch ?? "").trim() || null;
    const unchanged = this.authority.gmUserId === normalizedGmId &&
      this.authority.epoch === normalizedEpoch;
    if (unchanged) return [];

    const invalidated = [];
    for (const session of this.sessions.values()) {
      if (!ACTIVE_STATES.has(session.state)) continue;
      this.#finishSession(session, TRADE_SESSION_STATES.INVALID, reason);
      invalidated.push(session.toObject());
    }

    this.authority = {
      gmUserId: normalizedGmId,
      epoch: normalizedEpoch
    };
    return invalidated;
  }

  reset() {
    this.sessions.clear();
    this.activeSessionByActor.clear();
    this.reservationsByItem.clear();
    this.operationReceipts.clear();
    this.authority = { gmUserId: null, epoch: null };
  }

  async #runSessionMutation(action, operationId, payload, operation) {
    return this.#runIdempotent(action, operationId, payload, async () => {
      const session = this.sessions.get(normalizeRequiredString(payload.sessionId, "sessionId"));
      if (!session) throw new Error("La sesión de comercio no existe.");
      await operation(session);
      this.#recordOperation(session, operationId);
      return session.toObject();
    });
  }

  async #runIdempotent(action, operationId, payload, operation) {
    const normalizedOperationId = normalizeRequiredString(operationId, "operationId");
    const fingerprint = operationFingerprint(action, payload);
    const previous = this.operationReceipts.get(normalizedOperationId);

    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        throw new Error("El operationId ya fue utilizado con otro payload.");
      }
      return clone(previous.result);
    }

    const result = await operation();
    this.operationReceipts.set(normalizedOperationId, {
      action,
      fingerprint,
      result: clone(result)
    });
    return clone(result);
  }

  #assertParticipant(session, participantKey, requestingUserId) {
    if (!TRADE_PARTICIPANT_KEYS.includes(participantKey)) {
      throw new Error("Participante de comercio inválido.");
    }
    const participant = session.participants[participantKey];
    if (participant.userId !== String(requestingUserId ?? "")) {
      throw new Error("El usuario no puede actuar como ese participante.");
    }
    return participant;
  }

  #assertAuthority(session, authorityUserId) {
    if (session.authority.gmUserId !== String(authorityUserId ?? "")) {
      throw new Error("El usuario no es la autoridad de esta sesión.");
    }
  }

  #recordOperation(session, operationId) {
    if (!session.appliedOperations.includes(operationId)) {
      session.appliedOperations.push(operationId);
    }
  }

  #rebuildSessionReservations(session) {
    this.#removeReservationsForSession(session.id);
    session.reservations = [];

    for (const participantKey of TRADE_PARTICIPANT_KEYS) {
      for (const entry of session.offers[participantKey]) {
        const invalid = session.invalidEntries.some(candidate =>
          candidate.participantKey === participantKey &&
          candidate.itemUuid === entry.itemUuid &&
          candidate.itemId === entry.itemId
        );
        if (invalid) continue;
        const reservation = {
          sessionId: session.id,
          participantKey,
          actorUuid: session.participants[participantKey].actorUuid,
          itemUuid: entry.itemUuid ?? null,
          itemId: entry.itemId ?? null,
          quantity: entry.quantity
        };
        const key = itemReferenceKey(reservation);
        const itemReservations = this.reservationsByItem.get(key) ?? new Map();
        itemReservations.set(session.id, reservation);
        this.reservationsByItem.set(key, itemReservations);
        session.reservations.push(reservation);
      }
    }
  }

  #removeReservationsForSession(sessionId) {
    for (const [key, reservations] of this.reservationsByItem.entries()) {
      reservations.delete(sessionId);
      if (!reservations.size) this.reservationsByItem.delete(key);
    }
  }

  #releaseSessionResources(session) {
    for (const participant of Object.values(session.participants ?? {})) {
      if (this.activeSessionByActor.get(participant.actorUuid) === session.id) {
        this.activeSessionByActor.delete(participant.actorUuid);
      }
    }
    this.#removeReservationsForSession(session.id);
    session.reservations = [];
  }

  #finishSession(session, state, reason = null) {
    session.state = state;
    session.updatedAt = this.now();
    session.confirmations.participantA = emptyConfirmation();
    session.confirmations.participantB = emptyConfirmation();

    if (state === TRADE_SESSION_STATES.COMPLETED) session.completedAt = session.updatedAt;
    if (state === TRADE_SESSION_STATES.CANCELLED) session.cancelledAt = session.updatedAt;
    if (state === TRADE_SESSION_STATES.INVALID) {
      session.invalidatedAt = session.updatedAt;
      session.invalidReason = String(reason ?? "invalid-session");
    }

    this.#releaseSessionResources(session);
  }
}
