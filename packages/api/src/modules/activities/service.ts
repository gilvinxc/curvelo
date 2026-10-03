import type {
  ActivityDTO,
  ActivityTagDTO,
  ActivityStatsDTO,
  AssignmentDTO,
  AthleteViewDTO,
  CreateActivityInput,
  LogTeamRunInput,
  PaceRecordDTO,
  UpdateActivityInput,
} from "@curvelo/shared";
import { estimateCalories, estimateSteps } from "@curvelo/shared";
import { lookupWeather } from "../../lib/weather.js";
import { db } from "../../db.js";
import { canSeeRoute } from "./route.js";
import { mentionRefsFor, syncMentions } from "../../lib/mentions.js";
import { checkGoalCompletions } from "../goals/service.js";
import { assertOwnShoe, getDefaultShoeId } from "../records/service.js";
import { audit } from "../../lib/audit.js";
import { AppError, badRequest, forbidden, notFound } from "../../lib/errors.js";
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
  steps: number | null;
  elevationGainM: number | null;
  avgCadenceSpm: number | null;
  splits: { id: string; position: number; distanceM: number | null; durationS: number | null }[];
  city: string | null;
  cityLat: number | null;
  cityLon: number | null;
  terrain: string | null;
  weatherTempC: number | null;
  weatherCondition: string | null;
  notes: string | null;
  source: string;
  visibility: string;
  shoeId: string | null;
  loggedByUserId: string | null;
  user: { displayName: string };
  loggedBy: { displayName: string } | null;
  team: { name: string } | null;
  shoe: { name: string } | null;
  route: { id: string } | null;
};

const WITH_JOINS = {
  user: { select: { displayName: true } },
  loggedBy: { select: { displayName: true } },
  team: { select: { name: true } },
  shoe: { select: { name: true } },
  splits: { orderBy: { position: "asc" as const } },
  route: { select: { id: true } },
} as const;

export const ACTIVITY_WITH_JOINS = WITH_JOINS;

export async function toActivityDTO(
  a: ActivityWithJoins,
  opts?: { route?: Array<[number, number]> | null },
): Promise<ActivityDTO> {
  const mentions = await mentionRefsFor("ACTIVITY", [a.id]);
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
    steps: a.steps,
    elevationGainM: a.elevationGainM,
    avgCadenceSpm: a.avgCadenceSpm,
    splits: a.splits.map((sp) => ({
      id: sp.id,
      position: sp.position,
      distanceM: sp.distanceM,
      durationS: sp.durationS,
    })),
    city: a.city,
    cityLat: a.cityLat,
    cityLon: a.cityLon,
    terrain: a.terrain,
    weatherTempC: a.weatherTempC,
    weatherCondition: a.weatherCondition,
    notes: a.notes,
    mentions: mentions.get(a.id) ?? [],
    shoeId: a.shoeId,
    shoeName: a.shoe?.name ?? null,
    loggedByUserId: a.loggedByUserId,
    loggedByName: a.loggedBy?.displayName ?? null,
    source: a.source,
    visibility: a.visibility,
    hasGpsRoute: a.route !== null,
    ...(opts?.route !== undefined ? { route: opts.route } : {}),
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
  // Verified guardians can view their athlete's team-visible activities
  // (the family page already lists them).
  const guardianLink = await db.guardianLink
    .findFirst({
      where: { guardianId: actorId, athleteId: activity.userId, status: "VERIFIED" },
      select: { id: true },
    })
    .catch(() => null);
  if (guardianLink) return true;
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
  provenance?: { source: "FILE_IMPORT" | "COROS"; externalId: string },
  onBehalfOf?: { userId: string; loggedByUserId: string },
): Promise<ActivityDTO> {
  // The run belongs to the athlete; loggedBy records who entered it.
  const ownerId = onBehalfOf?.userId ?? actorId;
  const loggedByUserId = onBehalfOf?.loggedByUserId ?? null;

  let teamId: string | null = null;
  if (input.teamId) {
    await activeMembership(actorId, input.teamId);
    teamId = input.teamId;
  }

  let shoeId: string | null = null;
  if (input.shoeId) {
    await assertOwnShoe(ownerId, input.shoeId);
    shoeId = input.shoeId;
  } else {
    // Fall back to the runner's default shoe, if they set one.
    shoeId = await getDefaultShoeId(ownerId);
  }

  let assignmentId: string | null = null;
  if (input.assignmentId) {
    const { teamId: aTeam } = await assertAssignmentVisible(
      ownerId,
      input.assignmentId,
    );
    assignmentId = input.assignmentId;
    // Log in the assignment's team context unless the caller chose another team.
    if (!teamId) teamId = aTeam;
  }

  // Profile city is the default city for the activity (weather uses it too).
  const ownerProfile = await db.profile.findUnique({
    where: { userId: ownerId },
  });
  const activityCity = input.city?.trim() || ownerProfile?.city?.trim() || null;

  const effectiveVisibility = input.visibility ?? (await defaultVisibility(ownerId));

  const activity = await db.activity.create({
    data: {
      userId: ownerId,
      loggedByUserId,
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
      calories: input.calories ?? undefined,
      steps: input.steps ?? undefined,
      elevationGainM: input.elevationGainM ?? undefined,
      avgCadenceSpm: input.avgCadenceSpm ?? undefined,
      splits:
        input.splits && input.splits.length > 0
          ? {
              create: input.splits.map((sp, i) => ({
                position: i,
                distanceM: sp.distanceM ?? undefined,
                durationS: sp.durationS ?? undefined,
              })),
            }
          : undefined,
      city: activityCity,
      cityLat: input.cityLat ?? undefined,
      cityLon: input.cityLon ?? undefined,
      terrain: input.terrain ?? undefined,
      weatherTempC: input.weatherTempC ?? undefined,
      weatherCondition: input.weatherCondition?.trim() || null,
      notes: input.notes?.trim() || null,
      visibility: effectiveVisibility,
      shoeId,
      source: provenance?.source ?? "MANUAL",
      externalId: provenance?.externalId ?? null,
    },
    include: WITH_JOINS,
  });

  // Auto-estimate calories/steps when the athlete didn't provide them
  // (tracker imports keep their own values). Uses profile height/weight.
  if (activity.calories == null || activity.steps == null) {
    const effWeightKg = input.weightKg ?? ownerProfile?.weightKg ?? null;
    const patch: { calories?: number; steps?: number } = {};
    if (activity.calories == null) {
      const est = estimateCalories({
        kind: input.kind,
        distanceM: input.distanceM,
        durationS: input.durationS,
        weightKg: effWeightKg,
      });
      if (est != null) patch.calories = est;
    }
    if (activity.steps == null) {
      const est = estimateSteps(
        input.distanceM,
        ownerProfile?.heightCm ?? null,
        input.kind,
      );
      if (est != null) patch.steps = est;
    }
    if (Object.keys(patch).length > 0) {
      await db.activity.update({ where: { id: activity.id }, data: patch });
      Object.assign(activity, patch);
    }
  }

  // Auto-pull weather when a city was logged but no manual weather given.
  if (
    activity.city &&
    activity.weatherTempC == null &&
    activity.weatherCondition == null
  ) {
    const coords =
      activity.cityLat != null && activity.cityLon != null
        ? { lat: activity.cityLat, lon: activity.cityLon }
        : null;
    const wx = await lookupWeather(activity.city, activity.startedAt, coords);
    if (wx) {
      await db.activity.update({
        where: { id: activity.id },
        data: { weatherTempC: wx.tempC, weatherCondition: wx.condition },
      });
      Object.assign(activity, {
        weatherTempC: wx.tempC,
        weatherCondition: wx.condition,
      });
    }
  }

  // @-mentions in notes (team activities only).
  if (activity.teamId && activity.notes) {
    const mentioner = await db.user.findUnique({
      where: { id: actorId },
      select: { displayName: true },
    });
    await syncMentions({
      targetType: "ACTIVITY",
      targetId: activity.id,
      teamId: activity.teamId,
      mentionerId: actorId,
      mentionerName: mentioner?.displayName ?? "Someone",
      text: activity.notes,
      link: `/activities/${activity.id}`,
    });
  }

  // Goal completions (personal + team) are checked on every logged run.
  // Fire-and-forget: celebrations must never break activity logging.
  checkGoalCompletions(ownerId).catch(() => {});

  // A weight entered at log time becomes the profile weight.
  if (input.weightKg !== undefined) {
    await db.profile.upsert({
      where: { userId: ownerId },
      create: { userId: ownerId, weightKg: input.weightKg },
      update: { weightKg: input.weightKg },
    });
  }

  // Teammate tags: notify each tagged runner ("add it to your log?").
  // Tags only make sense on team-visible activities.
  if (input.taggedUserIds && input.taggedUserIds.length > 0) {
    if (!teamId || effectiveVisibility !== "TEAM") {
      throw badRequest("Teammate tags require a team-visible activity");
    }
    await tagTeammates(activity.id, actorId, teamId, input.taggedUserIds);
  }

  // Accepting a tag: this new activity is the tagged user's own log.
  if (input.fromTagId) {
    await acceptActivityTag(ownerId, input.fromTagId);
  }

  await audit({
    actorId,
    action: "ACTIVITY_CREATED",
    entityType: "Activity",
    entityId: activity.id,
    metadata: {
      kind: activity.kind,
      distanceM: activity.distanceM,
      assignmentId,
      ...(onBehalfOf ? { onBehalfOf: onBehalfOf.userId } : {}),
    },
    ipAddress,
  });

  return await toActivityDTO(activity);
}

/**
 * Exclusive upper bound for a "to" date: the start of the day after `to`,
 * so activities on the `to` date itself are included.
 */
function endOfDayExclusive(to: string): Date {
  const d = new Date(to + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
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
        lt: endOfDayExclusive(to),
      },
      ...(teamId ? { teamId } : {}),
    },
    include: WITH_JOINS,
    orderBy: { startedAt: "desc" },
  });
  return Promise.all(activities.map((a) => toActivityDTO(a)));
}

export async function getActivity(
  actorId: string,
  activityId: string,
): Promise<ActivityDTO> {
  const activity = await db.activity.findUnique({
    where: { id: activityId },
    include: { ...WITH_JOINS, route: { select: { id: true, points: true } } },
  });
  if (!activity || !(await canView(actorId, activity))) {
    throw notFound("Activity not found");
  }
  // Route maps: owner + verified guardians only.
  const route =
    (await canSeeRoute(actorId, activity.userId)) && activity.route
      ? (activity.route.points as Array<[number, number]>)
      : null;
  return await toActivityDTO(activity, { route });
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
  if (
    !existing ||
    (existing.userId !== actorId && existing.loggedByUserId !== actorId)
  ) {
    throw notFound("Activity not found");
  }
  // Ownership-scoped checks run against the athlete the run belongs to.
  const ownerId = existing.userId;

  let teamId: string | null | undefined;
  if (input.teamId !== undefined) {
    if (input.teamId) {
      await activeMembership(ownerId, input.teamId);
      teamId = input.teamId;
    } else {
      teamId = null;
    }
  }

  let shoeId: string | null | undefined;
  if (input.shoeId !== undefined) {
    if (input.shoeId) {
      await assertOwnShoe(ownerId, input.shoeId);
      shoeId = input.shoeId;
    } else {
      shoeId = null;
    }
  }

  let assignmentId: string | null | undefined;
  if (input.assignmentId !== undefined) {
    if (input.assignmentId) {
      await assertAssignmentVisible(ownerId, input.assignmentId);
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
      elevationGainM: input.elevationGainM,
      avgCadenceSpm: input.avgCadenceSpm,
      splits:
        input.splits === undefined
          ? undefined
          : {
              deleteMany: {},
              create: input.splits.map((sp, i) => ({
                position: i,
                distanceM: sp.distanceM ?? undefined,
                durationS: sp.durationS ?? undefined,
              })),
            },
      notes:
        input.notes === undefined ? undefined : input.notes?.trim() || null,
      teamId,
      assignmentId,
      shoeId,
      visibility: input.visibility,
      steps: input.steps,
      city: input.city === undefined ? undefined : input.city?.trim() || null,
      cityLat: input.cityLat,
      cityLon: input.cityLon,
      terrain: input.terrain ?? undefined,
      weatherTempC: input.weatherTempC,
      weatherCondition:
        input.weatherCondition === undefined
          ? undefined
          : input.weatherCondition?.trim() || null,
    },
    include: WITH_JOINS,
  });

  if (input.weightKg !== undefined) {
    await db.profile.upsert({
      where: { userId: ownerId },
      create: { userId: ownerId, weightKg: input.weightKg },
      update: { weightKg: input.weightKg },
    });
  }

  // Fill estimates for values the athlete left blank.
  if (
    (input.calories === undefined && activity.calories == null) ||
    (input.steps === undefined && activity.steps == null)
  ) {
    const ownerProfile = await db.profile.findUnique({
      where: { userId: ownerId },
    });
    const effWeightKg = input.weightKg ?? ownerProfile?.weightKg ?? null;
    const patch: { calories?: number; steps?: number } = {};
    if (input.calories === undefined && activity.calories == null) {
      const est = estimateCalories({
        kind: activity.kind,
        distanceM: input.distanceM ?? activity.distanceM,
        durationS: input.durationS ?? activity.durationS,
        weightKg: effWeightKg,
      });
      if (est != null) patch.calories = est;
    }
    if (input.steps === undefined && activity.steps == null) {
      const est = estimateSteps(
        input.distanceM ?? activity.distanceM ?? undefined,
        ownerProfile?.heightCm ?? null,
        activity.kind,
      );
      if (est != null) patch.steps = est;
    }
    if (Object.keys(patch).length > 0) {
      await db.activity.update({ where: { id: activity.id }, data: patch });
      Object.assign(activity, patch);
    }
  }

  // Re-sync @-mentions when notes or the team changed (team activities only).
  if (
    activity.teamId &&
    activity.notes &&
    (input.notes !== undefined || input.teamId !== undefined)
  ) {
    const mentioner = await db.user.findUnique({
      where: { id: actorId },
      select: { displayName: true },
    });
    await syncMentions({
      targetType: "ACTIVITY",
      targetId: activity.id,
      teamId: activity.teamId,
      mentionerId: actorId,
      mentionerName: mentioner?.displayName ?? "Someone",
      text: activity.notes,
      link: `/activities/${activity.id}`,
    });
  }

  // A run that goes private invalidates its pending teammate tags.
  if (input.visibility === "PRIVATE" && activity.visibility === "PRIVATE") {
    await db.activityTag.updateMany({
      where: { activityId, status: "PENDING" },
      data: { status: "INVALIDATED", respondedAt: new Date() },
    });
  }

  await audit({
    actorId,
    action: "ACTIVITY_UPDATED",
    entityType: "Activity",
    entityId: activityId,
    metadata: { fields: Object.keys(input) },
    ipAddress,
  });

  return await toActivityDTO(activity);
}

export async function deleteActivity(
  actorId: string,
  activityId: string,
  ipAddress?: string,
): Promise<void> {
  const existing = await db.activity.findUnique({
    where: { id: activityId },
  });
  if (
    !existing ||
    (existing.userId !== actorId && existing.loggedByUserId !== actorId)
  ) {
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

/**
 * Tag teammates in a run: each tagged user gets a PENDING tag plus a
 * RUN_TAGGED notification linking to a prefilled log form. Nothing is
 * auto-logged — the tagged user approves (and edits) before saving.
 * Like @-mentions, tags stay inside the trusted same-team circle.
 */
async function tagTeammates(
  activityId: string,
  taggerId: string,
  teamId: string,
  taggedUserIds: string[],
): Promise<void> {
  const tagger = await db.user.findUnique({
    where: { id: taggerId },
    select: { displayName: true },
  });
  const seen = new Set<string>();
  for (const taggedUserId of taggedUserIds) {
    if (taggedUserId === taggerId) {
      throw badRequest("You can't tag yourself");
    }
    if (seen.has(taggedUserId)) continue;
    seen.add(taggedUserId);
    // Tags only for active members of the run's team.
    const membership = await activeMembership(taggedUserId, teamId).catch(
      () => null,
    );
    if (!membership) {
      throw forbidden("Tagged users must be active members of the team");
    }
    const tag = await db.activityTag.create({
      data: { activityId, taggedUserId, status: "PENDING" },
    });
    await db.notification.create({
      data: {
        userId: taggedUserId,
        type: "RUN_TAGGED",
        title: `${tagger?.displayName ?? "A teammate"} tagged you in their run`,
        body: "Review it and add it to your log — your numbers, your call.",
        link: `/activities/new?fromTag=${tag.id}`,
      },
    });
  }
  await audit({
    actorId: taggerId,
    action: "ACTIVITY_TAGGED",
    entityType: "Activity",
    entityId: activityId,
    metadata: { taggedUserIds: [...seen] },
  });
}

/**
 * Accept a teammate tag while saving the tagged user's own activity.
 * The tag must be PENDING and the source run still team-visible.
 */
async function acceptActivityTag(ownerId: string, tagId: string): Promise<void> {
  const tag = await db.activityTag.findUnique({
    where: { id: tagId },
    include: { activity: { select: { visibility: true } } },
  });
  if (!tag || tag.taggedUserId !== ownerId) {
    throw notFound("Tag not found");
  }
  if (tag.status !== "PENDING") {
    throw badRequest("This tag was already handled");
  }
  if (tag.activity.visibility !== "TEAM") {
    await db.activityTag.update({
      where: { id: tagId },
      data: { status: "INVALIDATED", respondedAt: new Date() },
    });
    throw new AppError(
      410,
      "TAG_INVALID",
      "The tagged run is no longer shared with the team",
    );
  }
  await db.activityTag.update({
    where: { id: tagId },
    data: { status: "ACCEPTED", respondedAt: new Date() },
  });
}

/**
 * Load a tag for the prefilled "add it to your log" form. Only the tagged
 * user can read their own tag; a tag whose source run went private is
 * invalidated on sight.
 */
export async function getActivityTag(
  actorId: string,
  tagId: string,
): Promise<ActivityTagDTO> {
  const tag = await db.activityTag.findUnique({
    where: { id: tagId },
    include: {
      activity: {
        include: {
          user: { select: { displayName: true } },
          team: { select: { name: true } },
        },
      },
    },
  });
  if (!tag || tag.taggedUserId !== actorId) {
    throw notFound("Tag not found");
  }
  if (tag.status === "INVALIDATED") {
    throw new AppError(410, "TAG_INVALID", "This tag is no longer valid");
  }
  if (tag.activity.visibility !== "TEAM") {
    await db.activityTag.update({
      where: { id: tag.id },
      data: { status: "INVALIDATED", respondedAt: new Date() },
    });
    throw new AppError(
      410,
      "TAG_INVALID",
      "The tagged run is no longer shared with the team",
    );
  }
  const a = tag.activity;
  return {
    id: tag.id,
    status: tag.status,
    taggerId: a.userId,
    taggerName: a.user.displayName,
    teamId: a.teamId,
    teamName: a.team?.name ?? null,
    createdAt: tag.createdAt.toISOString(),
    prefill: {
      title: a.title,
      startedAt: a.startedAt.toISOString(),
      distanceM: a.distanceM,
      durationS: a.durationS,
      avgHrBpm: a.avgHrBpm,
      maxHrBpm: a.maxHrBpm,
      effortRpe: a.effortRpe,
      calories: a.calories,
      steps: a.steps,
      elevationGainM: a.elevationGainM,
      avgCadenceSpm: a.avgCadenceSpm,
      city: a.city,
      terrain: a.terrain,
      notes: a.notes,
    },
  };
}

/** Decline a tag: no activity is created. Only the tagged user. */
export async function declineActivityTag(
  actorId: string,
  tagId: string,
): Promise<{ ok: boolean }> {
  const tag = await db.activityTag.findUnique({ where: { id: tagId } });
  if (!tag || tag.taggedUserId !== actorId) {
    throw notFound("Tag not found");
  }
  if (tag.status !== "PENDING") {
    throw badRequest("This tag was already handled");
  }
  await db.activityTag.update({
    where: { id: tagId },
    data: { status: "DECLINED", respondedAt: new Date() },
  });
  return { ok: true };
}

/**
 * Coach bulk-log: record one run for many athletes at once (e.g. after a
 * team practice). Each athlete gets their own activity, attributed to them
 * and stamped as logged by the coach. The coach can later edit or delete
 * the entries they logged.
 */
export async function logTeamRun(
  coachId: string,
  input: LogTeamRunInput,
  ipAddress?: string,
): Promise<{ count: number; activityIds: string[] }> {
  const membership = await activeMembership(coachId, input.teamId);
  requireManager(membership);

  // Resolve the athlete list.
  let athleteIds: string[];
  if (input.userIds) {
    // Explicit selection: everyone must be an active member of the team.
    const members = await db.teamMembership.findMany({
      where: {
        teamId: input.teamId,
        userId: { in: input.userIds },
        status: "ACTIVE",
      },
      select: { userId: true },
    });
    const found = new Set(members.map((m) => m.userId));
    const missing = input.userIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw forbidden("Some selected athletes are not on this team");
    }
    athleteIds = [...found];
  } else if (input.groupId) {
    const group = await db.teamGroup.findUnique({
      where: { id: input.groupId },
      select: { teamId: true },
    });
    if (!group || group.teamId !== input.teamId) {
      throw notFound("Training group not found");
    }
    const members = await db.teamGroupMember.findMany({
      where: { groupId: input.groupId },
      select: { userId: true },
    });
    const active = await db.teamMembership.findMany({
      where: {
        teamId: input.teamId,
        userId: { in: members.map((m) => m.userId) },
        status: "ACTIVE",
        role: "RUNNER",
      },
      select: { userId: true },
    });
    athleteIds = active.map((m) => m.userId);
  } else {
    // Whole team: every active runner.
    const runners = await db.teamMembership.findMany({
      where: { teamId: input.teamId, status: "ACTIVE", role: "RUNNER" },
      select: { userId: true },
    });
    athleteIds = runners.map((m) => m.userId);
  }

  if (athleteIds.length === 0) {
    throw new AppError(400, "NO_ATHLETES", "No athletes to log for");
  }

  // Per-athlete overrides must target selected athletes.
  const selected = new Set(athleteIds);
  const overrideByUser = new Map<string, NonNullable<LogTeamRunInput["overrides"]>[number]>();
  for (const o of input.overrides ?? []) {
    if (!selected.has(o.userId)) {
      throw new AppError(400, "OVERRIDE_NOT_SELECTED", "Overrides must be for selected athletes");
    }
    if (overrideByUser.has(o.userId)) {
      throw new AppError(400, "DUPLICATE_OVERRIDE", "One override per athlete");
    }
    overrideByUser.set(o.userId, o);
  }

  const activityIds: string[] = [];
  for (const athleteId of athleteIds) {
    const o = overrideByUser.get(athleteId);
    const created = await createActivity(
      coachId,
      {
        kind: input.kind,
        title: input.title,
        startedAt: input.startedAt,
        distanceM: o?.distanceM ?? input.distanceM,
        durationS: o?.durationS ?? input.durationS,
        avgHrBpm: o?.avgHrBpm ?? input.avgHrBpm,
        maxHrBpm: o?.maxHrBpm ?? input.maxHrBpm,
        effortRpe: input.effortRpe,
        calories: input.calories,
        elevationGainM: input.elevationGainM,
        avgCadenceSpm: input.avgCadenceSpm,
        notes: input.notes,
        teamId: input.teamId,
        visibility: input.visibility,
      },
      ipAddress,
      undefined,
      { userId: athleteId, loggedByUserId: coachId },
    );
    activityIds.push(created.id);
  }

  await audit({
    actorId: coachId,
    action: "TEAM_RUN_LOGGED",
    entityType: "Team",
    entityId: input.teamId,
    metadata: { count: activityIds.length, groupId: input.groupId ?? null },
    ipAddress,
  });

  return { count: activityIds.length, activityIds };
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
        lt: endOfDayExclusive(to),
      },
    },
    _count: true,
    _sum: { distanceM: true, durationS: true },
  });
  const totalDistanceM = agg._sum.distanceM ?? 0;
  const totalDurationS = agg._sum.durationS ?? 0;
  // Pace only counts runs with both distance and time; a run missing
  // either one must not inflate the average.
  const paceAgg = await db.activity.aggregate({
    where: {
      userId: actorId,
      startedAt: {
        gte: new Date(from + "T00:00:00Z"),
        lt: endOfDayExclusive(to),
      },
      distanceM: { gt: 0 },
      durationS: { gt: 0 },
    },
    _sum: { distanceM: true, durationS: true },
  });
  const paceDistanceM = paceAgg._sum.distanceM ?? 0;
  const paceDurationS = paceAgg._sum.durationS ?? 0;
  return {
    count: agg._count,
    totalDistanceM: Math.round(totalDistanceM),
    totalDurationS,
    avgPaceS:
      paceDistanceM > 0 && paceDurationS > 0
        ? Math.round((paceDurationS / paceDistanceM) * 1000 * 10) / 10
        : null,
  };
}

/** Standard PR distances: canonical meters + display label. */
const PR_DISTANCES: { distanceM: number; label: string }[] = [
  { distanceM: 1609.344, label: "1 mi" },
  { distanceM: 5000, label: "5K" },
  { distanceM: 10000, label: "10K" },
  { distanceM: 21097.5, label: "Half" },
  { distanceM: 42195, label: "Marathon" },
];

/** Personal records: fastest pace ever at each standard distance (±2%). */
export async function myRecords(userId: string): Promise<PaceRecordDTO[]> {
  const activities = await db.activity.findMany({
    where: { userId, distanceM: { gt: 0 }, durationS: { gt: 0 } },
    select: { id: true, distanceM: true, durationS: true, startedAt: true },
    orderBy: { startedAt: "desc" },
  });
  const records: PaceRecordDTO[] = [];
  for (const { distanceM, label } of PR_DISTANCES) {
    const lo = distanceM * 0.98;
    const hi = distanceM * 1.02;
    let best: { paceS: number; id: string; at: Date } | null = null;
    for (const a of activities) {
      const d = a.distanceM!;
      if (d < lo || d > hi) continue;
      const paceS = (a.durationS! / d) * 1000;
      if (!best || paceS < best.paceS) {
        best = { paceS, id: a.id, at: a.startedAt };
      }
    }
    if (best) {
      records.push({
        distanceM,
        label,
        bestPaceS: Math.round(best.paceS * 10) / 10,
        activityId: best.id,
        achievedAt: best.at.toISOString(),
      });
    }
  }
  return records;
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
  // Pace only counts runs with both distance and time.
  const paceDistanceM = recent.reduce(
    (s, a) => s + (a.distanceM && a.durationS ? a.distanceM : 0),
    0,
  );
  const paceDurationS = recent.reduce(
    (s, a) => s + (a.distanceM && a.durationS ? a.durationS : 0),
    0,
  );

  return {
    userId,
    displayName: target.user.displayName,
    role: target.role,
    stats: {
      count: recent.length,
      totalDistanceM: Math.round(totalDistanceM),
      totalDurationS,
      avgPaceS:
        paceDistanceM > 0 && paceDurationS > 0
          ? Math.round((paceDurationS / paceDistanceM) * 1000 * 10) / 10
          : null,
    },
    recentActivities: await Promise.all(recent.map((a) => toActivityDTO(a))),
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
  return Promise.all(activities.map((a) => toActivityDTO(a)));
}

/**
 * Transfer my training history from one team to another.
 * Re-links activities (no copies, so it can't duplicate and can be
 * transferred back). Posts stay with their team or are deleted on leave;
 * reactions/comments never transfer.
 */
export async function transferActivities(
  actorId: string,
  fromTeamId: string,
  toTeamId: string,
): Promise<{ transferred: number }> {
  if (fromTeamId === toTeamId) {
    throw forbidden("Can't transfer to the same team");
  }
  // Must be an active member of the target team.
  await activeMembership(actorId, toTeamId);
  const result = await db.activity.updateMany({
    where: { userId: actorId, teamId: fromTeamId },
    data: { teamId: toTeamId },
  });
  return { transferred: result.count };
}
