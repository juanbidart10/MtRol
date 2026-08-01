const destructionInProgress = new Map();

function escapeHTML(value) {
  if (globalThis.foundry?.utils?.escapeHTML) {
    return foundry.utils.escapeHTML(String(value ?? ""));
  }

  return String(value ?? "");
}

function getDestructionKey(actor, item) {
  return `${actor?.uuid ?? actor?.id ?? "actor"}:${item?.id ?? "item"}`;
}

async function destroyEquippedItemInternal({
  actor,
  item,
  slot = null,
  reason = "destruido",
  createChatMessage = false
} = {}) {
  if (!actor || !item?.id) {
    return {
      destroyed: false,
      alreadyDestroyed: true,
      clearedSlots: []
    };
  }

  const currentItem =
    actor.items.get?.(item.id) ??
    Array.from(actor.items ?? []).find(candidate => candidate.id === item.id) ??
    null;

  if (!currentItem) {
    return {
      destroyed: false,
      alreadyDestroyed: true,
      clearedSlots: []
    };
  }

  const equipment =
    actor.system?.equipamiento ?? {};

  const slotsToClear =
    Object.entries(equipment)
      .filter(([, itemId]) => itemId === currentItem.id)
      .map(([slotKey]) => slotKey);

  if (
    slot &&
    equipment[slot] === currentItem.id &&
    !slotsToClear.includes(slot)
  ) {
    slotsToClear.push(slot);
  }

  if (slotsToClear.length) {
    const updates =
      Object.fromEntries(
        slotsToClear.map(slotKey => [
          `system.equipamiento.${slotKey}`,
          ""
        ])
      );

    await actor.update(updates);
  }

  const itemStillExists =
    actor.items.get?.(currentItem.id) ??
    Array.from(actor.items ?? []).find(candidate => candidate.id === currentItem.id) ??
    null;

  if (itemStillExists) {
    await actor.deleteEmbeddedDocuments(
      "Item",
      [currentItem.id]
    );
  }

  if (createChatMessage) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `
        <div class="mtrol-chat-card">
          <p><strong>${escapeHTML(currentItem.name)}</strong> se rompe y queda destruido.</p>
          <p>${escapeHTML(reason)}</p>
        </div>
      `
    });
  }

  return {
    destroyed: true,
    alreadyDestroyed: false,
    clearedSlots: slotsToClear,
    itemId: currentItem.id,
    itemName: currentItem.name
  };
}

export async function destroyEquippedItem(options = {}) {
  const {
    actor,
    item
  } = options;

  const key =
    getDestructionKey(actor, item);

  if (destructionInProgress.has(key)) {
    return destructionInProgress.get(key);
  }

  const operation =
    destroyEquippedItemInternal(options)
      .finally(() => {
        destructionInProgress.delete(key);
      });

  destructionInProgress.set(key, operation);

  return operation;
}
