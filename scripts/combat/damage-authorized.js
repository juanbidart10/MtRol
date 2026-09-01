import {
  MTROL_BODY_ROLL_TABLE,
  MTROL_BODY_SLOT_LABELS
} from "../constants/body-slots.js";

import {
  destroyEquippedItem
} from "../items/item-destruction-engine.js";

import {
  getEquipmentItemForSlot
} from "../items/item-invariants.js";

import {
  mtrolCreateRollMessage
} from "../rolls/chat-rolls.js";

import {
  applyDamageToHpAuthoritative
} from "../actors/actor-resource-service.js";

import { transactionCoordinator } from "../runtime/runtime-foundation.js";
import { logger } from "../utils/logger.js";

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

function getDeathUpdateOptions(targetTokenDocument) {
  return {
    mtrolDeathTargetTokenUuid: targetTokenDocument?.uuid ?? null
  };
}

function createDamageTransactionId(prefix) {
  return `${prefix}:${globalThis.foundry?.utils?.randomID?.() ?? crypto.randomUUID()}`;
}

// =========================
// LEGACY - DAÑO SIMPLE
// =========================

async function aplicarDanioAutorizadoLegacy({
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
    logger.warn("DAMAGE", "authorized damage rejected", {
      actorUuid: attackerActor?.uuid ?? null,
      targetActorUuid: targetActor?.uuid ?? null,
      tokenUuid: targetTokenDocument?.uuid ?? null,
      status: "rejected",
      reasonCode: "DAMAGE_PAYLOAD_INVALID"
    });
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
    const referencedItem =
      getEquipmentItemForSlot(targetActor, slot);

    if (
      referencedItem?.type === "objeto" &&
      Number(referencedItem.system?.defensa ?? 0) > 0
    ) {
      itemDefensivo = referencedItem;
    }

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

        await destroyEquippedItem({
          actor: targetActor,
          item: itemDefensivo,
          slot,
          reason: "daño autorizado",
          createChatMessage: false
        });

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

  const hpWrite = await applyDamageToHpAuthoritative(targetActor, danioRestante, {
    transactionId: createDamageTransactionId("damage-simple"),
    updateOptions: getDeathUpdateOptions(targetTokenDocument)
  });
  const hpNuevo = hpWrite.hpAfter;

  await mtrolCreateRollMessage({
    speaker: ChatMessage.getSpeaker({
      actor: attackerActor
    }),

    mtrolCard: {
      family: "damage",
      state: "normal",
      title: "Daño aplicado",
      categoryLabel: "Daño autorizado",
      formula: String(danio),
      total: danio,
      icon: attackerActor?.img ?? ""
    },

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

async function aplicarDanioLocalizadoAutorizadoLegacy({
  attackerActor = null,
  targetActor = null,
  targetTokenDocument = null,
  payload = {}
} = {}) {
  if (!game.user.isGM) return null;

  if (!attackerActor || !targetActor) {
    logger.warn("DAMAGE", "localized damage rejected", {
      actorUuid: attackerActor?.uuid ?? null,
      targetActorUuid: targetActor?.uuid ?? null,
      tokenUuid: targetTokenDocument?.uuid ?? null,
      status: "rejected",
      reasonCode: "DAMAGE_ACTOR_INVALID"
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
    logger.warn("DAMAGE", "localized damage rejected", {
      actorUuid: attackerActor.uuid,
      targetActorUuid: targetActor.uuid,
      tokenUuid: targetTokenDocument?.uuid ?? null,
      status: "rejected",
      reasonCode: "DAMAGE_VALUE_INVALID"
    });
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
    const hpWrite = await applyDamageToHpAuthoritative(targetActor, danioFinal, {
      transactionId: createDamageTransactionId("damage-localized-unarmored"),
      updateOptions: getDeathUpdateOptions(targetTokenDocument)
    });
    const hpNuevo = hpWrite.hpAfter;

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

      await destroyEquippedItem({
        actor: targetActor,
        item,
        slot: slotObjetivo,
        reason: "daño localizado autorizado",
        createChatMessage: false
      });
    } else {
      await item.update({
        "system.defensa": defensaNueva
      });
    }

    if (danioSobrante > 0) {
      const hpWrite = await applyDamageToHpAuthoritative(targetActor, danioSobrante, {
        transactionId: createDamageTransactionId("damage-localized-armored"),
        updateOptions: getDeathUpdateOptions(targetTokenDocument)
      });
      const hpNuevo = hpWrite.hpAfter;

      resultado.hpNuevo =
        hpNuevo;
    }
  }

  return resultado;
}

function commandResult(transactionId, result, reasonCode = null) {
  return {
    ok: reasonCode === null,
    transactionId,
    status: "completed",
    changed: Boolean(result?.hpPerdido || result?.danioAbsorbido),
    result,
    reasonCode
  };
}

async function rollLocalization() {
  const roll = await new Roll("1d10").evaluate();
  return Number(roll.total ?? 5);
}

/** CANONICAL: única ruta autoritativa de mutación de daño. */
export async function aplicarDanioCanonicoAutorizado({
  attackerActor = null,
  targetActor = null,
  targetTokenDocument = null,
  payload = {},
  transactionId = payload?.transactionId ?? null
} = {}) {
  if (!game.user?.isGM) throw new Error("Solo el Primary GM puede aplicar daño.");
  if (!targetActor) throw new Error("No se encontró el Actor objetivo.");
  const rawDamage = Math.max(0, toNumber(payload?.danio ?? payload?.damage ?? payload?.total ?? 0));
  const rootId = String(transactionId || createDamageTransactionId("damage"));
  const scope = game.combat ? { combat: game.combat, actor: targetActor } : { actor: targetActor };

  return transactionCoordinator.execute(scope, {
    transactionId: rootId,
    command: "damage.apply",
    metadata: {
      sourceActorUuid: attackerActor?.uuid ?? null,
      targetActorUuid: targetActor.uuid,
      sourceItemUuid: payload?.sourceItemUuid ?? null,
      damageDomain: payload?.damageDomain ?? payload?.damageType ?? null,
      rawDamage
    },
    prepare: async () => {
      const localizationNumber = payload?.slot
        ? Number(payload?.numeroLocalizacion ?? 0)
        : Number(payload?.numeroLocalizacion ?? await rollLocalization());
      const slot = payload?.slot ?? MTROL_BODY_ROLL_TABLE[localizationNumber] ?? "pecho";
      const armor = getEquipmentItemForSlot(targetActor, slot);
      const durabilityBefore = armor?.type === "objeto"
        ? Math.max(0, toNumber(armor.system?.defensa ?? 0))
        : 0;
      const absorbed = Math.min(durabilityBefore, rawDamage);
      const hpBefore = Number(targetActor.system?.vitales?.hp?.value ?? 0);
      const hpDamage = Math.max(0, rawDamage - absorbed);
      return {
        localization: {
          roll: localizationNumber || null,
          slot,
          label: payload?.zona ?? MTROL_BODY_SLOT_LABELS[slot] ?? slot
        },
        armorItemUuid: armor?.uuid ?? null,
        armorItemId: armor?.id ?? null,
        armorName: armor?.name ?? null,
        durabilityBefore,
        durabilityAfter: Math.max(0, durabilityBefore - rawDamage),
        absorbed,
        hpBefore,
        hpDamage,
        hpAfter: Math.max(0, hpBefore - hpDamage)
      };
    },
    apply: async ({ prepared, checkpoint }) => {
      let destroyedItemUuid = null;
      const armor = prepared.armorItemId ? targetActor.items?.get?.(prepared.armorItemId) : null;
      if (armor && prepared.durabilityBefore > 0) {
        if (prepared.durabilityAfter <= 0) {
          await destroyEquippedItem({
            actor: targetActor,
            item: armor,
            slot: prepared.localization.slot,
            reason: "damage canonical",
            createChatMessage: false
          });
          destroyedItemUuid = prepared.armorItemUuid;
        } else {
          await armor.update({ "system.defensa": prepared.durabilityAfter });
        }
        await checkpoint("armor-applied", {
          armorItemUuid: prepared.armorItemUuid,
          durabilityAfter: prepared.durabilityAfter,
          destroyedItemUuid
        });
      }
      if (prepared.hpDamage > 0) {
        await targetActor.update({
          "system.vitales.hp.value": prepared.hpAfter
        }, getDeathUpdateOptions(targetTokenDocument));
        await checkpoint("hp-applied", { hpAfter: prepared.hpAfter });
      }
      const result = {
        numeroLocalizacion: prepared.localization.roll,
        slot: prepared.localization.slot,
        zona: prepared.localization.label,
        item: prepared.armorName,
        defensaInicial: prepared.durabilityBefore,
        defensaFinal: prepared.durabilityAfter,
        danioOriginal: rawDamage,
        danioAbsorbido: prepared.absorbed,
        hpPerdido: prepared.hpDamage,
        itemDestruido: Boolean(destroyedItemUuid),
        destroyedItemUuid,
        hpAnterior: prepared.hpBefore,
        hpNuevo: prepared.hpAfter
      };
      logger.info("DAMAGE", "damage transaction completed", {
        transactionId: rootId,
        targetUuid: targetActor.uuid,
        hpBefore: prepared.hpBefore,
        hpAfter: prepared.hpAfter
      });
      return commandResult(rootId, result);
    },
    reconcile: async receipt => {
      const prepared = receipt.prepared;
      if (!prepared) return { resolved: false };
      const hpNow = Number(targetActor.system?.vitales?.hp?.value ?? 0);
      const armorNow = prepared.armorItemId ? targetActor.items?.get?.(prepared.armorItemId) : null;
      const armorApplied = prepared.durabilityBefore <= 0 ||
        (prepared.durabilityAfter <= 0 ? !armorNow : Number(armorNow?.system?.defensa) === prepared.durabilityAfter);
      const hpApplied = prepared.hpDamage <= 0 || hpNow === prepared.hpAfter;
      if (!armorApplied || !hpApplied) return { resolved: false };
      return { resolved: true, result: receipt.result ?? commandResult(rootId, {
        numeroLocalizacion: prepared.localization.roll,
        slot: prepared.localization.slot,
        zona: prepared.localization.label,
        item: prepared.armorName,
        defensaInicial: prepared.durabilityBefore,
        defensaFinal: prepared.durabilityAfter,
        danioOriginal: rawDamage,
        danioAbsorbido: prepared.absorbed,
        hpPerdido: prepared.hpDamage,
        itemDestruido: prepared.durabilityAfter <= 0 && prepared.durabilityBefore > 0,
        destroyedItemUuid: prepared.durabilityAfter <= 0 ? prepared.armorItemUuid : null,
        hpAnterior: prepared.hpBefore,
        hpNuevo: prepared.hpAfter
      }) };
    }
  });
}

/** DEPRECATED compatibility wrapper. */
export async function aplicarDanioAutorizado(args = {}) {
  return aplicarDanioCanonicoAutorizado(args);
}

/** DEPRECATED compatibility wrapper. */
export async function aplicarDanioLocalizadoAutorizado(args = {}) {
  return aplicarDanioCanonicoAutorizado(args);
}
