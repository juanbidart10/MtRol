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

// =========================
// HELPERS
// =========================

function obtenerFormulaTirada(item, categoria, formulaFallback = null) {

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

// =========================
// RESOLVER COMPETENCIA
// =========================

export async function resolverCompetencia({
  actor,
  item,
  targetToken = null,
  formulaFallback = null
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
    obtenerFormulaTirada(
      item,
      categoria,
      formulaFallback
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

  if (requiereTarget(categoria, danioFormula) && !targetToken) {
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

    resultadoCompetencia = await mtrolRoll(
      formulaTirada,
      actor,
      `⚔️ ${item.name} | ${categoria.toUpperCase()}`
    );

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
