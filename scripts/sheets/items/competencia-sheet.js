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
import { MTROL_EFFECT_ATTRIBUTE_KEYS } from "../../effects/effect-types.js";
import { logger } from "../../utils/logger.js";

const { ItemSheet } =
  foundry.appv1.sheets;

const MTROL_FALLBACK_ITEM_IMG = "icons/svg/item-bag.svg";

function getSafeImageSrc(src, fallback = MTROL_FALLBACK_ITEM_IMG) {
  if (typeof src === "string" && src.trim()) return src.trim();

  logger.warnOnce("SHEET", "invalid competencia image replaced", {
    command: "competencia-sheet.image.resolve",
    status: "fallback",
    reasonCode: "COMPETENCIA_IMAGE_INVALID",
    fallback
  }, { key: "competencia-sheet:image-invalid" });

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
    context.showDamageConfiguration = this.item.system?.resolutionResult === "damage";
    context.showOrbAssociation = this.item.system?.categoria === "hechizo";
    const selectedCapabilities = new Set(this.item.system?.capabilities ?? []);
    const selectedResponses = new Set(this.item.system?.allowedResponses ?? []);
    context.actionIdentityOptions = [
      ["spell", "Hechizo"],
      ["competence", "Competencia"],
      ["combat", "Combate"],
      ["special", "Especial"],
      ["basic", "Básico"]
    ].map(([value, label]) => ({
      value,
      label,
      selected: this.item.system?.actionIdentity === value
    }));
    context.capabilityOptions = [
      "OFFENSIVE", "DEFENSE", "DODGE", "COUNTERATTACK", "REACTION", "MOVEMENT"
    ].map(value => ({ value, selected: selectedCapabilities.has(value) }));
    context.allowedResponseOptions = ["DEFENSE", "DODGE", "COUNTERATTACK"]
      .map(value => ({ value, selected: selectedResponses.has(value) }));
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

        logger.warnOnce("SHEET", "competencia image load failed", {
          command: "competencia-sheet.image.load",
          itemUuid: this.item?.uuid ?? null,
          status: "fallback",
          reasonCode: "COMPETENCIA_IMAGE_LOAD_FAILED",
          fallback: MTROL_FALLBACK_ITEM_IMG
        }, { key: `competencia-sheet:image-load:${this.item?.uuid ?? "unknown"}` });

        img.src = MTROL_FALLBACK_ITEM_IMG;
      });

    const refreshContextualFields = () => {
      const root = html[0] ?? html;
      const requiresOpposition = root.querySelector('[name="system.requiresOpposition"]')?.checked === true;
      const resolutionResult = root.querySelector('[name="system.resolutionResult"]')?.value;
      const oppositionRegion = root.querySelector('[data-mtrol-context="opposition"]');
      const damageRegion = root.querySelector('[data-mtrol-context="damage"]');
      const resolution = root.querySelector('[name="system.damageResolution"]');
      const costType = root.querySelector('[name="system.damageCostType"]')?.value;
      const additionalCost = root.querySelector('[data-mtrol-damage-additional-cost]');

      if (oppositionRegion) oppositionRegion.hidden = !requiresOpposition;
      if (damageRegion) damageRegion.hidden = resolutionResult !== "damage";

      if (resolutionResult === "damage") {
        const opposition = root.querySelector('[name="system.requiresOpposition"]');
        if (opposition) opposition.checked = true;
      }
      if (additionalCost) {
        additionalCost.textContent = costType === "basic"
          ? "+1 MP al ejecutar"
          : "Sin costo adicional";
      }
    };

    html.find('[name="system.requiresOpposition"], [name="system.ejecutaDanio"], [name="system.damageCostType"], [name="system.resolutionResult"]')
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

    const damageSourceAttribute = formData["system.damageSourceAttribute"];
    if (damageSourceAttribute === "" || damageSourceAttribute === undefined) {
      formData["system.damageSourceAttribute"] = null;
    } else if (!MTROL_EFFECT_ATTRIBUTE_KEYS.includes(damageSourceAttribute)) {
      throw new Error("El atributo de origen del daño no pertenece al registro canónico.");
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

    if (formData["system.resolutionResult"] === "damage") {
      formData["system.requiresOpposition"] = true;
      formData["system.ejecutaDanio"] = true;
    }
    formData["system.damageResolution"] = "onOppositionWin";
    formData["system.damageMode"] = "enabled";

    return super._updateObject(event, formData);
  }

}
