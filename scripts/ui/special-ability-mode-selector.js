export const MTROL_SPECIAL_ABILITY_MODES = Object.freeze({
  ATTACK: "attack",
  MOVEMENT: "movement",
  STUN: "stun"
});

export function selectOrbContextualMode({ abilityName = "Orbe" } = {}) {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const dialog = new Dialog({
      title: `${abilityName}: elegir modo`,
      content: "<p>Elegí cómo usar la habilidad. La opción funcional se ejecutará inmediatamente.</p>",
      buttons: {
        attack: { label: "Ataque", callback: () => finish(MTROL_SPECIAL_ABILITY_MODES.ATTACK) },
        movement: { label: "Movimiento", callback: () => finish(MTROL_SPECIAL_ABILITY_MODES.MOVEMENT) },
        stun: {
          label: "Stun (próximamente)",
          callback: () => finish(null)
        }
      },
      default: "attack",
      close: () => finish(null),
      render: html => {
        const button = html.find?.('[data-button="stun"]')?.[0];
        if (button) {
          button.disabled = true;
          button.title = "Función todavía no disponible";
        }
      }
    });
    dialog.render(true);
  });
}
