import { db } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import {
  getSession,
  issueSession,
  type SessionTokens,
} from "../auth/service.js";
import type {
  AdminAuditDTO,
  AdminStatsDTO,
  AdminTeamDTO,
  AdminUserDTO,
  SessionUser,
} from "@curvelo/shared";

export async function requireSystemAdmin(actorId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: actorId },
    select: { systemRole: true },
  });
  if (user?.systemRole !== "SYSTEM_ADMIN") {
    throw forbidden("Site admin required.");
  }
}

export async function adminStats(actorId: string): Promise<AdminStatsDTO> {
  await requireSystemAdmin(actorId);
  const dayAgo = new Date(Date.now() - 24 * 3600_000);
  const [users, teams, activities, raceResults, documents, posts, auditEvents24h] =
    await Promise.all([
      db.user.count(),
      db.team.count(),
      db.activity.count(),
      db.raceResult.count(),
      db.document.count(),
      db.feedPost.count(),
      db.auditLog.count({ where: { createdAt: { gte: dayAgo } } }),
    ]);
  return { users, teams, activities, raceResults, documents, posts, auditEvents24h };
}

export async function listUsers(
  actorId: string,
  opts: { search?: string; page: number; pageSize: number },
): Promise<{ users: AdminUserDTO[]; total: number }> {
  await requireSystemAdmin(actorId);
  const where = opts.search
    ? {
        OR: [
          { email: { contains: opts.search, mode: "insensitive" as const } },
          { displayName: { contains: opts.search, mode: "insensitive" as const } },
        ],
      }
    : {};
  const [total, rows] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
      select: {
        id: true,
        email: true,
        displayName: true,
        status: true,
        systemRole: true,
        createdAt: true,
        _count: { select: { memberships: true } },
      },
    }),
  ]);
  return {
    total,
    users: rows.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      status: u.status,
      systemRole: u.systemRole,
      teamCount: u._count.memberships,
      createdAt: u.createdAt.toISOString(),
    })),
  };
}

export async function updateUser(
  actorId: string,
  userId: string,
  input: { status?: "ACTIVE" | "SUSPENDED"; systemRole?: "SYSTEM_ADMIN" | null },
  ipAddress?: string,
): Promise<AdminUserDTO> {
  await requireSystemAdmin(actorId);
  if (userId === actorId) {
    throw badRequest("You can't change your own admin status or role.");
  }
  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target) throw notFound("User not found.");

  const data: { status?: string; systemRole?: "SYSTEM_ADMIN" | null } = {};
  if (input.status) data.status = input.status;
  if (input.systemRole !== undefined) data.systemRole = input.systemRole;

  const updated = await db.user.update({
    where: { id: userId },
    data,
    select: {
      id: true,
      email: true,
      displayName: true,
      status: true,
      systemRole: true,
      createdAt: true,
      _count: { select: { memberships: true } },
    },
  });

  // Suspending kills all sessions immediately.
  if (input.status === "SUSPENDED") {
    await db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  await audit({
    actorId,
    action: "ADMIN_USER_UPDATED",
    entityType: "User",
    entityId: userId,
    metadata: input,
    ipAddress,
  });

  return {
    id: updated.id,
    email: updated.email,
    displayName: updated.displayName,
    status: updated.status,
    systemRole: updated.systemRole,
    teamCount: updated._count.memberships,
    createdAt: updated.createdAt.toISOString(),
  };
}

export async function listTeams(actorId: string): Promise<AdminTeamDTO[]> {
  await requireSystemAdmin(actorId);
  const rows = await db.team.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      name: true,
      slug: true,
      visibility: true,
      createdAt: true,
      owner: { select: { displayName: true } },
      _count: { select: { memberships: true } },
    },
  });
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    visibility: t.visibility,
    memberCount: t._count.memberships,
    ownerName: t.owner.displayName,
    createdAt: t.createdAt.toISOString(),
  }));
}

export async function auditLog(
  actorId: string,
  opts: {
    action?: string;
    actorId?: string;
    entityType?: string;
    from?: string;
    to?: string;
    page: number;
    pageSize: number;
  },
): Promise<{ events: AdminAuditDTO[]; total: number }> {
  await requireSystemAdmin(actorId);
  const where: Record<string, unknown> = {};
  if (opts.action) where.action = { contains: opts.action, mode: "insensitive" };
  if (opts.actorId) where.actorId = opts.actorId;
  if (opts.entityType) where.entityType = opts.entityType;
  if (opts.from || opts.to) {
    where.createdAt = {
      ...(opts.from ? { gte: new Date(opts.from) } : {}),
      ...(opts.to ? { lte: new Date(opts.to) } : {}),
    };
  }
  const [total, rows] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
      include: { actor: { select: { displayName: true } } },
    }),
  ]);
  return {
    total,
    events: rows.map((e) => ({
      id: e.id,
      actorId: e.actorId,
      actorName: e.actor?.displayName ?? null,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      ipAddress: e.ipAddress,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

/**
 * "View as": a site admin opens a session as another user to see exactly
 * what they see (roles, teams, visibility) — for validating UX without
 * juggling logins.
 *
 * The issued session's tokens carry the TARGET user's id, so every
 * permission check in the app reads the impersonated identity: no admin
 * powers leak through. The refresh-token row is marked with the admin's id
 * so the session can be exited back to the admin, and both start and end
 * are audit-logged.
 */
export async function impersonateUser(
  adminId: string,
  targetId: string,
  ipAddress?: string,
): Promise<{ user: SessionUser; tokens: SessionTokens }> {
  await requireSystemAdmin(adminId);
  if (adminId === targetId) {
    throw badRequest("Cannot impersonate yourself.");
  }
  const target = await db.user.findUnique({
    where: { id: targetId },
    select: { id: true, status: true, systemRole: true },
  });
  if (!target) throw notFound("User not found.");
  if (target.systemRole === "SYSTEM_ADMIN") {
    throw forbidden("Cannot impersonate another site admin.");
  }
  if (target.status !== "ACTIVE") {
    throw badRequest("Cannot impersonate a suspended account.");
  }

  await audit({
    actorId: adminId,
    action: "IMPERSONATION_STARTED",
    entityType: "User",
    entityId: targetId,
    ipAddress,
  });

  const tokens = await issueSession(targetId, {
    impersonatedByAdminId: adminId,
  });
  return { user: await getSession(targetId), tokens };
}

/**
 * Exit an impersonated session: kills the impersonated tokens and issues a
 * fresh session for the originating admin. Callable only from a session that
 * is currently marked as impersonated (the `imp` access-token claim, which
 * is signed and survives token rotation); the admin must still hold the role.
 */
export async function exitImpersonation(
  currentUserId: string,
  impersonatedByAdminId: string | null,
  ipAddress?: string,
): Promise<{ user: SessionUser; tokens: SessionTokens }> {
  const adminId = impersonatedByAdminId;
  if (!adminId) {
    throw forbidden("Not in an impersonated session.");
  }

  // The admin must still be an admin — a demotion in the meantime must not
  // be bypassed by exiting into admin powers.
  const admin = await db.user.findUnique({
    where: { id: adminId },
    select: { status: true, systemRole: true },
  });
  if (!admin || admin.status !== "ACTIVE" || admin.systemRole !== "SYSTEM_ADMIN") {
    throw forbidden("Impersonation source is no longer a site admin.");
  }

  // Kill every live impersonated session row for this user/admin pair.
  await db.refreshToken.updateMany({
    where: {
      userId: currentUserId,
      impersonatedByAdminId: adminId,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });

  await audit({
    actorId: adminId,
    action: "IMPERSONATION_ENDED",
    entityType: "User",
    entityId: currentUserId,
    ipAddress,
  });

  const tokens = await issueSession(adminId);
  return { user: await getSession(adminId), tokens };
}
