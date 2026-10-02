import type {
  CreatePersonalGoalInput,
  CreateTeamGoalInput,
} from "@curvelo/shared";
import type {
  GoalDTO,
  LeaderboardDTO,
  ProgressDTO,
} from "@curvelo/shared";
import { db } from "../../db.js";
import { AppError, notFound } from "../../lib/errors.js";
import {
  activeMembership,
  requireManager,
} from "../../lib/permissions.js";
import { audit } from "../../lib/audit.js";

const M_PER_MI = 1609.344;
const M_PER_KM = 1000;

function startOfWeekUTC(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
}

function endOfWeekUTC(d: Date): Date {
  const s = startOfWeekUTC(d);
  s.setUTCDate(s.getUTCDate() + 7);
  return s;
}

function startOfMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function endOfMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

async function toMeters(userId: string, value: number): Promise<number> {
  const profile = await db.profile.findUnique({
    where: { userId },
    select: { units: true },
  });
  const perUnit = profile?.units === "metric" ? M_PER_KM : M_PER_MI;
  return Math.round(value * perUnit);
}

/** Consecutive days with at least one activity, ending today or yesterday. */
export async function currentStreakDays(userId: string): Promise<number> {
  const rows = await db.activity.findMany({
    where: { userId },
    select: { startedAt: true },
    orderBy: { startedAt: "desc" },
    take: 400,
  });
  const days = new Set(rows.map((r) => r.startedAt.toISOString().slice(0, 10)));
  let streak = 0;
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  // Allow the streak to be "alive" if yesterday (not necessarily today) ran.
  if (!days.has(cursor.toISOString().slice(0, 10))) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  while (days.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

async function personalProgress(
  userId: string,
  goal: { kind: string; startAt: Date; endAt: Date },
): Promise<number> {
  if (goal.kind === "STREAK") return currentStreakDays(userId);
  // Personal goals count all of the athlete's own runs, private included —
  // it's their own data and the progress is only visible to them.
  const agg = await db.activity.aggregate({
    where: { userId, startedAt: { gte: goal.startAt, lt: goal.endAt } },
    _sum: { distanceM: true },
    _count: true,
  });
  return goal.kind === "DISTANCE" ? (agg._sum.distanceM ?? 0) : agg._count;
}

async function teamProgress(
  teamId: string,
  goal: { kind: string; startAt: Date; endAt: Date },
): Promise<number> {
  // Team goals only ever count team-visible activities.
  const agg = await db.activity.aggregate({
    where: {
      teamId,
      visibility: "TEAM",
      startedAt: { gte: goal.startAt, lt: goal.endAt },
    },
    _sum: { distanceM: true },
    _count: true,
  });
  return goal.kind === "DISTANCE" ? (agg._sum.distanceM ?? 0) : agg._count;
}

function targetOf(goal: { kind: string; targetMeters: number | null; targetCount: number | null }): number {
  return goal.kind === "DISTANCE" ? (goal.targetMeters ?? 0) : (goal.targetCount ?? 0);
}

async function toDTO(
  goal: {
    id: string;
    kind: "DISTANCE" | "SESSIONS" | "STREAK";
    period: "WEEK" | "MONTH" | "CUSTOM";
    title: string | null;
    targetMeters: number | null;
    targetCount: number | null;
    startAt: Date;
    endAt: Date;
    recurring: boolean;
    status: "ACTIVE" | "COMPLETED" | "ARCHIVED";
    shareOnComplete: boolean;
    completedAt: Date | null;
    teamId: string | null;
  },
  progress: number,
  teamName: string | null,
): Promise<GoalDTO> {
  const target = targetOf(goal);
  const pct = target > 0 ? Math.min(100, Math.round((progress / target) * 100)) : 0;
  return {
    id: goal.id,
    kind: goal.kind,
    period: goal.period,
    title: goal.title,
    targetMeters: goal.targetMeters,
    targetCount: goal.targetCount,
    startAt: goal.startAt.toISOString(),
    endAt: goal.endAt.toISOString(),
    recurring: goal.recurring,
    status: goal.status,
    shareOnComplete: goal.shareOnComplete,
    completedAt: goal.completedAt?.toISOString() ?? null,
    progress,
    progressLabel: `${pct}%`,
    teamId: goal.teamId,
    teamName,
  };
}

function periodBounds(
  period: "WEEK" | "MONTH" | "CUSTOM",
  now: Date,
  startAt?: string,
  endAt?: string,
): { start: Date; end: Date } {
  if (period === "WEEK") return { start: startOfWeekUTC(now), end: endOfWeekUTC(now) };
  if (period === "MONTH") return { start: startOfMonthUTC(now), end: endOfMonthUTC(now) };
  if (!startAt || !endAt) throw new AppError(400, "BAD_REQUEST", "Custom goals need startAt and endAt");
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (!(start < end)) throw new AppError(400, "BAD_REQUEST", "endAt must be after startAt");
  return { start, end };
}

// ---------------------------------------------------------------------------
// Personal goals
// ---------------------------------------------------------------------------

export async function createPersonalGoal(
  userId: string,
  input: CreatePersonalGoalInput,
  ipAddress?: string,
): Promise<GoalDTO> {
  const now = new Date();
  const { start, end } = periodBounds(input.period, now, input.startAt, input.endAt);
  if (input.period !== "CUSTOM" && input.recurring === false) {
    // one-shot week/month goals are fine
  }
  if (input.period === "CUSTOM" && input.recurring) {
    throw new AppError(400, "BAD_REQUEST", "Custom goals cannot recur");
  }
  if (input.shareOnComplete) {
    if (!input.feedTeamId) throw new AppError(400, "BAD_REQUEST", "shareOnComplete needs a team");
    await activeMembership(userId, input.feedTeamId);
  }

  const goal = await db.goal.create({
    data: {
      userId,
      kind: input.kind,
      period: input.period,
      title: input.title?.trim() || null,
      targetMeters: input.kind === "DISTANCE" ? await toMeters(userId, input.target) : null,
      targetCount: input.kind === "DISTANCE" ? null : Math.round(input.target),
      startAt: start,
      endAt: end,
      recurring: input.recurring,
      shareOnComplete: input.shareOnComplete,
      feedTeamId: input.shareOnComplete ? input.feedTeamId! : null,
      createdById: userId,
    },
  });

  await audit({
    actorId: userId,
    action: "GOAL_CREATED",
    entityType: "Goal",
    entityId: goal.id,
    metadata: { kind: goal.kind, period: goal.period },
    ipAddress,
  });

  const progress = await personalProgress(userId, goal);
  return toDTO(goal, progress, null);
}

/** Roll expired recurring goals forward, then list with progress. */
export async function listMyGoals(userId: string): Promise<GoalDTO[]> {
  const now = new Date();
  const recentCutoff = new Date(now.getTime() - 30 * 86_400_000);
  const goals = await db.goal.findMany({
    where: {
      userId,
      OR: [
        { status: "ACTIVE" },
        { status: "COMPLETED", completedAt: { gte: recentCutoff } },
      ],
    },
    orderBy: { createdAt: "desc" },
  });

  const out: GoalDTO[] = [];
  for (const goal of goals) {
    let g = goal;
    if (goal.status === "ACTIVE" && goal.recurring && goal.endAt <= now) {
      const { start, end } = periodBounds(goal.period, now);
      await db.goal.update({ where: { id: goal.id }, data: { status: "ARCHIVED" } });
      g = await db.goal.create({
        data: {
          userId,
          kind: goal.kind,
          period: goal.period,
          title: goal.title,
          targetMeters: goal.targetMeters,
          targetCount: goal.targetCount,
          startAt: start,
          endAt: end,
          recurring: true,
          shareOnComplete: goal.shareOnComplete,
          feedTeamId: goal.feedTeamId,
          createdById: goal.createdById,
        },
      });
    }
    const progress = await personalProgress(userId, g);
    out.push(await toDTO(g, progress, null));
  }
  return out;
}

export async function archivePersonalGoal(
  userId: string,
  goalId: string,
  ipAddress?: string,
): Promise<void> {
  const goal = await db.goal.findFirst({ where: { id: goalId, userId } });
  if (!goal) throw notFound("Goal not found");
  await db.goal.update({ where: { id: goal.id }, data: { status: "ARCHIVED" } });
  await audit({
    actorId: userId,
    action: "GOAL_ARCHIVED",
    entityType: "Goal",
    entityId: goal.id,
    ipAddress,
  });
}

// ---------------------------------------------------------------------------
// Team goals (collective)
// ---------------------------------------------------------------------------

export async function createTeamGoal(
  actorId: string,
  teamId: string,
  input: CreateTeamGoalInput,
  ipAddress?: string,
): Promise<GoalDTO> {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);

  const start = new Date(input.startAt);
  const end = new Date(input.endAt);
  if (!(start < end)) throw new AppError(400, "BAD_REQUEST", "endAt must be after startAt");

  // Team goals are entered in the coach's own units.
  const targetMeters =
    input.kind === "DISTANCE" ? await toMeters(actorId, input.target) : null;

  const goal = await db.goal.create({
    data: {
      teamId,
      kind: input.kind,
      period: "CUSTOM",
      title: input.title.trim(),
      targetMeters,
      targetCount: input.kind === "DISTANCE" ? null : Math.round(input.target),
      startAt: start,
      endAt: end,
      createdById: actorId,
    },
    include: { team: { select: { name: true } } },
  });

  await audit({
    actorId,
    action: "TEAM_GOAL_CREATED",
    entityType: "Goal",
    entityId: goal.id,
    metadata: { teamId, kind: goal.kind },
    ipAddress,
  });

  const progress = await teamProgress(teamId, goal);
  return toDTO(goal, progress, goal.team?.name ?? null);
}

export async function listTeamGoals(
  userId: string,
  teamId: string,
): Promise<GoalDTO[]> {
  await activeMembership(userId, teamId);
  const goals = await db.goal.findMany({
    where: { teamId, status: { in: ["ACTIVE", "COMPLETED"] } },
    orderBy: { createdAt: "desc" },
    include: { team: { select: { name: true } } },
  });
  const out: GoalDTO[] = [];
  for (const g of goals) {
    out.push(await toDTO(g, await teamProgress(teamId, g), g.team?.name ?? null));
  }
  return out;
}

export async function archiveTeamGoal(
  actorId: string,
  teamId: string,
  goalId: string,
  ipAddress?: string,
): Promise<void> {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);
  const goal = await db.goal.findFirst({ where: { id: goalId, teamId } });
  if (!goal) throw notFound("Goal not found");
  await db.goal.update({ where: { id: goal.id }, data: { status: "ARCHIVED" } });
  await audit({
    actorId,
    action: "TEAM_GOAL_ARCHIVED",
    entityType: "Goal",
    entityId: goal.id,
    metadata: { teamId },
    ipAddress,
  });
}

// ---------------------------------------------------------------------------
// Completion checks (called after an activity is logged)
// ---------------------------------------------------------------------------

function celebrationBody(goal: {
  kind: string;
  title: string | null;
  targetMeters: number | null;
  targetCount: number | null;
}): string {
  const what =
    goal.title ??
    (goal.kind === "DISTANCE"
      ? `${Math.round((goal.targetMeters ?? 0) / M_PER_MI)}-mile goal`
      : goal.kind === "SESSIONS"
        ? `${goal.targetCount}-session goal`
        : `${goal.targetCount}-day streak goal`);
  return `🎉 Goal crushed: ${what}!`;
}

export async function checkGoalCompletions(userId: string): Promise<void> {
  // Lazy import: feed/service imports activities/service, which imports this
  // module — a static import here would close a circular dependency.
  const { createPost } = await import("../feed/service.js");
  const personal = await db.goal.findMany({
    where: { userId, status: "ACTIVE" },
  });
  const memberships = await db.teamMembership.findMany({
    where: { userId, status: "ACTIVE" },
    select: { teamId: true },
  });
  const teamGoals = memberships.length
    ? await db.goal.findMany({
        where: {
          teamId: { in: memberships.map((m) => m.teamId) },
          status: "ACTIVE",
        },
      })
    : [];

  for (const goal of personal) {
    const progress = await personalProgress(userId, goal);
    if (progress >= targetOf(goal) && targetOf(goal) > 0) {
      await db.goal.update({
        where: { id: goal.id },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      if (goal.shareOnComplete && goal.feedTeamId) {
        try {
          await createPost(userId, goal.feedTeamId, {
            body: celebrationBody(goal),
          });
        } catch {
          // A failed celebration must never break activity logging.
        }
      }
    }
  }

  for (const goal of teamGoals) {
    if (!goal.teamId) continue;
    const progress = await teamProgress(goal.teamId, goal);
    if (progress >= targetOf(goal) && targetOf(goal) > 0) {
      await db.goal.update({
        where: { id: goal.id },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      try {
        await createPost(goal.createdById, goal.teamId, {
          body: `🎉 Team goal complete: ${goal.title ?? "everyone showed up"}!`,
        });
      } catch {
        // Never break logging on a celebration failure.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Leaderboard (within a team only — never cross-team)
// ---------------------------------------------------------------------------

export async function getLeaderboard(
  userId: string,
  teamId: string,
  metric: "distance" | "sessions",
  days: number,
): Promise<LeaderboardDTO> {
  await activeMembership(userId, teamId);
  const since = new Date(Date.now() - days * 86_400_000);

  const rows = await db.activity.groupBy({
    by: ["userId"],
    where: { teamId, visibility: "TEAM", startedAt: { gte: since } },
    _sum: { distanceM: true },
    _count: true,
  });

  const users = await db.user.findMany({
    where: { id: { in: rows.map((r) => r.userId) } },
    select: { id: true, displayName: true },
  });
  const names = new Map(users.map((u) => [u.id, u.displayName]));

  const entries = rows
    .map((r) => ({
      userId: r.userId,
      displayName: names.get(r.userId) ?? "Runner",
      value: metric === "distance" ? (r._sum.distanceM ?? 0) : r._count,
      rank: 0,
    }))
    .filter((e) => e.value > 0)
    .sort((a, b) => b.value - a.value)
    .map((e, i) => ({ ...e, rank: i + 1 }));

  const top = entries.slice(0, 10);
  const me = entries.find((e) => e.userId === userId);
  if (me && !top.some((e) => e.userId === userId)) top.push(me);

  return {
    metric,
    days,
    entries: top,
    myRank: me?.rank ?? null,
  };
}

// ---------------------------------------------------------------------------
// Personal progress analytics
// ---------------------------------------------------------------------------

export async function getProgress(
  userId: string,
  weeks: number,
): Promise<ProgressDTO> {
  const start = startOfWeekUTC(new Date());
  start.setUTCDate(start.getUTCDate() - (weeks - 1) * 7);

  const activities = await db.activity.findMany({
    where: { userId, startedAt: { gte: start } },
    select: { startedAt: true, distanceM: true, durationS: true },
  });

  const buckets = new Map<string, { distanceM: number; sessions: number; durationS: number }>();
  for (let i = 0; i < weeks; i++) {
    const w = new Date(start);
    w.setUTCDate(w.getUTCDate() + i * 7);
    buckets.set(w.toISOString(), { distanceM: 0, sessions: 0, durationS: 0 });
  }
  let totalDistanceM = 0;
  let totalSessions = 0;
  for (const a of activities) {
    const w = startOfWeekUTC(a.startedAt).toISOString();
    const b = buckets.get(w);
    if (!b) continue;
    b.distanceM += a.distanceM ?? 0;
    b.durationS += a.durationS ?? 0;
    b.sessions += 1;
    totalDistanceM += a.distanceM ?? 0;
    totalSessions += 1;
  }

  return {
    weeks: [...buckets.entries()].map(([weekStart, b]) => ({
      weekStart,
      distanceM: b.distanceM,
      sessions: b.sessions,
      durationS: b.durationS,
    })),
    currentStreakDays: await currentStreakDays(userId),
    totalDistanceM,
    totalSessions,
  };
}
