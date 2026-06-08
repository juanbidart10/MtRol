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
    console.warn("MTROL | No se pudo esperar la animacion de dados.", error);
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

// =========================
// EVALUACIÓN CENTRAL MTROL
// =========================

export async function mtrolEvaluarDadosMtrol(roll) {

  let totalExtra = 0;

  const detalles = [];

  let cantidadDharma = 0;
  let cantidadKarma = 0;

  for (const die of roll.dice ?? []) {

    for (const result of die.results ?? []) {

      if (result.active === false) continue;

      const caras =
        Number(die.faces);

      const valor =
        Number(result.result);

      const regla =
        mtrolReglaDado(caras, valor);

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
          detalles,
          cantidadDharma,
          cantidadKarma
        };
      }

      // =========================
      // NO FUE CRÍTICO
      // =========================

      if (!regla.critico) {
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

        // =========================
        // VISUAL DICE SO NICE
        // =========================

        await mtrolMostrarDados(extraRoll);

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
            detalles,
            cantidadDharma,
            cantidadKarma
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

        totalExtra +=
          extraValor * multiplicador;

        break;
      }
    }
  }

  return {
    pifia: false,
    motivo: "",
    totalExtra,
    detalles,
    cantidadDharma,
    cantidadKarma
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
