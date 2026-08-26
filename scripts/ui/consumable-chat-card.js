function escapeHTML(value) {
  if (globalThis.foundry?.utils?.escapeHTML) {
    return foundry.utils.escapeHTML(String(value ?? ""));
  }
  return String(value ?? "");
}

function resourceLabel(resource) {
  return String(resource ?? "").toLowerCase() === "mp" ? "MP" : "HP";
}

export function buildConsumableChatCardContent(result = {}) {
  const label = resourceLabel(result.resource);
  const overflow = Number(result.overflow ?? 0);
  const fullMessage = Number(result.restored ?? 0) === 0
    ? `<p class="mtrol-consumable-card__full">El ${label} ya se encontraba al máximo.</p>`
    : "";
  const overflowMessage = overflow > 0
    ? `<p>Excedente perdido: <strong>${escapeHTML(overflow)} ${label}</strong></p>`
    : "";

  return `
    <div class="mtrol-chat-card mtrol-consumable-card">
      <header class="mtrol-consumable-card__header">
        <img src="${escapeHTML(result.itemImg)}" alt="${escapeHTML(result.itemName)}">
        <h2>${escapeHTML(result.actorName)} utiliza ${escapeHTML(result.itemName)}</h2>
      </header>
      <p class="mtrol-consumable-card__resource"><strong>${label}</strong></p>
      <p>${escapeHTML(result.before)} / ${escapeHTML(result.max)} → ${escapeHTML(result.after)} / ${escapeHTML(result.max)}</p>
      ${fullMessage}
      <p>Potencia: <strong>+${escapeHTML(result.amount)} ${label}</strong></p>
      <p>Restauración efectiva: <strong>+${escapeHTML(result.restored)} ${label}</strong></p>
      ${overflowMessage}
      <p>Unidades restantes: <strong>${escapeHTML(result.remainingQuantity)}</strong></p>
    </div>
  `;
}

export function createConsumableChatCard(actor, result) {
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: buildConsumableChatCardContent(result),
    flags: {
      mtrol: {
        consumable: {
          transactionId: result.transactionId,
          actorUuid: result.actorUuid,
          itemId: result.itemId
        }
      }
    }
  });
}
