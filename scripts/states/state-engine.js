import { authorityService, AuthorityBoundaryError } from "../core/authority-service.js";
import { requestPrimaryGM } from "../core/socket-requests.js";
import { runtimeRepository, transactionCoordinator } from "../runtime/runtime-foundation.js";
import { logger } from "../utils/logger.js";

const SYSTEM_ID = "mtrol";
const STATES_FLAG = "states";

const STATE_LABELS = {
  stunned: "Stunned",
  dead: "Dead"
};

function getActorFromActorOrToken(actorOrToken) {
  return actorOrToken?.actor ?? actorOrToken?.document?.actor ?? actorOrToken ?? null;
}

function getTokenDocumentFromActorOrToken(actorOrToken) {
  return actorOrToken?.documentName === "Token"
    ? actorOrToken
    : actorOrToken?.document ?? null;
}

function getStateLabel(state) {
  return STATE_LABELS[state] ?? state;
}

async function applyStatusEffect(actorOrToken, state) {
  const statusId =
    state === "dead" ? "dead" : state;

  const token =
    actorOrToken?.object ?? actorOrToken;

  try {
    if (typeof token?.toggleEffect === "function") {
      const status =
        CONFIG.statusEffects?.find(effect => effect.id === statusId || effect.statuses?.has?.(statusId));

      if (status) {
        await token.toggleEffect(status, { active: true });
      }
    }
  } catch (error) {
    logger.warn("STATE", "state icon could not be applied", { state, error: error.message });
  }
}

async function createStateEffect(actor, state) {
  const existing =
    actor.effects?.find(effect =>
      effect.getFlag?.(SYSTEM_ID, "state") === state ||
      effect.statuses?.has?.(state)
    );

  if (existing) return existing;

  const status =
    CONFIG.statusEffects?.find(effect => effect.id === state || effect.statuses?.has?.(state));

  const data = {
    name: `MTROL | ${getStateLabel(state)}`,
    icon: status?.img ?? status?.icon ?? "icons/svg/aura.svg",
    disabled: false,
    flags: {
      [SYSTEM_ID]: {
        state
      }
    }
  };

  if (state) {
    data.statuses = [state];
  }

  const [effect] =
    await actor.createEmbeddedDocuments("ActiveEffect", [data]);

  return effect;
}

async function applyStateDirect(actorOrToken, state, options = {}) {
  const actor =
    getActorFromActorOrToken(actorOrToken);

  if (!actor) {
    throw new Error("No se encontro actor para aplicar estado.");
  }

  const currentStates =
    foundry.utils.duplicate(actor.getFlag(SYSTEM_ID, STATES_FLAG) ?? {});

  if (!currentStates[state]) {
    currentStates[state] = {
      state,
      source: options.source ?? null,
      appliedBy: game.user?.id ?? null,
      appliedAt: Date.now()
    };

    await actor.setFlag(SYSTEM_ID, STATES_FLAG, currentStates);
  }

  await createStateEffect(actor, state);
  await applyStatusEffect(actorOrToken, state);

  const data = {
    actorUuid: actor.uuid,
    state,
    source: options.source ?? null
  };

  logger.info("STATE", "state applied", { actorUuid: actor.uuid, state: String(state).slice(0, 100) });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="mtrol-chat-card">
        <h2>Estado aplicado</h2>
        <p><strong>${foundry.utils.escapeHTML(actor.name)}</strong> recibe <strong>${foundry.utils.escapeHTML(getStateLabel(state))}</strong>.</p>
      </div>
    `
  });

  return data;
}

export async function applyState(actorOrToken, state, options = {}) {
  const actor = getActorFromActorOrToken(actorOrToken);
  const payload = {
    actorUuid: actor?.uuid ?? null,
    tokenUuid: getTokenDocumentFromActorOrToken(actorOrToken)?.uuid ?? null,
    state,
    options: { source: options.source ?? null },
    transactionId: options.transactionId ?? foundry.utils.randomID()
  };
  // A macro/Sheet is not authority. Even an owner goes through the Primary GM.
  if (authorityService.isPrimaryGM()) {
    return applyManualStateAuthoritative(payload, { requestingUserId: game.user.id });
  }
  const response = await requestPrimaryGM("mtrolApplyState", payload);
  if (!response.ok) {
    throw new AuthorityBoundaryError(response.error ?? "Estado rechazado.", response.reasonCode ?? "STATE_REQUEST_FAILED");
  }
  return response.result;
}

function rejectState(reasonCode, message, context = {}) {
  logger.warn("STATE", "state request rejected", { ...context, reasonCode });
  throw new AuthorityBoundaryError(message, reasonCode);
}

function assertStateAuthority(requestingUserId, context) {
  if (!authorityService.isPrimaryGM()) {
    rejectState("NOT_PRIMARY_GM", "Sólo el Primary GM puede aplicar estados.", context);
  }
  if (!authorityService.resolveUser(requestingUserId)) {
    rejectState("STATE_USER_INVALID", "El usuario solicitante no existe.", context);
  }
}

async function resolveStateTarget(actorUuid, tokenUuid, context) {
  let actor, token;
  try {
    token = tokenUuid ? await fromUuid(tokenUuid) : null;
    actor = actorUuid ? await fromUuid(actorUuid) : token?.actor;
  } catch (error) {
    rejectState("STATE_TARGET_INVALID", "No se pudo resolver el Actor/Token objetivo.", { ...context, error: error.message });
  }
  if (!actor || (actor.documentName && actor.documentName !== "Actor") ||
      (tokenUuid && (!token?.actor || token.actor.uuid !== actor.uuid))) {
    rejectState("STATE_TARGET_INVALID", "El Actor/Token objetivo no es válido o no coincide.", context);
  }
  return { actor, actorOrToken: token ?? actor };
}

async function executeState({ actor, actorOrToken, state, options, transactionId, requestingUserId, origin, scope }) {
  const context = { actorUuid: actor.uuid, transactionId, userId: requestingUserId, origin };
  if (typeof state !== "string" || !state.trim() || ["__proto__", "prototype", "constructor"].includes(state)) {
    rejectState("STATE_INVALID", "Estado MTROL incompleto o inválido.", context);
  }
  if (typeof transactionId !== "string" || !transactionId.trim()) {
    rejectState("STATE_TRANSACTION_REQUIRED", "Falta transactionId para aplicar el estado.", context);
  }
  const existing = transactionCoordinator.get(scope, transactionId);
  const { store, target: receiptTarget } = transactionCoordinator.resolveStore(scope);
  const unresolved = Object.values(store.repository.read(receiptTarget)?.receipts ?? {}).find(receipt =>
    receipt.command === "state.apply" && receipt.actorUuid === actor.uuid && receipt.transactionId !== transactionId &&
    receipt.status === "recovery-required");
  if (unresolved) {
    rejectState("STATE_RECOVERY_REQUIRED", "Este Actor tiene una aplicación de estado pendiente de revisión.",
      { ...context, blockingTransactionId: unresolved.transactionId });
  }
  if (existing && (existing.command !== "state.apply" || existing.state !== state ||
      existing.actorUuid !== actor.uuid || existing.userId !== requestingUserId || existing.origin !== origin)) {
    rejectState("STATE_TRANSACTION_CONFLICT", "La transacción pertenece a otra operación.", context);
  }
  try {
    const result = await transactionCoordinator.execute(scope, {
      transactionId,
      command: "state.apply",
      serializationKey: `state:${actor.uuid}`,
      metadata: { ...context, state },
      apply: async ({ checkpoint }) => {
        // Persist intent BEFORE the first write: a lost acknowledgement is ambiguous,
        // never a safe retry of Actor flags + ActiveEffect + chat.
        await checkpoint("state-write-intent", { actorUuid: actor.uuid, state });
        return applyStateDirect(actorOrToken, state, options);
      }
    });
    if (result?.actorUuid !== actor.uuid || result?.state !== state) {
      rejectState("STATE_TRANSACTION_CONFLICT", "El resultado corresponde a otra operación de estado.", context);
    }
    return result;
  } catch (error) {
    if (error.reasonCode === "RECOVERY_REQUIRED") error.reasonCode = "STATE_RECOVERY_REQUIRED";
    error.reasonCode ??= error.name === "TransactionRecoveryRequiredError" ||
      transactionCoordinator.get(scope, transactionId)?.status === "recovery-required"
      ? "STATE_RECOVERY_REQUIRED" : "STATE_APPLY_FAILED";
    logger.error("STATE", "state application failed", { ...context, reasonCode: error.reasonCode, error: error.message });
    throw error;
  }
}

/** Manual public/socket route. Client-provided source/pendingActionId never grants permission. */
export async function applyManualStateAuthoritative(payload = {}, { requestingUserId = game.user?.id } = {}) {
  const context = { actorUuid: payload.actorUuid ?? null, userId: requestingUserId, transactionId: payload.transactionId ?? null };
  assertStateAuthority(requestingUserId, context);
  const target = await resolveStateTarget(payload.actorUuid, payload.tokenUuid, context);
  if (!authorityService.ownsActor(target.actor, requestingUserId)) {
    rejectState("STATE_ACTOR_NOT_OWNED", "No puede aplicar estados manuales sobre un Actor ajeno.", context);
  }
  return executeState({
    ...target, state: payload.state, options: { source: payload.options?.source ?? null },
    transactionId: payload.transactionId, requestingUserId, origin: "manual", scope: { actor: target.actor }
  });
}

/** Internal application boundary, NOT a socket route or public façade method.
 * Only the authoritative opposition resolver supplies its freshly computed result.
 * All actors/effects/options are reconstructed from the persisted canonical action.
 */
export async function applyResolvedActionStateAuthoritative({ combatId, pendingActionId, resolutionResult, requestingUserId } = {}) {
  const context = { combatId, pendingActionId, userId: requestingUserId };
  assertStateAuthority(requestingUserId, context);
  const combat = runtimeRepository.resolveCombat(combatId);
  const pending = runtimeRepository.read(combat)?.pendingActions?.[pendingActionId];
  if (!pending || pending.status !== "resolving" || !pending.attackerRoll || !pending.defenderRoll ||
      !pending.resolutionTransactionId || typeof resolutionResult?.success !== "boolean") {
    rejectState("STATE_ACTION_CONTEXT_INVALID", "La acción no tiene una resolución autoritativa aplicable.", context);
  }
  const defender = await fromUuid(pending.targetActorUuid);
  if (!authorityService.ownsActor(defender, requestingUserId)) {
    rejectState("STATE_ACTION_NOT_AUTHORIZED", "El usuario no controla al defensor de esta resolución.", context);
  }
  const success = resolutionResult.success;
  const state = success ? pending.effect : pending.responseEffect;
  if (state !== "stunned") {
    rejectState("STATE_ACTION_EFFECT_INVALID", "La mecánica resuelta no concede ese estado.", context);
  }
  const target = await resolveStateTarget(
    success ? pending.targetActorUuid : pending.sourceActorUuid,
    success ? pending.targetTokenUuid : pending.sourceTokenUuid,
    context
  );
  return executeState({
    ...target, state, requestingUserId, origin: `opposition:${pendingActionId}`,
    transactionId: `state:${pending.resolutionTransactionId}:${success ? "target" : "source"}`,
    // Manual and mechanical state writes share the Actor receipt scope/queue.
    scope: { actor: target.actor },
    options: {
      source: success ? pending.sourceItemName : pending.responseItemName,
      pendingActionId,
      duration: success ? pending.effectDuration : 1,
      intensity: success ? pending.effectIntensity : 0
    }
  });
}

export function installMtrolStatesApi() {
  game.mtrol = game.mtrol || {};
  Object.assign(game.mtrol.states ??= {}, {
    applyState
  });
}
