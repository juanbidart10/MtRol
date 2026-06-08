// =========================
// MTROL - AMBIENT FX APP
// =========================

import {
  addAmbientFx,
  removeAmbientFx,
  listAmbientFx,
  previewAmbientFx,
  refreshSceneAmbientFx,
  stopActiveAmbientFx,
  stopAmbientFx
} from "./ambient-fx-manager.js";

const ApplicationClass =
  foundry.appv1?.api?.Application ?? Application;

function getDefaultPosition() {
  const scene =
    canvas?.scene;

  return {
    x: Math.round(canvas?.stage?.pivot?.x ?? scene?.width / 2 ?? 0),
    y: Math.round(canvas?.stage?.pivot?.y ?? scene?.height / 2 ?? 0)
  };
}

function shortenPath(path) {
  const text =
    String(path ?? "");

  if (text.length <= 64) return text;

  return `...${text.slice(-61)}`;
}

export class MtrolAmbientFxApp extends ApplicationClass {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "mtrol-ambient-fx-app",
      title: "MTROL Ambient FX",
      template: "systems/mtrol/templates/apps/ambient-fx-app.html",
      classes: ["mtrol", "mtrol-ambient-fx-app"],
      width: 560,
      height: "auto",
      resizable: true
    });
  }

  async getData(options = {}) {
    const data =
      await super.getData(options);

    const scene =
      canvas?.scene ?? null;

    const position =
      getDefaultPosition();

    const effects =
      scene ? (await listAmbientFx(scene.id)).map(effect => ({
        ...effect,
        fileShort: shortenPath(effect.file)
      })) : [];

    return {
      ...data,
      sceneId: scene?.id ?? "",
      sceneName: scene?.name ?? "Sin escena activa",
      effects,
      hasEffects: effects.length > 0,
      defaults: {
        label: "",
        file: "",
        x: position.x,
        y: position.y,
        scale: 1,
        opacity: 1,
        rotation: 0,
        belowTokens: false,
        aboveLighting: false
      }
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    const root =
      html[0] ?? html;

    root.querySelector("[data-action='refresh']")
      ?.addEventListener("click", async event => {
        event.preventDefault();
        await refreshSceneAmbientFx();
        this.render(false);
      });

    root.querySelector("[data-action='stop']")
      ?.addEventListener("click", async event => {
        event.preventDefault();
        await stopActiveAmbientFx();
      });

    root.querySelector("[data-action='preview']")
      ?.addEventListener("click", async event => {
        event.preventDefault();
        await previewAmbientFx(this.#readFormData(root));
      });

    root.querySelector("[data-action='save']")
      ?.addEventListener("click", async event => {
        event.preventDefault();
        const effect =
          await addAmbientFx(this.#readFormData(root));

        if (effect) {
          this.render(false);
        }
      });

    root.querySelectorAll("[data-action='delete']")
      .forEach(button => {
        button.addEventListener("click", async event => {
          event.preventDefault();
          const id =
            event.currentTarget?.dataset?.fxId;

          if (await removeAmbientFx(id)) {
            this.render(false);
          }
        });
      });

    root.querySelectorAll("[data-action='preview-saved']")
      .forEach(button => {
        button.addEventListener("click", async event => {
          event.preventDefault();
          const effect =
            await this.#getSavedEffect(event.currentTarget?.dataset?.fxId);

          if (effect) await previewAmbientFx(effect);
        });
      });

    root.querySelectorAll("[data-action='stop-saved']")
      .forEach(button => {
        button.addEventListener("click", async event => {
          event.preventDefault();
          await stopAmbientFx(event.currentTarget?.dataset?.fxId);
        });
      });
  }

  async #getSavedEffect(id) {
    const effects =
      await listAmbientFx(canvas?.scene?.id);

    return effects.find(effect => effect?.id === id || effect?.name === id) ?? null;
  }

  #readFormData(root) {
    const form =
      root.querySelector(".mtrol-ambient-form");

    const formData =
      new FormData(form);

    return {
      label: formData.get("label"),
      file: formData.get("file"),
      x: formData.get("x"),
      y: formData.get("y"),
      scale: formData.get("scale"),
      opacity: formData.get("opacity"),
      rotation: formData.get("rotation"),
      belowTokens: formData.get("belowTokens"),
      aboveLighting: formData.get("aboveLighting")
    };
  }
}
