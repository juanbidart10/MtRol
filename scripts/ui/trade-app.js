import {
  buildOwnOfferEntries,
  buildTradeAppRenderContext,
  removeOwnOfferEntry,
  upsertOwnOfferEntry
} from "../trade/trade-app-view-model.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const ApplicationClass = HandlebarsApplicationMixin(ApplicationV2);

function clampQuantity(value, maximum) {
  const quantity = Math.floor(Number(value));
  const max = Math.max(1, Math.floor(Number(maximum) || 1));
  return Math.min(max, Math.max(1, Number.isFinite(quantity) ? quantity : 1));
}

export class MtrolTradeApp extends ApplicationClass {
  constructor(sessionId, { onClosed = null, ...options } = {}) {
    super({
      ...options,
      id: `mtrol-trade-app-${String(sessionId).replace(/[^A-Za-z0-9_-]/g, "-")}`
    });
    this.sessionId = String(sessionId);
    this.onClosed = onClosed;
    this.inspector = null;
    this.busy = false;
    this.editingConfirmedOffer = false;
  }

  static DEFAULT_OPTIONS = {
    classes: ["mtrol", "mtrol-trade-app"],
    position: {
      width: 820,
      height: 650
    },
    window: {
      title: "Comercio MTROL",
      resizable: true
    }
  };

  static PARTS = {
    content: {
      template: "systems/mtrol/templates/apps/trade-app.html"
    }
  };

  async _prepareContext(options = {}) {
    const base = await super._prepareContext(options);
    const session = game.mtrol.trade.getSession(this.sessionId);
    if (!session) return { ...base, unavailable: true };

    const view = await game.mtrol.trade.getMyTradeView(this.sessionId);
    return {
      ...base,
      ...buildTradeAppRenderContext({
        session,
        view,
        inspector: this.inspector,
        busy: this.busy,
        editingConfirmedOffer: this.editingConfirmedOffer
      })
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;
    root.querySelectorAll("[data-action]").forEach(element => {
      element.addEventListener("click", event => this.#onAction(event));
    });
    root.addEventListener("keydown", event => {
      if (event.key === "Escape" && this.inspector) {
        this.inspector = null;
        this.render();
      }
    });
  }

  async close(options = {}) {
    const result = await super.close(options);
    this.onClosed?.();
    return result;
  }

  #getSessionAndParticipant() {
    const session = game.mtrol.trade.getSession(this.sessionId);
    const participantKey = Object.entries(session?.participants ?? {})
      .find(([, participant]) => participant.userId === game.user.id)?.[0];
    if (!session || !participantKey) throw new Error("La sesión local ya no está disponible.");
    return { session, participantKey };
  }

  #ownEntries(session, participantKey) {
    return buildOwnOfferEntries(session, participantKey);
  }

  async #setOwnOffer(transform) {
    const { session, participantKey } = this.#getSessionAndParticipant();
    const entries = transform(this.#ownEntries(session, participantKey));
    await game.mtrol.trade.setOffer({
      sessionId: session.id,
      participantKey,
      entries
    });
    this.editingConfirmedOffer = false;
  }

  async #onAction(event) {
    event.preventDefault();
    const button = event.currentTarget;
    const action = button.dataset.action;

    if (action === "close-inspector") {
      this.inspector = null;
      this.render();
      return;
    }
    if (action === "unlock-offer") {
      this.editingConfirmedOffer = true;
      this.render();
      return;
    }
    if (this.busy) return;

    try {
      this.busy = action !== "inspect";
      if (this.busy) this.render();
      if (action === "add") {
        const row = button.closest("[data-item-uuid]");
        const quantity = clampQuantity(
          row?.querySelector("[data-role='quantity']")?.value,
          row?.dataset.maximum
        );
        await this.#setOwnOffer(entries => upsertOwnOfferEntry(entries, {
          itemUuid: row.dataset.itemUuid,
          itemId: row.dataset.itemId,
          quantity
        }));
      }

      if (action === "update") {
        const row = button.closest("[data-item-uuid]");
        const quantity = clampQuantity(
          row?.querySelector("[data-role='quantity']")?.value,
          row?.dataset.maximum
        );
        await this.#setOwnOffer(entries => entries.map(entry =>
          entry.itemUuid === row.dataset.itemUuid ? { ...entry, quantity } : entry
        ));
      }

      if (action === "remove") {
        await this.#setOwnOffer(entries => removeOwnOfferEntry(
          entries,
          button.dataset.itemUuid
        ));
      }

      if (action === "clear") await this.#setOwnOffer(() => []);

      if (action === "accept") {
        const { session, participantKey } = this.#getSessionAndParticipant();
        await game.mtrol.trade.acceptSession({ sessionId: session.id, participantKey });
      }

      if (action === "confirm") {
        const { session, participantKey } = this.#getSessionAndParticipant();
        await game.mtrol.trade.confirm({
          sessionId: session.id,
          participantKey,
          revision: session.revision
        });
      }

      if (action === "cancel") {
        const { session, participantKey } = this.#getSessionAndParticipant();
        await game.mtrol.trade.cancel({ sessionId: session.id, participantKey });
      }

      if (action === "inspect") {
        this.inspector = game.mtrol.trade.inspectOfferItem(
          this.sessionId,
          button.dataset.itemUuid
        );
      }
    } catch (error) {
      ui.notifications.error(error.message ?? "La acción de comercio fue rechazada.");
    } finally {
      this.busy = false;
      this.render();
    }
  }
}
