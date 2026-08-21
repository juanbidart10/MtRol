import {
  buildMtrolCardMetadata,
  resolveMtrolCardAsset,
  resolveMtrolCardState
} from "./chat-card-assets.js";
import { isMtrolDestinyCardContent } from "./destiny-chat-card.js";

let premiumRollCardHandlerRegistered = false;

function getRootElement(html) {
  if (!html) return null;
  if (html.nodeType === 1) return html;
  if (html[0]?.nodeType === 1) return html[0];
  return null;
}

function getMessageContent(root) {
  if (!root) return null;
  if (root.matches?.(".message-content")) return root;
  return root.querySelector?.(".message-content") ?? null;
}

function getMessageRolls(message) {
  if (Array.isArray(message?.rolls)) return message.rolls.filter(Boolean);
  if (message?.rolls && Symbol.iterator in Object(message.rolls)) {
    return Array.from(message.rolls).filter(Boolean);
  }
  return message?.roll ? [message.roll] : [];
}

function getStoredMetadata(message) {
  return message?.flags?.mtrol?.rollCard ?? message?.getFlag?.("mtrol", "rollCard") ?? null;
}

function getAll(root, selector) {
  return Array.from(root?.querySelectorAll?.(selector) ?? []);
}

function inferHistoricalMetadata(content, rolls) {
  const title =
    content.querySelector?.("h2")?.textContent?.trim() ||
    content.querySelector?.(".dice-flavor")?.textContent?.trim() ||
    "Tirada MtROL";
  const family = content.querySelector?.(".mtrol-combat-card")
    ? "damagePhysical"
    : "attack";
  const state = resolveMtrolCardState({
    fumble: Boolean(content.querySelector?.(".mtrol-chat-pifia")),
    critical: Boolean(content.querySelector?.(".mtrol-combat-crit-block"))
  });

  return buildMtrolCardMetadata({ family, state, title }, rolls);
}

function createTextElement(documentRef, tagName, className, text) {
  const element = documentRef.createElement(tagName);
  element.className = className;
  element.textContent = String(text ?? "");
  return element;
}

function createCardArt(documentRef, metadata) {
  const art = documentRef.createElement("img");
  art.className = "mtrol-roll-card__art";
  art.src = resolveMtrolCardAsset({ family: metadata.family, state: metadata.state });
  art.alt = "";
  art.setAttribute("aria-hidden", "true");
  return art;
}

function createCardHeader(documentRef, metadata) {
  const header = documentRef.createElement("header");
  header.className = "mtrol-roll-card__header";

  const formula = createTextElement(
    documentRef,
    "p",
    "mtrol-roll-card__formula",
    metadata.formula
  );
  formula.setAttribute("aria-label", `Fórmula: ${metadata.formula}`);

  header.append(
    createTextElement(documentRef, "h2", "mtrol-roll-card__title", metadata.title),
    formula
  );
  return header;
}

function createCardResult(documentRef, metadata) {
  const value = String(metadata.total ?? "—");
  const result = documentRef.createElement("section");
  result.className = "mtrol-roll-card__result";
  result.dataset.mtrolTotalLength = value.length > 3 ? "long" : String(value.length);

  const total = createTextElement(
    documentRef,
    "output",
    "mtrol-roll-card__total",
    value
  );
  total.setAttribute("aria-label", `Resultado final: ${value}`);
  result.append(total);
  return result;
}

export function getMtrolRollModifiers(roll) {
  const modifiers = [];
  let operator = "+";

  for (const term of Array.from(roll?.terms ?? [])) {
    if (typeof term?.operator === "string") {
      operator = term.operator;
      continue;
    }

    const isDie =
      Number.isFinite(Number(term?.faces)) || Array.isArray(term?.results);
    if (isDie || !Number.isFinite(Number(term?.number))) continue;

    const number = Number(term.number);
    const displayByOperator = {
      "+": `${number >= 0 ? "+" : ""}${number}`,
      "-": `${-number >= 0 ? "+" : ""}${-number}`,
      "*": `×${number}`,
      "/": `÷${number}`,
      "%": `%${number}`,
      "**": `^${number}`
    };
    const display = displayByOperator[operator];
    if (!display) continue;

    const label = String(term?.options?.flavor ?? term?.flavor ?? "").trim();
    if (number === 0 && !label) {
      operator = "+";
      continue;
    }

    modifiers.push({
      label,
      operator,
      number,
      value: operator === "-" ? -number : number,
      display
    });
    operator = "+";
  }

  return modifiers;
}

function describeModifier(modifier) {
  return modifier.label ? `${modifier.label}: ${modifier.display}` : modifier.display;
}

function groupModifiers(modifiers) {
  if (modifiers.length <= 4) return modifiers.map(modifier => [modifier]);

  const groups = modifiers.map(modifier => [modifier]);
  while (groups.length > 4) {
    const compatibleIndex = groups.findIndex((group, index) => {
      const next = groups[index + 1];
      return next && [...group, ...next].every(
        modifier => modifier.operator === "+" || modifier.operator === "-"
      );
    });
    const index = compatibleIndex >= 0 ? compatibleIndex : groups.length - 2;
    groups.splice(index, 2, [...groups[index], ...groups[index + 1]]);
  }
  return groups;
}

function formatModifierGroup(group) {
  if (group.length === 1) return group[0].display;
  if (group.every(modifier => modifier.operator === "+" || modifier.operator === "-")) {
    const sum = group.reduce((total, modifier) => total + modifier.value, 0);
    return `${sum >= 0 ? "+" : ""}${sum}`;
  }
  return group.map(modifier => modifier.display).join(" ");
}

function createModifierGrid(documentRef, modifiers) {
  const list = documentRef.createElement("ul");
  list.className = "mtrol-roll-card__modifier-grid";
  const groups = groupModifiers(modifiers);

  for (let index = 0; index < 4; index++) {
    const group = groups[index] ?? [];
    const item = documentRef.createElement("li");
    item.className = "mtrol-roll-card__modifier-slot";
    item.dataset.mtrolModifierCount = String(group.length);

    if (group.length) {
      const detail = group.map(describeModifier).join("; ");
      item.setAttribute("title", detail);
      item.setAttribute("aria-label", `Modificador: ${detail}`);
      item.append(
        createTextElement(
          documentRef,
          "span",
          "mtrol-roll-card__modifier-value",
          formatModifierGroup(group)
        )
      );
    }
    list.append(item);
  }
  return list;
}

function findRollDisplayNodes(content) {
  const nodes = [];
  const seen = new Set();

  for (const diceRoll of getAll(content, ".dice-roll")) {
    const wrapper = diceRoll.closest?.(".mtrol-roll-block") ?? null;
    const node = wrapper?.dataset?.mtrolRollIndex !== undefined ? wrapper : diceRoll;
    if (seen.has(node)) continue;
    seen.add(node);
    nodes.push(node);
  }
  return nodes;
}

function isMtrolMessageContent(content) {
  return Boolean(
    content?.querySelector?.(".mtrol-roll-block") ||
    content?.querySelector?.(".mtrol-chat-card") ||
    content?.querySelector?.(".mtrol-combat-card")
  );
}

function getNativeRoll(rollNode) {
  return rollNode?.matches?.(".dice-roll")
    ? rollNode
    : rollNode?.querySelector?.(".dice-roll") ?? null;
}

function getRollFlavor(rollNode) {
  return String(
    getNativeRoll(rollNode)?.querySelector?.(".dice-flavor")?.textContent ?? ""
  ).trim();
}

function getCriticalChainIndex(flavor, rollIndex) {
  const normalized = String(flavor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (!normalized.includes("cadena")) return null;

  const explicitIndex = Number(normalized.match(/cadena[^0-9]*(\d+)/)?.[1]);
  return Number.isInteger(explicitIndex) && explicitIndex > 0
    ? explicitIndex
    : Math.max(1, rollIndex);
}

function getDieTerms(roll) {
  return Array.from(roll?.terms ?? [])
    .map((term, termIndex) => ({ term, termIndex }))
    .filter(({ term }) =>
      Number.isFinite(Number(term?.faces)) && Array.isArray(term?.results)
    );
}

function getActiveResults(term) {
  return Array.from(term?.results ?? [])
    .map((result, resultIndex) => ({ result, resultIndex }))
    .filter(({ result }) => result?.active !== false);
}

function createFallbackDieResult(documentRef, faces, value) {
  return createTextElement(
    documentRef,
    "li",
    `roll die d${faces}`,
    value
  );
}

function getDharmaTrace(metadata, rollIndex, termIndex, resultIndex) {
  if (rollIndex !== 0) return null;

  return Array.from(metadata?.dharma?.traces ?? []).find(trace =>
    Number(trace.termIndex) === termIndex &&
    Number(trace.resultIndex) === resultIndex
  ) ?? null;
}

function describeDharmaTrace(trace) {
  const prefix = `D${trace.faces}, natural ${trace.naturalResult}`;

  if (trace.fumblePrevented) {
    return `${prefix}, Dharma: pifia anulada, resultado ${trace.finalResult}`;
  }

  if (trace.naturalCritical) {
    if (trace.criticalResolvedResult === null) {
      return `${prefix}, crítico, cadena cancelada antes del bono final de Dharma`;
    }

    return `${prefix}, crítico, cadena ${trace.criticalResolvedResult}, Dharma: +1 final, resultado ${trace.finalResult}`;
  }

  return `${prefix}, Dharma: +1, resultado ${trace.finalResult}`;
}

function annotateDharmaResult(resultNode, trace) {
  if (!resultNode || !trace) return;

  const description = describeDharmaTrace(trace);
  resultNode.classList?.add("mtrol-die-result--dharma");
  resultNode.dataset.mtrolDharma = "true";
  resultNode.dataset.mtrolNaturalResult = String(trace.naturalResult);
  resultNode.dataset.mtrolEffectiveResult = String(trace.effectiveResult);
  resultNode.dataset.mtrolFinalResult = String(trace.finalResult ?? "");
  resultNode.dataset.mtrolFumblePrevented = String(trace.fumblePrevented === true);
  resultNode.setAttribute("title", description);
  resultNode.setAttribute("aria-label", description);
}

function createNormalizedBreakdown(documentRef, message, metadata, rolls, rollNodes) {
  const breakdown = documentRef.createElement("div");
  breakdown.className = "dice-tooltip mtrol-roll-breakdown";
  breakdown.setAttribute("role", "list");

  const messageId = String(message?.id ?? "mtrol-message");
  const groupsByFaces = new Map();

  for (const [rollIndex, roll] of rolls.entries()) {
    const rollNode = rollNodes[rollIndex] ?? null;
    const nativeRoll = getNativeRoll(rollNode);
    const nativeParts = getAll(nativeRoll, ".tooltip-part");
    const chainIndex = getCriticalChainIndex(getRollFlavor(rollNode), rollIndex);

    for (const [dieTermIndex, { term, termIndex }] of getDieTerms(roll).entries()) {
      const faces = Number(term.faces);
      const activeResults = getActiveResults(term);
      if (!activeResults.length) continue;

      const nativeList = nativeParts[dieTermIndex]?.querySelector?.(".dice-rolls") ?? null;
      const nativeResults = getAll(nativeList, ".roll");
      let visualGroup = groupsByFaces.get(faces);

      if (!visualGroup) {
        const group = documentRef.createElement("div");
        group.className = "mtrol-die-group";
        group.dataset.faces = String(faces);
        group.setAttribute("role", "listitem");

        const label = createTextElement(
          documentRef,
          "span",
          "mtrol-die-group__label",
          `D${faces}`
        );
        const resultsList = documentRef.createElement("ol");
        resultsList.className = "dice-rolls mtrol-die-group__results";
        group.append(label, resultsList);
        breakdown.append(group);

        visualGroup = { group, label, resultsList, count: 0 };
        groupsByFaces.set(faces, visualGroup);
      }

      for (const [activeIndex, { result, resultIndex }] of activeResults.entries()) {
        const resultNode = nativeResults[resultIndex] ?? nativeResults[activeIndex] ??
          createFallbackDieResult(documentRef, faces, result?.result ?? "—");
        resultNode.classList?.add("roll", "die", `d${faces}`);
        resultNode.dataset.mtrolResultId =
          `${messageId}:${rollIndex}:${termIndex}:${resultIndex}`;
        resultNode.dataset.mtrolMessageId = messageId;
        resultNode.dataset.mtrolRollIndex = String(rollIndex);
        resultNode.dataset.mtrolTermIndex = String(termIndex);
        resultNode.dataset.mtrolResultIndex = String(resultIndex);
        resultNode.dataset.mtrolFaces = String(faces);
        resultNode.dataset.mtrolValue = String(result?.result ?? "");
        resultNode.dataset.mtrolActive = "true";
        resultNode.dataset.mtrolOrigin = chainIndex === null ? "normal" : "chain";

        annotateDharmaResult(
          resultNode,
          getDharmaTrace(metadata, rollIndex, termIndex, resultIndex)
        );

        if (chainIndex !== null) {
          resultNode.classList?.add("mtrol-die-result--chain");
          resultNode.dataset.chainDepth = String(chainIndex);
          resultNode.setAttribute("title", `Cadena crítica ${chainIndex}`);
          resultNode.setAttribute(
            "aria-label",
            `D${faces}, resultado ${result?.result ?? "—"}, cadena crítica ${chainIndex}`
          );
        }

        visualGroup.resultsList.append(resultNode);
        visualGroup.count++;
      }
    }
  }

  for (const [faces, visualGroup] of groupsByFaces) {
    visualGroup.label.textContent =
      `D${faces}${visualGroup.count > 1 ? ` ×${visualGroup.count}` : ""}`;
    visualGroup.group.dataset.mtrolDieCount = String(visualGroup.count);
    if (visualGroup.count > 6) {
      visualGroup.group.dataset.mtrolDensity = "dense";
    } else if (visualGroup.count > 4) {
      visualGroup.group.dataset.mtrolDensity = "compact";
    }
  }

  return { breakdown, groupCount: groupsByFaces.size };
}

function markPremiumMessage(root) {
  root?.classList?.add(
    "mtrol-premium-roll-message",
    "mtrol-chat-message--premium"
  );
}

function removeElements(root, selector) {
  for (const element of getAll(root, selector)) element.remove?.();
}

function stripNativeRollSummaries(rollNodes) {
  for (const rollNode of rollNodes) {
    const nativeRoll = getNativeRoll(rollNode);
    if (!nativeRoll) continue;

    removeElements(nativeRoll, ".dice-flavor");
    removeElements(nativeRoll, ".dice-formula");
    removeElements(nativeRoll, ".dice-total");
    removeElements(nativeRoll, ".part-total");
    removeElements(nativeRoll, "p");
  }
}

function countDiceRows(root) {
  return getAll(root, ".mtrol-die-group").length;
}

function panelOverflows(panel) {
  if (!panel) return false;
  return (
    Number(panel.scrollHeight ?? 0) > Number(panel.clientHeight ?? 0) + 1 ||
    Number(panel.scrollWidth ?? 0) > Number(panel.clientWidth ?? 0) + 1
  );
}

export function fitMtrolPremiumCard(card) {
  if (!card || card.dataset.mtrolFitChecked === "true") return false;
  card.dataset.mtrolFitChecked = "true";

  const panel = card.querySelector?.(".mtrol-roll-card__dice");
  if (!panelOverflows(panel)) return false;

  card.dataset.mtrolDense = "true";
  panel.dataset.mtrolScroll = "true";
  return true;
}

function queueMtrolCardFitCheck(card) {
  if (typeof globalThis.requestAnimationFrame !== "function") return;
  globalThis.requestAnimationFrame(() => fitMtrolPremiumCard(card));
}

export function isMtrolPremiumCardEnhanced(content) {
  return Boolean(content?.querySelector?.('.mtrol-roll-card[data-mtrol-premium="v10"]'));
}

export function enhanceMtrolChatRollCard(message, html, {
  documentRef = globalThis.document
} = {}) {
  const root = getRootElement(html);
  const content = getMessageContent(root);
  if (!root || !content || !documentRef) return false;

  if (isMtrolDestinyCardContent(content)) {
    markPremiumMessage(root);
    return false;
  }

  if (isMtrolPremiumCardEnhanced(content)) {
    markPremiumMessage(root);
    return false;
  }

  const rolls = getMessageRolls(message);
  const storedMetadata = getStoredMetadata(message);
  if (!storedMetadata && !isMtrolMessageContent(content)) return false;
  if (!storedMetadata && rolls.length === 0) return false;

  const metadata = storedMetadata
    ? buildMtrolCardMetadata(storedMetadata, rolls)
    : inferHistoricalMetadata(content, rolls);
  const rollNodes = findRollDisplayNodes(content);

  const card = documentRef.createElement("article");
  card.className = "mtrol-roll-card";
  card.dataset.mtrolPremium = "v10";
  card.dataset.mtrolFamily = metadata.family;
  card.dataset.mtrolState = metadata.state;
  card.dataset.mtrolRollCount = String(rolls.length);

  if (metadata.dharma?.used) {
    const summary = `Dharma utilizado: ${metadata.dharma.used}`;
    card.dataset.mtrolDharmaUsed = String(metadata.dharma.used);
    card.setAttribute("title", summary);
    card.setAttribute("aria-description", summary);
  }

  card.append(
    createCardArt(documentRef, metadata),
    createCardHeader(documentRef, metadata),
    createCardResult(documentRef, metadata)
  );

  const breakdown = documentRef.createElement("section");
  breakdown.className = "mtrol-roll-card__breakdown";
  breakdown.setAttribute("aria-label", "Desglose de dados y modificadores");

  const dice = documentRef.createElement("div");
  dice.className = "mtrol-roll-card__dice";
  const normalized = createNormalizedBreakdown(
    documentRef,
    message,
    metadata,
    rolls,
    rollNodes
  );
  stripNativeRollSummaries(rollNodes);
  dice.append(normalized.breakdown);

  const rowCount = normalized.groupCount || countDiceRows(dice);
  if (rowCount > 3) card.dataset.mtrolDense = "true";

  const modifiers = rolls.flatMap(roll => getMtrolRollModifiers(roll));
  breakdown.append(dice, createModifierGrid(documentRef, modifiers));
  card.append(breakdown);

  content.replaceChildren(card);
  markPremiumMessage(root);
  queueMtrolCardFitCheck(card);
  return true;
}

export function registerMtrolPremiumRollCards() {
  if (premiumRollCardHandlerRegistered) return;
  premiumRollCardHandlerRegistered = true;
  Hooks.on("renderChatMessage", (message, html) => {
    enhanceMtrolChatRollCard(message, html);
  });
}
