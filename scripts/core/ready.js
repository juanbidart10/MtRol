import { mtrolRoll } from "../rolls/mtrol-rolls.js";

import {
  aplicarDanioLocalizado
} from "../combat/damage-localized.js";

// =========================
// MTROL - READY
// =========================

export function readyMtrol() {

  console.log(
    "MtRol | READY - Sistema completamente cargado"
  );

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

  console.log(
    "MtRol | API global registrada."
  );
}