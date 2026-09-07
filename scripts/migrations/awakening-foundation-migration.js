import {
  AWAKENING_INTERNAL_UPDATE_OPTION,
  planDerivedAwakeningGrantUpdate
} from "../actors/awakening-service.js";
import { logger } from "../utils/logger.js";

export const AWAKENING_FOUNDATION_MIGRATION_ID = "awakening-foundation-v1";

function toArray(collection) {
  return Array.from(collection?.values?.() ?? collection ?? []);
}

export function planAwakeningFoundationMigration({ actors = [] } = {}) {
  const operations = [];
  const conflicts = [];
  const actorList = toArray(actors);
  for (const actor of actorList) {
    if (!actor || !["personaje", "character"].includes(actor.type)) continue;
    const rawAwakening = actor._source?.system?.awakening;
    const grants = actor.system?.awakening?.grants;
    const selections = actor.system?.awakening?.selections;
    if (grants !== undefined && !Array.isArray(grants)) {
      conflicts.push({ actorUuid: actor.uuid, field: "grants", reason: "not-array" });
      continue;
    }
    if (selections !== undefined && !Array.isArray(selections)) {
      conflicts.push({ actorUuid: actor.uuid, field: "selections", reason: "not-array" });
      continue;
    }
    const derived = planDerivedAwakeningGrantUpdate(actor, { grantedBy: "system:migration" });
    const needsGrants = !rawAwakening || !Array.isArray(rawAwakening.grants) || derived.changed;
    const needsSelections = !rawAwakening || !Array.isArray(rawAwakening.selections);
    if (!needsGrants && !needsSelections) continue;
    operations.push({
      actor,
      actorUuid: actor.uuid,
      update: {
        ...(needsGrants ? { "system.awakening.grants": [...derived.grants] } : {}),
        ...(needsSelections ? { "system.awakening.selections": [...(selections ?? [])] } : {})
      },
      derivedGrantIds: derived.additions.map(grant => grant.grantId)
    });
  }
  return { migrationId: AWAKENING_FOUNDATION_MIGRATION_ID, actorsScanned: actorList.length, operations, conflicts };
}

export async function migrateAwakeningFoundation({ actors = globalThis.game?.actors ?? [] } = {}) {
  const plan = planAwakeningFoundationMigration({ actors });
  const errors = [];
  let actorsMigrated = 0;
  let racialGrantsAdded = 0;
  for (const operation of plan.operations) {
    try {
      await operation.actor.update(operation.update, {
        [AWAKENING_INTERNAL_UPDATE_OPTION]: true,
        render: false
      });
      actorsMigrated += 1;
      racialGrantsAdded += operation.derivedGrantIds.length;
    } catch (error) {
      errors.push({ actorUuid: operation.actorUuid, error: error.message });
    }
  }
  const report = {
    migrationId: plan.migrationId,
    actorsScanned: plan.actorsScanned,
    actorsMigrated,
    racialGrantsAdded,
    conflicts: plan.conflicts,
    errors
  };
  const message = conflictsOrErrors(report)
    ? "Migración de foundation de Despertar finalizada con incidencias"
    : "Migración de foundation de Despertar finalizada";
  logger[conflictsOrErrors(report) ? "warn" : "info"]("MIGRATION", message, {
    actorsScanned: report.actorsScanned,
    actorsMigrated,
    racialGrantsAdded,
    conflicts: report.conflicts.length,
    errors: report.errors.length
  });
  return report;
}

function conflictsOrErrors(report) {
  return report.conflicts.length > 0 || report.errors.length > 0;
}
