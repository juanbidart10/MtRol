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

import {
  getActorResourceTransaction,
  runActorResourceTransaction
} from "../actors/actor-resource-service.js";

import {
  requestPrimaryGM
} from "../core/socket-requests.js";

// =========================
// HELPERS
// =========================

function obtenerCosteBaseLegacy(item, fallback = 1) {
  const coste =
    Number(
      item.system?.costeMP ??
      item.system?.costoMP ??
      fallback
    );

  if (!Number.isFinite(coste) || coste < 0) return 0;

  return coste;
}

function obtenerClaveStack(item) {
  return String(item.id ?? item.name);
}

function debeStackear(categoria) {
  return categoria === MTROL_CATEGORIES.COMPETENCIA;
}

function normalizarStackPersistido(value) {
  const stack = Number(value ?? 0);
  return Number.isFinite(stack) && stack >= 0
    ? Math.trunc(stack)
    : 0;
}

function obtenerCostoBasicoAdjunto(item, categoria) {
  return (
    categoria === MTROL_CATEGORIES.COMPETENCIA &&
    item?.system?.damageCostType === "basic"
  )
    ? 1
    : 0;
}

function normalizarNivel(item) {
  const nivel = Number(item?.system?.nivel ?? 1);
  return Number.isFinite(nivel) ? Math.max(1, Math.trunc(nivel)) : 1;
}

function createTransactionId() {
  return foundry.utils.randomID?.() ?? crypto.randomUUID();
}

function getUser(userId) {
  if (typeof game.users?.get === "function") return game.users.get(userId);
  return Array.from(game.users ?? []).find(user => user.id === userId) ?? null;
}

function userCanUseActor(actor, userId) {
  const user = getUser(userId);
  if (!user || !actor) return false;
  if (user.isGM) return true;
  return actor.testUserPermission?.(user, "OWNER") === true;
}

function isMeditateItem(item) {
  return String(item?.name ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "") === "meditar";
}

function getMpIntent(item) {
  if (item?.id === "mtrol-damage-resolution-basic") {
    return { kind: "resolution-basic", itemId: item.id };
  }

  return {
    kind: "item-cost",
    itemId: String(item?.id ?? ""),
    itemUuid: item?.uuid ?? null
  };
}

function getCanonicalCostItem(actor, intent, trustedItem = null) {
  if (intent?.kind === "resolution-basic") {
    return {
      id: "mtrol-damage-resolution-basic",
      name: "Resolución de daño básica",
      system: { categoria: MTROL_CATEGORIES.BASICO }
    };
  }

  if (trustedItem && String(trustedItem.id) === String(intent?.itemId)) {
    return trustedItem;
  }

  return actor?.items?.get?.(intent?.itemId) ?? null;
}

export function calcularConsumoMP(actor, item) {
  if (!actor || !item) {
    return {
      exito: false,
      motivo: "actor_o_item_invalido",
      costoTotal: 0,
      categoria: null,
      mpActual: 0
    };
  }

  const categoria = normalizarCategoria(
    item.system?.categoria ?? MTROL_CATEGORIES.COMPETENCIA
  );
  const mpActual = Number(actor.system?.vitales?.mp?.value ?? 0);
  const stackea = debeStackear(categoria);
  const stacks = stackea
    ? foundry.utils.duplicate(actor.getFlag?.(mtrolFlagScope(), "mpStacks") ?? {})
    : {};
  const stackKey = stackea ? obtenerClaveStack(item) : null;
  const stackActual = stackea
    ? normalizarStackPersistido(stacks[stackKey])
    : 0;
  const costoBasico = obtenerCostoBasicoAdjunto(item, categoria);

  let costoBase = 0;
  let costoStack = 0;

  switch (categoria) {
    case MTROL_CATEGORIES.PASIVA:
      costoBase = 0;
      break;
    case MTROL_CATEGORIES.BASICO:
      costoBase = 1;
      break;
    case MTROL_CATEGORIES.COMPETENCIA:
      costoBase = costoBasico;
      costoStack = 1 + stackActual;
      break;
    case MTROL_CATEGORIES.HECHIZO:
      costoBase = normalizarNivel(item);
      break;
    case MTROL_CATEGORIES.CONTRAATAQUE:
    case MTROL_CATEGORIES.COMBATE:
      costoBase = 5;
      break;
    default:
      costoBase = obtenerCosteBaseLegacy(item, 1);
      break;
  }

  const costoTotal = Math.max(0, Number(costoBase + costoStack) || 0);

  return {
    exito: mpActual >= costoTotal,
    motivo: mpActual >= costoTotal ? null : "mp_insuficiente",
    costoTotal,
    costoBase,
    costoBasico,
    costoStack,
    categoria,
    mpActual,
    mpAnterior: mpActual,
    mpNuevo: Math.max(0, mpActual - costoTotal),
    stackKey,
    stackAnterior: stackActual,
    stackNuevo: stackea ? stackActual + 1 : stackActual,
    stackea,
    stacks
  };
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

  const consumo = calcularConsumoMP(actor, item);
  const { costoTotal, categoria, mpActual } = consumo;

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
      ...consumo
    };

  }

  return {
    ...consumo,
    transactionId: createTransactionId(),
    resourceIntent: getMpIntent(item),
    _trustedItem: item
  };

}

// =========================
// APLICAR CONSUMO MP
// =========================

export async function aplicarConsumoMPAuthoritative(payload = {}, {
  requestingUserId = game.user?.id,
  trustedActor = null,
  trustedItem = null
} = {}) {
  if (!game.user?.isGM) {
    throw new Error("Solo un GM puede consumir MP autoritativamente.");
  }

  const actor = trustedActor ?? await fromUuid(String(payload.actorUuid ?? ""));
  if (!actor) throw new Error("No se encontró el Actor para consumir MP.");
  if (!userCanUseActor(actor, requestingUserId)) {
    throw new Error("El usuario no puede consumir MP de este Actor.");
  }

  const intent = payload.intent ?? {};
  const item = getCanonicalCostItem(actor, intent, trustedItem);
  if (!item) throw new Error("No se encontró el Item canónico para consumir MP.");

  return runActorResourceTransaction(actor, {
    transactionId: payload.transactionId,
    origin: "mp-cost"
  }, async canonicalActor => {
    const canonicalConsumption = calcularConsumoMP(canonicalActor, item);
    if (!canonicalConsumption.exito) {
      throw new Error(
        `MP insuficiente: disponible ${canonicalConsumption.mpActual}, requerido ${canonicalConsumption.costoTotal}.`
      );
    }

    const changes = {
      "system.vitales.mp.value": canonicalConsumption.mpNuevo
    };
    if (canonicalConsumption.stackea) {
      const stacks = foundry.utils.duplicate(canonicalConsumption.stacks ?? {});
      stacks[canonicalConsumption.stackKey] = canonicalConsumption.stackNuevo;
      changes[`flags.${mtrolFlagScope()}.mpStacks`] = stacks;
    }

    await canonicalActor.update(changes);

    return {
      authorized: true,
      exito: true,
      intent: { ...intent },
      itemId: item.id ?? null,
      meditateEligible: isMeditateItem(item),
      costoTotal: canonicalConsumption.costoTotal,
      costoBasico: canonicalConsumption.costoBasico,
      costoStack: canonicalConsumption.costoStack,
      categoria: canonicalConsumption.categoria,
      mpAnterior: canonicalConsumption.mpAnterior,
      mpNuevo: canonicalConsumption.mpNuevo,
      stackea: canonicalConsumption.stackea,
      stackKey: canonicalConsumption.stackKey,
      stackAnterior: canonicalConsumption.stackAnterior,
      stackNuevo: canonicalConsumption.stackNuevo
    };
  });
}

export async function aplicarConsumoMP(actor, consumoMP, { item = null } = {}) {
  if (!actor || !consumoMP?.exito) return null;

  const payload = {
    actorUuid: actor.uuid,
    transactionId: consumoMP.transactionId,
    intent: consumoMP.resourceIntent
  };

  if (game.user?.isGM) {
    return aplicarConsumoMPAuthoritative(payload, {
      requestingUserId: game.user.id,
      trustedActor: actor,
      trustedItem: item ?? consumoMP._trustedItem ?? null
    });
  }

  const response = await requestPrimaryGM("mtrolSpendMP", payload);
  if (!response.ok) throw new Error(response.error ?? "No se pudo consumir MP.");
  return response.result?.receipt ?? null;
}

// =========================
// PROCESAR CONSUMO MP
// =========================

export async function procesarConsumoMP(actor, item) {
  const consumoMP =
    validarConsumoMP(actor, item);

  if (!consumoMP?.exito) return consumoMP;

  return aplicarConsumoMP(actor, consumoMP, { item });
}

export async function restaurarAcumuladoresDia(actor) {
  if (!game.user?.isGM) {
    throw new Error("Solo un GM puede restaurar los acumuladores diarios.");
  }
  if (!actor) throw new Error("No se encontró el Actor para restaurar el día.");

  return runActorResourceTransaction(actor, {
    transactionId: `daily-reset:${createTransactionId()}`,
    origin: "daily-reset"
  }, async canonicalActor => {
    const stacksAnteriores = foundry.utils.duplicate(
      canonicalActor.getFlag?.(mtrolFlagScope(), "mpStacks") ?? {}
    );

    // Se serializa con los consumos para que ninguno pueda regrabar un stack
    // anterior mientras se está restaurando el día.
    // Eliminar la clave completa evita el merge recursivo de Foundry: escribir
    // un objeto vacío conserva las entradas anteriores del flag.
    await canonicalActor.unsetFlag(mtrolFlagScope(), "mpStacks");
    const stacksDespues = foundry.utils.duplicate(
      canonicalActor.getFlag?.(mtrolFlagScope(), "mpStacks") ?? {}
    );

    if (Object.keys(stacksDespues).length > 0) {
      throw new Error("No se pudieron reiniciar los acumuladores diarios de MP.");
    }

    return {
      authorized: true,
      restored: true,
      competenciasRestauradas: Object.keys(stacksAnteriores).length,
      stacksAnteriores,
      stacks: stacksDespues
    };
  });
}

export function validarCostoResolucionMP(actor, costType = "none") {
  if (costType === "none") {
    const mpActual = Number(actor?.system?.vitales?.mp?.value ?? 0);
    return {
      exito: Boolean(actor),
      motivo: actor ? null : "actor_o_item_invalido",
      costoTotal: 0,
      costoBase: 0,
      costoStack: 0,
      categoria: MTROL_CATEGORIES.BASICO,
      mpActual,
      mpAnterior: mpActual,
      mpNuevo: mpActual,
      stackea: false,
      stacks: {}
    };
  }

  if (costType !== "basic") {
    return {
      exito: false,
      motivo: "tipo_costo_resolucion_invalido",
      costoTotal: 0,
      categoria: null,
      mpActual: Number(actor?.system?.vitales?.mp?.value ?? 0)
    };
  }

  return validarConsumoMP(actor, {
    id: "mtrol-damage-resolution-basic",
    name: "Resolución de daño básica",
    system: {
      categoria: MTROL_CATEGORIES.BASICO
    }
  });
}

export async function reembolsarCostoResolucionMP(actor, consumoMP) {
  if (!actor || !consumoMP?.transactionId) return false;

  const payload = {
    actorUuid: actor.uuid,
    originalTransactionId: consumoMP.transactionId,
    transactionId: `${consumoMP.transactionId}:refund`
  };

  if (game.user?.isGM) {
    return reembolsarCostoMPAuthoritative(payload, {
      requestingUserId: game.user.id,
      trustedActor: actor
    });
  }

  const response = await requestPrimaryGM("mtrolRefundMP", payload);
  if (!response.ok) throw new Error(response.error ?? "No se pudo reembolsar MP.");
  return response.result?.receipt ?? false;
}

export async function reembolsarCostoMPAuthoritative(payload = {}, {
  requestingUserId = game.user?.id,
  trustedActor = null
} = {}) {
  if (!game.user?.isGM) throw new Error("Solo un GM puede reembolsar MP autoritativamente.");
  const actor = trustedActor ?? await fromUuid(String(payload.actorUuid ?? ""));
  if (!actor) throw new Error("No se encontró el Actor para reembolsar MP.");
  if (!userCanUseActor(actor, requestingUserId)) throw new Error("El usuario no puede reembolsar MP de este Actor.");

  const original = getActorResourceTransaction(actor.uuid, payload.originalTransactionId);
  if (!original || original.origin !== "mp-cost") {
    throw new Error("No existe un consumo MP autoritativo para reembolsar.");
  }

  return runActorResourceTransaction(actor, {
    transactionId: payload.transactionId,
    origin: "mp-refund"
  }, async canonicalActor => {
    const actual = Number(canonicalActor.system?.vitales?.mp?.value ?? 0);
    const maximo = Number(canonicalActor.system?.vitales?.mp?.max ?? actual);
    const mpNuevo = Math.min(maximo, actual + Number(original.costoTotal ?? 0));
    await canonicalActor.update({ "system.vitales.mp.value": mpNuevo });
    return {
      authorized: true,
      originalTransactionId: original.transactionId,
      costoTotal: original.costoTotal,
      mpAnterior: actual,
      mpNuevo
    };
  });
}

export async function restaurarMPMeditacionAuthoritative(payload = {}, {
  requestingUserId = game.user?.id,
  trustedActor = null
} = {}) {
  if (!game.user?.isGM) throw new Error("Solo un GM puede restaurar MP autoritativamente.");
  const actor = trustedActor ?? await fromUuid(String(payload.actorUuid ?? ""));
  if (!actor) throw new Error("No se encontró el Actor para Meditar.");
  if (!userCanUseActor(actor, requestingUserId)) throw new Error("El usuario no puede usar Meditar con este Actor.");

  const original = getActorResourceTransaction(actor.uuid, payload.originalTransactionId);
  if (!original?.meditateEligible || original.origin !== "mp-cost") {
    throw new Error("El consumo original no pertenece a Meditar.");
  }

  const total = Number(payload.total ?? 0);
  const success = payload.fumble !== true && total >= 6;
  if (!success) return {
    authorized: true,
    restored: 0,
    success: false,
    mpNuevo: Number(actor.system?.vitales?.mp?.value ?? 0)
  };

  return runActorResourceTransaction(actor, {
    transactionId: payload.transactionId,
    origin: "meditate"
  }, async canonicalActor => {
    const actual = Number(canonicalActor.system?.vitales?.mp?.value ?? 0);
    const maximo = Number(canonicalActor.system?.vitales?.mp?.max ?? actual);
    const restoration = Number(original.costoTotal ?? 0) * 2;
    const mpNuevo = Math.min(maximo, actual + restoration);
    await canonicalActor.update({ "system.vitales.mp.value": mpNuevo });
    return {
      authorized: true,
      success: true,
      originalTransactionId: original.transactionId,
      restoration,
      restored: Math.max(0, mpNuevo - actual),
      mpAnterior: actual,
      mpNuevo
    };
  });
}

export async function restaurarMPMeditacion(actor, consumoAplicado, resultado = {}) {
  if (!actor || !consumoAplicado?.transactionId) return null;
  const payload = {
    actorUuid: actor.uuid,
    originalTransactionId: consumoAplicado.transactionId,
    transactionId: `${consumoAplicado.transactionId}:meditate`,
    total: Number(resultado.total ?? 0),
    fumble: resultado.pifia === true
  };

  if (game.user?.isGM) {
    return restaurarMPMeditacionAuthoritative(payload, {
      requestingUserId: game.user.id,
      trustedActor: actor
    });
  }

  const response = await requestPrimaryGM("mtrolRestoreMeditationMP", payload);
  if (!response.ok) throw new Error(response.error ?? "No se pudo restaurar MP con Meditar.");
  return response.result?.receipt ?? null;
}
