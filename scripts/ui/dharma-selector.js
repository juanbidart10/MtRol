import {
  createDharmaSpendContext,
  getDharmaEligibleInitialDice,
  validateDharmaSpend
} from "../rolls/dharma-engine.js";

function escapeHTML(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function getRoot(html) {
  return html?.[0] ?? html ?? null;
}

function getCheckedDice(root, eligibleById) {
  return Array.from(
    root?.querySelectorAll?.("input[data-mtrol-dharma-die]:checked") ?? []
  )
    .map(input => eligibleById.get(input.value))
    .filter(Boolean);
}

function updateSelectorState(root, availableDharma) {
  const checkboxes = Array.from(
    root?.querySelectorAll?.("input[data-mtrol-dharma-die]") ?? []
  );
  const selected = checkboxes.filter(input => input.checked);
  const limitReached = selected.length >= availableDharma;

  for (const input of checkboxes) {
    input.disabled = !input.checked && limitReached;
  }

  const count = root?.querySelector?.("[data-mtrol-dharma-selected]");
  const cost = root?.querySelector?.("[data-mtrol-dharma-cost]");

  if (count) count.textContent = String(selected.length);
  if (cost) cost.textContent = String(selected.length);

  const dialog = root?.closest?.(".app.dialog");
  const confirm = dialog?.querySelector?.('[data-button="confirm"]');
  if (confirm) confirm.disabled = selected.length < 1;
}

export async function selectDharmaSpendForRoll({
  actor,
  formula,
  data = {}
} = {}) {
  if (!actor) return null;

  const availableDharma =
    Number(actor.system?.recursos?.dharma);

  if (!Number.isInteger(availableDharma) || availableDharma < 1) {
    ui.notifications.warn("No tienes Dharma disponible.");
    return null;
  }

  const previewRoll =
    new Roll(formula, data);

  const eligibleDice =
    getDharmaEligibleInitialDice(previewRoll);

  if (!eligibleDice.length) {
    ui.notifications.warn("La tirada no contiene dados compatibles con Dharma.");
    return null;
  }

  const eligibleById =
    new Map(eligibleDice.map(die => [die.id, die]));

  const options = eligibleDice
    .map(die => `
      <label class="mtrol-dharma-selector__die">
        <input
          type="checkbox"
          value="${escapeHTML(die.id)}"
          data-mtrol-dharma-die
        >
        <span>${escapeHTML(die.label)}</span>
      </label>
    `)
    .join("");

  return new Promise(resolve => {
    let settled = false;

    const finish = value => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    new Dialog({
      title: "Quemar Dharma",
      content: `
        <form class="mtrol-dharma-selector">
          <p>Dharma disponible: <strong>${availableDharma}</strong></p>
          <p>Selecciona los dados iniciales que recibirán protección.</p>
          <fieldset class="mtrol-dharma-selector__dice">
            <legend>Dados iniciales</legend>
            ${options}
          </fieldset>
          <div class="mtrol-dharma-selector__summary" aria-live="polite">
            Seleccionados: <strong data-mtrol-dharma-selected>0</strong>
            · Costo: <strong data-mtrol-dharma-cost>0</strong> Dharma
          </div>
        </form>
      `,
      buttons: {
        confirm: {
          label: "Quemar y tirar",
          callback: html => {
            const root = getRoot(html);
            const selectedDice =
              getCheckedDice(root, eligibleById);

            const validation =
              validateDharmaSpend({
                availableDharma,
                selectedDice,
                eligibleDice
              });

            if (!validation.valid || validation.cost < 1) {
              ui.notifications.warn(
                validation.errors[0]?.message ??
                "Selecciona al menos un dado."
              );
              finish(null);
              return;
            }

            finish(
              createDharmaSpendContext({
                actorUuid: actor.uuid,
                selectedDice: validation.selectedDice,
                transactionId: foundry.utils.randomID()
              })
            );
          }
        },
        cancel: {
          label: "Cancelar",
          callback: () => finish(null)
        }
      },
      default: "confirm",
      render: html => {
        const root = getRoot(html);

        root
          ?.querySelectorAll?.("input[data-mtrol-dharma-die]")
          .forEach(input => {
            input.addEventListener("change", () =>
              updateSelectorState(root, availableDharma)
            );
          });

        updateSelectorState(root, availableDharma);
      },
      close: () => finish(null)
    }).render(true);
  });
}
