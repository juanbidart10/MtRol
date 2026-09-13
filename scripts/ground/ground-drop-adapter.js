import {
  requestPrimaryGM,
  SOCKET_TIMEOUT_REASON_CODE
} from "../core/socket-requests.js";
import { isMtrolActor, isMtrolObject } from "../items/item-invariants.js";
import { GROUND_SOCKET_ACTION } from "../runtime/ground-commands.js";

let hooksRegistered = false;

function defaultResolveUuid(uuid) {
  return globalThis.fromUuidSync?.(uuid) ?? null;
}

function resolveEligibleItem(data, resolveUuid) {
  if (!data || data.type !== "Item" || typeof data.uuid !== "string" || !data.uuid) return null;
  if (data.uuid.startsWith("Item.") || data.uuid.startsWith("Compendium.")) return null;
  if (data.mtrolInternal && data.mtrolInternal.source !== "mtrol-personaje-sheet") return null;
  const item = resolveUuid(data.uuid);
  const actor = item?.parent;
  if (item?.documentName !== "Item" || actor?.documentName !== "Actor") return null;
  if (!isMtrolActor(actor) || !isMtrolObject(item)) return null;
  if (item.uuid !== data.uuid || actor.items?.get?.(item.id) !== item) return null;
  return { actor, item };
}

export function shouldClaimGroundDrop(data, { resolveUuid = defaultResolveUuid } = {}) {
  return !!resolveEligibleItem(data, resolveUuid);
}

export function buildGroundDropIntent(canvas, data, { resolveUuid = defaultResolveUuid } = {}) {
  const candidate = resolveEligibleItem(data, resolveUuid);
  if (!candidate || typeof canvas?.scene?.id !== "string") return null;
  return {
    sourceActorUuid: candidate.actor.uuid,
    sourceItemUuid: candidate.item.uuid,
    sceneId: canvas.scene.id,
    position: { x: data.x, y: data.y }
  };
}

export function createGroundDropCanvasHandler({
  resolveUuid = defaultResolveUuid,
  transactionIdFactory = () => globalThis.foundry?.utils?.randomID?.(),
  requestPrimary = requestPrimaryGM,
  notifyError = message => globalThis.ui?.notifications?.error?.(message)
} = {}) {
  return function groundDropCanvasHandler(canvas, data) {
    const intent = buildGroundDropIntent(canvas, data, { resolveUuid });
    if (!intent) return undefined;
    const transactionId = transactionIdFactory();
    const requestOptions = { transactionId, notifyOnTimeout: false };
    void Promise.resolve(requestPrimary(GROUND_SOCKET_ACTION.DROP, intent, requestOptions))
      .then(response => response?.reasonCode === SOCKET_TIMEOUT_REASON_CODE
        ? requestPrimary(GROUND_SOCKET_ACTION.DROP, intent, requestOptions)
        : response)
      .then(response => {
        if (response?.ok !== true) notifyError(response?.error ?? "No se pudo crear el Ground.");
      })
      .catch(error => notifyError(error?.message ?? "No se pudo crear el Ground."));
    return false;
  };
}

export function createItemPilesGroundDropVeto({ resolveUuid = defaultResolveUuid } = {}) {
  return function itemPilesGroundDropVeto(_source, _target, itemData) {
    const data = { type: "Item", uuid: itemData?.uuid };
    const candidate = resolveEligibleItem(data, resolveUuid);
    if (candidate) return false;
    return undefined;
  };
}

export function registerGroundDropAdapterHooks({
  Hooks = globalThis.Hooks,
  game = globalThis.game,
  resolveUuid = defaultResolveUuid,
  requestPrimary = requestPrimaryGM,
  notifyError,
  force = false
} = {}) {
  if (hooksRegistered && !force) return false;
  if (!Hooks?.on) return false;
  hooksRegistered = true;
  Hooks.on("dropCanvasData", createGroundDropCanvasHandler({ resolveUuid, requestPrimary, notifyError }));
  if (game?.modules?.get?.("item-piles")?.active) {
    const hook = game?.itempiles?.hooks?.ITEM?.PRE_DROP_DETERMINED;
    if (typeof hook === "string" && hook) {
      Hooks.on(hook, createItemPilesGroundDropVeto({ resolveUuid }));
    }
  }
  return true;
}
