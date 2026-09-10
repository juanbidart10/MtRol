import { getReceiptFromRuntime } from "../runtime/receipt-store.js";

// Evidence from the existing transaction receipts, never a second action state.
export function hasConsolidatedActivation(pending, runtime) {
  const activation = getReceiptFromRuntime(runtime, pending?.activationTransactionId);
  const costId = pending?.activationCostTransactionId;
  const cost = getReceiptFromRuntime(runtime, costId);
  return activation?.status === "completed" &&
    activation.checkpoints?.["activation-cost"]?.costTransactionId === costId &&
    Boolean(activation.checkpoints?.["main-action-consumed"]) &&
    cost?.status === "completed";
}

export function hasConsolidatedOpposition(pending, runtime) {
  if (!hasConsolidatedActivation(pending, runtime)) return false;
  if (!pending.defenderRoll) return true;
  const response = getReceiptFromRuntime(runtime, pending.responseActivationTransactionId);
  const costId = pending.responseCostTransactionId;
  return response?.status === "completed" &&
    response.checkpoints?.["response-cost"]?.costTransactionId === costId &&
    getReceiptFromRuntime(runtime, costId)?.status === "completed";
}
