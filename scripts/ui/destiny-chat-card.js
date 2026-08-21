import { resolveMtrolDestinyCardAsset } from "./chat-card-assets.js";

const DESTINY_LABELS = Object.freeze({
  dharma: "Dharma",
  karma: "Karma"
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildMtrolDestinyCardContent({ type, actorName } = {}) {
  const normalizedType = String(type ?? "").trim().toLowerCase();
  const label = DESTINY_LABELS[normalizedType];
  const asset = resolveMtrolDestinyCardAsset(normalizedType);
  if (!label || !asset) {
    throw new TypeError(`Tipo de card de destino inválido: ${type}`);
  }

  const safeActorName = escapeHtml(actorName);
  return `
    <article
      class="mtrol-destiny-card mtrol-destiny-card--${normalizedType}"
      data-mtrol-destiny="${normalizedType}"
      data-mtrol-destiny-asset="${asset}"
      aria-label="${safeActorName} alcanzó 5 puntos de ${label}. Sus puntos se reinician."
    >
      <img
        class="mtrol-destiny-card__art"
        src="${asset}"
        alt=""
        aria-hidden="true"
      >
      <div class="mtrol-destiny-card__content">
        <div class="mtrol-destiny-card__actor">${safeActorName}</div>
        <div class="mtrol-destiny-card__event">alcanzó 5 puntos de</div>
        <div class="mtrol-destiny-card__resource">${label}</div>
        <div class="mtrol-destiny-card__reset">Sus puntos se reinician.</div>
      </div>
    </article>
  `;
}

export function isMtrolDestinyCardContent(content) {
  return Boolean(content?.querySelector?.(".mtrol-destiny-card[data-mtrol-destiny]"));
}
