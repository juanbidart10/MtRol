import {
  MTROL_BODY_SLOTS,
  MTROL_BODY_SLOT_LABELS
} from "../constants/body-slots.js";

import {
  calcularCargaActor
} from "./mtrol-carry-weight.js";

const COMBAT_CATEGORIES = new Set([
  "basico",
  "combate",
  "hechizo",
  "contraataque"
]);

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function isPhysicalItem(item) {
  return item?.type === "objeto" || item?.type === "item";
}

function requireReadableActor(actor) {
  if (!game.user?.isGM) {
    throw new Error("MTROL Debug | Solo el GM puede ejecutar esta auditoria.");
  }

  if (!actor || !actor.items || !actor.system) {
    throw new Error(
      "MTROL Debug | Debes proporcionar un actor cargado, por ejemplo game.actors.getName(\"Nombre\")."
    );
  }

  return actor;
}

function getItems(actor) {
  return Array.from(actor.items ?? []);
}

function getItemById(actor, itemId) {
  if (!itemId) return null;

  return actor.items?.get?.(itemId) ??
    getItems(actor).find(item => item.id === itemId) ??
    null;
}

function getWeightBreakdown(item) {
  const physical =
    isPhysicalItem(item);

  const persisted =
    toNumber(item?.system?.peso, 0);

  const legacy =
    toNumber(item?.system?.slots, 0);

  const quantity =
    toNumber(item?.system?.cantidad, 1);

  const hasMaterial =
    item?.system?.material !== undefined &&
    item?.system?.material !== null &&
    item?.system?.material !== "";

  let unitWeight = 0;
  let source = "excluido por type";

  if (physical && hasMaterial) {
    unitWeight = persisted;
    source = "material -> system.peso";
  } else if (physical && persisted > 0) {
    unitWeight = persisted;
    source = "system.peso";
  } else if (physical) {
    unitWeight = legacy;
    source = "legacy system.slots";
  }

  return {
    physical,
    persisted,
    legacy,
    quantity,
    hasMaterial,
    unitWeight,
    subtotal: unitWeight * quantity,
    source
  };
}

function uniqueItems(items) {
  const seen = new Set();

  return items.filter(item => {
    const key = item?.id ?? item?.uuid;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sumActualWeight(items) {
  return uniqueItems(items)
    .reduce((total, item) => total + getWeightBreakdown(item).subtotal, 0);
}

function prepareSheetCollections(actor) {
  const items =
    getItems(actor);

  const competencias =
    items.filter(item => item.type === "competencia");

  const habilidadesCombate =
    competencias.filter(item => COMBAT_CATEGORIES.has(item.system?.categoria));

  const competenciasGenerales =
    competencias.filter(item => !COMBAT_CATEGORIES.has(item.system?.categoria));

  const habilidadesEquipadasCombate =
    habilidadesCombate.filter(item =>
      item.system?.equipadaCombate === true ||
      item.system?.equipadaCombate === "true"
    );

  const objetos =
    items.filter(isPhysicalItem);

  const objetosInventario =
    objetos.filter(item => !item.system?.equipado);

  const objetosEquipados =
    objetos.filter(item => item.system?.equipado);

  const slotsEquipamiento =
    MTROL_BODY_SLOTS.map(slot => {
      const reference =
        actor.system?.equipamiento?.[slot] ?? "";

      return {
        slot,
        label: MTROL_BODY_SLOT_LABELS[slot] ?? slot,
        reference,
        item: getItemById(actor, reference)
      };
    });

  const itemsEnSlots =
    uniqueItems(slotsEquipamiento.map(entry => entry.item).filter(Boolean));

  const consumibles =
    objetos.filter(item => item.system?.tipoObjeto === "consumible");

  const materiales =
    objetos.filter(item =>
      item.system?.tipoObjeto === "material" ||
      (
        item.system?.material !== undefined &&
        item.system?.material !== null &&
        item.system?.material !== ""
      )
    );

  return {
    items,
    competencias,
    habilidadesCombate,
    competenciasGenerales,
    habilidadesEquipadasCombate,
    objetos,
    objetosInventario,
    objetosEquipados,
    slotsEquipamiento,
    itemsEnSlots,
    consumibles,
    materiales
  };
}

function getAppearance(item, collections) {
  const inInventory =
    collections.objetosInventario.includes(item);

  const equipmentSlots =
    collections.slotsEquipamiento
      .filter(entry => entry.item?.id === item.id)
      .map(entry => entry.slot);

  const inEquipment =
    equipmentSlots.length > 0;

  const inCombatBar =
    collections.habilidadesEquipadasCombate.includes(item);

  const inCombatList =
    collections.habilidadesCombate.includes(item);

  const inCompetenceList =
    collections.competenciasGenerales.includes(item);

  const rendered =
    inInventory ||
    inEquipment ||
    inCombatBar ||
    inCombatList ||
    inCompetenceList;

  return {
    inInventory,
    inEquipment,
    inCombatBar,
    inCombatList,
    inCompetenceList,
    equipmentSlots,
    rendered
  };
}

function getExclusionReason(item, appearance) {
  if (appearance.rendered) return "";

  if (isPhysicalItem(item)) {
    if (item.system?.equipado) {
      const detail =
        item.system.equipado === "false"
          ? " El valor string \"false\" es truthy para la Sheet."
          : "";

      return "Marcado como equipado, pero no esta referenciado por ningun slot de equipamiento." + detail;
    }

    return "Es objeto de inventario, pero no quedo incluido en una coleccion visual conocida.";
  }

  if (item.type === "competencia") {
    return "Competencia fuera de las colecciones visuales preparadas por la Sheet.";
  }

  return `Type no soportado por PersonajeSheet: ${item.type ?? "(sin type)"}.`;
}

function getCategory(item, weight) {
  if (item.type === "competencia") {
    return `competencia:${item.system?.categoria ?? "sin-categoria"}`;
  }

  if (item.type === "item") {
    return `legacy-item:${item.system?.tipoObjeto ?? "general"}`;
  }

  if (item.type === "objeto") {
    return `objeto:${item.system?.tipoObjeto ?? "general"}:${weight.source}`;
  }

  return `no-renderizado:${item.type ?? "sin-type"}`;
}

function createItemAuditRows(actor) {
  const collections =
    prepareSheetCollections(actor);

  return collections.items.map(item => {
    const weight =
      getWeightBreakdown(item);

    const appearance =
      getAppearance(item, collections);

    return {
      id: item.id ?? "",
      uuid: item.uuid ?? "",
      nombre: item.name ?? "(sin nombre)",
      type: item.type ?? "",
      tipoObjeto: item.system?.tipoObjeto ?? "",
      equipado: item.system?.equipado ?? false,
      slot: item.system?.slot ?? "",
      cantidad: item.system?.cantidad ?? 1,
      material: item.system?.material ?? "",
      pesoPersistido: item.system?.peso ?? null,
      slotsLegacy: item.system?.slots ?? null,
      pesoUtilizadoRealmente: weight.unitWeight,
      subtotal: weight.subtotal,
      fuentePeso: weight.source,
      apareceInventario: appearance.inInventory,
      apareceEquipamiento: appearance.inEquipment,
      slotsVisuales: appearance.equipmentSlots.join(", "),
      apareceBarraCombate: appearance.inCombatBar,
      apareceListaCombate: appearance.inCombatList,
      apareceCompetencias: appearance.inCompetenceList,
      motivoExclusion: getExclusionReason(item, appearance),
      categoria: getCategory(item, weight),
      participaCalculoPeso: weight.physical
    };
  });
}

function parseWeightDisplay(text) {
  const normalized =
    String(text ?? "").replace(/,/g, ".");

  const match =
    normalized.match(/(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)/);

  if (!match) return null;

  return {
    pesoActual: Number(match[1]),
    pesoMaximo: Number(match[2])
  };
}

function getVisibleSheetWeight(actor) {
  const apps =
    Object.values(ui.windows ?? {}).filter(app =>
      app?.actor?.id === actor.id ||
      app?.document?.id === actor.id
    );

  for (const app of apps) {
    const root =
      app.element?.[0] ?? app.element ?? null;

    if (!root?.querySelectorAll) continue;

    const candidates = [
      ...root.querySelectorAll(".mtrol-tab-inventario .slots-resumen span"),
      ...root.querySelectorAll(".mtrol-equipment-summary .mtrol-summary-row")
    ];

    for (const element of candidates) {
      const text =
        element.textContent?.trim() ?? "";

      if (!/Peso actual/i.test(text)) continue;

      const parsed =
        parseWeightDisplay(text);

      if (parsed) {
        return {
          ...parsed,
          texto: text,
          appId: app.appId ?? app.id ?? null,
          fuente: "DOM de la Sheet abierta"
        };
      }
    }
  }

  return {
    pesoActual: null,
    pesoMaximo: null,
    texto: "Sheet no abierta o valor no encontrado en el DOM",
    appId: null,
    fuente: "no disponible"
  };
}

function tableDocuments(items) {
  return items.map(item => ({
    id: item.id ?? "",
    nombre: item.name ?? "(sin nombre)",
    type: item.type ?? "",
    categoria: item.system?.categoria ?? "",
    tipoObjeto: item.system?.tipoObjeto ?? "",
    equipado: item.system?.equipado ?? false,
    slot: item.system?.slot ?? "",
    peso: getWeightBreakdown(item).subtotal
  }));
}

export function auditItems(actor) {
  actor = requireReadableActor(actor);

  const rows =
    createItemAuditRows(actor);

  console.groupCollapsed(`MTROL Debug | Items | ${actor.name} | ${rows.length} documentos`);
  console.table(rows);
  console.groupEnd();

  return rows;
}

export function findGhostItems(actor) {
  actor = requireReadableActor(actor);

  const ghosts =
    createItemAuditRows(actor)
      .filter(row =>
        !row.apareceInventario &&
        !row.apareceEquipamiento &&
        !row.apareceBarraCombate &&
        !row.apareceListaCombate &&
        !row.apareceCompetencias
      )
      .map(row => ({
        id: row.id,
        nombre: row.nombre,
        motivo: row.motivoExclusion,
        categoria: row.categoria,
        participaCalculoPeso: row.participaCalculoPeso,
        pesoAportado: row.subtotal
      }));

  console.groupCollapsed(`MTROL Debug | Ghost items | ${actor.name} | ${ghosts.length} hallazgos`);
  console.table(ghosts);
  console.groupEnd();

  return ghosts;
}

export function compareWeight(actor) {
  actor = requireReadableActor(actor);

  const rows =
    createItemAuditRows(actor).filter(row => row.participaCalculoPeso);

  const pesoPersistido =
    rows
      .filter(row => row.fuentePeso === "system.peso")
      .reduce((total, row) => total + row.subtotal, 0);

  const pesoLegacy =
    rows
      .filter(row => row.fuentePeso === "legacy system.slots")
      .reduce((total, row) => total + row.subtotal, 0);

  const pesoMaterial =
    rows
      .filter(row => row.fuentePeso === "material -> system.peso")
      .reduce((total, row) => total + row.subtotal, 0);

  const carga =
    calcularCargaActor(actor);

  const visible =
    getVisibleSheetWeight(actor);

  const categorizedTotal =
    pesoPersistido + pesoLegacy + pesoMaterial;

  const explicacion = [
    "Peso Persistido: objetos sin material cuyo aporte real usa system.peso.",
    "Peso Legacy: objetos sin peso positivo cuyo aporte real cae a system.slots.",
    "Peso Material: objetos con material cuyo aporte real usa system.peso, incluso si vale 0.",
    "Las tres categorias son excluyentes y su suma debe coincidir con calcularCargaActor().",
    visible.pesoActual === null
      ? "Para comparar contra la cifra realmente pintada, abre la Sheet del actor y vuelve a ejecutar la auditoria."
      : `Diferencia UI - calculo: ${visible.pesoActual - carga.pesoActual}.`
  ];

  const report = {
    pesoPersistido,
    pesoLegacy,
    pesoMaterial,
    pesoMostradoUI: visible.pesoActual,
    umbralMostradoUI: visible.pesoMaximo,
    pesoCalculado: carga.pesoActual,
    sumaCategorias: categorizedTotal,
    diferenciaCategoriasVsCalculo: categorizedTotal - carga.pesoActual,
    detalleUI: visible,
    explicacion
  };

  console.groupCollapsed(`MTROL Debug | Comparacion de peso | ${actor.name}`);
  console.table([{
    "Peso Persistido": pesoPersistido,
    "Peso Legacy": pesoLegacy,
    "Peso Material": pesoMaterial,
    "Peso mostrado UI": visible.pesoActual,
    "Peso calculado": carga.pesoActual
  }]);
  explicacion.forEach(message => console.info(message));
  console.groupEnd();

  return report;
}

export function auditCollections(actor) {
  actor = requireReadableActor(actor);

  const collections =
    prepareSheetCollections(actor);

  const ghosts =
    createItemAuditRows(actor).filter(row => row.motivoExclusion);

  const report = {
    inventario: collections.objetosInventario,
    objetosEquipadosPreparados: collections.objetosEquipados,
    slotsEquipamiento: collections.slotsEquipamiento,
    habilidadesCombate: collections.habilidadesCombate,
    competenciasGenerales: collections.competenciasGenerales,
    barraCombate: collections.habilidadesEquipadasCombate,
    consumibles: collections.consumibles,
    materiales: collections.materiales,
    objetosOcultos: ghosts
  };

  console.groupCollapsed(`MTROL Debug | Colecciones de PersonajeSheet | ${actor.name}`);

  console.groupCollapsed(`Inventario | ${report.inventario.length}`);
  console.table(tableDocuments(report.inventario));
  console.groupEnd();

  console.groupCollapsed(`Objetos equipados preparados (no iterados directamente por el template) | ${report.objetosEquipadosPreparados.length}`);
  console.table(tableDocuments(report.objetosEquipadosPreparados));
  console.groupEnd();

  console.groupCollapsed(`Slots de Equipamiento | ${report.slotsEquipamiento.length}`);
  console.table(report.slotsEquipamiento.map(entry => ({
    slot: entry.slot,
    label: entry.label,
    referencia: entry.reference,
    itemId: entry.item?.id ?? "",
    nombre: entry.item?.name ?? "",
    resuelta: !!entry.item
  })));
  console.groupEnd();

  for (const [label, items] of [
    ["Habilidades de combate", report.habilidadesCombate],
    ["Competencias generales", report.competenciasGenerales],
    ["Barra de combate", report.barraCombate],
    ["Consumibles (categoria diagnostica)", report.consumibles],
    ["Materiales (categoria diagnostica)", report.materiales]
  ]) {
    console.groupCollapsed(`${label} | ${items.length}`);
    console.table(tableDocuments(items));
    console.groupEnd();
  }

  console.groupCollapsed(`Objetos ocultos / fuera de colecciones renderizadas | ${report.objetosOcultos.length}`);
  console.table(report.objetosOcultos);
  console.groupEnd();

  console.groupEnd();

  return report;
}

export function auditActor(actor) {
  actor = requireReadableActor(actor);

  const collections =
    prepareSheetCollections(actor);

  const carga =
    calcularCargaActor(actor);

  const visible =
    getVisibleSheetWeight(actor);

  const pesoInventario =
    sumActualWeight(collections.objetosInventario);

  const pesoEquipamiento =
    sumActualWeight(collections.itemsEnSlots);

  const ghosts =
    createItemAuditRows(actor).filter(row => row.motivoExclusion);

  const pesoGhost =
    ghosts.reduce((total, row) => total + row.subtotal, 0);

  const legacyItems =
    collections.items.filter(item => item.type === "item");

  const legacyWeightItems =
    collections.objetos.filter(item =>
      getWeightBreakdown(item).source === "legacy system.slots"
    );

  const diferencias = [];

  if (visible.pesoActual === null) {
    diferencias.push("No fue posible leer el peso pintado: abre la Sheet y repite auditActor(actor).");
  } else if (visible.pesoActual !== carga.pesoActual) {
    diferencias.push(
      `La UI muestra ${visible.pesoActual}, pero calcularCargaActor devuelve ${carga.pesoActual}.`
    );
  }

  const pesoEnColeccionesVisibles =
    pesoInventario + pesoEquipamiento;

  if (pesoEnColeccionesVisibles !== carga.pesoActual) {
    diferencias.push(
      `Inventario + Equipamiento visibles suman ${pesoEnColeccionesVisibles}; faltan ${carga.pesoActual - pesoEnColeccionesVisibles} respecto del calculo.`
    );
  }

  if (ghosts.length) {
    diferencias.push(
      `${ghosts.length} documentos no aparecen en colecciones renderizadas; aportan ${pesoGhost} de peso.`
    );
  }

  const report = {
    actor: {
      id: actor.id,
      uuid: actor.uuid,
      nombre: actor.name,
      type: actor.type
    },
    pesoMostradoSheet: visible,
    pesoCalculado: carga.pesoActual,
    pesoMaximo: carga.pesoMaximo,
    pesoInventario,
    pesoEquipamiento,
    pesoEnColeccionesVisibles,
    pesoGhost,
    cantidadTotalDocumentos: collections.items.length,
    cantidadCompetencias: collections.competencias.length,
    cantidadObjetos: collections.objetos.length,
    cantidadDocumentosLegacy: legacyItems.length,
    cantidadObjetosConPesoLegacy: legacyWeightItems.length,
    diferencias
  };

  console.groupCollapsed(`MTROL Debug | Auditoria actor | ${actor.name}`);
  console.info("Actor", report.actor);
  console.table([{
    "Peso mostrado Sheet": visible.pesoActual,
    "Peso calcularCargaActor": carga.pesoActual,
    "Peso Inventario": pesoInventario,
    "Peso Equipamiento": pesoEquipamiento,
    "Peso fuera de colecciones": pesoGhost,
    "Documentos": collections.items.length,
    "Competencias": collections.competencias.length,
    "Objetos": collections.objetos.length,
    "Legacy type=item": legacyItems.length,
    "Peso legacy slots": legacyWeightItems.length
  }]);

  if (diferencias.length) {
    diferencias.forEach(message => console.warn(message));
  } else {
    console.info("No se detectaron diferencias entre UI, calculo y colecciones visibles.");
  }

  console.groupEnd();

  return report;
}

export function installActorDataDebugApi(debugApi) {
  debugApi.auditActor = auditActor;
  debugApi.auditItems = auditItems;
  debugApi.findGhostItems = findGhostItems;
  debugApi.compareWeight = compareWeight;
  debugApi.auditCollections = auditCollections;

  return debugApi;
}
