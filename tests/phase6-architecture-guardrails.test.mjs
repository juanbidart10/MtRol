import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.env.MTROL_TEST_ROOT
  ? resolve(process.env.MTROL_TEST_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptRoot = resolve(root, "scripts");

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : entry.name.endsWith(".js") ? [path] : [];
  });
}

const sourceFiles = files(scriptRoot);
const key = path => relative(root, path).replaceAll("\\", "/");
const sources = new Map(sourceFiles.map(path => [key(path), readFileSync(path, "utf8")]));

function resolveImport(file, specifier) {
  if (!specifier.startsWith(".")) return null;
  const path = resolve(root, dirname(file), specifier);
  return key(path);
}

function dependencyGraph() {
  const graph = new Map([...sources.keys()].map(file => [file, new Set()]));
  const pattern = /(?:from\s*|import\s*\()(["'])(\.{1,2}\/[^"']+)\1/g;
  for (const [file, source] of sources) {
    for (const match of source.matchAll(pattern)) {
      const target = resolveImport(file, match[2]);
      if (target && sources.has(target)) graph.get(file).add(target);
    }
  }
  return graph;
}

function cycles(graph) {
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  const found = new Set();
  function visit(node) {
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      const cycle = [...stack.slice(start), node];
      found.add(cycle.join(" -> "));
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    stack.push(node);
    for (const target of graph.get(node) ?? []) visit(target);
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }
  for (const node of graph.keys()) visit(node);
  return [...found];
}

test("Fase 6 prohíbe ciclos ESM estáticos o dinámicos", () => {
  assert.deepEqual(cycles(dependencyGraph()), []);
});

test("game.mtrol queda restringido a instaladores de façade pública", () => {
  const installers = new Set([
    "scripts/actions/action-engine.js",
    "scripts/combat/special-ability-service.js",
    "scripts/combat/turn-system.js",
    "scripts/core/debug.js",
    "scripts/core/init.js",
    "scripts/core/ready.js",
    "scripts/scene-fx/ambient-fx-manager.js",
    "scripts/states/death-engine.js",
    "scripts/states/state-engine.js",
    "scripts/trade/trade-api.js",
    "scripts/utils/logger.js"
  ]);
  const consumers = [...sources].filter(([, source]) => /\bgame\.mtrol(?!3d)\b/.test(source))
    .map(([file]) => file)
    .filter(file => !installers.has(file));
  assert.deepEqual(consumers, []);
});

test("invariantes de iniciativa, Sheet y legacy permanecen protegidas", () => {
  const all = [...sources.values()].join("\n");
  assert.equal((all.match(/\.nextTurn\s*\(/g) ?? []).length, 1);
  const sheet = sources.get("scripts/sheets/actors/personaje-sheet.js");
  assert.doesNotMatch(sheet, /this\.actor\.(?:update|setFlag|unsetFlag|createEmbeddedDocuments|updateEmbeddedDocuments|deleteEmbeddedDocuments)\s*\(/);
  assert.equal(existsSync(resolve(root, "scripts/items/trade-engine.js")), false);
  assert.equal(existsSync(resolve(root, "scripts/ui/trade-dialog.js")), false);
  assert.doesNotMatch(all, /mtrolEjecutarComercio|abrirDialogoComercioMtrol/);
});

test("logging productivo usa logger central y no existen catches vacíos", () => {
  const explicitDiagnosticReports = new Set([
    "scripts/core/actor-data-debug.js",
    "scripts/core/debug.js",
    "scripts/core/item-data-repair.js",
    "scripts/core/world-item-audit.js"
  ]);
  const directConsole = [...sources]
    .filter(([file, source]) => /\bconsole\.(?:log|warn|error)\s*\(/.test(source) && !explicitDiagnosticReports.has(file))
    .map(([file]) => file);
  assert.deepEqual(directConsole, []);

  const emptyCatches = [...sources]
    .filter(([, source]) => /catch\s*(?:\([^)]*\))?\s*\{\s*\}/s.test(source))
    .map(([file]) => file);
  assert.deepEqual(emptyCatches, []);
});

const MAP_SET_CLASSIFICATION = Object.freeze({
  cache: new Set([
    "scripts/actions/action-damage-engine.js:executingResolvedDamageActions",
    "scripts/actors/actor-resource-service.js:actorResourceQueues",
    "scripts/actors/actor-resource-service.js:completedTransactions",
    "scripts/combat/turn-advance-service.js:turnAdvanceLocks",
    "scripts/combat/turn-system.js:localGrantedMovementReservations",
    "scripts/combat/turn-system.js:localMovementReservations",
    "scripts/combat/turn-system.js:movementWarningReceipts",
    "scripts/combat/turn-system.js:preparationOperationLocks",
    "scripts/core/socket-requests.js:pendingSocketRequests",
    "scripts/integrations/sequencer.js:activeMtrolFxNames",
    "scripts/items/consumable-service.js:authoritativeUsesInProgress",
    "scripts/items/consumable-service.js:clientUsesInProgress",
    "scripts/items/consumable-service.js:completedUses",
    "scripts/items/item-destruction-engine.js:destructionInProgress",
    "scripts/progression/orb-management-service.js:actorQueues",
    "scripts/rolls/dharma-spend-service.js:actorConsumptionQueues",
    "scripts/rolls/dharma-spend-service.js:consumedTransactions",
    "scripts/states/death-engine.js:DEATH_TRANSITION_DATA",
    "scripts/states/death-engine.js:actorDeathFxKeys",
    "scripts/states/death-engine.js:playedDeathFxKeys",
    "scripts/states/death-engine.js:syncingActors",
    "scripts/trade/trade-api.js:clientSessions",
    "scripts/trade/trade-gm-runtime.js:monitors",
    "scripts/trade/trade-runtime.js:activeTradeApps",
    "scripts/ui/chat-card-assets.js:unresolvedFamilyAudit"
  ]),
  legitimate: new Set([
    "scripts/actions/action-definition-resolver.js:OPPOSED_DAMAGE_ACTION_TYPES",
    "scripts/actions/opposition-policy.js:ACTION_IDENTITIES",
    "scripts/actions/opposition-policy.js:LEGACY_OFFENSIVE_TYPES",
    "scripts/actions/opposition-policy.js:VALID_CAPABILITIES",
    "scripts/actions/opposition-policy.js:VALID_DOMAINS",
    "scripts/actors/actor-resource-service.js:MANUAL_SPIRITUAL_RESOURCES",
    "scripts/actors/actor-resource-service.js:RESOURCE_ORIGINS",
    "scripts/actors/actor-resource-service.js:RESTORABLE_RESOURCES",
    "scripts/actors/class-resource-service.js:CONFIG_CHANGE_KEYS",
    "scripts/actors/class-resource-service.js:PERMANENT_CHANGE_KEYS",
    "scripts/actors/class-resource-service.js:RESOURCE_MODIFIER_ENTRY_KEYS",
    "scripts/actors/class-resource-service.js:RESOURCE_MODIFIER_VALUE_KEYS",
    "scripts/combat/movement-service.js:RULED_SOURCES",
    "scripts/combat/turn-state.js:OFFENSIVE_ACTION_TYPES",
    "scripts/competencies/competency-catalog.js:TECHNICAL_IDS",
    "scripts/competencies/competency-catalog.js:TECHNICAL_ID_BY_NAME",
    "scripts/core/actor-data-debug.js:COMBAT_CATEGORIES",
    "scripts/core/debug.js:OVERHEAD_KEYS",
    "scripts/core/item-data-repair.js:WRITE_CATEGORIES",
    "scripts/core/world-item-audit.js:KNOWN_ITEM_TYPES",
    "scripts/items/consumable-service.js:CONSUMABLE_OPERATIONS",
    "scripts/items/consumable-service.js:CONSUMABLE_RESOURCES",
    "scripts/items/item-invariants.js:ACTOR_TYPES",
    "scripts/items/item-invariants.js:COMPETENCE_TYPES",
    "scripts/items/item-invariants.js:OBJECT_TYPES",
    "scripts/items/shield-wear-engine.js:SHIELD_WEAR_REASONS",
    "scripts/runtime/receipt-store.js:OPPOSITION_COMMANDS",
    "scripts/runtime/transaction-commands.js:LEGACY_DIRECT_RESULT_COMMANDS",
    "scripts/rolls/dharma-engine.js:SUPPORTED_FACES",
    "scripts/sheets/actors/personaje-sheet-view-model.js:MTROL_COMBAT_BAR_CATEGORIES",
    "scripts/sheets/actors/personaje-sheet.js:MTROL_CLASS_RESOURCE_CONFIG_KEYS",
    "scripts/trade/trade-api.js:TERMINAL_SESSION_STATES",
    "scripts/trade/trade-audit-service.js:RELEVANT_EVENTS",
    "scripts/trade/trade-gm-runtime.js:TERMINAL",
    "scripts/trade/trade-proximity-service.js:LOCKED_STATES",
    "scripts/trade/trade-runtime.js:TERMINAL_STATES",
    "scripts/trade/trade-session-service.js:ACTIVE_STATES",
    "scripts/trade/trade-session-service.js:MUTABLE_OFFER_STATES",
    "scripts/trade/trade-view-model.js:EDITABLE_STATES",
    "scripts/ui/chat-card-assets.js:ATTACK_ACTIONS",
    "scripts/ui/chat-card-assets.js:DEFENSE_ACTIONS"
  ])
});

test("cada Map/Set module-level queda clasificado y ninguno es critical RAM-only", () => {
  const actual = new Set();
  const pattern = /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+(?:Map|Set)\s*\(/gm;
  for (const [file, source] of sources) {
    for (const match of source.matchAll(pattern)) actual.add(`${file}:${match[1]}`);
  }
  const classified = new Set([
    ...MAP_SET_CLASSIFICATION.cache,
    ...MAP_SET_CLASSIFICATION.legitimate
  ]);
  assert.deepEqual([...actual].filter(entry => !classified.has(entry)), []);
  assert.deepEqual([...classified].filter(entry => !actual.has(entry)), []);
});
