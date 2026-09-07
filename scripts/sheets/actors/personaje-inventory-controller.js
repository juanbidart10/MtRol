import { desequiparObjeto } from "../../items/equipment-engine.js";
import { getItemUnitWeight, isMtrolObject } from "../../items/item-invariants.js";
import { createBlankCompetencyItemData } from "../../competencies/competency-item-factory.js";

function requireGM(user) {
  if (!user?.isGM) throw new Error("Esta operación de inventario es exclusiva para GM.");
}

export function createCompetenceData() {
  return createBlankCompetencyItemData();
}

export function createCombatAbilityData() {
  return {
    name: "Nueva habilidad de combate",
    type: "competencia",
    system: {
      nivel: 1, categoria: "combate", actionType: "combatSkill", effect: "none",
      requiresTarget: false, requiresOpposition: false, oppositionType: "free",
      effectDuration: 1, effectIntensity: 0, equipadaCombate: false,
      formula: "", danio: "", atributo: "", tipo: "habilidad-combate",
      usaDanioLocalizado: false, ejecutaDanio: true,
      damageResolution: "onOppositionWin", damageMode: "enabled", damageCostType: "none",
      banner: "", cooldown: 0,
      fx: { visual: "", autocast: "", proyectil: "", target: "", sonido: "", duracion: 5000, escala: 1 },
      descripcion: ""
    }
  };
}

export function createObjectData() {
  return {
    name: "Nuevo objeto",
    type: "objeto",
    system: {
      tipoObjeto: "general", cantidad: 1, material: "", peso: 1,
      equipable: false, equipado: false, slot: "", defensa: 0, defensaBase: 0,
      danio: "", valor: 0, descripcion: ""
    }
  };
}

export async function createSheetItem(actor, itemData, { user = game.user } = {}) {
  requireGM(user);
  return actor.createEmbeddedDocuments("Item", [itemData]);
}

export async function importDroppedItem(actor, data, { user = game.user } = {}) {
  requireGM(user);
  const item = await Item.implementation.fromDropData(data);
  if (!item) throw new Error("No se pudo leer el objeto arrastrado.");
  const itemData = item.toObject();
  if (itemData.type === "item") itemData.type = "objeto";
  itemData.system = {
    tipoObjeto: itemData.system?.tipoObjeto ?? "general",
    cantidad: itemData.system?.cantidad ?? 1,
    material: itemData.system?.material ?? "",
    peso: getItemUnitWeight(itemData),
    equipable: itemData.system?.equipable ?? false,
    equipado: false,
    slot: itemData.system?.slot ?? "",
    defensa: itemData.system?.defensa ?? 0,
    defensaBase: itemData.system?.defensaBase ?? itemData.system?.defensa ?? 0,
    danio: itemData.system?.danio ?? "",
    valor: itemData.system?.valor ?? 0,
    descripcion: itemData.system?.descripcion ?? itemData.system?.description ?? ""
  };
  const created = await actor.createEmbeddedDocuments("Item", [itemData]);
  return { created, sourceName: item.name };
}

export async function setCombatBarEquipped(item, equipped, { user = game.user } = {}) {
  requireGM(user);
  await item.update({ "system.equipadaCombate": equipped === true });
  return item;
}

export async function deleteSheetItem(actor, item, { user = game.user } = {}) {
  requireGM(user);
  if (isMtrolObject(item)) {
    const unequipped = await desequiparObjeto(actor, item);
    if (!unequipped) return { deleted: false, reason: "unequip-rejected" };
  }
  await item.delete();
  return { deleted: true };
}

