const MOVEMENT_KEYS = Object.freeze(["x", "y", "elevation"]);
const LOCKED_STATES = new Set(["NEGOTIATING", "READY", "EXECUTING"]);

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sceneUuid(token) {
  return String(token?.parent?.uuid ?? token?.scene?.uuid ?? "");
}

function tokenActorUuid(token) {
  return String(token?.actor?.uuid ?? token?.actorUuid ?? "");
}

function gridType(scene, grid) {
  return number(scene?.grid?.type ?? grid?.type, 0);
}

function gridSize(scene, grid) {
  return number(scene?.grid?.size ?? grid?.size, 0);
}

function tokenRectangle(token, size) {
  const width = Math.max(1, number(token?.width, 1));
  const height = Math.max(1, number(token?.height, 1));
  const left = number(token?.x, 0);
  const top = number(token?.y, 0);
  return {
    left,
    top,
    right: left + width * size,
    bottom: top + height * size
  };
}

function axisGap(startA, endA, startB, endB) {
  return Math.max(0, startA - endB, startB - endA);
}

export function measureSquareGridTokenDistance(tokenA, tokenB, { size }) {
  const normalizedSize = gridSize(null, { size });
  if (normalizedSize <= 0) throw new Error("La Scene no posee un tamaño de grid válido.");
  const a = tokenRectangle(tokenA, normalizedSize);
  const b = tokenRectangle(tokenB, normalizedSize);
  const horizontalGap = axisGap(a.left, a.right, b.left, b.right);
  const verticalGap = axisGap(a.top, a.bottom, b.top, b.bottom);
  return 1 + Math.max(horizontalGap, verticalGap) / normalizedSize;
}

export function validateTradeTokenProximity({ tokenA, tokenB, grid = null }) {
  if (!tokenA || !tokenB) throw new Error("Ambos Tokens deben existir para iniciar el comercio.");
  const sceneA = sceneUuid(tokenA);
  const sceneB = sceneUuid(tokenB);
  if (!sceneA || sceneA !== sceneB) throw new Error("Ambos Tokens deben estar en la misma Scene.");
  if (!tokenActorUuid(tokenA) || !tokenActorUuid(tokenB)) {
    throw new Error("Ambos Tokens deben representar Actors válidos.");
  }
  if (tokenActorUuid(tokenA) === tokenActorUuid(tokenB)) {
    throw new Error("Los Tokens de comercio deben representar Actors distintos.");
  }

  const scene = tokenA.parent ?? tokenA.scene ?? null;
  const type = gridType(scene, grid);
  const squareType = globalThis.CONST?.GRID_TYPES?.SQUARE ?? 1;
  if (type !== squareType) {
    throw new Error("El comercio por proximidad sólo está habilitado en grid cuadrado.");
  }
  const distance = measureSquareGridTokenDistance(tokenA, tokenB, {
    size: gridSize(scene, grid)
  });
  if (distance > 1) throw new Error("Los Tokens deben estar adyacentes para comerciar.");
  return { valid: true, distance, sceneUuid: sceneA };
}

export function isTokenMovement(token, changes) {
  return MOVEMENT_KEYS.some(key =>
    Object.prototype.hasOwnProperty.call(changes ?? {}, key) &&
    number(changes[key]) !== number(token?.[key])
  );
}

export class TradeMovementLockService {
  constructor() {
    this.byToken = new Map();
    this.bySession = new Map();
  }

  lockSession(session, tokens = {}) {
    if (!LOCKED_STATES.has(session?.state)) {
      throw new Error("La sesión todavía no admite movement locks.");
    }
    const locks = [];
    for (const [participantKey, participant] of Object.entries(session.participants ?? {})) {
      const tokenUuid = String(participant?.tokenUuid ?? "").trim();
      const token = tokens[participantKey];
      if (!tokenUuid || !token) throw new Error("No se pudo resolver un Token participante para bloquearlo.");
      const existing = this.byToken.get(tokenUuid);
      if (existing && existing.sessionId !== session.id) {
        throw new Error("El Token ya posee un movement lock de otra sesión.");
      }
      const lock = {
        sessionId: session.id,
        participantKey,
        tokenUuid,
        userId: participant.userId,
        position: {
          x: number(token.x),
          y: number(token.y),
          elevation: number(token.elevation)
        }
      };
      this.byToken.set(tokenUuid, lock);
      locks.push(lock);
    }
    this.bySession.set(session.id, locks.map(lock => lock.tokenUuid));
    return locks.map(lock => structuredClone(lock));
  }

  getLock(tokenUuid) {
    const lock = this.byToken.get(String(tokenUuid ?? ""));
    return lock ? structuredClone(lock) : null;
  }

  updateAuthorizedPosition(tokenUuid, token) {
    const lock = this.byToken.get(String(tokenUuid ?? ""));
    if (!lock) return false;
    lock.position = {
      x: number(token.x),
      y: number(token.y),
      elevation: number(token.elevation)
    };
    return true;
  }

  releaseSession(sessionId) {
    const id = String(sessionId ?? "");
    const tokenUuids = this.bySession.get(id) ?? [];
    for (const tokenUuid of tokenUuids) {
      if (this.byToken.get(tokenUuid)?.sessionId === id) this.byToken.delete(tokenUuid);
    }
    this.bySession.delete(id);
    return tokenUuids.length;
  }

  clear() {
    this.byToken.clear();
    this.bySession.clear();
  }

  count() {
    return this.byToken.size;
  }
}

export const tradeMovementLocks = new TradeMovementLockService();

export function findClientTradeLock(tokenUuid) {
  const uuid = String(tokenUuid ?? "");
  for (const session of game.mtrol?.trade?.listSessions?.() ?? []) {
    if (!LOCKED_STATES.has(session.state)) continue;
    const participant = Object.values(session.participants ?? {}).find(candidate =>
      candidate.tokenUuid === uuid
    );
    if (participant) return { sessionId: session.id, userId: participant.userId, tokenUuid: uuid };
  }
  return null;
}

export function getRuntimeTradeLock(tokenUuid) {
  return game.user?.isGM
    ? tradeMovementLocks.getLock(tokenUuid)
    : findClientTradeLock(tokenUuid);
}
