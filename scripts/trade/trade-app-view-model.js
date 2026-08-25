export function buildOwnOfferEntries(session, participantKey) {
  return (session?.publicOffers?.[participantKey] ?? []).map(entry => ({
    itemUuid: entry.itemUuid,
    itemId: entry.itemId,
    quantity: entry.quantity
  }));
}

export function upsertOwnOfferEntry(entries, nextEntry) {
  return [
    ...entries.filter(entry => entry.itemUuid !== nextEntry.itemUuid),
    {
      itemUuid: nextEntry.itemUuid,
      itemId: nextEntry.itemId,
      quantity: nextEntry.quantity
    }
  ];
}

export function removeOwnOfferEntry(entries, itemUuid) {
  return entries.filter(entry => entry.itemUuid !== itemUuid);
}

export function buildTradeAppRenderContext({
  session,
  view,
  inspector = null,
  busy = false,
  editingConfirmedOffer = false
}) {
  const ownParticipant = session.participants[view.participantKey];
  const otherParticipant = session.participants[view.rivalKey];
  const availabilityByUuid = new Map(
    view.privateInventory.items.map(item => [item.itemUuid, item.availableIncludingSession])
  );

  return {
    session: {
      id: session.id,
      state: session.state,
      revision: session.revision,
      participants: session.participants
    },
    myInventory: view.privateInventory,
    myOffer: view.ownOffer.map(entry => ({
      ...entry,
      maximum: availabilityByUuid.get(entry.itemUuid) ?? entry.quantity
    })),
    otherOffer: view.rivalOffer,
    confirmations: view.confirmations,
    inspector,
    uiState: {
      participantKey: view.participantKey,
      ownName: ownParticipant.actorName || "Mi personaje",
      otherName: otherParticipant.actorName || "Otro personaje",
      ownImg: ownParticipant.actorImg || "icons/svg/mystery-man.svg",
      otherImg: otherParticipant.actorImg || "icons/svg/mystery-man.svg",
      requested: session.state === "REQUESTED",
      waitingAcceptance: session.state === "REQUESTED" && view.participantKey === "participantA",
      canAccept: session.state === "REQUESTED" && view.participantKey === "participantB",
      busy,
      executing: session.state === "EXECUTING",
      invalid: view.hasInvalidEntry,
      canEdit: view.canEditOffer && !busy && (!view.confirmations.own || editingConfirmedOffer),
      canUnlockConfirmedOffer: view.canEditOffer && view.confirmations.own && !editingConfirmedOffer && !busy,
      canConfirm: view.canEditOffer && !view.confirmations.own && !view.hasInvalidEntry && !busy,
      ownConfirmed: view.confirmations.own,
      otherConfirmed: view.confirmations.rival,
      ready: session.state === "READY",
      interactionDisabled: busy || session.state === "EXECUTING"
    }
  };
}
