import type {
  AthleteInsight,
  RaceAnalysisDTO,
  TeamDigest,
  TeamDigestAthlete,
} from "@curvelo/shared";
import { STANDARD_RACE_DISTANCES } from "@curvelo/shared";
import { db } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { notFound } from "../../lib/errors.js";
import { activeMembership, requireManager } from "../../lib/permissions.js";
import { computeStats } from "./stats.js";
import { selectProvider } from "./llm.js";

const INSIGHT_DAYS = 28;
/** No app login for this long counts as dormant. */
const DORMANT_DAYS = 21;
/** No coach/admin login for this long means the team has no active coach. */
const COACH_ACTIVE_DAYS = 30;

function athleteStatus(
  sessions: number,
  completionRate: number | null,
  avgRpe: number | null,
): TeamDigestAthlete["status"] {
  if (sessions === 0) return "quiet";
  if (
    (completionRate !== null && completionRate < 0.5) ||
    (avgRpe !== null && avgRpe >= 8)
  ) {
    return "needs-attention";
  }
  return "on-track";
}

export async function getAthleteInsight(
  actorId: string,
  teamId: string,
  athleteId: string,
  ipAddress?: string,
): Promise<AthleteInsight> {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);

  const athlete = await db.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId: athleteId } },
    include: { user: { select: { displayName: true } } },
  });
  if (!athlete || athlete.status !== "ACTIVE") throw notFound("Athlete not found");

  const stats = await computeStats(athleteId, teamId, INSIGHT_DAYS);
  const provider = selectProvider();
  let generated: { highlights: string[]; watchOuts: string[]; narrative: string };
  try {
    generated = await provider.athleteNarrative({
      athleteName: athlete.user.displayName,
      periodDays: INSIGHT_DAYS,
      stats,
    });
  } catch (err) {
    // An LLM outage must never break the coach's workflow — fall back.
    const { LocalAnalyst } = await import("./providers.js");
    generated = await new LocalAnalyst().athleteNarrative({
      athleteName: athlete.user.displayName,
      periodDays: INSIGHT_DAYS,
      stats,
    });
  }

  await audit({
    actorId,
    action: "AI_INSIGHT_GENERATED",
    entityType: "User",
    entityId: athleteId,
    metadata: { teamId, provider: provider.name },
    ipAddress,
  });

  return {
    athleteId,
    athleteName: athlete.user.displayName,
    periodDays: INSIGHT_DAYS,
    stats,
    ...generated,
    provider: provider.name,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * The athlete's own 28-day insight — the same engine coaches see, but scoped
 * to the athlete themself across all their teams. No membership gate: it is
 * their own training data.
 */
export async function getMyInsight(
  userId: string,
  ipAddress?: string,
): Promise<AthleteInsight> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { displayName: true },
  });
  const stats = await computeStats(userId, undefined, INSIGHT_DAYS);
  const provider = selectProvider();
  let generated: { highlights: string[]; watchOuts: string[]; narrative: string };
  try {
    generated = await provider.athleteNarrative({
      athleteName: user.displayName,
      periodDays: INSIGHT_DAYS,
      stats,
    });
  } catch {
    const { LocalAnalyst } = await import("./providers.js");
    generated = await new LocalAnalyst().athleteNarrative({
      athleteName: user.displayName,
      periodDays: INSIGHT_DAYS,
      stats,
    });
  }
  await audit({
    actorId: userId,
    action: "AI_INSIGHT_GENERATED",
    entityType: "User",
    entityId: userId,
    metadata: { self: true, provider: provider.name },
    ipAddress,
  });
  return {
    athleteId: userId,
    athleteName: user.displayName,
    periodDays: INSIGHT_DAYS,
    stats,
    ...generated,
    provider: provider.name,
    generatedAt: new Date().toISOString(),
  };
}

export async function getTeamDigest(
  actorId: string,
  teamId: string,
  days: number,
  ipAddress?: string,
): Promise<TeamDigest> {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);

  const team = await db.team.findUniqueOrThrow({
    where: { id: teamId },
    select: { name: true },
  });
  const dormantCutoff = new Date(Date.now() - DORMANT_DAYS * 24 * 60 * 60 * 1000);
  const athletes = await db.teamMembership.findMany({
    where: { teamId, status: "ACTIVE", role: "RUNNER" },
    include: { user: { select: { displayName: true, lastLoginAt: true } } },
    orderBy: { createdAt: "asc" },
  });

  const rows: TeamDigestAthlete[] = [];
  for (const a of athletes) {
    const stats = await computeStats(a.userId, teamId, days);
    const dormant = !a.user.lastLoginAt || a.user.lastLoginAt < dormantCutoff;
    rows.push({
      athleteId: a.userId,
      athleteName: a.user.displayName,
      sessions: stats.sessions,
      activeDays: stats.activeDays,
      completionRate: stats.completionRate,
      status: athleteStatus(stats.sessions, stats.completionRate, stats.avgRpe),
      dormant,
      lastLoginAt: a.user.lastLoginAt?.toISOString() ?? null,
    });
  }
  // Dormant athletes float to the top for coach review.
  rows.sort((a, b) => Number(b.dormant) - Number(a.dormant));

  const coachCutoff = new Date(Date.now() - COACH_ACTIVE_DAYS * 24 * 60 * 60 * 1000);
  const coaches = await db.teamMembership.findMany({
    where: {
      teamId,
      status: "ACTIVE",
      role: { in: ["COACH", "TEAM_ADMIN"] },
    },
    include: { user: { select: { lastLoginAt: true } } },
  });
  const activeCoachCount = coaches.filter(
    (c) => c.user.lastLoginAt && c.user.lastLoginAt >= coachCutoff,
  ).length;
  const coachHealth = {
    coachCount: coaches.length,
    activeCoachCount,
    noActiveCoach: coaches.length > 0 && activeCoachCount === 0,
  };

  const provider = selectProvider();
  let summary: string;
  try {
    summary = await provider.teamSummary(team.name, days, rows);
  } catch {
    const { LocalAnalyst } = await import("./providers.js");
    summary = await new LocalAnalyst().teamSummary(team.name, days, rows);
  }

  await audit({
    actorId,
    action: "AI_DIGEST_GENERATED",
    entityType: "Team",
    entityId: teamId,
    metadata: { days, provider: provider.name, athletes: rows.length },
    ipAddress,
  });

  return {
    teamId,
    teamName: team.name,
    periodDays: days,
    athletes: rows,
    summary,
    provider: provider.name,
    generatedAt: new Date().toISOString(),
    coachHealth,
  };
}

/**
 * AI race analysis: deterministic pacing/splits analysis of one official
 * race result, narrated by the insight provider (LLM when configured,
 * local analyst otherwise — with fallback on outage).
 */
export async function getRaceAnalysis(
  actorId: string,
  raceResultId: string,
  ipAddress?: string,
): Promise<RaceAnalysisDTO> {
  const { getAnalyzableRaceResult } = await import("../records/service.js");
  const row = await getAnalyzableRaceResult(actorId, raceResultId);

  const distanceLabel =
    STANDARD_RACE_DISTANCES.find((d) => d.meters === row.distanceM)?.label ??
    `${row.distanceM} m`;

  const history = await db.raceResult.findMany({
    where: {
      userId: row.userId,
      distanceM: row.distanceM,
      id: { not: row.id },
    },
    orderBy: { racedAt: "desc" },
    take: 5,
  });
  const pb =
    history.length > 0
      ? Math.min(...history.map((h) => h.durationS), row.durationS)
      : row.durationS;

  const { analyzeRaceDeterministic, toRaceAnalysisDTO } = await import(
    "./raceAnalysis.js"
  );
  const det = analyzeRaceDeterministic({
    athleteName: row.user.displayName,
    raceName: row.raceName,
    distanceM: row.distanceM,
    distanceLabel,
    durationS: row.durationS,
    racedAt: row.racedAt.toISOString(),
    splits: parseSplitsLoose(row.splits),
    finishPlace: row.finishPlace,
    ageGroupPlace: row.ageGroupPlace,
    fieldSize: row.fieldSize,
    history: history.map((h) => ({
      durationS: h.durationS,
      racedAt: h.racedAt.toISOString(),
      raceName: h.raceName,
    })),
    personalBestS: pb,
  });

  const provider = selectProvider();
  let narrated: { narrative: string; cues: string[] };
  try {
    narrated = await provider.raceNarrative({
      athleteName: row.user.displayName,
      raceName: row.raceName,
      distanceLabel,
      analysis: det,
    });
  } catch {
    const { LocalAnalyst } = await import("./providers.js");
    narrated = await new LocalAnalyst().raceNarrative({
      athleteName: row.user.displayName,
      raceName: row.raceName,
      distanceLabel,
      analysis: det,
    });
  }

  await audit({
    actorId,
    action: "AI_RACE_ANALYSIS_GENERATED",
    entityType: "RaceResult",
    entityId: row.id,
    metadata: { provider: provider.name },
    ipAddress,
  });

  return toRaceAnalysisDTO(det, narrated.narrative, provider.name);
}

function parseSplitsLoose(
  raw: unknown,
): Array<{ distanceM: number; durationS: number }> | null {
  if (!Array.isArray(raw)) return null;
  const out: Array<{ distanceM: number; durationS: number }> = [];
  for (const s of raw) {
    if (
      typeof s === "object" &&
      s !== null &&
      typeof (s as any).distanceM === "number" &&
      typeof (s as any).durationS === "number" &&
      (s as any).distanceM > 0 &&
      (s as any).durationS > 0
    ) {
      out.push({
        distanceM: (s as any).distanceM,
        durationS: Math.round((s as any).durationS),
      });
    }
  }
  return out.length >= 2 ? out : null;
}
