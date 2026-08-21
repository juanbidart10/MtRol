// =========================
// MTROL - DHARMA BURN ENGINE
// =========================
// Reglas puras y aisladas para preparar y resolver Dharma Burn.
//
// Este modulo no:
// - evalua ni modifica Rolls;
// - crea cadenas criticas;
// - acredita Dharma o Karma;
// - actualiza Actors;
// - crea ChatMessages;
// - renderiza UI.
// =========================

export const MTROL_DHARMA_MIN = 0;
export const MTROL_DHARMA_MAX = 5;

export const MTROL_DHARMA_SUPPORTED_FACES = Object.freeze([
  6,
  8,
  10,
  12,
  20
]);

const SUPPORTED_FACES =
  new Set(MTROL_DHARMA_SUPPORTED_FACES);

function toInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function assertNonNegativeIndex(value, name) {
  const index = toInteger(value);

  if (index === null || index < 0) {
    throw new TypeError(`${name} debe ser un entero mayor o igual a cero.`);
  }

  return index;
}

function getTerms(source) {
  if (Array.isArray(source)) return source;
  return Array.from(source?.terms ?? []);
}

function getSelectionId(selection) {
  if (typeof selection === "string") return selection;
  if (selection?.id) return String(selection.id);

  if (
    selection?.termIndex !== undefined &&
    selection?.resultIndex !== undefined
  ) {
    return createDharmaDieId(
      selection.termIndex,
      selection.resultIndex
    );
  }

  return "";
}

function normalizeSelectedDice(selectedDice) {
  if (!Array.isArray(selectedDice)) {
    throw new TypeError("selectedDice debe ser un arreglo.");
  }

  const normalized = [];
  const seen = new Set();

  for (const selection of selectedDice) {
    const id = getSelectionId(selection);

    if (!id) {
      throw new TypeError("Cada dado seleccionado debe tener una identidad valida.");
    }

    if (seen.has(id)) {
      throw new TypeError(`El dado ${id} fue seleccionado mas de una vez.`);
    }

    seen.add(id);
    normalized.push({
      id,
      termIndex: assertNonNegativeIndex(selection?.termIndex, "termIndex"),
      resultIndex: assertNonNegativeIndex(selection?.resultIndex, "resultIndex"),
      faces: toInteger(selection?.faces)
    });
  }

  return normalized;
}

function validateNaturalResult(faces, naturalResult) {
  const result = toInteger(naturalResult);

  if (
    result === null ||
    result < 1 ||
    result > faces
  ) {
    throw new RangeError(
      `El resultado natural de D${faces} debe estar entre 1 y ${faces}.`
    );
  }

  return result;
}

export function isDharmaSupportedDieFaces(faces) {
  return SUPPORTED_FACES.has(Number(faces));
}

export function formulaHasDharmaEligibleDice(formula) {
  const source = String(formula ?? "");
  const dicePattern = /(?:^|[^A-Za-z0-9_])(\d*)[dD](\d+)(?![A-Za-z0-9_])/g;

  for (const match of source.matchAll(dicePattern)) {
    const count = match[1] === "" ? 1 : Number(match[1]);
    if (count > 0 && isDharmaSupportedDieFaces(match[2])) return true;
  }

  return false;
}

export function createDharmaDieId(termIndex, resultIndex) {
  const safeTermIndex =
    assertNonNegativeIndex(termIndex, "termIndex");

  const safeResultIndex =
    assertNonNegativeIndex(resultIndex, "resultIndex");

  return `initial:${safeTermIndex}:${safeResultIndex}`;
}

export function getDharmaEligibleInitialDice(source) {
  const dice = [];
  const occurrencesByFaces = new Map();

  for (const [termIndex, term] of getTerms(source).entries()) {
    const faces = toInteger(term?.faces);
    const number = toInteger(term?.number);

    if (!isDharmaSupportedDieFaces(faces)) continue;
    if (number === null || number <= 0) continue;

    for (let resultIndex = 0; resultIndex < number; resultIndex++) {
      const occurrence =
        (occurrencesByFaces.get(faces) ?? 0) + 1;

      occurrencesByFaces.set(faces, occurrence);

      dice.push({
        id: createDharmaDieId(termIndex, resultIndex),
        termIndex,
        resultIndex,
        faces,
        occurrence,
        label: `D${faces} #${occurrence}`
      });
    }
  }

  return dice;
}

export function validateDharmaSpend({
  availableDharma,
  selectedDice = [],
  eligibleDice = []
} = {}) {
  const available = toInteger(availableDharma);
  const selections = Array.isArray(selectedDice) ? selectedDice : [];
  const eligible = Array.isArray(eligibleDice) ? eligibleDice : [];
  const eligibleById = new Map(
    eligible.map(die => [String(die?.id ?? ""), die])
  );
  const selectedIds = [];
  const selectedIdSet = new Set();
  const errors = [];

  if (
    available === null ||
    available < MTROL_DHARMA_MIN ||
    available > MTROL_DHARMA_MAX
  ) {
    errors.push({
      code: "invalid-balance",
      message: `El Dharma disponible debe ser un entero entre ${MTROL_DHARMA_MIN} y ${MTROL_DHARMA_MAX}.`
    });
  }

  for (const selection of selections) {
    const id = getSelectionId(selection);

    if (!id || !eligibleById.has(id)) {
      errors.push({
        code: "invalid-selection",
        message: `El dado seleccionado ${id || "(sin identidad)"} no pertenece a los dados iniciales elegibles.`
      });
      continue;
    }

    if (selectedIdSet.has(id)) {
      errors.push({
        code: "duplicate-selection",
        message: `El dado ${id} fue seleccionado mas de una vez.`
      });
      continue;
    }

    selectedIdSet.add(id);
    selectedIds.push(id);
  }

  const cost = selectedIds.length;

  if (cost > MTROL_DHARMA_MAX) {
    errors.push({
      code: "maximum-exceeded",
      message: `No se pueden gastar mas de ${MTROL_DHARMA_MAX} puntos de Dharma.`
    });
  }

  if (available !== null && cost > available) {
    errors.push({
      code: "insufficient-balance",
      message: `Dharma insuficiente: disponible ${available}, requerido ${cost}.`
    });
  }

  return {
    valid: errors.length === 0,
    enabled: cost > 0 && errors.length === 0,
    availableDharma: available,
    cost,
    selectedDice: selectedIds.map(id => eligibleById.get(id)),
    selectedIds,
    errors
  };
}

export function createDharmaSpendContext({
  actorUuid,
  selectedDice,
  transactionId
} = {}) {
  const safeActorUuid = String(actorUuid ?? "").trim();
  const safeTransactionId = String(transactionId ?? "").trim();
  const normalizedDice = normalizeSelectedDice(selectedDice ?? []);

  if (!safeActorUuid) {
    throw new TypeError("actorUuid es obligatorio para preparar Dharma Burn.");
  }

  if (!safeTransactionId) {
    throw new TypeError("transactionId es obligatorio para preparar Dharma Burn.");
  }

  if (normalizedDice.length < 1 || normalizedDice.length > MTROL_DHARMA_MAX) {
    throw new RangeError(
      `Dharma Burn requiere entre 1 y ${MTROL_DHARMA_MAX} dados seleccionados.`
    );
  }

  return {
    version: 1,
    enabled: true,
    state: "prepared",
    actorUuid: safeActorUuid,
    selectedDice: normalizedDice,
    selectedIds: normalizedDice.map(die => die.id),
    cost: normalizedDice.length,
    transactionId: safeTransactionId,
    receipt: null
  };
}

export function markDharmaSpendConsumed(context, receipt) {
  if (
    context?.enabled !== true ||
    context?.state !== "prepared"
  ) {
    throw new TypeError("El contexto de Dharma no esta preparado para consumirse.");
  }

  if (receipt?.authorized !== true) {
    throw new TypeError("El consumo de Dharma no fue autorizado.");
  }

  const contextSelectedIds =
    Array.from(context.selectedIds ?? []).map(String).sort();

  const receiptSelectedIds =
    Array.from(receipt.selectedIds ?? []).map(String).sort();

  if (
    receipt.actorUuid !== context.actorUuid ||
    receipt.transactionId !== context.transactionId ||
    Number(receipt.cost) !== context.cost ||
    JSON.stringify(receiptSelectedIds) !== JSON.stringify(contextSelectedIds)
  ) {
    throw new TypeError("El recibo de Dharma no coincide con el contexto preparado.");
  }

  return {
    ...context,
    state: "consumed",
    receipt: {
      ...receipt
    }
  };
}

export function getDharmaNaturalRule(faces, naturalResult) {
  const safeFaces = toInteger(faces);

  if (!isDharmaSupportedDieFaces(safeFaces)) {
    throw new RangeError(`D${faces} no admite Dharma Burn.`);
  }

  const safeNaturalResult =
    validateNaturalResult(safeFaces, naturalResult);

  if (safeFaces === 6) {
    return {
      critical: false,
      fumble: safeNaturalResult === 1
    };
  }

  return {
    critical: safeNaturalResult === 1,
    fumble: safeNaturalResult === 2
  };
}

export function resolveDharmaInitialDie({
  die,
  naturalResult,
  selected = true,
  initial = true
} = {}) {
  const faces = toInteger(die?.faces);

  if (!isDharmaSupportedDieFaces(faces)) {
    throw new RangeError(`D${die?.faces} no admite Dharma Burn.`);
  }

  const termIndex =
    assertNonNegativeIndex(die?.termIndex, "termIndex");

  const resultIndex =
    assertNonNegativeIndex(die?.resultIndex, "resultIndex");

  const dieId =
    die?.id ?? createDharmaDieId(termIndex, resultIndex);

  const safeNaturalResult =
    validateNaturalResult(faces, naturalResult);

  const naturalRule =
    getDharmaNaturalRule(faces, safeNaturalResult);

  const protectedByDharma =
    selected === true && initial === true;

  const trace = {
    dieId: String(dieId),
    termIndex,
    resultIndex,
    faces,
    initial: initial === true,
    selected: selected === true,
    protectedByDharma,
    naturalResult: safeNaturalResult,
    effectiveResult: safeNaturalResult,
    naturalCritical: naturalRule.critical,
    critical: naturalRule.critical,
    naturalFumble: naturalRule.fumble,
    fumble: naturalRule.fumble,
    fumblePrevented: false,
    dharmaBonus: 0,
    requiresPostCriticalBonus: false,
    criticalResolvedResult: null,
    dharmaBonusAfterCritical: 0,
    finalResult: safeNaturalResult
  };

  if (!protectedByDharma) return trace;

  if (naturalRule.critical) {
    return {
      ...trace,
      requiresPostCriticalBonus: true,
      finalResult: null
    };
  }

  const effectiveResult =
    safeNaturalResult + 1;

  return {
    ...trace,
    effectiveResult,
    fumble: false,
    fumblePrevented: naturalRule.fumble,
    dharmaBonus: 1,
    finalResult: effectiveResult
  };
}

export function finalizeDharmaCritical(
  trace,
  criticalResolvedResult
) {
  if (
    trace?.protectedByDharma !== true ||
    trace?.naturalCritical !== true ||
    trace?.requiresPostCriticalBonus !== true
  ) {
    throw new TypeError(
      "La traza no corresponde a un critico inicial protegido pendiente de finalizar."
    );
  }

  const resolvedResult =
    Number(criticalResolvedResult);

  if (!Number.isFinite(resolvedResult)) {
    throw new TypeError(
      "El resultado critico resuelto debe ser numerico."
    );
  }

  return {
    ...trace,
    requiresPostCriticalBonus: false,
    criticalResolvedResult: resolvedResult,
    dharmaBonusAfterCritical: 1,
    finalResult: resolvedResult + 1
  };
}
