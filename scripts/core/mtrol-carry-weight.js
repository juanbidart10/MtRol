// =========================
// MTROL - CARRY WEIGHT
// =========================

function isMtrolActor(actor) {
  return actor?.type === "personaje" || actor?.type === "character";
}

function isCarryItem(itemData) {
  return itemData?.type === "objeto" || itemData?.type === "item";
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getItemPesoUnitario(itemData) {
  const tieneMaterial =
    itemData?.system?.material !== undefined &&
    itemData?.system?.material !== null &&
    itemData?.system?.material !== "";

  const peso =
    toNumber(itemData?.system?.peso, 0);

  if (tieneMaterial) return peso;

  if (peso > 0) return peso;

  return toNumber(itemData?.system?.slots, 0);
}

export function calcularCargaActor(actor) {
  if (!actor || !isMtrolActor(actor)) {
    return {
      pesoActual: 0,
      pesoMaximo: 0,
      pesoLibre: 0,
      sobrecargado: false
    };
  }

  const fuerzaData =
    actor.system?.atributos?.fuerza;

  const fuerza =
    toNumber(fuerzaData?.value ?? fuerzaData, 0);

  const pesoMaximo =
    fuerza * 10;

  const objetos =
    actor.items.filter(isCarryItem);

  const pesoActual =
    objetos.reduce((total, item) => {
      const peso =
        getItemPesoUnitario(item);

      const cantidad =
        toNumber(item.system?.cantidad, 1);

      return total + (peso * cantidad);
    }, 0);

  const pesoLibre =
    Math.max(pesoMaximo - pesoActual, 0);

  return {
    pesoActual,
    pesoMaximo,
    pesoLibre,
    sobrecargado: pesoActual > pesoMaximo
  };
}

export function puedeCargarItem(actor, itemData) {
  if (!actor || !isMtrolActor(actor)) return true;
  if (!isCarryItem(itemData)) return true;

  const carga =
    calcularCargaActor(actor);

  const pesoNuevo =
    getItemPesoUnitario(itemData) *
    toNumber(itemData?.system?.cantidad, 1);

  return (carga.pesoActual + pesoNuevo) <= carga.pesoMaximo;
}

export function registrarHooksPesoMtrol() {
  Hooks.on("preCreateItem", (item) => {
    const actor =
      item.parent;

    if (!actor || !isMtrolActor(actor)) return true;
    if (!isCarryItem(item)) return true;

    const carga =
      calcularCargaActor(actor);

    const pesoNuevo =
      getItemPesoUnitario(item) *
      toNumber(item.system?.cantidad, 1);

    const pesoFinal =
      carga.pesoActual + pesoNuevo;

    if (pesoFinal <= carga.pesoMaximo) return true;

    ui.notifications.warn(
      `${actor.name} no puede cargar "${item.name}". Capacidad excedida: ${pesoFinal}/${carga.pesoMaximo}.`
    );

    return false;
  });

  console.log("MTROL | Sistema de carga registrado.");
}
