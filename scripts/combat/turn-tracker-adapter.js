import {
  buildSpecialAbilitySlotView,
  resolveSpecialAbilitySlot,
  updateSpecialAbilitySlot
} from "./special-ability-service.js";
import { logger } from "../utils/logger.js";

function collectionValues(collection) {
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection?.contents)) return collection.contents;
  if (typeof collection?.values === "function") return Array.from(collection.values());
  return Array.from(collection ?? []);
}

function escapeTrackerText(value) {
  return globalThis.foundry?.utils?.escapeHTML?.(String(value ?? "")) ?? String(value ?? "");
}

function getActorStatusLabels(actor) {
  return collectionValues(actor?.effects)
    .filter(effect => effect?.disabled !== true)
    .map(effect => effect.name ?? effect.label)
    .filter(Boolean)
    .slice(0, 3);
}

export function buildGMCombatStatePanel(context, api) {
  const cards = collectionValues(context.combat?.combatants ?? context.combat?.turns).map(combatant => {
    const actor = combatant.actor;
    const state = api.getCombatantTurnState(combatant);
    const active = combatant.id === context.combatant?.id;
    const specials = [1, 2].map(slot => buildSpecialAbilitySlotView(actor, slot, {
      getCooldownStatus: api.getItemCooldownStatus,
      getActionGuard: () => ({ allowed: true, reason: null }),
      viewerIsGM: true
    }));
    const specialHTML = specials.map(special => `
      <div class="mtrol-gm-special ${special.locked ? "is-locked" : ""}">
        <span>${escapeTrackerText(special.label)}</span>
        <strong>${escapeTrackerText(special.name)}</strong>
        <em>${escapeTrackerText(special.status)}</em>
        <button type="button" data-mtrol-gm-special-lock data-actor-uuid="${escapeTrackerText(actor?.uuid)}" data-special-slot="${special.slot}">
          ${special.unlocked ? "Bloquear" : "Desbloquear"}
        </button>
      </div>
    `).join("");
    const statuses = getActorStatusLabels(actor);
    return `
      <article class="mtrol-gm-combatant ${active ? "is-active" : ""}">
        <header><strong>${escapeTrackerText(actor?.name ?? combatant.name ?? "Combatant")}</strong>
          ${active ? "<span>TURNO ACTIVO</span>" : ""}</header>
        <div class="mtrol-gm-turn-metrics">
          <span>Movimiento <strong>${api.getAvailableMovement(actor).remaining}</strong></span>
          <span>Preparación <strong>+${api.getPreparation(actor)}</strong></span>
          <span>Acción <strong>${state.actionConsumed ? "Consumida" : "Disponible"}</strong></span>
        </div>
        <div class="mtrol-gm-preparation-controls">
          <button type="button" data-mtrol-gm-preparation data-actor-uuid="${escapeTrackerText(actor?.uuid)}" data-delta="-1">− Prep.</button>
          <button type="button" data-mtrol-gm-preparation data-actor-uuid="${escapeTrackerText(actor?.uuid)}" data-delta="1">+ Prep.</button>
        </div>
        <div class="mtrol-gm-specials">${specialHTML}</div>
        ${statuses.length ? `<div class="mtrol-gm-statuses">${statuses.map(status => `<span>${escapeTrackerText(status)}</span>`).join("")}</div>` : ""}
      </article>`;
  }).join("");
  return `<details class="mtrol-gm-combat-state" open><summary>Estado de combate MTROL</summary>
    <div class="mtrol-gm-combat-state-grid">${cards}</div></details>`;
}

export function decorateCombatTracker(root, context, api) {
  const grantedMovement = api.getGrantedMovement(null, context);
  const activeState = api.getCombatantTurnState(context.combatant);
  root.querySelectorAll("[data-combatant-id]").forEach(row => {
    row.classList.remove("mtrol-active-combatant");
    row.querySelectorAll(".mtrol-turn-indicator, .mtrol-movement-indicator, .mtrol-granted-movement-indicator, .mtrol-follow-up-indicator")
      .forEach(node => node.remove());
    const target = row.querySelector(".combatant-name, .token-name") ?? row;
    const rowCombatant = collectionValues(context.combat?.combatants ?? context.combat?.turns)
      .find(combatant => combatant.id === row.dataset.combatantId);
    if (row.dataset.combatantId === context.combatant?.id) {
      row.classList.add("mtrol-active-combatant");
      const active = document.createElement("span");
      active.className = "mtrol-turn-indicator";
      active.textContent = "TURNO ACTIVO";
      const movement = document.createElement("span");
      movement.className = "mtrol-movement-indicator";
      movement.textContent = `Movimiento: ${api.getAvailableMovement(rowCombatant?.actor ?? context.actor).remaining}`;
      target.append(active, movement);
      if (activeState.followUpAttackAvailable) {
        const followUp = document.createElement("span");
        followUp.className = "mtrol-follow-up-indicator";
        followUp.textContent = "Ataque posterior disponible";
        target.append(followUp);
      }
    }
    if (grantedMovement && api.sameActor(rowCombatant?.actor, grantedMovement.targetActorUuid)) {
      const granted = document.createElement("span");
      granted.className = "mtrol-granted-movement-indicator";
      granted.textContent = `Movimiento concedido: ${api.getAvailableMovement(rowCombatant.actor).remaining}`;
      target.append(granted);
    }
  });
}

export function installCombatTracker(_app, html, api) {
  const root = html?.[0] ?? html;
  if (!root?.querySelector) return;
  const context = api.getTurnContext();
  if (!context.combat) return;
  decorateCombatTracker(root, context, api);

  const activeState = api.getCombatantTurnState(context.combatant);
  root.querySelector("[data-mtrol-end-attribute-movement]")?.remove();
  if (activeState.movementSource === "attribute" && activeState.actionConsumed &&
      !activeState.followUpAttackAvailable && api.userCanControl(context.actor)) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.mtrolEndAttributeMovement = "true";
    button.className = "mtrol-end-attribute-movement";
    button.textContent = "Finalizar movimiento por atributo";
    button.addEventListener("click", () => runControl(button, () => api.completeAttributeMovement(context.actor)));
    appendTrackerControl(root, button);
  }

  const grantedMovement = api.getGrantedMovement(null, context);
  root.querySelector("[data-mtrol-end-granted-movement]")?.remove();
  if (grantedMovement) {
    const targetActor = collectionValues(context.combat?.combatants ?? context.combat?.turns)
      .map(combatant => combatant.actor)
      .find(actor => api.sameActor(actor, grantedMovement.targetActorUuid)) ??
      game.actors?.get?.(String(grantedMovement.targetActorUuid).replace(/^Actor\./, "")) ?? null;
    if (api.userCanControl(targetActor)) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.mtrolEndGrantedMovement = "true";
      button.className = "mtrol-end-granted-movement";
      button.textContent = `Finalizar movimiento concedido (${grantedMovement.remaining})`;
      button.addEventListener("click", () => runControl(button, () => api.completeGrantedMovement({ reason: "skipped" })));
      appendTrackerControl(root, button);
    }
  }

  root.querySelector(".mtrol-gm-combat-state")?.remove();
  if (game.user?.isGM) {
    const panelHost = root.querySelector("footer") ?? root;
    panelHost.insertAdjacentHTML("beforeend", buildGMCombatStatePanel(context, api));
    panelHost.querySelectorAll("[data-mtrol-gm-special-lock]").forEach(control => {
      control.addEventListener("click", () => runControl(control, async () => {
        const actor = await fromUuid(control.dataset.actorUuid);
        if (!actor) return;
        const slot = Number(control.dataset.specialSlot);
        const state = resolveSpecialAbilitySlot(actor, slot);
        await updateSpecialAbilitySlot(actor, slot, { unlocked: !state.unlocked });
      }));
    });
    panelHost.querySelectorAll("[data-mtrol-gm-preparation]").forEach(control => {
      control.addEventListener("click", () => runControl(control, async () => {
        const actor = await fromUuid(control.dataset.actorUuid);
        if (actor) await api.setPreparation(actor, api.getPreparation(actor) + Number(control.dataset.delta ?? 0));
      }));
    });
  }

  if (!api.userCanControl(context.actor) || root.querySelector("[data-mtrol-end-turn]")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.mtrolEndTurn = "true";
  button.className = "mtrol-end-turn";
  button.innerHTML = '<i class="fas fa-forward-step" aria-hidden="true"></i> Finalizar turno';
  button.addEventListener("click", () => runControl(button, api.endTurn));
  appendTrackerControl(root, button);
}

function appendTrackerControl(root, control) {
  (root.querySelector("footer") ?? root.querySelector(".combat-tracker-header") ?? root).append(control);
}

async function runControl(control, operation) {
  control.disabled = true;
  try {
    await operation();
  } catch (error) {
    logger.warn("UI", "combat tracker control failed", {
      command: operation?.name || "tracker-control",
      status: "rejected",
      reasonCode: error.reasonCode ?? "TRACKER_CONTROL_REJECTED",
      error: error.message
    });
    ui.notifications.warn(error.message);
    control.disabled = false;
  }
}
