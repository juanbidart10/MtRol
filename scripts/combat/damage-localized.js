import {
  MTROL_BODY_ROLL_TABLE,
  MTROL_BODY_SLOT_LABELS
} from "../constants/body-slots.js";

import {
  mtrolMostrarDados
} from "../rolls/dice-engine.js";

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

function previewDamageToTarget({
  actorObjetivo,
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
    resultado.hpPerdido =
      danioFinal;

    resultado.hpNuevo =
      Math.max(0, resultado.hpAnterior - danioFinal);

    return resultado;
  }

  const defensaActual =
    Math.max(0, toNumber(item.system?.defensa ?? 0));

  const danioAbsorbido =
    Math.min(defensaActual, danioFinal);

  const danioSobrante =
    Math.max(0, danioFinal - defensaActual);

  const defensaNueva =
    Math.max(0, defensaActual - danioFinal);

  resultado.defensaInicial =
    defensaActual;

  resultado.defensaFinal =
    defensaNueva;

  resultado.danioAbsorbido =
    danioAbsorbido;

  resultado.hpPerdido =
    danioSobrante;

  resultado.hpNuevo =
    Math.max(0, resultado.hpAnterior - danioSobrante);

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
    const hpNuevo =
      Math.max(0, resultado.hpAnterior - danioFinal);

    await actorObjetivo.update({
      "system.vitales.hp.value": hpNuevo
    });

    resultado.hpPerdido =
      danioFinal;

    resultado.hpNuevo =
      hpNuevo;

    if (hpNuevo <= 0 && targetTokenDocument) {
      try {
        await targetTokenDocument.update({
          overlayEffect: "icons/svg/skull.svg"
        });
      } catch (error) {
        console.warn("MTROL | No se pudo actualizar el overlay del token.", error);
      }
    }

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

    await actorObjetivo.update({
      [`system.equipamiento.${slotObjetivo}`]: ""
    });

    await item.delete();
  } else {
    await item.update({
      "system.defensa": defensaNueva
    });
  }

  if (danioSobrante > 0) {
    const hpNuevo =
      Math.max(0, resultado.hpAnterior - danioSobrante);

    await actorObjetivo.update({
      "system.vitales.hp.value": hpNuevo
    });

    resultado.hpNuevo =
      hpNuevo;

    if (hpNuevo <= 0 && targetTokenDocument) {
      try {
        await targetTokenDocument.update({
          overlayEffect: "icons/svg/skull.svg"
        });
      } catch (error) {
        console.warn("MTROL | No se pudo actualizar el overlay del token.", error);
      }
    }
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
  totalFinalDanio
}) {
  const gmActivo =
    game.users.some(user => user.isGM && user.active);

  if (!gmActivo) {
    console.warn("MTROL | No GM available; manual application required");
    ui.notifications.warn("No hay GM conectado para aplicar automáticamente el daño. Aplicar manualmente.");
    return false;
  }

  console.log("MTROL | Delegating damage application to GM");

  game.socket.emit("system.mtrol", {
    action: "mtrolAplicarDanioLocalizado",
    attackerUuid: actor?.uuid ?? null,
    targetActorUuid: actorObjetivo?.uuid ?? null,
    targetTokenUuid: targetTokenDocument?.uuid ?? null,
    payload: {
      danio: danioFinal,
      numeroLocalizacion,
      slot: slotObjetivo,
      zona: labelLocalizacion,
      damageRollData: serializeRoll(damageRoll),
      localizacionRollData: serializeRoll(localizacionRoll),
      costoTotal,
      evaluacionDanio,
      totalBaseDanio,
      totalFinalDanio
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
  totalFinalDanio = null
} = {}) {
  console.log("MTROL | Damage request started");

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

  const localizacionRoll =
    await new Roll("1d10").evaluate();

  await mtrolMostrarDados(localizacionRoll);

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

  if (game.user.isGM || actorObjetivo.isOwner) {
    console.log("MTROL | Applying damage directly");

    await applyDamageToTarget({
      actorObjetivo,
      targetTokenDocument,
      slotObjetivo,
      danioFinal,
      resultado
    });

    resultado.aplicacion =
      "directa";

    return resultado;
  }

  previewDamageToTarget({
    actorObjetivo,
    slotObjetivo,
    danioFinal,
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
      totalFinalDanio
    });

  resultado.aplicacion =
    delegado ? "delegada_gm" : "manual_sin_gm";

  return resultado;
}
