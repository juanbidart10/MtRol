import {
  getItemWeightContribution,
  isMtrolActor,
  isMtrolObject
} from "../items/item-invariants.js";

// =========================
// MTROL - CARRY WEIGHT
// =========================

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function calcularPesoMaximoPorFuerza(fuerza) {
  if (
    fuerza === null ||
    fuerza === undefined ||
    (typeof fuerza === "string" && fuerza.trim() === "")
  ) {
    throw new TypeError("La fuerza debe ser un valor numérico válido.");
  }

  const fuerzaNumerica = Number(fuerza);

  if (!Number.isFinite(fuerzaNumerica)) {
    throw new TypeError("La fuerza debe ser un valor numérico válido.");
  }

  return Math.max(1, fuerzaNumerica) * 10;
}

function isTokenMovement(tokenDocument, changes) {
  return ["x", "y", "elevation"].some(key => {
    if (!Object.prototype.hasOwnProperty.call(changes ?? {}, key)) {
      return false;
    }

    return toNumber(changes[key], 0) !==
      toNumber(tokenDocument?.[key], 0);
  });
}

function isMovementRequestedByGM(userId) {
  const requestingUser =
    game.users?.get?.(userId) ??
    (game.user?.id === userId ? game.user : null);

  return requestingUser?.isGM === true;
}

export function calcularCargaActor(actor) {
  if (!actor || !isMtrolActor(actor)) {
    return {
      pesoActual: 0,
      pesoMaximo: 0,
      pesoLibre: 0,
      sobrecargado: false
    };
  }

  const fuerzaData =
    actor.system?.atributos?.fuerza;

  const fuerza =
    fuerzaData?.value ?? fuerzaData;

  const pesoMaximo =
    calcularPesoMaximoPorFuerza(fuerza);

  const objetos =
    actor.items.filter(isMtrolObject);

  const pesoActual =
    objetos.reduce(
      (total, item) => total + getItemWeightContribution(item),
      0
    );

  const pesoLibre =
    Math.max(pesoMaximo - pesoActual, 0);

  return {
    pesoActual,
    pesoMaximo,
    pesoLibre,
    sobrecargado: pesoActual > pesoMaximo
  };
}

export function puedeCargarItem(_actor, _itemData) {
  // La capacidad limita el movimiento, no la adquisición de objetos.
  return true;
}

export function registrarHooksPesoMtrol() {
  Hooks.on("preUpdateToken", (tokenDocument, changes, _options, userId) => {
    if (!isTokenMovement(tokenDocument, changes)) return true;
    if (isMovementRequestedByGM(userId)) return true;

    const actor =
      tokenDocument?.actor;

    if (!actor || !isMtrolActor(actor)) return true;

    const carga =
      calcularCargaActor(actor);

    if (!carga.sobrecargado) return true;

    ui.notifications.warn(
      "El personaje est\u00e1 sobrecargado y no puede desplazarse."
    );

    return false;
  });

  console.log("MTROL | Sistema de carga registrado.");
}
