// =========================
// MTROL - SOCKETS
// =========================

import {
  applyStateFromSocket
} from "../states/state-engine.js";

import {
  executeResolvedDamageAuthoritative
} from "../actions/action-damage-engine.js";

import {
  consumeDharmaSpendAuthoritative
} from "../rolls/dharma-spend-service.js";

import {
  aplicarConsumoMPAuthoritative,
  reembolsarCostoMPAuthoritative,
  restaurarMPMeditacionAuthoritative
} from "../combat/mp-engine.js";

import {
  spendPendingAttributePointAuthoritative,
  spendPendingCompetencePointAuthoritative
} from "../actors/progression-advancement-service.js";

import {
  acceptTradeSessionAuthoritative,
  cancelTradeSessionByGMAuthoritative,
  cancelTradeSessionAuthoritative,
  confirmTradeSessionAuthoritative,
  createTradeSessionAuthoritative,
  setTradeOfferAuthoritative
} from "../trade/trade-authority.js";

import {
  receiveTradeAuthorityReset,
  receiveTradeGMSessionSync,
  receiveTradeSessionSync
} from "../trade/trade-api.js";

import {
  useConsumableAuthoritative
} from "../items/consumable-service.js";

import {
  buildPublicTradeSessionView
} from "../trade/trade-view-model.js";

import {
  handleSocketResponse,
  isPrimaryActiveGM,
  respondToSocketRequest
} from "./socket-requests.js";

import {
  turnSocketOperations
} from "../combat/turn-system.js";

async function respondWithResult(request, operation) {
  try {
    const result =
      await operation();

    respondToSocketRequest(request, {
      ok: true,
      result
    });
  } catch (error) {
    console.error("MTROL | Solicitud autoritativa rechazada:", error);

    respondToSocketRequest(request, {
      ok: false,
      error: error.message,
      result: null
    });
  }
}

export function registerMtrolSockets() {
  game.socket.on("system.mtrol", async (data) => {
    if (!data) return;

    if (handleSocketResponse(data)) return;

    if (data.action === "mtrolTradeSessionSync") {
      receiveTradeSessionSync(data);
      return;
    }

    if (data.action === "mtrolTradeGMSessionSync") {
      receiveTradeGMSessionSync(data);
      return;
    }

    if (data.action === "mtrolTradeAuthorityReset") {
      receiveTradeAuthorityReset(data);
      return;
    }

    if (data.action === "mtrolPendingActionSync") {
      game.mtrol?.actions?.receivePendingActionSync?.(
        data.pendingAction
      );
      return;
    }

    if (data.action === "mtrolPendingActionCleared") {
      game.mtrol?.actions?.receivePendingActionCleared?.(
        data.pendingActionId
      );
      return;
    }

    if (!game.user.isGM) return;
    if (!isPrimaryActiveGM()) return;
    if (data.targetGMId && data.targetGMId !== game.user.id) return;

    try {
      switch (data.action) {

        case "mtrolPrepareTurn": {
          await respondWithResult(data, () =>
            turnSocketOperations.prepareAuthoritative(data.payload ?? {}, {
              requestingUserId: data.requestingUserId
            }));
          break;
        }

        case "mtrolSetPreparation": {
          await respondWithResult(data, () =>
            turnSocketOperations.setPreparationAuthoritative(data.payload ?? {}, {
              requestingUserId: data.requestingUserId
            }));
          break;
        }

        case "mtrolReservePreparation": {
          await respondWithResult(data, () =>
            turnSocketOperations.reservePreparationAuthoritative(data.payload ?? {}, {
              requestingUserId: data.requestingUserId
            }));
          break;
        }

        case "mtrolCompletePreparation": {
          await respondWithResult(data, () =>
            turnSocketOperations.completePreparationAuthoritative(data.payload ?? {}, {
              requestingUserId: data.requestingUserId
            }));
          break;
        }

        case "mtrolCancelPreparationReservation": {
          await respondWithResult(data, () =>
            turnSocketOperations.cancelPreparationReservationAuthoritative(data.payload ?? {}, {
              requestingUserId: data.requestingUserId
            }));
          break;
        }

        case "mtrolEndTurn": {
          await respondWithResult(data, () =>
            turnSocketOperations.endTurnAuthoritative(data.payload ?? {}, {
              requestingUserId: data.requestingUserId
            }));
          break;
        }

        case "mtrolGrantTurnMovement": {
          await respondWithResult(data, () =>
            turnSocketOperations.grantMovementAuthoritative(data.payload ?? {}, {
              requestingUserId: data.requestingUserId
            }));
          break;
        }

        case "mtrolCommitTurnMovement": {
          await respondWithResult(data, () =>
            turnSocketOperations.commitTurnMovementAuthoritative(data.payload ?? {}, {
              requestingUserId: data.requestingUserId
            }));
          break;
        }

        case "mtrolFinalizeTurnUse": {
          await respondWithResult(data, () =>
            turnSocketOperations.finalizeTurnUseAuthoritative(data.payload ?? {}, {
              requestingUserId: data.requestingUserId
            }));
          break;
        }

        case "mtrolCompleteTurnAction": {
          await respondWithResult(data, () =>
            turnSocketOperations.completeResolvedTurnActionAuthoritative(data.payload ?? {}, {
              requestingUserId: data.requestingUserId
            }));
          break;
        }

        case "mtrolConsumeDharma": {
          await respondWithResult(data, async () => ({
            receipt:
              await consumeDharmaSpendAuthoritative(
                data.payload ?? {},
                {
                  requestingUserId: data.requestingUserId
                }
              )
          }));

          break;
        }

        case "mtrolSpendMP": {
          await respondWithResult(data, async () => ({
            receipt: await aplicarConsumoMPAuthoritative(data.payload ?? {}, {
              requestingUserId: data.requestingUserId
            })
          }));
          break;
        }

        case "mtrolUseConsumable": {
          await respondWithResult(data, async () => ({
            receipt: await useConsumableAuthoritative(data.payload ?? {}, {
              requestingUserId: data.requestingUserId
            })
          }));
          break;
        }

        case "mtrolRefundMP": {
          await respondWithResult(data, async () => ({
            receipt: await reembolsarCostoMPAuthoritative(data.payload ?? {}, {
              requestingUserId: data.requestingUserId
            })
          }));
          break;
        }

        case "mtrolRestoreMeditationMP": {
          await respondWithResult(data, async () => ({
            receipt: await restaurarMPMeditacionAuthoritative(data.payload ?? {}, {
              requestingUserId: data.requestingUserId
            })
          }));
          break;
        }

        case "mtrolTradeCreateSession": {
          await respondWithResult(data, async () => ({
            session: buildPublicTradeSessionView(
              await createTradeSessionAuthoritative(data.payload ?? {}, {
                requestingUserId: data.requestingUserId
              })
            )
          }));
          break;
        }

        case "mtrolTradeAcceptSession": {
          await respondWithResult(data, async () => ({
            session: buildPublicTradeSessionView(
              await acceptTradeSessionAuthoritative(data.payload ?? {}, {
                requestingUserId: data.requestingUserId
              })
            )
          }));
          break;
        }

        case "mtrolTradeSetOffer": {
          await respondWithResult(data, async () => ({
            session: buildPublicTradeSessionView(
              await setTradeOfferAuthoritative(data.payload ?? {}, {
                requestingUserId: data.requestingUserId
              })
            )
          }));
          break;
        }

        case "mtrolTradeConfirm": {
          await respondWithResult(data, async () => ({
            session: buildPublicTradeSessionView(
              await confirmTradeSessionAuthoritative(data.payload ?? {}, {
                requestingUserId: data.requestingUserId
              })
            )
          }));
          break;
        }

        case "mtrolTradeCancel": {
          await respondWithResult(data, async () => ({
            session: buildPublicTradeSessionView(
              await cancelTradeSessionAuthoritative(data.payload ?? {}, {
                requestingUserId: data.requestingUserId
              })
            )
          }));
          break;
        }

        case "mtrolTradeGMCancel": {
          await respondWithResult(data, async () => ({
            session: buildPublicTradeSessionView(
              await cancelTradeSessionByGMAuthoritative(data.payload ?? {}, {
                requestingUserId: data.requestingUserId
              })
            )
          }));
          break;
        }

        case "mtrolSpendPendingAttribute": {
          await respondWithResult(data, async () => ({
            receipt: await spendPendingAttributePointAuthoritative(data.payload ?? {}, {
              requestingUserId: data.requestingUserId
            })
          }));
          break;
        }

        case "mtrolSpendPendingCompetence": {
          await respondWithResult(data, async () => ({
            receipt: await spendPendingCompetencePointAuthoritative(data.payload ?? {}, {
              requestingUserId: data.requestingUserId
            })
          }));
          break;
        }

        // =========================
        // MTROL - ACCIONES ENFRENTADAS AUTORITATIVAS
        // =========================
        case "mtrolCreatePendingAction": {
          await respondWithResult(data, async () => {
            const pendingAction =
              await game.mtrol.actions.createPendingActionAuthoritative(
                data.payload?.pendingAction ?? {},
                {
                  requestingUserId: data.requestingUserId
                }
              );

            return {
              pendingAction:
                game.mtrol.actions.serializePendingAction(pendingAction)
            };
          });

          break;
        }

        case "mtrolCreateReadyDamageAction": {
          await respondWithResult(data, async () => {
            const pendingAction =
              await game.mtrol.actions.createReadyDamageActionAuthoritative(
                data.payload?.pendingAction ?? {},
                { requestingUserId: data.requestingUserId }
              );

            return {
              pendingAction: game.mtrol.actions.serializePendingAction(pendingAction)
            };
          });

          break;
        }

        case "mtrolAttachDefenseRoll": {
          await respondWithResult(data, async () => {
            const result =
              await game.mtrol.actions.attachDefenseRollAuthoritative({
                pendingActionId: data.payload?.pendingActionId ?? null,
                defenderActorUuid: data.payload?.defenderActorUuid ?? null,
                defenseItemId: data.payload?.defenseItemId ?? null,
                defenderRoll: data.payload?.defenderRoll ?? null,
                requestingUserId: data.requestingUserId
              });

            const pendingAction =
              game.mtrol.actions.serializePendingAction(result.pendingAction);

            return {
              pendingAction,
              resolutionResult: pendingAction?.result ?? null
            };
          });

          break;
        }

        case "mtrolResolvePendingAction": {
          await respondWithResult(data, async () => {
            const result =
              await game.mtrol.actions.resolvePendingActionAuthoritative(
                data.payload?.pendingActionId,
                {
                  requestingUserId: data.requestingUserId
                }
              );

            const pendingAction =
              game.mtrol.actions.serializePendingAction(result.pendingAction);

            return {
              pendingAction,
              resolutionResult: pendingAction?.result ?? null
            };
          });

          break;
        }

        case "mtrolExecuteResolvedDamage": {
          await respondWithResult(data, async () => {
            const result =
              await executeResolvedDamageAuthoritative(
                data.payload?.pendingActionId,
                {
                  requestingUserId: data.requestingUserId
                }
              );

            const pendingAction =
              game.mtrol.actions.getPendingAction(
                data.payload?.pendingActionId
              );

            return {
              pendingAction:
                game.mtrol.actions.serializePendingAction(pendingAction),
              damageResult: {
                success: result?.success === true,
                fumble: result?.fumble === true,
                totalBaseDanio: Number(result?.totalBaseDanio ?? 0),
                totalFinalDanio: Number(result?.totalFinalDanio ?? 0),
                resultadoDanio: result?.resultadoDanio
                  ? {
                      numeroLocalizacion: Number(result.resultadoDanio.numeroLocalizacion ?? 0),
                      slot: result.resultadoDanio.slot ?? null,
                      zona: result.resultadoDanio.zona ?? null,
                      item: result.resultadoDanio.item ?? null,
                      defensaInicial: Number(result.resultadoDanio.defensaInicial ?? 0),
                      defensaFinal: Number(result.resultadoDanio.defensaFinal ?? 0),
                      danioOriginal: Number(result.resultadoDanio.danioOriginal ?? 0),
                      danioAbsorbido: Number(result.resultadoDanio.danioAbsorbido ?? 0),
                      hpPerdido: Number(result.resultadoDanio.hpPerdido ?? 0),
                      hpAnterior: Number(result.resultadoDanio.hpAnterior ?? 0),
                      hpNuevo: Number(result.resultadoDanio.hpNuevo ?? 0),
                      itemDestruido: result.resultadoDanio.itemDestruido === true,
                      aplicacion: result.resultadoDanio.aplicacion ?? null
                    }
                  : null
              }
            };
          });

          break;
        }

        case "mtrolClearPendingAction": {
          await respondWithResult(data, async () => {
            await game.mtrol.actions.clearPendingActionAuthoritative(
              data.payload?.pendingActionId,
              {
                requestingUserId: data.requestingUserId,
                reason: data.payload?.reason ?? "cancelled"
              }
            );

            const pendingAction =
              game.mtrol.actions.getPendingAction(
                data.payload?.pendingActionId
              );

            return {
              pendingAction:
                game.mtrol.actions.serializePendingAction(pendingAction)
            };
          });

          break;
        }

        case "mtrolRequestPendingActionsForActor": {
          await respondWithResult(data, async () => {
            const pendingActions =
              await game.mtrol.actions.requestPendingActionsForActor(
                data.payload?.actorUuid,
                {
                  requestingUserId: data.requestingUserId
                }
              );

            return {
              pendingActions:
                pendingActions.map(
                  game.mtrol.actions.serializePendingAction
                )
            };
          });

          break;
        }

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
        // MTROL - ESTADOS AUTORITATIVOS
        // =========================
        case "mtrolApplyState": {
          await applyStateFromSocket(data);
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
