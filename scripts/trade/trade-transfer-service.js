import {
  getItemQuantity,
  getItemWeightContribution,
  isItemActuallyEquipped,
  isMtrolObject,
  normalizeEquippedFlag
} from "../items/item-invariants.js";

const PARTICIPANT_KEYS = Object.freeze(["participantA", "participantB"]);

function clone(value) {
  if (value === undefined) return undefined;
  return globalThis.foundry?.utils?.deepClone?.(value) ??
    globalThis.foundry?.utils?.duplicate?.(value) ??
    structuredClone(value);
}

function requiredString(value, label) {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(`Falta ${label}.`);
  return result;
}

function findItem(actor, reference) {
  const itemId = String(reference?.itemId ?? "").trim();
  const itemUuid = String(reference?.itemUuid ?? "").trim();
  const byId = itemId ? actor?.items?.get?.(itemId) : null;
  if (byId && (!itemUuid || String(byId.uuid) === itemUuid)) return byId;
  return Array.from(actor?.items ?? []).find(item =>
    (!itemId || String(item.id) === itemId) && (!itemUuid || String(item.uuid) === itemUuid)
  ) ?? null;
}

function confirmationIsCurrent(session, participantKey) {
  const confirmation = session?.confirmations?.[participantKey];
  return confirmation?.confirmed === true && confirmation.revision === session.revision;
}

function reservationMatches(session, participantKey, entry) {
  return (session?.reservations ?? []).some(reservation =>
    reservation.sessionId === session.id &&
    reservation.participantKey === participantKey &&
    reservation.actorUuid === session.participants[participantKey].actorUuid &&
    reservation.itemUuid === entry.itemUuid &&
    reservation.itemId === entry.itemId &&
    reservation.quantity === entry.quantity
  );
}

function transferableItemData(item, quantity) {
  const data = clone(item.toObject?.() ?? item);
  delete data._id;
  delete data.id;
  delete data.uuid;
  delete data.parent;
  delete data.actor;
  delete data.ownership;
  delete data.folder;
  delete data.sort;
  delete data._stats;
  delete data.flags;

  data.system = clone(data.system ?? {});
  data.system.cantidad = quantity;
  data.system.equipado = false;
  data.system.slot = "";
  return data;
}

function sourceSnapshot(item) {
  return clone(item.toObject?.() ?? item);
}

function planFingerprint(plan) {
  return JSON.stringify({
    sessionId: plan.sessionId,
    executionId: plan.executionId,
    revision: plan.revision,
    entries: plan.entries.map(entry => ({
      participantKey: entry.participantKey,
      sourceActorUuid: entry.sourceActor.uuid,
      targetActorUuid: entry.targetActor.uuid,
      itemUuid: entry.item.uuid,
      quantity: entry.quantity,
      sourceQuantity: entry.sourceQuantity
    }))
  });
}

export async function prepareTradeTransferPlan({
  session,
  executionId,
  resolveActor
}) {
  if (session?.state !== "READY") throw new Error("Solo una sesión READY puede prevalidarse.");
  if (!PARTICIPANT_KEYS.every(key => confirmationIsCurrent(session, key))) {
    throw new Error("Ambas confirmaciones deben corresponder a la revisión vigente.");
  }
  if (typeof resolveActor !== "function") throw new Error("Falta el resolvedor de Actors.");

  const actors = {};
  for (const key of PARTICIPANT_KEYS) {
    const participant = session.participants?.[key];
    if (!participant?.userId || !participant?.actorUuid) {
      throw new Error("La sesión contiene un participante inválido.");
    }
    const actor = await resolveActor(participant.actorUuid);
    if (!actor || String(actor.uuid) !== String(participant.actorUuid)) {
      throw new Error("No se encontró un Actor participante.");
    }
    actors[key] = actor;
  }

  const entries = [];
  for (const participantKey of PARTICIPANT_KEYS) {
    const rivalKey = participantKey === "participantA" ? "participantB" : "participantA";
    const sourceActor = actors[participantKey];
    const targetActor = actors[rivalKey];

    for (const offer of session.offers?.[participantKey] ?? []) {
      const quantity = Number(offer.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new Error("La oferta contiene una cantidad inválida.");
      }
      if (!reservationMatches(session, participantKey, offer)) {
        throw new Error("La oferta no posee una reserva vigente equivalente.");
      }

      const item = findItem(sourceActor, offer);
      if (!item || !isMtrolObject(item)) throw new Error("Un Item ofrecido ya no existe.");
      const parentUuid = String(item.parent?.uuid ?? item.actor?.uuid ?? sourceActor.uuid ?? "");
      if (parentUuid !== String(sourceActor.uuid)) {
        throw new Error("Un Item ofrecido no pertenece al Actor participante.");
      }
      if (isItemActuallyEquipped(sourceActor, item) || normalizeEquippedFlag(item.system?.equipado)) {
        throw new Error("Un Item ofrecido está equipado.");
      }

      const sourceQuantity = getItemQuantity(item);
      if (!Number.isInteger(sourceQuantity) || sourceQuantity < quantity) {
        throw new Error("La cantidad real ya no cubre la oferta.");
      }

      entries.push({
        participantKey,
        sourceActor,
        targetActor,
        item,
        quantity,
        sourceQuantity,
        remainingQuantity: sourceQuantity - quantity,
        snapshot: sourceSnapshot(item),
        incomingData: transferableItemData(item, quantity)
      });
    }
  }

  return {
    sessionId: requiredString(session.id, "sessionId"),
    executionId: requiredString(executionId, "executionId"),
    revision: session.revision,
    entries,
    actors,
    preparedAt: Date.now()
  };
}

async function restoreSource(entry) {
  const current = entry.sourceActor.items?.get?.(entry.item.id) ?? null;
  if (current) {
    await entry.sourceActor.updateEmbeddedDocuments("Item", [{
      _id: entry.item.id,
      "system.cantidad": entry.sourceQuantity
    }], { render: false, mtrolTradeRollback: true });
    return;
  }

  await entry.sourceActor.createEmbeddedDocuments("Item", [entry.snapshot], {
    keepId: true,
    render: false,
    mtrolTradeRollback: true
  });
}

async function rollbackMutations(mutations) {
  const errors = [];

  for (const mutation of [...mutations.sources].reverse()) {
    try {
      await restoreSource(mutation.entry);
    } catch (error) {
      errors.push(error);
    }
  }

  for (const [actor, ids] of mutations.createdByActor.entries()) {
    if (!ids.length) continue;
    try {
      await actor.deleteEmbeddedDocuments("Item", ids, {
        render: false,
        mtrolTradeRollback: true
      });
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length) {
    const error = new Error("El rollback dirigido no pudo restaurar todos los Items afectados.");
    error.causes = errors;
    throw error;
  }
}

async function verifyCommittedPlan(plan, mutations) {
  for (const mutation of mutations.sources) {
    const { entry } = mutation;
    const source = entry.sourceActor.items?.get?.(entry.item.id) ?? null;
    if (entry.remainingQuantity === 0 && source) {
      throw new Error("La transferencia total no eliminó el Item origen.");
    }
    if (entry.remainingQuantity > 0 && getItemQuantity(source) !== entry.remainingQuantity) {
      throw new Error("La cantidad final del Item origen no coincide con el plan.");
    }
  }

  for (const created of mutations.created) {
    const current = created.actor.items?.get?.(created.item.id) ?? created.item;
    if (!current || getItemQuantity(current) !== created.entry.quantity) {
      throw new Error("La cantidad final del Item destino no coincide con el plan.");
    }
    if (normalizeEquippedFlag(current.system?.equipado) || String(current.system?.slot ?? "")) {
      throw new Error("El Item destino conserva referencias de equipamiento.");
    }
  }

  for (const actor of Object.values(plan.actors)) {
    const weight = Array.from(actor.items ?? []).reduce(
      (total, item) => total + getItemWeightContribution(item),
      0
    );
    if (!Number.isFinite(weight) || weight < 0) {
      throw new Error("El peso final del inventario no es válido.");
    }
  }
}

export class TradeTransferCoordinator {
  constructor() {
    this.receipts = new Map();
    this.inFlight = new Map();
  }

  getReceipt(executionId) {
    const receipt = this.receipts.get(String(executionId ?? ""));
    return receipt ? clone(receipt.result) : null;
  }

  async executePlan(plan) {
    const executionId = requiredString(plan?.executionId, "executionId");
    const fingerprint = planFingerprint(plan);
    const previous = this.receipts.get(executionId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        throw new Error("El executionId ya fue utilizado con otro plan.");
      }
      return clone(previous.result);
    }

    const running = this.inFlight.get(executionId);
    if (running) {
      if (running.fingerprint !== fingerprint) {
        throw new Error("El executionId está ejecutando otro plan.");
      }
      return clone(await running.promise);
    }

    const promise = this.#commit(plan, fingerprint);
    this.inFlight.set(executionId, { fingerprint, promise });
    try {
      return clone(await promise);
    } finally {
      this.inFlight.delete(executionId);
    }
  }

  async #commit(plan, fingerprint) {
    const mutations = {
      created: [],
      createdByActor: new Map(),
      sources: []
    };

    try {
      for (const entry of plan.entries) {
        const [created] = await entry.targetActor.createEmbeddedDocuments(
          "Item",
          [entry.incomingData],
          { render: false, mtrolTradeExecutionId: plan.executionId }
        );
        if (!created?.id) throw new Error("Foundry no devolvió el Item destino creado.");
        mutations.created.push({ actor: entry.targetActor, item: created, entry });
        const ids = mutations.createdByActor.get(entry.targetActor) ?? [];
        ids.push(created.id);
        mutations.createdByActor.set(entry.targetActor, ids);
      }

      for (const entry of plan.entries) {
        if (entry.remainingQuantity === 0) {
          await entry.sourceActor.deleteEmbeddedDocuments(
            "Item",
            [entry.item.id],
            { render: false, mtrolTradeExecutionId: plan.executionId }
          );
          mutations.sources.push({ kind: "deleted", entry });
        } else {
          await entry.sourceActor.updateEmbeddedDocuments("Item", [{
            _id: entry.item.id,
            "system.cantidad": entry.remainingQuantity
          }], { render: false, mtrolTradeExecutionId: plan.executionId });
          mutations.sources.push({ kind: "updated", entry });
        }
      }

      await verifyCommittedPlan(plan, mutations);
      const result = {
        ok: true,
        sessionId: plan.sessionId,
        executionId: plan.executionId,
        revision: plan.revision,
        transferredEntries: plan.entries.length,
        createdItemIds: mutations.created.map(created => created.item.id)
      };
      this.receipts.set(plan.executionId, { fingerprint, result: clone(result) });
      return result;
    } catch (cause) {
      let rollbackError = null;
      try {
        await rollbackMutations(mutations);
      } catch (error) {
        rollbackError = error;
      }
      const failure = new Error(
        rollbackError
          ? `La transferencia falló y el rollback quedó incompleto: ${cause.message}`
          : `La transferencia falló y fue revertida: ${cause.message}`
      );
      failure.cause = cause;
      failure.rollbackSucceeded = !rollbackError;
      failure.rollbackError = rollbackError;
      throw failure;
    }
  }
}

export const tradeTransferCoordinator = new TradeTransferCoordinator();
