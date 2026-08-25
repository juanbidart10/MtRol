import {
  getItemUnitWeight
} from "../items/item-invariants.js";

const FALLBACK_ITEM_IMAGE = "icons/svg/item-bag.svg";

function safeString(value) {
  return typeof value === "string" ? value : String(value ?? "");
}

function safeImage(value) {
  const image = safeString(value).trim();
  if (!image || ["null", "undefined", "[object object]"].includes(image.toLowerCase())) {
    return FALLBACK_ITEM_IMAGE;
  }
  return image;
}

function optionalString(value) {
  const normalized = safeString(value).trim();
  return normalized || null;
}

function optionalNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Explicit public allowlist for an offered Item. Never pass a Foundry document
 * or a wholesale `system` object through this boundary.
 */
export function buildPublicTradeItemSnapshot(item, quantity) {
  const tipoObjeto = safeString(item?.system?.tipoObjeto).trim().toLowerCase() || "general";

  return {
    itemUuid: safeString(item?.uuid).trim(),
    itemId: safeString(item?.id).trim(),
    name: safeString(item?.name),
    img: safeImage(item?.img),
    type: safeString(item?.type),
    tipoObjeto,
    quantity: Number(quantity),
    description: safeString(item?.system?.descripcion),
    publicData: {
      unitWeight: getItemUnitWeight(item),
      damage: tipoObjeto === "arma" ? optionalString(item?.system?.danio) : null,
      defense: ["armadura", "escudo"].includes(tipoObjeto)
        ? optionalNumber(item?.system?.defensa)
        : null,
      baseDefense: ["armadura", "escudo"].includes(tipoObjeto)
        ? optionalNumber(item?.system?.defensaBase)
        : null,
      material: tipoObjeto === "material" ? optionalString(item?.system?.material) : null,
      value: ["material", "moneda"].includes(tipoObjeto)
        ? optionalNumber(item?.system?.valor)
        : null
    }
  };
}

export const PUBLIC_TRADE_ITEM_FIELDS = Object.freeze([
  "itemUuid",
  "itemId",
  "name",
  "img",
  "type",
  "tipoObjeto",
  "quantity",
  "description",
  "publicData"
]);
