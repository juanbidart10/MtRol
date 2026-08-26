const AUDIT_JOURNAL_NAME = "MTROL — Historial de Comercio";
const AUDIT_FLAG_SCOPE = "mtrol";
const AUDIT_FLAG_KEY = "tradeAuditHistory";
export const TRADE_AUDIT_RETENTION = 500;

const RELEVANT_EVENTS = new Set([
  "create", "accept", "setOffer", "confirm", "invalidation", "cancel",
  "execute", "complete", "rollback", "disconnect", "externalMutation"
]);

function clone(value) {
  if (value === undefined) return undefined;
  return globalThis.foundry?.utils?.deepClone?.(value) ?? structuredClone(value);
}

function text(value, fallback = null) {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function sanitizeMessage(value) {
  return text(value)?.slice(0, 500) ?? null;
}

function requireGM(user = globalThis.game?.user) {
  if (!user?.isGM) throw new Error("El historial de comercio es exclusivo para GM.");
  return user;
}

function offerSnapshot(entry = {}, realQuantity = null) {
  return {
    itemUuid: text(entry.itemUuid),
    itemId: text(entry.itemId),
    name: text(entry.name, "Objeto"),
    img: text(entry.img),
    type: text(entry.type),
    tipoObjeto: text(entry.tipoObjeto, "general"),
    quantityOffered: Number(entry.quantity) || 0,
    realQuantity: Number.isFinite(Number(realQuantity)) ? Number(realQuantity) : null
  };
}

export class JournalTradeAuditStorage {
  constructor() {
    this.runtimeFallback = [];
  }

  async #document({ create = false } = {}) {
    const journal = globalThis.game?.journal?.find?.(entry => entry.name === AUDIT_JOURNAL_NAME) ?? null;
    if (journal || !create) return journal;
    if (!globalThis.JournalEntry?.create) throw new Error("JournalEntry no está disponible para persistir auditoría.");
    return JournalEntry.create({
      name: AUDIT_JOURNAL_NAME,
      ownership: { default: globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.NONE ?? 0 },
      flags: { [AUDIT_FLAG_SCOPE]: { [AUDIT_FLAG_KEY]: [] } }
    }, { renderSheet: false });
  }

  async read() {
    requireGM();
    const document = await this.#document();
    return clone(document?.getFlag?.(AUDIT_FLAG_SCOPE, AUDIT_FLAG_KEY) ?? this.runtimeFallback);
  }

  async write(records) {
    requireGM();
    if (!globalThis.JournalEntry?.create && !globalThis.game?.journal?.find?.(entry => entry.name === AUDIT_JOURNAL_NAME)) {
      this.runtimeFallback = clone(records);
      return clone(records);
    }
    const document = await this.#document({ create: true });
    await document.setFlag(AUDIT_FLAG_SCOPE, AUDIT_FLAG_KEY, clone(records));
    return clone(records);
  }
}

export class TradeAuditService {
  constructor({ storage = new JournalTradeAuditStorage(), now = () => Date.now(), retention = TRADE_AUDIT_RETENTION } = {}) {
    this.storage = storage;
    this.now = now;
    this.retention = Math.max(1, Number(retention) || TRADE_AUDIT_RETENTION);
    this.timelines = new Map();
    this.snapshots = new Map();
    this.confirmationSnapshots = new Map();
    this.writeQueue = Promise.resolve();
  }

  resetRuntime() {
    this.timelines.clear();
    this.snapshots.clear();
    this.confirmationSnapshots.clear();
  }

  recordEvent(session, type, details = {}) {
    if (!session?.id || !RELEVANT_EVENTS.has(type)) return false;
    const timeline = this.timelines.get(session.id) ?? [];
    timeline.push({
      at: this.now(),
      type,
      revision: Number(session.revision) || 0,
      participantKey: text(details.participantKey),
      itemUuid: text(details.itemUuid),
      quantity: Number.isFinite(Number(details.quantity)) ? Number(details.quantity) : null,
      message: sanitizeMessage(details.message)
    });
    this.timelines.set(session.id, timeline.slice(-100));
    this.capturePublicOffers(session);
    return true;
  }

  capturePublicOffers(session, realQuantities = {}) {
    if (!session?.id) return null;
    const previous = this.snapshots.get(session.id) ?? {};
    const snapshot = {};
    for (const key of ["participantA", "participantB"]) {
      const previousByUuid = new Map((previous[key] ?? []).map(entry => [entry.itemUuid, entry]));
      snapshot[key] = (session.publicOffers?.[key] ?? []).map(entry => {
        const hasReal = Object.prototype.hasOwnProperty.call(realQuantities, entry.itemUuid);
        return offerSnapshot(entry, hasReal
          ? realQuantities[entry.itemUuid]
          : previousByUuid.get(entry.itemUuid)?.realQuantity);
      });
    }
    this.snapshots.set(session.id, snapshot);
    const confirmations = session.confirmations ?? {};
    if (!this.confirmationSnapshots.has(session.id) ||
      Object.values(confirmations).some(entry => entry?.confirmed === true)) {
      this.confirmationSnapshots.set(session.id, clone(confirmations));
    }
    return clone(snapshot);
  }

  async captureCanonicalOffers(session, resolveDocument = uuid => globalThis.fromUuid?.(uuid)) {
    const quantities = {};
    for (const key of ["participantA", "participantB"]) {
      for (const entry of session?.publicOffers?.[key] ?? []) {
        const item = entry.itemUuid ? await resolveDocument(entry.itemUuid) : null;
        const quantity = item ? Number(getItemQuantity(item)) : NaN;
        if (Number.isFinite(quantity)) quantities[entry.itemUuid] = quantity;
      }
    }
    return this.capturePublicOffers(session, quantities);
  }

  buildRecord(session, { executionResult = null, rollback = null } = {}) {
    if (!session?.id) throw new Error("No se puede auditar una sesión inexistente.");
    const endedAt = session.completedAt ?? session.cancelledAt ?? session.invalidatedAt ?? session.updatedAt ?? this.now();
    const participant = key => ({
      userId: text(session.participants?.[key]?.userId),
      actorUuid: text(session.participants?.[key]?.actorUuid),
      actorName: text(session.participants?.[key]?.actorName, "Personaje"),
      tokenUuid: text(session.participants?.[key]?.tokenUuid)
    });
    const snapshots = this.snapshots.get(session.id) ?? this.capturePublicOffers(session);
    return {
      auditId: `trade-audit-${session.id}`,
      sessionId: session.id,
      executionId: text(session.execution?.executionId),
      authorityEpoch: text(session.authority?.epoch),
      startedAt: session.createdAt ?? null,
      endedAt,
      finalState: text(session.state),
      participantA: participant("participantA"),
      participantB: participant("participantB"),
      offerA: clone(snapshots?.participantA ?? []),
      offerB: clone(snapshots?.participantB ?? []),
      finalRevision: Number(session.revision) || 0,
      confirmations: clone(this.confirmationSnapshots.get(session.id) ?? session.confirmations ?? {}),
      cancelledByUserId: text(session.cancelledByUserId),
      cancelledByRole: text(session.cancelledByRole),
      cancelReason: sanitizeMessage(session.cancelReason),
      invalidReason: sanitizeMessage(session.invalidReason),
      executionResult: executionResult ? clone(executionResult) : null,
      rollback: {
        attempted: rollback?.attempted === true,
        succeeded: rollback?.succeeded === true,
        error: sanitizeMessage(rollback?.error)
      },
      timeline: clone(this.timelines.get(session.id) ?? [])
    };
  }

  async persistTerminal(session, options = {}) {
    requireGM();
    const record = this.buildRecord(session, options);
    this.writeQueue = this.writeQueue.then(async () => {
      const current = await this.storage.read();
      if (current.some(entry => entry.auditId === record.auditId)) return record;
      const records = [...current, record].slice(-this.retention);
      await this.storage.write(records);
      globalThis.Hooks?.callAll?.("mtrolTradeAuditCreated", clone(record));
      return record;
    });
    return this.writeQueue;
  }

  async getHistory({ state = null, actor = null, userId = null } = {}, user = globalThis.game?.user) {
    requireGM(user);
    const needle = text(actor, "")?.toLowerCase();
    return (await this.storage.read()).filter(record => {
      if (state && record.finalState !== state) return false;
      if (userId && ![record.participantA?.userId, record.participantB?.userId].includes(userId)) return false;
      if (needle && ![record.participantA?.actorName, record.participantB?.actorName]
        .some(name => String(name ?? "").toLowerCase().includes(needle))) return false;
      return true;
    }).reverse();
  }

  getTimeline(sessionId, user = globalThis.game?.user) {
    requireGM(user);
    return clone(this.timelines.get(String(sessionId ?? "")) ?? []);
  }
}

export const tradeAuditService = new TradeAuditService();
export { AUDIT_JOURNAL_NAME, AUDIT_FLAG_KEY, AUDIT_FLAG_SCOPE };
import { getItemQuantity } from "../items/item-invariants.js";
