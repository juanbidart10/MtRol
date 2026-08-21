// =========================
// MTROL - COMPETENCIA SHEET
// =========================

import {
  installMtrolCustomResizeHandle
} from "../mtrol-resize-handle.js";

import {
  calcularConsumoMP
} from "../../combat/mp-engine.js";

import {
  getAbilityRoleLabel,
  getItemAbilityDamageConfig
} from "../../actions/ability-config.js";

import {
  MTROL_ORB_IDS,
  MTROL_ORB_REGISTRY
} from "../../progression/orb-registry.js";

const { ItemSheet } =
  foundry.appv1.sheets;

const MTROL_FALLBACK_ITEM_IMG = "icons/svg/item-bag.svg";

function getSafeImageSrc(src, fallback = MTROL_FALLBACK_ITEM_IMG) {
  if (typeof src === "string" && src.trim()) return src.trim();

  console.warn("MTROL | Imagen invalida en CompetenciaSheet. Usando fallback.", {
    src,
    fallback
  });

  return fallback;
}

export class CompetenciaSheet extends ItemSheet {

  // =========================
  // DEFAULT OPTIONS
  // =========================

  static get defaultOptions() {

    return foundry.utils.mergeObject(
      super.defaultOptions,
      {
        classes: [
          "mtrol",
          "sheet",
          "item-sheet",
          "competencia-sheet"
        ],

        width: 600,
        height: 700,
        minHeight: 300,

        resizable: true,

        tabs: [{
          navSelector: ".mtrol-competencia-tabs",
          contentSelector: ".mtrol-competencia-tab-content",
          initial: "general"
        }]
      }
    );

  }

  // =========================
  // TEMPLATE
  // =========================

  get template() {

    return `systems/${game.system.id}/templates/items/competencia-sheet.html`;

  }

  // =========================
  // GET DATA
  // =========================

  getData(options) {

    const context =
      super.getData(options);

    context.item =
      this.item;

    context.system =
      this.item.system;

    context.esGM =
      game.user.isGM;

    context.itemImg =
      getSafeImageSrc(this.item.img);

    const cost = calcularConsumoMP(
      this.item.parent ?? { system: { vitales: { mp: { value: Number.MAX_SAFE_INTEGER } } }, getFlag: () => ({}) },
      this.item
    );
    const damageConfig = getItemAbilityDamageConfig(this.item);

    context.costoMP = {
      base: cost.costoTotal,
      stackeable: cost.stackea === true,
      proximoUso: cost.costoTotal,
      detalle: cost.stackea
        ? "Calculado por el stack propio de Competencia"
        : "Calculado por categoría y nivel"
    };
    context.damageConfig = damageConfig;
    context.rolLabel = getAbilityRoleLabel(this.item.system?.rol);
    context.showOppositionType = this.item.system?.requiresOpposition === true;
    context.showDamageConfiguration = damageConfig.executesDamage;
    context.showOrbAssociation = this.item.system?.categoria === "hechizo";
    context.orbOptions = Object.values(MTROL_ORB_REGISTRY).map(definition => ({
      value: definition.id,
      label: definition.name,
      selected: definition.id === this.item.system?.orbType
    }));

    return context;

  }

  activateListeners(html) {
    super.activateListeners(html);

    installMtrolCustomResizeHandle(this, html);

    if (!game.user.isGM) {
      const root = html[0] ?? html;
      root.querySelectorAll?.("input, select, textarea, button")
        .forEach(control => { control.disabled = true; });
      root.querySelectorAll?.("[data-edit]")
        .forEach(control => control.removeAttribute("data-edit"));
      return;
    }

    html.find("img")
      .off("error.mtrolImageGuard")
      .on("error.mtrolImageGuard", event => {
        const img = event.currentTarget;
        if (img.src?.endsWith(MTROL_FALLBACK_ITEM_IMG)) return;

        console.warn("MTROL | Imagen fallida en CompetenciaSheet. Usando fallback.", {
          item: this.item?.name,
          src: img.getAttribute("src"),
          fallback: MTROL_FALLBACK_ITEM_IMG
        });

        img.src = MTROL_FALLBACK_ITEM_IMG;
      });

    const refreshContextualFields = () => {
      const root = html[0] ?? html;
      const requiresOpposition = root.querySelector('[name="system.requiresOpposition"]')?.checked === true;
      const executesDamage = root.querySelector('[name="system.ejecutaDanio"]')?.checked === true;
      const oppositionRegion = root.querySelector('[data-mtrol-context="opposition"]');
      const damageRegion = root.querySelector('[data-mtrol-context="damage"]');
      const resolution = root.querySelector('[name="system.damageResolution"]');
      const costType = root.querySelector('[name="system.damageCostType"]')?.value;
      const additionalCost = root.querySelector('[data-mtrol-damage-additional-cost]');

      if (oppositionRegion) oppositionRegion.hidden = !requiresOpposition;
      if (damageRegion) damageRegion.hidden = !executesDamage;

      if (!requiresOpposition && resolution?.value === "onOppositionWin") {
        resolution.value = "immediate";
        ui.notifications.warn("Al ganar oposición requiere que la habilidad use oposición. Se ajustó a Inmediato.");
      }

      resolution?.querySelector('[value="onOppositionWin"]')?.toggleAttribute("disabled", !requiresOpposition);
      if (additionalCost) {
        additionalCost.textContent = costType === "basic"
          ? "+1 MP al ejecutar"
          : "Sin costo adicional";
      }
    };

    html.find('[name="system.requiresOpposition"], [name="system.ejecutaDanio"], [name="system.damageCostType"]')
      .on("change.mtrolAbilityContext", refreshContextualFields);

    refreshContextualFields();
  }

  async _updateObject(event, formData) {
    if (!game.user.isGM) {
      ui.notifications.warn("Solo el GM puede modificar Competencias.");
      return false;
    }

    if (
      formData["system.rol"] === "" ||
      formData["system.rol"] === undefined
    ) {
      formData["system.rol"] = null;
    }

    const category = String(
      formData["system.categoria"] ?? this.item.system?.categoria ?? ""
    );
    const rawOrbType = formData["system.orbType"];
    if (category !== "hechizo") {
      formData["system.orbType"] = null;
    } else if (rawOrbType === "" || rawOrbType === undefined || rawOrbType === null) {
      formData["system.orbType"] = null;
    } else if (!MTROL_ORB_IDS.includes(rawOrbType)) {
      throw new Error("El tipo de Orbe del hechizo no pertenece al registro canónico.");
    }

    const requiresOpposition = formData["system.requiresOpposition"] === true || formData["system.requiresOpposition"] === "true";

    if (!requiresOpposition && formData["system.damageResolution"] === "onOppositionWin") {
      formData["system.damageResolution"] = "immediate";
      ui.notifications.warn("La resolución de daño se ajustó a Inmediato porque la habilidad no requiere oposición.");
    }

    return super._updateObject(event, formData);
  }

}
