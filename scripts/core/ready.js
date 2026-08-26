import { mtrolRoll } from "../rolls/mtrol-rolls.js";

import {
  aplicarDanioLocalizado
} from "../combat/damage-localized.js";

import {
  installMtrolDebugApi
} from "./debug.js";

import {
  initializeTradeAuthority
} from "../trade/trade-authority.js";

import {
  reconcileActiveTurn
} from "../combat/turn-system.js";

// =========================
// MTROL - READY
// =========================

export async function readyMtrol() {

  // =====================================
  // API GLOBAL
  // =====================================

  game.mtrol = game.mtrol || {};

  // =====================================
  // MOTOR CENTRAL DE TIRADAS
  // =====================================

  game.mtrol.roll = mtrolRoll;

  // =====================================
  // DAÑO AUTORIZADO POR GM
  // =====================================

  game.mtrol.aplicarDanioAutorizado = async ({
    attackerActor = null,
    targetActor = null,
    targetTokenDocument = null,
    payload = {}
  } = {}) => {

    const danio =
      payload.danio ??
      payload.damage ??
      payload.total ??
      0;

    return aplicarDanioLocalizado({
      actor: attackerActor,
      targetActor,
      danio
    });
  };

  installMtrolDebugApi();
  initializeTradeAuthority();
  await reconcileActiveTurn();
}
