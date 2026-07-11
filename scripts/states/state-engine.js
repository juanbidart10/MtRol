const SYSTEM_ID = "mtrol";
const STATES_FLAG = "states";

const STATE_LABELS = {
  stunned: "Stunned",
  dead: "Dead"
};

function getActorFromActorOrToken(actorOrToken) {
  return actorOrToken?.actor ?? actorOrToken?.document?.actor ?? actorOrToken ?? null;
}

function getTokenDocumentFromActorOrToken(actorOrToken) {
  return actorOrToken?.documentName === "Token"
    ? actorOrToken
    : actorOrToken?.document ?? null;
}

function getStateLabel(state) {
  return STATE_LABELS[state] ?? state;
}

async function applyStatusEffect(actorOrToken, state) {
  const statusId =
    state === "dead" ? "dead" : state;

  const token =
    actorOrToken?.object ?? actorOrToken;

  try {
    if (typeof token?.toggleEffect === "function") {
      const status =
        CONFIG.statusEffects?.find(effect => effect.id === statusId || effect.statuses?.has?.(statusId));

      if (status) {
        await token.toggleEffect(status, { active: true });
      }
    }
  } catch (error) {
    console.warn("MTROL | No se pudo aplicar icono de estado en token.", error);
  }
}

async function createStateEffect(actor, state) {
  const existing =
    actor.effects?.find(effect =>
      effect.getFlag?.(SYSTEM_ID, "state") === state ||
      effect.statuses?.has?.(state)
    );

  if (existing) return existing;

  const status =
    CONFIG.statusEffects?.find(effect => effect.id === state || effect.statuses?.has?.(state));

  const data = {
    name: `MTROL | ${getStateLabel(state)}`,
    icon: status?.img ?? status?.icon ?? "icons/svg/aura.svg",
    disabled: false,
    flags: {
      [SYSTEM_ID]: {
        state
      }
    }
  };

  if (state) {
    data.statuses = [state];
  }

  const [effect] =
    await actor.createEmbeddedDocuments("ActiveEffect", [data]);

  return effect;
}

async function applyStateDirect(actorOrToken, state, options = {}) {
  const actor =
    getActorFromActorOrToken(actorOrToken);

  if (!actor) {
    throw new Error("No se encontro actor para aplicar estado.");
  }

  const currentStates =
    foundry.utils.duplicate(actor.getFlag(SYSTEM_ID, STATES_FLAG) ?? {});

  if (!currentStates[state]) {
    currentStates[state] = {
      state,
      source: options.source ?? null,
      appliedBy: game.user?.id ?? null,
      appliedAt: Date.now()
    };

    await actor.setFlag(SYSTEM_ID, STATES_FLAG, currentStates);
  }

  await createStateEffect(actor, state);
  await applyStatusEffect(actorOrToken, state);

  const data = {
    actorUuid: actor.uuid,
    state,
    source: options.source ?? null
  };

  console.log("MTROL | State applied", data);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="mtrol-chat-card">
        <h2>Estado aplicado</h2>
        <p><strong>${foundry.utils.escapeHTML(actor.name)}</strong> recibe <strong>${foundry.utils.escapeHTML(getStateLabel(state))}</strong>.</p>
      </div>
    `
  });

  return data;
}

export async function applyState(actorOrToken, state, options = {}) {
  const actor =
    getActorFromActorOrToken(actorOrToken);

  if (!actor || !state) {
    throw new Error("Estado MTROL incompleto.");
  }

  if (game.user?.isGM || actor.isOwner) {
    return applyStateDirect(actorOrToken, state, options);
  }

  game.socket.emit("system.mtrol", {
    action: "mtrolApplyState",
    actorUuid: actor.uuid,
    tokenUuid: getTokenDocumentFromActorOrToken(actorOrToken)?.uuid ?? null,
    state,
    options
  });

  return {
    delegated: true,
    actorUuid: actor.uuid,
    state
  };
}

export async function applyStateFromSocket(data = {}) {
  const tokenDocument =
    data.tokenUuid ? await fromUuid(data.tokenUuid) : null;

  const actor =
    tokenDocument?.actor ??
    (data.actorUuid ? await fromUuid(data.actorUuid) : null);

  return applyStateDirect(tokenDocument ?? actor, data.state, data.options ?? {});
}

export function installMtrolStatesApi() {
  game.mtrol = game.mtrol || {};
  game.mtrol.states = {
    applyState
  };
}
