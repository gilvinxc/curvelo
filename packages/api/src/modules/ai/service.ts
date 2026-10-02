import type {
  AthleteInsight,
  TeamDigest,
  TeamDigestAthlete,
} from "@curvelo/shared";
import { db } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { notFound } from "../../lib/errors.js";
import { activeMembership, requireManager } from "../../lib/permissions.js";
import { computeStats } from "./stats.js";
import { selectProvider } from "./llm.js";

const INSIGHT_DAYS = 28;

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
  const athletes = await db.teamMembership.findMany({
    where: { teamId, status: "ACTIVE", role: "RUNNER" },
    include: { user: { select: { displayName: true } } },
    orderBy: { createdAt: "asc" },
  });

  const rows: TeamDigestAthlete[] = [];
  for (const a of athletes) {
    const stats = await computeStats(a.userId, teamId, days);
    rows.push({
      athleteId: a.userId,
      athleteName: a.user.displayName,
      sessions: stats.sessions,
      activeDays: stats.activeDays,
      completionRate: stats.completionRate,
      status: athleteStatus(stats.sessions, stats.completionRate, stats.avgRpe),
    });
  }

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
  };
}
