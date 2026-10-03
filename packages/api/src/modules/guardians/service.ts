import { nanoid } from "nanoid";
import type {
  AcceptGuardianInviteInput,
  AssignmentDTO,
  ChildSummaryDTO,
  ConsentDTO,
  GuardianInviteDTO,
  GuardianLinkDTO,
  InviteGuardianInput,
} from "@curvelo/shared";
import { db } from "../../db.js";
import { config } from "../../config.js";
import { audit } from "../../lib/audit.js";
import { AppError, conflict, forbidden, notFound } from "../../lib/errors.js";
import {
  activeMembership,
  requireManager,
} from "../../lib/permissions.js";
import { ageToday } from "../../lib/compliance.js";
import {
  ACTIVITY_WITH_JOINS,
  toActivityDTO,
} from "../activities/service.js";

export const CONSENT_REQUIRED_TYPES = ["PARTICIPATION", "DATA_SHARING"] as const;

/** Consent is required for minors; unknown age errs toward required. */
export function consentRequiredFor(dateOfBirth: Date | null): boolean {
  const age = ageToday(dateOfBirth);
  return age === null || age < 18;
}

type InviteWithJoins = {
  id: string;
  teamId: string;
  athleteId: string;
  email: string;
  relationship: string;
  status: string;
  expiresAt: Date;
  token: string;
  team: { name: string };
  athlete: { displayName: string };
};

function toInviteDTO(inv: InviteWithJoins, includeToken: boolean): GuardianInviteDTO {
  return {
    id: inv.id,
    teamId: inv.teamId,
    teamName: inv.team.name,
    athleteId: inv.athleteId,
    athleteName: inv.athlete.displayName,
    email: inv.email,
    relationship: inv.relationship,
    status: inv.status,
    expiresAt: inv.expiresAt.toISOString(),
    ...(includeToken ? { token: inv.token } : {}),
  };
}

const INVITE_INCLUDE = {
  team: { select: { name: true } },
  athlete: { select: { displayName: true } },
} as const;

async function getValidInvite(token: string) {
  const invite = await db.guardianInvite.findUnique({
    where: { token },
    include: INVITE_INCLUDE,
  });
  if (!invite) throw notFound("Invitation not found");
  if (invite.status === "PENDING" && invite.expiresAt < new Date()) {
    await db.guardianInvite.update({
      where: { id: invite.id },
      data: { status: "EXPIRED" },
    });
    throw new AppError(410, "INVITE_EXPIRED", "This invitation has expired");
  }
  if (invite.status !== "PENDING") {
    throw new AppError(409, "INVITE_USED", "This invitation is no longer valid");
  }
  return invite;
}

export async function inviteGuardian(
  actorId: string,
  teamId: string,
  athleteId: string,
  input: InviteGuardianInput,
  ipAddress?: string,
): Promise<GuardianInviteDTO> {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);

  const athlete = await db.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId: athleteId } },
    include: { user: { select: { displayName: true, email: true } } },
  });
  if (!athlete || athlete.status !== "ACTIVE") {
    throw notFound("Athlete not found");
  }

  const email = input.email.toLowerCase().trim();
  if (email === athlete.user.email.toLowerCase()) {
    throw new AppError(422, "SELF_INVITE", "An athlete cannot be their own guardian");
  }

  // One active link or pending invite per email+athlete.
  const existingLink = await db.guardianLink.findFirst({
    where: {
      athleteId,
      status: { in: ["PENDING", "VERIFIED"] },
      guardian: { email },
    },
  });
  if (existingLink) {
    throw conflict("GUARDIAN_EXISTS", "That email is already linked to this athlete");
  }
  const pendingInvite = await db.guardianInvite.findFirst({
    where: { athleteId, email, status: "PENDING" },
  });
  if (pendingInvite) {
    throw conflict("INVITE_PENDING", "An invitation is already pending for that email");
  }

  const invite = await db.guardianInvite.create({
    data: {
      teamId,
      athleteId,
      email,
      relationship: input.relationship,
      token: nanoid(32),
      expiresAt: new Date(Date.now() + config.invitationTtlHours * 3600 * 1000),
      createdById: actorId,
    },
    include: INVITE_INCLUDE,
  });

  await audit({
    actorId,
    action: "GUARDIAN_INVITED",
    entityType: "GuardianInvite",
    entityId: invite.id,
    metadata: { teamId, athleteId, email },
    ipAddress,
  });

  return toInviteDTO(invite, true);
}

/** Public preview — no auth, but reveals only what the invitee needs. */
export async function previewInvite(token: string): Promise<GuardianInviteDTO> {
  const invite = await getValidInvite(token);
  return toInviteDTO(invite, false);
}

export async function acceptInvite(
  actorId: string,
  token: string,
  input: AcceptGuardianInviteInput,
  ipAddress?: string,
): Promise<GuardianLinkDTO> {
  const invite = await getValidInvite(token);

  const user = await db.user.findUnique({ where: { id: actorId } });
  if (!user || user.email.toLowerCase() !== invite.email.toLowerCase()) {
    // Bound to the invited email — prevents invite stealing.
    throw forbidden("This invitation was sent to a different email address");
  }

  const link = await db.$transaction(async (tx) => {
    const existing = await tx.guardianLink.findUnique({
      where: { guardianId_athleteId: { guardianId: actorId, athleteId: invite.athleteId } },
    });
    let linked;
    if (existing) {
      linked = await tx.guardianLink.update({
        where: { id: existing.id },
        data: { status: "VERIFIED", verifiedAt: new Date(), relationship: invite.relationship },
      });
    } else {
      linked = await tx.guardianLink.create({
        data: {
          guardianId: actorId,
          athleteId: invite.athleteId,
          relationship: invite.relationship,
          status: "VERIFIED",
          verifiedAt: new Date(),
        },
      });
    }
    for (const type of input.consents) {
      await tx.consent.upsert({
        where: {
          athleteId_guardianId_type: { athleteId: invite.athleteId, guardianId: actorId, type },
        },
        create: {
          athleteId: invite.athleteId,
          guardianId: actorId,
          teamId: invite.teamId,
          type,
          status: "GRANTED",
        },
        update: { status: "GRANTED", grantedAt: new Date(), revokedAt: null },
      });
    }
    await tx.guardianInvite.update({
      where: { id: invite.id },
      data: { status: "ACCEPTED" },
    });
    return linked;
  });

  await audit({
    actorId,
    action: "GUARDIAN_LINKED",
    entityType: "GuardianLink",
    entityId: link.id,
    metadata: {
      athleteId: invite.athleteId,
      teamId: invite.teamId,
      consents: input.consents,
    },
    ipAddress,
  });

  const full = await db.guardianLink.findUniqueOrThrow({
    where: { id: link.id },
    include: {
      guardian: { select: { displayName: true, email: true } },
      athlete: { select: { displayName: true } },
    },
  });
  return {
    id: full.id,
    guardianId: full.guardianId,
    guardianName: full.guardian.displayName,
    guardianEmail: full.guardian.email,
    athleteId: full.athleteId,
    athleteName: full.athlete.displayName,
    relationship: full.relationship,
    status: full.status,
    verifiedAt: full.verifiedAt?.toISOString() ?? null,
  };
}

export async function listAthleteGuardians(
  actorId: string,
  teamId: string,
  athleteId: string,
): Promise<{ guardians: GuardianLinkDTO[]; consents: ConsentDTO[] }> {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);

  const target = await db.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId: athleteId } },
  });
  if (!target || target.status !== "ACTIVE") throw notFound("Athlete not found");

  const [links, consents] = await Promise.all([
    db.guardianLink.findMany({
      where: { athleteId, status: { in: ["PENDING", "VERIFIED"] } },
      include: {
        guardian: { select: { displayName: true, email: true } },
        athlete: { select: { displayName: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    db.consent.findMany({
      where: { athleteId, status: "GRANTED" },
      include: { guardian: { select: { displayName: true } } },
      orderBy: { grantedAt: "desc" },
    }),
  ]);

  return {
    guardians: links.map((l) => ({
      id: l.id,
      guardianId: l.guardianId,
      guardianName: l.guardian.displayName,
      guardianEmail: l.guardian.email,
      athleteId: l.athleteId,
      athleteName: l.athlete.displayName,
      relationship: l.relationship,
      status: l.status,
      verifiedAt: l.verifiedAt?.toISOString() ?? null,
    })),
    consents: consents.map((c) => ({
      type: c.type,
      status: c.status,
      grantedAt: c.grantedAt.toISOString(),
      guardianName: c.guardian.displayName,
    })),
  };
}

export async function revokeLink(
  actorId: string,
  linkId: string,
  ipAddress?: string,
): Promise<void> {
  const link = await db.guardianLink.findUnique({
    where: { id: linkId },
    include: {
      athlete: {
        select: {
          memberships: {
            where: { status: "ACTIVE" },
            select: { teamId: true, role: true },
          },
        },
      },
    },
  });
  if (!link || link.status === "REVOKED") throw notFound("Guardian link not found");

  // The guardian themselves, or a coach/admin of any team the athlete is on.
  const isGuardian = link.guardianId === actorId;
  let isManager = false;
  if (!isGuardian) {
    for (const m of link.athlete.memberships) {
      const mine = await activeMembership(actorId, m.teamId).catch(() => null);
      if (mine && (mine.role === "COACH" || mine.role === "TEAM_ADMIN")) {
        isManager = true;
        break;
      }
    }
  }
  if (!isGuardian && !isManager) {
    throw forbidden("You cannot revoke this link");
  }

  await db.$transaction(async (tx) => {
    await tx.guardianLink.update({
      where: { id: linkId },
      data: { status: "REVOKED" },
    });
    // Revoking the link revokes the consents granted through it.
    await tx.consent.updateMany({
      where: { athleteId: link.athleteId, guardianId: link.guardianId, status: "GRANTED" },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
  });

  await audit({
    actorId,
    action: "GUARDIAN_REVOKED",
    entityType: "GuardianLink",
    entityId: linkId,
    metadata: { athleteId: link.athleteId, byGuardian: isGuardian },
    ipAddress,
  });
}

/** Parent view: every athlete this user is a verified guardian of. */
export async function myChildren(actorId: string): Promise<ChildSummaryDTO[]> {
  const links = await db.guardianLink.findMany({
    where: { guardianId: actorId, status: "VERIFIED" },
    include: {
      athlete: {
        select: {
          id: true,
          displayName: true,
          dateOfBirth: true,
          memberships: {
            select: {
              role: true,
              status: true,
              team: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: "desc" },
          },
        },
      },
    },
  });

  const summaries: ChildSummaryDTO[] = [];
  for (const link of links) {
    const consents = await db.consent.findMany({
      where: {
        athleteId: link.athleteId,
        guardianId: actorId,
        status: "GRANTED",
      },
      include: { guardian: { select: { displayName: true } } },
    });

    // One summary per team the athlete is (or was) on. Removing a member
    // from a team never breaks the parent/child association — the child
    // stays visible, flagged inactive.
    const seenTeams = new Set<string>();
    const memberships = [...link.athlete.memberships].sort((a, b) =>
      a.status === "ACTIVE" ? -1 : b.status === "ACTIVE" ? 1 : 0,
    );
    for (const m of memberships) {
      if (seenTeams.has(m.team.id)) continue;
      seenTeams.add(m.team.id);
      const teamActive = m.status === "ACTIVE";
      const teamId = m.team.id;
      const today = new Date().toISOString().slice(0, 10);
      const upcoming = await db.workoutAssignment.findMany({
        where: {
          teamId,
          scheduledDate: { gte: new Date(today + "T00:00:00Z") },
          OR: [
            { assignedToUserId: link.athleteId },
            { assignedToUserId: null, groupId: null },
            { group: { members: { some: { userId: link.athleteId } } } },
          ],
        },
        include: {
          createdBy: { select: { displayName: true } },
          workout: { select: { title: true, kind: true } },
          team: { select: { name: true } },
          group: { select: { name: true } },
          assignedToUser: { select: { displayName: true } },
        },
        orderBy: { scheduledDate: "asc" },
        take: 10,
      });
      const recent = await db.activity.findMany({
        where: { userId: link.athleteId, teamId, visibility: "TEAM" },
        include: ACTIVITY_WITH_JOINS,
        orderBy: { startedAt: "desc" },
        take: 10,
      });

      const upcomingDTOs: AssignmentDTO[] = upcoming.map((a) => ({
        id: a.id,
        workoutId: a.workoutId,
        workoutTitle: a.workout.title,
        workoutKind: a.workout.kind,
        teamId,
        teamName: a.team.name,
        groupId: a.groupId,
        groupName: a.group?.name ?? null,
        assignedToUserId: a.assignedToUserId,
        assignedToName: a.assignedToUser?.displayName ?? null,
        scheduledDate: a.scheduledDate.toISOString().slice(0, 10),
        notes: a.notes,
        needsApproval: a.needsApproval,
        createdByName: a.createdBy.displayName,
      }));

      summaries.push({
        athleteId: link.athleteId,
        athleteName: link.athlete.displayName,
        teamId,
        teamName: m.team.name,
        teamActive,
        role: m.role,
        consentRequired: consentRequiredFor(link.athlete.dateOfBirth),
        consents: consents.map((c) => ({
          type: c.type,
          status: c.status,
          grantedAt: c.grantedAt.toISOString(),
          guardianName: c.guardian.displayName,
        })),
        upcomingAssignments: upcomingDTOs,
        recentActivities: await Promise.all(recent.map((a) => toActivityDTO(a))),
      });
    }
  }
  return summaries;
}
