import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import type { LoginInput, RegisterInput, SessionUser } from "@curvelo/shared";
import { db } from "../../db.js";
import { config } from "../../config.js";
import { audit } from "../../lib/audit.js";
import { AppError, badRequest, conflict, unauthorized } from "../../lib/errors.js";
import { passwordResetMail, sendMail } from "../../lib/mail.js";
import {
  hashToken,
  newTokenFamily,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../../lib/tokens.js";

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

const PUBLIC_USER_SELECT = {
  id: true,
  email: true,
  displayName: true,
  systemRole: true,
} as const;

function toSessionUser(
  user: {
    id: string;
    email: string;
    displayName: string;
    systemRole: string | null;
    memberships: Array<{
      role: string;
      status: string;
      team: { id: string; name: string; slug: string };
    }>;
  },
): SessionUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    systemRole: user.systemRole,
    memberships: user.memberships.map((m) => ({
      teamId: m.team.id,
      teamName: m.team.name,
      teamSlug: m.team.slug,
      role: m.role,
      status: m.status,
    })),
  };
}

async function loadSessionUser(userId: string): Promise<SessionUser> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      ...PUBLIC_USER_SELECT,
      memberships: {
        where: { status: "ACTIVE" },
        select: {
          role: true,
          status: true,
          team: { select: { id: true, name: true, slug: true } },
        },
      },
    },
  });
  if (!user) throw unauthorized();
  return toSessionUser(user);
}

/** Issues a new token pair and persists the refresh token hash. */
async function issueSession(userId: string): Promise<SessionTokens> {
  const familyId = newTokenFamily();
  const accessToken = signAccessToken(userId);
  const refreshToken = signRefreshToken(userId, familyId);
  await db.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(refreshToken),
      familyId,
      expiresAt: new Date(Date.now() + config.refreshTtlSec * 1000),
    },
  });
  return { accessToken, refreshToken };
}

export async function register(
  input: RegisterInput,
  ipAddress?: string,
): Promise<{ user: SessionUser; tokens: SessionTokens }> {
  const email = input.email.toLowerCase().trim();
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) throw conflict("EMAIL_TAKEN", "An account with this email already exists");

  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email,
        passwordHash,
        displayName: input.displayName.trim(),
        dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
      },
    });
    await tx.profile.create({
      data: { userId: created.id, persona: input.role },
    });
    return created;
  });

  await audit({
    actorId: user.id,
    action: "USER_REGISTERED",
    entityType: "User",
    entityId: user.id,
    metadata: { persona: input.role },
    ipAddress,
  });

  const tokens = await issueSession(user.id);
  return { user: await loadSessionUser(user.id), tokens };
}

export async function login(
  input: LoginInput,
  ipAddress?: string,
): Promise<{ user: SessionUser; tokens: SessionTokens }> {
  const email = input.email.toLowerCase().trim();
  const user = await db.user.findUnique({ where: { email } });
  // Same response for unknown email vs wrong password: no account enumeration.
  const passwordOk = user
    ? await bcrypt.compare(input.password, user.passwordHash)
    : false;
  if (!user || !passwordOk) {
    throw unauthorized("Invalid email or password");
  }
  if (user.status !== "ACTIVE") {
    throw new AppError(403, "ACCOUNT_DISABLED", "This account is disabled");
  }

  await audit({
    actorId: user.id,
    action: "USER_LOGIN",
    entityType: "User",
    entityId: user.id,
    ipAddress,
  });

  const tokens = await issueSession(user.id);
  return { user: await loadSessionUser(user.id), tokens };
}

/**
 * Rotates a refresh token. Reuse of an already-rotated token indicates
 * theft: the whole family is revoked and the session dies.
 */
export async function refresh(
  refreshToken: string,
  ipAddress?: string,
): Promise<{ user: SessionUser; tokens: SessionTokens }> {
  const claims = verifyRefreshToken(refreshToken);
  const stored = await db.refreshToken.findUnique({
    where: { tokenHash: hashToken(refreshToken) },
  });

  if (!stored || stored.expiresAt < new Date()) {
    throw unauthorized("Invalid or expired token");
  }
  if (stored.revokedAt) {
    // Token reuse — possible theft. Kill the whole family.
    await db.refreshToken.updateMany({
      where: { familyId: stored.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await audit({
      actorId: stored.userId,
      action: "REFRESH_TOKEN_REUSE_DETECTED",
      entityType: "User",
      entityId: stored.userId,
      ipAddress,
    });
    throw unauthorized("Invalid or expired token");
  }
  if (stored.userId !== claims.sub || stored.familyId !== claims.fam) {
    throw unauthorized("Invalid or expired token");
  }

  const newRefreshToken = signRefreshToken(stored.userId, stored.familyId);
  const accessToken = signAccessToken(stored.userId);
  await db.$transaction([
    db.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    }),
    db.refreshToken.create({
      data: {
        userId: stored.userId,
        tokenHash: hashToken(newRefreshToken),
        familyId: stored.familyId,
        expiresAt: new Date(Date.now() + config.refreshTtlSec * 1000),
      },
    }),
  ]);

  return {
    user: await loadSessionUser(stored.userId),
    tokens: { accessToken, refreshToken: newRefreshToken },
  };
}

export async function logout(refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) return;
  try {
    const claims = verifyRefreshToken(refreshToken);
    await db.refreshToken.updateMany({
      where: { familyId: claims.fam, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  } catch {
    // Invalid token on logout is not an error — the session is dead anyway.
  }
}

export async function getSession(userId: string): Promise<SessionUser> {
  return loadSessionUser(userId);
}

/**
 * Forgot password: issue a single-use reset token and email the link.
 * Always succeeds silently so the endpoint can't be used to enumerate
 * which email addresses have accounts.
 */
export async function requestPasswordReset(
  email: string,
  ipAddress?: string,
): Promise<void> {
  const normalized = email.trim().toLowerCase();
  const user = await db.user.findUnique({
    where: { email: normalized },
    select: { id: true, email: true },
  });
  if (!user) {
    await audit({
      actorId: null,
      action: "PASSWORD_RESET_REQUESTED_UNKNOWN",
      entityType: "User",
      metadata: { email: normalized },
      ipAddress,
    });
    return;
  }

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  await db.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + config.passwordResetTtlMinutes * 60_000),
    },
  });

  const resetUrl = `${config.webUrl}/reset-password?token=${rawToken}`;
  try {
    await sendMail(
      passwordResetMail(user.email, resetUrl, config.passwordResetTtlMinutes),
    );
  } catch (err) {
    // Email delivery failure shouldn't leak account existence; the audit
    // trail keeps it visible to site admins.
    await audit({
      actorId: user.id,
      action: "PASSWORD_RESET_EMAIL_FAILED",
      entityType: "User",
      entityId: user.id,
      ipAddress,
    });
    throw err;
  }

  await audit({
    actorId: user.id,
    action: "PASSWORD_RESET_REQUESTED",
    entityType: "User",
    entityId: user.id,
    ipAddress,
  });
}

/** Consume a reset token and set a new password. Logs out all sessions. */
export async function resetPassword(
  rawToken: string,
  newPassword: string,
  ipAddress?: string,
): Promise<void> {
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const stored = await db.passwordResetToken.findUnique({
    where: { tokenHash },
  });
  if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
    throw badRequest("This reset link is invalid or has expired.");
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db.$transaction([
    db.user.update({
      where: { id: stored.userId },
      data: { passwordHash },
    }),
    db.passwordResetToken.update({
      where: { id: stored.id },
      data: { usedAt: new Date() },
    }),
    // Log out everywhere: a reset implies the old credentials may be compromised.
    db.refreshToken.updateMany({
      where: { userId: stored.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  await audit({
    actorId: stored.userId,
    action: "PASSWORD_RESET_COMPLETED",
    entityType: "User",
    entityId: stored.userId,
    ipAddress,
  });
}
