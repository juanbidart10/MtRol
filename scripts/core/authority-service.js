export class AuthorityBoundaryError extends Error {
  constructor(message, reasonCode = "AUTHORITY_REJECTED") {
    super(message);
    this.name = "AuthorityBoundaryError";
    this.reasonCode = reasonCode;
  }
}

function values(collection) {
  if (typeof collection?.values === "function") return Array.from(collection.values());
  return Array.from(collection ?? []);
}

export class AuthorityService {
  constructor({
    getUsers = () => globalThis.game?.users,
    getCurrentUser = () => globalThis.game?.user
  } = {}) {
    this.getUsers = getUsers;
    this.getCurrentUser = getCurrentUser;
  }

  resolveUser(userId) {
    const users = this.getUsers();
    return users?.get?.(userId) ?? values(users).find(user => user.id === userId) ?? null;
  }

  resolvePrimaryGM() {
    return values(this.getUsers())
      .filter(user => user?.isGM === true && user?.active === true)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))[0] ?? null;
  }

  isPrimaryGM(userId = this.getCurrentUser()?.id) {
    return Boolean(userId && this.resolvePrimaryGM()?.id === userId);
  }

  ownsActor(actor, userId) {
    const user = typeof userId === "object" ? userId : this.resolveUser(userId);
    if (user?.isGM) return true;
    return Boolean(actor && user && (
      actor.testUserPermission?.(user, "OWNER") === true ||
      Number(actor.ownership?.[user.id] ?? 0) >= 3
    ));
  }

  assertActorOwnership(actor, userId) {
    if (!this.ownsActor(actor, userId)) {
      throw new AuthorityBoundaryError("El usuario no controla el Actor.", "ACTOR_NOT_OWNED");
    }
    return true;
  }

  authenticateSocketRequest(request = {}, { senderUserId = null } = {}) {
    const currentUser = this.getCurrentUser();
    const primaryGM = this.resolvePrimaryGM();
    if (!primaryGM || currentUser?.id !== primaryGM.id) {
      throw new AuthorityBoundaryError("Sólo el Primary GM puede procesar commands autoritativos.", "NOT_PRIMARY_GM");
    }
    if (!senderUserId) {
      throw new AuthorityBoundaryError("Foundry no informó la identidad real del emisor.", "SENDER_MISSING");
    }
    const sender = this.resolveUser(senderUserId);
    if (!sender || sender.active !== true) {
      throw new AuthorityBoundaryError("El emisor no existe o ya no está conectado.", "SENDER_INVALID");
    }
    const claimedUserId = String(request.requestingUserId ?? senderUserId);
    if (claimedUserId !== String(senderUserId)) {
      throw new AuthorityBoundaryError("La identidad declarada no coincide con el emisor real.", "SENDER_SPOOFED");
    }
    if (request.targetGMId && request.targetGMId !== primaryGM.id) {
      throw new AuthorityBoundaryError("El command estaba dirigido a otra autoridad.", "WRONG_AUTHORITY_TARGET");
    }
    return {
      requestingUserId: sender.id,
      requestingUser: sender,
      authorityUserId: primaryGM.id,
      primaryGM,
      authenticated: true
    };
  }

  isPrimaryGMSender(senderUserId) {
    return Boolean(senderUserId && this.resolvePrimaryGM()?.id === senderUserId);
  }
}

export const authorityService = new AuthorityService();
