import {
  getCanonicalTechnicalIdByName,
  isCanonicalCompetencyTechnicalId
} from "../competencies/competency-catalog.js";

import { logger } from "../utils/logger.js";

export const COMPETENCY_TECHNICAL_ID_MIGRATION_ID =
  "competency-technical-id-v1";

function toArray(collection) {
  return Array.from(collection?.values?.() ?? collection ?? []);
}

function identify(item) {
  const existing = String(item?.system?.technicalId ?? "").trim();
  if (existing) {
    return isCanonicalCompetencyTechnicalId(existing)
      ? { technicalId: existing, source: "existing" }
      : { technicalId: null, source: "invalid-existing", value: existing };
  }

  const mapped = getCanonicalTechnicalIdByName(item?.name);
  return mapped
    ? { technicalId: mapped, source: "canonical-name" }
    : { technicalId: null, source: "unmapped-name" };
}

function itemInfo(item, actor = null) {
  return {
    actorId: actor?.id ?? null,
    actorUuid: actor?.uuid ?? null,
    itemId: item?.id ?? item?._id ?? null,
    itemUuid: item?.uuid ?? null,
    itemName: item?.name ?? null
  };
}

export function planCompetencyTechnicalIdMigration({
  actors = [],
  worldItems = []
} = {}) {
  const operations = [];
  const conflicts = [];
  const unknownTechnicalIds = [];
  const unmappedItems = [];
  let competenciesScanned = 0;

  function analyzeItems(items, actor = null) {
    const candidates = new Map();

    for (const item of toArray(items)) {
      if (item?.type !== "competencia") continue;
      competenciesScanned += 1;

      const identity = identify(item);
      const info = itemInfo(item, actor);

      if (identity.source === "invalid-existing") {
        unknownTechnicalIds.push({ ...info, technicalId: identity.value });
        continue;
      }

      if (identity.source === "unmapped-name") {
        unmappedItems.push(info);
        continue;
      }

      if (actor) {
        const matches = candidates.get(identity.technicalId) ?? [];
        matches.push({ item, identity, info });
        candidates.set(identity.technicalId, matches);
      } else if (identity.source === "canonical-name") {
        operations.push({
          scope: "world-item",
          item,
          ...info,
          technicalId: identity.technicalId
        });
      }
    }

    if (!actor) return;

    for (const [technicalId, matches] of candidates) {
      if (matches.length > 1) {
        conflicts.push({
          type: "duplicate-actor-technical-id",
          actorId: actor.id ?? null,
          actorUuid: actor.uuid ?? null,
          technicalId,
          itemIds: matches.map(match => match.info.itemId),
          itemNames: matches.map(match => match.info.itemName)
        });
        continue;
      }

      const match = matches[0];
      if (match.identity.source !== "canonical-name") continue;
      operations.push({
        scope: "actor-item",
        actor,
        item: match.item,
        ...match.info,
        technicalId
      });
    }
  }

  const actorList = toArray(actors);
  for (const actor of actorList) analyzeItems(actor?.items ?? [], actor);
  analyzeItems(worldItems, null);

  return {
    migrationId: COMPETENCY_TECHNICAL_ID_MIGRATION_ID,
    actorsScanned: actorList.length,
    competenciesScanned,
    operations,
    conflicts,
    unknownTechnicalIds,
    unmappedItems
  };
}

export async function migrateCompetencyTechnicalIds({
  actors = globalThis.game?.actors ?? [],
  worldItems = globalThis.game?.items ?? []
} = {}) {
  const plan = planCompetencyTechnicalIdMigration({ actors, worldItems });
  const actorOperations = new Map();
  const errors = [];
  let itemsMigrated = 0;
  let actorsMigrated = 0;

  for (const operation of plan.operations) {
    if (operation.scope !== "actor-item") continue;
    const entries = actorOperations.get(operation.actor) ?? [];
    entries.push({ _id: operation.itemId, "system.technicalId": operation.technicalId });
    actorOperations.set(operation.actor, entries);
  }

  for (const [actor, updates] of actorOperations) {
    try {
      await actor.updateEmbeddedDocuments("Item", updates, { render: false });
      actorsMigrated += 1;
      itemsMigrated += updates.length;
    } catch (error) {
      errors.push({ actorUuid: actor.uuid ?? null, error: error.message });
    }
  }

  for (const operation of plan.operations.filter(entry => entry.scope === "world-item")) {
    try {
      await operation.item.update({ "system.technicalId": operation.technicalId }, { render: false });
      itemsMigrated += 1;
    } catch (error) {
      errors.push({ itemUuid: operation.itemUuid, error: error.message });
    }
  }

  const report = {
    ...plan,
    operations: plan.operations.map(({ actor: _actor, item: _item, ...operation }) => operation),
    actorsMigrated,
    itemsMigrated,
    errors
  };

  const diagnostic = {
    migrationId: report.migrationId,
    actorsScanned: report.actorsScanned,
    competenciesScanned: report.competenciesScanned,
    actorsMigrated,
    itemsMigrated,
    conflicts: report.conflicts.length,
    unknownTechnicalIds: report.unknownTechnicalIds.length,
    unmappedItems: report.unmappedItems.length,
    errors: errors.length
  };

  if (report.conflicts.length || report.unknownTechnicalIds.length || errors.length) {
    logger.warn("MIGRATION", "Migración de technicalId de Competencias finalizada con incidencias", diagnostic);
  } else {
    logger.info("MIGRATION", "Migración de technicalId de Competencias finalizada", diagnostic);
  }

  return report;
}
