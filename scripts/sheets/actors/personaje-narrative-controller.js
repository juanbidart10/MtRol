import { declareNarrativeCapability } from "../../runtime/narrative-capability-commands.js";
import { logger } from "../../utils/logger.js";

/** UI-only lock; the existing persistent domain receipt handles socket retries/reloads. */
export async function onDeclareNarrativeCapability(event) {
  event.preventDefault();
  event.stopPropagation();
  const button = event.currentTarget;
  if (button.disabled || event.detail > 1 || this._mtrolNarrativeDeclarationPending) return false;
  const capabilityId = button.dataset.capabilityId;
  const previous = this._mtrolNarrativeDeclarationRetry;
  const request = previous?.capabilityId === capabilityId && previous.actorUuid === this.actor.uuid
    ? previous
    : { capabilityId, actorUuid: this.actor.uuid, transactionId: foundry.utils.randomID() };
  this._mtrolNarrativeDeclarationRetry = request;
  this._mtrolNarrativeDeclarationPending = true;
  button.disabled = true;
  try {
    await declareNarrativeCapability(this.actor, capabilityId, { transactionId: request.transactionId });
    this._mtrolNarrativeDeclarationRetry = null;
    ui.notifications.info("Intención declarada. La resolución queda a criterio del GM.");
    return true;
  } catch (error) {
    logger.warn("CAPABILITY", "narrative declaration rejected", {
      actorUuid: this.actor.uuid, capabilityId, requestId: request.transactionId, error: error.message
    });
    ui.notifications.warn(error.message ?? "No se pudo declarar la capacidad.");
    return false;
  } finally {
    this._mtrolNarrativeDeclarationPending = false;
    this.render(false); // Re-derive capabilities, including a race change during the request.
  }
}
