// =========================
// MTROL - SYSTEM CORE
// =========================

export function mtrolSystemId() {

  return game.system?.id ?? "mtrol";

}

export function mtrolFlagScope() {

  return mtrolSystemId();

}

export function mtrolSystemPath() {

  return `systems/${mtrolSystemId()}`;

}
