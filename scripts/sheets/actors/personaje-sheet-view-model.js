import { isProgressionCompetence } from "../../progression/progression-competence.js";
import { getCompetenciaRollFormula } from "../../combat/competencia-engine.js";
import { calcularConsumoMP } from "../../combat/mp-engine.js";
import { buildCompetenceLevelDisplay } from "../../items/competencia-presentation.js";
import { formulaHasDharmaEligibleDice } from "../../rolls/dharma-engine.js";
import { evaluateOppositionResponseEligibility } from "../../actions/opposition-policy.js";
import { getAbilityRoleLabel } from "../../actions/ability-config.js";
import { getActionGuard, getItemCooldownStatus } from "../../combat/turn-system.js";
import {
  findSpecialAbilitySlotForItem,
  MTROL_ORB_CONTEXTUAL_HANDLER
} from "../../combat/special-ability-service.js";
import { logger } from "../../utils/logger.js";

export const MTROL_FALLBACK_ITEM_IMG = "icons/svg/item-bag.svg";

const MTROL_COMBAT_BAR_CATEGORIES = new Set(["basico", "combate", "hechizo", "contraataque"]);
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

export function prepareProgressionEvaluationForSheet(evaluation, selectedKey = null) {
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
      valueText: isBoolean ? "—" : `${formatProgressionVisualNumber(requirement.current)} / ${formatProgressionVisualNumber(requirement.required)}`,
      stateLabel: requirement.met ? "COMPLETADO" : "PENDIENTE"
    };
  });
  const selectedRequirement = requirements.find(requirement => requirement.key === selectedKey) ?? requirements[0] ?? null;
  return {
    ...evaluation,
    requirements: requirements.map(requirement => ({
      ...requirement,
      selected: requirement.key === selectedRequirement?.key
    })),
    selectedRequirement
  };
}

export function isValidImageSrc(src) {
  if (typeof src !== "string") return false;
  const value = src.trim();
  return Boolean(value) && !["null", "undefined", "[object object]"].includes(value.toLowerCase());
}

export function isDefaultImageSrc(src) {
  if (!isValidImageSrc(src)) return false;
  return ["icons/svg/item-bag.svg", "icons/svg/mystery-man.svg"].includes(src.trim().toLowerCase());
}

export function getSafeImageSrc(src, fallback, context = "imagen") {
  if (isValidImageSrc(src)) return src.trim();
  logger.warn("SHEET", "Imagen inválida; se usa fallback", { context, src, fallback });
  return fallback;
}

export function getCombatBanner(item, fallback = MTROL_FALLBACK_ITEM_IMG) {
  if (isValidImageSrc(item?.img) && !isDefaultImageSrc(item.img)) return item.img.trim();
  logger.warn("SHEET", "Habilidad sin imagen personalizada; se usa fallback", {
    itemId: item?.id ?? null,
    itemName: item?.name,
    img: item?.img,
    fallback
  });
  return fallback;
}

export function prepareItemImageData(item, fallback = MTROL_FALLBACK_ITEM_IMG) {
  return {
    id: item.id,
    name: item.name,
    type: item.type,
    img: item.img,
    imgSeguro: getSafeImageSrc(item.img, fallback, `item ${item.name}`),
    system: item.system
  };
}

export function formulaCompetenciaPorNivel(nivel) {
  switch (Number(nivel)) {
    case 1: return "1d4 + 1";
    case 2: return "1d6 + 2";
    case 3: return "1d8 + 3";
    case 4: return "1d10 + 4";
    case 5: return "1d12 + 5";
    default: return "1d4 + 1";
  }
}

export function prepareExecutableItemData(item, availableDharma, actor, fallback = MTROL_FALLBACK_ITEM_IMG) {
  const formula = getCompetenciaRollFormula(item, { formulaFallback: formulaCompetenciaPorNivel(item.system?.nivel) });
  const eligible = formulaHasDharmaEligibleDice(formula);
  const hasDharma = Number.isInteger(availableDharma) && availableDharma >= 1 && availableDharma <= 5;
  const mpCost = calcularConsumoMP(actor, item);
  const levelDisplay = buildCompetenceLevelDisplay(item.system?.nivel);
  const cooldownStatus = getItemCooldownStatus(item);
  const actionGuard = getActionGuard(actor, item);
  const oppositionEligibility = actionGuard.reactive
    ? evaluateOppositionResponseEligibility({
        pendingAction: actionGuard.opposition,
        actor,
        item,
        selectedCapability: item.system?.responseCapability ?? null,
        mode: item.system?.responseMode ?? null,
        guard: actionGuard
      })
    : null;
  const assignedSpecial = findSpecialAbilitySlotForItem(actor, item);
  const specialRouteAllowed = !assignedSpecial ||
    (assignedSpecial.unlocked && assignedSpecial.handler !== MTROL_ORB_CONTEXTUAL_HANDLER);

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
    mtrolCooldownAvailable: cooldownStatus.available,
    mtrolCooldownAvailableAtRound: cooldownStatus.availableAtRound,
    mtrolCooldownRoundsRemaining: cooldownStatus.roundsRemaining,
    mtrolActionAvailable: actionGuard.allowed && specialRouteAllowed && cooldownStatus.available && oppositionEligibility?.valid !== false,
    mtrolActionUnavailableReason: !cooldownStatus.available
      ? "En enfriamiento"
      : oppositionEligibility?.humanReason ?? actionGuard.reason ?? (
          assignedSpecial?.locked
            ? `${assignedSpecial.label} está bloqueada.`
            : assignedSpecial?.handler === MTROL_ORB_CONTEXTUAL_HANDLER
              ? "Usá esta habilidad desde su slot especial."
              : "Acción no disponible."
        ),
    mtrolDharmaEligible: eligible,
    mtrolDharmaEnabled: hasDharma && eligible,
    mtrolDharmaTitle: !hasDharma
      ? "No tienes Dharma disponible."
      : eligible
        ? `Gastar Dharma (${availableDharma} disponible${availableDharma === 1 ? "" : "s"})`
        : "Esta acción no contiene dados iniciales elegibles."
  };
}

export function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function calcularPorcentajeVital(vital) {
  const value = toNumber(vital?.value, 0);
  const max = toNumber(vital?.max, 0);
  if (max <= 0) return 0;
  return Math.clamp((value / max) * 100, 0, 100);
}

export function esHabilidadBarraCombate(item) {
  if (item?.type !== "competencia") return false;
  return MTROL_COMBAT_BAR_CATEGORIES.has(item.system?.categoria) ||
    item.system?.tipo === "habilidad-combate";
}

