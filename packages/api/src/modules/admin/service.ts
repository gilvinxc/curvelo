import { db } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import type {
  AdminAuditDTO,
  AdminStatsDTO,
  AdminTeamDTO,
  AdminUserDTO,
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
