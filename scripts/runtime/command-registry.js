import { integrationObservability } from "../core/integration-observability.js";
import { createReceiptFingerprint } from "./receipt-store.js";

const COMMAND_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;

export class CommandBoundaryError extends Error {
  constructor(message) {
    super(message);
    this.name = "CommandBoundaryError";
  }
}

export class CommandRegistry {
  constructor({
    receiptStore = null,
    logger = null,
    resolveCombat = null,
    resolveActor = null,
    observability = integrationObservability
  } = {}) {
    this.receiptStore = receiptStore;
    this.logger = logger;
    this.resolveCombat = resolveCombat;
    this.resolveActor = resolveActor;
    this.observability = observability;
    this.handlers = new Map();
  }

  register(command, handler, {
    idempotent = true,
    validate = null,
    scope = "combat",
    receiptTarget = null
  } = {}) {
    if (!COMMAND_PATTERN.test(command)) {
      throw new Error(`Nombre de command invalido: ${command}`);
    }
    if (this.handlers.has(command)) throw new Error(`Command duplicado: ${command}`);
    if (typeof handler !== "function") throw new Error(`Handler invalido: ${command}`);
    this.handlers.set(command, { handler, idempotent, validate, scope, receiptTarget });
    return this;
  }

  has(command) {
    return this.handlers.has(command);
  }

  validateEnvelope(envelope, context = {}, definition = null) {
    if (!envelope || typeof envelope !== "object") {
      throw new CommandBoundaryError("Envelope de command invalido.");
    }
    if (!this.has(envelope.command)) {
      throw new CommandBoundaryError(`Command no registrado: ${envelope.command}`);
    }
    if (!envelope.transactionId || typeof envelope.transactionId !== "string") {
      throw new CommandBoundaryError("transactionId es obligatorio.");
    }
    const scope = definition?.scope ?? "combat";
    const hasCombat = typeof envelope.combatId === "string" && envelope.combatId.length > 0;
    const hasActor = typeof envelope.actorId === "string" && envelope.actorId.length > 0;
    if (scope === "combat" && !hasCombat) throw new CommandBoundaryError("combatId es obligatorio.");
    if (scope === "actor" && !hasActor) throw new CommandBoundaryError("actorId es obligatorio.");
    if (scope === "either" && !hasCombat && !hasActor) {
      throw new CommandBoundaryError("combatId o actorId es obligatorio.");
    }
    if (!["combat", "actor", "either", "world"].includes(scope)) {
      throw new CommandBoundaryError(`Scope de command inválido: ${scope}.`);
    }
    if (!context.isPrimaryGM) {
      throw new CommandBoundaryError("Solo el Primary GM puede ejecutar commands autoritativos.");
    }
    if (!context.requestingUserId) {
      throw new CommandBoundaryError("No se pudo identificar al usuario solicitante.");
    }
    if (hasCombat && this.resolveCombat && !this.resolveCombat(envelope.combatId)) {
      throw new CommandBoundaryError(`Combat invalido o inexistente: ${envelope.combatId}`);
    }
    if (!hasCombat && hasActor && this.resolveActor && !this.resolveActor(envelope.actorId)) {
      throw new CommandBoundaryError(`Actor invalido o inexistente: ${envelope.actorId}`);
    }
  }

  async dispatch(envelope, context = {}) {
    const definition = this.handlers.get(envelope.command);
    this.validateEnvelope(envelope, context, definition);
    await definition.validate?.(envelope.payload ?? {}, context, envelope);

    const execute = async () => {
      const result = await definition.handler(
        envelope.payload ?? {},
        context,
        envelope
      );
      if (result === undefined) {
        const error = new CommandBoundaryError(`Command sin resultado explícito: ${envelope.command}.`);
        error.reasonCode = "COMMAND_RESULT_UNDEFINED";
        throw error;
      }
      return result;
    };

    this.logger?.debug?.("COMMAND", "dispatch", {
      command: envelope.command,
      transactionId: envelope.transactionId,
      combatId: envelope.combatId,
      userId: context.requestingUserId
    });
    this.observability?.record?.("command", envelope.command, {
      transactionId: envelope.transactionId,
      combatId: envelope.combatId ?? null,
      userId: context.requestingUserId ?? null
    });

    if (!definition.idempotent) return execute();
    if (!this.receiptStore) throw new Error("Command idempotente sin ReceiptStore.");
    const receiptTarget = typeof definition.receiptTarget === "function"
      ? await definition.receiptTarget(envelope.payload ?? {}, context, envelope)
      : definition.receiptTarget ?? envelope.combatId;
    const fingerprint = await createReceiptFingerprint(envelope.payload ?? {});
    return this.receiptStore.execute(receiptTarget, {
      transactionId: envelope.transactionId,
      command: envelope.command,
      fingerprint,
      pendingActionId: envelope.payload?.pendingActionId ?? envelope.payload?.pendingAction?.id ?? null
    }, execute);
  }
}
