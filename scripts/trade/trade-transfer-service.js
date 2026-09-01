import {
  getItemQuantity,
  getItemWeightContribution,
  isItemActuallyEquipped,
  isMtrolObject,
  normalizeEquippedFlag
} from "../items/item-invariants.js";
import { transactionCoordinator } from "../runtime/runtime-foundation.js";
import { tradeReceiptScope } from "./trade-runtime-repository.js";

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

function serializePlan(plan) {
  return {
    sessionId: plan.sessionId,
    executionId: plan.executionId,
    revision: plan.revision,
    entries: plan.entries.map((entry, index) => ({
      entryKey: `${index}:${entry.participantKey}:${entry.item.uuid}`,
      participantKey: entry.participantKey,
      sourceActorUuid: entry.sourceActor.uuid,
      targetActorUuid: entry.targetActor.uuid,
      itemId: entry.item.id,
      itemUuid: entry.item.uuid,
      quantity: entry.quantity,
      sourceQuantity: entry.sourceQuantity,
      remainingQuantity: entry.remainingQuantity,
      snapshot: clone(entry.snapshot),
      incomingData: clone(entry.incomingData)
    }))
  };
}

async function hydratePlan(serialized) {
  const actors = {};
  const entries = [];
  for (const raw of serialized?.entries ?? []) {
    const sourceActor = await fromUuid(raw.sourceActorUuid);
    const targetActor = await fromUuid(raw.targetActorUuid);
    if (!sourceActor || !targetActor) throw new Error("No se pudieron recuperar los Actors del comercio.");
    const item = sourceActor.items?.get?.(raw.itemId) ?? {
      id: raw.itemId,
      uuid: raw.itemUuid,
      system: clone(raw.snapshot?.system ?? {})
    };
    actors[raw.participantKey] = sourceActor;
    entries.push({ ...clone(raw), sourceActor, targetActor, item });
  }
  return { ...clone(serialized), entries, actors };
}

function transferredItem(actor, executionId, entryKey, itemId = null) {
  return Array.from(actor?.items ?? []).find(item =>
    (itemId && item.id === itemId) || (
      item.flags?.mtrol?.tradeTransfer?.executionId === executionId &&
      item.flags?.mtrol?.tradeTransfer?.entryKey === entryKey
    )
  ) ?? null;
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

async function verifyPlanState(plan, checkpoints = {}, createdForEntry = new Map()) {
  for (const [index, entry] of plan.entries.entries()) {
    const entryKey = entry.entryKey ?? `${index}:${entry.participantKey}:${entry.item.uuid}`;
    const source = entry.sourceActor.items?.get?.(entry.item.id) ?? null;
    if (entry.remainingQuantity === 0 && source) {
      throw new Error("La transferencia total no eliminó el Item origen.");
    }
    if (entry.remainingQuantity > 0 && getItemQuantity(source) !== entry.remainingQuantity) {
      throw new Error("La cantidad final del Item origen no coincide con el plan.");
    }
    const credit = createdForEntry.get(entryKey) ?? transferredItem(
      entry.targetActor,
      plan.executionId,
      entryKey,
      checkpoints[`credit:${entryKey}`]?.itemId
    );
    if (!credit || getItemQuantity(credit) !== entry.quantity) {
      throw new Error("La cantidad final del Item destino no coincide con el plan.");
    }
  }
}

export class TradeTransferCoordinator {
  constructor({ coordinator = transactionCoordinator, receiptScope = tradeReceiptScope } = {}) {
    this.coordinator = coordinator;
    this.receiptScope = receiptScope;
  }

  getReceipt(executionId) {
    return clone(this.coordinator.get({ receiptScope: this.receiptScope }, String(executionId ?? ""))?.result ?? null);
  }

  async executePlan(plan) {
    const executionId = requiredString(plan?.executionId, "executionId");
    const fingerprint = planFingerprint(plan);
    const scope = { receiptScope: this.receiptScope };
    const previous = this.coordinator.get(scope, executionId);
    if (previous?.prepared?.fingerprint && previous.prepared.fingerprint !== fingerprint) {
      throw new Error("El executionId ya fue utilizado con otro plan.");
    }
    const serialized = serializePlan(plan);
    return this.coordinator.execute(scope, {
      transactionId: executionId,
      command: "trade.commit",
      serializationKey: `trade:${plan.sessionId}`,
      prepare: async () => ({ fingerprint, plan: serialized }),
      apply: ({ checkpoint }) => this.#commit(plan, checkpoint),
      reconcile: receipt => this.#reconcile(receipt)
    });
  }

  async recoverExecution(executionId) {
    const transactionId = requiredString(executionId, "executionId");
    const receipt = this.coordinator.get({ receiptScope: this.receiptScope }, transactionId);
    if (!receipt) throw new Error("No existe receipt persistente para recuperar el comercio.");
    if (receipt.status === "completed") return clone(receipt.result);
    return this.coordinator.execute({ receiptScope: this.receiptScope }, {
      transactionId,
      command: "trade.commit",
      serializationKey: `trade:${receipt.prepared?.plan?.sessionId ?? "unknown"}`,
      apply: async () => {
        throw new Error("Recovery Trade no puede iniciar una aplicación nueva sin plan preparado.");
      },
      reconcile: current => this.#reconcile(current)
    });
  }

  async #reconcile(receipt) {
    if (receipt.status === "applied" && receipt.result) {
      return { resolved: true, result: receipt.result };
    }
    if (!receipt.prepared?.plan) return { resolved: false };
    const plan = await hydratePlan(receipt.prepared.plan);
    const result = await this.#commit(plan, async () => undefined, receipt.checkpoints ?? {});
    return { resolved: true, result: { ...result, recovered: true } };
  }

  async #commit(plan, checkpoint, existingCheckpoints = {}) {
    const mutations = {
      created: [],
      createdByActor: new Map(),
      sources: []
    };
    const createdForEntry = new Map();

    try {
      for (const [index, entry] of plan.entries.entries()) {
        const entryKey = entry.entryKey ?? `${index}:${entry.participantKey}:${entry.item.uuid}`;
        const checkpointName = `credit:${entryKey}`;
        let created = transferredItem(
          entry.targetActor,
          plan.executionId,
          entryKey,
          existingCheckpoints[checkpointName]?.itemId
        );
        const existedBefore = Boolean(created);
        if (!created) {
          const incomingData = clone(entry.incomingData);
          incomingData.flags ??= {};
          incomingData.flags.mtrol ??= {};
          incomingData.flags.mtrol.tradeTransfer = {
            executionId: plan.executionId,
            sessionId: plan.sessionId,
            entryKey,
            sourceItemUuid: entry.item.uuid,
            quantity: entry.quantity
          };
          [created] = await entry.targetActor.createEmbeddedDocuments(
            "Item",
            [incomingData],
            { render: false, mtrolTradeExecutionId: plan.executionId }
          );
        }
        if (!created?.id) throw new Error("Foundry no devolvió el Item destino creado.");
        createdForEntry.set(entryKey, created);
        if (!existedBefore) {
          mutations.created.push({ actor: entry.targetActor, item: created, entry });
          const ids = mutations.createdByActor.get(entry.targetActor) ?? [];
          ids.push(created.id);
          mutations.createdByActor.set(entry.targetActor, ids);
        }
        if (!existingCheckpoints[checkpointName]) {
          await checkpoint(checkpointName, { itemId: created.id, entryKey });
        }
      }

      for (const [index, entry] of plan.entries.entries()) {
        const entryKey = entry.entryKey ?? `${index}:${entry.participantKey}:${entry.item.uuid}`;
        const checkpointName = `debit:${entryKey}`;
        if (!existingCheckpoints[checkpointName]) {
          const current = entry.sourceActor.items?.get?.(entry.item.id) ?? null;
          const currentQuantity = current ? getItemQuantity(current) : 0;
          if (currentQuantity === entry.sourceQuantity) {
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
          } else if (currentQuantity !== entry.remainingQuantity) {
            const error = new Error("El estado del Item origen es ambiguo durante recovery.");
            error.reasonCode = "TRADE_STATE_AMBIGUOUS";
            throw error;
          }
          await checkpoint(checkpointName, { entryKey, remainingQuantity: entry.remainingQuantity });
        }
      }

      await verifyPlanState(plan, existingCheckpoints, createdForEntry);
      const result = {
        ok: true,
        transactionId: plan.executionId,
        status: "completed",
        changed: true,
        reasonCode: null,
        sessionId: plan.sessionId,
        executionId: plan.executionId,
        revision: plan.revision,
        transferredEntries: plan.entries.length,
        createdItemIds: mutations.created.map(created => created.item.id)
      };
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
      failure.transactionRolledBack = !rollbackError;
      throw failure;
    }
  }
}

export const tradeTransferCoordinator = new TradeTransferCoordinator();
