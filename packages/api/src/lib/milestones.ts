/**
 * Supportive milestone detection for the team feed. Celebrates personal
 * progress — firsts, personal bests, consistency — never rankings.
 * Only fires for team-visible activities so private runs stay private.
 */
import { db } from "../db.js";

export interface Milestone {
  key: string;
  title: string;
  detail?: string;
}

const DISTANCE_MILESTONES: Array<{ thresholdM: number; label: string }> = [
  { thresholdM: 5000, label: "5K" },
  { thresholdM: 10000, label: "10K" },
  { thresholdM: 21097, label: "half marathon" },
  { thresholdM: 42195, label: "marathon" },
];

const COUNT_MILESTONES = [50, 100, 250, 500];

/**
 * Detect milestones for a just-created activity. Excludes the activity
 * itself from "prior" queries. Returns at most a few, ordered by significance.
 */
export async function detectMilestones(opts: {
  userId: string;
  activityId: string;
  distanceM: number | null;
}): Promise<Milestone[]> {
  const { userId, activityId, distanceM } = opts;
  const out: Milestone[] = [];

  const priorCount = await db.activity.count({
    where: { userId, id: { not: activityId } },
  });

  if (priorCount === 0) {
    out.push({ key: "FIRST_WORKOUT", title: "first workout logged" });
  }

  const totalCount = priorCount + 1;
  if (COUNT_MILESTONES.includes(totalCount)) {
    out.push({ key: `WORKOUTS_${totalCount}`, title: `${totalCount} workouts logged` });
  }

  if (distanceM != null && distanceM > 0) {
    // Standard-distance firsts (98% tolerance catches 3.1 mi ≈ 4989 m for 5K).
    for (const dm of DISTANCE_MILESTONES) {
      if (distanceM >= dm.thresholdM * 0.98) {
        const priorAtDistance = await db.activity.count({
          where: {
            userId,
            id: { not: activityId },
            distanceM: { gte: Math.round(dm.thresholdM * 0.98) },
          },
        });
        if (priorAtDistance === 0) {
          out.push({ key: `FIRST_${dm.label}`, title: `first ${dm.label}` });
        }
      }
    }

    // Longest run ever (minimum 1 km to avoid noise).
    if (distanceM >= 1000 && priorCount > 0) {
      const longest = await db.activity.aggregate({
        where: { userId, id: { not: activityId }, distanceM: { not: null } },
        _max: { distanceM: true },
      });
      const prevMax = longest._max.distanceM ?? 0;
      if (distanceM > prevMax) {
        out.push({ key: "LONGEST_RUN", title: "longest run yet" });
      }
    }
  }

  // Keep the feed from exploding: most significant first, cap at 2.
  const rank: Record<string, number> = {
    FIRST_WORKOUT: 0,
    FIRST_5K: 1,
    FIRST_10K: 1,
    "FIRST_half marathon": 1,
    "FIRST_marathon": 1,
    LONGEST_RUN: 2,
  };
  out.sort((a, b) => (rank[a.key] ?? 3) - (rank[b.key] ?? 3));
  return out.slice(0, 2);
}
