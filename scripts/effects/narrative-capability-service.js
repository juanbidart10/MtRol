import { resolveNarrativeCapabilities } from "./narrative-capability-resolver.js";
import { authorityService } from "../core/authority-service.js";
import { actorReceiptStore } from "../runtime/runtime-foundation.js";
import { buildNarrativeCapabilityCard } from "../ui/narrative-capability-card.js";
import { logger } from "../utils/logger.js";

export const NARRATIVE_CAPABILITY_COMMAND = "capability.narrative-declare";

function messages() {
  return Array.from(game.messages?.values?.() ?? game.messages ?? []);
}

/** Only audit receipts and ChatMessage are written. No gameplay state is touched. */
export async function declareNarrativeCapabilityAuthoritative(payload = {}, {
  requestingUserId = game.user?.id
} = {}) {
  if (!authorityService.isPrimaryGM()) throw new Error("Sólo el Primary GM puede registrar la declaración.");
  const allowed = ["actorUuid", "capabilityId", "transactionId", "tokenUuid"];
  if (Object.keys(payload).some(key => !allowed.includes(key))) throw new Error("La declaración contiene campos no admitidos.");
  if (typeof payload.actorUuid !== "string" || !payload.actorUuid ||
      typeof payload.capabilityId !== "string" || !payload.capabilityId ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(payload.transactionId ?? "")) {
    throw new Error("La declaración requiere Actor, capabilityId e identificador de solicitud válidos.");
  }
  const actor = await fromUuid(payload.actorUuid);
  if (!actor || actor.documentName !== "Actor") throw new Error("No se encontró el Actor.");
  authorityService.assertActorOwnership(actor, requestingUserId);
  const user = authorityService.resolveUser(requestingUserId);
  const resolveCapability = () => {
    const capability = resolveNarrativeCapabilities(actor).capabilities
      .find(entry => entry.technicalId === payload.capabilityId);
    if (!capability) throw new Error("Esta capacidad narrativa ya no está activa en el Actor.");
    return capability;
  };
  resolveCapability(); // Revalidate even on a replay or a stale sheet button.

  const token = payload.tokenUuid ? await fromUuid(payload.tokenUuid) : actor.token ?? null;
  if (payload.tokenUuid && (!token || token.documentName !== "Token" || token.actor?.uuid !== actor.uuid)) {
    throw new Error("El Token no corresponde al Actor declarante.");
  }
  const scene = token?.parent ?? game.scenes?.get?.(user.viewedScene) ?? null;
  const sceneName = user.isGM || scene?.id === user.viewedScene ? scene?.name ?? null : null;
  // Namespacing prevents another user/capability reusing a receipt identifier.
  const transactionId = `narrative:${user.id}:${payload.capabilityId}:${payload.transactionId}`;
  const findDeclaration = () => messages().find(message =>
    message.flags?.mtrol?.narrativeCapability?.transactionId === transactionId &&
    message.flags.mtrol.narrativeCapability.actorUuid === actor.uuid &&
    message.author?.isGM === true &&
    message.author.id === message.flags.mtrol.narrativeCapability.authorityUserId
  );
  const replay = findDeclaration();
  if (replay) return { ...replay.flags.mtrol.narrativeCapability, messageId: replay.id };

  return actorReceiptStore.execute(actor, {
    transactionId, command: NARRATIVE_CAPABILITY_COMMAND
  }, async () => {
    if (!authorityService.isPrimaryGM()) throw new Error("La autoridad GM cambió; reintentá la declaración.");
    authorityService.assertActorOwnership(actor, requestingUserId);
    const capability = resolveCapability();
    const declaration = {
      transactionId, requestId: payload.transactionId,
      actorUuid: actor.uuid, actorName: actor.name,
      capabilityId: capability.technicalId,
      passiveId: capability.passiveId, passiveIds: [...capability.passiveIds],
      displayName: capability.displayName, description: capability.description,
      userId: user.id, userName: user.name,
      timestamp: Date.now(), sceneId: scene?.id ?? null, sceneName,
      tokenUuid: token?.uuid ?? null, authorityUserId: game.user.id,
      mode: "narrative", requiresGmResolution: true
    };
    const whisper = Array.from(game.users.values()).filter(candidate =>
      candidate.isGM || candidate.id === user.id).map(candidate => candidate.id);
    const message = await ChatMessage.create({
      author: game.user.id,
      speaker: { actor: actor.id, alias: actor.name, token: token?.id ?? null, scene: scene?.id ?? null },
      whisper,
      content: buildNarrativeCapabilityCard(declaration),
      flags: { mtrol: { narrativeCapability: declaration } }
    });
    if (!message?.id) throw new Error("No se pudo registrar la declaración en el chat.");
    logger.info("CAPABILITY", "narrativeCapabilityDeclared", {
      capabilityId: capability.technicalId, passiveId: capability.passiveId,
      actorUuid: actor.uuid, userId: user.id, sceneId: scene?.id ?? null,
      requestId: payload.transactionId
    });
    return { ...declaration, messageId: message.id };
  });
}
