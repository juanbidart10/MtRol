// =========================
// MTROL - RUNTIME DEBUG API
// =========================

import {
  installActorDataDebugApi
} from "./actor-data-debug.js";

const OVERHEAD_KEYS = new Set([
  "overheadCost",
  "-=overheadCost"
]);

const SYSTEM_ID = "mtrol";
const DEBUG_SETTING_KEY = "enableDebugTools";

export function registerMtrolDebugSetting() {
  game.settings.register(SYSTEM_ID, DEBUG_SETTING_KEY, {
    name: "MTROL | Herramientas debug",
    hint: "Habilita APIs temporales de diagnostico legacy para GM.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });
}

function isDebugSettingEnabled() {
  try {
    return game.settings.get(SYSTEM_ID, DEBUG_SETTING_KEY) === true;
  } catch (_error) {
    return game.user?.isGM === true;
  }
}

function canInstallMtrolDebugApi() {
  return game.user?.isGM === true && isDebugSettingEnabled();
}

function isObject(value) {
  return value !== null && typeof value === "object";
}

function getDocumentData(document) {
  if (!document) return {};

  try {
    return document.toObject?.() ?? {};
  } catch (error) {
    console.warn("MTROL Debug | No se pudo serializar documento.", document, error);
    return {};
  }
}

function formatValue(value) {
  if (!isObject(value)) return value;

  try {
    return JSON.stringify(value);
  } catch (_error) {
    return String(value);
  }
}

function shouldIncludeKey(key, mode) {
  if (typeof key !== "string") return false;
  if (mode === "overhead") return OVERHEAD_KEYS.has(key) || key.startsWith("-=");
  return key.startsWith("-=");
}

function scanObject({
  value,
  path,
  result,
  mode,
  seen
}) {
  if (!isObject(value)) return;
  if (seen.has(value)) return;

  seen.add(value);

  for (const [key, child] of Object.entries(value)) {
    const childPath =
      path ? `${path}.${key}` : key;

    if (shouldIncludeKey(key, mode)) {
      result.push({
        path: childPath,
        key,
        value: child
      });
    }

    scanObject({
      value: child,
      path: childPath,
      result,
      mode,
      seen
    });
  }
}

function collectDocumentFindings({
  document,
  documentType,
  mode
}) {
  const data =
    getDocumentData(document);

  const scanRoot = {
    system: data.system ?? {},
    flags: data.flags ?? {},
    ownership: data.ownership ?? {}
  };

  const rawFindings = [];

  scanObject({
    value: scanRoot,
    path: "",
    result: rawFindings,
    mode,
    seen: new WeakSet()
  });

  return rawFindings.map(finding => ({
    tipo: documentType,
    nombre: document?.name ?? "(sin nombre)",
    uuid: document?.uuid ?? "(sin uuid)",
    path: finding.path,
    key: finding.key,
    valor: formatValue(finding.value)
  }));
}

function collectWorldDocuments() {
  const documents = [];

  for (const actor of game.actors ?? []) {
    documents.push({
      document: actor,
      documentType: "Actor"
    });

    for (const item of actor.items ?? []) {
      documents.push({
        document: item,
        documentType: "Actor Item"
      });
    }
  }

  for (const item of game.items ?? []) {
    documents.push({
      document: item,
      documentType: "World Item"
    });
  }

  return documents;
}

function runLegacyKeyScan({
  mode,
  label
}) {
  if (!game.user?.isGM) {
    ui.notifications.warn("MTROL Debug | Solo el GM puede ejecutar este diagnostico.");
    return [];
  }

  const results =
    collectWorldDocuments().flatMap(entry =>
      collectDocumentFindings({
        ...entry,
        mode
      })
    );

  console.groupCollapsed(`MTROL Debug | ${label} | ${results.length} hallazgos`);

  if (results.length) {
    console.table(results);
    console.warn(`MTROL Debug | ${label}`, results);
  } else {
    console.info(`MTROL Debug | ${label} | Sin hallazgos.`);
  }

  console.groupEnd();

  return results;
}

function getPixels(value) {
  const parsed =
    Number.parseFloat(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

function getDomElement(value) {
  if (!value) return null;
  if (value instanceof HTMLElement) return value;
  if (value[0] instanceof HTMLElement) return value[0];
  return null;
}

function getSheetDocumentType(app) {
  const document =
    app?.document ?? app?.actor ?? app?.item ?? null;

  return document?.documentName ?? document?.constructor?.name ?? null;
}

function isResizeTargetSheet(app) {
  const name =
    app?.constructor?.name ?? "";

  const document =
    app?.document ?? app?.actor ?? app?.item ?? null;

  return (
    name === "PersonajeSheet" ||
    name === "CompetenciaSheet" ||
    name === "ObjetoSheet" ||
    document?.type === "personaje" ||
    document?.type === "character" ||
    document?.type === "competencia" ||
    document?.type === "objeto" ||
    document?.type === "item"
  );
}

function getSelectorHint(element) {
  if (!element) return "(sin elemento)";

  const id =
    element.id ? `#${element.id}` : "";

  const classes =
    [...element.classList].map(className => `.${className}`).join("");

  return `${element.tagName.toLowerCase()}${id}${classes}`;
}

function getStyleSnapshot(element) {
  if (!element) return null;

  const computed =
    getComputedStyle(element);

  const rect =
    element.getBoundingClientRect();

  return {
    selector: getSelectorHint(element),
    classes: [...element.classList].join(" "),
    tag: element.tagName.toLowerCase(),
    inlineHeight: element.style.height || "",
    inlineMinHeight: element.style.minHeight || "",
    inlineMaxHeight: element.style.maxHeight || "",
    height: computed.height,
    minHeight: computed.minHeight,
    maxHeight: computed.maxHeight,
    overflow: computed.overflow,
    overflowY: computed.overflowY,
    display: computed.display,
    flex: computed.flex,
    flexDirection: computed.flexDirection,
    position: computed.position,
    resize: computed.resize,
    rectHeight: Math.round(rect.height),
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    scrollDelta: element.scrollHeight - element.clientHeight
  };
}

function collectInterestingElements(root) {
  if (!root) return [];

  const selectors = [
    ".app.window-app",
    ".window-resizable-handle",
    ".resize-handle",
    ".mtrol-custom-resize-handle",
    ".window-content",
    "form",
    ".mtrol-personaje",
    ".personaje-sheet",
    ".mtrol-sheet",
    ".sheet-body",
    ".tab",
    ".tab.active",
    ".mtrol-tabs-content",
    ".mtrol-sheet-body-v2",
    ".mtrol-competencia-sheet",
    ".mtrol-competencia-body",
    ".mtrol-competencia-tab-content",
    ".mtrol-competencia-tab",
    ".mtrol-objeto-sheet",
    "header",
    ".sheet-header",
    ".mtrol-master-header",
    ".mtrol-body-build",
    ".mtrol-equipment-tab",
    ".mtrol-equipment-layout",
    ".progresion-header",
    ".progresion-panel",
    ".inventario-tab"
  ];

  const elements =
    selectors.flatMap(selector => [...root.querySelectorAll(selector)]);

  return [...new Set([root, ...elements])];
}

function findHeightBlockers(root) {
  if (!root) {
    return {
      largestMinHeight: null,
      largestScrollOverflow: null,
      inlineHeightStyles: [],
      tallChildren: []
    };
  }

  const allElements =
    [root, ...root.querySelectorAll("*")];

  const measured =
    allElements.map(element => {
      const computed =
        getComputedStyle(element);

      const rect =
        element.getBoundingClientRect();

      return {
        element,
        selector: getSelectorHint(element),
        classes: [...element.classList].join(" "),
        minHeightPx: getPixels(computed.minHeight),
        heightPx: rect.height,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        scrollDelta: element.scrollHeight - element.clientHeight,
        inlineHeight: element.style.height || "",
        inlineMinHeight: element.style.minHeight || "",
        overflowY: computed.overflowY,
        display: computed.display
      };
    });

  const largestMinHeight =
    measured
      .filter(entry => entry.minHeightPx > 0)
      .sort((a, b) => b.minHeightPx - a.minHeightPx)[0] ?? null;

  const largestScrollOverflow =
    measured
      .filter(entry => entry.scrollDelta > 0)
      .sort((a, b) => b.scrollDelta - a.scrollDelta)[0] ?? null;

  const inlineHeightStyles =
    measured
      .filter(entry => entry.inlineHeight || entry.inlineMinHeight)
      .map(entry => ({
        selector: entry.selector,
        classes: entry.classes,
        inlineHeight: entry.inlineHeight,
        inlineMinHeight: entry.inlineMinHeight
      }));

  const rootHeight =
    root.getBoundingClientRect().height;

  const tallChildren =
    measured
      .filter(entry => entry.element !== root && entry.heightPx > rootHeight * 0.85)
      .sort((a, b) => b.heightPx - a.heightPx)
      .slice(0, 10)
      .map(entry => ({
        selector: entry.selector,
        classes: entry.classes,
        height: Math.round(entry.heightPx),
        minHeight: entry.minHeightPx,
        overflowY: entry.overflowY,
        display: entry.display
      }));

  return {
    largestMinHeight: largestMinHeight
      ? {
          selector: largestMinHeight.selector,
          classes: largestMinHeight.classes,
          minHeight: largestMinHeight.minHeightPx,
          inlineMinHeight: largestMinHeight.inlineMinHeight,
          height: Math.round(largestMinHeight.heightPx)
        }
      : null,
    largestScrollOverflow: largestScrollOverflow
      ? {
          selector: largestScrollOverflow.selector,
          classes: largestScrollOverflow.classes,
          scrollDelta: largestScrollOverflow.scrollDelta,
          scrollHeight: largestScrollOverflow.scrollHeight,
          clientHeight: largestScrollOverflow.clientHeight,
          overflowY: largestScrollOverflow.overflowY
        }
      : null,
    inlineHeightStyles,
    tallChildren
  };
}

function getAppRootElement(app) {
  const element =
    getDomElement(app?.element);

  if (element) return element;

  const appId =
    app?.appId ?? app?.id ?? null;

  if (appId !== null) {
    return document.querySelector(`#app-${appId}`);
  }

  return null;
}

function inspectApplicationResize(app) {
  const root =
    getAppRootElement(app);

  const windowContent =
    root?.querySelector(".window-content") ?? null;

  const resizeHandle =
    root?.querySelector(".window-resizable-handle") ?? null;

  const rootRect =
    root?.getBoundingClientRect?.() ?? null;

  const hitTestX =
    rootRect ? Math.max(0, rootRect.right - 4) : null;

  const hitTestY =
    rootRect ? Math.max(0, rootRect.bottom - 4) : null;

  const cornerElement =
    rootRect ? document.elementFromPoint(hitTestX, hitTestY) : null;

  const interesting =
    collectInterestingElements(root);

  const snapshots =
    interesting.map(getStyleSnapshot).filter(Boolean);

  const blockers =
    findHeightBlockers(root);

  return {
    appId: app?.appId ?? app?.id ?? null,
    sheetClass: app?.constructor?.name ?? null,
    documentType: getSheetDocumentType(app),
    documentName: app?.document?.name ?? app?.actor?.name ?? app?.item?.name ?? null,
    rootSelector: getSelectorHint(root),
    rootClasses: root ? [...root.classList].join(" ") : "",
    windowContentSelector: getSelectorHint(windowContent),
    resizeHandle: {
      exists: !!resizeHandle,
      selector: getSelectorHint(resizeHandle),
      snapshot: getStyleSnapshot(resizeHandle),
      cornerHitTest: {
        x: hitTestX,
        y: hitTestY,
        selector: getSelectorHint(cornerElement),
        classes: cornerElement ? [...cornerElement.classList].join(" ") : ""
      }
    },
    options: {
      width: app?.options?.width,
      height: app?.options?.height,
      minWidth: app?.options?.minWidth,
      minHeight: app?.options?.minHeight,
      maxHeight: app?.options?.maxHeight,
      resizable: app?.options?.resizable,
      classes: app?.options?.classes
    },
    position: {
      width: app?.position?.width,
      height: app?.position?.height,
      minWidth: app?.position?.minWidth,
      minHeight: app?.position?.minHeight
    },
    defaultOptions: {
      width: app?.constructor?.defaultOptions?.width,
      height: app?.constructor?.defaultOptions?.height,
      minWidth: app?.constructor?.defaultOptions?.minWidth,
      minHeight: app?.constructor?.defaultOptions?.minHeight,
      maxHeight: app?.constructor?.defaultOptions?.maxHeight,
      resizable: app?.constructor?.defaultOptions?.resizable,
      classes: app?.constructor?.defaultOptions?.classes
    },
    snapshots,
    blockers
  };
}

function logResizeInspection(report) {
  console.groupCollapsed(
    `MTROL Debug | Sheet resize | ${report.sheetClass} | ${report.documentName ?? "sin documento"}`
  );

  console.info("Application", {
    appId: report.appId,
    sheetClass: report.sheetClass,
    documentType: report.documentType,
    rootSelector: report.rootSelector,
    rootClasses: report.rootClasses,
    windowContentSelector: report.windowContentSelector,
    resizeHandle: report.resizeHandle
  });

  console.info("Options / position", {
    options: report.options,
    position: report.position,
    defaultOptions: report.defaultOptions
  });

  console.table(report.snapshots);
  console.warn("Blocker candidates", report.blockers);

  console.groupEnd();
}

function inspectSheetResize() {
  if (!game.user?.isGM) {
    ui.notifications.warn("MTROL Debug | Solo el GM puede inspeccionar resize de sheets.");
    return [];
  }

  const apps =
    Object.values(ui.windows ?? {}).filter(isResizeTargetSheet);

  if (!apps.length) {
    console.warn(
      "MTROL Debug | No hay PersonajeSheet, CompetenciaSheet u ObjetoSheet abiertas para inspeccionar."
    );
    return [];
  }

  const reports =
    apps.map(inspectApplicationResize);

  for (const report of reports) {
    logResizeInspection(report);
  }

  return reports;
}

export function installMtrolDebugApi() {
  game.mtrol = game.mtrol || {};
  game.mtrol.debug = game.mtrol.debug || {};
  game.mtrol.debug.inspectSheetResize = inspectSheetResize;
  installActorDataDebugApi(game.mtrol.debug);

  if (!canInstallMtrolDebugApi()) {
    return false;
  }

  game.mtrol.debug.findOverheadCost = () =>
    runLegacyKeyScan({
      mode: "overhead",
      label: "Busqueda overheadCost / claves legacy -="
    });

  game.mtrol.debug.scanLegacyDeletionKeys = () =>
    runLegacyKeyScan({
      mode: "legacy",
      label: "Busqueda de claves legacy -="
    });

  return true;
}
