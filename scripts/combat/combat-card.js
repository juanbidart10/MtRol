// =========================
// MTROL - COMBAT CARD UI
// =========================

export async function crearCombatCard({
  actor,
  targetActor = null,
  damageRoll,
  resultadoDanio,
  costoTotal = 0,
  evaluacionDanio = null,
  totalBaseDanio = null,
  totalFinalDanio = null
} = {}) {
  if (!actor) {
    console.warn("MTROL | crearCombatCard cancelado: falta actor.");
    return;
  }

  if (!damageRoll || !resultadoDanio) {
    console.warn("MTROL | crearCombatCard cancelado: faltan datos de danio.");
    return;
  }

  const damageRollHTML =
    await damageRoll.render({
      flavor: "Tirada de Daño"
    });

  const localizacionRollHTML =
    resultadoDanio.localizacionRoll
      ? await resultadoDanio.localizacionRoll.render({
          flavor: "Tirada de Localización"
        })
      : "";

  const objetivoMuerto =
    Number(resultadoDanio.hpNuevo ?? 1) <= 0;

  const aplicacionManual =
    resultadoDanio.aplicacion === "manual_sin_gm";

  const armaduraDestruida =
    Boolean(resultadoDanio.itemDestruido);

  const targetName =
    targetActor?.name ?? "Sin objetivo";

  const targetTextCombat =
    targetActor
      ? `<strong>${targetName}</strong>`
      : "<strong>Sin objetivo</strong>";

  const itemName =
    resultadoDanio.item ?? "Sin armadura";

  const detallesCritico =
    Array.isArray(evaluacionDanio?.detalles)
      ? evaluacionDanio.detalles
      : [];

  const hayCritico =
    detallesCritico.length > 0;

  const baseDanio =
    totalBaseDanio ?? damageRoll.total ?? 0;

  const extraCritico =
    Number(evaluacionDanio?.totalExtra ?? 0);

  const finalDanio =
    totalFinalDanio ??
    resultadoDanio.danioOriginal ??
    damageRoll.total ??
    0;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="mtrol-combat-card">
        <div class="mtrol-combat-header">
          <div class="mtrol-combat-title">
            Resultado de Combate
          </div>

          <div class="mtrol-combat-subheader">
            <strong>${actor.name}</strong>
            &rarr;
            ${targetTextCombat}
          </div>
        </div>

        <hr>

        <div class="mtrol-combat-section">
          <div class="mtrol-roll-block">
            ${damageRollHTML}
          </div>

          <p>
            <span class="mtrol-combat-label">Da&ntilde;o base</span>
            <strong>${baseDanio}</strong>
          </p>

          ${
            hayCritico
              ? `
                <div class="mtrol-combat-crit-block">
                  <p>
                    <strong>Cadena de cr&iacute;tico</strong>
                  </p>

                  <div class="mtrol-details">
                    ${detallesCritico.join("<br>")}
                  </div>

                  <p>
                    <span class="mtrol-combat-label">Extra cr&iacute;tico</span>
                    <strong>${extraCritico}</strong>
                  </p>

                  <p>
                    <span class="mtrol-combat-label">Da&ntilde;o final con cr&iacute;tico</span>
                    <strong>${finalDanio}</strong>
                  </p>
                </div>

                <hr>
              `
              : ""
          }

          ${
            localizacionRollHTML
              ? `
                <div class="mtrol-roll-block">
                  ${localizacionRollHTML}
                </div>
              `
              : ""
          }

          <p>
            <span class="mtrol-combat-label">Dado de localizaci&oacute;n</span>
            <strong>D10 = ${resultadoDanio.numeroLocalizacion ?? "-"}</strong>
          </p>

          <p>
            <span class="mtrol-combat-label">Zona impactada</span>
            <strong>${resultadoDanio.zona ?? "No determinada"}</strong>
          </p>

          <p>
            <span class="mtrol-combat-label">Da&ntilde;o aplicado</span>
            <strong>${resultadoDanio.danioOriginal ?? 0}</strong>
          </p>

          <p>
            <span class="mtrol-combat-label">Armadura</span>
            <strong>${itemName}</strong>
          </p>

          <p>
            <span class="mtrol-combat-label">Defensa</span>
            <strong>${resultadoDanio.defensaInicial ?? 0}</strong>
            &rarr;
            <strong>${resultadoDanio.defensaFinal ?? 0}</strong>
          </p>

          <p>
            <span class="mtrol-combat-label">Da&ntilde;o absorbido</span>
            <strong>${resultadoDanio.danioAbsorbido ?? 0}</strong>
          </p>

          <p>
            <span class="mtrol-combat-label">HP perdido</span>
            <strong>${resultadoDanio.hpPerdido ?? 0}</strong>
          </p>

          <hr>

          <p>
            <span class="mtrol-combat-label">MP consumido</span>
            <strong>${costoTotal ?? 0}</strong>
          </p>

          ${
            aplicacionManual
              ? `
                <div class="mtrol-combat-alert">
                  No hay GM conectado para aplicar automáticamente el daño. Aplicar manualmente.
                </div>
              `
              : ""
          }

          ${
            armaduraDestruida
              ? `
                <div class="mtrol-combat-alert destroy">
                  ${itemName} fue destruido
                </div>
              `
              : ""
          }

          ${
            objetivoMuerto && targetActor
              ? `
                <div class="mtrol-combat-alert death">
                  ${targetName} ha muerto
                </div>
              `
              : ""
          }
        </div>
      </div>
    `
  });
}
