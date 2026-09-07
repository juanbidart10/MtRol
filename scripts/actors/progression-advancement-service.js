import {
  evaluateProgression,
  getRequirementsForLevel,
  MTROL_PROGRESSION_ATTRIBUTE_KEYS
} from "./progression-engine.js";

import {
  getAttributeCap,
  getCompetenceCap
} from "../progression/progression-caps.js";

import {
  runActorResourceTransaction
} from "./actor-resource-service.js";

import {
  requestPrimaryGM
} from "../core/socket-requests.js";

import {
  isProgressionCompetence
} from "../progression/progression-competence.js";

import {
  getActorResourceTransitionUpdate
} from "./class-resource-service.js";
import {
  resolveCompetencyProgressionGain,
  resolveProgressionGain
} from "../effects/progression-policy.js";

function createTransactionId() {
  return foundry.utils.randomID?.() ?? crypto.randomUUID();
}

function getUser(userId) {
  if (typeof game.users?.get === "function") return game.users.get(userId);
  return Array.from(game.users ?? []).find(user => user.id === userId) ?? null;
}

function getCanonicalActor(payload, trustedActor = null) {
  if (trustedActor && trustedActor.uuid === payload.actorUuid) {
    return Promise.resolve(trustedActor);
  }
  return fromUuid(String(payload.actorUuid ?? ""));
}

function assertPayloadKeys(payload, allowedKeys) {
  const unexpected = Object.keys(payload ?? {}).filter(key => !allowedKeys.has(key));
  if (unexpected.length > 0) {
    throw new Error(`Payload de progresión inválido: ${unexpected.join(", ")}.`);
  }
}

function assertIntegerSnapshot(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${label} esperado inválido.`);
  }
  return number;
}

function assertCanSpend(actor, requestingUserId) {
  const user = getUser(requestingUserId);
  if (!user || (!user.isGM && actor?.testUserPermission?.(user, "OWNER") !== true)) {
    throw new Error("El usuario no tiene permiso para gastar mejoras de este Actor.");
  }
}

function assertGmRequest(requestingUserId) {
  const user = getUser(requestingUserId);
  if (!user?.isGM) throw new Error("Sólo un GM puede ejecutar el level-up.");
}

function readNonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function readFiniteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} actual inválido.`);
  return number;
}

function readPolicyIntegerGain(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${label} produjo una ganancia incompatible con el schema entero.`);
  }
  return number;
}

function getMigrationStableFields(actor) {
  const progression = actor.system?.progression ?? {};
  const pending = actor.system?.pendingAdvancement ?? {};
  const alignment = actor.system?.alignment ?? {};

  return {
    "system.progression.missionsCompleted": readNonNegativeInteger(progression.missionsCompleted),
    "system.progression.dungeonsCompleted": readNonNegativeInteger(progression.dungeonsCompleted),
    "system.progression.meritCredits": readNonNegativeInteger(progression.meritCredits),
    "system.progression.defeatedLevel5Enemy": progression.defeatedLevel5Enemy === true,
    "system.progression.dmApproval": progression.dmApproval === true,
    "system.pendingAdvancement.attributePoints": readNonNegativeInteger(pending.attributePoints),
    "system.pendingAdvancement.competencePoints": readNonNegativeInteger(pending.competencePoints),
    "system.awakening.grants": structuredClone(actor.system?.awakening?.grants ?? []),
    "system.awakening.selections": structuredClone(actor.system?.awakening?.selections ?? []),
    "system.orbs": structuredClone(actor.system?.orbs ?? []),
    "system.alignment.type": alignment.type ?? null,
    "system.alignment.unlocked": alignment.unlocked === true
  };
}

export async function levelUpActorAuthoritative(payload = {}, {
  requestingUserId = game.user?.id,
  trustedActor = null
} = {}) {
  assertPayloadKeys(payload, new Set(["actorUuid", "transactionId", "expectedLevel"]));
  assertGmRequest(requestingUserId);

  const actor = await getCanonicalActor(payload, trustedActor);
  if (!actor) throw new Error("No se encontró el Actor para subir de nivel.");
  const expectedLevel = assertIntegerSnapshot(payload.expectedLevel, "Nivel");

  return runActorResourceTransaction(actor, {
    transactionId: payload.transactionId,
    origin: "level-up",
    tracksWrites: true
  }, async (canonicalActor, { beforeWrite }) => {
    const evaluation = evaluateProgression(canonicalActor);
    const currentLevel = Number(canonicalActor.system?.recursos?.nivel ?? 1);

    if (!Number.isInteger(currentLevel) || currentLevel < 1) {
      throw new Error("El nivel actual del Actor es inválido.");
    }
    if (currentLevel >= 5 || evaluation.maximumLevel) {
      throw new Error("El Actor ya está en el nivel máximo.");
    }
    if (currentLevel !== expectedLevel) {
      throw new Error("El nivel del Actor cambió; se canceló el ascenso duplicado.");
    }
    if (!evaluation.eligible) {
      throw new Error("El Actor ya no cumple todos los requisitos de ascenso.");
    }

    const definition = getRequirementsForLevel(currentLevel);
    const requiredMvp = Number(
      definition.requirements.find(requirement => requirement.key === "mvp")?.required ?? 0
    );
    const requiredExp = Number(definition.requiredExp ?? 0);
    const hpValue = readFiniteNumber(canonicalActor.system?.vitales?.hp?.value, "HP");
    const hpMax = readFiniteNumber(canonicalActor.system?.vitales?.hp?.max, "HP máximo");
    const mpValue = readFiniteNumber(canonicalActor.system?.vitales?.mp?.value, "MP");
    const mpMax = readFiniteNumber(canonicalActor.system?.vitales?.mp?.max, "MP máximo");
    const attributePoints = readNonNegativeInteger(
      canonicalActor.system?.pendingAdvancement?.attributePoints
    );
    const competencePoints = readNonNegativeInteger(
      canonicalActor.system?.pendingAdvancement?.competencePoints
    );
    const attributePointGain = readPolicyIntegerGain(
      resolveProgressionGain(canonicalActor, 1).value,
      "ProgressionPolicy"
    );
    const competencePointGain = readPolicyIntegerGain(
      resolveCompetencyProgressionGain(canonicalActor, 1).value,
      "CompetencyProgressionPolicy"
    );
    const changes = {
      ...getMigrationStableFields(canonicalActor),
      "system.recursos.nivel": currentLevel + 1,
      "system.recursos.exp": evaluation.current.exp - requiredExp,
      "system.recursos.mvp": evaluation.current.mvp - requiredMvp,
      "system.pendingAdvancement.attributePoints": attributePoints + attributePointGain,
      "system.pendingAdvancement.competencePoints": competencePoints + competencePointGain
    };

    const resourceTransition = getActorResourceTransitionUpdate(canonicalActor, {
      level: currentLevel + 1
    });
    if (resourceTransition.transition.active) {
      Object.assign(changes, resourceTransition.changes);
    } else {
      Object.assign(changes, {
        "system.vitales.hp.value": hpValue + 10,
        "system.vitales.hp.max": hpMax + 10,
        "system.vitales.mp.value": mpValue + 10,
        "system.vitales.mp.max": mpMax + 10
      });
    }

    await beforeWrite();

    await canonicalActor.update(changes, { mtrolClassResourceTransition: true });

    return {
      authorized: true,
      levelBefore: currentLevel,
      levelAfter: currentLevel + 1,
      expSpent: requiredExp,
      expAfter: changes["system.recursos.exp"],
      mvpSpent: requiredMvp,
      mvpAfter: changes["system.recursos.mvp"],
      attributePointsAfter: attributePoints + attributePointGain,
      competencePointsAfter: competencePoints + competencePointGain,
      attributePointGain,
      competencePointGain
    };
  });
}

export async function spendPendingAttributePointAuthoritative(payload = {}, {
  requestingUserId = game.user?.id,
  trustedActor = null
} = {}) {
  assertPayloadKeys(payload, new Set([
    "actorUuid", "transactionId", "attributeKey", "expectedValue", "expectedPendingPoints"
  ]));
  const actor = await getCanonicalActor(payload, trustedActor);
  if (!actor) throw new Error("No se encontró el Actor para asignar el atributo.");
  assertCanSpend(actor, requestingUserId);

  const attributeKey = String(payload.attributeKey ?? "");
  if (!MTROL_PROGRESSION_ATTRIBUTE_KEYS.includes(attributeKey)) {
    throw new Error("El atributo solicitado no existe.");
  }
  const expectedValue = assertIntegerSnapshot(payload.expectedValue, "Valor de atributo");
  const expectedPending = assertIntegerSnapshot(payload.expectedPendingPoints, "Pending de atributo");

  return runActorResourceTransaction(actor, {
    transactionId: payload.transactionId,
    origin: "pending-attribute",
    tracksWrites: true
  }, async (canonicalActor, { beforeWrite }) => {
    const pending = readNonNegativeInteger(canonicalActor.system?.pendingAdvancement?.attributePoints);
    const current = Number(canonicalActor.system?.atributos?.[attributeKey]);
    const cap = getAttributeCap(canonicalActor);

    if (pending < 1) throw new Error("No hay puntos de atributo pendientes.");
    if (pending !== expectedPending || current !== expectedValue) {
      throw new Error("El estado del atributo cambió; se canceló el gasto duplicado.");
    }
    if (!Number.isInteger(current)) throw new Error("El valor actual del atributo es inválido.");
    if (current >= cap) throw new Error("El atributo ya alcanzó su máximo actual.");

    const resourceTransition = getActorResourceTransitionUpdate(canonicalActor, {
      ...(attributeKey === "resistencia" ? { resistance: current + 1 } : {}),
      ...(attributeKey === "inteligencia" ? { intelligence: current + 1 } : {})
    });

    await beforeWrite();

    await canonicalActor.update({
      ...getMigrationStableFields(canonicalActor),
      [`system.atributos.${attributeKey}`]: current + 1,
      "system.pendingAdvancement.attributePoints": pending - 1,
      ...resourceTransition.changes
    }, { mtrolClassResourceTransition: true });

    return {
      authorized: true,
      attributeKey,
      valueBefore: current,
      valueAfter: current + 1,
      pendingAfter: pending - 1
    };
  });
}

export async function spendPendingCompetencePointAuthoritative(payload = {}, {
  requestingUserId = game.user?.id,
  trustedActor = null
} = {}) {
  assertPayloadKeys(payload, new Set([
    "actorUuid", "transactionId", "itemId", "expectedValue", "expectedPendingPoints"
  ]));
  const actor = await getCanonicalActor(payload, trustedActor);
  if (!actor) throw new Error("No se encontró el Actor para asignar la competencia.");
  assertCanSpend(actor, requestingUserId);

  const itemId = String(payload.itemId ?? "");
  const expectedValue = assertIntegerSnapshot(payload.expectedValue, "Nivel de competencia");
  const expectedPending = assertIntegerSnapshot(payload.expectedPendingPoints, "Pending de competencia");

  return runActorResourceTransaction(actor, {
    transactionId: payload.transactionId,
    origin: "pending-competence",
    tracksWrites: true
  }, async (canonicalActor, { beforeWrite }) => {
    const item = canonicalActor.items?.get?.(itemId) ?? null;
    if (!item) {
      throw new Error("La competencia solicitada no pertenece al Actor.");
    }
    if (!isProgressionCompetence(item)) {
      throw new Error("El Item solicitado no es una competencia de progresión.");
    }
    const pending = readNonNegativeInteger(canonicalActor.system?.pendingAdvancement?.competencePoints);
    const current = Number(item.system?.nivel);
    const cap = getCompetenceCap(canonicalActor);

    if (pending < 1) throw new Error("No hay puntos de competencia pendientes.");
    if (pending !== expectedPending || current !== expectedValue) {
      throw new Error("El estado de la competencia cambió; se canceló el gasto duplicado.");
    }
    if (!Number.isInteger(current)) throw new Error("El nivel actual de la competencia es inválido.");
    if (current >= cap) throw new Error("La competencia ya alcanzó su máximo actual.");

    await beforeWrite();

    await item.update({ "system.nivel": current + 1 });
    try {
      await beforeWrite();
      await canonicalActor.update({
        ...getMigrationStableFields(canonicalActor),
        "system.pendingAdvancement.competencePoints": pending - 1
      });
    } catch (error) {
      // No blind compensation after an ambiguous Actor write.
      if (error.transactionNoEffects === true && Number(item.system?.nivel) === current + 1) {
        await item.update({ "system.nivel": current });
        error.transactionRolledBack = Number(item.system?.nivel) === current;
      }
      throw error;
    }

    return {
      authorized: true,
      itemId: item.id,
      valueBefore: current,
      valueAfter: current + 1,
      pendingAfter: pending - 1
    };
  });
}

export async function requestLevelUp(actor) {
  if (!game.user?.isGM) throw new Error("Sólo un GM puede ejecutar el level-up.");
  return levelUpActorAuthoritative({
    actorUuid: actor.uuid,
    transactionId: createTransactionId(),
    expectedLevel: Number(actor.system?.recursos?.nivel ?? 1)
  }, { requestingUserId: game.user.id, trustedActor: actor });
}

export async function spendPendingAttributePoint(actor, attributeKey) {
  const payload = {
    actorUuid: actor.uuid,
    transactionId: createTransactionId(),
    attributeKey,
    expectedValue: Number(actor.system?.atributos?.[attributeKey]),
    expectedPendingPoints: readNonNegativeInteger(actor.system?.pendingAdvancement?.attributePoints)
  };
  if (game.user?.isGM) {
    return spendPendingAttributePointAuthoritative(payload, {
      requestingUserId: game.user.id,
      trustedActor: actor
    });
  }
  const response = await requestPrimaryGM("mtrolSpendPendingAttribute", payload);
  if (!response.ok) throw new Error(response.error ?? "No se pudo asignar el atributo.");
  return response.result?.receipt ?? null;
}

export async function spendPendingCompetencePoint(actor, itemId) {
  const item = actor.items?.get?.(itemId) ?? null;
  const payload = {
    actorUuid: actor.uuid,
    transactionId: createTransactionId(),
    itemId,
    expectedValue: Number(item?.system?.nivel),
    expectedPendingPoints: readNonNegativeInteger(actor.system?.pendingAdvancement?.competencePoints)
  };
  if (game.user?.isGM) {
    return spendPendingCompetencePointAuthoritative(payload, {
      requestingUserId: game.user.id,
      trustedActor: actor
    });
  }
  const response = await requestPrimaryGM("mtrolSpendPendingCompetence", payload);
  if (!response.ok) throw new Error(response.error ?? "No se pudo asignar la competencia.");
  return response.result?.receipt ?? null;
}
