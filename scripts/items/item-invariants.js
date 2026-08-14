import {
  MTROL_BODY_SLOTS
} from "../constants/body-slots.js";

export const MTROL_ACTOR_TYPES = Object.freeze([
  "personaje",
  "character"
]);

export const MTROL_OBJECT_TYPES = Object.freeze([
  "objeto",
  "item"
]);

export const MTROL_COMPETENCE_TYPES = Object.freeze([
  "competencia"
]);

const ACTOR_TYPES = new Set(MTROL_ACTOR_TYPES);
const OBJECT_TYPES = new Set(MTROL_OBJECT_TYPES);
const COMPETENCE_TYPES = new Set(MTROL_COMPETENCE_TYPES);

export function hasOwnField(object, key) {
  return object !== null &&
    typeof object === "object" &&
    Object.prototype.hasOwnProperty.call(object, key);
}

export function toDocumentArray(collection) {
  return Array.from(collection ?? []);
}

export function getDocumentById(collection, id) {
  if (!id) return null;

  return collection?.get?.(id) ??
    toDocumentArray(collection).find(document => document?.id === id) ??
    null;
}

export function isMtrolActor(actor) {
  return ACTOR_TYPES.has(actor?.type);
}

export function isMtrolObject(item) {
  return OBJECT_TYPES.has(item?.type);
}

export function isMtrolCompetence(item) {
  return COMPETENCE_TYPES.has(item?.type);
}

export function parseMtrolNumber(value, { minimum = -Infinity } = {}) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return { valid: false, value: null, reason: "not-finite" };
    }

    if (value < minimum) {
      return { valid: false, value, reason: "below-minimum" };
    }

    return { valid: true, value, sourceType: "number" };
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed) {
      return { valid: false, value: null, reason: "empty-string" };
    }

    const number = Number(trimmed);

    if (!Number.isFinite(number)) {
      return { valid: false, value: null, reason: "not-numeric-string" };
    }

    if (number < minimum) {
      return { valid: false, value: number, reason: "below-minimum" };
    }

    return { valid: true, value: number, sourceType: "numeric-string" };
  }

  if (value === null) {
    return { valid: false, value: null, reason: "null" };
  }

  if (value === undefined) {
    return { valid: false, value: null, reason: "undefined" };
  }

  return { valid: false, value: null, reason: typeof value };
}

export function getSerializedSystemInfo(item) {
  const sourceSystem = item?._source?.system;
  const materializedSystem = item?.system;
  const materializedByDataModel = !!(
    materializedSystem &&
    typeof materializedSystem === "object" &&
    materializedSystem.constructor !== Object &&
    materializedSystem._source &&
    typeof materializedSystem._source === "object"
  );

  if (sourceSystem && typeof sourceSystem === "object") {
    return {
      available: true,
      origin: "item._source.system",
      system: sourceSystem,
      materializedByDataModel
    };
  }

  return {
    available: false,
    origin: "unavailable",
    system: null,
    materializedByDataModel
  };
}

export function analyzeItemQuantity(item) {
  const serialized = getSerializedSystemInfo(item);
  const materializedHasQuantity = hasOwnField(item?.system, "cantidad");
  const sourceHasQuantity = serialized.available &&
    hasOwnField(serialized.system, "cantidad");

  let original;
  let existence;

  if (sourceHasQuantity) {
    original = serialized.system.cantidad;
    existence = serialized.materializedByDataModel && original === 1
      ? "indeterminate"
      : "present";
  } else if (serialized.available) {
    original = undefined;
    existence = "absent";
  } else if (materializedHasQuantity) {
    original = item.system.cantidad;
    existence = "indeterminate";
  } else {
    original = undefined;
    existence = "absent";
  }

  if (existence === "absent") {
    return {
      original: null,
      materialized: materializedHasQuantity ? item.system.cantidad : null,
      normalized: 1,
      effectiveValue: 1,
      existence,
      classification: "quantity-absent",
      valid: true,
      validForProjection: true,
      warnings: ["Cantidad ausente; la regla vigente utiliza 1."]
    };
  }

  const parsed = parseMtrolNumber(original, { minimum: 0 });

  if (!parsed.valid) {
    const classification = parsed.reason === "below-minimum"
      ? "quantity-negative"
      : "quantity-invalid";

    return {
      original,
      materialized: materializedHasQuantity ? item.system.cantidad : null,
      normalized: null,
      effectiveValue: 0,
      existence,
      classification,
      valid: false,
      validForProjection: false,
      warnings: [`Cantidad invalida (${parsed.reason}); el aporte efectivo se limita a cero y se informa.`]
    };
  }

  return {
    original,
    materialized: materializedHasQuantity ? item.system.cantidad : null,
    normalized: parsed.value,
    effectiveValue: parsed.value,
    existence,
    classification: parsed.value === 0
      ? "quantity-zero"
      : "quantity-valid",
    valid: true,
    validForProjection: true,
    warnings: parsed.sourceType === "numeric-string"
      ? ["Cantidad expresada como cadena numerica valida."]
      : []
  };
}

export function analyzeItemWeight(item) {
  const serialized = getSerializedSystemInfo(item);
  const materializedHasWeight = hasOwnField(item?.system, "peso");
  const materializedWeight = materializedHasWeight
    ? item.system.peso
    : null;
  const sourceHasWeight = serialized.available &&
    hasOwnField(serialized.system, "peso");
  const sourceWeight = sourceHasWeight
    ? serialized.system.peso
    : null;
  const legacyOriginal = serialized.available && hasOwnField(serialized.system, "slots")
    ? serialized.system.slots
    : item?.system?.slots;
  const legacy = parseMtrolNumber(legacyOriginal, { minimum: 0 });
  const materialized = parseMtrolNumber(materializedWeight, { minimum: 0 });

  let effectiveUnitWeight = 0;
  let calculationSource = "invalid-system.peso";

  if (materializedHasWeight) {
    if (materialized.valid) {
      effectiveUnitWeight = materialized.value;
      calculationSource = "system.peso";
    }
  } else if (legacy.valid) {
    effectiveUnitWeight = legacy.value;
    calculationSource = "legacy-system.slots-field-absent";
  } else {
    calculationSource = "invalid-legacy-system.slots";
  }

  const base = {
    sourceHasProperty: sourceHasWeight,
    sourceRepresentation: sourceHasWeight ? sourceWeight : null,
    sourceValueType: sourceHasWeight
      ? sourceWeight === null
        ? "null"
        : typeof sourceWeight
      : "absent-or-unavailable",
    materialized: materializedWeight,
    sourceOrigin: serialized.origin,
    existence: sourceHasWeight
      ? "present"
      : serialized.available
        ? "absent"
        : "indeterminate",
    slotsLegacy: legacyOriginal ?? null,
    slotsLegacyNormalized: legacy.valid ? legacy.value : null,
    normalized: materialized.valid ? materialized.value : null,
    effectiveUnitWeight,
    calculationSource,
    expectedUnitWeight: null,
    migratableLegacy: false,
    indeterminateLegacy: false,
    modernZero: false,
    invalid: false,
    warnings: []
  };

  if (sourceHasWeight) {
    const modern = parseMtrolNumber(sourceWeight, { minimum: 0 });

    if (!modern.valid) {
      return {
        ...base,
        classification: "weight-invalid",
        invalid: true,
        warnings: [`system.peso persistido es invalido (${modern.reason}).`]
      };
    }

    if (serialized.materializedByDataModel && modern.value === 0) {
      return {
        ...base,
        existence: "indeterminate",
        normalized: modern.value,
        expectedUnitWeight: null,
        classification: "indeterminate-legacy-weight",
        indeterminateLegacy: true,
        warnings: [
          "El cero aparece en una fuente limpiada por ObjetoDataModel; no puede demostrarse si fue persistido o agregado como valor inicial."
        ]
      };
    }

    return {
      ...base,
      normalized: modern.value,
      expectedUnitWeight: modern.value,
      classification: modern.value === 0
        ? "modern-zero-weight"
        : "modern-valid-weight",
      modernZero: modern.value === 0,
      warnings: modern.sourceType === "numeric-string"
        ? ["system.peso persistido como cadena numerica valida."]
        : []
    };
  }

  if (serialized.available) {
    if (legacy.valid) {
      return {
        ...base,
        normalized: null,
        expectedUnitWeight: legacy.value,
        classification: "migratable-legacy-weight",
        migratableLegacy: true,
        warnings: ["system.peso esta demostrablemente ausente; system.slots es un candidato legacy valido."]
      };
    }

    return {
      ...base,
      normalized: null,
      classification: "weight-invalid",
      invalid: true,
      warnings: ["system.peso esta ausente y system.slots no es un valor legacy valido."]
    };
  }

  if (!materializedHasWeight && legacy.valid) {
    return {
      ...base,
      existence: "absent",
      normalized: null,
      expectedUnitWeight: legacy.value,
      classification: "migratable-legacy-weight",
      migratableLegacy: true,
      warnings: ["system.peso no existe en el objeto y system.slots es un candidato legacy valido."]
    };
  }

  if (!materialized.valid) {
    return {
      ...base,
      normalized: null,
      classification: "weight-invalid",
      invalid: true,
      warnings: [`No hay fuente serializada y el peso materializado es invalido (${materialized.reason}).`]
    };
  }

  return {
    ...base,
    normalized: materialized.value,
    expectedUnitWeight: null,
    classification: "indeterminate-legacy-weight",
    indeterminateLegacy: true,
    warnings: [
      "La fuente serializada no esta disponible; no puede demostrarse si peso fue persistido o materializado por el DataModel."
    ]
  };
}

export function getItemUnitWeight(item) {
  if (!isMtrolObject(item)) return 0;
  return analyzeItemWeight(item).effectiveUnitWeight;
}

export function getItemQuantity(item) {
  if (!isMtrolObject(item)) return 0;
  return analyzeItemQuantity(item).effectiveValue;
}

export function getItemWeightContribution(item) {
  if (!isMtrolObject(item)) return 0;
  return getItemUnitWeight(item) * getItemQuantity(item);
}

export function getLegacyRuleUnitWeight(item) {
  if (!isMtrolObject(item)) return 0;

  const hasMaterial = item?.system?.material !== undefined &&
    item?.system?.material !== null &&
    item?.system?.material !== "";
  const weight = Number(item?.system?.peso);
  const validWeight = Number.isFinite(weight) ? weight : 0;
  const slots = Number(item?.system?.slots);
  const validSlots = Number.isFinite(slots) ? slots : 0;

  if (hasMaterial) return validWeight;
  if (validWeight > 0) return validWeight;
  return validSlots;
}

export function normalizeEquippedFlag(value) {
  return value === true || value === "true";
}

export function getEquipmentState(actor, { slotOverrides = {} } = {}) {
  const entries = MTROL_BODY_SLOTS.map(slot => {
    const rawReference = hasOwnField(slotOverrides, slot)
      ? slotOverrides[slot]
      : actor?.system?.equipamiento?.[slot] ?? "";
    const reference = typeof rawReference === "string"
      ? rawReference
      : String(rawReference ?? "");
    const item = reference ? getDocumentById(actor?.items, reference) : null;

    return {
      slot,
      reference,
      item,
      resolvedItemId: item?.id ?? null,
      resolvedItemUuid: item?.uuid ?? null,
      broken: !!reference && !item
    };
  });

  const referencesByItem = new Map();

  for (const entry of entries) {
    if (!entry.resolvedItemId) continue;
    const references = referencesByItem.get(entry.resolvedItemId) ?? [];
    references.push(entry.slot);
    referencesByItem.set(entry.resolvedItemId, references);
  }

  const equippedByDeclaredSlot = new Map();

  for (const item of toDocumentArray(actor?.items)) {
    if (!isMtrolObject(item) || !normalizeEquippedFlag(item?.system?.equipado)) continue;
    const slot = item?.system?.slot;
    if (!MTROL_BODY_SLOTS.includes(slot)) continue;
    const ids = equippedByDeclaredSlot.get(slot) ?? [];
    ids.push(item.id);
    equippedByDeclaredSlot.set(slot, ids);
  }

  return {
    entries,
    referencesByItem,
    equippedByDeclaredSlot
  };
}

export function getEquipmentItemForSlot(actor, slot) {
  if (!MTROL_BODY_SLOTS.includes(slot)) return null;
  return getEquipmentState(actor).entries.find(entry => entry.slot === slot)?.item ?? null;
}

export function getReferencedSlotsForItem(actor, itemOrId) {
  const itemId = typeof itemOrId === "string"
    ? itemOrId
    : itemOrId?.id;

  if (!itemId) return [];
  return [...(getEquipmentState(actor).referencesByItem.get(itemId) ?? [])];
}

export function isItemActuallyEquipped(actor, itemOrId) {
  return getReferencedSlotsForItem(actor, itemOrId).length > 0;
}

export function getActuallyEquippedItems(actor) {
  const seen = new Set();
  const result = [];

  for (const entry of getEquipmentState(actor).entries) {
    if (!entry.item || seen.has(entry.item.id)) continue;
    seen.add(entry.item.id);
    result.push(entry.item);
  }

  return result;
}

export function getInventoryItems(actor) {
  const referencedIds = new Set(
    getEquipmentState(actor).entries
      .map(entry => entry.resolvedItemId)
      .filter(Boolean)
  );

  return toDocumentArray(actor?.items).filter(item =>
    isMtrolObject(item) && !referencedIds.has(item.id)
  );
}

export function analyzeItemEquipment(actor, item, state = getEquipmentState(actor)) {
  const referencedSlots = state.referencesByItem.get(item?.id) ?? [];
  const declaredSlot = item?.system?.slot ?? "";
  const equippedOriginal = item?.system?.equipado ?? false;
  const equippedNormalized = normalizeEquippedFlag(equippedOriginal);
  const warnings = [];
  const conflicts = [];

  if (referencedSlots.length > 1) {
    conflicts.push("item-referenced-by-multiple-slots");
  }

  if (referencedSlots.length && declaredSlot && !referencedSlots.includes(declaredSlot)) {
    conflicts.push("declared-slot-does-not-match-reference");
  }

  if (declaredSlot && !MTROL_BODY_SLOTS.includes(declaredSlot)) {
    conflicts.push("invalid-declared-slot");
  }

  const sameSlotEquipped = state.equippedByDeclaredSlot.get(declaredSlot) ?? [];
  if (declaredSlot && sameSlotEquipped.length > 1) {
    conflicts.push("multiple-equipped-items-declare-same-slot");
  }

  if (equippedOriginal === "false") {
    warnings.push("system.equipado contiene la cadena \"false\" y no es un booleano valido.");
  }

  let classification = "inventory-item";
  let proposedRepair = null;
  let confidence = "high";

  if (conflicts.length) {
    classification = "slot-conflict";
    proposedRepair = "Revisar manualmente el conflicto; no reparar automaticamente.";
    confidence = "medium";
  } else if (referencedSlots.length && equippedNormalized) {
    classification = "referenced-and-equipped";
  } else if (referencedSlots.length && !equippedNormalized) {
    classification = "referenced-but-unequipped";
    proposedRepair = "Sincronizar system.equipado a true en una etapa futura.";
  } else if (!referencedSlots.length && equippedNormalized) {
    classification = "equipped-but-unreferenced";
    proposedRepair = "Sincronizar system.equipado a false en una etapa futura, sin borrar el item.";
  }

  return {
    equippedOriginal,
    equippedNormalized,
    actuallyEquipped: referencedSlots.length > 0,
    declaredSlot,
    referencedSlots: [...referencedSlots],
    classification,
    conflicts,
    proposedRepair,
    confidence,
    warnings
  };
}