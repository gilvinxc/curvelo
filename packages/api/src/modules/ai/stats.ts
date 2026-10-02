import type { TrainingStats } from "@curvelo/shared";
import { db } from "../../db.js";

/**
 * Deterministic training statistics. Both AI providers (local analyst and
 * LLM) work from these numbers — the LLM only writes the narrative, so its
 * output stays grounded in real data.
 */
export async function computeStats(
  userId: string,
  teamId: string | undefined,
  days: number,
): Promise<TrainingStats> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - (days - 1));
  since.setUTCHours(0, 0, 0, 0);

  const activities = await db.activity.findMany({
    where: { userId, ...(teamId ? { teamId } : {}), startedAt: { gte: since } },
    select: {
      startedAt: true,
      kind: true,
      distanceM: true,
      durationS: true,
      effortRpe: true,
      assignmentId: true,
    },
    orderBy: { startedAt: "asc" },
  });

  const sessions = activities.length;
  const daySet = new Set(activities.map((a) => a.startedAt.toISOString().slice(0, 10)));
  const activeDays = daySet.size;

  let totalDistanceM = 0;
  let totalDurationS = 0;
  let longestRunM = 0;
  const rpes: number[] = [];
  const paces: number[] = []; // sec/km per run, chronological
  for (const a of activities) {
    if (a.distanceM) {
      totalDistanceM += a.distanceM;
      if (a.kind === "RUN" && a.distanceM > longestRunM) longestRunM = a.distanceM;
    }
    if (a.durationS) totalDurationS += a.durationS;
    if (a.effortRpe != null) rpes.push(a.effortRpe);
    if (
      a.kind === "RUN" &&
      a.distanceM &&
      a.distanceM > 0 &&
      a.durationS &&
      a.durationS > 0
    ) {
      paces.push(a.durationS / (a.distanceM / 1000));
    }
  }

  const avgPaceSecPerKm =
    totalDistanceM > 0 && totalDurationS > 0
      ? totalDurationS / (totalDistanceM / 1000)
      : null;
  const avgRpe = rpes.length > 0 ? rpes.reduce((s, r) => s + r, 0) / rpes.length : null;

  // Streak: consecutive active days ending today or yesterday.
  let streakDays = 0;
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  if (!daySet.has(cursor.toISOString().slice(0, 10))) {
    cursor.setUTCDate(cursor.getUTCDate() - 1); // allow "rest day today"
  }
  while (daySet.has(cursor.toISOString().slice(0, 10))) {
    streakDays++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  // Pace trend: least-squares slope of per-run pace vs session order.
  let paceTrend: TrainingStats["paceTrend"] = "insufficient";
  if (paces.length >= 4) {
    const n = paces.length;
    const meanX = (n - 1) / 2;
    const meanY = paces.reduce((s, p) => s + p, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - meanX) * (paces[i] - meanY);
      den += (i - meanX) * (i - meanX);
    }
    const slope = den === 0 ? 0 : num / den; // sec/km per session
    const threshold = meanY * 0.01;
    paceTrend = slope < -threshold ? "improving" : slope > threshold ? "declining" : "stable";
  }

  // Assignment completion within the window.
  const todayStr = new Date().toISOString().slice(0, 10);
  const sinceStr = since.toISOString().slice(0, 10);
  const assignments = await db.workoutAssignment.findMany({
    where: {
      teamId,
      scheduledDate: {
        gte: new Date(sinceStr + "T00:00:00Z"),
        lte: new Date(todayStr + "T00:00:00Z"),
      },
      OR: [
        { assignedToUserId: userId },
        { assignedToUserId: null, groupId: null },
        { group: { members: { some: { userId } } } },
      ],
    },
    select: { id: true },
  });
  const completedIds = new Set(
    activities.map((a) => a.assignmentId).filter((id): id is string => !!id),
  );
  const assignmentsTotal = assignments.length;
  const assignmentsCompleted = assignments.filter((a) => completedIds.has(a.id)).length;
  const completionRate =
    assignmentsTotal > 0 ? assignmentsCompleted / assignmentsTotal : null;

  return {
    sessions,
    activeDays,
    totalDistanceM: Math.round(totalDistanceM),
    totalDurationS: Math.round(totalDurationS),
    avgPaceSecPerKm: avgPaceSecPerKm ? Math.round(avgPaceSecPerKm) : null,
    streakDays,
    longestRunM: Math.round(longestRunM),
    avgRpe: avgRpe ? Math.round(avgRpe * 10) / 10 : null,
    assignmentsTotal,
    assignmentsCompleted,
    completionRate:
      completionRate !== null ? Math.round(completionRate * 100) / 100 : null,
    paceTrend,
  };
}

export function formatPace(secPerKm: number | null): string {
  if (secPerKm === null) return "—";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60).toString().padStart(2, "0");
  return `${m}:${s}/km`;
}

export function formatDistance(m: number): string {
  return m >= 10000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}
