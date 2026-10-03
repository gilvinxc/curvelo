import { db } from "../../db.js";
import { activeMembership } from "../../lib/permissions.js";
import { forbidden } from "../../lib/errors.js";
import type { TeamHealthDTO } from "@curvelo/shared";

/**
 * Team Health: one headline rollup per area (miles, pace, effort, races,
 * participation, injuries) instead of a million reports. Each tile drills
 * down into an existing list view.
 *
 * Visibility rules:
 * - Any ACTIVE member except ALUMNI can view (alumni are the outer tier).
 * - activeInjuries is COACH-only, null for everyone else. TEAM_ADMIN does
 *   not get it (same rule as contact info: operational, not training data).
 * - Activity aggregates use TEAM-visible activities only.
 * - avgPaceS only counts activities with distanceM > 0 AND durationS > 0 —
 *   a run missing either one must not inflate the average.
 */
export async function teamHealth(
  actorId: string,
  teamId: string,
): Promise<TeamHealthDTO> {
  const membership = await activeMembership(actorId, teamId);
  if (membership.role === "ALUMNI") {
    throw forbidden("Alumni can't view team health");
  }

  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const twoWeeksAgo = new Date(now);
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  const fourWeeksAgo = new Date(now);
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const teamVisible = { teamId, visibility: "TEAM" as const };

  const [weekAgg, prevWeekAgg, paceAgg, rpeAgg] = await Promise.all([
    db.activity.aggregate({
      where: { ...teamVisible, startedAt: { gte: weekAgo } },
      _sum: { distanceM: true },
    }),
    db.activity.aggregate({
      where: {
        ...teamVisible,
        startedAt: { gte: twoWeeksAgo, lt: weekAgo },
      },
      _sum: { distanceM: true },
    }),
    db.activity.aggregate({
      where: {
        ...teamVisible,
        startedAt: { gte: fourWeeksAgo },
        distanceM: { gt: 0 },
        durationS: { gt: 0 },
      },
      _sum: { distanceM: true, durationS: true },
    }),
    db.activity.aggregate({
      where: {
        ...teamVisible,
        startedAt: { gte: fourWeeksAgo },
        effortRpe: { not: null },
      },
      _avg: { effortRpe: true },
    }),
  ]);

  const paceDistanceM = paceAgg._sum.distanceM ?? 0;
  const paceDurationS = paceAgg._sum.durationS ?? 0;

  // Injuries are coach-only. TEAM_ADMIN gets null like everyone else.
  const activeInjuries =
    membership.role === "COACH"
      ? await db.injury.count({ where: { teamId, status: "ACTIVE" } })
      : null;

  // Participation: % of ACTIVE RUNNER members with >=1 TEAM-visible
  // activity in the last 7 days.
  const runners = await db.teamMembership.findMany({
    where: { teamId, status: "ACTIVE", role: "RUNNER" },
    select: { userId: true },
  });
  const memberIds = (
    await db.teamMembership.findMany({
      where: { teamId, status: "ACTIVE" },
      select: { userId: true },
    })
  ).map((m) => m.userId);

  let participationPct: number | null = null;
  let activeRunnerCount = 0;
  if (runners.length > 0) {
    const active = await db.activity.groupBy({
      by: ["userId"],
      where: {
        ...teamVisible,
        startedAt: { gte: weekAgo },
        userId: { in: runners.map((r) => r.userId) },
      },
    });
    activeRunnerCount = active.length;
    participationPct = Math.round((active.length / runners.length) * 100);
  }

  // Race health = PRs + pace-by-distance, not raw race counts.
  // A PR = the fastest pace (lowest durationS/distanceM) that userId has
  // ever logged at that exact distanceM. A result counts as a "new PR" when
  // its pace is strictly better than every earlier result at that distance.
  const ninetyDaysAgo = new Date(now);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const allRaceRows =
    memberIds.length > 0
      ? await db.raceResult.findMany({
          where: { userId: { in: memberIds } },
          select: {
            userId: true,
            raceName: true,
            racedAt: true,
            distanceM: true,
            durationS: true,
          },
          orderBy: { racedAt: "asc" },
          take: 5000,
        })
      : [];

  const bestPace = new Map<string, number>();
  const isPr = new Array<boolean>(allRaceRows.length).fill(false);
  allRaceRows.forEach((r, i) => {
    const key = `${r.userId}|${r.distanceM}`;
    const pace = r.durationS / r.distanceM;
    const prev = bestPace.get(key);
    if (prev === undefined || pace < prev) {
      isPr[i] = true;
      bestPace.set(key, pace);
    }
  });

  const in30d = (d: Date) => d >= thirtyDaysAgo;
  const prs30d = allRaceRows.filter((r, i) => isPr[i] && in30d(r.racedAt)).length;
  const rows30d = allRaceRows.filter((r) => in30d(r.racedAt));
  const raceDays30d = new Set(
    rows30d.map((r) => `${r.raceName}|${r.racedAt.toISOString().slice(0, 10)}`),
  );

  // Pace by distance: last 90d, grouped by distanceM, ordered asc.
  const byDist = new Map<number, { dur: number; dist: number; count: number }>();
  for (const r of allRaceRows) {
    if (r.racedAt < ninetyDaysAgo) continue;
    const g = byDist.get(r.distanceM) ?? { dur: 0, dist: 0, count: 0 };
    g.dur += r.durationS;
    g.dist += r.distanceM;
    g.count += 1;
    byDist.set(r.distanceM, g);
  }
  const paceByDistance = [...byDist.entries()]
    .map(([distanceM, g]) => ({
      distanceM,
      avgPaceS: Math.round((g.dur / g.dist) * 1000 * 10) / 10,
      resultsCount: g.count,
    }))
    .sort((a, b) => a.distanceM - b.distanceM);

  // Recent races: most recent race-days (name+day), up to 5, with PR counts.
  const recentMap = new Map<
    string,
    { raceName: string; racedAt: string; resultsCount: number; prCount: number }
  >();
  for (let i = allRaceRows.length - 1; i >= 0; i--) {
    const r = allRaceRows[i];
    const day = r.racedAt.toISOString().slice(0, 10);
    const key = `${r.raceName}|${day}`;
    const existing = recentMap.get(key);
    if (existing) {
      existing.resultsCount += 1;
      if (isPr[i]) existing.prCount += 1;
    } else {
      // Already have the 5 most recent race-days; older ones don't matter.
      if (recentMap.size >= 5) break;
      recentMap.set(key, {
        raceName: r.raceName,
        racedAt: day,
        resultsCount: 1,
        prCount: isPr[i] ? 1 : 0,
      });
    }
  }

  return {
    teamId,
    milesWeekM: Math.round(weekAgg._sum.distanceM ?? 0),
    milesPrevWeekM: Math.round(prevWeekAgg._sum.distanceM ?? 0),
    avgPaceS:
      paceDistanceM > 0 && paceDurationS > 0
        ? Math.round((paceDurationS / paceDistanceM) * 1000 * 10) / 10
        : null,
    avgRpe:
      rpeAgg._avg.effortRpe != null
        ? Math.round(rpeAgg._avg.effortRpe * 10) / 10
        : null,
    activeInjuries,
    participationPct,
    runnerCount: runners.length,
    activeRunnerCount,
    races: {
      prs30d,
      races30d: raceDays30d.size,
      results30d: rows30d.length,
      paceByDistance,
      // Deep link target: the team coaching tab already has race history.
      recent: [...recentMap.values()],
    },
  };
}
