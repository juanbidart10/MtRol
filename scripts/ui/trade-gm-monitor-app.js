const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const ApplicationClass = HandlebarsApplicationMixin(ApplicationV2);

export class MtrolTradeGMMonitorApp extends ApplicationClass {
  constructor(sessionId, { api, onClosed = null, ...options } = {}) {
    super({ ...options, id: `mtrol-trade-gm-${String(sessionId).replace(/[^A-Za-z0-9_-]/g, "-")}` });
    this.sessionId = String(sessionId);
    if (!api) throw new TypeError("MtrolTradeGMMonitorApp requiere la API canónica de Trade.");
    this.api = api;
    this.onClosed = onClosed;
    this.terminalSnapshot = null;
    this.busy = false;
  }

  static DEFAULT_OPTIONS = {
    classes: ["mtrol", "mtrol-trade-gm-monitor"],
    position: { width: 1050, height: 760 },
    window: { title: "Supervisión de Comercio", resizable: true }
  };

  static PARTS = {
    content: { template: "systems/mtrol/templates/apps/trade-gm-monitor-app.html" }
  };

  async _prepareContext(options = {}) {
    const base = await super._prepareContext(options);
    if (!game.user?.isGM) return { ...base, forbidden: true };
    try {
      const view = await this.api.getGMMonitorView(this.sessionId);
      return { ...base, view, busy: this.busy };
    } catch (error) {
      return { ...base, unavailable: true, terminal: this.terminalSnapshot, error: error.message };
    }
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelectorAll("[data-action]").forEach(button =>
      button.addEventListener("click", event => this.#onAction(event))
    );
  }

  setTerminalSnapshot(session) {
    this.terminalSnapshot = session;
  }

  async close(options = {}) {
    const result = await super.close(options);
    this.onClosed?.();
    return result;
  }

  async #onAction(event) {
    event.preventDefault();
    const action = event.currentTarget.dataset.action;
    if (action === "history") return this.api.openAuditHistory();
    if (["pause", "resume"].includes(action) && !this.busy) {
      try {
        this.busy = true;
        this.render();
        await this.api[action]({ sessionId: this.sessionId });
      } catch (error) {
        ui.notifications.error(error.message ?? "No se pudo actualizar la pausa del comercio.");
      } finally {
        this.busy = false;
        this.render();
      }
      return;
    }
    if (action !== "cancel" || this.busy) return;
    const confirmed = await DialogV2.confirm({
      window: { title: "Cancelar comercio" },
      content: `<p>¿Cancelar este comercio?</p><ul><li>Invalida confirmaciones</li><li>Libera reservas</li><li>Libera bloqueos de movimiento</li><li>Impide la ejecución</li></ul>`,
      modal: true
    });
    if (!confirmed) return;
    try {
      this.busy = true;
      this.render();
      await this.api.cancelByGM({
        sessionId: this.sessionId,
        reason: "Cancelado por GM desde supervisión"
      });
    } catch (error) {
      ui.notifications.error(error.message ?? "No se pudo cancelar el comercio.");
    } finally {
      this.busy = false;
      this.render();
    }
  }
}
