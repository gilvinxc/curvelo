import type {
  ActivityDTO,
  ActivityStatsDTO,
  AssignmentDTO,
  AthleteViewDTO,
  CreateActivityInput,
  UpdateActivityInput,
} from "@curvelo/shared";
import { db } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { forbidden, notFound } from "../../lib/errors.js";
import {
  activeMembership,
  requireManager,
} from "../../lib/permissions.js";

export type ActivityWithJoins = {
  id: string;
  userId: string;
  teamId: string | null;
  assignmentId: string | null;
  kind: string;
  title: string | null;
  startedAt: Date;
  distanceM: number | null;
  durationS: number | null;
  avgPaceS: number | null;
  avgHrBpm: number | null;
  maxHrBpm: number | null;
  effortRpe: number | null;
  calories: number | null;
  notes: string | null;
  source: string;
  visibility: string;
  user: { displayName: string };
  team: { name: string } | null;
};

const WITH_JOINS = {
  user: { select: { displayName: true } },
  team: { select: { name: true } },
} as const;

export const ACTIVITY_WITH_JOINS = WITH_JOINS;

export function toActivityDTO(a: ActivityWithJoins): ActivityDTO {
  return {
    id: a.id,
    userId: a.userId,
    userName: a.user.displayName,
    teamId: a.teamId,
    teamName: a.team?.name ?? null,
    assignmentId: a.assignmentId,
    kind: a.kind,
    title: a.title,
    startedAt: a.startedAt.toISOString(),
    distanceM: a.distanceM,
    durationS: a.durationS,
    avgPaceS: a.avgPaceS,
    avgHrBpm: a.avgHrBpm,
    maxHrBpm: a.maxHrBpm,
    effortRpe: a.effortRpe,
    calories: a.calories,
    notes: a.notes,
    source: a.source,
    visibility: a.visibility,
  };
}

function avgPaceS(
  distanceM: number | undefined,
  durationS: number | undefined | null,
): number | null {
  if (distanceM && durationS) return Math.round((durationS / distanceM) * 1000 * 10) / 10;
  return null;
}

/** Default activity visibility follows the user's own sharing preference. */
async function defaultVisibility(userId: string): Promise<"PRIVATE" | "TEAM"> {
  const profile = await db.profile.findUnique({
    where: { userId },
    select: { defaultShareLevel: true },
  });
  const level = profile?.defaultShareLevel ?? "SUMMARY";
  return level === "FULL" || level === "SUMMARY" ? "TEAM" : "PRIVATE";
}

/**
 * Can this user view this activity? Owner always; a coach/team admin of the
 * activity's team when visibility is TEAM. Everyone else gets a 404.
 */
async function canView(
  actorId: string,
  activity: { userId: string; teamId: string | null; visibility: string },
): Promise<boolean> {
  if (activity.userId === actorId) return true;
  if (activity.visibility !== "TEAM" || !activity.teamId) return false;
  const membership = await activeMembership(actorId, activity.teamId).catch(
    () => null,
  );
  return (
    !!membership &&
    (membership.role === "COACH" || membership.role === "TEAM_ADMIN")
  );
}

/** Assignment must be one the actor could see on their calendar. */
async function assertAssignmentVisible(
  actorId: string,
  assignmentId: string,
): Promise<{ teamId: string }> {
  const assignment = await db.workoutAssignment.findUnique({
    where: { id: assignmentId },
    select: { id: true, teamId: true, assignedToUserId: true, groupId: true },
  });
  if (!assignment) throw notFound("Assignment not found");
  await activeMembership(actorId, assignment.teamId);

  const visible =
    assignment.assignedToUserId === actorId ||
    (assignment.assignedToUserId === null && assignment.groupId === null) ||
    (assignment.groupId !== null &&
      (await db.teamGroupMember.count({
        where: { groupId: assignment.groupId, userId: actorId },
      })) > 0);
  if (!visible) throw forbidden("You cannot log against that assignment");
  return { teamId: assignment.teamId };
}

export async function createActivity(
  actorId: string,
  input: CreateActivityInput,
  ipAddress?: string,
  provenance?: { source: "FILE_IMPORT"; externalId: string },
): Promise<ActivityDTO> {
  let teamId: string | null = null;
  if (input.teamId) {
    await activeMembership(actorId, input.teamId);
    teamId = input.teamId;
  }

  let assignmentId: string | null = null;
  if (input.assignmentId) {
    const { teamId: aTeam } = await assertAssignmentVisible(
      actorId,
      input.assignmentId,
    );
    assignmentId = input.assignmentId;
    // Log in the assignment's team context unless the caller chose another team.
    if (!teamId) teamId = aTeam;
  }

  const activity = await db.activity.create({
    data: {
      userId: actorId,
      teamId,
      assignmentId,
      kind: input.kind,
      title: input.title?.trim() || null,
      startedAt: new Date(input.startedAt),
      distanceM: input.distanceM,
      durationS: input.durationS,
      avgPaceS: avgPaceS(input.distanceM, input.durationS),
      avgHrBpm: input.avgHrBpm,
      maxHrBpm: input.maxHrBpm,
      effortRpe: input.effortRpe,
      calories: input.calories,
      notes: input.notes?.trim() || null,
      visibility: input.visibility ?? (await defaultVisibility(actorId)),
      source: provenance?.source ?? "MANUAL",
      externalId: provenance?.externalId ?? null,
    },
    include: WITH_JOINS,
  });

  await audit({
    actorId,
    action: "ACTIVITY_CREATED",
    entityType: "Activity",
    entityId: activity.id,
    metadata: {
      kind: activity.kind,
      distanceM: activity.distanceM,
      assignmentId,
    },
    ipAddress,
  });

  return toActivityDTO(activity);
}

export async function listMyActivities(
  actorId: string,
  from: string,
  to: string,
  teamId?: string,
): Promise<ActivityDTO[]> {
  const activities = await db.activity.findMany({
    where: {
      userId: actorId,
      startedAt: {
        gte: new Date(from + "T00:00:00Z"),
        lt: new Date(to + "T00:00:00Z"),
      },
      ...(teamId ? { teamId } : {}),
    },
    include: WITH_JOINS,
    orderBy: { startedAt: "desc" },
  });
  return activities.map(toActivityDTO);
}

export async function getActivity(
  actorId: string,
  activityId: string,
): Promise<ActivityDTO> {
  const activity = await db.activity.findUnique({
    where: { id: activityId },
    include: WITH_JOINS,
  });
  if (!activity || !(await canView(actorId, activity))) {
    throw notFound("Activity not found");
  }
  return toActivityDTO(activity);
}

export async function updateActivity(
  actorId: string,
  activityId: string,
  input: UpdateActivityInput,
  ipAddress?: string,
): Promise<ActivityDTO> {
  const existing = await db.activity.findUnique({
    where: { id: activityId },
  });
  if (!existing || existing.userId !== actorId) {
    throw notFound("Activity not found");
  }

  let teamId: string | null | undefined;
  if (input.teamId !== undefined) {
    if (input.teamId) {
      await activeMembership(actorId, input.teamId);
      teamId = input.teamId;
    } else {
      teamId = null;
    }
  }

  let assignmentId: string | null | undefined;
  if (input.assignmentId !== undefined) {
    if (input.assignmentId) {
      await assertAssignmentVisible(actorId, input.assignmentId);
      assignmentId = input.assignmentId;
    } else {
      assignmentId = null;
    }
  }

  const distanceM = input.distanceM ?? existing.distanceM ?? undefined;
  const durationS = input.durationS ?? existing.durationS ?? undefined;

  const activity = await db.activity.update({
    where: { id: activityId },
    data: {
      kind: input.kind,
      title:
        input.title === undefined ? undefined : input.title?.trim() || null,
      startedAt: input.startedAt ? new Date(input.startedAt) : undefined,
      distanceM: input.distanceM,
      durationS: input.durationS,
      avgPaceS:
        input.distanceM !== undefined || input.durationS !== undefined
          ? avgPaceS(distanceM, durationS)
          : undefined,
      avgHrBpm: input.avgHrBpm,
      maxHrBpm: input.maxHrBpm,
      effortRpe: input.effortRpe,
      calories: input.calories,
      notes:
        input.notes === undefined ? undefined : input.notes?.trim() || null,
      teamId,
      assignmentId,
      visibility: input.visibility,
    },
    include: WITH_JOINS,
  });

  await audit({
    actorId,
    action: "ACTIVITY_UPDATED",
    entityType: "Activity",
    entityId: activityId,
    metadata: { fields: Object.keys(input) },
    ipAddress,
  });

  return toActivityDTO(activity);
}

export async function deleteActivity(
  actorId: string,
  activityId: string,
  ipAddress?: string,
): Promise<void> {
  const existing = await db.activity.findUnique({
    where: { id: activityId },
  });
  if (!existing || existing.userId !== actorId) {
    throw notFound("Activity not found");
  }
  await db.activity.delete({ where: { id: activityId } });
  await audit({
    actorId,
    action: "ACTIVITY_DELETED",
    entityType: "Activity",
    entityId: activityId,
    ipAddress,
  });
}

export async function myStats(
  actorId: string,
  from: string,
  to: string,
): Promise<ActivityStatsDTO> {
  const agg = await db.activity.aggregate({
    where: {
      userId: actorId,
      startedAt: {
        gte: new Date(from + "T00:00:00Z"),
        lt: new Date(to + "T00:00:00Z"),
      },
    },
    _count: true,
    _sum: { distanceM: true, durationS: true },
  });
  const totalDistanceM = agg._sum.distanceM ?? 0;
  const totalDurationS = agg._sum.durationS ?? 0;
  return {
    count: agg._count,
    totalDistanceM: Math.round(totalDistanceM),
    totalDurationS,
    avgPaceS:
      totalDistanceM > 0 && totalDurationS > 0
        ? Math.round((totalDurationS / totalDistanceM) * 1000 * 10) / 10
        : null,
  };
}

/**
 * Coach view of one athlete: profile, recent stats, recent activities
 * (TEAM-visible), and upcoming assignments. Coaches/admins only.
 */
export async function athleteView(
  actorId: string,
  teamId: string,
  userId: string,
): Promise<AthleteViewDTO> {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);

  const target = await db.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId } },
    include: { user: { select: { displayName: true } } },
  });
  if (!target || target.status !== "ACTIVE") {
    throw notFound("Athlete not found");
  }

  const since = new Date();
  since.setDate(since.getDate() - 28);

  const [recent, upcoming] = await Promise.all([
    db.activity.findMany({
      where: {
        userId,
        teamId,
        visibility: "TEAM",
        startedAt: { gte: since },
      },
      include: WITH_JOINS,
      orderBy: { startedAt: "desc" },
      take: 20,
    }),
    db.workoutAssignment.findMany({
      where: {
        teamId,
        scheduledDate: { gte: new Date(new Date().toISOString().slice(0, 10)) },
        OR: [
          { assignedToUserId: userId },
          { assignedToUserId: null, groupId: null },
          {
            group: {
              members: { some: { userId } },
            },
          },
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
      take: 14,
    }),
  ]);

  const totalDistanceM = recent.reduce((s, a) => s + (a.distanceM ?? 0), 0);
  const totalDurationS = recent.reduce((s, a) => s + (a.durationS ?? 0), 0);

  return {
    userId,
    displayName: target.user.displayName,
    role: target.role,
    stats: {
      count: recent.length,
      totalDistanceM: Math.round(totalDistanceM),
      totalDurationS,
      avgPaceS:
        totalDistanceM > 0 && totalDurationS > 0
          ? Math.round((totalDurationS / totalDistanceM) * 1000 * 10) / 10
          : null,
    },
    recentActivities: recent.map(toActivityDTO),
    upcomingAssignments: upcoming.map((a) => ({
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
    })),
  };
}

/**
 * Activities to merge into a calendar response.
 * - Team calendar: coaches see TEAM-visible activities of team athletes;
 *   runners see only their own.
 * - Personal calendar (teamId null): the actor's own activities.
 */
export async function calendarActivities(
  actorId: string,
  teamId: string | null,
  from: string,
  to: string,
  isManager: boolean,
): Promise<ActivityDTO[]> {
  const range = {
    gte: new Date(from + "T00:00:00Z"),
    lte: new Date(to + "T00:00:00Z"),
  };

  const where =
    teamId === null
      ? { userId: actorId, startedAt: range }
      : isManager
        ? { teamId, visibility: "TEAM", startedAt: range }
        : { teamId, userId: actorId, startedAt: range };

  const activities = await db.activity.findMany({
    where,
    include: WITH_JOINS,
    orderBy: { startedAt: "asc" },
  });
  return activities.map(toActivityDTO);
}
