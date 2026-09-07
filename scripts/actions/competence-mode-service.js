import { requestPrimaryGM } from "../core/socket-requests.js";
import { transactionCoordinator } from "../runtime/runtime-foundation.js";

export const COMPETENCE_MODE_IDS = Object.freeze({
  RECOVER_MP: "RECOVER_MP",
  ASTRAL_PROJECTION: "ASTRAL_PROJECTION"
});

const LEGACY_MEDITATION_MODES = Object.freeze([
  { modeId: COMPETENCE_MODE_IDS.RECOVER_MP, label: "Recuperar MP", strategy: "recover-mp" },
  { modeId: COMPETENCE_MODE_IDS.ASTRAL_PROJECTION, label: "Proyección astral", strategy: "narrative" }
]);

export function getCompetenceExecutionModes(item) {
  const configured = Array.from(item?.system?.executionModes ?? [])
    .map(mode => ({
      modeId: String(mode?.modeId ?? "").trim(),
      label: String(mode?.label ?? mode?.modeId ?? "").trim(),
      strategy: String(mode?.strategy ?? "narrative").trim(),
      resolutionResult: mode?.resolutionResult ?? null,
      damageFormula: String(mode?.damageFormula ?? "").trim()
    }))
    .filter(mode => mode.modeId && mode.label);
  if (configured.length > 0) return configured;
  // COMPATIBILITY: mundos existentes identifican la mecánica por effect, no por nombre.
  return item?.system?.effect === "mpRecovery"
    ? LEGACY_MEDITATION_MODES.map(mode => ({ ...mode }))
    : [];
}

export async function selectCompetenceExecutionMode(item) {
  const modes = getCompetenceExecutionModes(item);
  if (modes.length === 0) return null;
  if (modes.length === 1) return modes[0];
  const options = modes.map(mode =>
    `<option value="${mode.modeId}">${mode.label}</option>`
  ).join("");
  const modeId = await Dialog.wait({
    title: `Modo de ${item.name}`,
    content: `<div class="form-group"><label>Modo</label><select name="modeId">${options}</select></div>`,
    buttons: {
      confirm: {
        label: "Continuar",
        callback: html => html.querySelector?.('[name="modeId"]')?.value ??
          html.find?.('[name="modeId"]')?.val?.()
      },
      cancel: { label: "Cancelar", callback: () => null }
    },
    close: () => null
  });
  return modes.find(mode => mode.modeId === modeId) ?? null;
}

function canUse(actor, userId) {
  const user = game.users?.get?.(userId);
  return Boolean(user && (user.isGM || actor?.testUserPermission?.(user, "OWNER") === true));
}

export async function persistCompetenceModeIntentAuthoritative(payload = {}, {
  requestingUserId = game.user?.id,
  trustedActor = null,
  trustedItem = null
} = {}) {
  if (!game.user?.isGM) throw new Error("Solo el Primary GM puede persistir el modo.");
  const actor = trustedActor ?? await fromUuid(String(payload.actorUuid ?? ""));
  if (!actor || !canUse(actor, requestingUserId)) throw new Error("Modo de competencia no autorizado.");
  const item = trustedItem ?? actor.items?.get?.(payload.itemId);
  const mode = getCompetenceExecutionModes(item).find(candidate => candidate.modeId === payload.modeId);
  if (!item || !mode) throw new Error("Modo de competencia inválido.");
  const transactionId = String(payload.transactionId ?? "").trim();
  const scope = game.combat ? { combat: game.combat } : { actor };
  return transactionCoordinator.execute(scope, {
    transactionId,
    command: "resource.competence-mode-intent",
    metadata: { actorUuid: actor.uuid, itemUuid: item.uuid, modeId: mode.modeId },
    apply: async () => ({
      transactionId,
      actorUuid: actor.uuid,
      itemUuid: item.uuid,
      modeId: mode.modeId,
      strategy: mode.strategy,
      resolutionResult: mode.resolutionResult,
      damageFormula: mode.damageFormula,
      selectedAt: Date.now()
    })
  });
}

export async function prepareCompetenceModeIntent(actor, item, mode) {
  const payload = {
    actorUuid: actor.uuid,
    itemId: item.id,
    modeId: mode.modeId,
    transactionId: `mode:${foundry.utils.randomID?.() ?? crypto.randomUUID()}`
  };
  if (game.user?.isGM) {
    return persistCompetenceModeIntentAuthoritative(payload, {
      requestingUserId: game.user.id,
      trustedActor: actor,
      trustedItem: item
    });
  }
  const response = await requestPrimaryGM("mtrolSelectCompetenceMode", payload);
  if (!response.ok || response.result?.commandResult?.ok === false) {
    throw new Error(response.error ?? response.result?.commandResult?.humanReason ?? "No se pudo registrar el modo.");
  }
  return response.result?.receipt ?? null;
}
