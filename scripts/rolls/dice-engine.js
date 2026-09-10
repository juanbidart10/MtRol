// =========================
// MTROL - DICE ENGINE
// =========================
// Reglas centrales de dados:
// - crítico
// - pifia
// - Dharma
// - Karma
// - cadenas críticas
// =========================

import {
  createDharmaDieId,
  finalizeDharmaCritical,
  resolveDharmaInitialDie
} from "./dharma-engine.js";
import { logger } from "../utils/logger.js";

// =========================
// DELAY CINEMÁTICO
// =========================

function mtrolDelay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function mtrolMostrarDados(roll, {
  user = game.user,
  synchronize = true
} = {}) {
  if (!roll || !game.dice3d) return;

  try {
    await Promise.resolve(
      game.dice3d.showForRoll(
        roll,
        user,
        synchronize
      )
    );
  } catch (error) {
    logger.warn("DICE", "dice animation wait failed", {
      command: "dice3d.show",
      status: "isolated",
      reasonCode: "DICE_ANIMATION_FAILED",
      error
    });
  }
}

// =========================
// REGLAS POR DADO
// =========================

export function mtrolReglaDado(caras, valor) {

  // =========================
  // D4
  // SIN CRÍTICO NI PIFIA
  // =========================

  if (caras === 4) {
    return {
      critico: false,
      pifia: false,
      dharma: false,
      karma: false
    };
  }

  // =========================
  // D6
  // 1 = PIFIA/KARMA
  // =========================

  if (caras === 6) {
    return {
      critico: false,
      pifia: valor === 1,
      dharma: false,
      karma: valor === 1
    };
  }

  // =========================
  // RESTO DE DADOS
  // =========================

  return {
    critico: valor === 1,
    pifia: valor === 2,
    dharma: valor === 1,
    karma: valor === 2
  };
}

function prepareDharmaTraceState(roll, context) {
  const empty = {
    byResult: new Map(),
    traces: []
  };

  if (!context) return empty;

  if (
    context.enabled !== true ||
    context.state !== "consumed" ||
    context.receipt?.authorized !== true
  ) {
    throw new Error("El contexto de Dharma no posee un consumo autorizado.");
  }

  const selectedIds =
    new Set(context.selectedIds ?? []);

  const foundIds = new Set();
  const byResult = new Map();
  const traces = [];

  for (const [termIndex, term] of Array.from(roll?.terms ?? []).entries()) {
    if (!Array.isArray(term?.results)) continue;

    for (const [resultIndex, result] of term.results.entries()) {
      const id =
        createDharmaDieId(termIndex, resultIndex);

      if (!selectedIds.has(id)) continue;

      const trace =
        resolveDharmaInitialDie({
          die: {
            id,
            termIndex,
            resultIndex,
            faces: Number(term.faces)
          },
          naturalResult: Number(result?.result)
        });

      const traceIndex = traces.length;
      traces.push(trace);
      byResult.set(result, {
        trace,
        traceIndex
      });
      foundIds.add(id);
    }
  }

  if (foundIds.size !== selectedIds.size) {
    throw new Error(
      "Los dados seleccionados para Dharma no coinciden con el Roll evaluado."
    );
  }

  return {
    byResult,
    traces
  };
}

// =========================
// EVALUACIÓN CENTRAL MTROL
// =========================

export async function mtrolEvaluarDadosMtrol(roll, {
  dharmaContext = null
} = {}) {

  let totalExtra = 0;

  let dharmaBonus = 0;

  const detalles = [];

  const extraRolls = [];

  let cantidadDharma = 0;
  let cantidadKarma = 0;

  const dharmaState =
    prepareDharmaTraceState(roll, dharmaContext);

  for (const die of roll.dice ?? []) {

    for (const result of die.results ?? []) {

      if (result.active === false) continue;

      const caras =
        Number(die.faces);

      const valor =
        Number(result.result);

      const dharmaEntry =
        dharmaState.byResult.get(result) ?? null;

      const valorEfectivo =
        Number(dharmaEntry?.trace?.effectiveResult ?? valor);

      const regla =
        mtrolReglaDado(caras, valorEfectivo);

      // =========================
      // DHARMA / KARMA
      // =========================

      if (regla.dharma) {
        cantidadDharma++;
      }

      if (regla.karma) {
        cantidadKarma++;
      }

      // =========================
      // PIFIA DIRECTA
      // =========================

      if (regla.pifia) {
        return {
          pifia: true,
          motivo: `El D${caras} mostró un ${valor}.`,
          totalExtra,
          dharmaBonus,
          dharmaTraces: dharmaState.traces,
          detalles,
          cantidadDharma,
          cantidadKarma,
          extraRolls
        };
      }

      // =========================
      // NO FUE CRÍTICO
      // =========================

      if (!regla.critico) {
        dharmaBonus +=
          Number(dharmaEntry?.trace?.dharmaBonus ?? 0);

        continue;
      }

      // =========================
      // CRÍTICO
      // =========================

      let multiplicador = 2;

      detalles.push(
        `🎯 Crítico en D${caras}`
      );

      while (true) {

        // =========================
        // DELAY CINEMÁTICO
        // =========================

        await mtrolDelay(900);

        const extraRoll =
          await new Roll(`1d${caras}`).evaluate();

        extraRolls.push(extraRoll);

        const extraValor =
          Number(extraRoll.total);

        const reglaExtra =
          mtrolReglaDado(
            caras,
            extraValor
          );

        // =========================
        // DHARMA / KARMA EXTRA
        // =========================

        if (reglaExtra.dharma) {
          cantidadDharma++;
        }

        if (reglaExtra.karma) {
          cantidadKarma++;
        }

        detalles.push(
          `↳ D${caras}: ${extraValor} x${multiplicador}`
        );

        // =========================
        // PIFIA DURANTE CADENA
        // =========================

        if (reglaExtra.pifia) {
          return {
            pifia: true,
            motivo: "La tirada fue cancelada durante la cadena crítica.",
            totalExtra,
            dharmaBonus,
            dharmaTraces: dharmaState.traces,
            detalles,
            cantidadDharma,
            cantidadKarma,
            extraRolls
          };
        }

        // =========================
        // NUEVO CRÍTICO
        // =========================

        if (reglaExtra.critico) {
          multiplicador++;
          continue;
        }

        // =========================
        // SUMA FINAL
        // =========================

        const criticalResolvedResult =
          extraValor * multiplicador;

        totalExtra +=
          criticalResolvedResult;

        if (dharmaEntry?.trace?.requiresPostCriticalBonus) {
          const finalizedTrace =
            finalizeDharmaCritical(
              dharmaEntry.trace,
              criticalResolvedResult
            );

          dharmaState.traces[dharmaEntry.traceIndex] =
            finalizedTrace;

          dharmaEntry.trace =
            finalizedTrace;

          dharmaBonus +=
            finalizedTrace.dharmaBonusAfterCritical;
        }

        break;
      }
    }
  }

  return {
    pifia: false,
    motivo: "",
    totalExtra,
    dharmaBonus,
    dharmaTraces: dharmaState.traces,
    detalles,
    cantidadDharma,
    cantidadKarma,
    extraRolls
  };
}

// =========================
// TOTAL BASE
// =========================
// Elimina los "1" críticos
// del total base.
// =========================

export function mtrolCalcularTotalBaseSinCriticos(roll) {

  let totalBase =
    Number(roll.total ?? 0);

  for (const die of roll.dice ?? []) {

    for (const result of die.results ?? []) {

      if (result.active === false) continue;

      const caras =
        Number(die.faces);

      const valor =
        Number(result.result);

      const regla =
        mtrolReglaDado(
          caras,
          valor
        );

      if (regla.critico) {
        totalBase -= valor;
      }
    }
  }

  return totalBase;
}
