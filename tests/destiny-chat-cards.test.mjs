import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const assetModule = await import("../scripts/ui/chat-card-assets.js");
const destinyModule = await import("../scripts/ui/destiny-chat-card.js");
const resourceModule = await import("../scripts/rolls/mtrol-dharma-karma.js");
const rendererModule = await import("../scripts/ui/chat-roll-card-renderer.js");

function createActor({ name = "Fahlyn", dharma = 0, karma = 0 } = {}) {
  return {
    name,
    isOwner: true,
    system: { recursos: { dharma, karma } },
    async update(changes) {
      this.system.recursos.dharma = changes["system.recursos.dharma"];
      this.system.recursos.karma = changes["system.recursos.karma"];
    }
  };
}

async function withFoundryGlobals(callback) {
  const original = {
    game: globalThis.game,
    ui: globalThis.ui,
    ChatMessage: globalThis.ChatMessage
  };
  const created = [];

  globalThis.game = { user: { isGM: true } };
  globalThis.ui = { notifications: { info() {} } };
  globalThis.ChatMessage = {
    getSpeaker: ({ actor }) => ({ actor: actor.name }),
    async create(data) {
      created.push(data);
      return data;
    }
  };

  try {
    await callback(created);
  } finally {
    globalThis.game = original.game;
    globalThis.ui = original.ui;
    globalThis.ChatMessage = original.ChatMessage;
  }
}

test("el registro central expone exactamente los assets especiales Dharma y Karma", () => {
  assert.deepEqual(assetModule.MTROL_DESTINY_CARD_ASSETS, {
    dharma: "systems/mtrol/assets/ui/chat/cards-premium/v3/special/dharma-card.png",
    karma: "systems/mtrol/assets/ui/chat/cards-premium/v3/special/karma-card.png"
  });
  assert.equal(
    assetModule.resolveMtrolDestinyCardAsset("dharma"),
    assetModule.MTROL_DESTINY_CARD_ASSETS.dharma
  );
  assert.equal(
    assetModule.resolveMtrolDestinyCardAsset("karma"),
    assetModule.MTROL_DESTINY_CARD_ASSETS.karma
  );
});

test("Dharma genera una sola card premium con texto exacto y reinicia al llegar a 5", async () => {
  await withFoundryGlobals(async created => {
    const actor = createActor({ dharma: 4, karma: 2 });
    await resourceModule.mtrolAplicarDharmaKarma(actor, 1, 0);

    assert.equal(created.length, 1);
    assert.equal(actor.system.recursos.dharma, 0);
    assert.equal(actor.system.recursos.karma, 2);
    assert.match(created[0].content, />Fahlyn<\/div>/);
    assert.match(created[0].content, />alcanzó 5 puntos de<\/div>/);
    assert.match(created[0].content, />Dharma<\/div>/);
    assert.match(created[0].content, />Sus puntos se reinician\.<\/div>/);
    assert.match(created[0].content, /mtrol-destiny-card--dharma/);
    assert.doesNotMatch(created[0].content, /Carta de Dharma/i);
    assert.doesNotMatch(created[0].content, /🏆|💀|style=/u);
  });
});

test("Karma genera una sola card premium con texto exacto y reinicia al llegar a 5", async () => {
  await withFoundryGlobals(async created => {
    const actor = createActor({ dharma: 2, karma: 4 });
    await resourceModule.mtrolAplicarDharmaKarma(actor, 0, 1);

    assert.equal(created.length, 1);
    assert.equal(actor.system.recursos.dharma, 2);
    assert.equal(actor.system.recursos.karma, 0);
    assert.match(created[0].content, />Fahlyn<\/div>/);
    assert.match(created[0].content, />alcanzó 5 puntos de<\/div>/);
    assert.match(created[0].content, />Karma<\/div>/);
    assert.match(created[0].content, />Sus puntos se reinician\.<\/div>/);
    assert.match(created[0].content, /mtrol-destiny-card--karma/);
    assert.doesNotMatch(created[0].content, /Carta de Karma/i);
    assert.doesNotMatch(created[0].content, /🏆|💀|style=/u);
  });
});

test("el contenido dinámico escapa el nombre del actor", () => {
  const content = destinyModule.buildMtrolDestinyCardContent({
    type: "dharma",
    actorName: '<script>alert("x")</script>'
  });

  assert.doesNotMatch(content, /<script>/);
  assert.match(content, /&lt;script&gt;/);
});

test("cada card renderiza un único img real con la ruta absoluta de sistema", () => {
  for (const type of ["dharma", "karma"]) {
    const content = destinyModule.buildMtrolDestinyCardContent({
      type,
      actorName: "Fahlyn"
    });
    const matches = content.match(/<img\b/g) ?? [];

    assert.equal(matches.length, 1, type);
    assert.match(content, /class="mtrol-destiny-card__art"/);
    assert.match(
      content,
      new RegExp(`src="systems/mtrol/assets/ui/chat/cards-premium/v3/special/${type}-card\\.png"`)
    );
  }
});

test("la jerarquía dinámica separa los cuatro niveles semánticos", () => {
  for (const [type, label] of [["dharma", "Dharma"], ["karma", "Karma"]]) {
    const content = destinyModule.buildMtrolDestinyCardContent({
      type,
      actorName: "Lerathiel"
    });

    assert.match(content, /class="mtrol-destiny-card__actor">Lerathiel<\/div>/);
    assert.match(content, /class="mtrol-destiny-card__event">alcanzó 5 puntos de<\/div>/);
    assert.match(
      content,
      new RegExp(`class="mtrol-destiny-card__resource">${label}<\\/div>`)
    );
    assert.match(content, /class="mtrol-destiny-card__reset">Sus puntos se reinician\.<\/div>/);
    assert.doesNotMatch(content, /mtrol-destiny-card__(primary|secondary)/);
    assert.doesNotMatch(content, /<p\b/i);
    assert.doesNotMatch(content, /<br\b/i);
  }
});

test("los nombres de validación conservan el actor completo sin HTML rígido", () => {
  const names = ["Dave", "Fahlyn", "Lerathiel", "Kael'Varyn de la Noche Eterna"];

  for (const actorName of names) {
    const content = destinyModule.buildMtrolDestinyCardContent({
      type: "dharma",
      actorName
    });
    const expectedName = actorName.replace("'", "&#39;");

    assert.match(
      content,
      new RegExp(`mtrol-destiny-card__actor">${expectedName}<\\/div>`)
    );
    assert.doesNotMatch(content, /<br\b/i);
  }
});

test("el renderer existente marca la card de destino sin reescribir su contenido", () => {
  const classes = new Set(["chat-message"]);
  const destinyCard = {};
  const content = {
    querySelector(selector) {
      if (selector === ".mtrol-destiny-card[data-mtrol-destiny]") return destinyCard;
      return null;
    }
  };
  const root = {
    nodeType: 1,
    matches() { return false; },
    querySelector(selector) {
      return selector === ".message-content" ? content : null;
    },
    classList: {
      add(...values) {
        for (const value of values) classes.add(value);
      }
    }
  };

  assert.equal(
    rendererModule.enhanceMtrolChatRollCard({}, root, { documentRef: {} }),
    false
  );
  assert.equal(content.querySelector(".mtrol-destiny-card[data-mtrol-destiny]"), destinyCard);
  assert.equal(classes.has("mtrol-chat-message--premium"), true);
  assert.equal(classes.has("mtrol-premium-roll-message"), true);
});

test("el CSS deja que el img determine la geometría sin fondos artificiales", async () => {
  const css = await readFile(
    resolve(projectRoot, "styles/combat/destiny-cards.css"),
    "utf8"
  );

  assert.match(css, /\.mtrol-destiny-card__art\s*\{/);
  assert.match(css, /max-width:\s*285px/);
  assert.match(css, /height:\s*auto/);
  assert.match(css, /background:\s*transparent/);
  assert.doesNotMatch(
    css,
    /background-image|linear-gradient|radial-gradient|border-image/i
  );
});

test("el CSS aplica la jerarquía Morpheus y las paletas metalizadas", async () => {
  const css = await readFile(
    resolve(projectRoot, "styles/combat/destiny-cards.css"),
    "utf8"
  );

  assert.match(css, /top:\s*30%/);
  assert.match(css, /left:\s*9%/);
  assert.match(css, /right:\s*9%/);
  assert.match(css, /var\(--mtrol-font-title/);
  assert.match(css, /\.mtrol-destiny-card__actor\s*\{[^}]*font-size:\s*15px/s);
  assert.match(css, /\.mtrol-destiny-card__event\s*\{[^}]*font-size:\s*13px/s);
  assert.match(css, /\.mtrol-destiny-card__resource\s*\{[^}]*font-size:\s*23px/s);
  assert.match(css, /\.mtrol-destiny-card__reset\s*\{[^}]*font-size:\s*12px/s);
  assert.match(css, /\.mtrol-destiny-card--dharma[^}]*color:\s*#d6b45c/s);
  assert.match(css, /\.mtrol-destiny-card--karma[^}]*color:\s*#b84a43/s);
  assert.match(css, /dharma \.mtrol-destiny-card__resource[^}]*color:\s*#e2be58/s);
  assert.match(css, /karma \.mtrol-destiny-card__resource[^}]*color:\s*#b5433f/s);
  assert.doesNotMatch(css, /font-size:[^;]*\bvw\b/i);
});

test("los PNG finales conservan dimensiones, color y binarios esperados", async () => {
  const expected = [
    ["dharma-card.png", 2_399_294],
    ["karma-card.png", 2_271_932]
  ];

  for (const [name, byteLength] of expected) {
    const png = await readFile(resolve(
      projectRoot,
      "assets/ui/chat/cards-premium/v3/special",
      name
    ));
    assert.equal(png.toString("hex", 1, 4), "504e47", name);
    assert.equal(png.readUInt32BE(16), 941, name);
    assert.equal(png.readUInt32BE(20), 1672, name);
    assert.equal(png[25], 2, `${name}: PNG RGB`);
    assert.equal(png.byteLength, byteLength, name);
  }
});
