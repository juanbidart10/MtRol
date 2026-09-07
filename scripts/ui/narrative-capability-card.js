function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

export function buildNarrativeCapabilityCard(declaration) {
  return `<section class="mtrol-chat-card mtrol-narrative-capability-card">
    <h2>${escapeHTML(declaration.actorName)} — ${escapeHTML(declaration.displayName)}</h2>
    <p>${escapeHTML(declaration.description)}</p>
    <p><strong>Declaración narrativa · Resolución a criterio del GM.</strong></p>
    <p>No aplica tiradas, consumos ni efectos automáticos.</p>
    <small>Declara: ${escapeHTML(declaration.userName)} ·
      <time datetime="${escapeHTML(new Date(declaration.timestamp).toISOString())}">${escapeHTML(new Date(declaration.timestamp).toISOString())}</time>
      ${declaration.sceneName ? ` · Escena: ${escapeHTML(declaration.sceneName)}` : ""}
    </small>
  </section>`;
}
