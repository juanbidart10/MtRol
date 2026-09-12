let reservationProvider = () => 0;
let globalReservationProvider = () => 0;

export function configureTradeReservationBoundary({ getReservedQuantity, getGlobalReservedQuantity } = {}) {
  reservationProvider = typeof getReservedQuantity === "function"
    ? getReservedQuantity
    : () => 0;
  globalReservationProvider = typeof getGlobalReservedQuantity === "function"
    ? getGlobalReservedQuantity
    : () => 0;
}

export function getTradeReservedQuantity(actorUuid, itemReference) {
  return Math.max(0, Number(reservationProvider(actorUuid, itemReference) ?? 0) +
    Number(globalReservationProvider(actorUuid, itemReference) ?? 0));
}

export function getTradeEffectiveAvailability(actorUuid, item, realQuantity) {
  const reserved = getTradeReservedQuantity(actorUuid, {
    itemUuid: item?.uuid ?? null,
    itemId: item?.id ?? null
  });
  return {
    real: Math.max(0, Number(realQuantity) || 0),
    reserved,
    available: Math.max(0, (Number(realQuantity) || 0) - reserved)
  };
}

export function assertTradeQuantityAvailable(actorUuid, item, realQuantity, requestedQuantity) {
  const availability = getTradeEffectiveAvailability(actorUuid, item, realQuantity);
  if (Number(requestedQuantity) > availability.available) {
    const error = new Error("La cantidad está reservada por un comercio activo.");
    error.reasonCode = "TRADE_QUANTITY_RESERVED";
    error.availability = availability;
    throw error;
  }
  return availability;
}
