const LEVELS = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50
});

const DEFAULT_LEVEL = "warn";

function normalizeLevel(level) {
  const normalized = String(level ?? "").trim().toLowerCase();
  if (!(normalized in LEVELS)) {
    throw new Error(`Nivel de log MTROL invalido: ${level}`);
  }
  return normalized;
}

function normalizeChannel(channel) {
  return String(channel ?? "SYSTEM").trim().toUpperCase() || "SYSTEM";
}

function compactValue(value, seen, depth = 0) {
  if (value instanceof Error) return value.message;
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  if (depth >= 2) return "[object]";
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.length > 20) return `[${value.length} elementos]`;
    return value.map(entry => compactValue(entry, seen, depth + 1));
  }
  const looksLikeDocument = typeof value.update === "function" && (value.uuid || value.id);
  if (looksLikeDocument) {
    return {
      uuid: value.uuid ?? null,
      id: value.id ?? null,
      documentName: value.documentName ?? value.constructor?.metadata?.name ?? null
    };
  }
  const entries = Object.entries(value);
  if (entries.length > 20) return `[objeto con ${entries.length} campos]`;
  return Object.fromEntries(entries.map(([key, entry]) => [
    key,
    compactValue(entry, seen, depth + 1)
  ]));
}

function compactContext(context) {
  if (!context || typeof context !== "object") return context ?? undefined;

  const result = {};
  const seen = new WeakSet();
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined) continue;
    result[key] = compactValue(value, seen);
  }
  return result;
}

export class MtrolLogger {
  constructor({ level = DEFAULT_LEVEL, sink = console } = {}) {
    this.level = normalizeLevel(level);
    this.sink = sink;
    this.enabledChannels = new Set();
    this.disabledChannels = new Set();
    this.recentKeys = new Map();
  }

  setLevel(level) {
    this.level = normalizeLevel(level);
    return this.level;
  }

  getLevel() {
    return this.level;
  }

  enableChannel(channel) {
    const normalized = normalizeChannel(channel);
    this.disabledChannels.delete(normalized);
    this.enabledChannels.add(normalized);
    return normalized;
  }

  disableChannel(channel) {
    const normalized = normalizeChannel(channel);
    this.enabledChannels.delete(normalized);
    this.disabledChannels.add(normalized);
    return normalized;
  }

  resetChannels() {
    this.enabledChannels.clear();
    this.disabledChannels.clear();
  }

  shouldLog(level, channel) {
    const normalizedLevel = normalizeLevel(level);
    const normalizedChannel = normalizeChannel(channel);
    if (this.disabledChannels.has(normalizedChannel)) return false;
    if (this.enabledChannels.has(normalizedChannel)) return true;
    return LEVELS[normalizedLevel] >= LEVELS[this.level];
  }

  log(level, channel, message, context = undefined) {
    const normalizedLevel = normalizeLevel(level);
    const normalizedChannel = normalizeChannel(channel);
    if (!this.shouldLog(normalizedLevel, normalizedChannel)) return false;

    const method = typeof this.sink?.[normalizedLevel] === "function"
      ? normalizedLevel
      : "log";
    const prefix = `MTROL | ${normalizedChannel} | ${message}`;
    const compact = compactContext(context);
    if (compact === undefined) this.sink[method](prefix);
    else this.sink[method](prefix, compact);
    return true;
  }

  debug(channel, message, context) {
    return this.log("debug", channel, message, context);
  }

  info(channel, message, context) {
    return this.log("info", channel, message, context);
  }

  warn(channel, message, context) {
    return this.log("warn", channel, message, context);
  }

  error(channel, message, context) {
    return this.log("error", channel, message, context);
  }

  logOnce(level, channel, message, context = undefined, {
    key = null,
    windowMs = 5000
  } = {}) {
    const stableKey = String(key ?? `${level}:${channel}:${message}:${context?.transactionId ?? ""}`);
    const now = Date.now();
    const effectiveWindowMs = Math.max(0, Number(windowMs) || 0);
    for (const [candidate, expiresAt] of this.recentKeys) {
      if (expiresAt <= now) this.recentKeys.delete(candidate);
    }
    const previousExpiresAt = this.recentKeys.get(stableKey) ?? 0;
    if (previousExpiresAt > now) return false;
    this.recentKeys.set(stableKey, now + effectiveWindowMs);
    return this.log(level, channel, message, context);
  }

  warnOnce(channel, message, context, options) {
    return this.logOnce("warn", channel, message, context, options);
  }

  errorOnce(channel, message, context, options) {
    return this.logOnce("error", channel, message, context, options);
  }
}

export const logger = new MtrolLogger();

export function installMtrolLoggerApi() {
  game.mtrol = game.mtrol || {};
  game.mtrol.debug = game.mtrol.debug || {};
  Object.assign(game.mtrol.debug, {
    setLevel: level => logger.setLevel(level),
    getLevel: () => logger.getLevel(),
    enableChannel: channel => logger.enableChannel(channel),
    disableChannel: channel => logger.disableChannel(channel),
    resetChannels: () => logger.resetChannels()
  });
}
