import {
  getCanonicalRaceIdByLabel,
  getRaceDefinition,
  isValidRaceId
} from "../races/race-catalog.js";

import {
  RACE_IDENTITY_INTERNAL_UPDATE_OPTION
} from "../actors/race-service.js";

import { logger } from "../utils/logger.js";

export const RACE_IDENTITY_MIGRATION_ID = "race-identity-v1";

function toArray(collection) {
  return Array.from(collection?.values?.() ?? collection ?? []);
}

export function planRaceIdentityMigration({ actors = [] } = {}) {
  const operations = [];
  const conflicts = [];
  const unknownLabels = [];
  const actorList = toArray(actors);

  for (const actor of actorList) {
    const raceId = String(actor?.system?.identidad?.raceId ?? "").trim();
    const label = String(actor?.system?.identidad?.raza ?? "").trim();
    const info = { actorId: actor?.id ?? null, actorUuid: actor?.uuid ?? null, label };
    if (raceId) {
      if (!isValidRaceId(raceId)) conflicts.push({ ...info, type: "invalid-existing-race-id", raceId });
      continue;
    }
    if (!label) continue;
    const canonicalRaceId = getCanonicalRaceIdByLabel(label);
    if (!canonicalRaceId) {
      unknownLabels.push(info);
      continue;
    }
    operations.push({ actor, ...info, raceId: canonicalRaceId });
  }

  return {
    migrationId: RACE_IDENTITY_MIGRATION_ID,
    actorsScanned: actorList.length,
    operations,
    conflicts,
    unknownLabels
  };
}

export async function migrateRaceIdentities({ actors = globalThis.game?.actors ?? [] } = {}) {
  const plan = planRaceIdentityMigration({ actors });
  const errors = [];
  let actorsMigrated = 0;

  for (const operation of plan.operations) {
    try {
      const definition = getRaceDefinition(operation.raceId);
      await operation.actor.update({
        "system.identidad.raceId": definition.technicalId,
        "system.identidad.raza": definition.displayName
      }, { [RACE_IDENTITY_INTERNAL_UPDATE_OPTION]: true, render: false });
      actorsMigrated += 1;
    } catch (error) {
      errors.push({ actorUuid: operation.actorUuid, error: error.message });
    }
  }

  const report = {
    ...plan,
    operations: plan.operations.map(({ actor: _actor, ...operation }) => operation),
    actorsMigrated,
    raceIdsAssigned: actorsMigrated,
    attributesModified: 0,
    errors
  };
  const diagnostic = {
    migrationId: report.migrationId,
    actorsScanned: report.actorsScanned,
    actorsMigrated,
    conflicts: report.conflicts.length,
    unknownLabels: report.unknownLabels.length,
    errors: errors.length
  };
  if (report.conflicts.length || report.unknownLabels.length || errors.length) {
    logger.warn("MIGRATION", "Migración de identidad racial finalizada con incidencias", diagnostic);
  } else {
    logger.info("MIGRATION", "Migración de identidad racial finalizada", diagnostic);
  }
  return report;
}

