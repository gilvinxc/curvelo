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

  // Verified link → PARENT membership on the athlete's teams.
  await syncParentMemberships(actorId, invite.athleteId);

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

  // Revoked link → drop PARENT memberships that no longer have a link behind them.
  await syncParentMemberships(link.guardianId, link.athleteId);
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

/** Verified guardian link or 403. Every guardian capability requires this. */
async function verifiedLinkOrThrow(guardianId: string, athleteId: string) {
  const link = await db.guardianLink.findUnique({
    where: { guardianId_athleteId: { guardianId, athleteId } },
    include: { athlete: { select: { displayName: true } } },
  });
  if (!link || link.status !== "VERIFIED") {
    throw forbidden("You are not a verified guardian of this athlete");
  }
  return link;
}

export type LogForChildInput = {
  teamId?: string;
  kind: string;
  title?: string;
  startedAt: string;
  distanceM?: number | null;
  durationS?: number | null;
  avgHrBpm?: number | null;
  maxHrBpm?: number | null;
  effortRpe?: number | null;
  calories?: number | null;
  steps?: number | null;
  elevationGainM?: number | null;
  avgCadenceSpm?: number | null;
  city?: string;
  terrain?: string;
  visibility?: string;
  notes?: string;
  shoeId?: string | null;
};

/**
 * A verified guardian logs an activity on behalf of their linked athlete.
 * The run belongs to the child; loggedBy records the guardian. The athlete
 * gets a notification to review it. Guardians can never log for athletes
 * they aren't linked to.
 */
export async function logActivityForChild(
  guardianId: string,
  athleteId: string,
  input: LogForChildInput,
  ipAddress?: string,
) {
  const link = await verifiedLinkOrThrow(guardianId, athleteId);

  // Team context must be one of the athlete's active teams — the guardian's
  // own memberships are irrelevant (they have none).
  let teamId: string | null = null;
  if (input.teamId) {
    const membership = await db.teamMembership.findUnique({
      where: { teamId_userId: { teamId: input.teamId, userId: athleteId } },
    });
    if (!membership || membership.status !== "ACTIVE") {
      throw new AppError(422, "INVALID_TEAM", "That team isn't one of this athlete's teams.");
    }
    teamId = input.teamId;
  }

  const { createActivity } = await import("../activities/service.js");
  const activity = await createActivity(
    guardianId,
    {
      ...input,
      teamId: teamId ?? undefined,
      // Guardians log TEAM-visible or PRIVATE runs for their kid — never
      // anything the visibility rules don't already allow.
      visibility: input.visibility === "PRIVATE" ? "PRIVATE" : "TEAM",
    } as Parameters<typeof createActivity>[1],
    ipAddress,
    undefined,
    { userId: athleteId, loggedByUserId: guardianId },
  );

  const guardian = await db.user.findUnique({
    where: { id: guardianId },
    select: { displayName: true },
  });
  await db.notification.create({
    data: {
      userId: athleteId,
      type: "ACTIVITY_LOGGED_BY_GUARDIAN",
      title: `${guardian?.displayName ?? "Your parent"} logged a run for you`,
      body: "Review it in your activity history — it's your log.",
      link: `/activities/${activity.id}`,
    },
  });

  await audit({
    actorId: guardianId,
    action: "ACTIVITY_LOGGED_FOR_CHILD",
    entityType: "Activity",
    entityId: activity.id,
    metadata: { athleteId, athleteName: link.athlete.displayName },
    ipAddress,
  });
  return activity;
}

/**
 * Merged family calendar: every linked athlete's upcoming assignments, their
 * teams' events, and their personal training-plan days — each item labeled
 * with the kid it belongs to.
 */
export async function familyCalendar(
  guardianId: string,
  from: string,
  to: string,
): Promise<import("@curvelo/shared").FamilyCalendarItemDTO[]> {
  const links = await db.guardianLink.findMany({
    where: { guardianId, status: "VERIFIED" },
    include: {
      athlete: {
        select: {
          id: true,
          displayName: true,
          memberships: {
            where: { status: "ACTIVE" },
            select: {
              teamId: true,
              team: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });

  const fromDate = new Date(from + "T00:00:00Z");
  const toDate = new Date(to + "T23:59:59Z");
  const dayOf = (d: Date) => d.toISOString().slice(0, 10);
  const items: import("@curvelo/shared").FamilyCalendarItemDTO[] = [];
  const seenTeams = new Map<string, { id: string; name: string }>();

  for (const link of links) {
    const athlete = link.athlete;
    for (const m of athlete.memberships) {
      seenTeams.set(m.teamId, m.team);
      const assignments = await db.workoutAssignment.findMany({
        where: {
          teamId: m.teamId,
          scheduledDate: { gte: fromDate, lte: toDate },
          OR: [
            { assignedToUserId: athlete.id },
            { assignedToUserId: null, groupId: null },
            { group: { members: { some: { userId: athlete.id } } } },
          ],
        },
        include: { workout: { select: { title: true } } },
        orderBy: { scheduledDate: "asc" },
      });
      for (const a of assignments) {
        items.push({
          kind: "assignment",
          date: dayOf(a.scheduledDate),
          title: a.workout.title,
          detail: a.notes,
          teamId: m.teamId,
          teamName: m.team.name,
          athleteId: athlete.id,
          athleteName: athlete.displayName,
        });
      }
    }

    // Personal training-plan days (applied plans only).
    const { appliedPlanDays } = await import("../personal-plans/service.js");
    const planDays = await appliedPlanDays(athlete.id, from, to);
    for (const d of planDays) {
      items.push({
        kind: "plan",
        date: d.date.slice(0, 10),
        title: d.planName,
        detail: d.title ?? null,
        teamId: null,
        teamName: null,
        athleteId: athlete.id,
        athleteName: athlete.displayName,
      });
    }
  }

  // Team events for every team with a linked athlete (deduped across kids).
  for (const team of seenTeams.values()) {
    const events = await db.teamEvent.findMany({
      where: { teamId: team.id },
      orderBy: { startAt: "asc" },
    });
    for (const e of events) {
      const start = new Date(e.startAt);
      if (start < fromDate || start > toDate) continue;
      // Attribute to each linked athlete on this team.
      for (const link of links) {
        if (!link.athlete.memberships.some((m) => m.teamId === team.id)) continue;
        items.push({
          kind: "event",
          date: dayOf(start),
          title: e.title,
          detail: e.description,
          teamId: team.id,
          teamName: team.name,
          athleteId: link.athlete.id,
          athleteName: link.athlete.displayName,
        });
      }
    }
  }

  return items.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

/** Teams where the guardian holds a PARENT membership (feed access). */
export async function guardianTeams(guardianId: string) {
  const memberships = await db.teamMembership.findMany({
    where: { userId: guardianId, role: "PARENT", status: "ACTIVE" },
    include: { team: { select: { id: true, name: true } } },
  });
  const teams = new Map<string, { id: string; name: string; athletes: string[] }>();
  for (const m of memberships) {
    if (!teams.has(m.team.id)) {
      teams.set(m.team.id, { ...m.team, athletes: [] });
    }
  }
  // Athlete names per team, from verified links.
  const links = await db.guardianLink.findMany({
    where: { guardianId, status: "VERIFIED" },
    include: {
      athlete: {
        select: {
          displayName: true,
          memberships: {
            where: { status: "ACTIVE" },
            select: { teamId: true },
          },
        },
      },
    },
  });
  for (const link of links) {
    for (const m of link.athlete.memberships) {
      const t = teams.get(m.teamId);
      if (t && !t.athletes.includes(link.athlete.displayName)) {
        t.athletes.push(link.athlete.displayName);
      }
    }
  }
  return [...teams.values()];
}

/** Grant or revoke photo-sharing consent for a linked athlete. */
export async function setPhotoConsent(
  guardianId: string,
  athleteId: string,
  granted: boolean,
  ipAddress?: string,
): Promise<{ granted: boolean }> {
  await verifiedLinkOrThrow(guardianId, athleteId);
  const { grantPhotoConsent, revokePhotoConsent } = await import("../../lib/photoConsent.js");
  if (granted) await grantPhotoConsent(guardianId, athleteId, ipAddress);
  else await revokePhotoConsent(guardianId, athleteId, ipAddress);
  return { granted };
}

/** Photo-consent status for each linked athlete (for the family page). */
export async function photoConsentStatus(guardianId: string) {
  const links = await db.guardianLink.findMany({
    where: { guardianId, status: "VERIFIED" },
    select: { athleteId: true },
  });
  const { hasPhotoConsent } = await import("../../lib/photoConsent.js");
  const out: Array<{ athleteId: string; granted: boolean }> = [];
  for (const link of links) {
    out.push({ athleteId: link.athleteId, granted: await hasPhotoConsent(link.athleteId) });
  }
  return out;
}

/**
 * Parent team memberships.
 *
 * When a GuardianLink is verified, the guardian gets an ACTIVE PARENT
 * membership on every team where the athlete is an active member. Feed
 * access, commenting, reactions, and photo sharing all flow from that
 * membership — there is no separate guardian-access path.
 *
 * Reconciles in both directions:
 * - ensure PARENT membership for every team where the athlete is active
 *   (never touches a real COACH/RUNNER/etc. membership the guardian holds)
 * - remove PARENT memberships for teams where the athlete is no longer
 *   active, unless the guardian has another verified-linked athlete there
 *
 * Call after: link verified, link revoked, athlete joins/leaves a team.
 */
export async function syncParentMemberships(guardianId: string, athleteId: string) {
  // The link is the authority: no verified link, no parent memberships.
  const verifiedLink = await db.guardianLink.findUnique({
    where: { guardianId_athleteId: { guardianId, athleteId } },
    select: { status: true },
  });
  const hasLink = verifiedLink?.status === "VERIFIED";

  const athleteTeams = hasLink
    ? await db.teamMembership.findMany({
        where: { userId: athleteId, status: "ACTIVE" },
        select: { teamId: true },
      })
    : [];
  const athleteTeamIds = new Set(athleteTeams.map((t) => t.teamId));

  for (const teamId of athleteTeamIds) {
    const existing = await db.teamMembership.findUnique({
      where: { teamId_userId: { teamId, userId: guardianId } },
    });
    if (!existing) {
      await db.teamMembership.create({
        data: { teamId, userId: guardianId, role: "PARENT", status: "ACTIVE" },
      });
      await audit({
        actorId: guardianId,
        action: "PARENT_MEMBERSHIP_GRANTED",
        entityType: "Team",
        entityId: teamId,
        metadata: { athleteId, via: "guardian-link" },
      });
    } else if (existing.role === "PARENT" && existing.status !== "ACTIVE") {
      await db.teamMembership.update({
        where: { id: existing.id },
        data: { status: "ACTIVE" },
      });
    }
    // A guardian who is also a coach/runner/etc. keeps their real role.
  }

  const parentMemberships = await db.teamMembership.findMany({
    where: { userId: guardianId, role: "PARENT", status: "ACTIVE" },
    select: { id: true, teamId: true },
  });
  for (const pm of parentMemberships) {
    if (athleteTeamIds.has(pm.teamId)) continue;
    const otherLink = await db.guardianLink.findFirst({
      where: {
        guardianId,
        status: "VERIFIED",
        NOT: { athleteId },
        athlete: {
          memberships: { some: { teamId: pm.teamId, status: "ACTIVE" } },
        },
      },
      select: { id: true },
    });
    if (!otherLink) {
      await db.teamMembership.update({
        where: { id: pm.id },
        data: { status: "REMOVED" },
      });
      await audit({
        actorId: guardianId,
        action: "PARENT_MEMBERSHIP_REMOVED",
        entityType: "Team",
        entityId: pm.teamId,
        metadata: { athleteId, via: "guardian-link" },
      });
    }
  }
}

/** Sync parent memberships for every verified guardian of an athlete. */
export async function syncAthleteGuardians(athleteId: string) {
  const links = await db.guardianLink.findMany({
    where: { athleteId, status: "VERIFIED" },
    select: { guardianId: true },
  });
  for (const link of links) {
    await syncParentMemberships(link.guardianId, athleteId);
  }
}
