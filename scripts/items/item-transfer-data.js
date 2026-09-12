import { MTROL_OBJECT_TYPES, MTROL_COMPETENCE_TYPES } from "./item-invariants.js";

const SUPPORTED_TYPES = [...MTROL_OBJECT_TYPES, ...MTROL_COMPETENCE_TYPES];
const DOCUMENT_FIELDS = ["_id", "id", "uuid", "parent", "actor", "ownership", "folder", "sort", "_stats"];

function validateItem(item) {
  if (!item || !SUPPORTED_TYPES.includes(item.type)) throw new TypeError("Tipo de Item no soportado.");
  if (!item.system || typeof item.system !== "object" || Array.isArray(item.system)) {
    throw new TypeError("El Item requiere system serializado.");
  }
}

/** Lossless source evidence. This is data preparation, not authorization or a write API. */
export function createItemTransferSnapshot(source) {
  const item = structuredClone(source?.toObject ? source.toObject() : source);
  validateItem(item);
  return { schemaVersion: 1, sourceUuid: source?.uuid ?? null, item };
}

/**
 * Prepare a new embedded Item. Original metadata remains in the snapshot.
 * Embedded effect IDs remain scoped to the new Item; opaque module references
 * are preserved, never guessed. Callers must review module-specific bindings.
 * destinationItemUuid must match the ID/parent used by the eventual creator.
 */
export function reconstructItemTransferData(snapshot, { quantity, destinationItemUuid = null } = {}) {
  if (snapshot?.schemaVersion !== 1) throw new TypeError("Schema de transferencia no soportado.");
  validateItem(snapshot.item);
  const data = structuredClone(snapshot.item);
  const changes = [];
  for (const field of DOCUMENT_FIELDS) {
    if (!Object.hasOwn(data, field)) continue;
    delete data[field];
    changes.push({ path: field, operation: "omit", reason: "destination-document-metadata" });
  }
  if (quantity !== undefined) {
    const original = data.system.cantidad;
    if (!Number.isSafeInteger(quantity) || quantity <= 0 ||
        !Number.isSafeInteger(original) || original <= 0 || quantity > original) {
      throw new RangeError("Cantidad de transferencia inválida para este Item.");
    }
    data.system.cantidad = quantity;
    changes.push({ path: "system.cantidad", operation: "replace", reason: "partial-transfer" });
  }
  for (const field of ["equipado", "equipadaCombate"]) {
    if (!Object.hasOwn(data.system, field)) continue;
    data.system[field] = false;
    changes.push({ path: `system.${field}`, operation: "replace", reason: "inactive-at-destination" });
  }
  for (const [index, effect] of (data.effects ?? []).entries()) {
    if (snapshot.sourceUuid && effect.origin === snapshot.sourceUuid) {
      if (typeof destinationItemUuid !== "string" || !destinationItemUuid.includes(".Item.") ||
          destinationItemUuid === snapshot.sourceUuid) {
        throw new TypeError("Se requiere destinationItemUuid nuevo para remapear effect.origin.");
      }
      effect.origin = destinationItemUuid;
      changes.push({ path: `effects.${index}.origin`, operation: "replace", reason: "self-reference" });
    }
    if (Object.hasOwn(effect, "_stats")) {
      delete effect._stats;
      changes.push({ path: `effects.${index}._stats`, operation: "omit", reason: "destination-document-metadata" });
    }
  }
  return { data, changes };
}
