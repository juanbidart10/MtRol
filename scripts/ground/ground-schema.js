import { reconstructItemTransferData } from "../items/item-transfer-data.js";

export const GROUND_SCHEMA_VERSION = 1;

export const GROUND_VISIBILITY = Object.freeze({
  INVISIBLE: "INVISIBLE",
  HIDDEN: "HIDDEN",
  REVEALED: "REVEALED"
});

export const GROUND_APPEARANCE_MODE = Object.freeze({
  REAL: "REAL",
  GENERIC: "GENERIC"
});

export const GROUND_LIFECYCLE = Object.freeze({
  PENDING: "PENDING",
  ACTIVE: "ACTIVE",
  PICKUP_PENDING: "PICKUP_PENDING",
  RECOVERY_REQUIRED: "RECOVERY_REQUIRED",
  TOMBSTONED: "TOMBSTONED"
});

const PUBLIC_FIELDS = Object.freeze([
  "schemaVersion", "groundId", "sceneId", "position", "visibility", "pickupEnabled", "appearance"
]);
const AUTHORITY_FIELDS = Object.freeze([
  "schemaVersion", "groundId", "sceneId", "lifecycle", "position", "visibility", "pickupEnabled", "appearance",
  "quantity", "itemSnapshot", "provenance", "recoveryEvidence"
]);
const POSITION_FIELDS = Object.freeze(["x", "y"]);
const APPEARANCE_FIELDS = Object.freeze(["mode", "img"]);
const PROVENANCE_FIELDS = Object.freeze([
  "sourceActorUuid", "sourceItemUuid", "createdBy", "createdAt", "operationId"
]);
const RECOVERY_FIELDS = Object.freeze(["transactionId", "checkpoints", "reasonCode"]);

const TRANSITIONS = Object.freeze({
  [GROUND_LIFECYCLE.PENDING]: new Set([
    GROUND_LIFECYCLE.ACTIVE,
    GROUND_LIFECYCLE.RECOVERY_REQUIRED,
    GROUND_LIFECYCLE.TOMBSTONED
  ]),
  [GROUND_LIFECYCLE.ACTIVE]: new Set([
    GROUND_LIFECYCLE.PICKUP_PENDING,
    GROUND_LIFECYCLE.RECOVERY_REQUIRED,
    GROUND_LIFECYCLE.TOMBSTONED
  ]),
  [GROUND_LIFECYCLE.PICKUP_PENDING]: new Set([
    GROUND_LIFECYCLE.ACTIVE,
    GROUND_LIFECYCLE.RECOVERY_REQUIRED,
    GROUND_LIFECYCLE.TOMBSTONED
  ]),
  [GROUND_LIFECYCLE.RECOVERY_REQUIRED]: new Set([
    GROUND_LIFECYCLE.PENDING,
    GROUND_LIFECYCLE.ACTIVE,
    GROUND_LIFECYCLE.PICKUP_PENDING,
    GROUND_LIFECYCLE.TOMBSTONED
  ]),
  [GROUND_LIFECYCLE.TOMBSTONED]: new Set()
});

export class GroundSchemaError extends TypeError {
  constructor(message, { path = null } = {}) {
    super(message);
    this.name = "GroundSchemaError";
    this.path = path;
  }
}

function clone(value) {
  if (globalThis.foundry?.utils?.deepClone) return foundry.utils.deepClone(value);
  return value === undefined ? undefined : structuredClone(value);
}

function plainObject(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GroundSchemaError(`${path} debe ser un objeto.`, { path });
  }
  return value;
}

function rejectUnknown(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new GroundSchemaError(`Campo desconocido ${path}.${key}.`, { path: `${path}.${key}` });
    }
  }
}

function requireExactFields(value, fields, path) {
  rejectUnknown(value, fields, path);
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) {
      throw new GroundSchemaError(`Falta ${path}.${field}.`, { path: `${path}.${field}` });
    }
  }
}

function requireString(value, path, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new GroundSchemaError(`${path} debe ser un string no vacío.`, { path });
  }
  return value;
}

function validateSchemaVersion(value, path) {
  if (value !== GROUND_SCHEMA_VERSION) {
    throw new GroundSchemaError(`Schema Ground no soportado en ${path}: ${value}.`, { path });
  }
}

function validatePosition(value, path = "position") {
  plainObject(value, path);
  requireExactFields(value, POSITION_FIELDS, path);
  for (const axis of POSITION_FIELDS) {
    if (typeof value[axis] !== "number" || !Number.isFinite(value[axis])) {
      throw new GroundSchemaError(`${path}.${axis} debe ser numérico finito.`, { path: `${path}.${axis}` });
    }
  }
  return clone(value);
}

function validateAppearance(value, path = "appearance") {
  plainObject(value, path);
  requireExactFields(value, APPEARANCE_FIELDS, path);
  if (!Object.values(GROUND_APPEARANCE_MODE).includes(value.mode)) {
    throw new GroundSchemaError(`${path}.mode inválido.`, { path: `${path}.mode` });
  }
  requireString(value.img, `${path}.img`);
  return clone(value);
}

function validateVisibility(value, path = "visibility") {
  if (!Object.values(GROUND_VISIBILITY).includes(value)) {
    throw new GroundSchemaError(`${path} inválida.`, { path });
  }
  return value;
}

function validateGroundId(value, path = "groundId") {
  if (typeof value !== "string" || !/^ground:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16,64}$/.test(value)) {
    throw new GroundSchemaError(`${path} inválido.`, { path });
  }
  return value;
}

function validateSceneId(value, path = "sceneId") {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new GroundSchemaError(`${path} inválido.`, { path });
  }
  return value;
}

function validateProvenance(value) {
  plainObject(value, "provenance");
  requireExactFields(value, PROVENANCE_FIELDS, "provenance");
  for (const field of ["sourceActorUuid", "sourceItemUuid", "createdBy", "operationId"]) {
    requireString(value[field], `provenance.${field}`);
  }
  if (!Number.isSafeInteger(value.createdAt) || value.createdAt < 0) {
    throw new GroundSchemaError("provenance.createdAt debe ser un entero no negativo.", {
      path: "provenance.createdAt"
    });
  }
  return clone(value);
}

function validateRecoveryEvidence(value) {
  plainObject(value, "recoveryEvidence");
  requireExactFields(value, RECOVERY_FIELDS, "recoveryEvidence");
  requireString(value.transactionId, "recoveryEvidence.transactionId", { nullable: true });
  requireString(value.reasonCode, "recoveryEvidence.reasonCode", { nullable: true });
  if (!Array.isArray(value.checkpoints) || value.checkpoints.some(checkpoint =>
    typeof checkpoint !== "string" || !checkpoint.trim())) {
    throw new GroundSchemaError("recoveryEvidence.checkpoints debe contener strings no vacíos.", {
      path: "recoveryEvidence.checkpoints"
    });
  }
  return clone(value);
}

function validateSnapshot(snapshot, quantity) {
  plainObject(snapshot, "itemSnapshot");
  const originalQuantity = snapshot.item?.system?.cantidad;
  const reconstructionOptions = {
    destinationItemUuid: "Actor.groundValidation.Item.groundValidationItem"
  };
  if (Object.hasOwn(snapshot.item?.system ?? {}, "cantidad")) reconstructionOptions.quantity = quantity;
  else if (quantity !== 1) {
    throw new GroundSchemaError("quantity debe ser 1 para un Item sin cantidad.", { path: "quantity" });
  }
  try {
    reconstructItemTransferData(clone(snapshot), reconstructionOptions);
  } catch (error) {
    throw new GroundSchemaError(`itemSnapshot Universal inválido: ${error.message}`, { path: "itemSnapshot" });
  }
  if (originalQuantity !== undefined && quantity > originalQuantity) {
    throw new GroundSchemaError("quantity excede la cantidad del snapshot.", { path: "quantity" });
  }
  return clone(snapshot);
}

export function createGroundId({ worldId = globalThis.game?.world?.id, idGenerator = null } = {}) {
  validateSceneId(worldId, "worldId");
  const generate = idGenerator ?? globalThis.foundry?.utils?.randomID;
  const opaque = generate?.(24) ?? globalThis.crypto?.randomUUID?.().replaceAll("-", "");
  if (typeof opaque !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(opaque)) {
    throw new GroundSchemaError("No se pudo generar un ID Ground opaco válido.", { path: "groundId" });
  }
  return `ground:${worldId}:${opaque}`;
}

export function validateGroundPublicProjection(value) {
  const source = clone(plainObject(value, "publicProjection"));
  requireExactFields(source, PUBLIC_FIELDS, "publicProjection");
  validateSchemaVersion(source.schemaVersion, "publicProjection.schemaVersion");
  validateGroundId(source.groundId, "publicProjection.groundId");
  validateSceneId(source.sceneId, "publicProjection.sceneId");
  source.position = validatePosition(source.position, "publicProjection.position");
  source.visibility = validateVisibility(source.visibility, "publicProjection.visibility");
  if (typeof source.pickupEnabled !== "boolean") {
    throw new GroundSchemaError("publicProjection.pickupEnabled debe ser boolean.", {
      path: "publicProjection.pickupEnabled"
    });
  }
  source.appearance = validateAppearance(source.appearance, "publicProjection.appearance");
  return source;
}

export function createGroundPublicProjection(value) {
  return validateGroundPublicProjection(value);
}

export function validateGroundAuthorityRecord(value) {
  const source = clone(plainObject(value, "authorityRecord"));
  requireExactFields(source, AUTHORITY_FIELDS, "authorityRecord");
  validateSchemaVersion(source.schemaVersion, "authorityRecord.schemaVersion");
  validateGroundId(source.groundId, "authorityRecord.groundId");
  validateSceneId(source.sceneId, "authorityRecord.sceneId");
  if (!Object.values(GROUND_LIFECYCLE).includes(source.lifecycle)) {
    throw new GroundSchemaError("authorityRecord.lifecycle inválido.", { path: "authorityRecord.lifecycle" });
  }
  source.position = validatePosition(source.position, "authorityRecord.position");
  source.visibility = validateVisibility(source.visibility, "authorityRecord.visibility");
  if (typeof source.pickupEnabled !== "boolean") {
    throw new GroundSchemaError("authorityRecord.pickupEnabled debe ser boolean.", {
      path: "authorityRecord.pickupEnabled"
    });
  }
  source.appearance = validateAppearance(source.appearance, "authorityRecord.appearance");
  if (!Number.isSafeInteger(source.quantity) || source.quantity < 1) {
    throw new GroundSchemaError("authorityRecord.quantity debe ser un entero >= 1.", {
      path: "authorityRecord.quantity"
    });
  }
  source.itemSnapshot = validateSnapshot(source.itemSnapshot, source.quantity);
  source.provenance = validateProvenance(source.provenance);
  source.recoveryEvidence = validateRecoveryEvidence(source.recoveryEvidence);
  return source;
}

export function createGroundAuthorityRecord(value) {
  return validateGroundAuthorityRecord(value);
}

export function projectGroundPublicState(authorityRecord) {
  const authority = validateGroundAuthorityRecord(authorityRecord);
  return validateGroundPublicProjection({
    schemaVersion: authority.schemaVersion,
    groundId: authority.groundId,
    sceneId: authority.sceneId,
    position: authority.position,
    visibility: authority.visibility,
    pickupEnabled: authority.pickupEnabled,
    appearance: authority.appearance
  });
}

export function assertGroundLifecycleTransition(from, to) {
  if (!Object.values(GROUND_LIFECYCLE).includes(from) || !Object.values(GROUND_LIFECYCLE).includes(to)) {
    throw new GroundSchemaError("Lifecycle Ground inválido.", { path: "lifecycle" });
  }
  if (from === to) return true;
  if (!TRANSITIONS[from].has(to)) {
    throw new GroundSchemaError(`Transición Ground inválida: ${from} -> ${to}.`, { path: "lifecycle" });
  }
  return true;
}

function same(valueA, valueB) {
  if (Object.is(valueA, valueB)) return true;
  if (!valueA || !valueB || typeof valueA !== "object" || typeof valueB !== "object") return false;
  if (Array.isArray(valueA) || Array.isArray(valueB)) {
    return Array.isArray(valueA) && Array.isArray(valueB) && valueA.length === valueB.length &&
      valueA.every((entry, index) => same(entry, valueB[index]));
  }
  const keysA = Object.keys(valueA).sort();
  const keysB = Object.keys(valueB).sort();
  return keysA.length === keysB.length && keysA.every((key, index) =>
    key === keysB[index] && same(valueA[key], valueB[key]));
}

export function detectGroundPairState(publicProjection, authorityRecord) {
  if (!publicProjection && !authorityRecord) return { status: "ABSENT", issues: [] };
  const publicValue = publicProjection ? validateGroundPublicProjection(publicProjection) : null;
  const authorityValue = authorityRecord ? validateGroundAuthorityRecord(authorityRecord) : null;
  if (!authorityValue) return { status: "PUBLIC_ONLY", issues: ["missing-authority"] };
  if (!publicValue) return { status: "AUTHORITY_ONLY", issues: ["missing-public"] };
  const issues = [];
  if (publicValue.groundId !== authorityValue.groundId) issues.push("ground-id-mismatch");
  if (publicValue.sceneId !== authorityValue.sceneId) issues.push("scene-id-mismatch");
  for (const field of ["position", "visibility", "pickupEnabled", "appearance"]) {
    if (!same(publicValue[field], authorityValue[field])) issues.push(`${field}-mismatch`);
  }
  return { status: issues.length ? "MISMATCHED" : "MATCHED", issues };
}

export function cloneGroundValue(value) {
  return clone(value);
}
