// =========================
// MTROL - SEQUENCER ENGINE
// =========================
// Motor centralizado de FX
// para competencias/habilidades.
//
// Responsabilidades:
// ✔ Sonidos
// ✔ FX caster
// ✔ FX proyectil
// ✔ FX target
// ✔ Compatibilidad legacy
//
// Este archivo desacopla
// completamente Sequencer
// de personaje-sheet.js
// =========================

export async function playCompetenciaFX(
  actor,
  item,
  targetToken = null
) {

  try {

    // =========================
    // VALIDAR SEQUENCER
    // =========================

    if (!game.modules.get("sequencer")?.active) {

      console.warn(
        "MtRol | Sequencer no está activo."
      );

      return;
    }

    // =========================
    // DATOS FX ITEM
    // =========================

    const fx =
      item.system?.fx ?? {};

    const fxAutocast =
      fx.autocast ?? "";

    const fxProyectil =
      fx.proyectil ?? "";

    const fxTarget =
      fx.target ?? "";

    // Compatibilidad vieja
    const fxLegacy =
      fx.visual ?? "";

    const fxSonido =
      fx.sonido ?? "";

    const duracion =
      Number(fx.duracion ?? 5000);

    const escala =
      Number(fx.escala ?? 1);

    // =========================
    // TOKEN CASTER
    // =========================

    const casterToken =
      actor.getActiveTokens()[0];

    if (!casterToken) {

      ui.notifications.warn(
        "Colocá un token del actor en la escena para visualizar FX."
      );

      return;
    }

    // =========================
    // CREAR SECUENCIA
    // =========================

    const seq = new Sequence();

    // =========================
    // SONIDO
    // =========================

    if (fxSonido) {

      seq.sound()
        .file(fxSonido)
        .volume(0.6);

    }

    // =========================
    // FX SOBRE CASTER
    // =========================

    if (fxAutocast) {

      seq.effect()
        .file(fxAutocast)
        .atLocation(casterToken)
        .scale(escala)
        .fadeIn(300)
        .fadeOut(300)
        .duration(duracion);

    }

    // =========================
    // FX PROYECTIL
    // =========================

    if (fxProyectil && targetToken) {

      seq.effect()
        .file(fxProyectil)
        .atLocation(casterToken)
        .stretchTo(targetToken)
        .scale(escala);

    }

    // =========================
    // FX SOBRE TARGET
    // =========================

    if (fxTarget && targetToken) {

      seq.effect()
        .file(fxTarget)
        .atLocation(targetToken)
        .scale(escala)
        .fadeIn(300)
        .fadeOut(300)
        .duration(duracion);

    }

    // =========================
    // FALLBACK LEGACY
    // =========================

    if (
      !fxAutocast &&
      !fxProyectil &&
      !fxTarget &&
      fxLegacy
    ) {

      seq.effect()
        .file(fxLegacy)
        .atLocation(targetToken ?? casterToken)
        .scale(escala)
        .fadeIn(300)
        .fadeOut(300)
        .duration(duracion);

    }

    // =========================
    // EJECUTAR SECUENCIA
    // =========================

    await seq.play();

  }

  // =========================
  // ERROR ENGINE
  // =========================

  catch (error) {

    console.error(
      "MtRol | Error ejecutando FX:",
      error
    );

  }

}