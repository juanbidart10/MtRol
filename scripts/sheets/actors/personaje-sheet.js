import { mtrolRoll } from "../../rolls/mtrol-rolls.js";
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
  buildCompetenceLevelDisplay
} from "../../items/competencia-presentation.js";

import {
  abrirDialogoComercioMtrol
} from "../../ui/trade-dialog.js";

import {
  mtrolFlagScope
} from "../../core/system.js";

import {
  attachDefenseRollForActor,
  createPendingActionFromCompetencia,
  createReadyDamageActionFromCompetencia,
  getActionDefinitionFromItem
} from "../../actions/action-engine.js";

import {
  executeConfiguredCompetenciaDamage
} from "../../actions/action-damage-engine.js";

import {
  buildCombatLibraryViewModel
} from "../../combat/combat-library-view-model.js";

import {
  getAbilityRoleLabel,
  getItemAbilityDamageConfig
} from "../../actions/ability-config.js";

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
  formulaHasDharmaEligibleDice
} from "../../rolls/dharma-engine.js";

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
  setActorSpiritualResource
} from "../../actors/actor-resource-service.js";

import {
  getAllClassDefinitions,
  getClassDefinition,
  isValidClassId
} from "../../actors/class-registry.js";

const { ActorSheet } = foundry.appv1.sheets;

const MTROL_FALLBACK_ACTOR_IMG = "icons/svg/mystery-man.svg";
const MTROL_FALLBACK_ITEM_IMG = "icons/svg/item-bag.svg";
const MTROL_PERSONAJE_INITIAL_WIDTH = 700;
const MTROL_PERSONAJE_MIN_WIDTH = 480;
const MTROL_PERSONAJE_MIN_HEIGHT = 520;
const MTROL_PERSONAJE_TOP_FALLBACK = 40;
const MTROL_PERSONAJE_VIEWPORT_GAP = 8;
export const MTROL_INTERNAL_ITEM_DRAG_SOURCE = "mtrol-personaje-sheet";

export function buildInternalItemDragData(actor, item, slotOrigin = "") {
  return {
    type: "Item",
    uuid: item?.uuid ?? `${actor?.uuid ?? `Actor.${actor?.id}`}.Item.${item?.id}`,
    actorId: actor?.id ?? "",
    itemId: item?.id ?? "",
    mtrolInternal: {
      source: MTROL_INTERNAL_ITEM_DRAG_SOURCE,
      actorId: actor?.id ?? "",
      itemId: item?.id ?? "",
      slotOrigin: String(slotOrigin ?? "")
    }
  };
}

export function classifyItemDropData(actor, data) {
  const marker = data?.mtrolInternal;
  const isMarkedInternal = marker?.source === MTROL_INTERNAL_ITEM_DRAG_SOURCE;
  const actorId = String(marker?.actorId ?? data?.actorId ?? "").trim();
  const itemId = String(marker?.itemId ?? data?.itemId ?? "").trim();
  const uuid = String(data?.uuid ?? "").trim();
  const actorItems = Array.from(actor?.items ?? []);
  const uuidItem = uuid
    ? actorItems.find(item => String(item?.uuid ?? "") === uuid) ?? null
    : null;
  const idItem = itemId
    ? actor?.items?.get?.(itemId) ?? actorItems.find(item => item?.id === itemId) ?? null
    : null;
  const claimsCurrentActor = actorId === actor?.id || (
    actor?.uuid && uuid.startsWith(`${actor.uuid}.Item.`)
  );

  if (isMarkedInternal) {
    if (actorId !== actor?.id || !itemId || !idItem) {
      return { kind: "invalid-internal", item: null };
    }

    if (uuid && String(idItem.uuid ?? "") !== uuid) {
      return { kind: "invalid-internal", item: null };
    }

    return { kind: "internal", item: idItem };
  }

  if (uuidItem) return { kind: "internal", item: uuidItem };

  if (claimsCurrentActor) {
    if (idItem && uuid && String(idItem.uuid ?? "") !== uuid) {
      return { kind: "invalid-internal", item: null };
    }

    return idItem
      ? { kind: "internal", item: idItem }
      : { kind: "invalid-internal", item: null };
  }

  return { kind: "external", item: null };
}
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
const MTROL_COMBAT_BAR_CATEGORIES = new Set([
  "basico",
  "combate",
  "hechizo",
  "contraataque"
]);

const MTROL_PROGRESSION_REQUIREMENT_VISUALS = Object.freeze({
  mvp: Object.freeze({ label: "MVP", icon: "fa-trophy", description: "Reúne los puntos MVP exigidos para este ascenso." }),
  exp: Object.freeze({ label: "EXPERIENCIA", icon: "fa-star", description: "Alcanza la experiencia total requerida para el siguiente nivel." }),
  missionsCompleted: Object.freeze({ label: "MISIÓN COMPLETADA", icon: "fa-scroll", description: "Completa la cantidad de misiones requerida." }),
  dungeonsCompleted: Object.freeze({ label: "DUNGEON COMPLETADO", icon: "fa-dungeon", description: "Supera la cantidad de dungeons requerida." }),
  attributesAtFive: Object.freeze({ label: "ATRIBUTOS EN 5", icon: "fa-chart-bar", description: "Eleva suficientes atributos hasta nivel 5." }),
  competencesAtLeastThree: Object.freeze({ label: "COMPETENCIA NIVEL 3", icon: "fa-book-open", description: "Desarrolla una competencia hasta nivel 3 o superior." }),
  competencesAtFive: Object.freeze({ label: "COMPETENCIAS EN 5", icon: "fa-book-open", description: "Eleva suficientes competencias hasta nivel 5." }),
  meritCredits: Object.freeze({ label: "CRÉDITOS POR MÉRITO", icon: "fa-coins", description: "Obtén los créditos de mérito requeridos." }),
  defeatedLevel5Enemy: Object.freeze({ label: "ENEMIGO NIVEL 5 DERROTADO", icon: "fa-skull-crossbones", description: "Derrota a un enemigo de nivel 5." }),
  dmApproval: Object.freeze({ label: "APROBACIÓN DM", icon: "fa-shield-alt", description: "Obtén la aprobación del Director de Juego." })
});

function formatProgressionVisualNumber(value) {
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function prepareProgressionEvaluationForSheet(evaluation, selectedKey = null) {
  const requirements = evaluation.requirements.map(requirement => {
      const visual = MTROL_PROGRESSION_REQUIREMENT_VISUALS[requirement.key] ?? {
        label: String(requirement.label ?? requirement.key).toUpperCase(),
        icon: "fa-circle",
        description: "Completa este requisito para avanzar."
      };
      const isBoolean = typeof requirement.required === "boolean";

      return {
        ...requirement,
        label: visual.label,
        icon: visual.icon,
        description: visual.description,
        valueText: isBoolean
          ? "—"
          : `${formatProgressionVisualNumber(requirement.current)} / ${formatProgressionVisualNumber(requirement.required)}`,
        stateLabel: requirement.met ? "COMPLETADO" : "PENDIENTE"
      };
    });
  const selectedRequirement = requirements.find(requirement => requirement.key === selectedKey)
    ?? requirements[0]
    ?? null;

  return {
    ...evaluation,
    requirements: requirements.map(requirement => ({
      ...requirement,
      selected: requirement.key === selectedRequirement?.key
    })),
    selectedRequirement
  };
}


function normalizarNombreBanner(nombre) {
  return String(nombre ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getCombatBanner(item) {
  const img =
    item?.img;

  if (isValidImageSrc(img) && !isDefaultImageSrc(img)) {
    return img.trim();
  }

  console.warn("MTROL | Habilidad sin imagen personalizada para card de combate. Usando fallback.", {
    item: item?.name,
    img,
    fallback: MTROL_FALLBACK_ITEM_IMG
  });

  return MTROL_FALLBACK_ITEM_IMG;
}

function isValidImageSrc(src) {
  if (typeof src !== "string") return false;

  const value = src.trim();
  if (!value) return false;

  return !["null", "undefined", "[object object]"].includes(value.toLowerCase());
}

function isDefaultImageSrc(src) {
  if (!isValidImageSrc(src)) return false;

  const value =
    src.trim().toLowerCase();

  return [
    "icons/svg/item-bag.svg",
    "icons/svg/mystery-man.svg"
  ].includes(value);
}

function getSafeImageSrc(src, fallback, context = "imagen") {
  if (isValidImageSrc(src)) return src.trim();

  console.warn(`MTROL | Imagen invalida en ${context}. Usando fallback.`, {
    src,
    fallback
  });

  return fallback;
}

function prepareItemImageData(item, fallback = MTROL_FALLBACK_ITEM_IMG) {
  return {
    id: item.id,
    name: item.name,
    type: item.type,
    img: item.img,
    imgSeguro: getSafeImageSrc(item.img, fallback, `item ${item.name}`),
    system: item.system
  };
}

function formulaCompetenciaPorNivel(nivel) {
  switch (Number(nivel)) {
    case 1: return "1d4 + 1";
    case 2: return "1d6 + 2";
    case 3: return "1d8 + 3";
    case 4: return "1d10 + 4";
    case 5: return "1d12 + 5";
    default: return "1d4 + 1";
  }
}

function prepareExecutableItemData(item, availableDharma, actor, fallback = MTROL_FALLBACK_ITEM_IMG) {
  const formula = getCompetenciaRollFormula(item, {
    formulaFallback: formulaCompetenciaPorNivel(item.system?.nivel)
  });
  const eligible = formulaHasDharmaEligibleDice(formula);
  const hasDharma =
    Number.isInteger(availableDharma) &&
    availableDharma >= 1 &&
    availableDharma <= 5;
  const mpCost = calcularConsumoMP(actor, item);
  const levelDisplay = buildCompetenceLevelDisplay(item.system?.nivel);

  return {
    ...prepareItemImageData(item, fallback),
    mtrolIsProgressionCompetence: isProgressionCompetence(item),
    mtrolLevel: levelDisplay.value,
    mtrolLevelLabel: levelDisplay.label,
    mtrolLevelMarkers: levelDisplay.markers,
    mtrolRollFormula: formula ?? "",
    mtrolMpCost: mpCost.costoTotal,
    mtrolMpStackable: mpCost.stackea === true,
    mtrolMpStack: mpCost.stackAnterior,
    mtrolRoleLabel: getAbilityRoleLabel(item.system?.rol),
    mtrolDharmaEligible: eligible,
    mtrolDharmaEnabled: hasDharma && eligible,
    mtrolDharmaTitle: !hasDharma
      ? "No tienes Dharma disponible."
      : eligible
        ? `Gastar Dharma (${availableDharma} disponible${availableDharma === 1 ? "" : "s"})`
        : "Esta acción no contiene dados iniciales elegibles."
  };
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

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

function calcularPorcentajeVital(vital) {
  const value = toNumber(vital?.value, 0);
  const max = toNumber(vital?.max, 0);

  if (max <= 0) return 0;

  return Math.clamp((value / max) * 100, 0, 100);
}

function normalizarNombreCompetencia(nombre) {
  return String(nombre ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "");
}

function esCompetenciaMeditar(item) {
  return normalizarNombreCompetencia(item?.name) === "meditar";
}

function esHabilidadBarraCombate(item) {
  if (item?.type !== "competencia") return false;

  return (
    MTROL_COMBAT_BAR_CATEGORIES.has(item.system?.categoria) ||
    item.system?.tipo === "habilidad-combate"
  );
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

  getData(options) {
    const context = super.getData(options);

    context.actor = this.actor;
    context.system = this.actor.system;
    context.esGM = game.user.isGM === true;
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

    const competencias = this.actor.items.filter(
      i => i.type === "competencia"
    );

    const habilidadesCombate = competencias.filter(
      esHabilidadBarraCombate
    );

    const competenciasGenerales = competencias.filter(
      i => !esHabilidadBarraCombate(i)
    );

    context.competencias = competencias.map(i => prepareExecutableItemData(i, availableDharma, this.actor));
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

    const item = await Item.implementation.fromDropData(data);

    if (!item) {
      ui.notifications.warn("No se pudo leer el objeto arrastrado.");
      return false;
    }

    const itemData = item.toObject();

    if (itemData.type === "item") {
      itemData.type = "objeto";
    }

    itemData.system = {
      tipoObjeto: itemData.system?.tipoObjeto ?? "general",
      cantidad: itemData.system?.cantidad ?? 1,
      material: itemData.system?.material ?? "",
      peso: getItemUnitWeight(itemData),
      equipable: itemData.system?.equipable ?? false,
      equipado: false,
      slot: itemData.system?.slot ?? "",
      defensa: itemData.system?.defensa ?? 0,
      defensaBase: itemData.system?.defensaBase ?? itemData.system?.defensa ?? 0,
      danio: itemData.system?.danio ?? "",
      valor: itemData.system?.valor ?? 0,
      descripcion: itemData.system?.descripcion ?? itemData.system?.description ?? ""
    };

    await this.actor.createEmbeddedDocuments("Item", [itemData]);
    ui.notifications.info(`Objeto agregado: ${item.name}`);
    this.render(true);
    return true;
  }

  async _onDrop(event) {
    event.preventDefault();

    let data;

    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch (err) {
      console.error("MtRol | Drop inválido", err);
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

    if (game.user.isGM) {
      html.find(".add-competencia")
        .off("click")
        .on("click", this._onAddCompetencia.bind(this));

      html.find(".competencia-image-edit")
        .off("click")
        .on("click", this._onChangeCompetenciaImage.bind(this));

      html.find(".mtrol-class-resource-control")
        .off("change")
        .on("change", this._onClassResourceConfigurationChange.bind(this));

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
      await updateActorResourceConfigurationAuthoritative({
        actorUuid: this.actor.uuid,
        transactionId: `sheet-resource-config-${foundry.utils.randomID()}`,
        expectedClassId: String(this.actor.system?.identidad?.classId ?? ""),
        changes: {
          [configKey]: input.value
        }
      }, {
        requestingUserId: game.user.id,
        trustedActor: this.actor
      });
      return true;
    } catch (error) {
      console.error("MTROL | No se pudo actualizar la configuración de recursos.", error);
      ui.notifications.error(error?.message ?? "No se pudo actualizar la configuración de recursos.");
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
      console.error("MTROL | No se pudieron actualizar los modificadores de recursos.", error);
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

        console.warn("MTROL | Imagen fallida en PersonajeSheet. Usando fallback.", {
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

        console.warn("MTROL | Imagen con dimensiones invalidas en PersonajeSheet. Usando fallback.", {
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
      console.warn("MTROL | No se pudo preparar Dharma Burn.", error);
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
          await this.actor.update({
            "system.identidad.fullBodyImage": selectedPath
          });
        } catch (error) {
          console.error("MTROL | No se pudo actualizar la imagen corporal.", error);
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
          await item.update({ img: selectedPath });
        } catch (error) {
          console.error("MTROL | No se pudo actualizar la imagen de la competencia.", error);
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

    await this.actor.update({
      "system.identidad.fullBodyImage": ""
    });
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

    await this.actor.update({
      "system.mpStack": 0
    });

    await this.actor.unsetFlag(mtrolFlagScope(), "mpStacks");

    ui.notifications.info(`Día restaurado para ${this.actor.name}.`);

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `<strong>🌙 ${this.actor.name}</strong> ha restaurado el día. Los costes acumulados de MP fueron reiniciados.`
    });

    this.render(true);
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

  async _executeAtributoRoll(attr, {
    dharmaSpend = null
  } = {}) {

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

    await this._playAtributoFX(attr, fxData);
    return result;
  }

  async _playAtributoFX(attr, fxData) {
    try {
      if (!game.modules.get("sequencer")?.active) {
        console.warn("MtRol | Sequencer no está activo. No se puede ejecutar FX.");
        return;
      }

      if (!fxData?.file) {
        console.warn(`MtRol | No hay FX configurado para el atributo: ${attr}`);
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
      console.error("MtRol | Error ejecutando FX de atributo:", error);
    }
  }

  async _onAddCompetencia(event) {
    event.preventDefault();

    if (!game.user.isGM) {
      ui.notifications.warn("Solo el Game Master puede crear competencias.");
      return;
    }

    await this.actor.createEmbeddedDocuments("Item", [{
      name: "Nueva competencia",
      type: "competencia",
      system: {
        nivel: 1,
        categoria: "competencia",
        actionType: "utility",
        effect: "none",
        requiresTarget: false,
        requiresOpposition: false,
        oppositionType: "free",
        effectDuration: 1,
        effectIntensity: 0,
        banner: "",
        damageResolution: "immediate",
        damageMode: "automatic",
        damageCostType: "none",
        cooldown: 0,
        fx: {
          visual: "",
          sonido: "",
          duracion: 5000,
          escala: 1
        },
        descripcion: ""
      }
    }]);

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

    if (!isProgressionCompetence(item)) {
      ui.notifications.warn("Este Item no es una competencia de progresión.");
      return false;
    }

    const nivelActual = Number(item.system.nivel || 1);
    const nivelNuevo = Math.min(5, nivelActual + 1);

    await item.update({
      "system.nivel": nivelNuevo
    });

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

    if (!isProgressionCompetence(item)) {
      ui.notifications.warn("Este Item no es una competencia de progresión.");
      return false;
    }

    const nivelActual = Number(item.system.nivel || 1);
    const nivelNuevo = Math.max(1, nivelActual - 1);

    await item.update({
      "system.nivel": nivelNuevo
    });

    this.render(true);
  }

  async _onCompetenciaRoll(event) {
    event.preventDefault();
    event.stopPropagation();

    const item = this._getItemFromEvent(event);

    if (!item) {
      ui.notifications.warn("No se encontró la competencia.");
      return;
    }

    if (item.type !== "competencia") {
      console.warn("MtRol | El botón de competencia no pertenece a una competencia:", item);
      return;
    }

    const actor = this.actor;

    const nivel =
      Number(item.system?.nivel ?? 1);

    const targetToken =
      Array.from(game.user.targets)[0] ?? null;

    const control = this._getDharmaActionControl(event);
    const actionKey = control?.dataset?.mtrolActionKey;
    const dharmaSpend = this._getPreparedDharmaSpend(event);
    let resultado = null;

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
        dharmaSpend
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
      resultadoCompetencia
    } = resultado;

    if (item.system?.actionType === "defense") {
      const defenseResult =
        await attachDefenseRollForActor({
          actor,
          item,
          defenderRoll: resultadoCompetencia
        });

      if (defenseResult) {
        await this._finalizarConsumoCompetencia({
          actor,
          item,
          consumoMP,
          resultadoCompetencia
        });

        return;
      }

      ui.notifications.warn(
        `${item.name} no pudo asociarse a una acción pendiente para ${actor.name}.`
      );

      return;
    }

    if (resultadoCompetencia?.pifia) {
      await this._finalizarConsumoCompetencia({
        actor,
        item,
        consumoMP,
        resultadoCompetencia
      });

      return;
    }

    const actionDefinition =
      getActionDefinitionFromItem(item);
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
      costoTotal
    };

    if (actionDefinition.requiresOpposition) {
      const pendingAction = await createPendingActionFromCompetencia({
        actor,
        item,
        targetToken,
        attackerRoll: resultadoCompetencia,
        damage: damageConfig.resolution === "onOppositionWin"
          ? damageContext
          : {
              ...damageContext,
              available: false
            }
      });

      if (pendingAction) {
        await this._finalizarConsumoCompetencia({
          actor,
          item,
          consumoMP,
          resultadoCompetencia
        });

        if (hasDamage && damageConfig.resolution === "immediate") {
          if (damageConfig.mode === "enabled") {
            await createReadyDamageActionFromCompetencia({
              actor,
              item,
              targetToken,
              attackerRoll: resultadoCompetencia,
              damage: damageContext
            });
          } else {
            try {
              await executeConfiguredCompetenciaDamage({
                actor,
                targetActor,
                targetToken,
                formula: danioFormula,
                flatValue: Number.isFinite(Number(danioFormula)) ? Number(danioFormula) : null,
                costoTotal,
                damageCostType: damageConfig.costType,
                damageContext: {
                  item,
                  title: item.name,
                  icon: item.img ?? actor.img ?? ""
                }
              });
            } catch (error) {
              ui.notifications.warn(error.message ?? `Formula de dano invalida: ${danioFormula}`);
            }
          }
        }

        ui.notifications.info(
          `${item.name} espera una defensa manual.`
        );

        return;
      }

      return;
    }

    if (!hasDamage) {
      await this._finalizarConsumoCompetencia({
        actor,
        item,
        consumoMP,
        resultadoCompetencia
      });

      return;
    }

    if (damageConfig.mode === "enabled") {
      await this._finalizarConsumoCompetencia({
        actor,
        item,
        consumoMP,
        resultadoCompetencia
      });

      const readyDamage = await createReadyDamageActionFromCompetencia({
        actor,
        item,
        targetToken,
        attackerRoll: resultadoCompetencia,
        damage: damageContext
      });

      if (!readyDamage) return;

      ui.notifications.info(`${item.name} habilitó su ejecución de daño.`);
      return;
    }

    await this._finalizarConsumoCompetencia({
      actor,
      item,
      consumoMP,
      resultadoCompetencia
    });

    try {
      await executeConfiguredCompetenciaDamage({
        actor,
        targetActor,
        targetToken,
        formula: danioFormula,
        flatValue: Number.isFinite(Number(danioFormula)) ? Number(danioFormula) : null,
        costoTotal,
        damageCostType: damageConfig.costType,
        damageContext: {
          item,
          title: item.name,
          icon: item.img ?? actor.img ?? ""
        }
      });
    } catch (error) {
      ui.notifications.warn(error.message ?? `Formula de dano invalida: ${danioFormula}`);
      return;
    }

    return;

  }

  async _finalizarConsumoCompetencia({
    actor,
    item,
    consumoMP,
    resultadoCompetencia
  } = {}) {
    if (!esCompetenciaMeditar(item)) {
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

      console.warn("MTROL | Meditar sin coste aplicable", {
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

  _puedeAdministrarBarraCombate() {
    if (game.user.isGM) return true;

    ui.notifications.warn(MTROL_COMBAT_BAR_GM_WARNING);
    return false;
  }

  async _onAddHabilidadCombate(event) {
    event.preventDefault();

    if (!this._puedeAdministrarBarraCombate()) return false;

    await this.actor.createEmbeddedDocuments("Item", [{
      name: "Nueva habilidad de combate",
      type: "competencia",
      system: {
        nivel: 1,
        categoria: "combate",
        actionType: "combatSkill",
        effect: "none",
        requiresTarget: false,
        requiresOpposition: false,
        oppositionType: "free",
        effectDuration: 1,
        effectIntensity: 0,
        equipadaCombate: false,
        formula: "",
        danio: "",
        atributo: "",
        tipo: "habilidad-combate",
        usaDanioLocalizado: false,
        ejecutaDanio: true,
        damageResolution: "immediate",
        damageMode: "automatic",
        damageCostType: "none",
        banner: "",
        cooldown: 0,
        fx: {
          visual: "",
          autocast: "",
          proyectil: "",
          target: "",
          sonido: "",
          duracion: 5000,
          escala: 1
        },
        descripcion: ""
      }
    }]);

    this.render(true);
  }

  async _onEquiparHabilidadCombate(event) {
    event.preventDefault();

    if (!this._puedeAdministrarBarraCombate()) return false;

    const item = this._getItemFromEvent(event);
    if (!item) return;

    await item.update({
      "system.equipadaCombate": true
    });

    this.render(true);
  }

  async _onDesequiparHabilidadCombate(event) {
    event.preventDefault();
    event.stopPropagation();

    if (!this._puedeAdministrarBarraCombate()) return false;

    const item = this._getItemFromEvent(event);
    if (!item) return;

    await item.update({
      "system.equipadaCombate": false
    });

    this.render(true);
  }

  async _onCreateObjeto(event) {
    event?.preventDefault?.();

    if (!game.user.isGM) {
      ui.notifications.warn("Solo el Game Master puede crear objetos.");
      return;
    }

    await this.actor.createEmbeddedDocuments("Item", [{
      name: "Nuevo objeto",
      type: "objeto",
      system: {
        tipoObjeto: "general",
        cantidad: 1,
        material: "",
        peso: 1,
        equipable: false,
        equipado: false,
        slot: "",
        defensa: 0,
        defensaBase: 0,
        danio: "",
        valor: 0,
        descripcion: ""
      }
    }]);

    this.render(true);
  }

  async _onTradeRequest(event) {
    event.preventDefault();

    const target =
      Array.from(game.user.targets ?? [])[0];

    const targetActor =
      target?.actor ?? null;

    if (!targetActor) {
      ui.notifications.warn("Selecciona un token objetivo para solicitar comercio.");
      return;
    }

    abrirDialogoComercioMtrol(
      this.actor,
      targetActor
    );
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

    if (isMtrolObject(item)) {
      const unequipped = await desequiparObjeto(this.actor, item);
      if (!unequipped) return;
    }

    await item.delete();

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
      console.warn("MtRol | No se encontró data-item-id en el evento.", event);
      return null;
    }

    const item =
      this.actor.items.get(itemId);

    if (!item) {
      console.warn(`MtRol | No se encontró item con id: ${itemId}`);
      return null;
    }

    return item;
  }

  _formulaCompetenciaPorNivel(nivel) {
    return formulaCompetenciaPorNivel(nivel);
  }
}
