// =========================
// MTROL - MP ENGINE
// =========================

import {
  mtrolFlagScope
} from "../core/system.js";

import {
  MTROL_CATEGORIES,
  normalizarCategoria
} from "../core/categories.js";

// =========================
// HELPERS
// =========================

function normalizarTexto(valor) {
  return String(valor ?? "")
    .trim()
    .toLowerCase();
}

function obtenerCosteBase(item, fallback = 1) {
  const coste =
    Number(
      item.system?.costeMP ??
      item.system?.costoMP ??
      fallback
    );

  if (!Number.isFinite(coste) || coste < 0) return 0;

  return coste;
}

function obtenerNivelHechizo(item) {
  const nivel =
    Number(
      item.system?.nivelHechizo ??
      item.system?.nivel ??
      1
    );

  if (!Number.isFinite(nivel)) return 1;

  return Math.clamp(nivel, 1, 5);
}

function obtenerClaveStack(item, categoria) {

  const competenciaAsociada =
    item.system?.competenciaAsociada ??
    item.system?.competenciaMagica ??
    item.system?.escuela ??
    "";

  if (categoria === MTROL_CATEGORIES.HECHIZO && competenciaAsociada) {
    return `hechizo:${normalizarTexto(competenciaAsociada)}`;
  }

  return String(item.id ?? item.name);

}

function debeStackear(categoria) {

  return [
    MTROL_CATEGORIES.COMPETENCIA,
    MTROL_CATEGORIES.HECHIZO
  ].includes(categoria);

}

// =========================
// VALIDAR CONSUMO MP
// =========================

export function validarConsumoMP(actor, item) {

  if (!actor || !item) {
    console.warn("MTROL | procesarConsumoMP sin actor o item.", { actor, item });

    return {
      exito: false,
      motivo: "actor_o_item_invalido",
      costoTotal: 0,
      categoria: null,
      mpActual: 0
    };
  }

  const categoria =
    normalizarCategoria(
      item.system?.categoria ?? MTROL_CATEGORIES.COMPETENCIA
    );

  const mpActual =
    Number(actor.system.vitales?.mp?.value ?? 0);

  const stacks =
    foundry.utils.duplicate(
      actor.getFlag(mtrolFlagScope(), "mpStacks") ?? {}
    );

  const stackKey =
    obtenerClaveStack(item, categoria);

  const stackActual =
    Number(stacks[stackKey] ?? 0);

  let costoBase = 0;
  let costoStack = 0;
  let costoTotal = 0;

  // =========================
  // PASIVA
  // =========================

  if (categoria === MTROL_CATEGORIES.PASIVA) {

    costoBase = 0;
    costoStack = 0;
    costoTotal = 0;

  }

  // =========================
  // BASICO
  // 1 MP FIJO
  // =========================

  else if (categoria === MTROL_CATEGORIES.BASICO) {

    costoBase = 1;
    costoStack = 0;
    costoTotal = 1;

  }

  // =========================
  // COMPETENCIA
  // 1 + STACK PROPIO
  // =========================

  else if (categoria === MTROL_CATEGORIES.COMPETENCIA) {

    costoBase = 0;
    costoStack = 1 + stackActual;
    costoTotal = costoStack;

  }

  // =========================
  // HECHIZO
  // NIVEL HECHIZO + STACK COMPETENCIA ASOCIADA
  // =========================

  else if (categoria === MTROL_CATEGORIES.HECHIZO) {

    const nivelHechizo =
      obtenerNivelHechizo(item);

    costoBase =
      nivelHechizo;

    costoStack =
      1 + stackActual;

    costoTotal =
      costoBase + costoStack;

  }

  // =========================
  // CONTRAATAQUE
  // 5 MP FIJO
  // =========================

  else if (categoria === MTROL_CATEGORIES.CONTRAATAQUE) {

    costoBase = 5;
    costoStack = 0;
    costoTotal = 5;

  }

  // =========================
  // HABILIDAD DE COMBATE
  // COSTE DEFINIDO, FALLBACK 5
  // =========================

  else if (categoria === MTROL_CATEGORIES.COMBATE) {

    costoBase =
      obtenerCosteBase(item, 5);

    costoStack = 0;
    costoTotal = costoBase;

  }

  // =========================
  // FALLBACK SEGURO
  // =========================

  else {

    costoBase =
      obtenerCosteBase(item, 1);

    costoStack = 0;
    costoTotal = costoBase;

  }

  if (!Number.isFinite(costoTotal) || costoTotal < 0) {
    costoTotal = 0;
  }

  // =========================
  // VALIDAR MP
  // =========================

  if (mpActual < costoTotal) {

    ui.notifications.warn(
      `${actor.name} no tiene suficiente MP. Necesita ${costoTotal} MP.`
    );

    return {
      exito: false,
      motivo: "mp_insuficiente",
      costoTotal,
      costoBase,
      costoStack,
      categoria,
      mpActual,
      stackActual,
      stackKey
    };

  }

  return {
    exito: true,
    costoTotal,
    costoBase,
    costoStack,
    categoria,
    mpActual,
    mpAnterior: mpActual,
    mpNuevo: Math.max(0, mpActual - costoTotal),
    stackKey,
    stackAnterior: stackActual,
    stackNuevo: debeStackear(categoria) ? stackActual + 1 : stackActual,
    stackea: debeStackear(categoria),
    stacks
  };

}

// =========================
// APLICAR CONSUMO MP
// =========================

export async function aplicarConsumoMP(actor, consumoMP) {
  if (!actor || !consumoMP?.exito) return null;

  await actor.update({
    "system.vitales.mp.value": consumoMP.mpNuevo
  });

  if (consumoMP.stackea) {
    const stacks =
      foundry.utils.duplicate(consumoMP.stacks ?? {});

    stacks[consumoMP.stackKey] =
      consumoMP.stackNuevo;

    const flagScope =
      mtrolFlagScope();

    await actor.setFlag(
      flagScope,
      "mpStacks",
      stacks
    );

    console.log(
      "MTROL | Stack MP guardado",
      {
        scope: flagScope,
        categoria: consumoMP.categoria,
        stackKey: consumoMP.stackKey,
        stackAnterior: consumoMP.stackAnterior,
        stackNuevo: consumoMP.stackNuevo,
        stacks
      }
    );
  }

  return consumoMP;
}

// =========================
// PROCESAR CONSUMO MP
// =========================

export async function procesarConsumoMP(actor, item) {
  const consumoMP =
    validarConsumoMP(actor, item);

  if (!consumoMP?.exito) return consumoMP;

  return aplicarConsumoMP(actor, consumoMP);
}
