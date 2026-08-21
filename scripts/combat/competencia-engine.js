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
  getActionDefinitionFromItem
} from "../actions/action-engine.js";

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
  dharmaSpend = null
} = {}) {

  if (!actor || !item) {
    console.warn("MTROL | resolverCompetencia cancelado: falta actor o item.");
    return null;
  }

  if (item.type !== "competencia") {
    console.warn("MTROL | resolverCompetencia cancelado: el item no es competencia.", item);
    return null;
  }

  const nivel =
    Number(item.system?.nivel ?? 1);

  const categoria =
    normalizarCategoria(item.system?.categoria ?? MTROL_CATEGORIES.COMPETENCIA);

  const danioFormula =
    item.system?.danio?.toString().trim() || "";

  const formulaTirada =
    getCompetenciaRollFormula(
      item,
      {
        categoria,
        formulaFallback
      }
    );

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

  if (requiereTargetConfigurado(item, categoria, danioFormula) && !targetToken) {
    ui.notifications.warn(
      `Seleccioná un objetivo antes de usar ${item.name}.`
    );
    return null;
  }

  // =========================
  // MP
  // =========================

  const consumoMP =
    validarConsumoMP(actor, item);

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
        actionType: item.system?.actionType,
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
    esSkillBar
  };

}
