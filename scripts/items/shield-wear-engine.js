import {
  getEquippedShields
} from "./equipment-engine.js";

import {
  destroyEquippedItem
} from "./item-destruction-engine.js";

import {
  mtrolMostrarDados
} from "../rolls/dice-engine.js";

const SHIELD_WEAR_REASONS = new Set([
  "defender-higher",
  "tie-defender"
]);

function toNumber(value, fallback = 0) {
  const number =
    Number(value);

  return Number.isFinite(number) ? number : fallback;
}

export function shouldApplyShieldWear(pendingAction, resolutionResult) {
  return (
    pendingAction?.status === "resolving" &&
    pendingAction?.defenseActionType === "defense" &&
    pendingAction?.defenseType === "shield" &&
    pendingAction?.defenseEffect === "block" &&
    resolutionResult?.success === false &&
    SHIELD_WEAR_REASONS.has(resolutionResult?.reason)
  );
}

function resolveValidatedShield({
  defenderActor,
  shieldItemId,
  shieldItemUuid,
  shieldSlot
} = {}) {
  const equippedShields =
    getEquippedShields(defenderActor);

  const matching =
    equippedShields.find(({ slot, item }) =>
      slot === shieldSlot &&
      item.id === shieldItemId &&
      (!shieldItemUuid || item.uuid === shieldItemUuid)
    );

  return matching?.item ?? null;
}

export async function applyShieldWear({
  defenderActor,
  defenderToken = null,
  shieldItemId,
  shieldItemUuid = null,
  shieldSlot,
  pendingAction,
  resolutionResult
} = {}) {
  if (!game.user?.isGM) {
    throw new Error("Solo el GM autoritativo puede aplicar desgaste de escudo.");
  }

  if (!shouldApplyShieldWear(pendingAction, resolutionResult)) {
    return {
      applied: false,
      reason: "not-applicable"
    };
  }

  if (!defenderActor) {
    throw new Error("No se encontró el actor defensor para aplicar desgaste.");
  }

  if (
    pendingAction.targetActorId !== defenderActor.id &&
    pendingAction.targetActorUuid !== defenderActor.uuid
  ) {
    throw new Error("El actor defensor no coincide con la acción pendiente.");
  }

  if (
    pendingAction.shieldItemId !== shieldItemId ||
    pendingAction.shieldSlot !== shieldSlot ||
    (
      pendingAction.shieldItemUuid &&
      pendingAction.shieldItemUuid !== shieldItemUuid
    )
  ) {
    throw new Error("El escudo solicitado no coincide con la acción pendiente.");
  }

  const shieldItem =
    resolveValidatedShield({
      defenderActor,
      shieldItemId,
      shieldItemUuid,
      shieldSlot
    });

  if (!shieldItem) {
    throw new Error(
      "El escudo defensivo ya no está equipado o no coincide con la selección validada."
    );
  }

  const wearRoll =
    await new Roll("1d4").evaluate();

  await mtrolMostrarDados(wearRoll);

  const wear =
    Math.max(0, toNumber(wearRoll.total, 0));

  const currentDefense =
    Math.max(0, toNumber(shieldItem.system?.defensa, 0));

  const remainingDefense =
    Math.max(0, currentDefense - wear);

  let destruction =
    null;

  if (remainingDefense <= 0) {
    destruction =
      await destroyEquippedItem({
        actor: defenderActor,
        item: shieldItem,
        slot: shieldSlot,
        reason: "desgaste de escudo",
        createChatMessage: false
      });
  } else {
    await shieldItem.update({
      "system.defensa": remainingDefense
    });
  }

  return {
    applied: true,
    actorId: defenderActor.id,
    actorUuid: defenderActor.uuid,
    actorName: defenderActor.name,
    defenderTokenUuid: defenderToken?.uuid ?? defenderToken?.document?.uuid ?? null,
    shieldItemId,
    shieldItemUuid: shieldItem.uuid,
    shieldName: shieldItem.name,
    shieldSlot,
    wear,
    previousDefense: currentDefense,
    remainingDefense,
    destroyed: destruction?.destroyed === true,
    wearRoll
  };
}
