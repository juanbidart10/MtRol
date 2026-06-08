// =========================
// MTROL - SOCKETS
// =========================

function isPrimaryActiveGM() {
  const activeGMs =
    game.users
      .filter(user => user.isGM && user.active)
      .sort((a, b) => a.id.localeCompare(b.id));

  return activeGMs[0]?.id === game.user.id;
}

export function registerMtrolSockets() {
  game.socket.on("system.mtrol", async (data) => {
    if (!game.user.isGM) return;
    if (!isPrimaryActiveGM()) return;
    if (!data) return;

    try {
      switch (data.action) {

        // =========================
        // LEGACY / DAÑO SIMPLE
        // =========================
        case "mtrolAplicarDanio": {
          if (typeof game.mtrol?.aplicarDanioAutorizado !== "function") {
            console.warn(
              "MTROL | aplicarDanioAutorizado no está registrado en game.mtrol."
            );
            return;
          }

          const attackerActor =
            data.attackerUuid
              ? await fromUuid(data.attackerUuid)
              : null;

          const targetTokenDocument =
            data.targetTokenUuid
              ? await fromUuid(data.targetTokenUuid)
              : null;

          const targetActor =
            targetTokenDocument?.actor ??
            (
              data.targetActorUuid
                ? await fromUuid(data.targetActorUuid)
                : null
            );

          if (!targetActor) {
            console.warn("MTROL | Socket daño sin targetActor válido.", data);
            return;
          }

          const payload =
            data.payload ?? {};

          await game.mtrol.aplicarDanioAutorizado({
            attackerActor,
            targetActor,
            targetTokenDocument,
            payload
          });

          break;
        }

        // =========================
        // MTROL - DAÑO LOCALIZADO AUTORITATIVO
        // =========================
        case "mtrolAplicarDanioLocalizado": {
          if (typeof game.mtrol?.aplicarDanioLocalizadoAutorizado !== "function") {
            console.warn(
              "MTROL | aplicarDanioLocalizadoAutorizado no está registrado en game.mtrol."
            );
            return;
          }

          const attackerActor =
            data.attackerUuid
              ? await fromUuid(data.attackerUuid)
              : null;

          const targetTokenDocument =
            data.targetTokenUuid
              ? await fromUuid(data.targetTokenUuid)
              : null;

          const targetActor =
            targetTokenDocument?.actor ??
            (
              data.targetActorUuid
                ? await fromUuid(data.targetActorUuid)
                : null
            );

          if (!attackerActor) {
            console.warn("MTROL | Socket daño localizado sin attackerActor válido.", data);
            return;
          }

          if (!targetActor) {
            console.warn("MTROL | Socket daño localizado sin targetActor válido.", data);
            return;
          }

          const payload =
            data.payload ?? {};

          const resultadoDanio =
            await game.mtrol.aplicarDanioLocalizadoAutorizado({
              attackerActor,
              targetActor,
              targetTokenDocument,
              payload
            });

          if (!resultadoDanio) break;

          break;
        }

        // =========================
        // MTROL - COMERCIO AUTORITATIVO
        // =========================
        case "mtrolEjecutarComercio": {
          if (typeof game.mtrol?.ejecutarComercioMtrolDesdeSocket !== "function") {
            console.warn(
              "MTROL | ejecutarComercioMtrolDesdeSocket no esta registrado en game.mtrol."
            );
            return;
          }

          await game.mtrol.ejecutarComercioMtrolDesdeSocket(data);
          break;
        }

        default:
          console.warn(
            `MTROL | Acción socket desconocida: ${data.action}`
          );
          break;
      }

    } catch (error) {
      console.error("MTROL | Error procesando socket:", error);
    }
  });

  console.log("MtRol | Sockets registrados.");
}
