// =========================
// MTROL - CHAT ROLLS
// =========================
// Presentacion compartida de Rolls ya evaluados.
// Este helper nunca evalua ni modifica una tirada.
// =========================

import {
  buildMtrolCardMetadata
} from "../ui/chat-card-assets.js";
import { logger } from "../utils/logger.js";

function normalizeEntry(entry) {
  if (!entry) return null;

  if (entry.roll) {
    return {
      roll: entry.roll,
      label: entry.label ?? null
    };
  }

  return {
    roll: entry,
    label: null
  };
}

export function mtrolSerializeRoll(roll) {
  if (!roll) return null;

  if (typeof roll.toJSON === "function") {
    const serialized =
      roll.toJSON();

    if (typeof serialized !== "string") {
      return serialized;
    }

    try {
      return JSON.parse(serialized);
    } catch (_error) {
      return serialized;
    }
  }

  if (typeof roll.toObject === "function") {
    return roll.toObject();
  }

  return typeof roll === "object" ? roll : null;
}

export function mtrolSerializeRolls(rolls = []) {
  return (Array.isArray(rolls) ? rolls : [rolls])
    .map(mtrolSerializeRoll)
    .filter(Boolean);
}

export function mtrolRestoreRoll(serializedRoll) {
  if (!serializedRoll) return null;

  if (typeof serializedRoll.render === "function") {
    return serializedRoll;
  }

  try {
    const rollData =
      typeof serializedRoll === "string"
        ? JSON.parse(serializedRoll)
        : serializedRoll;

    if (!Array.isArray(rollData?.terms)) {
      return null;
    }

    if (
      typeof serializedRoll === "string" &&
      typeof Roll?.fromJSON === "function"
    ) {
      return Roll.fromJSON(serializedRoll);
    }

    if (typeof Roll?.fromData !== "function") {
      return null;
    }

    return Roll.fromData(rollData);
  } catch (error) {
    logger.warn("CHAT_ROLL", "evaluated Roll restoration failed", {
      command: "chat-roll.restore",
      status: "fallback",
      reasonCode: "CHAT_ROLL_RESTORE_FAILED",
      error
    });

    return null;
  }
}

export function mtrolRestoreRolls(serializedRolls = []) {
  return (Array.isArray(serializedRolls) ? serializedRolls : [serializedRolls])
    .map(mtrolRestoreRoll)
    .filter(Boolean);
}

export async function mtrolPrepareChatRolls(entries = []) {
  const normalizedEntries =
    (Array.isArray(entries) ? entries : [entries])
      .map(normalizeEntry)
      .filter(entry => entry?.roll);

  const rolls =
    normalizedEntries.map(entry => entry.roll);

  const rendered = [];

  for (const [index, entry] of normalizedEntries.entries()) {
    if (typeof entry.roll.render !== "function") continue;

    const rollHTML =
      await entry.roll.render(
        entry.label
          ? { flavor: entry.label }
          : {}
      );

    rendered.push(`
      <div class="mtrol-roll-block" data-mtrol-roll-index="${index}">
        ${rollHTML}
      </div>
    `);
  }

  return {
    rolls,
    html: rendered.join("")
  };
}

export async function mtrolCreateRollMessage(data = {}, options = {}) {
  const {
    mtrolCard = null,
    ...baseMessageData
  } = data;

  const hasRolls =
    Array.isArray(baseMessageData.rolls) && baseMessageData.rolls.length > 0;

  const messageData =
    hasRolls || mtrolCard
      ? {
          ...baseMessageData,
          flags: {
            ...(baseMessageData.flags ?? {}),
            mtrol: {
              ...(baseMessageData.flags?.mtrol ?? {}),
              rollCard: buildMtrolCardMetadata(
                mtrolCard ?? {},
                baseMessageData.rolls ?? []
              )
            }
          }
        }
      : baseMessageData;

  // El ChatMessage es la fuente canónica de visualización. Dice So Nice
  // observa sus Rolls una sola vez en cada cliente conectado.
  return ChatMessage.create(messageData, options);
}
