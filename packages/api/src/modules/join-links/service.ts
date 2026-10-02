import { nanoid } from "nanoid";
import type {
  ApproveJoinRequestInput,
  CreateJoinLinkInput,
} from "@curvelo/shared";
import { INVITABLE_ROLES } from "@curvelo/shared";
import { db } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { AppError, conflict, forbidden, notFound } from "../../lib/errors.js";
import { activeMembership, requireManager } from "../../lib/permissions.js";

type JoinLinkRow = {
  id: string;
  token: string;
  teamId: string;
  expiresAt: Date;
  maxUses: number | null;
  useCount: number;
  revokedAt: Date | null;
  createdAt: Date;
  team: { name: string };
};

function linkState(link: JoinLinkRow): "ACTIVE" | "EXPIRED" | "REVOKED" | "FULL" {
  if (link.revokedAt) return "REVOKED";
  if (link.expiresAt < new Date()) return "EXPIRED";
  if (link.maxUses != null && link.useCount >= link.maxUses) return "FULL";
  return "ACTIVE";
}

function toLinkDTO(link: JoinLinkRow, includeToken: boolean) {
  return {
    id: link.id,
    teamId: link.teamId,
    teamName: link.team.name,
    state: linkState(link),
    expiresAt: link.expiresAt.toISOString(),
    maxUses: link.maxUses,
    useCount: link.useCount,
    createdAt: link.createdAt.toISOString(),
    ...(includeToken ? { token: link.token } : {}),
  };
}

async function getLinkOrThrow(token: string) {
  const link = await db.teamJoinLink.findUnique({
    where: { token },
    include: { team: { select: { name: true, description: true } } },
  });
  if (!link) throw notFound("Invite link not found");
  return link;
}

function requireUsable(link: Awaited<ReturnType<typeof getLinkOrThrow>>) {
  const state = linkState(link as JoinLinkRow);
  if (state !== "ACTIVE") {
    const messages = {
      EXPIRED: "This invite link has expired",
      REVOKED: "This invite link was revoked",
      FULL: "This invite link has reached its use limit",
    } as const;
    throw new AppError(410, `LINK_${state}`, messages[state]);
  }
}

export async function createJoinLink(
  actorId: string,
  teamId: string,
  input: CreateJoinLinkInput,
  ipAddress?: string,
) {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);

  const link = await db.teamJoinLink.create({
    data: {
      token: nanoid(24),
      teamId,
      createdById: actorId,
      expiresAt: new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000),
      maxUses: input.maxUses ?? null,
    },
    include: { team: { select: { name: true } } },
  });

  await audit({
    actorId,
    action: "JOIN_LINK_CREATED",
    entityType: "Team",
    entityId: teamId,
    metadata: { linkId: link.id },
    ipAddress,
  });

  return { link: toLinkDTO(link, true) };
}

export async function listJoinLinks(actorId: string, teamId: string) {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);
  const links = await db.teamJoinLink.findMany({
    where: { teamId },
    include: { team: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return { links: links.map((l) => toLinkDTO(l, true)) };
}

export async function revokeJoinLink(
  actorId: string,
  teamId: string,
  linkId: string,
  ipAddress?: string,
) {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);
  const link = await db.teamJoinLink.findFirst({ where: { id: linkId, teamId } });
  if (!link) throw notFound("Invite link not found");
  if (link.revokedAt) return { ok: true as const };

  await db.teamJoinLink.update({
    where: { id: linkId },
    data: { revokedAt: new Date() },
  });
  await audit({
    actorId,
    action: "JOIN_LINK_REVOKED",
    entityType: "Team",
    entityId: teamId,
    metadata: { linkId },
    ipAddress,
  });
  return { ok: true as const };
}

/** Public preview — shows the team name so the visitor knows what they're joining. */
export async function previewJoinLink(token: string) {
  const link = await getLinkOrThrow(token);
  requireUsable(link);
  return {
    link: {
      teamName: link.team.name,
      teamDescription: link.team.description,
      expiresAt: link.expiresAt.toISOString(),
      usesLeft: link.maxUses == null ? null : link.maxUses - link.useCount,
    },
  };
}

/** Logged-in user requests to join. A coach/admin must approve — links never auto-join. */
export async function requestJoin(
  userId: string,
  token: string,
  ipAddress?: string,
) {
  const link = await getLinkOrThrow(token);
  requireUsable(link);

  const existing = await db.teamMembership.findUnique({
    where: { teamId_userId: { teamId: link.teamId, userId } },
  });
  if (existing?.status === "ACTIVE") {
    throw conflict("ALREADY_MEMBER", "You're already a member of this team");
  }

  const pending = await db.teamJoinRequest.findFirst({
    where: { teamId: link.teamId, userId, status: "PENDING" },
  });
  if (pending) {
    throw conflict("ALREADY_REQUESTED", "Your request is already waiting for approval");
  }

  const request = await db.$transaction(async (tx) => {
    const created = await tx.teamJoinRequest.create({
      data: { teamId: link.teamId, userId, linkId: link.id },
    });
    await tx.teamJoinLink.update({
      where: { id: link.id },
      data: { useCount: { increment: 1 } },
    });
    return created;
  });

  await audit({
    actorId: userId,
    action: "JOIN_REQUESTED",
    entityType: "Team",
    entityId: link.teamId,
    metadata: { requestId: request.id, linkId: link.id },
    ipAddress,
  });

  return { requestId: request.id, teamId: link.teamId, teamName: link.team.name };
}

export async function listJoinRequests(actorId: string, teamId: string) {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);
  const requests = await db.teamJoinRequest.findMany({
    where: { teamId, status: "PENDING" },
    include: { user: { select: { id: true, displayName: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  return {
    requests: requests.map((r) => ({
      id: r.id,
      teamId: r.teamId,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      user: r.user,
    })),
  };
}

export async function decideJoinRequest(
  actorId: string,
  teamId: string,
  requestId: string,
  decision: "APPROVED" | "DENIED",
  input: ApproveJoinRequestInput,
  ipAddress?: string,
) {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);

  const joinRequest = await db.teamJoinRequest.findFirst({
    where: { id: requestId, teamId },
  });
  if (!joinRequest) throw notFound("Join request not found");
  if (joinRequest.status !== "PENDING") {
    throw conflict("ALREADY_DECIDED", "This request was already decided");
  }

  if (decision === "DENIED") {
    await db.teamJoinRequest.update({
      where: { id: requestId },
      data: { status: "DENIED", decidedById: actorId, decidedAt: new Date() },
    });
    await audit({
      actorId,
      action: "JOIN_REQUEST_DENIED",
      entityType: "Team",
      entityId: teamId,
      metadata: { requestId },
      ipAddress,
    });
    return { ok: true as const };
  }

  if (!INVITABLE_ROLES.includes(input.role)) {
    throw forbidden("That role cannot be granted");
  }
  // Only the team owner may hand out coach/admin power.
  const team = await db.team.findUniqueOrThrow({ where: { id: teamId } });
  const elevated = input.role === "COACH" || input.role === "TEAM_ADMIN";
  if (elevated && team.ownerId !== actorId) {
    throw forbidden("Only the team owner can approve someone as a coach");
  }

  await db.$transaction(async (tx) => {
    await tx.teamMembership.upsert({
      where: { teamId_userId: { teamId, userId: joinRequest.userId } },
      create: {
        teamId,
        userId: joinRequest.userId,
        role: input.role,
        status: "ACTIVE",
      },
      update: { role: input.role, status: "ACTIVE" },
    });
    await tx.teamJoinRequest.update({
      where: { id: requestId },
      data: { status: "APPROVED", decidedById: actorId, decidedAt: new Date() },
    });
  });

  await audit({
    actorId,
    action: "JOIN_REQUEST_APPROVED",
    entityType: "Team",
    entityId: teamId,
    metadata: { requestId, userId: joinRequest.userId, role: input.role },
    ipAddress,
  });

  return { ok: true as const, role: input.role };
}
