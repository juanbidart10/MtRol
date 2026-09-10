// =========================
// MTROL - COMPETENCIA ENGINE
// =========================

import { mtrolRoll } from "../rolls/mtrol-rolls.js";

import {
  validarConsumoMP
} from "./mp-engine.js";

import {
  playCompetenciaFX
} from "../integrations/sequencer.js";

import {
  MTROL_CATEGORIES,
  normalizarCategoria
} from "../core/categories.js";

import {
  resolveActionDefinition as getActionDefinitionFromItem
} from "../actions/action-definition-resolver.js";

import {
  getActionGuard
} from "./turn-system.js";
import { logger } from "../utils/logger.js";
import { getCanonicalDamageFormula } from "../actions/combat-ability-policy.js";
import {
  appendModifiersToFormula,
  normalizeContextualModifiers,
  validateCanonicalFormula
} from "../actions/combat-ability-policy.js";

// =========================
// HELPERS
// =========================

export function getCompetenciaRollFormula(item, {
  categoria = normalizarCategoria(
    item?.system?.categoria ?? MTROL_CATEGORIES.COMPETENCIA
  ),
  formulaFallback = null
} = {}) {

  const formulaManual =
    item.system?.formula?.toString().trim() ||
    item.system?.formulaTirada?.toString().trim() ||
    "";

  if (formulaManual) return formulaManual;

  if (categoria === MTROL_CATEGORIES.COMPETENCIA) {
    return formulaFallback;
  }

  return "";

}

function requiereTarget(categoria, danioFormula) {

  return [
    MTROL_CATEGORIES.COMBATE,
    MTROL_CATEGORIES.CONTRAATAQUE,
    MTROL_CATEGORIES.HECHIZO,
    MTROL_CATEGORIES.BASICO
  ].includes(categoria) && !!danioFormula;

}

function requiereTargetConfigurado(item, categoria, danioFormula) {

  if (getActionDefinitionFromItem(item).requiresOpposition) {
    return true;
  }

  if (item.system?.requiresTarget === true || item.system?.requiresTarget === "true") {
    return true;
  }

  if (item.system?.requiresOpposition === true || item.system?.requiresOpposition === "true") {
    return true;
  }

  return requiereTarget(categoria, danioFormula);

}

// =========================
// RESOLVER COMPETENCIA
// =========================

export async function resolverCompetencia({
  actor,
  item,
  targetToken = null,
  formulaFallback = null,
  dharmaSpend = null,
  actionMode = null,
  rollModifiers = [],
  actionAttemptId = null,
  paidConsumption = null
} = {}) {

  if (!actor || !item) {
    logger.warn("COMPETENCIA", "competencia resolution rejected", {
      command: "competencia.resolve",
      actorUuid: actor?.uuid ?? null,
      status: "rejected",
      reasonCode: "COMPETENCIA_INPUT_MISSING"
    });
    return null;
  }

  if (item.type !== "competencia") {
    logger.warn("COMPETENCIA", "competencia resolution rejected", {
      command: "competencia.resolve",
      actorUuid: actor.uuid ?? null,
      itemUuid: item.uuid ?? null,
      itemType: item.type ?? null,
      status: "rejected",
      reasonCode: "COMPETENCIA_ITEM_TYPE_INVALID"
    });
    return null;
  }

  const turnGuard = getActionGuard(actor, item, {
    actionAttemptId,
    kindOverride: actionMode === "movement"
      ? "movement"
      : actionMode === "attack" ? "offensive" : null
  });
  if (!turnGuard.allowed) {
    ui.notifications.warn(turnGuard.reason);
    return null;
  }

  const nivel =
    Number(item.system?.nivel ?? 1);

  const categoria =
    normalizarCategoria(item.system?.categoria ?? MTROL_CATEGORIES.COMPETENCIA);

  const danioFormula =
    getCanonicalDamageFormula(item);

  const formulaTiradaBase =
    getCompetenciaRollFormula(
      item,
      {
        categoria,
        formulaFallback
      }
    );
  const normalizedRollModifiers = normalizeContextualModifiers(rollModifiers, {
    allowGmOnly: game.user?.isGM === true
  });
  const formulaTirada = formulaTiradaBase
    ? appendModifiersToFormula(formulaTiradaBase, normalizedRollModifiers)
    : "";
  if (formulaTiradaBase) {
    const validation = validateCanonicalFormula(formulaTiradaBase, { label: "formula" });
    if (!validation.valid) {
      ui.notifications.warn(`Configuración inválida de ${item.name}: ${validation.errors.join(" ")}`);
      return null;
    }
  }

  const esHabilidadCombate =
    categoria === MTROL_CATEGORIES.COMBATE ||
    item.system?.tipo === "habilidad-combate";

  const esSkillBar =
    item.system?.tipo === "habilidad-combate";

  // =========================
  // PASIVA
  // =========================

  if (categoria === MTROL_CATEGORIES.PASIVA) {
    ui.notifications.info(`${item.name} es una habilidad pasiva.`);
    return null;
  }

  // =========================
  // TARGET
  // =========================

  if (actionMode !== "movement" && requiereTargetConfigurado(item, categoria, danioFormula) && !targetToken) {
    ui.notifications.warn(
      `Seleccioná un objetivo antes de usar ${item.name}.`
    );
    return null;
  }

  // =========================
  // MP
  // =========================

  const consumoMP =
    paidConsumption ?? validarConsumoMP(actor, item);

  if (!consumoMP?.exito) return null;

  const costoTotal =
    consumoMP.costoTotal;

  // =========================
  // FX
  // =========================

  await playCompetenciaFX(
    actor,
    item,
    targetToken
  );

  // =========================
  // TIRADA / DAÑO
  // =========================

  let resultadoCompetencia = null;

  if (formulaTirada) {

    const rollArgs = [
      formulaTirada,
      actor,
      `⚔️ ${item.name} | ${categoria.toUpperCase()}`,
      {
        item,
        actionType: actionMode === "movement" ? "movement" : item.system?.actionType,
        defenseType: item.system?.defenseType,
        effect: item.system?.effect,
        category: categoria,
        title: item.name,
        icon: item.img ?? actor.img ?? ""
      }
    ];

    if (dharmaSpend) {
      rollArgs.push({
        dharmaSpend
      });
    }

    resultadoCompetencia = await mtrolRoll(...rollArgs);

  }

  else if (danioFormula) {

    resultadoCompetencia = {
      pifia: false,
      soloDanio: true
    };

  }

  else {

    ui.notifications.warn(
      `${item.name} no tiene Fórmula de Tirada ni Fórmula de Daño configurada.`
    );

    return null;

  }

  return {
    actor,
    item,
    targetToken,
    targetActor: targetToken?.actor ?? null,
    resultadoCompetencia,
    consumoMP,
    costoTotal,
    danioFormula,
    categoria,
    nivel,
    esHabilidadCombate,
    esSkillBar,
    actionMode,
    rollModifiers: normalizedRollModifiers
  };

}
