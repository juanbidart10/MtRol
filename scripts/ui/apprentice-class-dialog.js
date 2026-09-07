import {
  MTROL_COMPETENCY_CATALOG
} from "../competencies/competency-catalog.js";

import {
  MTROL_CLASS_DOMAINS
} from "../actors/class-registry.js";

function escape(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

export function promptApprenticeClassConfiguration() {
  const competencyOptions = MTROL_COMPETENCY_CATALOG
    .map(entry => `<option value="${escape(entry.technicalId)}">${escape(entry.name)}</option>`)
    .join("");

  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    new Dialog({
      title: "Configurar Aprendiz",
      content: `
        <form class="mtrol-apprentice-class-dialog">
          <p>Elegí el dominio explícito y tres Competencias iniciales distintas.</p>
          <div class="form-group">
            <label>Dominio</label>
            <select name="classDomain">
              <option value="${MTROL_CLASS_DOMAINS.PHYSICAL}">Físico</option>
              <option value="${MTROL_CLASS_DOMAINS.MAGICAL}">Mágico</option>
              <option value="${MTROL_CLASS_DOMAINS.HYBRID}">Híbrido</option>
            </select>
          </div>
          ${[1, 2, 3].map(index => `
            <div class="form-group">
              <label>Competencia ${index}</label>
              <select name="competency${index}">${competencyOptions}</select>
            </div>
          `).join("")}
        </form>
      `,
      buttons: {
        confirm: {
          icon: '<i class="fas fa-check"></i>',
          label: "Aplicar Aprendiz",
          callback: html => {
            const root = html?.[0] ?? html;
            const classDomain = root?.querySelector?.('[name="classDomain"]')?.value;
            const competencySelections = [1, 2, 3].map(index =>
              root?.querySelector?.(`[name="competency${index}"]`)?.value
            );
            if (new Set(competencySelections).size !== 3) {
              ui.notifications.warn("Las tres Competencias de Aprendiz deben ser distintas.");
              return false;
            }
            finish({ classDomain, competencySelections });
            return true;
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: "Cancelar",
          callback: () => finish(null)
        }
      },
      default: "confirm",
      close: () => finish(null)
    }).render(true);
  });
}
