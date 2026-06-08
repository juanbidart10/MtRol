import {
  ejecutarComercioMtrol
} from "../items/trade-engine.js";

function escapeHTML(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function itemQuantity(item) {
  const quantity = Number(item?.system?.cantidad ?? 1);
  return Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1;
}

function inventoryItems(actor) {
  return actor.items
    .filter(item => item.type === "objeto" || item.type === "item")
    .map(item => ({
      id: item.id,
      name: item.name,
      img: item.img || "icons/svg/item-bag.svg",
      quantity: itemQuantity(item),
      type: item.system?.tipoObjeto ?? item.type
    }));
}

function renderInventory(actor, side, disabled) {
  const items = inventoryItems(actor);

  if (!items.length) {
    return `<p class="hint">Sin objetos disponibles.</p>`;
  }

  return `
    <div class="mtrol-trade-inventory" data-side="${side}">
      ${items.map(item => `
        <label class="mtrol-trade-item">
          <input type="checkbox"
                 data-side="${side}"
                 data-item-id="${escapeHTML(item.id)}"
                 ${disabled ? "disabled" : ""}>
          <img src="${escapeHTML(item.img)}" alt="${escapeHTML(item.name)}">
          <span class="mtrol-trade-item-name">${escapeHTML(item.name)}</span>
          <span class="mtrol-trade-item-type">${escapeHTML(item.type)}</span>
          <input type="number"
                 min="1"
                 max="${item.quantity}"
                 value="1"
                 data-quantity-for="${escapeHTML(item.id)}"
                 ${disabled ? "disabled" : ""}>
          <span class="mtrol-trade-item-max">/ ${item.quantity}</span>
        </label>
      `).join("")}
    </div>
  `;
}

function collectOffer(html, side) {
  return Array.from(html[0].querySelectorAll(`input[type="checkbox"][data-side="${side}"]:checked`))
    .map(input => {
      const itemId = input.dataset.itemId;
      const quantityInput = html[0].querySelector(`input[data-quantity-for="${CSS.escape(itemId)}"]`);
      const quantity = Math.max(1, Math.floor(Number(quantityInput?.value ?? 1)));

      return {
        itemId,
        quantity
      };
    });
}

function hasSelectedOffer(html, side) {
  return html[0].querySelector(`input[type="checkbox"][data-side="${side}"]:checked`) !== null;
}

function actorOwnerUserIds(actor) {
  return game.users
    .filter(user => user.active && !user.isGM && actor.testUserPermission(user, "OWNER"))
    .map(user => user.id);
}

async function executeTrade({ sourceActor, targetActor, sourceOffer, targetOffer }) {
  if (game.user.isGM) {
    return ejecutarComercioMtrol({
      sourceActor,
      targetActor,
      sourceOffer,
      targetOffer,
      requestingUserId: game.user.id
    });
  }

  game.socket.emit("system.mtrol", {
    action: "mtrolEjecutarComercio",
    sourceActorUuid: sourceActor.uuid,
    targetActorUuid: targetActor.uuid,
    sourceOffer,
    targetOffer,
    requestingUserId: game.user.id
  });

  return true;
}

export function abrirDialogoComercioMtrol(sourceActor, targetActor) {
  if (!sourceActor || !targetActor) {
    ui.notifications.warn("Selecciona un token objetivo para iniciar comercio.");
    return;
  }

  if (sourceActor.uuid === targetActor.uuid) {
    ui.notifications.warn("No se puede comerciar con el mismo actor.");
    return;
  }

  const canEditSource = game.user.isGM || sourceActor.isOwner;
  const canEditTarget = game.user.isGM || targetActor.isOwner;

  if (!canEditSource && !canEditTarget) {
    ui.notifications.warn("No tienes permisos sobre ninguno de los actores del comercio.");
    return;
  }

  const targetConfirmDisabled =
    !canEditTarget;

  const targetConfirmChecked =
    !canEditTarget;

  const content = `
    <form class="mtrol-trade-dialog">
      <div class="mtrol-trade-grid">
        <section>
          <h3>${escapeHTML(sourceActor.name)}</h3>
          ${renderInventory(sourceActor, "source", !canEditSource)}
          <label class="mtrol-trade-confirm">
            <input type="checkbox" name="sourceConfirmed" ${!canEditSource ? "disabled" : ""}>
            Confirmar oferta
          </label>
        </section>
        <section>
          <h3>${escapeHTML(targetActor.name)}</h3>
          ${renderInventory(targetActor, "target", !canEditTarget)}
          <label class="mtrol-trade-confirm">
            <input type="checkbox" name="targetConfirmed" ${targetConfirmChecked ? "checked" : ""} ${targetConfirmDisabled ? "disabled" : ""}>
            ${canEditTarget ? "Confirmar oferta" : "Sin oferta del objetivo"}
          </label>
        </section>
      </div>
    </form>
  `;

  new Dialog({
    title: `Comercio: ${sourceActor.name} / ${targetActor.name}`,
    content,
    buttons: {
      trade: {
        label: "Completar comercio",
        callback: async html => {
          const sourceConfirmed = html[0].querySelector("[name='sourceConfirmed']")?.checked;
          const targetConfirmed = html[0].querySelector("[name='targetConfirmed']")?.checked;
          const targetHasOffer = hasSelectedOffer(html, "target");

          if (!sourceConfirmed || (targetHasOffer && !targetConfirmed)) {
            ui.notifications.warn("Ambos lados deben confirmar el comercio.");
            return false;
          }

          await executeTrade({
            sourceActor,
            targetActor,
            sourceOffer: collectOffer(html, "source"),
            targetOffer: collectOffer(html, "target")
          });

          ui.notifications.info("Solicitud de comercio enviada.");
          return true;
        }
      },
      cancel: {
        label: "Cancelar"
      }
    },
    default: "trade"
  }, {
    width: 760,
    resizable: true
  }).render(true);

  const targetUserIds = actorOwnerUserIds(targetActor);
  if (!game.user.isGM && targetUserIds.length) {
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
      whisper: targetUserIds,
      content: `
        <div class="mtrol-chat-card mtrol-trade-card">
          <h2>Solicitud de comercio</h2>
          <p><strong>${escapeHTML(sourceActor.name)}</strong> solicita comerciar con <strong>${escapeHTML(targetActor.name)}</strong>.</p>
        </div>
      `
    });
  }
}
