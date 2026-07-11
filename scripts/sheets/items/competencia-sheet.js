// =========================
// MTROL - COMPETENCIA SHEET
// =========================

import {
  installMtrolCustomResizeHandle
} from "../mtrol-resize-handle.js";

const { ItemSheet } =
  foundry.appv1.sheets;

const MTROL_FALLBACK_ITEM_IMG = "icons/svg/item-bag.svg";

function getSafeImageSrc(src, fallback = MTROL_FALLBACK_ITEM_IMG) {
  if (typeof src === "string" && src.trim()) return src.trim();

  console.warn("MTROL | Imagen invalida en CompetenciaSheet. Usando fallback.", {
    src,
    fallback
  });

  return fallback;
}

export class CompetenciaSheet extends ItemSheet {

  // =========================
  // DEFAULT OPTIONS
  // =========================

  static get defaultOptions() {

    return foundry.utils.mergeObject(
      super.defaultOptions,
      {
        classes: [
          "mtrol",
          "sheet",
          "item-sheet",
          "competencia-sheet"
        ],

        width: 600,
        height: 700,
        minHeight: 300,

        resizable: true,

        tabs: [{
          navSelector: ".mtrol-competencia-tabs",
          contentSelector: ".mtrol-competencia-tab-content",
          initial: "general"
        }]
      }
    );

  }

  // =========================
  // TEMPLATE
  // =========================

  get template() {

    return `systems/${game.system.id}/templates/items/competencia-sheet.html`;

  }

  // =========================
  // GET DATA
  // =========================

  getData(options) {

    const context =
      super.getData(options);

    context.item =
      this.item;

    context.system =
      this.item.system;

    context.esGM =
      game.user.isGM;

    context.itemImg =
      getSafeImageSrc(this.item.img);

    return context;

  }

  activateListeners(html) {
    super.activateListeners(html);

    installMtrolCustomResizeHandle(this, html);

    html.find("img")
      .off("error.mtrolImageGuard")
      .on("error.mtrolImageGuard", event => {
        const img = event.currentTarget;
        if (img.src?.endsWith(MTROL_FALLBACK_ITEM_IMG)) return;

        console.warn("MTROL | Imagen fallida en CompetenciaSheet. Usando fallback.", {
          item: this.item?.name,
          src: img.getAttribute("src"),
          fallback: MTROL_FALLBACK_ITEM_IMG
        });

        img.src = MTROL_FALLBACK_ITEM_IMG;
      });
  }

}
