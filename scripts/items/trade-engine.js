function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getQuantity(item) {
  return Math.max(1, Math.floor(toNumber(item?.system?.cantidad, 1)));
}

function isInventoryItem(item) {
  return item?.type === "objeto" || item?.type === "item";
}

function duplicateItemData(item, quantity) {
  const data = item.toObject();

  delete data._id;
  data.system = foundry.utils.duplicate(data.system ?? {});
  data.system.cantidad = quantity;
  data.system.equipado = false;
  data.system.slot = data.system.slot ?? "";

  return data;
}

function findStack(actor, item, excludeId = null) {
  return actor.items.find(candidate => {
    if (candidate.id === excludeId) return false;
    if (!isInventoryItem(candidate)) return false;
    if (candidate.name !== item.name) return false;
    if (candidate.type !== item.type) return false;

    const left = foundry.utils.duplicate(candidate.system ?? {});
    const right = foundry.utils.duplicate(item.system ?? {});

    left.cantidad = 1;
    right.cantidad = 1;
    left.equipado = false;
    right.equipado = false;

    return JSON.stringify(left) === JSON.stringify(right);
  });
}

function normalizeOffer(offer) {
  return {
    itemId: String(offer?.itemId ?? ""),
    quantity: Math.max(0, Math.floor(toNumber(offer?.quantity, 0)))
  };
}

async function restoreSnapshots(sourceActor, targetActor, snapshots) {
  for (const actor of [sourceActor, targetActor]) {
    const snapshot = snapshots.get(actor.uuid);
    if (!snapshot) continue;

    const currentIds = actor.items.map(item => item.id);
    if (currentIds.length) {
      await actor.deleteEmbeddedDocuments("Item", currentIds);
    }

    if (snapshot.length) {
      await actor.createEmbeddedDocuments("Item", snapshot);
    }
  }
}

async function moveItemQuantity(sourceActor, targetActor, itemId, quantity) {
  const sourceItem = sourceActor.items.get(itemId);

  if (!sourceItem) {
    throw new Error("El item ofrecido ya no existe en el actor origen.");
  }

  if (!isInventoryItem(sourceItem)) {
    throw new Error("Solo se pueden comerciar objetos de inventario.");
  }

  const available = getQuantity(sourceItem);

  if (quantity < 1 || quantity > available) {
    throw new Error(`Cantidad invalida para ${sourceItem.name}.`);
  }

  const remaining = available - quantity;
  const targetStack = findStack(targetActor, sourceItem);

  if (sourceItem.system?.equipado) {
    await sourceItem.update({
      "system.equipado": false
    });
  }

  if (remaining > 0) {
    await sourceItem.update({
      "system.cantidad": remaining
    });
  } else {
    await sourceItem.delete();
  }

  if (targetStack) {
    await targetStack.update({
      "system.cantidad": getQuantity(targetStack) + quantity
    });
  } else {
    await targetActor.createEmbeddedDocuments("Item", [
      duplicateItemData(sourceItem, quantity)
    ]);
  }
}

function userCanOffer(actor, userId) {
  const user = game.users.get(userId);
  if (!user) return false;
  if (user.isGM) return true;
  return actor.testUserPermission(user, "OWNER");
}

export async function ejecutarComercioMtrol({
  sourceActor,
  targetActor,
  sourceOffer = [],
  targetOffer = [],
  requestingUserId = game.user.id
} = {}) {
  if (!sourceActor || !targetActor) {
    throw new Error("Comercio sin actores validos.");
  }

  if (sourceActor.uuid === targetActor.uuid) {
    throw new Error("No se puede comerciar con el mismo actor.");
  }

  if (!game.user.isGM) {
    throw new Error("La transferencia de comercio debe ejecutarla el GM.");
  }

  if (!userCanOffer(sourceActor, requestingUserId)) {
    throw new Error("El usuario solicitante no puede ofrecer items de ese actor.");
  }

  const sourceItems = sourceOffer.map(normalizeOffer).filter(offer => offer.quantity > 0);
  const targetItems = targetOffer.map(normalizeOffer).filter(offer => offer.quantity > 0);

  if (targetItems.length && !userCanOffer(targetActor, requestingUserId)) {
    throw new Error("El usuario solicitante no puede ofrecer items del actor objetivo.");
  }

  if (!sourceItems.length && !targetItems.length) {
    throw new Error("El comercio no contiene objetos para transferir.");
  }

  const snapshots = new Map([
    [sourceActor.uuid, sourceActor.items.map(item => item.toObject())],
    [targetActor.uuid, targetActor.items.map(item => item.toObject())]
  ]);

  try {
    for (const offer of sourceItems) {
      await moveItemQuantity(sourceActor, targetActor, offer.itemId, offer.quantity);
    }

    for (const offer of targetItems) {
      await moveItemQuantity(targetActor, sourceActor, offer.itemId, offer.quantity);
    }
  } catch (error) {
    await restoreSnapshots(sourceActor, targetActor, snapshots);
    throw error;
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
    content: `
      <div class="mtrol-chat-card mtrol-trade-card">
        <h2>Comercio completado</h2>
        <p><strong>${foundry.utils.escapeHTML(sourceActor.name)}</strong> intercambio objetos con <strong>${foundry.utils.escapeHTML(targetActor.name)}</strong>.</p>
      </div>
    `
  });

  return true;
}

export async function ejecutarComercioMtrolDesdeSocket(data = {}) {
  const sourceActor = data.sourceActorUuid ? await fromUuid(data.sourceActorUuid) : null;
  const targetActor = data.targetActorUuid ? await fromUuid(data.targetActorUuid) : null;

  return ejecutarComercioMtrol({
    sourceActor,
    targetActor,
    sourceOffer: data.sourceOffer,
    targetOffer: data.targetOffer,
    requestingUserId: data.requestingUserId
  });
}
