// =========================
// MTROL - ROLL HELPERS
// =========================
// Utilidades compartidas para tiradas:
// - slug
// - conversión numérica
// - normalización de slots
// - lectura de armas equipadas
// =========================

import {
  getEquipmentItemForSlot
} from "../items/item-invariants.js";

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

// =========================
// OBTENER DAÑO DE MANOS
// =========================
// Lee exclusivamente IDs referenciados por slots validos de
// actor.system.equipamiento.
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

    const tipoObjeto =
      String(item.system?.tipoObjeto ?? "")
        .trim()
        .toLowerCase();

    // Los escudos nunca son armas para @mano, incluso si conservan
    // un valor de daño por datos legacy o por configuración accidental.
    if (tipoObjeto === "escudo") return;

    // Las clasificaciones mecánicas explícitas que no sean armas tampoco
    // participan. "" y "general" mantienen compatibilidad con armas legacy.
    if (
      tipoObjeto &&
      tipoObjeto !== "general" &&
      tipoObjeto !== "arma"
    ) {
      return;
    }

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
  // FUENTE UNICA:
  // actor.system.equipamiento
  // =====================================================

  for (const slot of ["manoDer", "manoIzq"]) {
    sumarUnaVez(
      getEquipmentItemForSlot(actor, slot),
      slot
    );
  }

  resultado.total =
    resultado.manoDer +
    resultado.manoIzq;

  return resultado;
}

export function mtrolResolverDanioArmas(actor) {
  const items = [];
  const seen = new Set();
  let total = 0;

  for (const slot of ["manoDer", "manoIzq"]) {
    const item = getEquipmentItemForSlot(actor, slot);
    if (!item) continue;
    if (String(item.system?.tipoObjeto ?? "").trim().toLowerCase() !== "arma") continue;
    const id = item.uuid ?? item.id ?? item._id;
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const raw = item.system?.danio;
    const value = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
    if (
      raw === null || raw === undefined || raw === "" ||
      !Number.isInteger(value) || value < 0 || value > 30
    ) {
      const error = new Error(
        `El arma equipada ${item.name ?? id} tiene daño inválido; debe ser un entero entre 0 y 30.`
      );
      error.reasonCode = "EQUIPPED_WEAPON_DAMAGE_INVALID";
      throw error;
    }
    total += value;
    items.push({
      id,
      name: item.name ?? "Arma equipada",
      damage: value,
      slots: [slot]
    });
  }

  for (const entry of items) {
    entry.slots = Object.freeze(["manoDer", "manoIzq"].filter(slot =>
      (getEquipmentItemForSlot(actor, slot)?.uuid ?? getEquipmentItemForSlot(actor, slot)?.id) === entry.id
    ));
    Object.freeze(entry);
  }
  return Object.freeze({ total, items: Object.freeze(items) });
}
