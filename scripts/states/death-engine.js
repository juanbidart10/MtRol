import {
  applyState
} from "./state-engine.js";

let deathHooksRegistered = false;

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export async function applyDeadIfNeeded(actor, options = {}) {
  if (!actor) return false;

  const hp =
    toNumber(actor.system?.vitales?.hp?.value, 0);

  if (hp > 0) return false;

  const states =
    actor.getFlag(game.system?.id ?? "mtrol", "states") ?? {};

  if (states.dead) return false;

  await applyState(actor, "dead", {
    ...options,
    source: options.source ?? "hp-zero"
  });

  return true;
}

export function installMtrolDeathApi() {
  game.mtrol = game.mtrol || {};
  game.mtrol.states = game.mtrol.states || {};
  game.mtrol.states.applyDeadIfNeeded = applyDeadIfNeeded;

  if (deathHooksRegistered) return;

  Hooks.on("updateActor", actor => {
    if (!game.user?.isGM) return;

    applyDeadIfNeeded(actor).catch(error => {
      console.warn("MTROL | No se pudo aplicar muerte automatica.", error);
    });
  });

  deathHooksRegistered = true;
}
