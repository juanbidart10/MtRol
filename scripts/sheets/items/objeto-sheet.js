// =========================
// MTROL - OBJETO SHEET
// =========================

const { ItemSheet } =
  foundry.appv1.sheets;

const MTROL_FALLBACK_ITEM_IMG = "icons/svg/item-bag.svg";

function getSafeImageSrc(src, fallback = MTROL_FALLBACK_ITEM_IMG) {
  if (typeof src === "string" && src.trim()) return src.trim();

  console.warn("MTROL | Imagen invalida en ObjetoSheet. Usando fallback.", {
    src,
    fallback
  });

  return fallback;
}

export const MTROL_MATERIAL_WEIGHTS = {
  papiros_bitacoras: 0,
  consumibles_libros: 1,
  tela_cuero: 1,
  madera: 2,
  hierro: 3,
  plata: 2,
  oro: 2,
  obsidiana: 4,
  platino: 4,
  titanio: 5,
  zafiro: 5,
  rubi: 6,
  diamante: 6,
  dragonil: 7,
  astralitio: 7
};

const MTROL_MATERIAL_LABELS = {
  papiros_bitacoras: "Papiros / Bitácoras",
  consumibles_libros: "Consumibles / Libros",
  tela_cuero: "Tela / Cuero",
  madera: "Madera",
  hierro: "Hierro",
  plata: "Plata",
  oro: "Oro",
  obsidiana: "Obsidiana",
  platino: "Platino",
  titanio: "Titanio",
  zafiro: "Zafiro",
  rubi: "Rubí",
  diamante: "Diamante",
  dragonil: "Dragonil",
  astralitio: "Astralitio"
};

export class ObjetoSheet extends ItemSheet {

  static get defaultOptions() {

    return foundry.utils.mergeObject(
      super.defaultOptions,
      {
        classes: ["mtrol", "sheet", "objeto"],
        template: `systems/${game.system.id}/templates/items/objeto-sheet.html`,
        width: 600,
        height: 620,
        resizable: true
      }
    );

  }

  getData(options) {

    const context =
      super.getData(options);

    context.item = this.item;
    context.system = this.item.system;
    context.esGM = game.user.isGM;
    context.itemImg = getSafeImageSrc(this.item.img);

    const slotActual =
      this.item.system.slot ?? "";

    const tipoActual =
      this.item.system.tipoObjeto ?? "general";

    const materialActual =
      this.item.system.material ?? "";

    context.slotsCorporales = [
      { value: "", label: "-", selected: slotActual === "" },
      { value: "cabeza", label: "Cabeza", selected: slotActual === "cabeza" },
      { value: "cuello", label: "Cuello", selected: slotActual === "cuello" },
      { value: "hombros", label: "Hombros", selected: slotActual === "hombros" },
      { value: "brazos", label: "Brazos", selected: slotActual === "brazos" },
      { value: "pecho", label: "Pecho", selected: slotActual === "pecho" },
      { value: "piernas", label: "Piernas", selected: slotActual === "piernas" },
      { value: "pies", label: "Pies", selected: slotActual === "pies" },
      { value: "manoIzq", label: "Mano Izquierda", selected: slotActual === "manoIzq" },
      { value: "manoDer", label: "Mano Derecha", selected: slotActual === "manoDer" },
      { value: "extra", label: "Extra", selected: slotActual === "extra" }
    ];

    context.tiposObjeto = [
      { value: "general", label: "General", selected: tipoActual === "general" },
      { value: "arma", label: "Arma", selected: tipoActual === "arma" },
      { value: "armadura", label: "Armadura", selected: tipoActual === "armadura" },
      { value: "escudo", label: "Escudo", selected: tipoActual === "escudo" },
      { value: "consumible", label: "Consumible", selected: tipoActual === "consumible" },
      { value: "material", label: "Material", selected: tipoActual === "material" },
      { value: "llave", label: "Llave", selected: tipoActual === "llave" },
      { value: "moneda", label: "Moneda", selected: tipoActual === "moneda" }
    ];

    context.materialesObjeto = [
      { value: "", label: "-", selected: materialActual === "" },
      ...Object.entries(MTROL_MATERIAL_LABELS).map(([value, label]) => ({
        value,
        label,
        selected: materialActual === value
      }))
    ];

    return context;

  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find("img")
      .off("error.mtrolImageGuard")
      .on("error.mtrolImageGuard", event => {
        const img = event.currentTarget;
        if (img.src?.endsWith(MTROL_FALLBACK_ITEM_IMG)) return;

        console.warn("MTROL | Imagen fallida en ObjetoSheet. Usando fallback.", {
          item: this.item?.name,
          src: img.getAttribute("src"),
          fallback: MTROL_FALLBACK_ITEM_IMG
        });

        img.src = MTROL_FALLBACK_ITEM_IMG;
      });

    html.find('select[name="system.material"]')
      .off("change")
      .on("change", this._onMaterialChange.bind(this));
  }

  async _onMaterialChange(event) {
    if (!game.user.isGM) return;

    const material =
      event.currentTarget.value;

    if (!(material in MTROL_MATERIAL_WEIGHTS)) return;

    const peso =
      MTROL_MATERIAL_WEIGHTS[material];

    const pesoInput =
      this.element.find('input[name="system.peso"]');

    pesoInput.val(peso);

    await this.item.update({
      "system.material": material,
      "system.peso": peso
    });
  }

  async _updateObject(event, formData) {
    if (game.user.isGM) {
      const material =
        formData["system.material"];

      if (material in MTROL_MATERIAL_WEIGHTS) {
        formData["system.peso"] =
          MTROL_MATERIAL_WEIGHTS[material];
      }

      return super._updateObject(event, formData);
    }

    const img =
      formData.img;

    if (img) {
      return this.item.update({ img });
    }

    return null;
  }

}                  
