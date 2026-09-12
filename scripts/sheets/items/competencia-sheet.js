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
  getItemAbilityDamageConfig,
  MTROL_RESOLUTION_RESULTS
} from "../../actions/ability-config.js";

import {
  MTROL_ORB_IDS,
  MTROL_ORB_REGISTRY
} from "../../progression/orb-registry.js";
import { MTROL_EFFECT_ATTRIBUTE_KEYS } from "../../effects/effect-types.js";
import { logger } from "../../utils/logger.js";
import { DEFAULT_ALLOWED_RESPONSES, getOppositionActionDefinition, OPPOSITION_CAPABILITIES } from "../../actions/opposition-policy.js";
import { getItemResolutionResult } from "../../actions/action-definition-resolver.js";

const { ItemSheet } =
  foundry.appv1.sheets;

const MTROL_FALLBACK_ITEM_IMG = "icons/svg/item-bag.svg";
const CAPABILITY_LABELS = {
  OFFENSIVE: "Ofensiva", DEFENSE: "Defensa", DODGE: "Esquiva",
  COUNTERATTACK: "Contraataque", REACTION: "Reacción", MOVEMENT: "Movimiento"
};
const VISIBLE_CAPABILITIES = Object.values(OPPOSITION_CAPABILITIES)
  .filter(value => value !== OPPOSITION_CAPABILITIES.MOVEMENT);

function mergeVisibleCapabilities(previous, selected) {
  return [...previous.filter(value => !VISIBLE_CAPABILITIES.includes(value) || selected.includes(value)),
    ...selected.filter(value => !previous.includes(value))];
}

function legacyConfiguration(item) {
  const definition = getOppositionActionDefinition(item);
  const raw = item.system?.capabilities ?? [];
  const reactive = DEFAULT_ALLOWED_RESPONSES.filter(value => definition.capabilities.includes(value));
  const preset = item.system?.responseCapability;
  return {
    inherited: raw.length === 0 && definition.capabilities.length > 0,
    raw: JSON.stringify(raw), effective: JSON.stringify(definition.capabilities),
    showOpposition: definition.legacyMapped || definition.capabilities.length === 0,
    missingReaction: reactive.length > 0 && !definition.capabilities.includes("REACTION"),
    invalidPreset: preset != null && preset !== "" && !reactive.includes(preset),
    showResponseDomain: definition.capabilities.includes("COUNTERATTACK"),
    showActionDomain: getItemResolutionResult(item) === "damage" ||
      definition.allowedResponses.includes("COUNTERATTACK") ||
      definition.capabilities.includes("COUNTERATTACK") || Boolean(item.system?.actionDomain)
  };
}
const RESOLUTION_PRESENTATION = {
  damage: { label: "Daño", help: "Al ganar, obtiene derecho a Lanzar Daño." },
  defense: { label: "Defensa", help: "Al ganar, evita la acción enemiga." },
  movement: { label: "Movimiento", help: "Al ganar, concede movimiento según la regla configurada." },
  utility: { label: "Utilidad", help: "Al ganar, resuelve un efecto sin daño directo." }
};

function serializeCheckedChoices(formData, prefix, values, previous) {
  const selected = values.filter(value => [true, "true", "on"].includes(formData[`${prefix}.${value}`]));
  for (const value of values) delete formData[`${prefix}.${value}`];
  return [...previous.filter(value => selected.includes(value)), ...selected.filter(value => !previous.includes(value))];
}

function responseConfiguration(item) {
  const definition = getOppositionActionDefinition(item);
  const candidates = DEFAULT_ALLOWED_RESPONSES.filter(value => definition.capabilities.includes(value));
  const preset = String(item.system?.responseCapability ?? "").trim().toUpperCase();
  return {
    candidates,
    multiple: candidates.length > 1,
    singleLabel: candidates.length === 1 ? CAPABILITY_LABELS[candidates[0]] : "",
    options: DEFAULT_ALLOWED_RESPONSES.map(value => ({
      value, label: CAPABILITY_LABELS[value], available: candidates.includes(value),
      selected: candidates.length === 1 ? candidates[0] === value : preset === value && candidates.includes(value)
    }))
  };
}

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
    context.oppositionRequired = getItemResolutionResult(this.item) === "damage";
    context.showOppositionType = context.oppositionRequired || this.item.system?.requiresOpposition === true;
    context.responseConfiguration = responseConfiguration(this.item);
    context.legacyConfiguration = legacyConfiguration(this.item);
    context.showDamageConfiguration = this.item.system?.resolutionResult === "damage";
    context.showOrbAssociation = this.item.system?.categoria === "hechizo";
    const definition = getOppositionActionDefinition(this.item);
    const selectedCapabilities = new Set(this.item.system?.capabilities ?? definition.capabilities);
    const selectedResponses = new Set(definition.allowedResponses);
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
    context.capabilityOptions = Object.values(OPPOSITION_CAPABILITIES)
      .map(value => ({ value, label: CAPABILITY_LABELS[value], selected: selectedCapabilities.has(value) }));
    const properties = [OPPOSITION_CAPABILITIES.REACTION, OPPOSITION_CAPABILITIES.MOVEMENT];
    context.capabilityGroups = [
      { label: "Tipo", options: context.capabilityOptions.filter(option => !properties.includes(option.value)) },
      { label: "Propiedades", options: context.capabilityOptions.filter(option => option.value === "REACTION") }
    ];
    const resolutionResult = this.item.system?.resolutionResult ?? getItemResolutionResult(this.item);
    context.resolutionOptions = MTROL_RESOLUTION_RESULTS.map(value => ({
      value, ...RESOLUTION_PRESENTATION[value], selected: resolutionResult === value
    }));
    context.resolutionHelp = RESOLUTION_PRESENTATION[resolutionResult]?.help ?? "Elegí una consecuencia.";
    context.allowedResponseOptions = DEFAULT_ALLOWED_RESPONSES
      .map(value => ({ value, label: CAPABILITY_LABELS[value], selected: selectedResponses.has(value) }));
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
      const resolutionResult = root.querySelector('[name="system.resolutionResult"]:checked')?.value;
      const resolutionHelp = root.querySelector('[data-mtrol-resolution-help]');
      if (resolutionHelp) resolutionHelp.textContent = RESOLUTION_PRESENTATION[resolutionResult]?.help ?? "Elegí una consecuencia.";
      const opposition = root.querySelector('[name="system.requiresOpposition"]');
      const mandatory = resolutionResult === "damage";
      if (opposition) {
        opposition.disabled = mandatory;
        if (mandatory) opposition.checked = true;
      }
      const oppositionHelp = root.querySelector('[data-mtrol-opposition-required]');
      if (oppositionHelp) oppositionHelp.hidden = !mandatory;
      const damageRegion = root.querySelector('[data-mtrol-context="damage"]');
      const costType = root.querySelector('[name="system.damageCostType"]')?.value;
      const additionalCost = root.querySelector('[data-mtrol-damage-additional-cost]');

      if (damageRegion) damageRegion.hidden = resolutionResult !== "damage";

      if (additionalCost) {
        additionalCost.textContent = costType === "basic"
          ? "+1 MP al ejecutar"
          : "Sin costo adicional";
      }
    };

    const refreshResponseFields = () => {
      const root = html[0] ?? html;
      const capabilities = root.querySelectorAll('[data-mtrol-capability]');
      const region = root.querySelector('[data-mtrol-response-type]');
      if (!capabilities.length || !region) return;
      const radios = Array.from(region.querySelectorAll('input[type="radio"]'));
      const preview = { system: {
        ...this.item.system,
        capabilities: mergeVisibleCapabilities(this.item.system?.capabilities ?? [],
          Array.from(capabilities).filter(input => input.checked).map(input => input.dataset.mtrolCapability)),
        allowedResponses: Array.from(root.querySelectorAll('[name^="mtrolAllowedResponse."]'))
          .filter(input => input.checked).map(input => input.name.slice("mtrolAllowedResponse.".length)),
        resolutionResult: root.querySelector('[name="system.resolutionResult"]:checked')?.value ?? this.item.system?.resolutionResult,
        responseCapability: radios.find(radio => radio.checked && !radio.disabled)?.value ?? this.item.system?.responseCapability
      } };
      const config = responseConfiguration(preview);
      const legacy = legacyConfiguration(preview);
      for (const [selector, visible] of [
        ["reaction-warning", legacy.missingReaction], ["preset-warning", legacy.invalidPreset],
        ["legacy-opposition", legacy.showOpposition], ["inherited", legacy.inherited],
        ["action-domain", legacy.showActionDomain], ["response-domain", legacy.showResponseDomain]
      ]) {
        const element = root.querySelector(`[data-mtrol-${selector}]`);
        if (element) element.hidden = !visible;
      }
      for (const key of ["raw", "effective"]) {
        const element = root.querySelector(`[data-mtrol-capabilities-${key}]`);
        if (element) element.textContent = legacy[key];
      }
      region.hidden = config.candidates.length === 0;
      region.querySelector('[data-mtrol-response-single]').hidden = config.multiple;
      region.querySelector('[data-mtrol-response-label]').textContent = config.singleLabel;
      region.querySelector('[data-mtrol-response-multiple]').hidden = !config.multiple;
      for (const radio of radios) {
        const option = config.options.find(option => option.value === radio.value);
        radio.closest('label').hidden = !option.available;
        radio.disabled = !config.multiple || !option.available;
        radio.required = config.multiple && option.available;
        radio.checked = option.selected;
      }
    };

    html.find('[data-mtrol-capability]')
      .on("change.mtrolResponseConfiguration", refreshResponseFields);
    html.find('[name="system.resolutionResult"], [name="system.responseCapability"], [name^="mtrolAllowedResponse."]')
      .on("change.mtrolLegacyConfiguration", refreshResponseFields);

    html.find('[name="system.requiresOpposition"], [name="system.ejecutaDanio"], [name="system.damageCostType"], [name="system.resolutionResult"]')
      .on("change.mtrolAbilityContext", refreshContextualFields);

    refreshContextualFields();
    refreshResponseFields();
    // Compare with the rendered form, whose derived values can differ from
    // persisted legacy data. An unchanged control is not an edit.
    if (this.form) {
      this._renderedSubmission = {
        item: this.item,
        data: foundry.utils.duplicate(this._getSubmitData())
      };
    }
  }

  async _updateObject(event, formData) {
    if (!game.user.isGM) {
      ui.notifications.warn("Solo el GM puede modificar Competencias.");
      return false;
    }

    formData = foundry.utils.duplicate(formData);
    const baseline = this._renderedSubmission;
    if (baseline?.item === this.item) {
      const changed = key => JSON.stringify(formData[key]) !== JSON.stringify(baseline.data[key]);
      const groups = [
        ["mtrolCapabilityControls", "mtrolCapability."],
        ["mtrolResponseControls", "mtrolAllowedResponse."]
      ];
      const keep = new Set();
      for (const [marker, prefix] of groups) {
        const keys = [...new Set([...Object.keys(formData), ...Object.keys(baseline.data)])]
          .filter(key => key.startsWith(prefix));
        if (keys.some(changed)) {
          keep.add(marker);
          keys.forEach(key => keep.add(key));
        }
      }
      for (const key of Object.keys(formData)) {
        if (!keep.has(key) && !changed(key)) delete formData[key];
      }
    }
    if (!Object.keys(formData).length) return {};

    if (Object.hasOwn(formData, "mtrolCapabilityControls")) {
      const selected = VISIBLE_CAPABILITIES.filter(value =>
        [true, "true", "on"].includes(formData[`mtrolCapability.${value}`]));
      formData["system.capabilities"] = mergeVisibleCapabilities(this.item.system?.capabilities ?? [], selected);
      for (const key of Object.keys(formData)) {
        if (key.startsWith("mtrolCapability.")) delete formData[key];
      }
      delete formData.mtrolCapabilityControls;
    }
    if (Object.hasOwn(formData, "system.resolutionResult") && !MTROL_RESOLUTION_RESULTS.includes(formData["system.resolutionResult"])) {
      throw new Error("Elegí una única consecuencia al ganar.");
    }
    if (Object.hasOwn(formData, "mtrolResponseControls")) {
      formData["system.allowedResponses"] = serializeCheckedChoices(
        formData, "mtrolAllowedResponse", DEFAULT_ALLOWED_RESPONSES,
        getOppositionActionDefinition(this.item).allowedResponses
      );
      delete formData.mtrolResponseControls;
    }
    const submittedSystem = { ...this.item.system };
    for (const [key, value] of Object.entries(formData)) {
      if (key.startsWith("system.")) submittedSystem[key.slice(7)] = value;
    }
    const response = responseConfiguration({ system: submittedSystem });
    const editsCapabilities = Object.hasOwn(formData, "system.capabilities");
    const editsResponse = Object.hasOwn(formData, "system.responseCapability");
    if (editsResponse && formData["system.responseCapability"] === "") {
      formData["system.responseCapability"] = null;
    }
    if (editsResponse && formData["system.responseCapability"] === null) {
      // Nullable means explicitly clearing a preset is valid.
    } else if (editsResponse) {
      const selected = response.options.find(option => option.available && option.value === formData["system.responseCapability"]);
      if (!selected) {
        const message = "Elegí el tipo de respuesta de esta habilidad antes de guardar.";
        ui.notifications.warn(message);
        throw new Error(message);
      }
      formData["system.responseCapability"] = selected.value;
    }

    if (
      Object.hasOwn(formData, "system.rol") &&
      (formData["system.rol"] === "" || formData["system.rol"] === undefined)
    ) {
      formData["system.rol"] = null;
    }

    const damageSourceAttribute = formData["system.damageSourceAttribute"];
    if (Object.hasOwn(formData, "system.damageSourceAttribute")) {
      if (damageSourceAttribute === "" || damageSourceAttribute === undefined || damageSourceAttribute === null) {
        formData["system.damageSourceAttribute"] = null;
      } else if (!MTROL_EFFECT_ATTRIBUTE_KEYS.includes(damageSourceAttribute)) {
        throw new Error("El atributo de origen del daño no pertenece al registro canónico.");
      }
    }

    const category = String(
      formData["system.categoria"] ?? this.item.system?.categoria ?? ""
    );
    const rawOrbType = formData["system.orbType"];
    if (Object.hasOwn(formData, "system.orbType")) {
      if (category !== "hechizo" || rawOrbType === "" || rawOrbType === undefined || rawOrbType === null) {
        formData["system.orbType"] = null;
      } else if (!MTROL_ORB_IDS.includes(rawOrbType)) {
        throw new Error("El tipo de Orbe del hechizo no pertenece al registro canónico.");
      }
    }

    if (getItemResolutionResult({ system: submittedSystem }) === "damage") {
      for (const key of ["system.requiresOpposition", "system.ejecutaDanio"]) {
        if (Object.hasOwn(formData, "system.resolutionResult") || Object.hasOwn(formData, key)) {
          formData[key] = true;
        }
      }
    }
    if (Object.hasOwn(formData, "system.damageResolution")) formData["system.damageResolution"] = "onOppositionWin";
    if (Object.hasOwn(formData, "system.damageMode")) formData["system.damageMode"] = "enabled";

    return super._updateObject(event, formData);
  }

}
