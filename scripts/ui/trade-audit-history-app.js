const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const ApplicationClass = HandlebarsApplicationMixin(ApplicationV2);

export class MtrolTradeAuditHistoryApp extends ApplicationClass {
  constructor({ onClosed = null, ...options } = {}) {
    super({ ...options, id: "mtrol-trade-audit-history" });
    this.onClosed = onClosed;
    this.filter = "ALL";
    this.selectedAuditId = null;
  }

  static DEFAULT_OPTIONS = {
    classes: ["mtrol", "mtrol-trade-audit-history"],
    position: { width: 920, height: 700 },
    window: { title: "Historial de Comercio", resizable: true }
  };

  static PARTS = {
    content: { template: "systems/mtrol/templates/apps/trade-audit-history-app.html" }
  };

  async _prepareContext(options = {}) {
    const base = await super._prepareContext(options);
    if (!game.user?.isGM) return { ...base, forbidden: true };
    const records = await game.mtrol.trade.getAuditHistory(
      this.filter === "ALL" ? {} : { state: this.filter }
    );
    return {
      ...base,
      records,
      filter: this.filter,
      selected: records.find(record => record.auditId === this.selectedAuditId) ?? null
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const filter = this.element.querySelector("[data-role='filter']");
    if (filter) filter.value = this.filter;
    filter?.addEventListener("change", event => {
      this.filter = event.currentTarget.value;
      this.selectedAuditId = null;
      this.render();
    });
    this.element.querySelectorAll("[data-audit-id]").forEach(row => row.addEventListener("click", () => {
      this.selectedAuditId = row.dataset.auditId;
      this.render();
    }));
  }

  async close(options = {}) {
    const result = await super.close(options);
    this.onClosed?.();
    return result;
  }
}
