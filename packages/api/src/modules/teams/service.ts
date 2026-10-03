import { nanoid } from "nanoid";
import type {
  CreateTeamInput,
  RosterMemberDTO,
  TeamDTO,
  UpdateTeamInput,
} from "@curvelo/shared";
import { db } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { AppError, conflict, forbidden, notFound } from "../../lib/errors.js";
import { ensureTeamConversations } from "../messages/service.js";
import {
  activeMembership,
  canSeeEmails,
  requireManager,
} from "../../lib/permissions.js";

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "team"
  );
}

function toTeamDTO(
  team: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    visibility: string;
    ownerId: string;
    createdAt: Date;
    logoImage: unknown;
    _count: { memberships: number };
  },
  myRole: string | null,
  myUserId?: string,
): TeamDTO {
  return {
    id: team.id,
    name: team.name,
    slug: team.slug,
    description: team.description,
    visibility: team.visibility,
    memberCount: team._count.memberships,
    myRole,
    isOwner: myUserId != null ? team.ownerId === myUserId : undefined,
    createdAt: team.createdAt.toISOString(),
    hasLogo: team.logoImage != null,
  };
}

export async function createTeam(
  ownerId: string,
  input: CreateTeamInput,
  ipAddress?: string,
): Promise<TeamDTO> {
  let slug: string;
  if (input.slug) {
    // Explicit slug: the coach chose it, so a collision is a 409.
    const taken = await db.team.findUnique({ where: { slug: input.slug } });
    if (taken) throw conflict("SLUG_TAKEN", "That team URL is already taken");
    slug = input.slug;
  } else {
    // Auto-generated slug: disambiguate silently with a suffix.
    const base = slugify(input.name);
    slug = base;
    for (let attempt = 0; attempt < 5 && await db.team.findUnique({ where: { slug } }); attempt++) {
      slug = `${base}-${nanoid(6).toLowerCase()}`;
    }
    if (await db.team.findUnique({ where: { slug } })) {
      throw conflict("SLUG_TAKEN", "Could not generate a unique team URL");
    }
  }

  const teamId = await db.$transaction(async (tx) => {
    const created = await tx.team.create({
      data: {
        name: input.name.trim(),
        slug,
        description: input.description?.trim() || null,
        visibility: input.visibility,
        ownerId,
      },
    });
    await tx.teamMembership.create({
      data: { teamId: created.id, userId: ownerId, role: "COACH", status: "ACTIVE" },
    });
    return created.id;
  });

  // Default channels: announcements + team chat.
  await ensureTeamConversations(teamId, ownerId);

  // Re-fetch so _count reflects the just-created membership.
  const team = await db.team.findUniqueOrThrow({
    where: { id: teamId },
    include: { _count: { select: { memberships: true } } },
  });

  await audit({
    actorId: ownerId,
    action: "TEAM_CREATED",
    entityType: "Team",
    entityId: team.id,
    metadata: { name: team.name, slug: team.slug },
    ipAddress,
  });

  return toTeamDTO(team, "COACH", ownerId);
}

export async function listMyTeams(userId: string): Promise<TeamDTO[]> {
  const memberships = await db.teamMembership.findMany({
    where: { userId, status: "ACTIVE" },
    include: {
      team: { include: { _count: { select: { memberships: true } } } },
    },
    orderBy: { joinedAt: "desc" },
  });
  return memberships.map((m) => toTeamDTO(m.team, m.role, userId));
}

export async function getTeam(userId: string, teamId: string): Promise<TeamDTO> {
  const membership = await activeMembership(userId, teamId);
  const team = await db.team.findUnique({
    where: { id: teamId },
    include: { _count: { select: { memberships: true } } },
  });
  // activeMembership already 404s for non-members, so team exists here.
  return toTeamDTO(team!, membership.role, userId);
}

export async function updateTeam(
  userId: string,
  teamId: string,
  input: UpdateTeamInput,
  ipAddress?: string,
): Promise<TeamDTO> {
  const membership = await activeMembership(userId, teamId);
  requireManager(membership);

  if (input.slug) {
    const clash = await db.team.findUnique({ where: { slug: input.slug } });
    if (clash && clash.id !== teamId) {
      throw conflict("SLUG_TAKEN", "That team URL is already taken");
    }
  }

  const team = await db.team.update({
    where: { id: teamId },
    data: {
      name: input.name?.trim(),
      slug: input.slug,
      description:
        input.description === undefined ? undefined : input.description?.trim() || null,
      visibility: input.visibility,
    },
    include: { _count: { select: { memberships: true } } },
  });

  await audit({
    actorId: userId,
    action: "TEAM_UPDATED",
    entityType: "Team",
    entityId: team.id,
    metadata: { fields: Object.keys(input) },
    ipAddress,
  });

  return toTeamDTO(team, membership.role, userId);
}

export async function getRoster(
  userId: string,
  teamId: string,
): Promise<RosterMemberDTO[]> {
  const membership = await activeMembership(userId, teamId);
  const showEmails = canSeeEmails(membership);

  const members = await db.teamMembership.findMany({
    where: { teamId, status: "ACTIVE" },
    include: {
      user: {
        select: {
          id: true,
          displayName: true,
          email: true,
          profile: {
            select: { phone: true, emergencyName: true, emergencyPhone: true },
          },
        },
      },
    },
    orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
  });

  return members.map((m) => ({
    userId: m.user.id,
    displayName: m.user.displayName,
    ...(showEmails ? { email: m.user.email } : {}),
    // Contact info is manager-only, like emails.
    ...(showEmails
      ? {
          phone: m.user.profile?.phone ?? null,
          emergencyName: m.user.profile?.emergencyName ?? null,
          emergencyPhone: m.user.profile?.emergencyPhone ?? null,
        }
      : {}),
    role: m.role,
    status: m.status,
    joinedAt: m.joinedAt.toISOString(),
  }));
}

async function requireOwner(actorId: string, teamId: string) {
  const team = await db.team.findUniqueOrThrow({ where: { id: teamId } });
  if (team.ownerId !== actorId) {
    throw forbidden("Only the team owner can do this");
  }
  return team;
}

const ELEVATED_ROLES = ["COACH", "TEAM_ADMIN"] as const;

/** Change a member's role. Handing out (or taking away) coach/admin power needs the owner. */
export async function updateMemberRole(
  actorId: string,
  teamId: string,
  targetUserId: string,
  role: string,
  ipAddress?: string,
) {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);

  if (targetUserId === actorId) {
    throw forbidden("You can't change your own role");
  }

  const team = await db.team.findUniqueOrThrow({ where: { id: teamId } });
  if (team.ownerId === targetUserId) {
    throw forbidden("Transfer ownership before changing the owner's role");
  }

  const target = await db.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId: targetUserId } },
  });
  if (!target || target.status !== "ACTIVE") {
    throw notFound("Member not found");
  }
  if (target.role === role) return { ok: true as const, role };

  const touchesElevated =
    (ELEVATED_ROLES as readonly string[]).includes(role) ||
    (ELEVATED_ROLES as readonly string[]).includes(target.role);
  if (touchesElevated && team.ownerId !== actorId) {
    throw forbidden("Only the team owner can grant or remove coach access");
  }

  await db.teamMembership.update({
    where: { teamId_userId: { teamId, userId: targetUserId } },
    data: { role: role as (typeof target)["role"] },
  });

  await audit({
    actorId,
    action: "MEMBER_ROLE_CHANGED",
    entityType: "Team",
    entityId: teamId,
    metadata: { userId: targetUserId, from: target.role, to: role },
    ipAddress,
  });

  return { ok: true as const, role };
}

/** Remove a member from the team. Coaches/admins can only be removed by the owner. */
export async function removeMember(
  actorId: string,
  teamId: string,
  targetUserId: string,
  ipAddress?: string,
) {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);

  if (targetUserId === actorId) {
    throw forbidden("You can't remove yourself — use Leave team instead");
  }

  const team = await db.team.findUniqueOrThrow({ where: { id: teamId } });
  if (team.ownerId === targetUserId) {
    throw forbidden("The team owner can't be removed — transfer ownership first");
  }

  const target = await db.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId: targetUserId } },
  });
  if (!target || target.status !== "ACTIVE") {
    throw notFound("Member not found");
  }

  if (
    (ELEVATED_ROLES as readonly string[]).includes(target.role) &&
    team.ownerId !== actorId
  ) {
    throw forbidden("Only the team owner can remove a coach");
  }

  await db.teamMembership.update({
    where: { teamId_userId: { teamId, userId: targetUserId } },
    data: { status: "REMOVED" },
  });

  await audit({
    actorId,
    action: "MEMBER_REMOVED",
    entityType: "Team",
    entityId: teamId,
    metadata: { userId: targetUserId, role: target.role },
    ipAddress,
  });

  return { ok: true as const };
}

/** Hand team ownership to another member (owner only). The new owner becomes a coach. */
/**
 * A member leaves the team voluntarily. The owner must transfer ownership
 * first — a team is never left without an owner.
 */
export async function leaveTeam(
  actorId: string,
  teamId: string,
  ipAddress?: string,
): Promise<void> {
  const membership = await activeMembership(actorId, teamId);
  const team = await db.team.findUniqueOrThrow({ where: { id: teamId } });
  if (team.ownerId === actorId) {
    throw forbidden(
      "Transfer ownership to another coach before leaving the team",
    );
  }
  await db.teamMembership.update({
    where: { id: membership.id },
    data: { status: "REMOVED" },
  });
  const { audit } = await import("../../lib/audit.js");
  await audit({
    actorId,
    action: "MEMBER_LEFT",
    entityType: "Team",
    entityId: teamId,
    ipAddress,
  });
}

export async function transferTeam(
  actorId: string,
  teamId: string,
  newOwnerId: string,
  ipAddress?: string,
) {
  await requireOwner(actorId, teamId);

  if (newOwnerId === actorId) {
    throw conflict("ALREADY_OWNER", "You're already the team owner");
  }

  const target = await db.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId: newOwnerId } },
  });
  if (!target || target.status !== "ACTIVE") {
    throw notFound("The new owner must be an active team member");
  }

  await db.$transaction(async (tx) => {
    await tx.team.update({ where: { id: teamId }, data: { ownerId: newOwnerId } });
    if (target.role !== "COACH" && target.role !== "TEAM_ADMIN") {
      await tx.teamMembership.update({
        where: { teamId_userId: { teamId, userId: newOwnerId } },
        data: { role: "COACH" },
      });
    }
  });

  await audit({
    actorId,
    action: "TEAM_OWNERSHIP_TRANSFERRED",
    entityType: "Team",
    entityId: teamId,
    metadata: { from: actorId, to: newOwnerId },
    ipAddress,
  });

  return { ok: true as const, newOwnerId };
}

// ---------------------------------------------------------------------------
// Team logo (stored in the DB — logos are small and one per team)
// ---------------------------------------------------------------------------

const LOGO_DATA_URL_RE = /^data:image\/(jpeg|png|webp);base64,/;
const MAX_LOGO_BYTES = 500_000;

export async function setTeamLogo(
  actorId: string,
  teamId: string,
  image: string,
  ipAddress?: string,
): Promise<{ ok: true }> {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);

  const match = image.match(LOGO_DATA_URL_RE);
  if (!match) throw new AppError(400, "BAD_REQUEST", "Invalid image data URL");
  const buf = Buffer.from(image.slice(match[0].length), "base64");
  if (buf.length === 0 || buf.length > MAX_LOGO_BYTES) {
    throw new AppError(400, "BAD_REQUEST", "Image is too large");
  }
  // Cheap magic-byte check so a text blob can't be stored as an image.
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50;
  const isWebp = buf[0] === 0x52 && buf[1] === 0x49; // "RI"
  if (!isJpeg && !isPng && !isWebp) throw new AppError(400, "BAD_REQUEST", "Not a valid image");

  await db.team.update({
    where: { id: teamId },
    data: { logoImage: buf, logoMime: `image/${match[1]}` },
  });

  await audit({
    actorId,
    action: "TEAM_LOGO_SET",
    entityType: "Team",
    entityId: teamId,
    ipAddress,
  });
  return { ok: true as const };
}

export async function removeTeamLogo(
  actorId: string,
  teamId: string,
  ipAddress?: string,
): Promise<{ ok: true }> {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);
  await db.team.update({
    where: { id: teamId },
    data: { logoImage: null, logoMime: null },
  });
  await audit({
    actorId,
    action: "TEAM_LOGO_REMOVED",
    entityType: "Team",
    entityId: teamId,
    ipAddress,
  });
  return { ok: true as const };
}

export async function getTeamLogo(
  userId: string,
  teamId: string,
): Promise<{ image: Buffer; mime: string }> {
  await activeMembership(userId, teamId);
  const team = await db.team.findUnique({
    where: { id: teamId },
    select: { logoImage: true, logoMime: true },
  });
  if (!team?.logoImage || !team.logoMime) throw notFound("No team logo");
  return { image: team.logoImage as Buffer, mime: team.logoMime };
}
