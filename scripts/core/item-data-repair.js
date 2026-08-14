import {
  auditWorldItems
} from "./world-item-audit.js";

import {
  analyzeItemQuantity,
  analyzeItemWeight,
  getEquipmentState,
  getSerializedSystemInfo,
  hasOwnField,
  isMtrolObject,
  normalizeEquippedFlag,
  parseMtrolNumber,
  toDocumentArray
} from "../items/item-invariants.js";

export const MTROL_ITEM_DATA_REPAIR_MIGRATION_ID =
  "mtrol-item-data-repair-v1";

export const MTROL_ITEM_DATA_REPAIR_MIGRATION_VERSION = 1;

const SERIALIZED_TYPE_KEY = "__mtrolSerializedType";
const WRITE_CATEGORIES = new Set([
  "sync-equipped-false",
  "sync-equipped-true",
  "sync-declared-slot",
  "clear-broken-slot-reference",
  "normalize-weight-string",
  "migrate-legacy-weight",
  "normalize-quantity-string"
]);

function compareText(left, right) {
  const a = String(left ?? "");
  const b = String(right ?? "");
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function serializeValue(value, seen = new WeakSet()) {
  if (value === undefined) {
    return { [SERIALIZED_TYPE_KEY]: "undefined" };
  }

  if (typeof value === "number" && !Number.isFinite(value)) {
    return {
      [SERIALIZED_TYPE_KEY]: "non-finite-number",
      value: String(value)
    };
  }

  if (typeof value === "bigint") {
    return {
      [SERIALIZED_TYPE_KEY]: "bigint",
      value: String(value)
    };
  }

  if (typeof value === "function" || typeof value === "symbol") {
    return {
      [SERIALIZED_TYPE_KEY]: typeof value,
      value: String(value)
    };
  }

  if (value === null || typeof value !== "object") return value;

  if (value instanceof Date) {
    return {
      [SERIALIZED_TYPE_KEY]: "date",
      value: value.toISOString()
    };
  }

  if (seen.has(value)) {
    return { [SERIALIZED_TYPE_KEY]: "circular-reference" };
  }

  seen.add(value);

  if (Array.isArray(value)) {
    const result = value.map(entry => serializeValue(entry, seen));
    seen.delete(value);
    return result;
  }

  if (value instanceof Map) {
    const result = {
      [SERIALIZED_TYPE_KEY]: "map",
      entries: [...value.entries()].map(([key, entry]) => [
        serializeValue(key, seen),
        serializeValue(entry, seen)
      ])
    };
    seen.delete(value);
    return result;
  }

  if (value instanceof Set) {
    const result = {
      [SERIALIZED_TYPE_KEY]: "set",
      values: [...value].map(entry => serializeValue(entry, seen))
    };
    seen.delete(value);
    return result;
  }

  const result = {};
  for (const key of Object.keys(value).sort(compareText)) {
    result[key] = serializeValue(value[key], seen);
  }
  seen.delete(value);
  return result;
}

function deserializeValue(value) {
  if (Array.isArray(value)) return value.map(deserializeValue);
  if (!value || typeof value !== "object") return value;

  const type = value[SERIALIZED_TYPE_KEY];
  if (type === "undefined") return undefined;
  if (type === "non-finite-number") return Number(value.value);
  if (type === "bigint") return BigInt(value.value);
  if (type === "date") return new Date(value.value);
  if (type === "map") {
    return new Map(value.entries.map(([key, entry]) => [
      deserializeValue(key),
      deserializeValue(entry)
    ]));
  }
  if (type === "set") return new Set(value.values.map(deserializeValue));
  if (type) return undefined;

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, deserializeValue(entry)])
  );
}

function stableStringify(value) {
  return JSON.stringify(serializeValue(value));
}

function checksum(value) {
  const text = stableStringify(value);
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function valueState(value, exists) {
  if (!exists) return "absent";
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (value === "") return "empty-string";
  if (value === 0) return "number-zero";
  if (value === "0") return "string-zero";
  if (typeof value === "number") {
    return Number.isFinite(value) ? "number" : "invalid-number";
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return value.trim() && Number.isFinite(parsed)
      ? "numeric-string"
      : "string";
  }
  return typeof value;
}

function captureProperty(container, key, source = "materialized") {
  const exists = hasOwnField(container, key);
  const value = exists ? container[key] : undefined;

  return {
    exists,
    state: valueState(value, exists),
    value: serializeValue(value),
    source
  };
}

function captureLiteral(value) {
  return {
    exists: true,
    state: valueState(value, true),
    value: serializeValue(value),
    source: "proposed"
  };
}

function safeToObject(document) {
  let toObjectError = null;

  try {
    if (typeof document?.toObject === "function") {
      return {
        available: true,
        origin: "toObject",
        data: serializeValue(document.toObject())
      };
    }
  } catch (error) {
    toObjectError = error?.message ?? String(error);
  }

  if (document?._source && typeof document._source === "object") {
    return {
      available: true,
      origin: toObjectError ? "_source-after-toObject-error" : "_source",
      data: serializeValue(document._source),
      error: toObjectError
    };
  }

  return {
    available: false,
    origin: "materialized-fallback",
    data: serializeValue({
      _id: document?.id ?? null,
      name: document?.name ?? null,
      type: document?.type ?? null,
      img: document?.img ?? null,
      system: document?.system ?? {}
    }),
    error: toObjectError
  };
}

function getActorSourceSystem(actor) {
  if (actor?._source?.system && typeof actor._source.system === "object") {
    return {
      available: true,
      origin: "actor._source.system",
      system: actor._source.system
    };
  }

  return {
    available: false,
    origin: "actor.system",
    system: actor?.system ?? {}
  };
}

function captureItemField(item, key) {
  const serialized = getSerializedSystemInfo(item);
  const source = serialized.available
    ? captureProperty(serialized.system, key, serialized.origin)
    : captureProperty(item?.system, key, "materialized-indeterminate");

  return {
    ...source,
    materialized: captureProperty(item?.system, key, "item.system"),
    persistenceDemonstrated: serialized.available
  };
}

function captureActorEquipmentField(actor, slot) {
  const source = getActorSourceSystem(actor);
  const sourceEquipment = source.system?.equipamiento;
  const materializedEquipment = actor?.system?.equipamiento;

  return {
    ...captureProperty(sourceEquipment, slot, source.origin),
    materialized: captureProperty(materializedEquipment, slot, "actor.system.equipamiento"),
    persistenceDemonstrated: source.available
  };
}

function actorMetadata(actor, context) {
  return {
    id: actor?.id ?? null,
    uuid: actor?.uuid ?? null,
    name: actor?.name ?? "(sin nombre)",
    type: actor?.type ?? null,
    worldActor: context.synthetic !== true,
    synthetic: context.synthetic === true,
    writeEligible: context.synthetic !== true,
    token: context.token
      ? {
          id: context.token.id ?? null,
          uuid: context.token.uuid ?? null,
          name: context.token.name ?? null,
          actorLink: context.token.actorLink === true || context.token.isLinked === true
        }
      : null,
    scene: context.scene
      ? {
          id: context.scene.id ?? null,
          uuid: context.scene.uuid ?? null,
          name: context.scene.name ?? null
        }
      : null
  };
}

function itemMetadata(item) {
  return {
    id: item?.id ?? null,
    uuid: item?.uuid ?? null,
    name: item?.name ?? "(sin nombre)",
    type: item?.type ?? null
  };
}

function createBackupItem(item, actorInfo) {
  const source = safeToObject(item);
  const fields = {};

  for (const key of ["equipado", "slot", "peso", "slots", "cantidad"]) {
    fields[key] = captureItemField(item, key);
  }

  return {
    backupEntryId: `item:${actorInfo.uuid ?? actorInfo.id}:${item?.id ?? "unknown"}`,
    actorId: actorInfo.id,
    actorUuid: actorInfo.uuid,
    ...itemMetadata(item),
    sourceDataAvailable: source.available,
    sourceDataOrigin: source.origin,
    sourceData: source.data,
    sourceDataError: source.error ?? null,
    materializedSystem: serializeValue(item?.system ?? {}),
    fields
  };
}

function createBackupActor(actor, context) {
  const info = actorMetadata(actor, context);
  const source = safeToObject(actor);
  const actorSource = getActorSourceSystem(actor);
  const equipment = actorSource.system?.equipamiento ?? actor?.system?.equipamiento ?? {};

  return {
    backupEntryId: `actor:${info.uuid ?? info.id}`,
    ...info,
    sourceDataAvailable: source.available,
    sourceDataOrigin: source.origin,
    sourceData: source.data,
    sourceDataError: source.error ?? null,
    equipment: serializeValue(equipment),
    equipmentFields: Object.fromEntries(
      getEquipmentState(actor).entries.map(entry => [
        entry.slot,
        captureActorEquipmentField(actor, entry.slot)
      ])
    ),
    items: toDocumentArray(actor?.items)
      .filter(isMtrolObject)
      .map(item => createBackupItem(item, info))
      .sort((left, right) => compareText(left.uuid ?? left.id, right.uuid ?? right.id))
  };
}

function getCollectionDocument(collection, id) {
  return collection?.get?.(id) ??
    toDocumentArray(collection).find(document => document?.id === id) ??
    null;
}

function collectActorContexts(auditReport) {
  const contexts = [];

  for (const report of auditReport.actors) {
    if (!report.actor.synthetic) {
      const actor = getCollectionDocument(globalThis.game?.actors, report.actor.id);
      contexts.push({ report, actor, context: { synthetic: false, token: null, scene: null } });
      continue;
    }

    const scene = getCollectionDocument(globalThis.game?.scenes, report.actor.scene?.id);
    const token = getCollectionDocument(scene?.tokens, report.actor.token?.id);
    contexts.push({
      report,
      actor: token?.actor ?? null,
      context: { synthetic: true, token: token ?? null, scene: scene ?? null }
    });
  }

  return contexts;
}

function collectLinkedTokens() {
  const result = [];

  for (const scene of toDocumentArray(globalThis.game?.scenes)) {
    if (scene?.pack || scene?.compendium) continue;

    for (const token of toDocumentArray(scene?.tokens)) {
      if (token?.actorLink !== true && token?.isLinked !== true) continue;

      result.push({
        sceneId: scene?.id ?? null,
        sceneUuid: scene?.uuid ?? null,
        tokenId: token?.id ?? null,
        tokenUuid: token?.uuid ?? null,
        actorId: token?.actorId ?? token?.actor?.id ?? null,
        actorUuid: token?.actor?.uuid ?? null,
        classification: "linked-token-inherits-world-actor",
        separateRepairRequired: false,
        modified: false
      });
    }
  }

  return result.sort((left, right) => compareText(left.tokenUuid, right.tokenUuid));
}

function collectExcludedCompendiums() {
  const discovered = [];

  for (const pack of toDocumentArray(globalThis.game?.packs)) {
    discovered.push({
      collection: pack?.collection ?? pack?.metadata?.id ?? null,
      label: pack?.metadata?.label ?? pack?.title ?? null,
      documentName: pack?.documentName ?? pack?.metadata?.type ?? null,
      opened: false,
      modified: false,
      reason: "Compendio excluido por la politica de solo lectura de Etapa 5A."
    });
  }

  for (const actor of toDocumentArray(globalThis.game?.actors)) {
    if (!actor?.pack && !actor?.compendium) continue;
    const collection = actor.pack ?? actor.compendium?.collection ?? null;
    if (discovered.some(entry => entry.collection === collection)) continue;
    discovered.push({
      collection,
      label: null,
      documentName: "Actor",
      opened: false,
      modified: false,
      reason: "Documento de compendio excluido sin abrir ni modificar el pack."
    });
  }

  return discovered.sort((left, right) => compareText(left.collection, right.collection));
}

function operationId(actorInfo, item, category, field) {
  return [
    MTROL_ITEM_DATA_REPAIR_MIGRATION_ID,
    actorInfo.uuid ?? actorInfo.id ?? "actor",
    item?.id ?? "actor",
    category,
    field
  ].join(":");
}

function createOperation({
  actorInfo,
  item = null,
  category,
  reason,
  before,
  after,
  field,
  writeTarget,
  repairEligible = actorInfo.writeEligible,
  confidence = "high",
  backupEntryId
}) {
  return {
    operationId: operationId(actorInfo, item, category, field),
    actorId: actorInfo.id,
    actorUuid: actorInfo.uuid,
    itemId: item?.id ?? null,
    itemUuid: item?.uuid ?? null,
    category,
    reason,
    confidence,
    deterministic: true,
    before,
    after,
    fieldsChanged: [field],
    writeTarget,
    repairEligible: repairEligible === true,
    backupEntryId
  };
}

function createConflict({
  actorInfo,
  item = null,
  category,
  reason,
  details = null
}) {
  return {
    conflictId: [
      MTROL_ITEM_DATA_REPAIR_MIGRATION_ID,
      actorInfo.uuid ?? actorInfo.id ?? "actor",
      item?.id ?? "actor",
      category
    ].join(":"),
    actorId: actorInfo.id,
    actorUuid: actorInfo.uuid,
    itemId: item?.id ?? null,
    itemUuid: item?.uuid ?? null,
    category,
    reason,
    confidence: "manual-review-required",
    deterministic: false,
    repairEligible: false,
    details: serializeValue(details)
  };
}

function slotCompatibleWithCurrentRules(item, slot, validSlots) {
  // El motor vigente exige objeto MTROL, marca equipable y slot valido;
  // no existe actualmente una matriz tipo-de-objeto -> slot mas restrictiva.
  return isMtrolObject(item) && !!item?.system?.equipable && validSlots.has(slot);
}

function planEquipment(actor, context, backupActor, operations, conflicts) {
  const actorInfo = actorMetadata(actor, context);
  const state = getEquipmentState(actor);
  const validSlots = new Set(state.entries.map(entry => entry.slot));
  const backupByItem = new Map(backupActor.items.map(entry => [entry.id, entry]));

  for (const item of toDocumentArray(actor?.items).filter(isMtrolObject)) {
    const references = [...(state.referencesByItem.get(item.id) ?? [])];
    const backupItem = backupByItem.get(item.id);

    if (references.length > 1) {
      conflicts.push(createConflict({
        actorInfo,
        item,
        category: "multiple-slot-references",
        reason: "El mismo item esta referenciado por varios slots; no se infiere cual es el correcto.",
        details: { references, declaredSlot: item.system?.slot ?? null }
      }));
      continue;
    }

    if (references.length === 0) {
      if (normalizeEquippedFlag(item.system?.equipado)) {
        operations.push(createOperation({
          actorInfo,
          item,
          category: "sync-equipped-false",
          reason: "El item no esta referenciado por ningun slot valido y conserva el flag legacy activo.",
          before: captureItemField(item, "equipado"),
          after: captureLiteral(false),
          field: "system.equipado",
          writeTarget: "Item",
          backupEntryId: backupItem?.backupEntryId ?? null
        }));
      }
      continue;
    }

    const [referencedSlot] = references;

    if (item.system?.equipado !== true) {
      operations.push(createOperation({
        actorInfo,
        item,
        category: "sync-equipped-true",
        reason: "Un unico slot valido referencia al item y el flag legacy no es el booleano true.",
        before: captureItemField(item, "equipado"),
        after: captureLiteral(true),
        field: "system.equipado",
        writeTarget: "Item",
        backupEntryId: backupItem?.backupEntryId ?? null
      }));
    }

    if (item.system?.slot !== referencedSlot) {
      if (slotCompatibleWithCurrentRules(item, referencedSlot, validSlots)) {
        operations.push(createOperation({
          actorInfo,
          item,
          category: "sync-declared-slot",
          reason: "La referencia unica del actor permite sincronizar el slot legacy sin inferir intencion.",
          before: captureItemField(item, "slot"),
          after: captureLiteral(referencedSlot),
          field: "system.slot",
          writeTarget: "Item",
          backupEntryId: backupItem?.backupEntryId ?? null
        }));
      } else {
        conflicts.push(createConflict({
          actorInfo,
          item,
          category: "incompatible-referenced-slot",
          reason: "El slot referenciado no es compatible con las reglas actuales del objeto.",
          details: { referencedSlot, declaredSlot: item.system?.slot ?? null }
        }));
      }
    }
  }

  for (const entry of state.entries.filter(candidate => candidate.broken)) {
    const before = captureActorEquipmentField(actor, entry.slot);

    if (
      before.persistenceDemonstrated &&
      before.exists &&
      deserializeValue(before.value) === entry.reference
    ) {
      operations.push(createOperation({
        actorInfo,
        category: "clear-broken-slot-reference",
        reason: "El slot contiene un ID persistido que no corresponde a ningun item disponible del actor; no se propone reemplazo.",
        before,
        after: captureLiteral(""),
        field: `system.equipamiento.${entry.slot}`,
        writeTarget: "Actor",
        backupEntryId: backupActor.backupEntryId
      }));
    } else {
      conflicts.push(createConflict({
        actorInfo,
        category: "broken-reference-origin-indeterminate",
        reason: "La referencia rota materializada no coincide con una referencia persistida demostrable.",
        details: { slot: entry.slot, reference: entry.reference, before }
      }));
    }
  }
}

function planWeightAndQuantity(actor, context, backupActor, operations, conflicts, warnings) {
  const actorInfo = actorMetadata(actor, context);
  const backupByItem = new Map(backupActor.items.map(entry => [entry.id, entry]));

  for (const item of toDocumentArray(actor?.items).filter(isMtrolObject)) {
    const backupItem = backupByItem.get(item.id);
    const weight = analyzeItemWeight(item);
    const quantity = analyzeItemQuantity(item);
    const serialized = getSerializedSystemInfo(item);
    const sourceSystem = serialized.system;
    const sourceHasWeight = serialized.available && hasOwnField(sourceSystem, "peso");
    const sourceWeight = sourceHasWeight ? sourceSystem.peso : undefined;

    if (weight.indeterminateLegacy) {
      conflicts.push(createConflict({
        actorInfo,
        item,
        category: "indeterminate-weight-origin",
        reason: "No puede demostrarse si system.peso fue persistido o materializado por el DataModel.",
        details: weight
      }));
    } else if (weight.invalid) {
      const rawWeight = sourceHasWeight ? sourceWeight : item?.system?.peso;
      const parsedRawWeight = parseMtrolNumber(rawWeight, { minimum: 0 });
      conflicts.push(createConflict({
        actorInfo,
        item,
        category: parsedRawWeight.reason === "below-minimum"
          ? "negative-weight"
          : "invalid-weight",
        reason: "El peso moderno invalido no se normaliza ni utiliza system.slots como reemplazo.",
        details: weight
      }));
    } else if (sourceHasWeight && typeof sourceWeight === "string") {
      const parsed = parseMtrolNumber(sourceWeight, { minimum: 0 });
      if (parsed.valid) {
        operations.push(createOperation({
          actorInfo,
          item,
          category: "normalize-weight-string",
          reason: "system.peso es una cadena numerica finita y no negativa.",
          before: captureItemField(item, "peso"),
          after: captureLiteral(parsed.value),
          field: "system.peso",
          writeTarget: "Item",
          backupEntryId: backupItem?.backupEntryId ?? null
        }));
      }
    } else if (weight.migratableLegacy) {
      operations.push(createOperation({
        actorInfo,
        item,
        category: "migrate-legacy-weight",
        reason: "system.peso esta demostrablemente ausente y system.slots es numerico, finito y no negativo.",
        before: captureItemField(item, "peso"),
        after: captureLiteral(weight.expectedUnitWeight),
        field: "system.peso",
        writeTarget: "Item",
        backupEntryId: backupItem?.backupEntryId ?? null
      }));
    }

    const sourceHasQuantity = serialized.available && hasOwnField(sourceSystem, "cantidad");
    const sourceQuantity = sourceHasQuantity ? sourceSystem.cantidad : undefined;

    if (sourceHasQuantity && typeof sourceQuantity === "string") {
      const parsed = parseMtrolNumber(sourceQuantity, { minimum: 0 });
      if (parsed.valid) {
        operations.push(createOperation({
          actorInfo,
          item,
          category: "normalize-quantity-string",
          reason: "system.cantidad es una cadena numerica inequívoca, finita y no negativa.",
          before: captureItemField(item, "cantidad"),
          after: captureLiteral(parsed.value),
          field: "system.cantidad",
          writeTarget: "Item",
          backupEntryId: backupItem?.backupEntryId ?? null
        }));
      } else {
        conflicts.push(createConflict({
          actorInfo,
          item,
          category: parsed.reason === "below-minimum" ? "negative-quantity" : "invalid-quantity",
          reason: "La cantidad no es una cadena numerica no negativa valida.",
          details: quantity
        }));
      }
    } else if (sourceHasQuantity && typeof sourceQuantity === "number" && sourceQuantity < 0) {
      conflicts.push(createConflict({
        actorInfo,
        item,
        category: "negative-quantity",
        reason: "La cantidad negativa requiere decision manual.",
        details: quantity
      }));
    } else if (sourceHasQuantity && !quantity.valid) {
      conflicts.push(createConflict({
        actorInfo,
        item,
        category: "invalid-quantity",
        reason: "La cantidad nula, vacia o invalida requiere decision manual.",
        details: quantity
      }));
    } else if (!sourceHasQuantity) {
      warnings.push({
        actorId: actorInfo.id,
        actorUuid: actorInfo.uuid,
        itemId: item.id ?? null,
        itemUuid: item.uuid ?? null,
        category: serialized.available
          ? "quantity-absent-no-repair"
          : "quantity-origin-indeterminate-no-repair",
        message: serialized.available
          ? "system.cantidad esta ausente; no se propone persistir un valor por defecto."
          : "No puede demostrarse la representacion persistida de system.cantidad; no se propone reparacion."
      });
    }
  }
}

function addAuditConflicts(auditReport, conflicts) {
  for (const candidate of auditReport.possibleDuplicates ?? []) {
    conflicts.push({
      conflictId: `${MTROL_ITEM_DATA_REPAIR_MIGRATION_ID}:${candidate.actorUuid}:similar-documents:${candidate.itemIds.join("+")}`,
      actorId: null,
      actorUuid: candidate.actorUuid,
      itemId: null,
      itemUuid: null,
      category: "similar-document-candidate",
      reason: "La similitud no demuestra duplicacion; no se fusiona, elimina ni modifica cantidad.",
      confidence: "insufficient-evidence",
      deterministic: false,
      repairEligible: false,
      details: serializeValue(candidate)
    });
  }
}

function enforceSyntheticIneligibility(operations, conflicts, backup) {
  const syntheticActorKeys = new Set(
    backup.actors
      .filter(actor => actor.synthetic)
      .map(actor => actor.uuid ?? actor.id)
  );

  for (const operation of operations.filter(entry =>
    syntheticActorKeys.has(entry.actorUuid ?? entry.actorId)
  )) {
    operation.repairEligible = false;
    conflicts.push({
      conflictId: `${operation.operationId}:synthetic-not-write-eligible`,
      actorId: operation.actorId,
      actorUuid: operation.actorUuid,
      itemId: operation.itemId,
      itemUuid: operation.itemUuid,
      category: "synthetic-actor-write-not-authorized",
      reason: "La reparacion requerida pertenece a un actor sintetico no vinculado y no es elegible para escritura.",
      confidence: "high",
      deterministic: true,
      repairEligible: false,
      details: { operationId: operation.operationId }
    });
  }
}

function buildBackup(actorContexts, metadata) {
  const actors = actorContexts
    .filter(entry => entry.actor)
    .map(entry => createBackupActor(entry.actor, entry.context))
    .sort((left, right) => compareText(left.uuid ?? left.id, right.uuid ?? right.id));
  const content = {
    migrationId: MTROL_ITEM_DATA_REPAIR_MIGRATION_ID,
    migrationVersion: MTROL_ITEM_DATA_REPAIR_MIGRATION_VERSION,
    worldId: metadata.worldId,
    actors
  };
  const contentChecksum = checksum(content);
  const complete = actors.every(actor =>
    actor.sourceDataAvailable && actor.items.every(item => item.sourceDataAvailable)
  );

  return {
    backupId: `${MTROL_ITEM_DATA_REPAIR_MIGRATION_ID}:${contentChecksum}`,
    migrationId: MTROL_ITEM_DATA_REPAIR_MIGRATION_ID,
    migrationVersion: MTROL_ITEM_DATA_REPAIR_MIGRATION_VERSION,
    createdAt: metadata.startedAt,
    worldId: metadata.worldId,
    readOnly: true,
    persistedToWorld: false,
    complete,
    checksumAlgorithm: "FNV-1a-32",
    checksum: contentChecksum,
    actors
  };
}

function enforceBackupEligibility(operations, backup, conflicts) {
  const actors = new Map(backup.actors.map(actor => [actor.uuid ?? actor.id, actor]));

  for (const operation of operations) {
    const backupActor = actors.get(operation.actorUuid ?? operation.actorId);
    const backupEntry = operation.writeTarget === "Actor"
      ? backupActor
      : backupActor?.items.find(item => item.id === operation.itemId);

    if (backupEntry?.sourceDataAvailable) continue;

    operation.repairEligible = false;
    conflicts.push({
      conflictId: `${operation.operationId}:incomplete-backup`,
      actorId: operation.actorId,
      actorUuid: operation.actorUuid,
      itemId: operation.itemId,
      itemUuid: operation.itemUuid,
      category: "incomplete-backup",
      reason: "No existe una copia fuente completa del documento; la operacion no es elegible.",
      confidence: "high",
      deterministic: false,
      repairEligible: false,
      details: { operationId: operation.operationId }
    });
  }
}

function enforceBeforeEvidence(operations, conflicts) {
  for (const operation of operations) {
    if (operation.before?.persistenceDemonstrated !== false) continue;

    operation.repairEligible = false;
    conflicts.push({
      conflictId: `${operation.operationId}:before-origin-indeterminate`,
      actorId: operation.actorId,
      actorUuid: operation.actorUuid,
      itemId: operation.itemId,
      itemUuid: operation.itemUuid,
      category: "before-origin-indeterminate",
      reason: "No puede demostrarse la representacion persistida exacta del campo before.",
      confidence: "manual-review-required",
      deterministic: false,
      repairEligible: false,
      details: { operationId: operation.operationId }
    });
  }
}

function requireDryRunAccess(dryRun) {
  if (!globalThis.game?.user?.isGM) {
    throw new Error("MTROL Repair 5A | Solo el GM puede generar el plan.");
  }

  if (dryRun !== true) {
    throw new Error(
      "MTROL Repair 5A | Escrituras bloqueadas. Esta etapa exige dryRun: true y no expone aplicacion real."
    );
  }
}

export function generateItemDataRepairPlan({
  dryRun = true,
  includeWorldActors = true,
  includeUnlinkedTokens = true
} = {}) {
  requireDryRunAccess(dryRun);

  const startedAt = new Date().toISOString();
  const worldId = globalThis.game?.world?.id ?? globalThis.game?.world?.title ?? "unknown";
  const foundryVersion = globalThis.game?.version ?? globalThis.game?.release?.version ?? "unknown";
  const systemVersion = globalThis.game?.system?.version ?? "unknown";
  const auditReport = auditWorldItems({
    includeWorldActors,
    includeUnlinkedTokens,
    dryRun: true
  });
  const actorContexts = collectActorContexts(auditReport);
  const metadata = { startedAt, worldId, foundryVersion, systemVersion };
  const backup = buildBackup(actorContexts, metadata);
  const operations = [];
  const conflicts = [];
  const warnings = [...(auditReport.warnings ?? [])];
  const errors = [...(auditReport.errors ?? [])];
  const actorPlans = [];

  for (const entry of actorContexts) {
    if (!entry.actor) {
      errors.push({
        actorId: entry.report.actor.id,
        actorUuid: entry.report.actor.uuid,
        category: "actor-document-unavailable",
        message: "El documento auditado ya no esta disponible; no se genera plan para este actor."
      });
      continue;
    }

    const info = actorMetadata(entry.actor, entry.context);
    const backupActor = backup.actors.find(candidate =>
      candidate.uuid === info.uuid && candidate.synthetic === info.synthetic
    );
    const operationStart = operations.length;
    const conflictStart = conflicts.length;

    planEquipment(entry.actor, entry.context, backupActor, operations, conflicts);
    planWeightAndQuantity(entry.actor, entry.context, backupActor, operations, conflicts, warnings);

    actorPlans.push({
      actor: info,
      backupEntryId: backupActor.backupEntryId,
      currentTotalWeight: entry.report.currentTotalWeight,
      previousLegacyTotalWeight: entry.report.previousLegacyTotalWeight,
      projectedTotalWeight: entry.report.projectedTotalWeight,
      operationIds: operations.slice(operationStart).map(operation => operation.operationId),
      conflictIds: conflicts.slice(conflictStart).map(conflict => conflict.conflictId),
      modified: false
    });
  }

  addAuditConflicts(auditReport, conflicts);
  enforceBackupEligibility(operations, backup, conflicts);
  enforceBeforeEvidence(operations, conflicts);
  enforceSyntheticIneligibility(operations, conflicts, backup);

  operations.sort((left, right) => compareText(left.operationId, right.operationId));
  conflicts.sort((left, right) => compareText(left.conflictId, right.conflictId));
  warnings.sort((left, right) => compareText(
    `${left.actorUuid ?? ""}.${left.itemUuid ?? ""}.${left.category ?? ""}`,
    `${right.actorUuid ?? ""}.${right.itemUuid ?? ""}.${right.category ?? ""}`
  ));
  errors.sort((left, right) => compareText(
    `${left.actorUuid ?? ""}.${left.itemUuid ?? ""}.${left.category ?? ""}`,
    `${right.actorUuid ?? ""}.${right.itemUuid ?? ""}.${right.category ?? ""}`
  ));

  const linkedTokens = collectLinkedTokens();
  const compendiums = collectExcludedCompendiums();
  const eligibleOperations = operations.filter(operation => operation.repairEligible);
  const syntheticOperations = operations.filter(operation => !operation.repairEligible);
  const finishedAt = new Date().toISOString();

  const summary = {
    worldActorsAudited: actorPlans.filter(plan => plan.actor.worldActor).length,
    syntheticActorsAudited: actorPlans.filter(plan => plan.actor.synthetic).length,
    linkedTokensDetected: linkedTokens.length,
    compendiumsExcluded: compendiums.length,
    itemsBackedUp: backup.actors.reduce((total, actor) => total + actor.items.length, 0),
    backupComplete: backup.complete,
    operationsProposed: operations.length,
    eligibleOperations: eligibleOperations.length,
    syntheticNonEligibleOperations: syntheticOperations.length,
    conflicts: conflicts.length,
    warnings: warnings.length,
    errors: errors.length,
    currentTotalWeight: auditReport.summary.currentTotalWeight,
    previousLegacyTotalWeight: auditReport.summary.previousLegacyTotalWeight,
    projectedTotalWeight: auditReport.summary.projectedTotalWeight,
    writesPerformed: 0,
    documentsCreated: 0,
    documentsDeleted: 0,
    documentsTransferred: 0,
    settingsModified: 0,
    flagsModified: 0
  };

  const report = {
    migrationId: MTROL_ITEM_DATA_REPAIR_MIGRATION_ID,
    migrationVersion: MTROL_ITEM_DATA_REPAIR_MIGRATION_VERSION,
    dryRun: true,
    startedAt,
    finishedAt,
    worldId,
    foundryVersion,
    systemVersion,
    summary,
    actors: actorPlans,
    operations,
    conflicts,
    warnings,
    errors,
    backup,
    backupId: backup.backupId,
    linkedTokens,
    syntheticActors: actorPlans.filter(plan => plan.actor.synthetic),
    compendiums: {
      policy: "excluded-read-only",
      opened: false,
      modified: false,
      discovered: compendiums
    },
    auditSummary: auditReport.summary,
    safety: {
      readOnly: true,
      realApplicationExposed: false,
      backupComplete: backup.complete,
      migrationMarkedApplied: false,
      atomic: false,
      atomicityStatement: "Foundry VTT no ofrece una transaccion atomica global entre actores y EmbeddedDocuments.",
      stateMustMatchBefore: true,
      stopActorOnFailure: true,
      compensationRequiredOnPartialFailure: true
    },
    futureApplicationProtocol: {
      availableInStage5A: false,
      steps: [
        "Validar que cada estado actual coincida exactamente con before.",
        "Crear o validar el respaldo completo y su checksum.",
        "Procesar las reparaciones por actor.",
        "Agrupar updates de EmbeddedDocuments compatibles cuando sea seguro.",
        "Actualizar exclusivamente los campos declarados en fieldsChanged.",
        "Verificar cada estado resultante.",
        "Detener el actor ante una escritura intermedia fallida.",
        "Intentar compensacion desde el respaldo.",
        "Registrar el fallo original y el resultado de la compensacion.",
        "No continuar silenciosamente ni declarar atomicidad global."
      ]
    }
  };

  // La serializacion es parte del contrato: cualquier fallo se informa sin escribir.
  JSON.stringify(report);

  console.groupCollapsed(
    `MTROL Repair 5A | Dry run | ${summary.eligibleOperations} operaciones elegibles`
  );
  console.table([summary]);
  if (operations.length) console.table(operations);
  if (conflicts.length) console.warn("Conflictos", conflicts);
  if (warnings.length) console.warn("Advertencias", warnings);
  if (errors.length) console.error("Errores", errors);
  console.info("Respaldo serializable", backup);
  console.groupEnd();

  return report;
}

export function getItemDataRepairBackup(report) {
  if (!report?.backup || report.backup.migrationId !== MTROL_ITEM_DATA_REPAIR_MIGRATION_ID) {
    throw new Error("MTROL Repair 5A | El informe no contiene un respaldo valido.");
  }
  return report.backup;
}

export function getEligibleItemDataRepairOperations(report) {
  return (report?.operations ?? []).filter(operation => operation.repairEligible === true);
}

export function getItemDataRepairConflicts(report) {
  return [...(report?.conflicts ?? [])];
}

export function verifyItemDataRepairDryRun(report) {
  const forbiddenCategories = (report?.operations ?? []).filter(operation =>
    !WRITE_CATEGORIES.has(operation.category)
  );

  return {
    valid: !!report &&
      report.migrationId === MTROL_ITEM_DATA_REPAIR_MIGRATION_ID &&
      report.dryRun === true &&
      report.safety?.readOnly === true &&
      report.safety?.realApplicationExposed === false &&
      report.summary?.writesPerformed === 0 &&
      forbiddenCategories.length === 0,
    dryRun: report?.dryRun === true,
    writesPerformed: report?.summary?.writesPerformed ?? null,
    forbiddenOperationIds: forbiddenCategories.map(operation => operation.operationId)
  };
}

export function serializeItemDataRepairReport(report, { pretty = true } = {}) {
  return JSON.stringify(report, null, pretty ? 2 : 0);
}

export function serializeItemDataRepairBackup(backupOrReport, { pretty = true } = {}) {
  const backup = backupOrReport?.backup ?? backupOrReport;
  return JSON.stringify(backup, null, pretty ? 2 : 0);
}

function downloadJson(data, filename) {
  if (typeof globalThis.saveDataToFile !== "function") {
    throw new Error(
      "MTROL Repair 5A | saveDataToFile no esta disponible en este runtime. Usa la funcion serialize correspondiente."
    );
  }
  globalThis.saveDataToFile(JSON.stringify(data, null, 2), "application/json", filename);
  return filename;
}

export function exportItemDataRepairReport(report) {
  return downloadJson(report, `${MTROL_ITEM_DATA_REPAIR_MIGRATION_ID}-report.json`);
}

export function exportItemDataRepairBackup(backupOrReport) {
  const backup = backupOrReport?.backup ?? backupOrReport;
  return downloadJson(backup, `${MTROL_ITEM_DATA_REPAIR_MIGRATION_ID}-backup.json`);
}

function getParentAndKey(target, path) {
  const parts = path.split(".");
  let parent = target;
  for (const part of parts.slice(0, -1)) {
    parent[part] ??= {};
    parent = parent[part];
  }
  return { parent, key: parts.at(-1) };
}

function capturePath(target, path) {
  const parts = path.split(".");
  let current = target;
  for (const part of parts.slice(0, -1)) {
    if (!current || typeof current !== "object" || !hasOwnField(current, part)) {
      return captureProperty(null, parts.at(-1), "fixture-current");
    }
    current = current[part];
  }
  return captureProperty(current, parts.at(-1), "fixture-current");
}

function sameCapturedValue(current, expected) {
  return current.exists === expected.exists &&
    stableStringify(current.value) === stableStringify(expected.value);
}

function assignCapturedValue(target, path, captured) {
  const { parent, key } = getParentAndKey(target, path);
  if (!captured.exists) {
    delete parent[key];
    return;
  }
  parent[key] = deserializeValue(captured.value);
}

function mirrorFixtureSource(document, path, captured) {
  if (!document?._source || !path.startsWith("system.")) return;
  assignCapturedValue(document._source, path, captured);
}

function fixtureDocumentForOperation(actor, operation) {
  if (operation.writeTarget === "Actor") return actor;
  return getCollectionDocument(actor?.items, operation.itemId);
}

function assertFixturesOnly(actors) {
  for (const actor of actors) {
    if (actor?.__mtrolRepairFixture !== true) {
      throw new Error("MTROL Repair 5A | El simulador solo admite actores marcados como fixtures.");
    }
    for (const item of toDocumentArray(actor?.items)) {
      if (item?.__mtrolRepairFixture !== true) {
        throw new Error("MTROL Repair 5A | Todos los items simulados deben estar marcados como fixtures.");
      }
    }
  }
}

export function simulateItemDataRepairForFixtures({
  report,
  actors = [],
  failOperationId = null,
  failCompensationOperationId = null
} = {}) {
  if (!report || report.dryRun !== true) {
    throw new Error("MTROL Repair 5A | El simulador requiere un informe dryRun valido.");
  }

  assertFixturesOnly(actors);
  const actorMap = new Map(actors.map(actor => [actor.uuid ?? actor.id, actor]));
  const eligible = getEligibleItemDataRepairOperations(report);
  const groups = new Map();

  for (const operation of eligible) {
    const key = operation.actorUuid ?? operation.actorId;
    const entries = groups.get(key) ?? [];
    entries.push(operation);
    groups.set(key, entries);
  }

  const result = {
    simulation: true,
    fixtureOnly: true,
    atomic: false,
    actors: [],
    appliedOperationIds: [],
    errors: [],
    compensations: []
  };

  for (const [actorKey, operations] of groups) {
    const actor = actorMap.get(actorKey);
    const actorResult = {
      actorUuid: actorKey,
      status: "pending",
      appliedOperationIds: [],
      error: null,
      compensation: null
    };
    result.actors.push(actorResult);

    if (!actor) {
      actorResult.status = "blocked";
      actorResult.error = "Fixture de actor no disponible.";
      result.errors.push({ actorUuid: actorKey, message: actorResult.error });
      continue;
    }

    const applied = [];

    try {
      for (const operation of operations) {
        const document = fixtureDocumentForOperation(actor, operation);
        if (!document) throw new Error(`Documento no disponible para ${operation.operationId}.`);

        const current = capturePath(document, operation.fieldsChanged[0]);
        if (!sameCapturedValue(current, operation.before)) {
          throw new Error(`El estado actual no coincide con before para ${operation.operationId}.`);
        }

        if (operation.operationId === failOperationId) {
          throw new Error(`Fallo intermedio simulado en ${operation.operationId}.`);
        }

        assignCapturedValue(document, operation.fieldsChanged[0], operation.after);
        mirrorFixtureSource(document, operation.fieldsChanged[0], operation.after);
        applied.push({ operation, document });
        actorResult.appliedOperationIds.push(operation.operationId);
        result.appliedOperationIds.push(operation.operationId);

        const verified = capturePath(document, operation.fieldsChanged[0]);
        if (!sameCapturedValue(verified, operation.after)) {
          throw new Error(`La verificacion posterior fallo para ${operation.operationId}.`);
        }
      }

      actorResult.status = "applied";
    } catch (error) {
      actorResult.status = "failed";
      actorResult.error = error?.message ?? String(error);
      result.errors.push({ actorUuid: actorKey, message: actorResult.error });
      const compensation = {
        attempted: applied.length > 0,
        success: true,
        restoredOperationIds: [],
        errors: []
      };

      for (const appliedEntry of [...applied].reverse()) {
        try {
          if (appliedEntry.operation.operationId === failCompensationOperationId) {
            throw new Error(`Fallo de compensacion simulado en ${appliedEntry.operation.operationId}.`);
          }
          assignCapturedValue(
            appliedEntry.document,
            appliedEntry.operation.fieldsChanged[0],
            appliedEntry.operation.before
          );
          mirrorFixtureSource(
            appliedEntry.document,
            appliedEntry.operation.fieldsChanged[0],
            appliedEntry.operation.before
          );
          compensation.restoredOperationIds.push(appliedEntry.operation.operationId);
        } catch (rollbackError) {
          compensation.success = false;
          compensation.errors.push({
            operationId: appliedEntry.operation.operationId,
            message: rollbackError?.message ?? String(rollbackError)
          });
        }
      }

      actorResult.compensation = compensation;
      result.compensations.push({ actorUuid: actorKey, ...compensation });
    }
  }

  return result;
}

export function installItemDataRepairApi(debugApi) {
  debugApi.planItemDataRepair = generateItemDataRepairPlan;
  debugApi.getItemDataRepairReport = generateItemDataRepairPlan;
  debugApi.getItemDataRepairBackup = getItemDataRepairBackup;
  debugApi.getEligibleItemDataRepairOperations = getEligibleItemDataRepairOperations;
  debugApi.getItemDataRepairConflicts = getItemDataRepairConflicts;
  debugApi.verifyItemDataRepairDryRun = verifyItemDataRepairDryRun;
  debugApi.serializeItemDataRepairReport = serializeItemDataRepairReport;
  debugApi.serializeItemDataRepairBackup = serializeItemDataRepairBackup;
  debugApi.exportItemDataRepairReport = exportItemDataRepairReport;
  debugApi.exportItemDataRepairBackup = exportItemDataRepairBackup;
  return debugApi;
}
