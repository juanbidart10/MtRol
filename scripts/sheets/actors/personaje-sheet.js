import { mtrolRoll } from "../../rolls/mtrol-rolls.js";

import {
  mtrolEvaluarDadosMtrol,
  mtrolCalcularTotalBaseSinCriticos,
  mtrolMostrarDados
} from "../../rolls/dice-engine.js";

import {
  mtrolAplicarDharmaKarma
} from "../../rolls/mtrol-dharma-karma.js";

import {
  mtrolObtenerDanioManos
} from "../../rolls/roll-helpers.js";

import {
  aplicarDanioLocalizado
} from "../../combat/damage-localized.js";

import {
  crearCombatCard
} from "../../combat/combat-card.js";

import {
  resolverCompetencia
} from "../../combat/competencia-engine.js";

import {
  aplicarConsumoMP
} from "../../combat/mp-engine.js";

import {
  MTROL_BODY_SLOTS,
  MTROL_BODY_SLOT_LABELS
} from "../../constants/body-slots.js";

import {
  FX_ATRIBUTOS
} from "../../constants/attribute-fx.js";

import {
  equiparObjeto,
  desequiparObjeto
} from "../../items/equipment-engine.js";

import {
  abrirDialogoComercioMtrol
} from "../../ui/trade-dialog.js";

import {
  mtrolFlagScope
} from "../../core/system.js";

import {
  attachDefenseRollForActor,
  createPendingActionFromCompetencia
} from "../../actions/action-engine.js";

import {
  calcularCargaActor
} from "../../core/mtrol-carry-weight.js";

import {
  installMtrolCustomResizeHandle
} from "../mtrol-resize-handle.js";

const { ActorSheet } = foundry.appv1.sheets;

const MTROL_FALLBACK_ACTOR_IMG = "icons/svg/mystery-man.svg";
const MTROL_FALLBACK_ITEM_IMG = "icons/svg/item-bag.svg";


function normalizarNombreBanner(nombre) {
  return String(nombre ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getCombatBanner(item) {
  const img =
    item?.img;

  if (isValidImageSrc(img) && !isDefaultImageSrc(img)) {
    return img.trim();
  }

  console.warn("MTROL | Habilidad sin imagen personalizada para card de combate. Usando fallback.", {
    item: item?.name,
    img,
    fallback: MTROL_FALLBACK_ITEM_IMG
  });

  return MTROL_FALLBACK_ITEM_IMG;
}

function escapeHTML(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function isValidImageSrc(src) {
  if (typeof src !== "string") return false;

  const value = src.trim();
  if (!value) return false;

  return !["null", "undefined", "[object object]"].includes(value.toLowerCase());
}

function isDefaultImageSrc(src) {
  if (!isValidImageSrc(src)) return false;

  const value =
    src.trim().toLowerCase();

  return [
    "icons/svg/item-bag.svg",
    "icons/svg/mystery-man.svg"
  ].includes(value);
}

function getSafeImageSrc(src, fallback, context = "imagen") {
  if (isValidImageSrc(src)) return src.trim();

  console.warn(`MTROL | Imagen invalida en ${context}. Usando fallback.`, {
    src,
    fallback
  });

  return fallback;
}

function prepareItemImageData(item, fallback = MTROL_FALLBACK_ITEM_IMG) {
  return {
    id: item.id,
    name: item.name,
    type: item.type,
    img: item.img,
    imgSeguro: getSafeImageSrc(item.img, fallback, `item ${item.name}`),
    system: item.system
  };
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function calcularPorcentajeVital(vital) {
  const value = toNumber(vital?.value, 0);
  const max = toNumber(vital?.max, 0);

  if (max <= 0) return 0;

  return Math.clamp((value / max) * 100, 0, 100);
}

function normalizarNombreCompetencia(nombre) {
  return String(nombre ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "");
}

function esCompetenciaMeditar(item) {
  return normalizarNombreCompetencia(item?.name) === "meditar";
}

export class PersonajeSheet extends ActorSheet {

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["mtrol", "sheet", "actor", "personaje-sheet", "mtrol-personaje"],
      template: `systems/${game.system.id}/templates/actors/personaje-sheet.html`,
      width: 820,
      height: 560,
      minHeight: 320,
      resizable: true,

      tabs: [{
        navSelector: ".sheet-tabs",
        contentSelector: ".sheet-body",
        initial: "personaje"
      }],

      dragDrop: game.user?.isGM ? [
        {
          dragSelector: ".mtrol-draggable-objeto",
          dropSelector: null
        }
      ] : [],

      submitOnChange: true,
      closeOnSubmit: false
    });
  }

  getData(options) {
    const context = super.getData(options);

    context.actor = this.actor;
    context.system = this.actor.system;
    context.esGM = game.user.isGM;
    context.puedeEditarVitales = game.user.isGM || this.actor.isOwner;
    context.actorImg = getSafeImageSrc(
      this.actor.img,
      MTROL_FALLBACK_ACTOR_IMG,
      `actor ${this.actor.name}`
    );
    context.vitalesPorcentaje = {
      hp: calcularPorcentajeVital(this.actor.system?.vitales?.hp),
      mp: calcularPorcentajeVital(this.actor.system?.vitales?.mp)
    };

    const competencias = this.actor.items.filter(
      i => i.type === "competencia"
    );

    const categoriasBarraCombate = [
      "basico",
      "combate",
      "hechizo",
      "contraataque"
    ];

    const habilidadesCombate = competencias.filter(
      i => categoriasBarraCombate.includes(i.system?.categoria)
    );

    const competenciasGenerales = competencias.filter(
      i => !categoriasBarraCombate.includes(i.system?.categoria)
    );

    context.competencias = competencias.map(i => prepareItemImageData(i));
    context.habilidadesCombate = habilidadesCombate.map(i => prepareItemImageData(i));
    context.competenciasGenerales = competenciasGenerales.map(i => prepareItemImageData(i));

    context.habilidadesEquipadasCombate = habilidadesCombate.filter(
      i => i.system?.equipadaCombate === true || i.system?.equipadaCombate === "true"
    ).map(i => ({
      id: i.id,
      name: i.name,
      img: i.img,
      imgSeguro: getSafeImageSrc(i.img, MTROL_FALLBACK_ITEM_IMG, `habilidad ${i.name}`),
      system: i.system,
      mtrolBanner: getCombatBanner(i)
    }));

    const objetos = this.actor.items.filter(
      i => i.type === "objeto" || i.type === "item"
    );

    context.objetosInventario = objetos.filter(
      o => !o.system.equipado
    ).map(o => prepareItemImageData(o));

    context.objetosEquipados = objetos.filter(
      o => o.system.equipado
    ).map(o => prepareItemImageData(o));

    context.slotsEquipamiento = MTROL_BODY_SLOTS.map(slotKey => {
      const itemId = this.actor.system.equipamiento?.[slotKey] ?? "";
      const item = itemId ? this.actor.items.get(itemId) : null;
      const defensa =
        toNumber(item?.system?.defensa, 0);
      const defensaBase =
        toNumber(item?.system?.defensaBase, defensa);
      const tieneMaterial =
        item?.system?.material !== undefined &&
        item?.system?.material !== null &&
        item?.system?.material !== "";
      const peso =
        tieneMaterial
          ? toNumber(item?.system?.peso, 0)
          : toNumber(item?.system?.peso, toNumber(item?.system?.slots, 0));

      return {
        key: slotKey,
        label: MTROL_BODY_SLOT_LABELS[slotKey] ?? slotKey,
        ocupado: !!item,
        item,
        itemImg: item
          ? getSafeImageSrc(item.img, MTROL_FALLBACK_ITEM_IMG, `item equipado ${item.name}`)
          : MTROL_FALLBACK_ITEM_IMG,
        defensa,
        defensaBase,
        defensaActualBase: item ? `${defensa} / ${defensaBase}` : "-",
        danio: item?.system?.danio ?? "",
        peso,
        estadoClase: item ? "is-equipped" : "is-empty"
      };
    });

    const carga =
      calcularCargaActor(this.actor);

    const slotsOcupados =
      context.slotsEquipamiento.filter(slot => slot.ocupado).length;

    const defensaTotal =
      context.slotsEquipamiento.reduce(
        (total, slot) => total + toNumber(slot.defensa, 0),
        0
      );

    const danioArmas =
      context.slotsEquipamiento
        .filter(slot => ["manoIzq", "manoDer"].includes(slot.key) && slot.danio)
        .map(slot => `${slot.label}: ${slot.danio}`)
        .join(" | ") || "-";

    context.inventario = {
      usados: carga.pesoActual,
      maximos: carga.pesoMaximo,
      libres: carga.pesoLibre,
      sobrecargado: carga.sobrecargado
    };

    context.equipamientoResumen = {
      defensaTotal,
      danioArmas,
      pesoActual: carga.pesoActual,
      pesoMaximo: carga.pesoMaximo,
      pesoLibre: carga.pesoLibre,
      slotsOcupados,
      slotsTotales: MTROL_BODY_SLOTS.length
    };

    return context;
  }

  async _onDrop(event) {
    event.preventDefault();

    if (!game.user.isGM) {
      ui.notifications.warn("Solo el GM puede mover o agregar objetos.");
      return false;
    }

    let data;

    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch (err) {
      console.error("MtRol | Drop inválido", err);
      return false;
    }

    if (data.type !== "Item") return false;

    const item = await Item.implementation.fromDropData(data);

    if (!item) {
      ui.notifications.warn("No se pudo leer el objeto arrastrado.");
      return false;
    }

    const itemData = item.toObject();

    if (itemData.type === "item") {
      itemData.type = "objeto";
    }

    itemData.system = {
      tipoObjeto: itemData.system?.tipoObjeto ?? "general",
      cantidad: itemData.system?.cantidad ?? 1,
      material: itemData.system?.material ?? "",
      peso: itemData.system?.peso ?? itemData.system?.slots ?? 1,
      equipable: itemData.system?.equipable ?? false,
      equipado: false,
      slot: itemData.system?.slot ?? "",
      defensa: itemData.system?.defensa ?? 0,
      defensaBase: itemData.system?.defensaBase ?? itemData.system?.defensa ?? 0,
      danio: itemData.system?.danio ?? "",
      valor: itemData.system?.valor ?? 0,
      descripcion: itemData.system?.descripcion ?? itemData.system?.description ?? ""
    };

    await this.actor.createEmbeddedDocuments("Item", [itemData]);

    ui.notifications.info(`Objeto agregado: ${item.name}`);

    this.render(true);
    return true;
  }

  async _updateObject(event, formData) {
    if (!game.user.isGM) {
      const recursosBloqueados = [
        "system.recursos.nivel",
        "system.recursos.exp",
        "system.recursos.doblones",
        "system.recursos.mvp",
        "system.recursos.estres",
        "system.recursos.corrupcion"
      ];

      for (const key of Object.keys(formData)) {
        if (key.startsWith("system.atributos.")) delete formData[key];
        if (recursosBloqueados.includes(key)) delete formData[key];
      }
    }

    return super._updateObject(event, formData);
  }

  activateListeners(html) {
    super.activateListeners(html);

    installMtrolCustomResizeHandle(this, html);

    this._installImageFallbacks(html);

    html.find(".mtrol-roll-atributo")
      .off("click")
      .on("click", this._onRollAtributo.bind(this));

    html.find(".add-competencia")
      .off("click")
      .on("click", this._onAddCompetencia.bind(this));

    html.find(".add-habilidad-combate")
      .off("click")
      .on("click", this._onAddHabilidadCombate.bind(this));

    html.find(".habilidad-combate-equip")
      .off("click")
      .on("click", this._onEquiparHabilidadCombate.bind(this));

    html.find(".habilidad-combate-unequip")
      .off("click")
      .on("click", this._onDesequiparHabilidadCombate.bind(this));

    html.find(".mtrol-combat-card")
      .off("click")
      .on("click", this._onCombatCardDetail.bind(this));

    html.find(".mtrol-combat-card-detail")
      .off("click")
      .on("click", this._onCombatCardDetail.bind(this));

    html.find(".competencia-up")
      .off("click")
      .on("click", this._onCompetenciaUp.bind(this));

    html.find(".competencia-down")
      .off("click")
      .on("click", this._onCompetenciaDown.bind(this));

    html.find(".competencia-roll")
      .off("click")
      .on("click", this._onCompetenciaRoll.bind(this));

    html.find(".mtrol-restaurar-dia")
      .off("click")
      .on("click", this._onRestaurarDia.bind(this));

    html.find(".mtrol-vital-field")
      .off("input")
      .on("input", this._onVitalInput.bind(this));

    html.find(".item-create-objeto")
      .off("click")
      .on("click", this._onCreateObjeto.bind(this));

    html.find(".mtrol-trade-request")
      .off("click")
      .on("click", this._onTradeRequest.bind(this));

    html.find(".item-edit")
      .off("click")
      .on("click", this._onEditItem.bind(this));

    html.find(".item-delete")
      .off("click")
      .on("click", this._onDeleteItem.bind(this));

    html.find(".item-equip")
      .off("click")
      .on("click", this._onEquipItem.bind(this));

    html.find(".item-unequip")
      .off("click")
      .on("click", this._onUnequipItem.bind(this));

    html.find(".mtrol-equip-slot.is-equipped")
      .off("click")
      .on("click", this._onEquipmentSlotOpen.bind(this));
  }

  _installImageFallbacks(html) {
    html.find("img")
      .off("error.mtrolImageGuard load.mtrolImageGuard")
      .on("error.mtrolImageGuard", event => {
        const img = event.currentTarget;
        const fallback =
          img.dataset.fallback ||
          MTROL_FALLBACK_ITEM_IMG;

        if (img.src?.endsWith(fallback)) return;

        console.warn("MTROL | Imagen fallida en PersonajeSheet. Usando fallback.", {
          actor: this.actor?.name,
          alt: img.alt,
          src: img.getAttribute("src"),
          fallback
        });

        img.src = fallback;
      })
      .on("load.mtrolImageGuard", event => {
        const img = event.currentTarget;

        if (img.naturalWidth > 0 && img.naturalHeight > 0) return;

        const fallback =
          img.dataset.fallback ||
          MTROL_FALLBACK_ITEM_IMG;

        if (img.src?.endsWith(fallback)) return;

        console.warn("MTROL | Imagen con dimensiones invalidas en PersonajeSheet. Usando fallback.", {
          actor: this.actor?.name,
          alt: img.alt,
          src: img.getAttribute("src"),
          width: img.naturalWidth,
          height: img.naturalHeight,
          fallback
        });

        img.src = fallback;
      });
  }

  _onVitalInput(event) {
    const input = event.currentTarget;
    const vital = input.dataset.vital;
    if (!vital) return;

    const vitalElement = input.closest(".mtrol-hero-vital");
    if (!vitalElement) return;

    const valueInput = vitalElement.querySelector(`input[data-vital="${vital}"][data-field="value"]`);
    const maxInput = vitalElement.querySelector(`input[data-vital="${vital}"][data-field="max"]`);
    const fill = vitalElement.querySelector(".mtrol-vital-fill");

    const value = toNumber(valueInput?.value, 0);
    const max = toNumber(maxInput?.value, 0);
    const porcentaje = calcularPorcentajeVital({ value, max });

    if (fill) fill.style.setProperty("--mtrol-vital-percent", `${porcentaje}%`);
  }

  async _onEquipmentSlotOpen(event) {
    if (event.target.closest("a, button")) return;

    event.preventDefault();

    const item = this._getItemFromEvent(event);
    if (!item) return;

    if (item.sheet) item.sheet.render(true);
  }

  async _onRestaurarDia(event) {
    event.preventDefault();

    if (!game.user.isGM) {
      ui.notifications.warn("Solo el GM puede restaurar el día.");
      return;
    }

    await this.actor.update({
      "system.mpStack": 0
    });

    await this.actor.unsetFlag(mtrolFlagScope(), "mpStacks");

    ui.notifications.info(`Día restaurado para ${this.actor.name}.`);

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `<strong>🌙 ${this.actor.name}</strong> ha restaurado el día. Los costes acumulados de MP fueron reiniciados.`
    });

    this.render(true);
  }

  async _onRollAtributo(event) {
    event.preventDefault();

    const attr =
      event.currentTarget.dataset.atributo ||
      event.currentTarget.dataset.attr;

    if (!attr) return;

    const fxData = FX_ATRIBUTOS[attr];

    if (!fxData) {
      ui.notifications.warn(`No existe configuración FX para: ${attr}`);
      return;
    }

    const valor = Number(this.actor.system.atributos?.[attr] ?? 0);
    const formula = `1d10 + ${valor}`;

    await mtrolRoll(
      formula,
      this.actor,
      `⚔️ Tirada de ${fxData.label}: ${formula.replaceAll("d", "D")}`
    );

    await this._playAtributoFX(attr, fxData);
  }

  async _playAtributoFX(attr, fxData) {
    try {
      if (!game.modules.get("sequencer")?.active) {
        console.warn("MtRol | Sequencer no está activo. No se puede ejecutar FX.");
        return;
      }

      if (!fxData?.file) {
        console.warn(`MtRol | No hay FX configurado para el atributo: ${attr}`);
        return;
      }

      const token = this.actor.getActiveTokens()[0];

      if (!token) {
        ui.notifications.warn("Colocá un token de este actor en la escena para ver el FX.");
        return;
      }

      await new Sequence()
        .effect()
        .file(fxData.file)
        .atLocation(token)
        .scale(0.8)
        .fadeIn(500)
        .fadeOut(500)
        .duration(5000)
        .play();

    } catch (error) {
      console.error("MtRol | Error ejecutando FX de atributo:", error);
    }
  }

  async _onAddCompetencia(event) {
    event.preventDefault();

    if (!game.user.isGM) {
      ui.notifications.warn("Solo el Game Master puede crear competencias.");
      return;
    }

    await this.actor.createEmbeddedDocuments("Item", [{
      name: "Nueva competencia",
      type: "competencia",
      system: {
        nivel: 1,
        categoria: "competencia",
        actionType: "utility",
        effect: "none",
        requiresTarget: false,
        requiresOpposition: false,
        oppositionType: "free",
        effectDuration: 1,
        effectIntensity: 0,
        banner: "",
        elemento: "",
        rareza: "comun",
        cooldown: 0,
        fx: {
          visual: "",
          sonido: "",
          duracion: 5000,
          escala: 1
        },
        descripcion: ""
      }
    }]);

    this.render(true);
  }

  async _onCompetenciaUp(event) {
    event.preventDefault();

    if (!game.user.isGM) {
      ui.notifications.warn("Solo el Game Master puede subir competencias.");
      return;
    }

    const item = this._getItemFromEvent(event);
    if (!item) return;

    const nivelActual = Number(item.system.nivel || 1);
    const nivelNuevo = Math.min(5, nivelActual + 1);

    await item.update({
      "system.nivel": nivelNuevo
    });

    this.render(true);
  }

  async _onCompetenciaDown(event) {
    event.preventDefault();

    if (!game.user.isGM) {
      ui.notifications.warn("Solo el Game Master puede bajar competencias.");
      return;
    }

    const item = this._getItemFromEvent(event);
    if (!item) return;

    const nivelActual = Number(item.system.nivel || 1);
    const nivelNuevo = Math.max(1, nivelActual - 1);

    await item.update({
      "system.nivel": nivelNuevo
    });

    this.render(true);
  }

  async _onCompetenciaRoll(event) {
    event.preventDefault();
    event.stopPropagation();

    const item = this._getItemFromEvent(event);

    if (!item) {
      ui.notifications.warn("No se encontró la competencia.");
      return;
    }

    if (item.type !== "competencia") {
      console.warn("MtRol | El botón de competencia no pertenece a una competencia:", item);
      return;
    }

    const actor = this.actor;

    const nivel =
      Number(item.system?.nivel ?? 1);

    const targetToken =
      Array.from(game.user.targets)[0] ?? null;

    const resultado =
      await resolverCompetencia({
        actor,
        item,
        targetToken,
        formulaFallback: this._formulaCompetenciaPorNivel(nivel)
      });

    if (!resultado) return;

    const {
      targetActor,
      consumoMP,
      costoTotal,
      danioFormula,
      resultadoCompetencia
    } = resultado;

    if (item.system?.actionType === "defense") {
      const defenseResult =
        await attachDefenseRollForActor({
          actor,
          item,
          defenderRoll: resultadoCompetencia
        });

      await this._finalizarConsumoCompetencia({
        actor,
        item,
        consumoMP,
        resultadoCompetencia
      });

      if (defenseResult) return;

      ui.notifications.warn(
        `${item.name} es una defensa, pero no hay acciones pendientes para ${actor.name}.`
      );

      return;
    }

    if (resultadoCompetencia?.pifia) {
      await this._finalizarConsumoCompetencia({
        actor,
        item,
        consumoMP,
        resultadoCompetencia
      });

      return;
    }

    const pendingAction =
      createPendingActionFromCompetencia({
        actor,
        item,
        targetToken,
        attackerRoll: resultadoCompetencia
      });

    if (pendingAction) {
      await this._finalizarConsumoCompetencia({
        actor,
        item,
        consumoMP,
        resultadoCompetencia
      });

      ui.notifications.info(
        `${item.name} espera una defensa manual.`
      );

      return;
    }

    if (!danioFormula) {
      await this._finalizarConsumoCompetencia({
        actor,
        item,
        consumoMP,
        resultadoCompetencia
      });

      return;
    }

    const rollData =
      actor.getRollData();

    const danioManos =
      mtrolObtenerDanioManos(actor);

    rollData.mano =
      danioManos.total;

    rollData.manoDer =
      danioManos.manoDer;

    rollData.manoIzq =
      danioManos.manoIzq;

let damageRoll = null;

try {
  damageRoll =
    await new Roll(
      danioFormula,
      rollData
    ).evaluate();
} catch (error) {
  console.error("MTROL | Formula de dano invalida.", {
    formula: danioFormula,
    error
  });

  ui.notifications.warn(`Formula de dano invalida: ${danioFormula}`);
  return;
}

// =========================
// VISUAL DICE SO NICE
// =========================

await mtrolMostrarDados(damageRoll);

// =========================
// EVALUACIÓN MTROL
// =========================

const evaluacionDanio =
  await mtrolEvaluarDadosMtrol(
    damageRoll
  );

// =========================
// DHARMA / KARMA
// =========================

await mtrolAplicarDharmaKarma(
  actor,
  evaluacionDanio.cantidadDharma,
  evaluacionDanio.cantidadKarma
);

// =========================
// PIFIA
// =========================

if (evaluacionDanio.pifia) {
  const damageRollHTML =
    await damageRoll.render({
      flavor: "Tirada de Daño"
    });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),

    content: `
      <div class="mtrol-chat-card mtrol-chat-pifia">
        <h2>💀 PIFIA EN DAÑO 💀</h2>

        ${damageRollHTML}

        <p>${evaluacionDanio.motivo}</p>

        <p>
          El daño localizado fue cancelado.
        </p>
      </div>
    `
  });

  await this._finalizarConsumoCompetencia({
    actor,
    item,
    consumoMP,
    resultadoCompetencia
  });

  return;
}

// =========================
// TOTALES
// =========================

const totalBaseDanio =
  mtrolCalcularTotalBaseSinCriticos(
    damageRoll
  );

const totalFinalDanio =
  totalBaseDanio +
  evaluacionDanio.totalExtra;

// =========================
// DAÑO LOCALIZADO
// =========================

const resultadoDanio =
  await aplicarDanioLocalizado({
    actor,
    targetActor,
    targetTokenDocument: targetToken?.document ?? targetToken,
    damageRoll,
    danio: totalFinalDanio,
    costoTotal,
    evaluacionDanio,
    totalBaseDanio,
    totalFinalDanio
  });

if (!resultadoDanio) return;

resultadoDanio.danioOriginal =
  totalFinalDanio;

await this._finalizarConsumoCompetencia({
  actor,
  item,
  consumoMP,
  resultadoCompetencia
});

// =========================
// COMBAT CARD
// =========================

await crearCombatCard({
  actor,
  targetActor,
  damageRoll,
  resultadoDanio,
  costoTotal,
  evaluacionDanio,
  totalBaseDanio,
  totalFinalDanio
});
}

  async _finalizarConsumoCompetencia({
    actor,
    item,
    consumoMP,
    resultadoCompetencia
  } = {}) {
    if (!esCompetenciaMeditar(item)) {
      await aplicarConsumoMP(
        actor,
        consumoMP
      );

      return;
    }

    const costeAplicado =
      Number(consumoMP?.costoTotal);

    const mpAntes =
      Number(consumoMP?.mpAnterior ?? consumoMP?.mpActual);

    if (
      !consumoMP?.exito ||
      !Number.isFinite(costeAplicado) ||
      costeAplicado <= 0 ||
      !Number.isFinite(mpAntes)
    ) {
      ui.notifications.warn(
        "MTROL | Meditar no pudo determinar el coste real de MP. No se aplicó consumo ni restauración."
      );

      console.warn("MTROL | Meditar sin coste aplicable", {
        actor: actor?.name,
        item: item?.name,
        consumoMP
      });

      return;
    }

    const mpDespuesCoste =
      Math.max(0, mpAntes - costeAplicado);

    const total =
      toNumber(resultadoCompetencia?.total, 0);

    const esPifia =
      !!resultadoCompetencia?.pifia;

    const exito =
      !esPifia && total >= 6;

    const mpMax =
      toNumber(actor.system?.vitales?.mp?.max, 0);

    const restauracion =
      exito ? costeAplicado * 2 : 0;

    const mpFinal =
      exito
        ? Math.min(mpMax, mpDespuesCoste + restauracion)
        : mpDespuesCoste;

    await aplicarConsumoMP(
      actor,
      {
        ...consumoMP,
        mpNuevo: mpDespuesCoste
      }
    );

    if (!exito) {
      const mensaje =
        esPifia
          ? "Pifia en Meditar: no recupera MP."
          : "Meditar fallido: no recupera MP.";

      ui.notifications.info(mensaje);

      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `
          <div class="mtrol-chat-card">
            <h2>${mensaje}</h2>
          </div>
        `
      });

      return;
    }

    const mpRecuperado =
      Math.max(0, mpFinal - mpDespuesCoste);

    await actor.update({
      "system.vitales.mp.value": mpFinal
    });

    const mensaje =
      `Meditar exitoso: recupera ${mpRecuperado} MP.`;

    ui.notifications.info(mensaje);

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `
        <div class="mtrol-chat-card mtrol-chat-success">
          <h2>${mensaje}</h2>
          <p>Restauraci&oacute;n calculada: ${restauracion} MP.</p>
        </div>
      `
    });
  }

  async _onAddHabilidadCombate(event) {
    event.preventDefault();

    if (!game.user.isGM) {
      ui.notifications.warn("Solo el Game Master puede crear habilidades de combate.");
      return;
    }

    await this.actor.createEmbeddedDocuments("Item", [{
      name: "Nueva habilidad de combate",
      type: "competencia",
      system: {
        nivel: 1,
        categoria: "combate",
        actionType: "combatSkill",
        effect: "none",
        requiresTarget: false,
        requiresOpposition: false,
        oppositionType: "free",
        effectDuration: 1,
        effectIntensity: 0,
        equipadaCombate: false,
        formula: "",
        danio: "",
        atributo: "",
        tipo: "habilidad-combate",
        costeMP: 1,
        usaDanioLocalizado: false,
        banner: "",
        elemento: "",
        rareza: "comun",
        cooldown: 0,
        fx: {
          visual: "",
          autocast: "",
          proyectil: "",
          target: "",
          sonido: "",
          duracion: 5000,
          escala: 1
        },
        descripcion: ""
      }
    }]);

    this.render(true);
  }

  async _onEquiparHabilidadCombate(event) {
    event.preventDefault();

    if (!game.user.isGM) {
      ui.notifications.warn("Solo el Game Master puede equipar habilidades.");
      return;
    }

    const item = this._getItemFromEvent(event);
    if (!item) return;

    await item.update({
      "system.equipadaCombate": true
    });

    this.render(true);
  }

  async _onDesequiparHabilidadCombate(event) {
    event.preventDefault();
    event.stopPropagation();

    if (!game.user.isGM) {
      ui.notifications.warn("Solo el Game Master puede desequipar habilidades.");
      return;
    }

    const item = this._getItemFromEvent(event);
    if (!item) return;

    await item.update({
      "system.equipadaCombate": false
    });

    this.render(true);
  }

  async _onCombatCardDetail(event) {
    event.preventDefault();
    event.stopPropagation();

    if (
      event.target.closest("button") &&
      !event.currentTarget.classList.contains("mtrol-combat-card-detail")
    ) {
      return;
    }

    const item =
      this._getItemFromEvent(event);

    if (!item) return;

    await this._openCombatDetailDialog(item);
  }

  async _openCombatDetailDialog(item) {
    const descripcion =
      await TextEditor.enrichHTML(
        item.system?.descripcion ?? "",
        {
          async: true,
          secrets: this.actor.isOwner
        }
      );

    const banner =
      getCombatBanner(item);

    const escuela =
      item.system?.elemento ||
      item.system?.tipo ||
      item.system?.categoria ||
      "-";

    const formula =
      item.system?.danio ||
      item.system?.formula ||
      item.system?.formulaTirada ||
      "-";

    const content = `
      <div class="mtrol-combat-detail-dialog">
        <img class="mtrol-combat-detail-image"
             src="${escapeHTML(banner)}"
             data-fallback="${MTROL_FALLBACK_ITEM_IMG}"
             alt="${escapeHTML(item.name)}">

        <div class="mtrol-combat-detail-grid">
          <div><label>Escuela</label><strong>${escapeHTML(escuela)}</strong></div>
          <div><label>MP</label><strong>${escapeHTML(item.system?.costeMP ?? 0)}</strong></div>
          <div><label>Cooldown</label><strong>${escapeHTML(item.system?.cooldown ?? 0)}</strong></div>
          <div class="wide"><label>Formula</label><strong>${escapeHTML(formula)}</strong></div>
        </div>

        <div class="mtrol-combat-detail-description">
          ${descripcion || "<p>Sin descripcion.</p>"}
        </div>
      </div>
    `;

    new Dialog({
      title: item.name,
      content,
      buttons: {
        use: {
          label: "Usar",
          callback: () => this._usarCompetenciaDesdeItem(item)
        },
        close: {
          label: "Cerrar"
        }
      },
      default: "use"
    }).render(true);
  }

  async _usarCompetenciaDesdeItem(item) {
    return this._onCompetenciaRoll({
      preventDefault() {},
      stopPropagation() {},
      currentTarget: {
        dataset: { itemId: item.id },
        closest: () => ({ dataset: { itemId: item.id } })
      }
    });
  }

  async _onCreateObjeto(event) {
    event?.preventDefault?.();

    if (!game.user.isGM) {
      ui.notifications.warn("Solo el Game Master puede crear objetos.");
      return;
    }

    await this.actor.createEmbeddedDocuments("Item", [{
      name: "Nuevo objeto",
      type: "objeto",
      system: {
        tipoObjeto: "general",
        cantidad: 1,
        material: "",
        peso: 1,
        equipable: false,
        equipado: false,
        slot: "",
        defensa: 0,
        defensaBase: 0,
        danio: "",
        valor: 0,
        descripcion: ""
      }
    }]);

    this.render(true);
  }

  async _onTradeRequest(event) {
    event.preventDefault();

    const target =
      Array.from(game.user.targets ?? [])[0];

    const targetActor =
      target?.actor ?? null;

    if (!targetActor) {
      ui.notifications.warn("Selecciona un token objetivo para solicitar comercio.");
      return;
    }

    abrirDialogoComercioMtrol(
      this.actor,
      targetActor
    );
  }

  async _onEditItem(event) {
    event.preventDefault();

    const item = this._getItemFromEvent(event);
    if (!item) return;

    if (item.sheet) item.sheet.render(true);
  }

  async _onDeleteItem(event) {
    event.preventDefault();

    const item = this._getItemFromEvent(event);
    if (!item) return;

    if (!game.user.isGM) {
      ui.notifications.warn("Solo el Game Master puede eliminar elementos.");
      return;
    }

    if (
      (item.type === "objeto" || item.type === "item") &&
      item.system.equipado &&
      item.system.slot
    ) {
      await this.actor.update({
        [`system.equipamiento.${item.system.slot}`]: ""
      });
    }

    await item.delete();

    this.render(true);
  }

  async _onEquipItem(event) {
    event.preventDefault();

    const item = this._getItemFromEvent(event);
    if (!item) return;

    await equiparObjeto(
      this.actor,
      item
    );

    this.render(false);
  }

  async _onUnequipItem(event) {
    event.preventDefault();

    const item = this._getItemFromEvent(event);
    if (!item) return;

    await desequiparObjeto(
      this.actor,
      item
    );

    this.render(false);
  }

  _getItemFromEvent(event) {
    const itemId =
      event.currentTarget.closest("[data-item-id]")?.dataset?.itemId ??
      event.currentTarget.dataset?.itemId;

    if (!itemId) {
      console.warn("MtRol | No se encontró data-item-id en el evento.", event);
      return null;
    }

    const item =
      this.actor.items.get(itemId);

    if (!item) {
      console.warn(`MtRol | No se encontró item con id: ${itemId}`);
      return null;
    }

    return item;
  }

  _formulaCompetenciaPorNivel(nivel) {
    switch (nivel) {
      case 1: return "1d4 + 1";
      case 2: return "1d6 + 2";
      case 3: return "1d8 + 3";
      case 4: return "1d10 + 4";
      case 5: return "1d12 + 5";
      default: return "1d4 + 1";
    }
  }
}
