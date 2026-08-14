import {
  MTROL_ACTOR_TYPES,
  MTROL_OBJECT_TYPES,
  MTROL_COMPETENCE_TYPES,
  analyzeItemEquipment,
  analyzeItemQuantity,
  analyzeItemWeight,
  getEquipmentState,
  getItemWeightContribution,
  getLegacyRuleUnitWeight,
  getDocumentById,
  isMtrolActor,
  isMtrolCompetence,
  isMtrolObject,
  toDocumentArray
} from "../items/item-invariants.js";

const AUDIT_VERSION = 2;
const KNOWN_ITEM_TYPES = new Set([
  ...MTROL_OBJECT_TYPES,
  ...MTROL_COMPETENCE_TYPES
]);

function compareText(left, right) {
  const a = String(left ?? "");
  const b = String(right ?? "");
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function normalizeForFingerprint(value) {
  if (Array.isArray(value)) return value.map(normalizeForFingerprint);
  if (!value || typeof value !== "object") return value;

  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      if (key === "equipado" || key === "_source") return result;
      result[key] = normalizeForFingerprint(value[key]);
      return result;
    }, {});
}

function createSimilarityFingerprint(item) {
  const sourceId = item?.flags?.core?.sourceId ??
    item?._stats?.compendiumSource ??
    item?._source?._stats?.compendiumSource ??
    null;

  return JSON.stringify(normalizeForFingerprint({
    name: String(item?.name ?? "").trim().toLowerCase(),
    type: item?.type ?? "",
    img: item?.img ?? "",
    sourceId,
    system: item?.system ?? {}
  }));
}

function getLegacyRuleQuantity(item) {
  const quantity = Number(item?.system?.cantidad);
  return Number.isFinite(quantity) ? quantity : 1;
}

function actorMetadata(actor, context) {
  return {
    id: actor?.id ?? null,
    uuid: actor?.uuid ?? null,
    name: actor?.name ?? "(sin nombre)",
    type: actor?.type ?? null,
    synthetic: context.synthetic === true,
    token: context.token
      ? {
          id: context.token.id ?? null,
          uuid: context.token.uuid ?? null,
          name: context.token.name ?? null
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

function isPotentiallyCompatible(actor) {
  if (!actor || isMtrolActor(actor)) return false;

  const hasKnownItems = toDocumentArray(actor.items)
    .some(item => KNOWN_ITEM_TYPES.has(item?.type));
  const hasEquipmentShape = actor.system?.equipamiento &&
    typeof actor.system.equipamiento === "object";

  return hasKnownItems || hasEquipmentShape;
}

function createUnknownStructure(actor, context) {
  return {
    ...actorMetadata(actor, context),
    reason: "Tipo de actor no registrado con estructura potencialmente compatible.",
    registeredActorTypes: [...MTROL_ACTOR_TYPES],
    itemTypes: [...new Set(toDocumentArray(actor?.items).map(item => item?.type ?? null))],
    audited: false,
    modified: false
  };
}

function buildSimilarityCandidates(actor, actorInfo) {
  const groups = new Map();

  for (const item of toDocumentArray(actor.items).filter(isMtrolObject)) {
    const fingerprint = createSimilarityFingerprint(item);
    const ids = groups.get(fingerprint) ?? [];
    ids.push(item.id);
    groups.set(fingerprint, ids);
  }

  return [...groups.values()]
    .filter(ids => ids.length > 1)
    .map(ids => ({
      actorUuid: actorInfo.uuid,
      itemIds: [...ids].sort(compareText),
      classification: "similar-document-candidate",
      duplicateConclusion: "not-determined",
      confidence: "insufficient-evidence",
      repairEligible: false,
      proposedFutureRepair: null,
      warning: "La similitud no demuestra duplicacion. No borrar, fusionar ni modificar cantidades sin evidencia tecnica adicional."
    }))
    .sort((left, right) =>
      compareText(left.itemIds.join("|"), right.itemIds.join("|"))
    );
}

function auditCompatibleActor(actor, context) {
  const actorInfo = actorMetadata(actor, context);
  const equipmentState = getEquipmentState(actor);
  const items = [];
  const errors = [];

  for (const item of toDocumentArray(actor.items)) {
    try {
      const physical = isMtrolObject(item);
      const competence = isMtrolCompetence(item);
      const quantity = physical ? analyzeItemQuantity(item) : null;
      const weight = physical ? analyzeItemWeight(item) : null;
      const equipment = physical
        ? analyzeItemEquipment(actor, item, equipmentState)
        : null;
      const currentContribution = physical
        ? getItemWeightContribution(item)
        : 0;
      const previousLegacyContribution = physical
        ? getLegacyRuleUnitWeight(item) * getLegacyRuleQuantity(item)
        : 0;
      const expectedContribution = physical &&
        weight.expectedUnitWeight !== null &&
        quantity.validForProjection
          ? weight.expectedUnitWeight * quantity.normalized
          : null;
      const classifications = physical
        ? [equipment.classification, weight.classification, quantity.classification]
        : competence
          ? ["competence"]
          : ["unknown-item-type"];

      const correctEquipment = [
        "inventory-item",
        "referenced-and-equipped"
      ].includes(equipment?.classification);
      const correctWeight = [
        "modern-valid-weight",
        "modern-zero-weight"
      ].includes(weight?.classification);
      const correctQuantity = [
        "quantity-valid",
        "quantity-zero",
        "quantity-absent"
      ].includes(quantity?.classification);

      if (physical && correctEquipment && correctWeight && correctQuantity) {
        classifications.unshift("correct-item");
      }

      let proposedRepair = equipment?.proposedRepair ?? null;
      if (weight?.migratableLegacy) {
        proposedRepair = proposedRepair
          ? `${proposedRepair} Evaluar copiar system.slots a system.peso en la migracion futura.`
          : "Evaluar copiar system.slots a system.peso en la migracion futura.";
      }

      items.push({
        actorId: actorInfo.id,
        actorUuid: actorInfo.uuid,
        actorName: actorInfo.name,
        syntheticActor: actorInfo.synthetic,
        sceneId: actorInfo.scene?.id ?? null,
        sceneUuid: actorInfo.scene?.uuid ?? null,
        sceneName: actorInfo.scene?.name ?? null,
        tokenId: actorInfo.token?.id ?? null,
        tokenUuid: actorInfo.token?.uuid ?? null,
        tokenName: actorInfo.token?.name ?? null,
        itemId: item?.id ?? null,
        itemUuid: item?.uuid ?? null,
        itemName: item?.name ?? "(sin nombre)",
        itemType: item?.type ?? null,
        itemTypeClassification: physical
          ? "object"
          : competence
            ? "competence"
            : "unknown",
        quantity,
        weight,
        slotsLegacy: item?.system?.slots ?? null,
        equipped: item?.system?.equipado ?? null,
        equipmentReferences: equipment?.referencedSlots ?? [],
        declaredSlot: item?.system?.slot ?? "",
        currentUnitWeight: weight?.effectiveUnitWeight ?? 0,
        currentQuantity: quantity?.effectiveValue ?? 0,
        currentContribution,
        previousLegacyContribution,
        expectedContribution,
        equipmentClassification: equipment?.classification ?? "not-applicable",
        weightClassification: weight?.classification ?? "not-applicable",
        quantityClassification: quantity?.classification ?? "not-applicable",
        classification: classifications,
        proposedFutureRepair: proposedRepair,
        confidence: equipment?.confidence ?? "high",
        warnings: [
          ...(quantity?.warnings ?? []),
          ...(weight?.warnings ?? []),
          ...(equipment?.warnings ?? [])
        ],
        errors: []
      });
    } catch (error) {
      errors.push({
        actorUuid: actorInfo.uuid,
        itemId: item?.id ?? null,
        itemUuid: item?.uuid ?? null,
        message: error?.message ?? String(error)
      });
    }
  }

  const similarityCandidates = buildSimilarityCandidates(actor, actorInfo);

  for (const candidate of similarityCandidates) {
    for (const item of items.filter(row => candidate.itemIds.includes(row.itemId))) {
      item.classification = item.classification.filter(value => value !== "correct-item");
      item.classification.push("similar-document-candidate");
      item.warnings.push(candidate.warning);
    }
  }

  const brokenSlotReferences = equipmentState.entries
    .filter(entry => entry.broken)
    .map(entry => ({
      actorUuid: actorInfo.uuid,
      slot: entry.slot,
      reference: entry.reference,
      classification: "broken-slot-reference",
      proposedFutureRepair: "Limpiar la referencia rota en la migracion futura.",
      confidence: "high"
    }));

  items.sort((left, right) =>
    compareText(left.itemUuid ?? left.itemId, right.itemUuid ?? right.itemId)
  );

  const physicalItems = items.filter(item => item.itemTypeClassification === "object");
  const projectionIndeterminate = physicalItems.some(item =>
    item.expectedContribution === null
  );

  return {
    actor: actorInfo,
    items,
    equipmentSlots: equipmentState.entries.map(entry => ({
      slot: entry.slot,
      reference: entry.reference,
      resolvedItemId: entry.resolvedItemId,
      resolvedItemUuid: entry.resolvedItemUuid,
      broken: entry.broken
    })),
    brokenSlotReferences,
    possibleDuplicates: similarityCandidates,
    currentTotalWeight: physicalItems.reduce(
      (total, item) => total + item.currentContribution,
      0
    ),
    previousLegacyTotalWeight: physicalItems.reduce(
      (total, item) => total + item.previousLegacyContribution,
      0
    ),
    projectedTotalWeight: projectionIndeterminate
      ? null
      : physicalItems.reduce(
          (total, item) => total + item.expectedContribution,
          0
        ),
    warnings: [],
    errors
  };
}

function requireWorldAuditAccess(options) {
  if (!globalThis.game?.user?.isGM) {
    throw new Error("MTROL Debug | Solo el GM puede ejecutar auditWorldItems().");
  }

  if (options.dryRun !== true) {
    throw new Error("MTROL Debug | auditWorldItems() requiere dryRun: true.");
  }
}

export function auditWorldItems({
  includeWorldActors = true,
  includeUnlinkedTokens = true,
  dryRun = true
} = {}) {
  const options = {
    includeWorldActors: includeWorldActors === true,
    includeUnlinkedTokens: includeUnlinkedTokens === true,
    dryRun
  };

  requireWorldAuditAccess(options);

  const actorReports = [];
  const unknownCompatibleStructures = [];
  const warnings = [];
  const errors = [];
  const seenWorldUuids = new Set();
  const seenSyntheticUuids = new Set();

  const inspectActor = (actor, context) => {
    if (!actor || actor.pack || actor.compendium) return;

    const key = actor.uuid ??
      (context.synthetic
        ? `${context.scene?.uuid ?? "Scene"}.${context.token?.uuid ?? context.token?.id ?? "Token"}`
        : `Actor.${actor.id ?? actor.name}`);
    const seen = context.synthetic ? seenSyntheticUuids : seenWorldUuids;
    if (seen.has(key)) return;
    seen.add(key);

    if (!isMtrolActor(actor)) {
      if (isPotentiallyCompatible(actor)) {
        unknownCompatibleStructures.push(createUnknownStructure(actor, context));
      }
      return;
    }

    try {
      actorReports.push(auditCompatibleActor(actor, context));
    } catch (error) {
      errors.push({
        actorUuid: actor.uuid ?? null,
        tokenUuid: context.token?.uuid ?? null,
        sceneUuid: context.scene?.uuid ?? null,
        message: error?.message ?? String(error)
      });
    }
  };

  if (options.includeWorldActors) {
    for (const actor of toDocumentArray(globalThis.game?.actors)) {
      inspectActor(actor, { synthetic: false, token: null, scene: null });
    }
  }

  if (options.includeUnlinkedTokens) {
    for (const scene of toDocumentArray(globalThis.game?.scenes)) {
      if (scene?.pack || scene?.compendium) continue;

      for (const token of toDocumentArray(scene?.tokens)) {
        if (token?.actorLink === true || token?.isLinked === true) continue;

        const baseActor = token?.baseActor ??
          getDocumentById(globalThis.game?.actors, token?.actorId);

        if (!baseActor) {
          warnings.push({
            classification: "unlinked-token-without-base-actor",
            sceneId: scene?.id ?? null,
            sceneUuid: scene?.uuid ?? null,
            tokenId: token?.id ?? null,
            tokenUuid: token?.uuid ?? null,
            message: "Token no vinculado omitido porque no posee actor base."
          });
          continue;
        }

        if (!token?.actor) {
          warnings.push({
            classification: "unlinked-token-without-synthetic-actor",
            sceneId: scene?.id ?? null,
            sceneUuid: scene?.uuid ?? null,
            tokenId: token?.id ?? null,
            tokenUuid: token?.uuid ?? null,
            message: "Token no vinculado omitido porque token.actor no esta disponible."
          });
          continue;
        }

        inspectActor(token.actor, { synthetic: true, token, scene });
      }
    }
  }

  actorReports.sort((left, right) =>
    compareText(left.actor.uuid ?? left.actor.id, right.actor.uuid ?? right.actor.id)
  );
  unknownCompatibleStructures.sort((left, right) =>
    compareText(left.uuid ?? left.id, right.uuid ?? right.id)
  );
  warnings.sort((left, right) =>
    compareText(left.tokenUuid, right.tokenUuid)
  );

  const allItems = actorReports.flatMap(report => report.items);
  const physicalItems = allItems.filter(item => item.itemTypeClassification === "object");
  const brokenSlotReferences = actorReports.flatMap(report => report.brokenSlotReferences);
  const possibleDuplicates = actorReports.flatMap(report => report.possibleDuplicates);
  errors.push(...actorReports.flatMap(report => report.errors));
  errors.sort((left, right) =>
    compareText(`${left.actorUuid}.${left.itemUuid}`, `${right.actorUuid}.${right.itemUuid}`)
  );

  const projectionDeterminate = actorReports.every(report =>
    report.projectedTotalWeight !== null
  );
  const changesProposed = physicalItems.filter(item =>
    item.equipmentClassification === "referenced-but-unequipped" ||
    item.equipmentClassification === "equipped-but-unreferenced" ||
    item.weight?.migratableLegacy
  ).length + brokenSlotReferences.length;

  const summary = {
    actorsScanned: actorReports.filter(report => !report.actor.synthetic).length,
    syntheticActorsScanned: actorReports.filter(report => report.actor.synthetic).length,
    unknownCompatibleStructures: unknownCompatibleStructures.length,
    itemsScanned: allItems.length,
    correctItems: physicalItems.filter(item =>
      item.classification.includes("correct-item")
    ).length,
    orphanEquippedItems: physicalItems.filter(item =>
      item.equipmentClassification === "equipped-but-unreferenced"
    ).length,
    referencedButUnequippedItems: physicalItems.filter(item =>
      item.equipmentClassification === "referenced-but-unequipped"
    ).length,
    brokenSlotReferences: brokenSlotReferences.length,
    slotConflicts: physicalItems.filter(item =>
      item.equipmentClassification === "slot-conflict"
    ).length,
    modernZeroWeightItems: physicalItems.filter(item => item.weight?.modernZero).length,
    migratableLegacyItems: physicalItems.filter(item => item.weight?.migratableLegacy).length,
    indeterminateLegacyItems: physicalItems.filter(item => item.weight?.indeterminateLegacy).length,
    invalidWeightItems: physicalItems.filter(item => item.weight?.invalid).length,
    invalidQuantityItems: physicalItems.filter(item =>
      ["quantity-invalid", "quantity-negative"].includes(item.quantityClassification)
    ).length,
    possibleDuplicates: possibleDuplicates.length,
    currentTotalWeight: actorReports.reduce(
      (total, report) => total + report.currentTotalWeight,
      0
    ),
    previousLegacyTotalWeight: actorReports.reduce(
      (total, report) => total + report.previousLegacyTotalWeight,
      0
    ),
    projectedTotalWeight: projectionDeterminate
      ? actorReports.reduce((total, report) => total + report.projectedTotalWeight, 0)
      : null,
    changesProposed,
    warnings: warnings.length + physicalItems.reduce(
      (total, item) => total + item.warnings.length,
      0
    ),
    errors: errors.length
  };

  const report = {
    audit: {
      name: "MTROL World Item Audit",
      auditVersion: AUDIT_VERSION,
      systemVersion: globalThis.game?.system?.version ?? "unknown",
      generatedAt: new Date().toISOString(),
      dryRun: true,
      readOnly: true,
      options: {
        includeWorldActors: options.includeWorldActors,
        includeUnlinkedTokens: options.includeUnlinkedTokens
      }
    },
    summary,
    actors: actorReports,
    unknownCompatibleStructures,
    possibleDuplicates,
    warnings,
    errors
  };

  console.groupCollapsed(
    `MTROL Debug | Auditoria global de items | ${summary.actorsScanned} actores + ${summary.syntheticActorsScanned} sinteticos`
  );
  console.table([summary]);
  if (warnings.length) console.warn("Advertencias", warnings);
  if (errors.length) console.error("Errores", errors);
  console.info("Informe serializable", report);
  console.groupEnd();

  return report;
}

export function serializeWorldItemsAudit(report, { pretty = true } = {}) {
  return JSON.stringify(report, null, pretty ? 2 : 0);
}

export function installWorldItemAuditApi(debugApi) {
  debugApi.auditWorldItems = auditWorldItems;
  debugApi.serializeWorldItemsAudit = serializeWorldItemsAudit;
  return debugApi;
}
