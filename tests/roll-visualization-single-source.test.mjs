import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const directVisuals = [];
const nativeVisuals = [];
const messages = [];

globalThis.game = {
  user: { id: "author" },
  dice3d: {
    async showForRoll(roll, user, synchronize) {
      directVisuals.push({ roll, user, synchronize });
    }
  }
};

globalThis.ChatMessage = {
  async create(data) {
    const message = {
      id: `message-${messages.length + 1}`,
      ...data,
      async update(changes) {
        Object.assign(this, changes);
        return this;
      }
    };
    messages.push(message);

    // Modelo de entrega de Foundry: cada cliente observa una vez el mismo
    // ChatMessage creado. Dice So Nice genera una visual por Roll y cliente.
    for (const clientId of ["author", "remote"]) {
      for (const roll of data.rolls ?? []) {
        nativeVisuals.push({ clientId, messageId: message.id, rollId: roll.id });
      }
    }

    return message;
  }
};

const { mtrolCreateRollMessage } =
  await import("../scripts/rolls/chat-rolls.js");

test("un Roll crea un ChatMessage y una solicitud visual por cliente", async () => {
  const roll = { id: "roll-1", formula: "1d10", total: 7 };
  const message = await mtrolCreateRollMessage({ rolls: [roll], content: "roll" });

  assert.equal(messages.length, 1);
  assert.equal(message.id, "message-1");
  assert.equal(directVisuals.length, 0);
  assert.deepEqual(nativeVisuals, [
    { clientId: "author", messageId: "message-1", rollId: "roll-1" },
    { clientId: "remote", messageId: "message-1", rollId: "roll-1" }
  ]);
  assert.equal(Object.hasOwn(game.dice3d, "messageHookDisabled"), false);
});

test("actualizar la tarjeta no vuelve a solicitar una visual", async () => {
  const before = nativeVisuals.length;
  await messages[0].update({ content: "resultado actualizado", rolls: messages[0].rolls });
  assert.equal(nativeVisuals.length, before);
});

test("las rutas con ChatMessage no conservan emisiones directas", async () => {
  const paths = [
    "../scripts/rolls/mtrol-rolls.js",
    "../scripts/combat/initiative-engine.js",
    "../scripts/actions/action-damage-engine.js",
    "../scripts/combat/damage-localized.js"
  ];

  for (const path of paths) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /mtrolMostrarDados|showForRoll|messageHookDisabled/, path);
  }
});

test("el único showForRoll restante pertenece al dado autónomo de desgaste", async () => {
  const diceEngine = await readFile(
    new URL("../scripts/rolls/dice-engine.js", import.meta.url),
    "utf8"
  );
  const shieldWear = await readFile(
    new URL("../scripts/items/shield-wear-engine.js", import.meta.url),
    "utf8"
  );

  assert.equal((diceEngine.match(/showForRoll/g) ?? []).length, 1);
  assert.match(shieldWear, /await mtrolMostrarDados\(wearRoll\)/);
});
