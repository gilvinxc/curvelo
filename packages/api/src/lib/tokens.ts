import { createHash, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { unauthorized } from "./errors.js";

export interface AccessClaims {
  sub: string;
  typ: "access";
  /** Set on "View as" sessions: the id of the originating site admin. */
  imp: string | null;
}

export interface RefreshClaims {
  sub: string;
  typ: "refresh";
  fam: string;
}

/** Refresh tokens are stored as SHA-256 hashes — a DB leak never yields
 *  usable tokens. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function signAccessToken(
  userId: string,
  opts?: { impersonatedByAdminId?: string },
): string {
  return jwt.sign(
    {
      sub: userId,
      typ: "access",
      ...(opts?.impersonatedByAdminId
        ? { imp: opts.impersonatedByAdminId }
        : {}),
    },
    config.jwtAccessSecret,
    {
      expiresIn: config.accessTtlSec,
    },
  );
}

export function newTokenFamily(): string {
  return randomUUID();
}

export function signRefreshToken(userId: string, familyId: string): string {
  return jwt.sign(
    { sub: userId, typ: "refresh", fam: familyId, jti: randomUUID() },
    config.jwtRefreshSecret,
    { expiresIn: config.refreshTtlSec },
  );
}

function verify(
  token: string,
  secret: string,
  expectedTyp: string,
): Record<string, unknown> {
  try {
    const claims = jwt.verify(token, secret) as Record<string, unknown>;
    if (claims.typ !== expectedTyp) throw unauthorized("Invalid token");
    return claims;
  } catch {
    throw unauthorized("Invalid or expired token");
  }
}

export function verifyAccessToken(token: string): AccessClaims {
  const claims = verify(token, config.jwtAccessSecret, "access");
  return {
    sub: String(claims.sub),
    typ: "access",
    imp: typeof claims.imp === "string" ? claims.imp : null,
  };
}

export function verifyRefreshToken(token: string): RefreshClaims {
  const claims = verify(token, config.jwtRefreshSecret, "refresh");
  return {
    sub: String(claims.sub),
    typ: "refresh",
    fam: String(claims.fam),
  };
}
