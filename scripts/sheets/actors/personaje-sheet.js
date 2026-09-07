import { mtrolRoll } from "../../rolls/mtrol-rolls.js";
import { resolveNarrativeCapabilities } from "../../effects/narrative-capability-resolver.js";
import { authorityService } from "../../core/authority-service.js";
import { onDeclareNarrativeCapability } from "./personaje-narrative-controller.js";
import { evaluateProgression } from "../../actors/progression-engine.js";

import {
  requestLevelUp,
  spendPendingAttributePoint,
  spendPendingCompetencePoint
} from "../../actors/progression-advancement-service.js";

import {
  getAttributeCap,
  getCompetenceCap
} from "../../progression/progression-caps.js";

import {
  isProgressionCompetence
} from "../../progression/progression-competence.js";

import {
  getCompetenciaRollFormula,
  resolverCompetencia
} from "../../combat/competencia-engine.js";

import {
  aplicarConsumoMP,
  calcularConsumoMP,
  restaurarAcumuladoresDia,
  restaurarMPMeditacion
} from "../../combat/mp-engine.js";

import {
  MTROL_BODY_SLOTS,
  MTROL_BODY_SLOT_LABELS
} from "../../constants/body-slots.js";

import {
  FX_ATRIBUTOS
} from "../../constants/attribute-fx.js";

import {
  canUserManageEquipment,
  equiparObjeto,
  desequiparObjeto
} from "../../items/equipment-engine.js";

import {
  buildCarrySegments,
  buildInventoryViewModel
} from "../../items/inventory-view-model.js";

import {
  resolveInventoryFilterResult
} from "../../items/inventory-search.js";

import {
  buildInventoryInspectorViewModel,
  resolveInventoryInspectorItem
} from "../../items/inventory-inspector-view-model.js";

import {
  useConsumable
} from "../../items/consumable-service.js";

import {
  requestTradeFromTarget
} from "../../trade/trade-runtime.js";

import {
  attachDefenseRollForActor,
  createPendingActionFromCompetencia,
  declareOppositionResponse,
  getActionDefinitionFromItem
} from "../../actions/action-engine.js";

import {
  COMPETENCE_MODE_IDS,
  getCompetenceExecutionModes,
  prepareCompetenceModeIntent,
  selectCompetenceExecutionMode
} from "../../actions/competence-mode-service.js";

import {
  buildCombatLibraryViewModel
} from "../../combat/combat-library-view-model.js";

import { getItemAbilityDamageConfig } from "../../actions/ability-config.js";
import { adjudicateLevelDifferenceModifier } from "../../actions/gm-roll-modifier-service.js";

import {
  calcularCargaActor
} from "../../core/mtrol-carry-weight.js";

import {
  getActuallyEquippedItems,
  getEquipmentState,
  getInventoryItems,
  getItemUnitWeight,
  getReferencedSlotsForItem,
  isMtrolObject
} from "../../items/item-invariants.js";

import {
  installMtrolCustomResizeHandle
} from "../mtrol-resize-handle.js";

import {
  selectDharmaSpendForRoll
} from "../../ui/dharma-selector.js";

import {
  mtrolPrepararRollData
} from "../../rolls/formula-parser.js";

import {
  getPrimaryActiveGM,
  MTROL_GM_REQUIRED_MESSAGE
} from "../../core/socket-requests.js";

import {
  getOrbLevelName,
  MTROL_ORB_REGISTRY
} from "../../progression/orb-registry.js";

import {
  addActorOrb,
  deleteActorOrb,
  updateActorOrb
} from "../../progression/orb-management-service.js";

import {
  getActorResourceModifierEntries,
  updateActorFromSheetAuthoritative,
  updateActorResourceConfigurationAuthoritative
} from "../../actors/class-resource-service.js";

import {
  prepareFiveSegmentResource
} from "../../ui/resource-segments.js";

import {
  canPrepare,
  completeResolvedTurnAction,
  finalizeResolvedCompetenciaUse,
  getActionGuard,
  getAttributeFollowUpTargetGuard,
  getItemCooldownStatus,
  getPreparation,
  getPrepareGuard,
  grantMovementFromResolvedRoll,
  prepare,
  setPreparation
} from "../../combat/turn-system.js";

import {
  setActorSpiritualResource
} from "../../actors/actor-resource-service.js";

import {
  getAllClassDefinitions,
  getClassDefinition,
  isValidClassId
} from "../../actors/class-registry.js";

import {
  promptApprenticeClassConfiguration
} from "../../ui/apprentice-class-dialog.js";

import {
  getAllRaceDefinitions,
  getRaceDefinition
} from "../../races/race-catalog.js";

import {
  applyRaceCreationBenefitsAuthoritative,
  getRaceCreationGrantState,
  updateActorRaceIdentityAuthoritative
} from "../../actors/race-service.js";

import {
  buildSpecialAbilitySlotView,
  findSpecialAbilitySlotForItem,
  MTROL_ORB_CONTEXTUAL_HANDLER,
  resolveSpecialAbilitySlot,
  updateSpecialAbilitySlot,
  validateSpecialAbilityExecution
} from "../../combat/special-ability-service.js";

import {
  selectOrbContextualMode
} from "../../ui/special-ability-mode-selector.js";

import {
  buildInternalItemDragData,
  classifyItemDropData,
  MTROL_INTERNAL_ITEM_DRAG_SOURCE
} from "./personaje-item-drag-policy.js";

import {
  calcularPorcentajeVital,
  esHabilidadBarraCombate,
  formulaCompetenciaPorNivel,
  getCombatBanner,
  getSafeImageSrc,
  isValidImageSrc,
  prepareExecutableItemData,
  prepareItemImageData,
  prepareProgressionEvaluationForSheet,
  toNumber
} from "./personaje-sheet-view-model.js";

import {
  createCombatAbilityData,
  createCompetenceData,
  createObjectData,
  createSheetItem,
  deleteSheetItem,
  importDroppedItem,
  setCombatBarEquipped
} from "./personaje-inventory-controller.js";

import {
  setCompetenceImage,
  setPersonajeFullBodyImage
} from "./personaje-image-controller.js";

import { adjustCompetenceLevel } from "../../progression/competence-level-service.js";
import { logger } from "../../utils/logger.js";

export {
  buildInternalItemDragData,
  classifyItemDropData,
  MTROL_INTERNAL_ITEM_DRAG_SOURCE
} from "./personaje-item-drag-policy.js";

const { ActorSheet } = foundry.appv1.sheets;

const MTROL_FALLBACK_ACTOR_IMG = "icons/svg/mystery-man.svg";
const MTROL_FALLBACK_ITEM_IMG = "icons/svg/item-bag.svg";
const MTROL_PERSONAJE_INITIAL_WIDTH = 700;
const MTROL_PERSONAJE_MIN_WIDTH = 480;
const MTROL_PERSONAJE_MIN_HEIGHT = 520;
const MTROL_PERSONAJE_TOP_FALLBACK = 40;
const MTROL_PERSONAJE_VIEWPORT_GAP = 8;
const MTROL_COMBAT_BAR_GM_WARNING =
  "Solo un GM puede modificar la Barra de Combate.";
const MTROL_CLASS_RESOURCE_GM_WARNING =
  "Solo un GM puede configurar la Clase y los modificadores de recursos.";
const MTROL_CLASS_RESOURCE_CONFIG_KEYS = new Set([
  "classId",
  "hpModifier",
  "hpModifierLabel",
  "mpModifier",
  "mpModifierLabel"
]);
function getPersonajeInitialPosition() {
  const viewportHeight = Math.max(
    Number(globalThis.window?.innerHeight ?? 0),
    Number(globalThis.document?.documentElement?.clientHeight ?? 0),
    MTROL_PERSONAJE_MIN_HEIGHT + MTROL_PERSONAJE_TOP_FALLBACK
  );
  const uiTopRect = globalThis.document
    ?.querySelector?.("#ui-top")
    ?.getBoundingClientRect?.();
  const measuredTop = Number(uiTopRect?.bottom);
  const top = Number.isFinite(measuredTop) && measuredTop > 0 && measuredTop < viewportHeight * .25
    ? Math.ceil(measuredTop)
    : MTROL_PERSONAJE_TOP_FALLBACK;

  return {
    left: 0,
    top,
    width: MTROL_PERSONAJE_INITIAL_WIDTH,
    height: Math.max(
      MTROL_PERSONAJE_MIN_HEIGHT,
      viewportHeight - top - MTROL_PERSONAJE_VIEWPORT_GAP
    )
  };
}

export class PersonajeSheet extends ActorSheet {

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["mtrol", "sheet", "actor", "personaje-sheet", "mtrol-personaje"],
      template: `systems/${game.system.id}/templates/actors/personaje-sheet.html`,
      width: MTROL_PERSONAJE_INITIAL_WIDTH,
      height: MTROL_PERSONAJE_MIN_HEIGHT,
      minWidth: MTROL_PERSONAJE_MIN_WIDTH,
      minHeight: MTROL_PERSONAJE_MIN_HEIGHT,
      resizable: true,

      tabs: [{
        navSelector: ".sheet-tabs",
        contentSelector: ".sheet-body",
        initial: "personaje"
      }],

      dragDrop: [{
        dragSelector: ".mtrol-draggable-objeto",
        dropSelector: null
      }],

      scrollY: [
        '.mtrol-sheet-body-v2 > .tab[data-tab="personaje"]',
        '.mtrol-sheet-body-v2 > .tab[data-tab="combate"]',
        '.mtrol-sheet-body-v2 > .tab[data-tab="competencias"]',
        '.mtrol-sheet-body-v2 > .tab[data-tab="inventario"]',
        '.mtrol-sheet-body-v2 > .tab[data-tab="progresion"]',
        ".mtrol-inventory-list-region"
      ],

      submitOnChange: true,
      closeOnSubmit: false
    });
  }

  render(force = false, options = {}) {
    const renderOptions = { ...options };

    if (!this.rendered) {
      Object.assign(renderOptions, getPersonajeInitialPosition());
    }

    return super.render(force, renderOptions);
  }

  _restoreScrollPositions(html) {
    if (!this._scrollPositions) return;
    super._restoreScrollPositions(html);
  }

  getData(options) {
    const context = super.getData(options);

    context.actor = this.actor;
    context.system = this.actor.system;
    context.esGM = game.user.isGM === true;
    const preparation = getPreparation(this.actor);
    const preparationGuard = getPrepareGuard(this.actor);
    context.mtrolPreparation = {
      value: preparation,
      canPrepare: canPrepare(this.actor),
      reason: preparationGuard.reason ?? "Renunciar al turno para obtener +1 Preparación.",
      atMinimum: preparation <= 0,
      atMaximum: preparation >= 5
    };
    context.inventoryView = buildInventoryViewModel(this.actor);
    context.inventoryCarry = buildCarrySegments(context.inventoryView.weight.ratio);
    const selectedInventoryItem = resolveInventoryInspectorItem(
      this.actor,
      this._mtrolSelectedItemId
    );

    if (this._mtrolSelectedItemId && !selectedInventoryItem) {
      this._mtrolSelectedItemId = null;
    }

    context.selectedInventoryItemId = selectedInventoryItem?.id ?? null;
    context.inventorySearchTerm = this._mtrolInventorySearchTerm ?? "";
    const inventoryFilterResult = resolveInventoryFilterResult(
      context.inventoryView,
      {
        filter: this._mtrolInventoryFilter ?? "all",
        searchTerm: context.inventorySearchTerm
      }
    );
    this._mtrolInventoryFilter = inventoryFilterResult.filter;
    context.inventoryFilter = inventoryFilterResult.filter;
    context.inventoryInspector = buildInventoryInspectorViewModel(
      this.actor,
      selectedInventoryItem
    );
    context.puedeEditarVitales = game.user.isGM === true;
    context.puedeEditarVitalesMax =
      game.user.isGM === true &&
      !isValidClassId(this.actor.system?.identidad?.classId);
    const persistedClassId = String(this.actor.system?.identidad?.classId ?? "");
    const selectedClass = getClassDefinition(persistedClassId);
    context.classOptions = getAllClassDefinitions().map(definition => ({
      id: definition.id,
      label: definition.label,
      selected: definition.id === selectedClass?.id
    }));
    context.selectedClassId = selectedClass?.id ?? "";
    context.selectedClassLabel = selectedClass?.label ?? (
      persistedClassId ? "Clase inválida" : "Sin clase seleccionada"
    );
    context.selectedClassInvalid = Boolean(persistedClassId && !selectedClass);
    context.canManageClass = game.user.isGM === true;
    const persistedRaceId = String(this.actor.system?.identidad?.raceId ?? "");
    const selectedRace = getRaceDefinition(persistedRaceId);
    const raceCreationGrant = getRaceCreationGrantState(this.actor);
    context.raceOptions = getAllRaceDefinitions().map(definition => ({
      id: definition.technicalId,
      label: definition.displayName,
      selected: definition.technicalId === selectedRace?.technicalId
    }));
    context.selectedRaceId = selectedRace?.technicalId ?? "";
    context.selectedRaceLabel = selectedRace?.displayName ?? (
      persistedRaceId ? "Raza inválida" : "Sin raza seleccionada"
    );
    context.selectedRaceInvalid = Boolean(persistedRaceId && !selectedRace);
    context.canManageRace = game.user.isGM === true;
    context.raceCreationGrant = {
      ...raceCreationGrant,
      sourceLabel: getRaceDefinition(raceCreationGrant.sourceRaceId)?.displayName ?? raceCreationGrant.sourceRaceId,
      canApply: game.user.isGM === true && Boolean(selectedRace) && !raceCreationGrant.applied
    };
    context.narrativeCapabilities = resolveNarrativeCapabilities(this.actor).capabilities;
    context.canDeclareNarrativeCapability = authorityService.ownsActor(this.actor, game.user.id) &&
      !this._mtrolNarrativeDeclarationPending;
    context.canManageResourceModifiers = game.user.isGM === true;
    context.resourceModifierEntries = getActorResourceModifierEntries(
      this.actor,
      { includeEmpty: true }
    );
    context.actorImg = getSafeImageSrc(
      this.actor.img,
      MTROL_FALLBACK_ACTOR_IMG,
      `actor ${this.actor.name}`
    );
    const configuredFullBodyImage = String(
      this.actor.system?.identidad?.fullBodyImage ?? ""
    ).trim();
    const hasCustomFullBodyImage = isValidImageSrc(configuredFullBodyImage);
    context.equipmentCharacterImage = {
      src: hasCustomFullBodyImage
        ? configuredFullBodyImage
        : context.actorImg,
      custom: hasCustomFullBodyImage,
      fallback: !hasCustomFullBodyImage
    };
    context.vitalesPorcentaje = {
      hp: calcularPorcentajeVital(this.actor.system?.vitales?.hp),
      mp: calcularPorcentajeVital(this.actor.system?.vitales?.mp)
    };
    context.mtrolKarmaDisplay = prepareFiveSegmentResource(
      this.actor.system?.recursos?.karma,
      { resource: "karma", editable: game.user.isGM === true }
    );
    context.mtrolDharmaDisplay = prepareFiveSegmentResource(
      this.actor.system?.recursos?.dharma,
      { resource: "dharma", editable: game.user.isGM === true }
    );
    context.progressionEvaluation = prepareProgressionEvaluationForSheet(
      evaluateProgression(this.actor),
      this._mtrolSelectedProgressionRequirementKey
    );
    const attributePoints = Math.max(0, Number(
      this.actor.system?.pendingAdvancement?.attributePoints ?? 0
    ) || 0);
    const competencePoints = Math.max(0, Number(
      this.actor.system?.pendingAdvancement?.competencePoints ?? 0
    ) || 0);
    const attributeCap = getAttributeCap(this.actor);
    const competenceCap = getCompetenceCap(this.actor);
    context.mtrolPendingAdvancement = {
      hasAny: attributePoints > 0 || competencePoints > 0,
      attributePoints,
      competencePoints,
      attributeOptions: Object.entries(FX_ATRIBUTOS)
        .filter(([key]) => Number(this.actor.system?.atributos?.[key]) < attributeCap)
        .map(([key, definition]) => ({
          key,
          label: definition.label ?? key,
          value: Number(this.actor.system?.atributos?.[key] ?? 0)
        })),
      competenceOptions: this.actor.items
        .filter(item => isProgressionCompetence(item) && Number(item.system?.nivel) < competenceCap)
        .map(item => ({
          id: item.id,
          name: item.name,
          value: Number(item.system?.nivel ?? 0)
        }))
    };

    const actorOrbs = Array.from(this.actor.system?.orbs ?? []);
    const orbDefinitions = Object.values(MTROL_ORB_REGISTRY);
    const ownedOrbTypes = new Set(actorOrbs.map(orb => orb.type));
    const levelOptions = [1, 2, 3, 4, 5].map(level => ({
      value: level,
      label: `${level} — ${getOrbLevelName(level)}`
    }));

    context.mtrolOrbs = actorOrbs.map(orb => {
      const definition = MTROL_ORB_REGISTRY[orb.type] ?? null;
      return {
        id: orb.id,
        type: orb.type,
        level: Number(orb.level),
        name: definition?.name ?? orb.type,
        levelName: getOrbLevelName(orb.level),
        passiveName: definition?.passiveName ?? "",
        passiveDescription: definition?.passiveDescription ?? "",
        rollBonus: Number(orb.level) === 5 ? 5 : Number(orb.level) === 4 ? 2 : 0,
        typeOptions: orbDefinitions.map(option => ({
          value: option.id,
          label: option.name,
          selected: option.id === orb.type,
          disabled: option.id !== orb.type && ownedOrbTypes.has(option.id)
        })),
        levelOptions: levelOptions.map(option => ({
          ...option,
          selected: option.value === Number(orb.level)
        }))
      };
    });
    context.mtrolOrbAddOptions = orbDefinitions
      .filter(definition => !ownedOrbTypes.has(definition.id))
      .map(definition => ({ value: definition.id, label: definition.name }));
    context.mtrolOrbLevelOptions = levelOptions;

    const availableDharma =
      Number(this.actor.system?.recursos?.dharma);

    context.mtrolDharmaAvailable = availableDharma;
    context.mtrolDharmaEnabled =
      Number.isInteger(availableDharma) &&
      availableDharma >= 1 &&
      availableDharma <= 5;
    context.mtrolDharmaTitle = context.mtrolDharmaEnabled
      ? `Gastar Dharma (${availableDharma} disponible${availableDharma === 1 ? "" : "s"})`
      : "No tienes Dharma disponible.";

    const allCompetencias = this.actor.items.filter(
      i => i.type === "competencia"
    );
    const lockedSpecialItemIds = new Set(
      context.esGM ? [] : [1, 2]
        .map(slot => resolveSpecialAbilitySlot(this.actor, slot))
        .filter(state => state.configured && state.locked && state.item)
        .map(state => state.item.id)
    );
    const competencias = allCompetencias.filter(item => !lockedSpecialItemIds.has(item.id));

    const habilidadesCombate = competencias.filter(
      esHabilidadBarraCombate
    );

    const competenciasGenerales = competencias.filter(
      i => !esHabilidadBarraCombate(i)
    );

    context.competencias = competencias.map(i => prepareExecutableItemData(i, availableDharma, this.actor));
    context.specialAbilitySlots = [1, 2].map(slot => buildSpecialAbilitySlotView(
      this.actor,
      slot,
      { getCooldownStatus: getItemCooldownStatus, getActionGuard, viewerIsGM: context.esGM }
    ));
    context.habilidadesCombate = context.esGM
      ? habilidadesCombate.map(i => prepareExecutableItemData(i, availableDharma, this.actor))
      : [];
    context.competenciasGenerales = competenciasGenerales.map(i =>
      prepareExecutableItemData(i, availableDharma, this.actor)
    );

    context.habilidadesEquipadasCombate = habilidadesCombate.filter(
      i => i.system?.equipadaCombate === true || i.system?.equipadaCombate === "true"
    ).map(i => ({
      ...prepareExecutableItemData(i, availableDharma, this.actor),
      mtrolBanner: getCombatBanner(i)
    }));
    context.combatLibrary = buildCombatLibraryViewModel(
      context.habilidadesEquipadasCombate
    );

    const equipmentState = getEquipmentState(this.actor);

    context.objetosInventario = getInventoryItems(this.actor)
      .map(o => prepareItemImageData(o));

    context.objetosEquipados = getActuallyEquippedItems(this.actor)
      .map(o => prepareItemImageData(o));

    context.slotsEquipamiento = MTROL_BODY_SLOTS.map(slotKey => {
      const slotState = equipmentState.entries.find(entry => entry.slot === slotKey);
      const item = slotState?.item ?? null;
      const defensa =
        toNumber(item?.system?.defensa, 0);
      const defensaBase =
        toNumber(item?.system?.defensaBase, defensa);
      const peso = item ? getItemUnitWeight(item) : 0;

      return {
        key: slotKey,
        label: MTROL_BODY_SLOT_LABELS[slotKey] ?? slotKey,
        ocupado: !!item,
        item,
        itemImg: item
          ? getSafeImageSrc(item.img, MTROL_FALLBACK_ITEM_IMG, `item equipado ${item.name}`)
          : MTROL_FALLBACK_ITEM_IMG,
        defensa,
        defensaBase,
        defensaActualBase: item ? `${defensa} / ${defensaBase}` : "-",
        danio: item?.system?.danio ?? "",
        peso,
        estadoClase: item ? "is-equipped" : "is-empty"
      };
    });

    const carga =
      calcularCargaActor(this.actor);

    const slotsOcupados =
      context.slotsEquipamiento.filter(slot => slot.ocupado).length;

    const defensaTotal =
      context.slotsEquipamiento.reduce(
        (total, slot) => total + toNumber(slot.defensa, 0),
        0
      );

    const danioArmas =
      context.slotsEquipamiento
        .filter(slot => ["manoIzq", "manoDer"].includes(slot.key) && slot.danio)
        .map(slot => `${slot.label}: ${slot.danio}`)
        .join(" | ") || "-";

    context.inventario = {
      usados: carga.pesoActual,
      maximos: carga.pesoMaximo,
      libres: carga.pesoLibre,
      sobrecargado: carga.sobrecargado
    };

    context.equipamientoResumen = {
      defensaTotal,
      danioArmas,
      pesoActual: carga.pesoActual,
      pesoMaximo: carga.pesoMaximo,
      pesoLibre: carga.pesoLibre,
      slotsOcupados,
      slotsTotales: MTROL_BODY_SLOTS.length
    };

    return context;
  }

  _canDragStart() {
    return canUserManageEquipment(this.actor);
  }

  _canDragDrop() {
    return canUserManageEquipment(this.actor);
  }

  _onDragStart(event) {
    if (!canUserManageEquipment(this.actor)) return false;
    if (event.target?.closest?.("button, a, input, select, textarea")) return false;

    const source = event.currentTarget?.closest?.("[data-item-id]") ??
      event.target?.closest?.("[data-item-id]");
    const itemId = String(source?.dataset?.itemId ?? "").trim();
    const item = this.actor.items?.get?.(itemId);
    if (!item) return false;

    const slotOrigin = source?.closest?.("[data-slot]")?.dataset?.slot ?? "";
    const data = buildInternalItemDragData(this.actor, item, slotOrigin);

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", JSON.stringify(data));
    this._setItemDragPreview(event.dataTransfer, item);
    this._mtrolActiveDragItemId = item.id;
    this._applyInternalDragFeedback(item);
    return true;
  }

  _setItemDragPreview(dataTransfer, item) {
    const documentRoot = this.element?.[0]?.ownerDocument ?? globalThis.document;
    if (!dataTransfer?.setDragImage || !documentRoot?.createElement || !documentRoot.body) {
      return;
    }

    const preview = documentRoot.createElement("div");
    preview.className = "mtrol-item-drag-preview";

    const image = documentRoot.createElement("img");
    image.src = getSafeImageSrc(
      item?.img,
      MTROL_FALLBACK_ITEM_IMG,
      `vista previa de ${item?.name ?? "objeto"}`
    );
    image.alt = "";

    const name = documentRoot.createElement("span");
    name.textContent = String(item?.name ?? "Objeto");
    preview.append(image, name);
    documentRoot.body.appendChild(preview);

    try {
      dataTransfer.setDragImage(preview, 18, 18);
    } finally {
      globalThis.setTimeout?.(() => preview.remove(), 0);
    }
  }

  _applyInternalDragFeedback(item) {
    const root = this.element?.[0] ?? this.element;
    if (!root?.querySelectorAll) return;

    const declaredSlot = String(item?.system?.slot ?? "");
    const equipable = item?.system?.equipable === true;

    root.classList?.add("is-dragging-internal-item");
    root.querySelectorAll(".mtrol-inventory-equipment-slot[data-slot]").forEach(slot => {
      const compatible = equipable && slot.dataset.slot === declaredSlot;
      slot.classList.toggle("is-drop-compatible", compatible);
      slot.classList.toggle("is-drop-incompatible", !compatible);
    });

    const equipped = getReferencedSlotsForItem(this.actor, item).length > 0;
    root.querySelector(".mtrol-inventory-list-region")
      ?.classList.toggle("is-drop-unequip", equipped);
  }

  _clearInternalDragFeedback() {
    const root = this.element?.[0] ?? this.element;
    this._mtrolActiveDragItemId = null;
    if (!root?.querySelectorAll) return;

    root.classList?.remove("is-dragging-internal-item");
    root.querySelectorAll(
      ".is-drop-compatible, .is-drop-incompatible, .is-drop-unequip"
    ).forEach(element => element.classList.remove(
      "is-drop-compatible",
      "is-drop-incompatible",
      "is-drop-unequip"
    ));
  }

  _onDragEnd() {
    this._clearInternalDragFeedback();
  }

  async _handleInternalItemDrop(event, item) {
    if (!canUserManageEquipment(this.actor)) return false;

    const slotTarget = event.target?.closest?.(
      ".mtrol-inventory-equipment-slot[data-slot]"
    );
    const inventoryTarget = event.target?.closest?.(
      ".mtrol-inventory-list-region"
    );

    if (slotTarget) {
      const destinationSlot = String(slotTarget.dataset?.slot ?? "");
      const declaredSlot = String(item.system?.slot ?? "");

      if (item.system?.equipable !== true || declaredSlot !== destinationSlot) {
        ui.notifications.warn("El objeto no es compatible con este slot.");
        return false;
      }

      if (getReferencedSlotsForItem(this.actor, item).includes(destinationSlot)) {
        return true;
      }

      const equipped = await equiparObjeto(this.actor, item);
      if (equipped) this.render(false);
      return equipped;
    }

    if (inventoryTarget) {
      if (!getReferencedSlotsForItem(this.actor, item).length) return true;

      const unequipped = await desequiparObjeto(this.actor, item);
      if (unequipped) this.render(false);
      return unequipped;
    }

    return false;
  }

  async _handleExternalItemDrop(data) {
    if (!game.user.isGM) {
      ui.notifications.warn("Solo el GM puede agregar objetos externos.");
      return false;
    }

    const result = await importDroppedItem(this.actor, data);
    ui.notifications.info(`Objeto agregado: ${result.sourceName}`);
    this.render(true);
    return true;
  }

  async _onDrop(event) {
    event.preventDefault();

    let data;

    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch (err) {
      logger.warn("SHEET", "Drop inválido", { error: err.message });
      this._clearInternalDragFeedback();
      return false;
    }

    try {
      if (data?.type !== "Item") return false;

      const classification = classifyItemDropData(this.actor, data);

      if (classification.kind === "invalid-internal") {
        ui.notifications.warn("El objeto interno arrastrado ya no es válido.");
        return false;
      }

      if (classification.kind === "internal") {
        return this._handleInternalItemDrop(event, classification.item);
      }

      return this._handleExternalItemDrop(data);
    } finally {
      this._clearInternalDragFeedback();
    }
  }

  async _updateObject(event, formData) {
    for (const key of Object.keys(formData)) {
      if (key === "system.identidad.classId") delete formData[key];
      if (key === "system.identidad.classDomain") delete formData[key];
      if (key === "system.identidad.raceId" || key === "system.identidad.raza") delete formData[key];
      if (key === "system.raceCreationGrant" || key.startsWith("system.raceCreationGrant.")) delete formData[key];
      if (key === "system.awakening" || key.startsWith("system.awakening.")) delete formData[key];
      if (key === "system.resourceModifiers" || key.startsWith("system.resourceModifiers.")) {
        delete formData[key];
      }
      if (key === "system.resourceModifierEntries" || key.startsWith("system.resourceModifierEntries.")) {
        delete formData[key];
      }
    }

    if (!game.user.isGM) {
      const vitalesBloqueados = new Set([
        "system.vitales.hp.value",
        "system.vitales.hp.max",
        "system.vitales.mp.value",
        "system.vitales.mp.max"
      ]);
      const recursosBloqueados = [
        "system.recursos.nivel",
        "system.recursos.exp",
        "system.recursos.doblones",
        "system.recursos.mvp",
        "system.recursos.estres",
        "system.recursos.corrupcion"
      ];
      const progressionBloqueada = new Set([
        "system.progression.missionsCompleted",
        "system.progression.dungeonsCompleted",
        "system.progression.meritCredits",
        "system.progression.defeatedLevel5Enemy",
        "system.progression.dmApproval"
      ]);

      for (const key of Object.keys(formData)) {
        if (key.startsWith("system.atributos.")) delete formData[key];
        if (recursosBloqueados.includes(key)) delete formData[key];
        if (vitalesBloqueados.has(key)) delete formData[key];
        if (progressionBloqueada.has(key)) delete formData[key];
        if (key.startsWith("system.pendingAdvancement.")) delete formData[key];
      }
    }

    if (game.user.isGM && isValidClassId(this.actor.system?.identidad?.classId)) {
      return updateActorFromSheetAuthoritative(this.actor, formData);
    }

    return super._updateObject(event, formData);
  }

  activateListeners(html) {
    super.activateListeners(html);

    installMtrolCustomResizeHandle(this, html);

    this._installImageFallbacks(html);

    this._installDharmaBurnControls(html);

    html.find(".mtrol-roll-atributo")
      .off("click")
      .on("click", this._onRollAtributo.bind(this));

    html.find(".mtrol-dharma-prepare")
      .off("click")
      .on("click", this._onPrepareDharma.bind(this));

    html.find(".mtrol-prepare-turn")
      .off("click")
      .on("click", this._onPrepareTurn.bind(this));

    if (game.user.isGM) {
      html.find(".mtrol-preparation-adjust")
        .off("click")
        .on("click", this._onAdjustPreparation.bind(this));
      html.find(".add-competencia")
        .off("click")
        .on("click", this._onAddCompetencia.bind(this));

      html.find(".competencia-image-edit")
        .off("click")
        .on("click", this._onChangeCompetenciaImage.bind(this));

      html.find(".mtrol-class-resource-control")
        .off("change")
        .on("change", this._onClassResourceConfigurationChange.bind(this));

      html.find(".mtrol-race-select")
        .off("change")
        .on("change", this._onRaceIdentityChange.bind(this));

      html.find(".mtrol-race-creation-grant")
        .off("click")
        .on("click", this._onApplyRaceCreationBenefits.bind(this));

      html.find(".mtrol-resource-modifier-entry-control")
        .off("change")
        .on("change", this._onResourceModifierEntryChange.bind(this));

      html.find(".mtrol-resource-modifier-add")
        .off("click")
        .on("click", this._onAddResourceModifierEntry.bind(this));

      html.find(".mtrol-resource-modifier-delete")
        .off("click")
        .on("click", this._onDeleteResourceModifierEntry.bind(this));

      html.find(".mtrol-level-up")
        .off("click")
        .on("click", this._onLevelUp.bind(this));

      html.find(".mtrol-destiny-segment.is-editable[data-resource][data-value]")
        .off("click")
        .on("click", this._onSpiritualResourceSegmentClick.bind(this));

      html.find(".competencia-up")
        .off("click")
        .on("click", this._onCompetenciaUp.bind(this));

      html.find(".competencia-down")
        .off("click")
        .on("click", this._onCompetenciaDown.bind(this));

      html.find(".mtrol-orb-add")
        .off("click")
        .on("click", this._onAddOrb.bind(this));

      html.find(".mtrol-orb-type, .mtrol-orb-level")
        .off("change")
        .on("change", this._onUpdateOrb.bind(this));

      html.find(".mtrol-orb-delete")
        .off("click")
        .on("click", this._onDeleteOrb.bind(this));

      html.find(".add-habilidad-combate")
        .off("click")
        .on("click", this._onAddHabilidadCombate.bind(this));

      html.find(".habilidad-combate-equip")
        .off("click")
        .on("click", this._onEquiparHabilidadCombate.bind(this));

      html.find(".habilidad-combate-unequip")
        .off("click")
        .on("click", this._onDesequiparHabilidadCombate.bind(this));
    }

    html.find(".progresion-requirements [data-requirement-key]")
      .off("click")
      .on("click", this._onProgressionRequirementSelect.bind(this));

    html.find(".mtrol-spend-pending-attribute")
      .off("click")
      .on("click", this._onSpendPendingAttribute.bind(this));

    html.find(".mtrol-spend-pending-competence")
      .off("click")
      .on("click", this._onSpendPendingCompetence.bind(this));

    html.find(".competencia-roll")
      .off("click")
      .on("click", this._onCompetenciaRoll.bind(this));

    html.find(".mtrol-narrative-capability-declare")
      .off("click")
      .on("click", onDeclareNarrativeCapability.bind(this));

    html.find(".mtrol-special-ability-lock")
      .off("click")
      .on("click", this._onSpecialAbilityLock.bind(this));

    html.find(".mtrol-special-ability-override")
      .off("change")
      .on("change", this._onSpecialAbilityOverride.bind(this));

    html.find(".mtrol-special-ability-clear")
      .off("click")
      .on("click", this._onSpecialAbilityClearOverride.bind(this));

    html.find(".mtrol-restaurar-dia")
      .off("click")
      .on("click", this._onRestaurarDia.bind(this));

    html.find(".mtrol-vital-field")
      .off("input")
      .on("input", this._onVitalInput.bind(this));

    html.find(".mtrol-inventory-selectable")
      .off("click")
      .on("click", this._onInventoryItemSelect.bind(this));

    html.find(".mtrol-inventory-inspector-close")
      .off("click")
      .on("click", this._onInventoryInspectorClose.bind(this));

    html.find(".mtrol-consumable-use")
      .off("click")
      .on("click", this._onUseConsumable.bind(this));

    const inventorySearchControls = html.find(".mtrol-inventory-search")
      .off("input")
      .on("input", this._onInventorySearchInput.bind(this));

    html.find(".mtrol-inventory-filter")
      .off("change")
      .on("change", this._onInventoryFilterChange.bind(this));

    if (
      (this._mtrolInventorySearchTerm || this._mtrolInventoryFilter !== "all") &&
      typeof inventorySearchControls?.each === "function"
    ) {
      inventorySearchControls.each((_index, input) => {
        this._applyInventoryFilter(input.closest?.(".mtrol-inventory-workspace"));
      });
    }

    if (this._mtrolSelectedItemId) {
      html.off?.("keydown.mtrol-inventory-inspector")
        ?.on?.("keydown.mtrol-inventory-inspector", this._onInventoryInspectorKeydown.bind(this));
    }

    html.find(".mtrol-draggable-objeto")
      .off("dragend.mtrol-internal-item")
      .on("dragend.mtrol-internal-item", this._onDragEnd.bind(this));

    html.find(".mtrol-inventory-equipment-slot, .mtrol-inventory-list-region")
      .off("dragover.mtrol-internal-item")
      .on("dragover.mtrol-internal-item", event => {
        if (!this._mtrolActiveDragItemId) return;
        event.preventDefault();
        if (event.originalEvent?.dataTransfer) {
          event.originalEvent.dataTransfer.dropEffect = "move";
        }
      });

    if (game.user.isGM) {
      html.find(".mtrol-equipment-character-change")
        .off("click")
        .on("click", this._onChangeEquipmentCharacterImage.bind(this));

      html.find(".mtrol-equipment-character-remove")
        .off("click")
        .on("click", this._onRemoveEquipmentCharacterImage.bind(this));
    } else {
      html.find(
        ".mtrol-equipment-character-change, .mtrol-equipment-character-remove"
      ).remove?.();
    }

    if (game.user.isGM) {
      html.find(".item-create-objeto")
        .off("click")
        .on("click", this._onCreateObjeto.bind(this));

      html.find(".item-delete")
        .off("click")
        .on("click", this._onDeleteItem.bind(this));
    } else {
      html.find(".item-create-objeto, .item-delete").remove?.();
    }

    html.find(".mtrol-trade-request")
      .off("click")
      .on("click", this._onTradeRequest.bind(this));

    html.find(".item-edit")
      .off("click")
      .on("click", this._onEditItem.bind(this));

    html.find(".mtrol-equip-slot.is-equipped")
      .off("click")
      .on("click", this._onEquipmentSlotOpen.bind(this));
  }

  async _onClassResourceConfigurationChange(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();

    if (!game.user.isGM) {
      ui.notifications.warn(MTROL_CLASS_RESOURCE_GM_WARNING);
      return false;
    }

    const input = event.currentTarget;
    const configKey = String(input?.dataset?.configKey ?? "");
    if (!MTROL_CLASS_RESOURCE_CONFIG_KEYS.has(configKey)) {
      ui.notifications.error("El control de recursos no es válido.");
      return false;
    }

    try {
      let changes = {
        [configKey]: input.value
      };

      if (configKey === "classId" && input.value === "aprendiz") {
        const apprentice = await promptApprenticeClassConfiguration();
        if (!apprentice) {
          this.render(false);
          return false;
        }
        changes = {
          classId: "aprendiz",
          classDomain: apprentice.classDomain,
          competencySelections: apprentice.competencySelections
        };
      }

      await updateActorResourceConfigurationAuthoritative({
        actorUuid: this.actor.uuid,
        transactionId: `sheet-resource-config-${foundry.utils.randomID()}`,
        expectedClassId: String(this.actor.system?.identidad?.classId ?? ""),
        changes
      }, {
        requestingUserId: game.user.id,
        trustedActor: this.actor
      });
      return true;
    } catch (error) {
      logger.error("SHEET", "No se pudo actualizar la configuración de recursos", { error: error.message });
      ui.notifications.error(error?.message ?? "No se pudo actualizar la configuración de recursos.");
      return false;
    }
  }

  async _onRaceIdentityChange(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    if (!game.user.isGM) {
      ui.notifications.warn("Sólo un GM puede modificar la Raza.");
      return false;
    }
    try {
      await updateActorRaceIdentityAuthoritative({
        actorUuid: this.actor.uuid,
        transactionId: `sheet-race-identity-${foundry.utils.randomID()}`,
        expectedRaceId: String(this.actor.system?.identidad?.raceId ?? ""),
        raceId: event.currentTarget.value
      }, { requestingUserId: game.user.id, trustedActor: this.actor });
      return true;
    } catch (error) {
      logger.error("SHEET", "No se pudo actualizar la Raza", { error: error.message });
      ui.notifications.error(error?.message ?? "No se pudo actualizar la Raza.");
      this.render(false);
      return false;
    }
  }

  async _onApplyRaceCreationBenefits(event) {
    event.preventDefault();
    if (!game.user.isGM) {
      ui.notifications.warn("Sólo un GM puede aplicar beneficios raciales de creación.");
      return false;
    }
    try {
      const raceId = String(this.actor.system?.identidad?.raceId ?? "");
      const result = await applyRaceCreationBenefitsAuthoritative({
        actorUuid: this.actor.uuid,
        transactionId: `sheet-race-creation-${foundry.utils.randomID()}`,
        expectedRaceId: raceId
      }, { requestingUserId: game.user.id, trustedActor: this.actor });
      if (result.alreadyApplied) ui.notifications.info("Los beneficios raciales de creación ya fueron aplicados.");
      else ui.notifications.info("Beneficios raciales de creación aplicados.");
      return true;
    } catch (error) {
      logger.error("SHEET", "No se pudieron aplicar los beneficios raciales", { error: error.message });
      ui.notifications.error(error?.message ?? "No se pudieron aplicar los beneficios raciales.");
      return false;
    }
  }

  _getResourceModifierEntriesForEdit() {
    return getActorResourceModifierEntries(this.actor, { includeEmpty: true })
      .map(entry => ({
        id: entry.id,
        hp: { value: Number(entry.hp.value), label: String(entry.hp.label) },
        mp: { value: Number(entry.mp.value), label: String(entry.mp.label) }
      }));
  }

  async _saveResourceModifierEntries(entries) {
    if (!game.user.isGM) {
      ui.notifications.warn(MTROL_CLASS_RESOURCE_GM_WARNING);
      return false;
    }

    try {
      await updateActorResourceConfigurationAuthoritative({
        actorUuid: this.actor.uuid,
        transactionId: `sheet-resource-modifiers-${foundry.utils.randomID()}`,
        expectedClassId: String(this.actor.system?.identidad?.classId ?? ""),
        changes: { resourceModifierEntries: entries }
      }, {
        requestingUserId: game.user.id,
        trustedActor: this.actor
      });
      return true;
    } catch (error) {
      logger.error("SHEET", "No se pudieron actualizar los modificadores de recursos", { error: error.message });
      ui.notifications.error(error?.message ?? "No se pudieron actualizar los modificadores de recursos.");
      return false;
    }
  }

  async _onResourceModifierEntryChange(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();

    const input = event.currentTarget;
    const entryId = String(input?.dataset?.entryId ?? "");
    const resource = String(input?.dataset?.resource ?? "");
    const field = String(input?.dataset?.field ?? "");
    if (!entryId || !["hp", "mp"].includes(resource) || !["value", "label"].includes(field)) {
      ui.notifications.error("El control del modificador no es válido.");
      return false;
    }

    const entries = this._getResourceModifierEntriesForEdit();
    const entry = entries.find(candidate => candidate.id === entryId);
    if (!entry) return false;
    entry[resource][field] = field === "value" ? input.value : String(input.value ?? "");
    return this._saveResourceModifierEntries(entries);
  }

  async _onAddResourceModifierEntry(event) {
    event.preventDefault();
    const entries = this._getResourceModifierEntriesForEdit();
    entries.push({
      id: `resource-modifier-${foundry.utils.randomID()}`,
      hp: { value: 0, label: "" },
      mp: { value: 0, label: "" }
    });
    return this._saveResourceModifierEntries(entries);
  }

  async _onDeleteResourceModifierEntry(event) {
    event.preventDefault();
    const entryId = String(event.currentTarget?.dataset?.entryId ?? "");
    if (!entryId) return false;
    const entries = this._getResourceModifierEntriesForEdit()
      .filter(entry => entry.id !== entryId);
    return this._saveResourceModifierEntries(entries);
  }

  _installImageFallbacks(html) {
    html.find("img")
      .off("error.mtrolImageGuard load.mtrolImageGuard")
      .on("error.mtrolImageGuard", event => {
        const img = event.currentTarget;
        const fallback =
          img.dataset.fallback ||
          MTROL_FALLBACK_ITEM_IMG;

        if (img.src?.endsWith(fallback)) return;

        logger.warn("SHEET", "Imagen fallida; se usa fallback", {
          actor: this.actor?.name,
          alt: img.alt,
          src: img.getAttribute("src"),
          fallback
        });

        img.src = fallback;
      })
      .on("load.mtrolImageGuard", event => {
        const img = event.currentTarget;

        if (img.naturalWidth > 0 && img.naturalHeight > 0) return;

        const fallback =
          img.dataset.fallback ||
          MTROL_FALLBACK_ITEM_IMG;

        if (img.src?.endsWith(fallback)) return;

        logger.warn("SHEET", "Imagen con dimensiones inválidas; se usa fallback", {
          actor: this.actor?.name,
          alt: img.alt,
          src: img.getAttribute("src"),
          width: img.naturalWidth,
          height: img.naturalHeight,
          fallback
        });

        img.src = fallback;
      });
  }

  _installDharmaBurnControls(html) {
    this._mtrolPreparedDharmaSpends = new Map();
    this._mtrolDharmaRoot = html;

    const availableDharma =
      Number(this.actor.system?.recursos?.dharma);

    const hasDharma =
      Number.isInteger(availableDharma) &&
      availableDharma >= 1 &&
      availableDharma <= 5;

    const controls =
      html.find(".mtrol-dharma-action");

    if (typeof controls?.each !== "function") return;

    controls.each((_index, control) => {
      const button =
        control.querySelector(".mtrol-dharma-prepare");
      if (!button) return;

      const eligible =
        control.dataset.mtrolDharmaEligible === "true";
      control.dataset.mtrolDharmaPrepared = "false";
      button.setAttribute?.("aria-pressed", "false");
      button.disabled = !hasDharma || !eligible;
    });
  }

  _getDharmaActionControl(event) {
    return event?.currentTarget?.closest?.(".mtrol-dharma-action") ?? null;
  }

  _getPreparedDharmaSpend(event) {
    const control = this._getDharmaActionControl(event);
    const actionKey = control?.dataset?.mtrolActionKey;
    if (!actionKey) return null;
    return this._mtrolPreparedDharmaSpends?.get(actionKey) ?? null;
  }

  _updatePreparedDharmaState(actionKey, context = null) {
    if (!actionKey) return;

    if (context) {
      this._mtrolPreparedDharmaSpends.set(actionKey, context);
    } else {
      this._mtrolPreparedDharmaSpends.delete(actionKey);
    }

    const controls =
      this._mtrolDharmaRoot?.find?.(".mtrol-dharma-action");

    if (typeof controls?.each !== "function") return;

    controls.each((_index, control) => {
      if (control.dataset.mtrolActionKey !== actionKey) return;

      const button =
        control.querySelector(".mtrol-dharma-prepare");
      const label =
        button?.querySelector(".mtrol-dharma-label");
      const isCombatAction = control.dataset.mtrolSection === "combate";

      control.dataset.mtrolDharmaPrepared = context ? "true" : "false";
      button?.setAttribute?.("aria-pressed", context ? "true" : "false");
      if (button) {
        button.title = context
          ? `Dharma preparado: ${context.cost}`
          : isCombatAction
            ? "Quemar Dharma"
            : "Gastar Dharma";
      }
      if (label) {
        label.textContent = isCombatAction
          ? "Quemar Dharma"
          : context
            ? `Dharma: ${context.cost}`
            : "Gastar Dharma";
      }
    });
  }

  async _onPrepareDharma(event) {
    event.preventDefault();
    event.stopPropagation();

    const button = event.currentTarget;
    const control = this._getDharmaActionControl(event);
    const actionKey = control?.dataset?.mtrolActionKey;
    const formula = control?.dataset?.mtrolFormula;

    if (!actionKey || !formula || button.disabled) return;

    this._updatePreparedDharmaState(actionKey, null);
    button.disabled = true;

    try {
      const { data } = mtrolPrepararRollData(this.actor);
      const context = await selectDharmaSpendForRoll({
        actor: this.actor,
        formula,
        data
      });

      this._updatePreparedDharmaState(actionKey, context);
    } catch (error) {
      logger.warn("SHEET", "No se pudo preparar Dharma Burn", { error: error.message });
      ui.notifications.warn(
        error.message ?? "No se pudo preparar Dharma Burn."
      );
      this._updatePreparedDharmaState(actionKey, null);
    } finally {
      if (button.isConnected) {
        const availableDharma =
          Number(this.actor.system?.recursos?.dharma);
        button.disabled =
          !Number.isInteger(availableDharma) ||
          availableDharma < 1 ||
          availableDharma > 5;
      }
    }
  }

  _onVitalInput(event) {
    const input = event.currentTarget;
    const vital = input.dataset.vital;
    if (!vital) return;

    const vitalElement = input.closest(".mtrol-hero-vital");
    if (!vitalElement) return;

    const valueInput = vitalElement.querySelector(`input[data-vital="${vital}"][data-field="value"]`);
    const maxInput = vitalElement.querySelector(`input[data-vital="${vital}"][data-field="max"]`);
    const fill = vitalElement.querySelector(".mtrol-vital-fill");

    const value = toNumber(valueInput?.value, 0);
    const max = toNumber(maxInput?.value, 0);
    const porcentaje = calcularPorcentajeVital({ value, max });

    if (fill) fill.style.setProperty("--mtrol-vital-percent", `${porcentaje}%`);
  }

  _onInventorySearchInput(event) {
    const input = event.currentTarget;
    const workspace = input?.closest?.(".mtrol-inventory-workspace");
    if (!workspace) return;

    this._mtrolInventorySearchTerm = input.value;
    this._applyInventoryFilter(workspace);
  }

  async _onUseConsumable(event) {
    event.preventDefault();
    const button = event.currentTarget;
    const itemId = String(
      button?.dataset?.itemId ?? this._mtrolSelectedItemId ?? ""
    ).trim();
    const item = this.actor.items?.get?.(itemId);
    if (!item || button.disabled) return false;

    button.disabled = true;
    button.setAttribute("aria-busy", "true");

    try {
      await useConsumable(this.actor, item);
      this.render(false);
      return true;
    } catch (error) {
      logger.error("SHEET", "No se pudo usar el consumible", { error: error.message });
      ui.notifications.error(error.message ?? "No se pudo usar el consumible.");
      return false;
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  }

  _onInventoryFilterChange(event) {
    const select = event.currentTarget;
    const workspace = select?.closest?.(".mtrol-inventory-workspace");
    if (!workspace) return;

    this._mtrolInventoryFilter = select.value;
    this._applyInventoryFilter(workspace);
  }

  _applyInventoryFilter(workspace) {
    if (!workspace) return;

    const inventoryView = buildInventoryViewModel(this.actor);
    const result = resolveInventoryFilterResult(
      inventoryView,
      {
        filter: this._mtrolInventoryFilter ?? "all",
        searchTerm: this._mtrolInventorySearchTerm ?? ""
      }
    );
    const visibleItemIds = new Set(result.items.map(item => item.id));
    this._mtrolInventoryFilter = result.filter;

    const filterControl = workspace.querySelector(".mtrol-inventory-filter");
    if (filterControl) filterControl.value = result.filter;

    workspace.querySelectorAll(".mtrol-inventory-item-row").forEach(row => {
      row.hidden = !visibleItemIds.has(row.dataset?.itemId);
    });

    workspace.querySelector(".mtrol-inventory-no-results")
      ?.classList.toggle(
        "is-visible",
        inventoryView.items.length > 0 && result.items.length === 0
      );
  }

  _onInventoryItemSelect(event) {
    if (event.target?.closest?.("button, a")) return;

    event.preventDefault();

    const control = event.currentTarget;
    const workspace = control?.closest?.(".mtrol-inventory-workspace");
    if (!workspace) return;

    const clickedItemId = String(control.dataset?.itemId ?? "").trim() || null;
    const selectedItemId = clickedItemId === this._mtrolSelectedItemId
      ? null
      : clickedItemId;
    this._mtrolSelectedItemId = selectedItemId;

    workspace.querySelectorAll(".mtrol-inventory-selectable").forEach(candidate => {
      candidate.classList.toggle(
        "is-selected",
        selectedItemId !== null && candidate.dataset?.itemId === selectedItemId
      );
    });

    this.render(false);
  }

  _onInventoryInspectorClose(event) {
    event.preventDefault();
    this._mtrolSelectedItemId = null;
    this.render(false);
  }

  _onInventoryInspectorKeydown(event) {
    if (event.key !== "Escape" || !this._mtrolSelectedItemId) return;
    event.preventDefault();
    event.stopPropagation();
    this._mtrolSelectedItemId = null;
    this.render(false);
  }

  async _onChangeEquipmentCharacterImage(event) {
    event.preventDefault();

    if (!game.user.isGM) {
      ui.notifications.warn("Solo el Game Master puede cambiar la imagen corporal.");
      return false;
    }

    const picker = new foundry.applications.apps.FilePicker.implementation({
      current: String(this.actor.system?.identidad?.fullBodyImage ?? ""),
      type: "image",
      callback: async path => {
        const selectedPath = String(path ?? "").trim();
        if (!selectedPath) return;

        try {
          await setPersonajeFullBodyImage(this.actor, selectedPath);
        } catch (error) {
          logger.error("SHEET", "No se pudo actualizar la imagen corporal", {
            actorUuid: this.actor.uuid,
            error: error.message
          });
          ui.notifications.error("No se pudo actualizar la imagen corporal.");
        }
      },
      position: {
        top: Number(this.position?.top ?? 0) + 40,
        left: Number(this.position?.left ?? 0) + 10
      },
      document: this.actor
    });

    await picker.browse();
    return true;
  }

  async _onChangeCompetenciaImage(event) {
    event.preventDefault();
    event.stopPropagation();

    if (!game.user.isGM) {
      ui.notifications.warn("Solo el Game Master puede cambiar la imagen de una competencia.");
      return false;
    }

    const item = this._getItemFromEvent(event);
    if (!item || item.type !== "competencia") return false;

    const picker = new foundry.applications.apps.FilePicker.implementation({
      current: String(item.img ?? ""),
      type: "image",
      callback: async path => {
        const selectedPath = String(path ?? "").trim();
        if (!selectedPath) return;

        try {
          await setCompetenceImage(item, selectedPath);
        } catch (error) {
          logger.error("SHEET", "No se pudo actualizar la imagen de la competencia", {
            actorUuid: this.actor.uuid,
            itemUuid: item.uuid,
            error: error.message
          });
          ui.notifications.error("No se pudo actualizar la imagen de la competencia.");
        }
      },
      position: {
        top: Number(this.position?.top ?? 0) + 40,
        left: Number(this.position?.left ?? 0) + 10
      },
      document: item
    });

    await picker.browse();
    return true;
  }

  async _onRemoveEquipmentCharacterImage(event) {
    event.preventDefault();

    if (!game.user.isGM) {
      ui.notifications.warn("Solo el Game Master puede quitar la imagen corporal.");
      return false;
    }

    await setPersonajeFullBodyImage(this.actor, "");
    return true;
  }

  async _onEquipmentSlotOpen(event) {
    if (event.target.closest("a, button")) return;

    event.preventDefault();

    const item = this._getItemFromEvent(event);
    if (!item) return;

    if (item.sheet) item.sheet.render(true);
  }

  async _onLevelUp(event) {
    event.preventDefault();
    if (!game.user?.isGM) {
      ui.notifications.warn("Sólo un GM puede ejecutar el level-up.");
      return false;
    }

    if (this._mtrolLevelUpPending) return false;
    if (!evaluateProgression(this.actor).eligible) {
      ui.notifications.warn("El Actor todavía no cumple todos los requisitos de ascenso.");
      return false;
    }

    const button = event.currentTarget;
    this._mtrolLevelUpPending = true;
    button.disabled = true;
    try {
      if (!(await this._confirmLevelUp())) return false;
      const receipt = await requestLevelUp(this.actor);
      ui.notifications.info(`${this.actor.name} alcanzó el nivel ${receipt.levelAfter}.`);
      this.render(true);
      return true;
    } catch (error) {
      ui.notifications.warn(error.message ?? "No se pudo completar el level-up.");
      return false;
    } finally {
      this._mtrolLevelUpPending = false;
      if (button.isConnected) button.disabled = false;
    }
  }

  _confirmLevelUp() {
    const nextLevel = evaluateProgression(this.actor).nextLevel;
    return new Promise(resolve => {
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      new Dialog({
        title: `Ascender a Nivel ${nextLevel}`,
        content: `<p>Este ascenso otorgará:</p><ul><li>+1 Atributo</li><li>+1 Competencia</li><li>+10 HP máx.</li><li>+10 MP máx.</li></ul><p>¿Confirmar ascenso?</p>`,
        buttons: {
          confirm: { label: "Confirmar ascenso", callback: () => finish(true) },
          cancel: { label: "Cancelar", callback: () => finish(false) }
        },
        default: "cancel",
        close: () => finish(false)
      }).render(true);
    });
  }

  async _onSpiritualResourceSegmentClick(event) {
    event.preventDefault();
    if (!game.user?.isGM) return false;

    const segment = event.currentTarget;
    try {
      const resource = String(segment.dataset.resource ?? "");
      const requestedValue = Number(segment.dataset.value);
      const currentValue = Number(this.actor.system?.recursos?.[resource] ?? 0);
      const nextValue = requestedValue === currentValue
        ? Math.max(0, requestedValue - 1)
        : requestedValue;

      await setActorSpiritualResource(
        this.actor,
        resource,
        nextValue
      );
      this.render(true);
      return true;
    } catch (error) {
      ui.notifications.warn(error.message ?? "No se pudo actualizar el recurso.");
      return false;
    }
  }

  _onProgressionRequirementSelect(event) {
    event.preventDefault();
    const key = String(event.currentTarget.dataset.requirementKey ?? "");
    if (!key) return false;
    this._mtrolSelectedProgressionRequirementKey = key;
    this.render(true);
    return true;
  }

  async _onAddOrb(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!game.user?.isGM) {
      ui.notifications.warn("Sólo un GM puede administrar Orbes.");
      return false;
    }

    const region = event.currentTarget.closest(".progresion-orbs");
    const type = region?.querySelector(".mtrol-orb-add-type")?.value;
    const level = Number(region?.querySelector(".mtrol-orb-add-level")?.value);
    if (!type) return false;

    const button = event.currentTarget;
    button.disabled = true;
    try {
      await addActorOrb(this.actor, { type, level });
      this.render(true);
      return true;
    } catch (error) {
      ui.notifications.warn(error.message ?? "No se pudo agregar el Orbe.");
      return false;
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  }

  async _onUpdateOrb(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!game.user?.isGM) {
      ui.notifications.warn("Sólo un GM puede administrar Orbes.");
      return false;
    }

    const row = event.currentTarget.closest(".progresion-orb-row");
    const orbId = row?.dataset?.orbId;
    const type = row?.querySelector(".mtrol-orb-type")?.value;
    const level = Number(row?.querySelector(".mtrol-orb-level")?.value);
    if (!orbId || !type) return false;

    row.querySelectorAll("select, button").forEach(control => {
      control.disabled = true;
    });
    try {
      await updateActorOrb(this.actor, orbId, { type, level });
      this.render(true);
      return true;
    } catch (error) {
      ui.notifications.warn(error.message ?? "No se pudo editar el Orbe.");
      this.render(true);
      return false;
    }
  }

  async _onDeleteOrb(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!game.user?.isGM) {
      ui.notifications.warn("Sólo un GM puede administrar Orbes.");
      return false;
    }

    const row = event.currentTarget.closest(".progresion-orb-row");
    const orbId = row?.dataset?.orbId;
    if (!orbId) return false;

    const button = event.currentTarget;
    button.disabled = true;
    try {
      await deleteActorOrb(this.actor, orbId);
      this.render(true);
      return true;
    } catch (error) {
      ui.notifications.warn(error.message ?? "No se pudo eliminar el Orbe.");
      return false;
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  }

  async _onSpendPendingAttribute(event) {
    event.preventDefault();
    const row = event.currentTarget.closest(".progresion-pending-row");
    const attributeKey = row?.querySelector(".mtrol-pending-attribute-select")?.value;
    if (!attributeKey) return false;

    const button = event.currentTarget;
    button.disabled = true;
    try {
      const receipt = await spendPendingAttributePoint(this.actor, attributeKey);
      ui.notifications.info(`Atributo mejorado a ${receipt.valueAfter}.`);
      this.render(true);
      return true;
    } catch (error) {
      ui.notifications.warn(error.message ?? "No se pudo asignar el atributo.");
      return false;
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  }

  async _onSpendPendingCompetence(event) {
    event.preventDefault();
    const row = event.currentTarget.closest(".progresion-pending-row");
    const itemId = row?.querySelector(".mtrol-pending-competence-select")?.value;
    if (!itemId) return false;

    const button = event.currentTarget;
    button.disabled = true;
    try {
      const receipt = await spendPendingCompetencePoint(this.actor, itemId);
      ui.notifications.info(`Competencia mejorada a nivel ${receipt.valueAfter}.`);
      this.render(true);
      return true;
    } catch (error) {
      ui.notifications.warn(error.message ?? "No se pudo asignar la competencia.");
      return false;
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  }

  async _onRestaurarDia(event) {
    event.preventDefault();

    if (!game.user.isGM) {
      ui.notifications.warn("Solo el GM puede restaurar el día.");
      return;
    }

    const button = event.currentTarget;
    button.disabled = true;

    try {
      await restaurarAcumuladoresDia(this.actor);
    } catch (error) {
      logger.error("SHEET", "No se pudo restaurar el día", { error: error.message });
      ui.notifications.error(error.message ?? "No se pudo restaurar el día.");
      return;
    } finally {
      if (button.isConnected) button.disabled = false;
    }

    ui.notifications.info(`Día restaurado para ${this.actor.name}.`);

    try {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content: `<strong>🌙 ${this.actor.name}</strong> ha restaurado el día. Los costes acumulados de MP fueron reiniciados.`
      });
    } catch (error) {
      logger.warn("SHEET", "Día restaurado sin mensaje de chat", { error: error.message });
    }
  }

  async _onRollAtributo(event) {
    event.preventDefault();
    event.stopPropagation();

    const attr =
      event.currentTarget.dataset.atributo ||
      event.currentTarget.dataset.attr;

    if (!attr) return;

    const control = this._getDharmaActionControl(event);
    const actionKey = control?.dataset?.mtrolActionKey;
    const dharmaSpend = this._getPreparedDharmaSpend(event);
    try {
      await this._executeAtributoRoll(attr, {
        dharmaSpend
      });
    } finally {
      this._updatePreparedDharmaState(actionKey, null);
    }
  }

  async _onPrepareTurn(event) {
    event.preventDefault();
    event.stopPropagation();
    const button = event.currentTarget;
    if (button.disabled) return false;
    button.disabled = true;
    try {
      const receipt = await prepare(this.actor);
      ui.notifications.info(`${this.actor.name} queda En preparación: +${receipt.value}.`);
      return true;
    } catch (error) {
      ui.notifications.warn(error.message ?? "No se pudo Preparar al personaje.");
      return false;
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  }

  async _onAdjustPreparation(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!game.user.isGM) return false;
    const button = event.currentTarget;
    if (button.disabled) return false;
    const delta = Number(button.dataset.delta ?? 0);
    button.disabled = true;
    try {
      const receipt = await setPreparation(
        this.actor,
        getPreparation(this.actor) + delta
      );
      ui.notifications.info(`Preparación de ${this.actor.name}: +${receipt.value}.`);
      return true;
    } catch (error) {
      ui.notifications.warn(error.message ?? "No se pudo modificar Preparación.");
      return false;
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  }

  async _executeAtributoRoll(attr, {
    dharmaSpend = null
  } = {}) {

    const movementAttributes = new Set(["destreza", "fuerza", "aura", "suerte"]);
    const turnGuard = getActionGuard(this.actor);
    if (!turnGuard.allowed) {
      ui.notifications.warn(turnGuard.reason);
      return null;
    }

    const fxData = FX_ATRIBUTOS[attr];

    if (!fxData) {
      ui.notifications.warn(`No existe configuración FX para: ${attr}`);
      return;
    }

    const valor = Number(this.actor.system.atributos?.[attr] ?? 0);
    const formula = `1d10 + ${valor}`;

    const args = [
      formula,
      this.actor,
      `⚔️ Tirada de ${fxData.label}: ${formula.replaceAll("d", "D")}`,
      {
        family: "check",
        categoryLabel: "Atributo",
        title: fxData.label,
        icon: this.actor.img ?? ""
      }
    ];

    if (dharmaSpend) {
      args.push({
        dharmaSpend
      });
    }

    const result =
      await mtrolRoll(...args);

    if (!result) return null;

    if (movementAttributes.has(attr)) {
      try {
        await grantMovementFromResolvedRoll(this.actor, result);
      } catch (error) {
        ui.notifications.warn(error.message ?? "No se pudo otorgar el movimiento de la tirada.");
      }
    }

    await this._playAtributoFX(attr, fxData);
    return result;
  }

  async _playAtributoFX(attr, fxData) {
    try {
      if (!game.modules.get("sequencer")?.active) {
        logger.warn("SHEET", "Sequencer no está activo; no se ejecuta FX");
        return;
      }

      if (!fxData?.file) {
        logger.warn("SHEET", "No hay FX configurado para el atributo", { attribute: attr });
        return;
      }

      const token = this.actor.getActiveTokens()[0];

      if (!token) {
        ui.notifications.warn("Colocá un token de este actor en la escena para ver el FX.");
        return;
      }

      await new Sequence()
        .effect()
        .file(fxData.file)
        .atLocation(token)
        .scale(0.8)
        .fadeIn(500)
        .fadeOut(500)
        .duration(5000)
        .play();

    } catch (error) {
      logger.error("SHEET", "Error ejecutando FX de atributo", { attribute: attr, error: error.message });
    }
  }

  async _onAddCompetencia(event) {
    event.preventDefault();

    if (!game.user.isGM) {
      ui.notifications.warn("Solo el Game Master puede crear competencias.");
      return;
    }

    await createSheetItem(this.actor, createCompetenceData());

    this.render(true);
  }

  async _onCompetenciaUp(event) {
    event.preventDefault();

    const item = this._getItemFromEvent(event);
    if (!item) return;

    if (
      esHabilidadBarraCombate(item) &&
      !this._puedeAdministrarBarraCombate()
    ) {
      return false;
    }

    if (!game.user.isGM) {
      ui.notifications.warn("Solo el Game Master puede subir competencias.");
      return;
    }

    try {
      await adjustCompetenceLevel(item, 1);
    } catch (error) {
      ui.notifications.warn(error.message);
      return false;
    }

    this.render(true);
  }

  async _onCompetenciaDown(event) {
    event.preventDefault();

    const item = this._getItemFromEvent(event);
    if (!item) return;

    if (
      esHabilidadBarraCombate(item) &&
      !this._puedeAdministrarBarraCombate()
    ) {
      return false;
    }

    if (!game.user.isGM) {
      ui.notifications.warn("Solo el Game Master puede bajar competencias.");
      return;
    }

    try {
      await adjustCompetenceLevel(item, -1);
    } catch (error) {
      ui.notifications.warn(error.message);
      return false;
    }

    this.render(true);
  }

  async _onSpecialAbilityLock(event) {
    event.preventDefault();
    const slot = Number(event.currentTarget.dataset.specialSlot);
    const state = resolveSpecialAbilitySlot(this.actor, slot);
    try {
      await updateSpecialAbilitySlot(this.actor, slot, { unlocked: !state.unlocked });
      this.render(true);
    } catch (error) {
      ui.notifications.warn(error.message ?? "No se pudo modificar el bloqueo.");
    }
  }

  async _onSpecialAbilityOverride(event) {
    event.preventDefault();
    const slot = Number(event.currentTarget.dataset.specialSlot);
    try {
      await updateSpecialAbilitySlot(this.actor, slot, {
        overrideItemUuid: event.currentTarget.value
      });
      this.render(true);
    } catch (error) {
      ui.notifications.warn(error.message ?? "No se pudo asignar el override.");
    }
  }

  async _onSpecialAbilityClearOverride(event) {
    event.preventDefault();
    const slot = Number(event.currentTarget.dataset.specialSlot);
    try {
      await updateSpecialAbilitySlot(this.actor, slot, { clearOverride: true });
      this.render(true);
    } catch (error) {
      ui.notifications.warn(error.message ?? "No se pudo limpiar el override.");
    }
  }

  async _onCompetenciaRoll(event) {
    const slot = Number(event.currentTarget?.dataset?.specialSlot ?? 0);
    if (![1, 2].includes(slot)) return this._executeCompetenciaRoll(event);

    event.preventDefault();
    event.stopPropagation();
    this._mtrolSpecialAbilityUseLocks ??= new Set();
    const lockKey = `${this.actor.uuid}:${slot}`;
    if (this._mtrolSpecialAbilityUseLocks.has(lockKey)) return false;

    const state = resolveSpecialAbilitySlot(this.actor, slot);
    try {
      validateSpecialAbilityExecution(this.actor, state.item, {
        slot,
        mode: state.handler === MTROL_ORB_CONTEXTUAL_HANDLER ? "attack" : null
      });
    } catch (error) {
      ui.notifications.warn(error.message);
      return false;
    }

    this._mtrolSpecialAbilityUseLocks.add(lockKey);
    event.currentTarget.disabled = true;
    try {
      let mode = null;
      if (state.handler === MTROL_ORB_CONTEXTUAL_HANDLER) {
        mode = await selectOrbContextualMode({ abilityName: state.item.name });
        if (!mode) return false;
      }
      return await this._executeCompetenciaRoll(event, {
        actionMode: mode,
        kindOverride: mode === "movement" ? "movement" : mode === "attack" ? "offensive" : null,
        specialContext: { slot, mode }
      });
    } finally {
      this._mtrolSpecialAbilityUseLocks.delete(lockKey);
      if (event.currentTarget.isConnected) event.currentTarget.disabled = false;
    }
  }

  async _executeCompetenciaRoll(event, {
    actionMode = null,
    kindOverride = null,
    specialContext = null
  } = {}) {
    event.preventDefault();
    event.stopPropagation();

    const item = this._getItemFromEvent(event);

    if (!item) {
      ui.notifications.warn("No se encontró la competencia.");
      return;
    }

    if (item.type !== "competencia") {
      logger.warn("SHEET", "El control no pertenece a una competencia", { itemId: item?.id ?? null });
      return;
    }

    const actor = this.actor;
    let actionDefinition = getActionDefinitionFromItem(item);

    if (!specialContext) {
      const assignedSpecial = findSpecialAbilitySlotForItem(actor, item);
      if (assignedSpecial?.locked) {
        ui.notifications.warn(`${assignedSpecial.label} está bloqueada.`);
        return false;
      }
      if (assignedSpecial?.handler === MTROL_ORB_CONTEXTUAL_HANDLER) {
        ui.notifications.warn(`${item.name} debe ejecutarse desde su slot de Habilidad Especial.`);
        return false;
      }
    }

    const turnGuard = getActionGuard(actor, item, { kindOverride });
    if (!turnGuard.allowed) {
      ui.notifications.warn(turnGuard.reason);
      return;
    }

    const executionModes = getCompetenceExecutionModes(item);
    if (executionModes.length > 0 && !actionMode) {
      const selectedMode = await selectCompetenceExecutionMode(item);
      if (!selectedMode) return false;
      const executionModeIntent = await prepareCompetenceModeIntent(actor, item, selectedMode);
      actionMode = selectedMode.modeId;
      specialContext = { ...(specialContext ?? {}), executionModeIntent };
      actionDefinition = getActionDefinitionFromItem(item, { declaredMode: actionMode });
    }

    if (
      actionDefinition.capabilities?.includes("DODGE") &&
      actionDefinition.capabilities?.includes("REACTION") &&
      !turnGuard.reactive
    ) {
      ui.notifications.warn(`${item.name} sólo puede usarse para responder una oposición activa.`);
      return;
    }

    const nivel =
      Number(item.system?.nivel ?? 1);

    let targetToken =
      Array.from(game.user.targets)[0] ?? null;

    if (turnGuard.reactive) {
      targetToken = turnGuard.opposition?.sourceTokenUuid
        ? await fromUuid(turnGuard.opposition.sourceTokenUuid)
        : null;
      const declaration = await declareOppositionResponse({
        pendingActionId: turnGuard.opposition?.id ?? null,
        actor,
        item,
        selectedCapability: item.system?.responseCapability ?? null,
        mode: item.system?.responseMode ?? null
      });
      if (!declaration) return false;
    }

    if (turnGuard.attributeFollowUp) {
      const followUpTargetGuard = getAttributeFollowUpTargetGuard(actor, targetToken);
      if (!followUpTargetGuard.allowed) {
        ui.notifications.warn(followUpTargetGuard.reason);
        return false;
      }
    }

    const control = this._getDharmaActionControl(event);
    const actionKey = control?.dataset?.mtrolActionKey;
    const dharmaSpend = this._getPreparedDharmaSpend(event);
    let resultado = null;
    const contextualModifiers = await adjudicateLevelDifferenceModifier({
      enabled: game.user?.isGM === true && event.shiftKey === true
    });

    const costoMP =
      calcularConsumoMP(actor, item).costoTotal;

    if (
      !game.user?.isGM &&
      costoMP > 0 &&
      !getPrimaryActiveGM()
    ) {
      this._updatePreparedDharmaState(actionKey, null);
      ui.notifications.warn(MTROL_GM_REQUIRED_MESSAGE);
      return;
    }

    try {
      resultado = await resolverCompetencia({
        actor,
        item,
        targetToken,
        formulaFallback: this._formulaCompetenciaPorNivel(nivel),
        dharmaSpend,
        actionMode,
        rollModifiers: contextualModifiers.initial
      });
    } finally {
      this._updatePreparedDharmaState(actionKey, null);
    }

    if (!resultado) return;

    const {
      targetActor,
      consumoMP,
      costoTotal,
      danioFormula,
      resultadoCompetencia,
      rollModifiers
    } = resultado;

    if (turnGuard.reactive) {
      const oppositionResult = await attachDefenseRollForActor({
        actor,
        item,
        defenderRoll: resultadoCompetencia,
        pendingActionId: turnGuard.opposition?.id ?? null,
        specialContext,
        consumeResponse: true,
        selectedCapability: item.system?.responseCapability ?? null,
        mode: item.system?.responseMode ?? null
      });

      return oppositionResult;
    }

    if (item.system?.actionType === "defense") {
      const defenseResult =
        await attachDefenseRollForActor({
          actor,
          item,
          defenderRoll: resultadoCompetencia,
          specialContext,
          consumeResponse: true
        });

      if (defenseResult) return;

      ui.notifications.warn(
        `${item.name} no pudo asociarse a una acción pendiente para ${actor.name}.`
      );

      return;
    }

    const isMovementAction = actionMode === "movement" ||
      kindOverride === "movement" ||
      item.system?.actionType === "movement";

    if (resultadoCompetencia?.pifia && !actionDefinition.requiresOpposition) {
      await this._finalizarConsumoCompetencia({
        actor,
        item,
        consumoMP,
        resultadoCompetencia,
        specialContext,
        targetActor,
        targetToken
      });

      if (!isMovementAction) await this._completarTurnoTrasAccion({ actor, item });

      return;
    }

    if (isMovementAction) {
      await this._finalizarConsumoCompetencia({
        actor,
        item,
        consumoMP,
        resultadoCompetencia,
        specialContext,
        targetActor,
        targetToken
      });
      return;
    }

    const damageConfig =
      getItemAbilityDamageConfig(item, {
        requiresOpposition: actionDefinition.requiresOpposition
      });
    const hasDamage =
      Boolean(danioFormula) && damageConfig.executesDamage;
    const damageContext = {
      available: hasDamage,
      formula: danioFormula,
      flatValue: Number.isFinite(Number(danioFormula)) ? Number(danioFormula) : null,
      localized: item.system?.usaDanioLocalizado !== false,
      costoTotal,
      modifiers: contextualModifiers.damage
    };

    if (actionDefinition.requiresOpposition) {
      const pendingAction = await createPendingActionFromCompetencia({
        actor,
        item,
        targetToken,
        attackerRoll: resultadoCompetencia,
        declaredMode: actionMode,
        actionModifiers: rollModifiers,
        damage: damageContext
      });

      if (pendingAction) {
        await this._finalizarConsumoCompetencia({
          actor,
          item,
          consumoMP,
          resultadoCompetencia,
          specialContext,
          pendingResolutionId: pendingAction.id
        });

        ui.notifications.info(
          `${item.name} espera una defensa manual.`
        );

        return;
      }

      return;
    }

    await this._finalizarConsumoCompetencia({
      actor,
      item,
      consumoMP,
      resultadoCompetencia,
      specialContext
    });
    await this._completarTurnoTrasAccion({ actor, item });

    return;

  }

  async _finalizarConsumoCompetencia({
    actor,
    item,
    consumoMP,
    resultadoCompetencia,
    specialContext = null,
    pendingResolutionId = null,
    pendingResolutionIds = [],
    targetActor = null,
    targetToken = null
  } = {}) {
    try {
      await finalizeResolvedCompetenciaUse(actor, item, resultadoCompetencia, {
        specialContext,
        pendingResolutionId,
        pendingResolutionIds,
        targetActorUuid: targetActor?.uuid ?? null,
        targetTokenUuid: targetToken?.document?.uuid ?? targetToken?.uuid ?? null
      });
    } catch (error) {
      ui.notifications.warn(error.message ?? "No se pudo registrar el uso en el turno.");
      throw error;
    }

    const executionMode = specialContext?.executionModeIntent ?? null;
    if (!executionMode) {
      await aplicarConsumoMP(
        actor,
        consumoMP,
        { item }
      );

      return;
    }

    const costeAplicado =
      Number(consumoMP?.costoTotal);

    const mpAntes =
      Number(consumoMP?.mpAnterior ?? consumoMP?.mpActual);

    if (
      !consumoMP?.exito ||
      !Number.isFinite(costeAplicado) ||
      costeAplicado <= 0 ||
      !Number.isFinite(mpAntes)
    ) {
      ui.notifications.warn(
        "MTROL | Meditar no pudo determinar el coste real de MP. No se aplicó consumo ni restauración."
      );

      logger.warn("SHEET", "Meditar sin coste aplicable", {
        actor: actor?.name,
        item: item?.name,
        consumoMP
      });

      return;
    }

    const mpDespuesCoste =
      Math.max(0, mpAntes - costeAplicado);

    const total =
      toNumber(resultadoCompetencia?.total, 0);

    const esPifia =
      !!resultadoCompetencia?.pifia;

    const exito =
      !esPifia && total >= 6;

    const mpMax =
      toNumber(actor.system?.vitales?.mp?.max, 0);

    const restauracion =
      exito ? costeAplicado * 2 : 0;

    const mpFinal =
      exito
        ? Math.min(mpMax, mpDespuesCoste + restauracion)
        : mpDespuesCoste;

    const consumoAplicado = await aplicarConsumoMP(
      actor,
      {
        ...consumoMP,
        mpNuevo: mpDespuesCoste
      },
      { item }
    );

    if (!exito) {
      const mensaje =
        esPifia
          ? "Pifia en Meditar: no recupera MP."
          : "Meditar fallido: no recupera MP.";

      ui.notifications.info(mensaje);

      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `
          <div class="mtrol-chat-card">
            <h2>${mensaje}</h2>
          </div>
        `
      });

      return;
    }

    if (executionMode.modeId === COMPETENCE_MODE_IDS.ASTRAL_PROJECTION) {
      const mensaje = "La concentración tiene éxito: entra narrativamente al plano astral.";
      ui.notifications.info(mensaje);
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<div class="mtrol-chat-card mtrol-chat-success"><h2>${mensaje}</h2><p>No genera estado mecánico.</p></div>`
      });
      return;
    }

    if (executionMode.modeId !== COMPETENCE_MODE_IDS.RECOVER_MP) {
      throw new Error(`Modo de competencia no soportado: ${executionMode.modeId}`);
    }

    const restauracionAplicada = await restaurarMPMeditacion(
      actor,
      consumoAplicado,
      resultadoCompetencia
    );

    const mpRecuperado = Number(restauracionAplicada?.restored ?? 0);

    const mensaje =
      `Meditar exitoso: recupera ${mpRecuperado} MP.`;

    ui.notifications.info(mensaje);

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `
        <div class="mtrol-chat-card mtrol-chat-success">
          <h2>${mensaje}</h2>
          <p>Restauraci&oacute;n calculada: ${restauracion} MP.</p>
        </div>
      `
    });
  }

  async _completarTurnoTrasAccion({ actor, item, resolutionId = null } = {}) {
    try {
      return await completeResolvedTurnAction(actor, {
        resolutionId,
        completionId: `sheet:${item?.uuid ?? item?.id ?? "action"}`
      });
    } catch (error) {
      ui.notifications.warn(error.message ?? "No se pudo finalizar automáticamente el turno.");
      return null;
    }
  }

  _puedeAdministrarBarraCombate() {
    if (game.user.isGM) return true;

    ui.notifications.warn(MTROL_COMBAT_BAR_GM_WARNING);
    return false;
  }

  async _onAddHabilidadCombate(event) {
    event.preventDefault();

    if (!this._puedeAdministrarBarraCombate()) return false;

    await createSheetItem(this.actor, createCombatAbilityData());

    this.render(true);
  }

  async _onEquiparHabilidadCombate(event) {
    event.preventDefault();

    if (!this._puedeAdministrarBarraCombate()) return false;

    const item = this._getItemFromEvent(event);
    if (!item) return;

    await setCombatBarEquipped(item, true);

    this.render(true);
  }

  async _onDesequiparHabilidadCombate(event) {
    event.preventDefault();
    event.stopPropagation();

    if (!this._puedeAdministrarBarraCombate()) return false;

    const item = this._getItemFromEvent(event);
    if (!item) return;

    await setCombatBarEquipped(item, false);

    this.render(true);
  }

  async _onCreateObjeto(event) {
    event?.preventDefault?.();

    if (!game.user.isGM) {
      ui.notifications.warn("Solo el Game Master puede crear objetos.");
      return;
    }

    await createSheetItem(this.actor, createObjectData());

    this.render(true);
  }

  async _onTradeRequest(event) {
    event.preventDefault();

    const target =
      Array.from(game.user.targets ?? [])[0];

    if (!target?.actor) {
      ui.notifications.warn("Selecciona un token objetivo para solicitar comercio.");
      return;
    }

    await requestTradeFromTarget({
      sourceActor: this.actor,
      targetToken: target
    });
  }

  async _onEditItem(event) {
    event.preventDefault();

    const item = this._getItemFromEvent(event);
    if (!item) return;

    if (
      esHabilidadBarraCombate(item) &&
      !this._puedeAdministrarBarraCombate()
    ) {
      return false;
    }

    if (item.type === "competencia" && !game.user.isGM) {
      ui.notifications.warn("Solo el Game Master puede editar competencias.");
      return false;
    }

    if (item.sheet) item.sheet.render(true);
  }

  async _onDeleteItem(event) {
    event.preventDefault();

    const item = this._getItemFromEvent(event);
    if (!item) return;

    if (
      esHabilidadBarraCombate(item) &&
      !this._puedeAdministrarBarraCombate()
    ) {
      return false;
    }

    if (!game.user.isGM) {
      ui.notifications.warn("Solo el Game Master puede eliminar elementos.");
      return;
    }

    const confirmDelete = event.currentTarget?.dataset?.confirmDelete === "true";
    if (confirmDelete && !(await this._confirmInventoryItemDeletion(item))) {
      return false;
    }

    const result = await deleteSheetItem(this.actor, item);
    if (!result.deleted) return false;

    this.render(true);
  }

  _confirmInventoryItemDeletion(item) {
    return new Promise(resolve => {
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const escapedName = foundry.utils.escapeHTML?.(String(item?.name ?? "objeto")) ??
        String(item?.name ?? "objeto");

      new Dialog({
        title: "Eliminar objeto",
        content: `<p>¿Eliminar <strong>${escapedName}</strong>?</p>`,
        buttons: {
          confirm: {
            icon: '<i class="fas fa-trash"></i>',
            label: "Eliminar",
            callback: () => finish(true)
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: "Cancelar",
            callback: () => finish(false)
          }
        },
        default: "cancel",
        close: () => finish(false)
      }).render(true);
    });
  }

  _getItemFromEvent(event) {
    const itemId =
      event.currentTarget.closest("[data-item-id]")?.dataset?.itemId ??
      event.currentTarget.dataset?.itemId;

    if (!itemId) {
      logger.warn("SHEET", "Evento sin data-item-id");
      return null;
    }

    const item =
      this.actor.items.get(itemId);

    if (!item) {
      logger.warn("SHEET", "Item del evento no encontrado", { itemId });
      return null;
    }

    return item;
  }

  _formulaCompetenciaPorNivel(nivel) {
    return formulaCompetenciaPorNivel(nivel);
  }
}
