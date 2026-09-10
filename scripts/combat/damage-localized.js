import {
  MTROL_BODY_ROLL_TABLE,
  MTROL_BODY_SLOT_LABELS
} from "../constants/body-slots.js";


import {
  destroyEquippedItem
} from "../items/item-destruction-engine.js";

import {
  applyDamageToHpAuthoritative
} from "../actors/actor-resource-service.js";

import {
  aplicarDanioCanonicoAutorizado,
  resolveAuthorizedDamageMitigation
} from "./damage-authorized.js";
import { logger } from "../utils/logger.js";

// =========================
// MTROL - DAMAGE LOCALIZED ENGINE
// =========================

function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;

  const n = Number(
    String(value).replace(",", ".")
  );

  return Number.isFinite(n) ? n : 0;
}

function serializeRoll(roll) {
  if (!roll) return null;

  return roll.toJSON?.() ?? roll.toObject?.() ?? null;
}

function getDeathUpdateOptions(targetTokenDocument) {
  return {
    mtrolDeathTargetTokenUuid: targetTokenDocument?.uuid ?? null
  };
}

function createDamageTransactionId(prefix) {
  return `${prefix}:${globalThis.foundry?.utils?.randomID?.() ?? crypto.randomUUID()}`;
}

function previewDamageToTarget({
  actor,
  actorObjetivo,
  slotObjetivo,
  danioFinal,
  combatId,
  resultado
}) {
  if (danioFinal <= 0) return resultado;

  const itemId =
    actorObjetivo.system?.equipamiento?.[slotObjetivo] ?? "";

  const item =
    itemId ? actorObjetivo.items.get(itemId) : null;

  if (!item) {
    const mitigation = resolveAuthorizedDamageMitigation({
      attackerActor: actor,
      targetActor: actorObjetivo,
      damage: danioFinal,
      combatId
    });
    resultado.hpPerdido = mitigation.resolution.value;
    resultado.danioMitigadoPasiva = danioFinal - resultado.hpPerdido;
    resultado.effectResolution = mitigation.resolution;

    resultado.hpNuevo =
      Math.max(0, resultado.hpAnterior - resultado.hpPerdido);

    return resultado;
  }

  const defensaActual =
    Math.max(0, toNumber(item.system?.defensa ?? 0));

  const danioAbsorbido =
    Math.min(defensaActual, danioFinal);

  const danioSobrante =
    Math.max(0, danioFinal - defensaActual);

  const mitigation = resolveAuthorizedDamageMitigation({
    attackerActor: actor,
    targetActor: actorObjetivo,
    damage: danioSobrante,
    combatId
  });
  const hpDamage = mitigation.resolution.value;

  const defensaNueva =
    Math.max(0, defensaActual - danioFinal);

  resultado.defensaInicial =
    defensaActual;

  resultado.defensaFinal =
    defensaNueva;

  resultado.danioAbsorbido =
    danioAbsorbido;

  resultado.hpPerdido =
    hpDamage;

  resultado.danioMitigadoPasiva = danioSobrante - hpDamage;
  resultado.effectResolution = mitigation.resolution;

  resultado.hpNuevo =
    Math.max(0, resultado.hpAnterior - hpDamage);

  resultado.itemDestruido =
    defensaNueva <= 0;

  return resultado;
}

async function applyDamageToTarget({
  actorObjetivo,
  targetTokenDocument,
  slotObjetivo,
  danioFinal,
  resultado
}) {
  if (danioFinal <= 0) return resultado;

  const itemId =
    actorObjetivo.system?.equipamiento?.[slotObjetivo] ?? "";

  const item =
    itemId ? actorObjetivo.items.get(itemId) : null;

  if (!item) {
    const hpWrite = await applyDamageToHpAuthoritative(actorObjetivo, danioFinal, {
      transactionId: createDamageTransactionId("damage-localized-direct-unarmored"),
      updateOptions: getDeathUpdateOptions(targetTokenDocument)
    });
    const hpNuevo = hpWrite.hpAfter;

    resultado.hpPerdido =
      danioFinal;

    resultado.hpNuevo =
      hpNuevo;

    return resultado;
  }

  const defensaActual =
    Math.max(0, toNumber(item.system?.defensa ?? 0));

  resultado.defensaInicial =
    defensaActual;

  const danioAbsorbido =
    Math.min(defensaActual, danioFinal);

  const danioSobrante =
    Math.max(0, danioFinal - defensaActual);

  const defensaNueva =
    Math.max(0, defensaActual - danioFinal);

  resultado.danioAbsorbido =
    danioAbsorbido;

  resultado.defensaFinal =
    defensaNueva;

  resultado.hpPerdido =
    danioSobrante;

  if (defensaNueva <= 0) {
    resultado.itemDestruido =
      true;

    await destroyEquippedItem({
      actor: actorObjetivo,
      item,
      slot: slotObjetivo,
      reason: "daño localizado",
      createChatMessage: false
    });
  } else {
    await item.update({
      "system.defensa": defensaNueva
    });
  }

  if (danioSobrante > 0) {
    const hpWrite = await applyDamageToHpAuthoritative(actorObjetivo, danioSobrante, {
      transactionId: createDamageTransactionId("damage-localized-direct-armored"),
      updateOptions: getDeathUpdateOptions(targetTokenDocument)
    });
    const hpNuevo = hpWrite.hpAfter;

    resultado.hpNuevo =
      hpNuevo;

  }

  return resultado;
}

function delegateApplyDamageToGM({
  actor,
  actorObjetivo,
  targetTokenDocument,
  damageRoll,
  localizacionRoll,
  danioFinal,
  numeroLocalizacion,
  slotObjetivo,
  labelLocalizacion,
  costoTotal,
  evaluacionDanio,
  totalBaseDanio,
  totalFinalDanio,
  combatId,
  damageSourceAttribute,
  transactionId
}) {
  const gmActivo =
    game.users.some(user => user.isGM && user.active);

  if (!gmActivo) {
    logger.warn("DAMAGE", "damage delegation unavailable", {
      actorUuid: actor?.uuid ?? null,
      targetActorUuid: actorObjetivo?.uuid ?? null,
      tokenUuid: targetTokenDocument?.uuid ?? null,
      status: "rejected",
      reasonCode: "PRIMARY_GM_UNAVAILABLE"
    });
    ui.notifications.warn("No hay GM conectado para aplicar automáticamente el daño. Aplicar manualmente.");
    return false;
  }

  logger.debug("DAMAGE", "delegating damage application", {
    actorUuid: actor?.uuid ?? null,
    targetActorUuid: actorObjetivo?.uuid ?? null,
    tokenUuid: targetTokenDocument?.uuid ?? null
  });

  game.socket.emit("system.mtrol", {
    action: "mtrolAplicarDanioLocalizado",
    attackerUuid: actor?.uuid ?? null,
    targetActorUuid: actorObjetivo?.uuid ?? null,
    targetTokenUuid: targetTokenDocument?.uuid ?? null,
    payload: {
      transactionId,
      danio: danioFinal,
      numeroLocalizacion,
      slot: slotObjetivo,
      zona: labelLocalizacion,
      damageRollData: serializeRoll(damageRoll),
      localizacionRollData: serializeRoll(localizacionRoll),
      costoTotal,
      evaluacionDanio,
      totalBaseDanio,
      totalFinalDanio,
      combatId,
      damageSourceAttribute
    }
  });

  return true;
}

export async function aplicarDanioLocalizado({
  actor = null,
  targetActor = null,
  targetTokenDocument = null,
  damageRoll = null,
  danio = null,
  costoTotal = 0,
  evaluacionDanio = null,
  totalBaseDanio = null,
  totalFinalDanio = null,
  combatId = null,
  damageSourceAttribute = null,
  localizacionRoll = null,
  transactionId = null
} = {}) {
  logger.debug("DAMAGE", "damage request started", {
    actorUuid: actor?.uuid ?? null,
    targetActorUuid: targetActor?.uuid ?? null,
    tokenUuid: targetTokenDocument?.uuid ?? null
  });

  const actorObjetivo =
    targetActor ?? actor;

  if (!actorObjetivo) {
    ui.notifications.warn("MtRol | No se encontro actor objetivo.");
    return null;
  }

  const danioBase =
    danio ?? damageRoll?.total ?? 0;

  const danioFinal =
    Math.max(0, toNumber(danioBase));

  transactionId ??= createDamageTransactionId("damage-localized");

  localizacionRoll ??=
    await new Roll("1d10").evaluate();

  const numeroLocalizacion =
    Number(localizacionRoll.total ?? 5);

  const slotObjetivo =
    MTROL_BODY_ROLL_TABLE[numeroLocalizacion] ?? "pecho";

  const labelLocalizacion =
    MTROL_BODY_SLOT_LABELS[slotObjetivo] ?? slotObjetivo;

  const itemId =
    actorObjetivo.system?.equipamiento?.[slotObjetivo] ?? "";

  const item =
    itemId ? actorObjetivo.items.get(itemId) : null;

  const hpActual =
    Number(actorObjetivo.system?.vitales?.hp?.value ?? 0);

  const resultado = {
    localizacionRoll,
    numeroLocalizacion,
    slot: slotObjetivo,
    zona: labelLocalizacion,
    item: item?.name ?? null,
    defensaInicial: 0,
    defensaFinal: 0,
    danioOriginal: danioFinal,
    danioAbsorbido: 0,
    hpPerdido: 0,
    itemDestruido: false,
    hpAnterior: hpActual,
    hpNuevo: hpActual,
    aplicacion: "pendiente"
  };

  if (game.user.isGM) {
    logger.debug("DAMAGE", "applying damage directly", {
      actorUuid: actor?.uuid ?? null,
      targetActorUuid: actorObjetivo?.uuid ?? null,
      tokenUuid: targetTokenDocument?.uuid ?? null
    });

    const commandResult = await aplicarDanioCanonicoAutorizado({
      attackerActor: actor,
      targetActor: actorObjetivo,
      targetTokenDocument,
      transactionId,
      payload: {
        transactionId,
        danio: danioFinal,
        combatId,
        damageSourceAttribute,
        numeroLocalizacion,
        slot: slotObjetivo,
        zona: labelLocalizacion
      }
    });
    Object.assign(resultado, commandResult?.result ?? commandResult ?? {});

    resultado.aplicacion =
      "directa";

    return resultado;
  }

  previewDamageToTarget({
    actor,
    actorObjetivo,
    slotObjetivo,
    danioFinal,
    combatId,
    resultado
  });

  const delegado =
    delegateApplyDamageToGM({
      actor,
      actorObjetivo,
      targetTokenDocument,
      damageRoll,
      localizacionRoll,
      danioFinal,
      numeroLocalizacion,
      slotObjetivo,
      labelLocalizacion,
      costoTotal,
      evaluacionDanio,
      totalBaseDanio,
      totalFinalDanio,
      combatId,
      damageSourceAttribute,
      transactionId
    });

  resultado.aplicacion =
    delegado ? "delegada_gm" : "manual_sin_gm";

  return resultado;
}
