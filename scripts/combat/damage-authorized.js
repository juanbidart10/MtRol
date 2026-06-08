import {
  MTROL_BODY_ROLL_TABLE,
  MTROL_BODY_SLOT_LABELS
} from "../constants/body-slots.js";

// =========================
// MTROL - DAMAGE AUTHORIZED
// =========================
// Este archivo contiene funciones ejecutadas por el GM client.
// Los jugadores pueden solicitar daño por socket,
// pero los updates reales del mundo los aplica el GM.
// =========================

function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;

  const n = Number(
    String(value).replace(",", ".")
  );

  return Number.isFinite(n) ? n : 0;
}

// =========================
// LEGACY - DAÑO SIMPLE
// =========================

export async function aplicarDanioAutorizado({
  attackerActor,
  targetActor,
  targetTokenDocument,
  payload
}) {
  if (!game.user.isGM) return;

  const danio =
    Number(payload?.danio ?? 0);

  const slot =
    payload?.slot ?? null;

  if (!targetActor || !Number.isFinite(danio) || danio <= 0) {
    console.warn("MTROL | Daño autorizado inválido:", payload);
    return;
  }

  const hpActual =
    Number(targetActor.system?.vitales?.hp?.value ?? 0);

  let danioRestante =
    danio;

  let itemDefensivo =
    null;

  let defensaActual =
    0;

  let defensaNueva =
    0;

  let itemDestruido =
    false;

  if (slot) {
    itemDefensivo =
      targetActor.items.find(item =>
        item.type === "objeto" &&
        item.system?.equipado === true &&
        item.system?.slot === slot &&
        Number(item.system?.defensa ?? 0) > 0
      );

    if (itemDefensivo) {
      defensaActual =
        Number(itemDefensivo.system.defensa ?? 0);

      if (danio >= defensaActual) {
        danioRestante =
          danio - defensaActual;

        defensaNueva =
          0;

        itemDestruido =
          true;

        await targetActor.deleteEmbeddedDocuments(
          "Item",
          [itemDefensivo.id]
        );

      } else {
        defensaNueva =
          defensaActual - danio;

        danioRestante =
          0;

        await itemDefensivo.update({
          "system.defensa": defensaNueva
        });
      }
    }
  }

  const hpNuevo =
    Math.max(0, hpActual - danioRestante);

  await targetActor.update({
    "system.vitales.hp.value": hpNuevo
  });

  if (hpNuevo <= 0 && targetTokenDocument) {
    await targetTokenDocument.update({
      overlayEffect: "icons/svg/skull.svg"
    });
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({
      actor: attackerActor
    }),

    content: `
      <div class="mtrol-chat-card">
        <h2>Daño aplicado</h2>

        <p><b>Atacante:</b> ${attackerActor?.name ?? "Desconocido"}</p>
        <p><b>Objetivo:</b> ${targetActor.name}</p>
        <p><b>Daño total:</b> ${danio}</p>

        ${slot ? `<p><b>Zona:</b> ${slot}</p>` : ""}

        ${itemDefensivo ? `<p><b>Armadura:</b> ${itemDefensivo.name}</p>` : ""}

        ${itemDefensivo ? `<p><b>Defensa:</b> ${defensaActual} → ${defensaNueva}</p>` : ""}

        ${itemDestruido ? `<p><b>Resultado:</b> Armadura destruida</p>` : ""}

        <p><b>Daño a HP:</b> ${danioRestante}</p>

        ${
          hpNuevo <= 0
            ? `<div class="mtrol-combat-alert death">${targetActor.name} ha muerto</div>`
            : ""
        }
      </div>
    `
  });
}

// =========================
// NUEVO - DAÑO LOCALIZADO AUTORITATIVO
// =========================

export async function aplicarDanioLocalizadoAutorizado({
  attackerActor = null,
  targetActor = null,
  targetTokenDocument = null,
  payload = {}
} = {}) {
  if (!game.user.isGM) return null;

  if (!attackerActor || !targetActor) {
    console.warn("MTROL | Daño localizado autorizado inválido:", {
      attackerActor,
      targetActor,
      payload
    });
    return null;
  }

  const danioFinal =
    Math.max(0, toNumber(payload?.danio ?? 0));

  const numeroLocalizacion =
    Number(payload?.numeroLocalizacion ?? 5);

  const slotObjetivo =
    payload?.slot ??
    MTROL_BODY_ROLL_TABLE[numeroLocalizacion] ??
    "pecho";

  const labelLocalizacion =
    payload?.zona ??
    MTROL_BODY_SLOT_LABELS[slotObjetivo] ??
    slotObjetivo;

  if (danioFinal <= 0) {
    console.warn("MTROL | Daño localizado autorizado sin daño válido:", payload);
    return null;
  }

  const itemId =
    targetActor.system?.equipamiento?.[slotObjetivo] ?? "";

  const item =
    itemId ? targetActor.items.get(itemId) : null;

  const hpActual =
    Number(targetActor.system?.vitales?.hp?.value ?? 0);

  const resultado = {
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
    hpNuevo: hpActual
  };

  if (!item) {
    const hpNuevo =
      Math.max(0, hpActual - danioFinal);

    await targetActor.update({
      "system.vitales.hp.value": hpNuevo
    });

    resultado.hpPerdido =
      danioFinal;

    resultado.hpNuevo =
      hpNuevo;
  }

  if (item) {
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

      await targetActor.update({
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
        Math.max(0, hpActual - danioSobrante);

      await targetActor.update({
        "system.vitales.hp.value": hpNuevo
      });

      resultado.hpNuevo =
        hpNuevo;
    }
  }

  if (resultado.hpNuevo <= 0 && targetTokenDocument) {
    await targetTokenDocument.update({
      overlayEffect: "icons/svg/skull.svg"
    });
  }

  return resultado;
}