// =========================
// MTROL - ROLL HELPERS
// =========================
// Utilidades compartidas para tiradas:
// - slug
// - conversión numérica
// - normalización de slots
// - lectura de armas equipadas
// =========================

export function mtrolSlug(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function mtrolToNumber(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  const n = Number(
    String(value).replace(",", ".")
  );

  return Number.isFinite(n) ? n : 0;
}

export function mtrolNormalizarSlot(slot) {
  const value = String(slot ?? "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "")
    .replace(/_/g, "")
    .replace(/-/g, "");

  if ([
    "manoder",
    "manoderecha",
    "derecha",
    "righthand",
    "handright"
  ].includes(value)) {
    return "manoDer";
  }

  if ([
    "manoizq",
    "manoizquierda",
    "izquierda",
    "lefthand",
    "handleft"
  ].includes(value)) {
    return "manoIzq";
  }

  return slot;
}

function mtrolResolverItemEquipado(actor, equipado) {
  const items =
    Array.from(actor.items ?? []);

  if (!equipado) return null;

  // =====================================================
  // STRING = ITEM ID
  // =====================================================

  if (typeof equipado === "string") {
    return (
      actor.items.get(equipado) ??
      items.find(i =>
        i.id === equipado ||
        i._id === equipado ||
        i.uuid === equipado ||
        i.name === equipado
      )
    );
  }

  // =====================================================
  // SI NO ES OBJETO
  // =====================================================

  if (typeof equipado !== "object") {
    return null;
  }

  // =====================================================
  // BUSQUEDA POR ID
  // =====================================================

  const itemId =
    equipado.id ??
    equipado._id ??
    equipado.itemId ??
    equipado.uuid ??
    equipado.itemUuid ??
    equipado.itemID ??
    null;

  if (itemId) {
    const byId =
      actor.items.get(itemId) ??
      items.find(i =>
        i.id === itemId ||
        i._id === itemId ||
        i.uuid === itemId
      );

    if (byId) return byId;
  }

  // =====================================================
  // BUSQUEDA POR NOMBRE
  // =====================================================

  const itemName =
    equipado.name ??
    equipado.nombre ??
    equipado.item?.name ??
    equipado.label ??
    null;

  if (itemName) {
    const byName =
      items.find(i => i.name === itemName);

    if (byName) return byName;
  }

  // =====================================================
  // OBJETO PARCIAL
  // =====================================================

  if (
    equipado.danio !== undefined ||
    equipado.system?.danio !== undefined
  ) {
    return {
      name: itemName ?? "Arma equipada",
      system: {
        danio:
          equipado.danio ??
          equipado.system?.danio ??
          0
      }
    };
  }

  return null;
}

// =========================
// OBTENER DAÑO DE MANOS
// =========================
// Lee:
// - actor.system.equipamiento
// - items equipados
//
// Evita duplicar armas.
// =========================

export function mtrolObtenerDanioManos(actor) {
  const resultado = {
    manoDer: 0,
    manoIzq: 0,
    total: 0,
    nombresDer: [],
    nombresIzq: []
  };

  if (!actor) return resultado;

  const itemsProcesados =
    new Set();

  function sumarUnaVez(item, slot) {
    if (!item) return;

    const idUnico =
      item.id ??
      item._id ??
      item.uuid ??
      `${slot}-${item.name}`;

    if (itemsProcesados.has(idUnico)) {
      return;
    }

    const danio =
      mtrolToNumber(
        item.system?.danio ??
        item.danio ??
        0
      );

    if (danio <= 0) return;

    itemsProcesados.add(idUnico);

    if (slot === "manoDer") {
      resultado.manoDer += danio;

      resultado.nombresDer.push(
        item.name ?? "Arma equipada"
      );
    }

    if (slot === "manoIzq") {
      resultado.manoIzq += danio;

      resultado.nombresIzq.push(
        item.name ?? "Arma equipada"
      );
    }
  }

  // =====================================================
  // FUENTE PRINCIPAL:
  // actor.system.equipamiento
  // =====================================================

  const equipamiento =
    actor.system?.equipamiento ?? {};

  const slots = [
    ["manoDer", "manoDer"],
    ["manoDerecha", "manoDer"],
    ["rightHand", "manoDer"],
    ["handRight", "manoDer"],
    ["derecha", "manoDer"],

    ["manoIzq", "manoIzq"],
    ["manoIzquierda", "manoIzq"],
    ["leftHand", "manoIzq"],
    ["handLeft", "manoIzq"],
    ["izquierda", "manoIzq"]
  ];

  for (const [key, slot] of slots) {
    const equipado =
      equipamiento?.[key];

    if (!equipado) continue;

    const item =
      mtrolResolverItemEquipado(
        actor,
        equipado
      );

    sumarUnaVez(item, slot);
  }

  // =====================================================
  // FALLBACK:
  // ITEMS MARCADOS COMO EQUIPADOS
  // =====================================================

  for (const item of actor.items ?? []) {

    if (
      item.type !== "objeto" &&
      item.type !== "item"
    ) {
      continue;
    }

    const equipado =
      item.system?.equipado === true ||
      item.system?.equipado === "true";

    const slot =
      mtrolNormalizarSlot(
        item.system?.slot
      );

    if (!equipado) continue;

    if (
      slot !== "manoDer" &&
      slot !== "manoIzq"
    ) {
      continue;
    }

    sumarUnaVez(item, slot);
  }

  resultado.total =
    resultado.manoDer +
    resultado.manoIzq;

  return resultado;
}