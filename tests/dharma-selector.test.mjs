import test from "node:test";
import assert from "node:assert/strict";

const warnings = [];
let dialogAction = "cancel";

globalThis.foundry = {
  utils: {
    escapeHTML: value => String(value ?? ""),
    randomID: () => "selector-transaction"
  }
};

globalThis.ui = {
  notifications: {
    warn: message => warnings.push(message)
  }
};

globalThis.Roll = class {
  constructor(formula) {
    const match = String(formula).match(/^(\d+)d(\d+)/i);
    this.terms = match
      ? [{ number: Number(match[1]), faces: Number(match[2]) }]
      : [];
  }
};

function buildDialogRoot() {
  const listeners = [];
  const checkboxes = [0, 1].map(index => ({
    value: `initial:0:${index}`,
    checked: false,
    disabled: false,
    addEventListener(type, callback) {
      if (type === "change") listeners[index] = callback;
    }
  }));
  const selectedCount = { textContent: "" };
  const cost = { textContent: "" };
  const confirm = { disabled: false };

  return {
    checkboxes,
    listeners,
    selectedCount,
    cost,
    confirm,
    querySelectorAll(selector) {
      if (selector.includes(":checked")) {
        return checkboxes.filter(input => input.checked);
      }
      return checkboxes;
    },
    querySelector(selector) {
      if (selector.includes("selected")) return selectedCount;
      if (selector.includes("cost")) return cost;
      return null;
    },
    closest() {
      return {
        querySelector: () => confirm
      };
    }
  };
}

globalThis.Dialog = class {
  constructor(config) {
    this.config = config;
  }

  render() {
    const root = buildDialogRoot();
    this.config.render(root);

    if (dialogAction === "confirm-one") {
      root.checkboxes[0].checked = true;
      root.listeners[0]();

      assert.equal(root.checkboxes[1].disabled, true);
      assert.equal(root.selectedCount.textContent, "1");
      assert.equal(root.cost.textContent, "1");
      assert.equal(root.confirm.disabled, false);
      this.config.buttons.confirm.callback(root);
    } else {
      this.config.buttons.cancel.callback(root);
    }

    return this;
  }
};

const { selectDharmaSpendForRoll } =
  await import("../scripts/ui/dharma-selector.js");

function actorWithDharma(dharma) {
  let updates = 0;
  return {
    uuid: "Actor.hero",
    system: { recursos: { dharma } },
    async update() {
      updates += 1;
    },
    get updates() {
      return updates;
    }
  };
}

test.beforeEach(() => {
  warnings.length = 0;
  dialogAction = "cancel";
});

test("Dharma cero no abre el selector", async () => {
  const actor = actorWithDharma(0);
  const result = await selectDharmaSpendForRoll({
    actor,
    formula: "2d10 + 3"
  });

  assert.equal(result, null);
  assert.equal(actor.updates, 0);
  assert.match(warnings.at(-1), /No tienes Dharma/);
});

test("cancelar el selector no consume ni crea contexto", async () => {
  const actor = actorWithDharma(1);
  const result = await selectDharmaSpendForRoll({
    actor,
    formula: "2d10 + 3"
  });

  assert.equal(result, null);
  assert.equal(actor.updates, 0);
});

test("el selector limita por saldo y prepara identidades individuales sin consumir", async () => {
  const actor = actorWithDharma(1);
  dialogAction = "confirm-one";

  const result = await selectDharmaSpendForRoll({
    actor,
    formula: "2d10 + 3"
  });

  assert.equal(actor.updates, 0);
  assert.equal(result.state, "prepared");
  assert.equal(result.cost, 1);
  assert.deepEqual(result.selectedIds, ["initial:0:0"]);
  assert.equal(result.transactionId, "selector-transaction");
});
