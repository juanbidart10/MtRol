import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hookHandlers = [];
globalThis.Hooks = {
  on(name, callback) {
    hookHandlers.push({ name, callback });
  }
};

const assetModule = await import("../scripts/ui/chat-card-assets.js");
const rendererModule = await import("../scripts/ui/chat-roll-card-renderer.js");

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
  }

  values() {
    return this.owner.className.split(/\s+/).filter(Boolean);
  }

  contains(value) {
    return this.values().includes(value);
  }

  add(...values) {
    this.owner.className = [...new Set([...this.values(), ...values])].join(" ");
  }
}

function matchesSelector(node, selector) {
  const attribute = selector.match(/\[([^=\]]+)="([^"]+)"\]/);
  const withoutAttribute = selector.replace(/\[[^\]]+\]/g, "");
  const classMatch = withoutAttribute.match(/\.([\w-]+)/);
  const tagMatch = withoutAttribute.match(/^[a-z][\w-]*/i);

  if (classMatch && !node.classList.contains(classMatch[1])) return false;
  if (tagMatch && node.tagName !== tagMatch[0].toUpperCase()) return false;
  if (attribute) {
    const [, name, value] = attribute;
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
      if (node.dataset[key] !== value) return false;
    } else if (node.attributes.get(name) !== value) return false;
  }
  return Boolean(classMatch || tagMatch || attribute);
}

class FakeElement {
  constructor(tagName) {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.className = "";
    this.classList = new FakeClassList(this);
    this.dataset = {};
    this.attributes = new Map();
    this.children = [];
    this.parentElement = null;
    this._text = "";
    this.clientHeight = 0;
    this.scrollHeight = 0;
    this.clientWidth = 0;
    this.scrollWidth = 0;
  }

  get firstChild() {
    return this.children[0] ?? null;
  }

  get textContent() {
    return this._text + this.children.map(child => child.textContent).join("");
  }

  set textContent(value) {
    this._text = String(value ?? "");
    this.children = [];
  }

  append(...children) {
    for (const child of children.filter(Boolean)) {
      child.remove?.();
      child.parentElement = this;
      this.children.push(child);
    }
  }

  replaceChildren(...children) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    this._text = "";
    this.append(...children);
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    this.parentElement = null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "class") this.className = String(value);
  }

  matches(selector) {
    return matchesSelector(this, selector);
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (node.matches(selector)) return node;
      node = node.parentElement;
    }
    return null;
  }

  querySelectorAll(selector) {
    const results = [];
    const visit = node => {
      for (const child of node.children) {
        if (child.matches(selector)) results.push(child);
        visit(child);
      }
    };
    visit(this);
    return results;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

const fakeDocument = {
  createElement(tagName) {
    return new FakeElement(tagName);
  }
};

function element(tagName, className = "", text = "") {
  const node = new FakeElement(tagName);
  node.className = className;
  node.textContent = text;
  return node;
}

function createNativeRoll(values = [7], { diagnostics = true } = {}) {
  const diceRoll = element("div", "dice-roll");
  const flavor = element("div", "dice-flavor", "Diagnóstico técnico");
  const formula = element("div", "dice-formula", "1d10 + 4");
  const result = element("div", "dice-result");
  const total = element("h4", "dice-total", "11");
  const tooltip = element("div", "dice-tooltip");
  const wrapper = element("div", "wrapper");
  const part = element("section", "tooltip-part");
  const header = element("div", "part-header");
  header.append(element("span", "part-formula", "1d10"), element("span", "part-total", "7"));
  const dice = element("ol", "dice-rolls");
  for (const value of values) dice.append(element("li", "roll", String(value)));
  part.append(header, dice);
  wrapper.append(part);
  tooltip.append(wrapper);
  result.append(total, tooltip);
  diceRoll.append(flavor, formula, result);
  if (diagnostics) {
    diceRoll.append(
      element("p", "", "Resultado base sin crítico: 7"),
      element("p", "", "Crítico en D10 [D10: 9 x2] 🚩")
    );
  }
  return diceRoll;
}

function createMessageDom(values = [7]) {
  const root = element("li", "chat-message");
  const content = element("div", "message-content");
  content.append(createNativeRoll(values));
  root.append(content);
  return { root, content };
}

function rollResultValues(roll) {
  return (roll.terms ?? []).flatMap(term =>
    Array.isArray(term.results)
      ? term.results
        .filter(result => result.active !== false)
        .map(result => Number(result.result))
      : []
  );
}

function createNativeRollFromTerms(roll) {
  const diceRoll = element("div", "dice-roll");
  const result = element("div", "dice-result");
  const tooltip = element("div", "dice-tooltip");
  const wrapper = element("div", "wrapper");

  diceRoll.append(
    element("div", "dice-flavor", roll.label ?? "Tirada persistida"),
    element("div", "dice-formula", roll.formula),
    result
  );
  result.append(element("h4", "dice-total", String(roll.total)), tooltip);
  tooltip.append(wrapper);

  for (const term of roll.terms ?? []) {
    if (!Array.isArray(term.results)) continue;
    const part = element("section", "tooltip-part");
    const header = element("div", "part-header");
    const values = term.results
      .filter(entry => entry.active !== false)
      .map(entry => Number(entry.result));
    header.append(
      element("span", "part-formula", `${values.length || 1}d${term.faces}`),
      element("span", "part-total", String(values.reduce((sum, value) => sum + value, 0)))
    );
    const dice = element("ol", "dice-rolls");
    for (const value of values) {
      dice.append(element("li", `roll die d${term.faces}`, String(value)));
    }
    part.append(header, dice);
    wrapper.append(part);
  }
  return diceRoll;
}

function createPipelineDom(rolls) {
  const root = element("li", "chat-message");
  const content = element("div", "message-content");
  for (const [index, roll] of rolls.entries()) {
    const block = element("div", "mtrol-roll-block");
    block.dataset.mtrolRollIndex = String(index);
    block.append(createNativeRollFromTerms(roll));
    content.append(block);
  }
  root.append(content);
  return { root, content };
}

function readPngMetadata(buffer) {
  assert.equal(buffer.subarray(1, 4).toString("ascii"), "PNG");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    colorType: buffer[25]
  };
}

function runtimePath(assetPath) {
  return resolve(projectRoot, assetPath.replace(/^systems\/mtrol\//, ""));
}

test("el registro visual contiene exactamente las seis claves V10", async () => {
  assert.deepEqual(Object.keys(assetModule.MTROL_CARD_ASSETS), [
    "spell", "damagePhysical", "critical", "attack", "defense", "fumble"
  ]);

  const folder = resolve(projectRoot, "assets/ui/chat/cards-premium/v10");
  const files = (await readdir(folder)).filter(file => file.endsWith(".png")).sort();
  assert.deepEqual(files, [
    "attack.png", "critical.png", "damage-physical.png", "defense.png", "fumble.png", "spell.png"
  ]);

  for (const assetPath of Object.values(assetModule.MTROL_CARD_ASSETS)) {
    const metadata = readPngMetadata(await readFile(runtimePath(assetPath)));
    assert.deepEqual(metadata, { width: 720, height: 1440, colorType: 6 }, assetPath);
  }
});

test("la prioridad visual es pifia, crítico y luego familia", () => {
  assert.match(assetModule.resolveMtrolCardAsset({ family: "spell", critical: true, fumble: true }), /v10\/fumble\.png$/);
  assert.match(assetModule.resolveMtrolCardAsset({ family: "spell", critical: true }), /v10\/critical\.png$/);
  assert.match(assetModule.resolveMtrolCardAsset({ family: "spell" }), /v10\/spell\.png$/);
  assert.match(assetModule.resolveMtrolCardAsset({ family: "damage" }), /v10\/damage-physical\.png$/);
  assert.match(assetModule.resolveMtrolCardAsset({ family: "defense" }), /v10\/defense\.png$/);
  assert.match(assetModule.resolveMtrolCardAsset({ family: "attack" }), /v10\/attack\.png$/);
  assert.doesNotMatch(assetModule.resolveMtrolCardAsset({ family: "desconocida" }), /critical/);
  assert.ok(assetModule.getMtrolCardAssetAudit().includes("desconocida"));
});

test("la clasificación respeta magia, daño físico, defensa y ataque", () => {
  assert.equal(assetModule.classifyMtrolCardFamily({ category: "magia" }), "spell");
  assert.equal(assetModule.classifyMtrolCardFamily({ effect: "damage" }), "damagePhysical");
  assert.equal(assetModule.classifyMtrolCardFamily({ defenseType: "dodge" }), "defense");
  assert.equal(assetModule.classifyMtrolCardFamily({ actionType: "attack" }), "attack");
  assert.equal(assetModule.buildMtrolCardMetadata({ family: "spell" }).version, 10);
});

test("cada card usa un solo arte y ninguna capa estática duplicada", () => {
  const dom = createMessageDom([9, 10]);
  let evaluationCount = 0;
  let persistenceCount = 0;
  const roll = {
    formula: "2d10 + 1 + 5 + 5 + 5 + 2 - 3",
    total: 34,
    terms: [
      { faces: 10, results: [{ result: 9 }, { result: 10 }] },
      { operator: "+" }, { number: 1, options: { flavor: "Aura" } },
      { operator: "+" }, { number: 5, options: { flavor: "Percepción" } },
      { operator: "+" }, { number: 5 },
      { operator: "+" }, { number: 5 },
      { operator: "+" }, { number: 2 },
      { operator: "-" }, { number: 3 }
    ],
    evaluate() { evaluationCount++; }
  };
  const message = {
    rolls: [roll],
    flags: { mtrol: { rollCard: {
      family: "spell", state: "normal", title: "Explosión primordial",
      formula: roll.formula, total: roll.total
    } } },
    update() { persistenceCount++; },
    setFlag() { persistenceCount++; }
  };

  assert.equal(rendererModule.enhanceMtrolChatRollCard(message, dom.root, { documentRef: fakeDocument }), true);
  const card = dom.content.querySelector(".mtrol-roll-card");
  assert.equal(card.dataset.mtrolPremium, "v10");
  assert.equal(card.querySelectorAll("img").length, 1);
  assert.equal(card.querySelector("img").className, "mtrol-roll-card__art");
  assert.match(card.querySelector("img").src, /v10\/spell\.png$/);

  for (const forbidden of [
    "frame", "emblem", "medallion", "family", "result-label", "result-circle",
    "breakdown-frame", "breakdown-title", "section-title", "modifier-title"
  ]) assert.equal(card.querySelector(`.mtrol-roll-card__${forbidden}`), null, forbidden);
  assert.equal(card.querySelector("svg"), null);
  assert.equal(card.querySelector(".dice-formula"), null);
  assert.equal(card.querySelector(".dice-total"), null);
  assert.equal(card.querySelector(".part-total"), null);
  assert.equal(card.querySelectorAll(".roll").length, 2);
  assert.deepEqual(card.querySelectorAll(".roll").map(node => node.textContent), ["9", "10"]);
  assert.doesNotMatch(card.textContent, /Resultado base sin crítico|Crítico en D10|\[D10:|🚩/i);
  assert.equal(evaluationCount, 0);
  assert.equal(persistenceCount, 0);
  assert.equal(rendererModule.enhanceMtrolChatRollCard(message, dom.root, { documentRef: fakeDocument }), false);
});

const resultVisibilityScenarios = [
    {
      name: "1d10",
      expectedGroups: ["D10"],
      expectedFaces: ["d10"],
      family: "attack",
      state: "normal",
      rolls: [{ formula: "1d10", total: 7, terms: [{ faces: 10, results: [{ result: 7, active: true }] }] }]
    },
    {
      name: "2d10",
      expectedGroups: ["D10 ×2"],
      expectedFaces: ["d10", "d10"],
      family: "attack",
      state: "normal",
      rolls: [{ formula: "2d10", total: 10, terms: [{ faces: 10, results: [{ result: 4 }, { result: 6 }] }] }]
    },
    {
      name: "dados iguales",
      expectedGroups: ["D10 ×2"],
      expectedFaces: ["d10", "d10"],
      family: "damagePhysical",
      state: "normal",
      rolls: [{ formula: "2d10", total: 10, terms: [{ faces: 10, results: [{ result: 5 }, { result: 5 }] }] }]
    },
    {
      name: "dados mixtos",
      expectedGroups: ["D10 ×2", "D12", "D20"],
      expectedFaces: ["d10", "d10", "d12", "d20"],
      family: "defense",
      state: "normal",
      rolls: [{
        formula: "2d10 + 1d12 + 1d20",
        total: 32,
        terms: [
          { faces: 10, results: [{ result: 3 }, { result: 4 }] },
          { operator: "+" },
          { faces: 12, results: [{ result: 9 }] },
          { operator: "+" },
          { faces: 20, results: [{ result: 16 }] }
        ]
      }]
    },
    {
      name: "cadena crítica",
      expectedGroups: ["D10 ×3"],
      expectedFaces: ["d10", "d10", "d10"],
      expectedChainDepths: ["1"],
      family: "attack",
      state: "critical",
      rolls: [
        { formula: "2d10", total: 11, terms: [{ faces: 10, results: [{ result: 1 }, { result: 10 }] }] },
        { label: "Cadena crítica 1", formula: "1d10", total: 6, terms: [{ faces: 10, results: [{ result: 6 }] }] }
      ]
    },
    {
      name: "cadena crítica múltiple",
      expectedGroups: ["D10 ×4"],
      expectedFaces: ["d10", "d10", "d10", "d10"],
      expectedChainDepths: ["1", "2"],
      family: "attack",
      state: "critical",
      rolls: [
        { formula: "2d10", total: 11, terms: [{ faces: 10, results: [{ result: 1 }, { result: 10 }] }] },
        { label: "Cadena crítica 1", formula: "1d10", total: 6, terms: [{ faces: 10, results: [{ result: 6 }] }] },
        { label: "Cadena crítica 2", formula: "1d10", total: 4, terms: [{ faces: 10, results: [{ result: 4 }] }] }
      ]
    },
    {
      name: "pifia",
      expectedGroups: ["D10"],
      expectedFaces: ["d10"],
      family: "attack",
      state: "fumble",
      rolls: [{ formula: "1d10", total: 1, terms: [{ faces: 10, results: [{ result: 1 }] }] }]
    },
    {
      name: "histórico",
      expectedGroups: ["D10"],
      expectedFaces: ["d10"],
      historical: true,
      rolls: [{ formula: "1d10", total: 5, terms: [{ faces: 10, results: [{ result: 5 }] }] }]
    }
];

for (const scenario of resultVisibilityScenarios) {
  test(`visibilidad de dados: ${scenario.name}`, () => {
    const dom = createPipelineDom(scenario.rolls);
    let evaluationCount = 0;
    let persistenceCount = 0;
    for (const roll of scenario.rolls) roll.evaluate = () => evaluationCount++;
    const expected = scenario.rolls.flatMap(rollResultValues);
    const message = {
      id: `message-${scenario.name}`,
      rolls: scenario.rolls,
      flags: scenario.historical ? {} : {
        mtrol: { rollCard: {
          family: scenario.family,
          state: scenario.state,
          title: scenario.name,
          formula: scenario.rolls[0].formula,
          total: scenario.rolls.reduce((sum, roll) => sum + roll.total, 0)
        } }
      },
      update() { persistenceCount++; },
      setFlag() { persistenceCount++; }
    };

    const beforeNativeNodes = dom.content.querySelectorAll(".roll");
    const beforeNative = beforeNativeNodes.map(node => Number(node.textContent));
    const beforeAggregateCount = dom.content.querySelectorAll(".part-total").length;
    assert.deepEqual(beforeNative, expected, `${scenario.name}: HTML persistido`);
    assert.ok(beforeAggregateCount > 0, `${scenario.name}: reproducción del agregado nativo`);
    assert.ok(
      beforeNative.length + beforeAggregateCount > expected.length,
      `${scenario.name}: el HTML nativo duplica la representación del resultado`
    );
    assert.equal(
      rendererModule.enhanceMtrolChatRollCard(message, dom.root, { documentRef: fakeDocument }),
      true,
      scenario.name
    );
    const afterNodes = dom.content.querySelectorAll(".roll");
    const afterVisible = afterNodes.map(node => Number(node.textContent));
    assert.deepEqual(afterVisible, expected, `${scenario.name}: DOM renderizado`);
    assert.equal(afterVisible.length, expected.length, `${scenario.name}: conteo visible`);
    assert.equal(dom.content.querySelectorAll(".part-total").length, 0, `${scenario.name}: sin agregado duplicado`);
    assert.equal(dom.content.querySelectorAll(".dice-total").length, 0, `${scenario.name}: sin total final nativo`);
    assert.equal(dom.content.querySelectorAll(".mtrol-roll-card__total").length, 1, `${scenario.name}: un total final central`);
    assert.deepEqual(afterNodes, beforeNativeNodes, `${scenario.name}: reubica nodos nativos sin clonarlos`);
    assert.equal(new Set(afterNodes).size, expected.length, `${scenario.name}: nodos únicos`);
    assert.equal(dom.content.querySelectorAll(".die").length, expected.length, `${scenario.name}: clases gráficas nativas`);
    assert.deepEqual(
      afterNodes.map(node => scenario.expectedFaces.find(face => node.classList.contains(face))),
      scenario.expectedFaces,
      `${scenario.name}: clase nativa por cara`
    );
    assert.deepEqual(
      dom.content.querySelectorAll(".mtrol-die-group__label").map(node => node.textContent),
      scenario.expectedGroups,
      `${scenario.name}: grupos etiquetados`
    );
    assert.equal(
      dom.content.querySelectorAll(".mtrol-die-group").length,
      scenario.expectedGroups.length,
      `${scenario.name}: una fila por cantidad de caras`
    );
    assert.ok(
      dom.content.querySelectorAll(".mtrol-die-group__label")
        .every(label => !/cadena/i.test(label.textContent)),
      `${scenario.name}: sin fila visible de cadena`
    );
    const expectedResultIds = scenario.rolls.flatMap((roll, rollIndex) =>
      (roll.terms ?? []).flatMap((term, termIndex) =>
        Array.isArray(term.results)
          ? term.results.flatMap((result, resultIndex) =>
            result.active === false
              ? []
              : [`${message.id}:${rollIndex}:${termIndex}:${resultIndex}`]
          )
          : []
      )
    );
    assert.deepEqual(
      afterNodes.map(node => node.dataset.mtrolResultId),
      expectedResultIds,
      `${scenario.name}: identidad estable por resultado`
    );
    assert.deepEqual(
      afterNodes.map(node => node.dataset.mtrolFaces),
      scenario.expectedFaces.map(face => face.slice(1)),
      `${scenario.name}: trazabilidad de caras`
    );
    assert.deepEqual(
      afterNodes
        .filter(node => node.dataset.mtrolOrigin === "chain")
        .map(node => node.dataset.chainDepth),
      scenario.expectedChainDepths ?? [],
      `${scenario.name}: profundidad de cadena`
    );
    assert.ok(
      afterNodes.every(node => node.dataset.mtrolActive === "true"),
      `${scenario.name}: resultados activos`
    );
    const normalizedBreakdown = dom.content.querySelector(".mtrol-roll-breakdown");
    assert.equal(normalizedBreakdown.attributes.get("role"), "list", `${scenario.name}: lista semántica`);
    assert.ok(
      dom.content.querySelectorAll(".mtrol-die-group")
        .every(group => group.attributes.get("role") === "listitem"),
      `${scenario.name}: grupos semánticos`
    );
    assert.equal(dom.root.classList.contains("mtrol-chat-message--premium"), true, `${scenario.name}: mensaje premium`);
    assert.equal(evaluationCount, 0, `${scenario.name}: sin reevaluación`);
    assert.equal(persistenceCount, 0, `${scenario.name}: sin persistencia`);

    assert.equal(
      rendererModule.enhanceMtrolChatRollCard(message, dom.root, { documentRef: fakeDocument }),
      false,
      `${scenario.name}: renderer idempotente`
    );
    assert.deepEqual(
      dom.content.querySelectorAll(".roll").map(node => Number(node.textContent)),
      expected,
      `${scenario.name}: segundo hook estable`
    );
  });
}

test("los cuatro cubículos reflejan y agrupan modificadores trazables", () => {
  const dom = createMessageDom([4]);
  const roll = {
    formula: "1d10 + 1 + 5 + 5 + 5 + 2 - 3",
    total: 19,
    terms: [
      { faces: 10, results: [{ result: 4 }] },
      { operator: "+" }, { number: 1, options: { flavor: "Aura" } },
      { operator: "+" }, { number: 5, options: { flavor: "Percepción" } },
      { operator: "+" }, { number: 5 },
      { operator: "+" }, { number: 5 },
      { operator: "+" }, { number: 2 },
      { operator: "-" }, { number: 3 }
    ]
  };
  rendererModule.enhanceMtrolChatRollCard({
    rolls: [roll],
    flags: { mtrol: { rollCard: { family: "attack", formula: roll.formula, total: roll.total } } }
  }, dom.root, { documentRef: fakeDocument });

  const slots = dom.content.querySelectorAll(".mtrol-roll-card__modifier-slot");
  assert.equal(slots.length, 4);
  assert.deepEqual(slots.map(slot => slot.textContent), ["+11", "+5", "+2", "-3"]);
  assert.match(slots[0].attributes.get("title"), /Aura: \+1; Percepción: \+5; \+5/);
});

test("los cubículos restantes quedan vacíos", () => {
  const dom = createMessageDom([8]);
  const roll = {
    formula: "1d10 + 4",
    total: 12,
    terms: [{ faces: 10, results: [{ result: 8 }] }, { operator: "+" }, { number: 4 }]
  };
  rendererModule.enhanceMtrolChatRollCard({
    rolls: [roll],
    flags: { mtrol: { rollCard: { family: "defense", formula: roll.formula, total: roll.total } } }
  }, dom.root, { documentRef: fakeDocument });
  assert.deepEqual(
    dom.content.querySelectorAll(".mtrol-roll-card__modifier-slot").map(slot => slot.textContent),
    ["+4", "", "", ""]
  );
});

test("Dharma conserva el natural visible y expone natural, efectivo y efecto en un tooltip accesible", () => {
  const roll = {
    formula: "1d10 + 3",
    total: 5,
    terms: [
      { faces: 10, results: [{ result: 2 }] },
      { operator: "+" },
      { number: 3 }
    ]
  };
  const metadata = assetModule.buildMtrolCardMetadata({
    family: "attack",
    formula: roll.formula,
    total: 6,
    dharma: {
      used: 1,
      actorUuid: "Actor.no-debe-persistir",
      transactionId: "tx-no-debe-persistir",
      traces: [{
        termIndex: 0,
        resultIndex: 0,
        faces: 10,
        naturalResult: 2,
        effectiveResult: 3,
        finalResult: 3,
        fumblePrevented: true,
        naturalCritical: false,
        criticalResolvedResult: null,
        dharmaBonus: 1,
        dharmaBonusAfterCritical: 0
      }]
    }
  }, [roll]);

  assert.equal(metadata.dharma.used, 1);
  assert.equal("actorUuid" in metadata.dharma, false);
  assert.equal("transactionId" in metadata.dharma, false);

  const dom = createPipelineDom([roll]);
  rendererModule.enhanceMtrolChatRollCard({
    id: "dharma-card",
    rolls: [roll],
    flags: { mtrol: { rollCard: metadata } }
  }, dom.root, { documentRef: fakeDocument });

  const result = dom.content.querySelector(".roll");
  const card = dom.content.querySelector(".mtrol-roll-card");
  assert.equal(card.dataset.mtrolDharmaUsed, "1");
  assert.equal(card.attributes.get("title"), "Dharma utilizado: 1");
  assert.equal(card.attributes.get("aria-description"), "Dharma utilizado: 1");
  assert.equal(result.textContent, "2", "el resultado natural del Roll no se sobrescribe");
  assert.equal(result.dataset.mtrolDharma, "true");
  assert.equal(result.dataset.mtrolNaturalResult, "2");
  assert.equal(result.dataset.mtrolEffectiveResult, "3");
  assert.equal(result.dataset.mtrolFinalResult, "3");
  assert.equal(result.dataset.mtrolFumblePrevented, "true");
  assert.match(result.attributes.get("title"), /natural 2.*pifia anulada.*resultado 3/i);
  assert.equal(result.attributes.get("aria-label"), result.attributes.get("title"));
  assert.equal(dom.content.querySelectorAll(".roll").length, 1);
  assert.equal(dom.content.querySelectorAll(".mtrol-roll-card__total").length, 1);
  assert.equal(
    rendererModule.enhanceMtrolChatRollCard({
      id: "dharma-card",
      rolls: [roll],
      flags: { mtrol: { rollCard: metadata } }
    }, dom.root, { documentRef: fakeDocument }),
    false
  );
  assert.equal(dom.content.querySelector(".roll").dataset.mtrolNaturalResult, "2");
});

test("un crítico protegido describe cadena y bono final sin reemplazar el natural visible", () => {
  const roll = {
    formula: "1d10",
    total: 1,
    terms: [{ faces: 10, results: [{ result: 1 }] }]
  };
  const dom = createPipelineDom([roll]);

  rendererModule.enhanceMtrolChatRollCard({
    id: "dharma-critical",
    rolls: [roll],
    flags: { mtrol: { rollCard: {
      family: "attack",
      state: "critical",
      total: 9,
      dharma: {
        used: 1,
        traces: [{
          termIndex: 0,
          resultIndex: 0,
          faces: 10,
          naturalResult: 1,
          effectiveResult: 1,
          finalResult: 9,
          naturalCritical: true,
          criticalResolvedResult: 8,
          dharmaBonusAfterCritical: 1
        }]
      }
    } } }
  }, dom.root, { documentRef: fakeDocument });

  const result = dom.content.querySelector(".roll");
  assert.equal(result.textContent, "1");
  assert.match(result.attributes.get("title"), /natural 1.*crítico.*cadena 8.*\+1 final.*resultado 9/i);
});

test("el CSS fija 303 por 606 y sólo superpone contenido dinámico", async () => {
  const css = await readFile(resolve(projectRoot, "styles/combat/premium-roll-cards.css"), "utf8");
  const cardRule = css.match(/\.chat-message \.mtrol-roll-card \{([\s\S]*?)\}/)?.[1] ?? "";
  assert.match(cardRule, /position:\s*relative/);
  assert.match(cardRule, /width:\s*303px/);
  assert.match(cardRule, /height:\s*606px/);
  assert.match(cardRule, /min-height:\s*606px/);
  assert.match(cardRule, /max-height:\s*606px/);
  assert.match(cardRule, /overflow:\s*hidden/);
  assert.match(cardRule, /--mtrol-die-result-ink:\s*#17120f/);
  assert.match(css, /\.mtrol-roll-card__art\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0[^}]*width:\s*100%[^}]*height:\s*100%[^}]*object-fit:\s*fill/s);
  assert.match(css, /\.mtrol-roll-card \*::before,[\s\S]*content:\s*none\s*!important/);
  assert.doesNotMatch(css, /url\(|linear-gradient|radial-gradient|drop-shadow|mask(?:-image)?\s*:/i);
  assert.equal((css.match(/overflow-y:\s*auto/g) ?? []).length, 1);
  assert.match(css, /font-family:[^;]*Morpheus/);
  assert.match(css, /\.chat-message\.mtrol-chat-message--premium\s*\{[^}]*background-color:\s*#030303\s*!important[^}]*background-image:\s*none\s*!important/s);
  assert.doesNotMatch(css, /:has\(/);
  assert.doesNotMatch(css, /part-total/);
  assert.match(css, /\.mtrol-roll-card__modifier-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(css, /\.mtrol-roll-card__modifier-slot\s*\{[^}]*display:\s*grid[^}]*place-items:\s*center/s);
  assert.match(css, /\.mtrol-roll-card__modifier-value\s*\{[^}]*display:\s*grid[^}]*width:\s*100%[^}]*height:\s*100%[^}]*place-items:\s*center[^}]*text-align:\s*center/s);
  assert.match(css, /\.mtrol-die-group__results \.roll\s*\{[^}]*width:\s*32px[^}]*background-repeat:\s*no-repeat[^}]*background-position:\s*center[^}]*background-size:\s*contain/s);
  assert.match(css, /\.mtrol-die-group__results \.roll\s*\{[^}]*color:\s*var\(--mtrol-die-result-ink\)/s);
  assert.equal((css.match(/--mtrol-die-result-ink\s*:/g) ?? []).length, 1);
});

test("un mensaje ajeno a MtROL conserva el DOM y no recibe fondo premium", () => {
  const dom = createMessageDom([7]);
  const originalRoll = dom.content.querySelector(".dice-roll");
  const message = {
    rolls: [{
      formula: "1d10",
      total: 7,
      terms: [{ faces: 10, results: [{ result: 7 }] }]
    }],
    flags: {}
  };

  assert.equal(
    rendererModule.enhanceMtrolChatRollCard(message, dom.root, { documentRef: fakeDocument }),
    false
  );
  assert.equal(dom.content.querySelector(".dice-roll"), originalRoll);
  assert.equal(dom.content.querySelector(".mtrol-roll-card"), null);
  assert.equal(dom.root.classList.contains("mtrol-chat-message--premium"), false);
});

test("más de tres filas activa densidad y el scroll sólo si aún desborda", () => {
  const roll = {
    formula: "1d6 + 1d8 + 1d10 + 1d12",
    total: 10,
    terms: [
      { faces: 6, results: [{ result: 1 }] },
      { operator: "+" },
      { faces: 8, results: [{ result: 2 }] },
      { operator: "+" },
      { faces: 10, results: [{ result: 3 }] },
      { operator: "+" },
      { faces: 12, results: [{ result: 4 }] }
    ]
  };
  const dom = createPipelineDom([roll]);
  rendererModule.enhanceMtrolChatRollCard({
    rolls: [roll], flags: { mtrol: { rollCard: { family: "attack", formula: roll.formula, total: 10 } } }
  }, dom.root, { documentRef: fakeDocument });
  const card = dom.content.querySelector(".mtrol-roll-card");
  const dice = card.querySelector(".mtrol-roll-card__dice");
  assert.equal(card.dataset.mtrolDense, "true");
  for (const face of ["d6", "d8", "d10", "d12"]) {
    assert.equal(card.querySelectorAll(`.${face}`).length, 1, face);
  }
  dice.clientHeight = 100;
  dice.scrollHeight = 140;
  delete card.dataset.mtrolFitChecked;
  assert.equal(rendererModule.fitMtrolPremiumCard(card), true);
  assert.equal(dice.dataset.mtrolScroll, "true");
});

test("el hook de render se registra una sola vez", () => {
  rendererModule.registerMtrolPremiumRollCards();
  rendererModule.registerMtrolPremiumRollCards();
  assert.equal(hookHandlers.filter(entry => entry.name === "renderChatMessage").length, 1);
});
