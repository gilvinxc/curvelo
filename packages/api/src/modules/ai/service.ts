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
import {
  activeMembership,
  canManageTeam,
  isGroupLeaderOf,
  requireManager,
} from "../../lib/permissions.js";
import { forbidden } from "../../lib/errors.js";
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

type DigestMembership = {
  userId: string;
  user: { displayName: string; lastLoginAt: Date | null; hasAvatar: boolean };
};

async function digestRows(
  athletes: DigestMembership[],
  teamId: string,
  days: number,
): Promise<TeamDigestAthlete[]> {
  const dormantCutoff = new Date(Date.now() - DORMANT_DAYS * 24 * 60 * 60 * 1000);
  const rows: TeamDigestAthlete[] = [];
  for (const a of athletes) {
    const stats = await computeStats(a.userId, teamId, days);
    const dormant = !a.user.lastLoginAt || a.user.lastLoginAt < dormantCutoff;
    rows.push({
      athleteId: a.userId,
      athleteName: a.user.displayName,
      hasAvatar: a.user.hasAvatar,
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
  return rows;
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
    include: { user: { select: { displayName: true, lastLoginAt: true, hasAvatar: true } } },
    orderBy: { createdAt: "asc" },
  });

  const rows = await digestRows(athletes, teamId, days);

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

/**
 * Draft an alumni-facing team update. Coach-only. Returns a draft for the
 * coach to review and publish — the AI never posts on its own.
 */
export async function draftAlumniDigest(
  actorId: string,
  teamId: string,
  days = 14,
): Promise<{ draft: string; highlights: number }> {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);

  const team = await db.team.findUniqueOrThrow({
    where: { id: teamId },
    select: { name: true },
  });

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Verified highlights only: milestones, shoutouts, welcomes.
  const posts = await db.feedPost.findMany({
    where: {
      teamId,
      createdAt: { gte: since },
      kind: { in: ["MILESTONE", "SHOUTOUT", "WELCOME"] },
    },
    select: { kind: true, body: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  // Recent announcements (coach-written, already alumni-safe).
  const announcements = await db.conversation.findFirst({
    where: { teamId, kind: "ANNOUNCEMENT" },
    select: { id: true },
  });
  const announcementTexts: Array<{ text: string; date: string }> = [];
  if (announcements) {
    const msgs = await db.message.findMany({
      where: { conversationId: announcements.id, createdAt: { gte: since } },
      select: { body: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    for (const m of msgs) {
      announcementTexts.push({
        text: m.body.slice(0, 300),
        date: m.createdAt.toISOString().slice(0, 10),
      });
    }
  }

  const highlights = [
    ...posts.map((p) => ({
      kind: p.kind as "MILESTONE" | "SHOUTOUT" | "WELCOME",
      text: (p.body ?? "").slice(0, 300),
      date: p.createdAt.toISOString().slice(0, 10),
    })),
    ...announcementTexts.map((a) => ({
      kind: "ANNOUNCEMENT" as const,
      text: a.text,
      date: a.date,
    })),
  ];

  const provider = selectProvider();
  let draft: string;
  try {
    ({ draft } = await provider.alumniDigest({
      teamName: team.name,
      days,
      highlights,
    }));
  } catch {
    const { LocalAnalyst } = await import("./providers.js");
    ({ draft } = await new LocalAnalyst().alumniDigest({
      teamName: team.name,
      days,
      highlights,
    }));
  }

  await audit({
    actorId,
    action: "AI_ALUMNI_DIGEST_DRAFTED",
    entityType: "Team",
    entityId: teamId,
    metadata: { days, highlights: highlights.length },
    ipAddress: undefined,
  });

  return { draft, highlights: highlights.length };
}

/**
 * Draft a parent-friendly weekly recap. Coach-only. Returns a draft for the
 * coach to review and publish — the AI never posts on its own. Only narrates
 * verified stats: team-visible activity totals, race results, and feed
 * milestones/shoutouts from the last 7 days.
 */
export async function draftWeeklyRecap(
  actorId: string,
  teamId: string,
): Promise<{ draft: string; races: number; highlights: number }> {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);

  const team = await db.team.findUniqueOrThrow({
    where: { id: teamId },
    select: { name: true },
  });

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const weekLabel = `week of ${since.toISOString().slice(0, 10)}`;

  // Team-visible activities in the last 7 days (roster members only).
  const memberIds = (
    await db.teamMembership.findMany({
      where: { teamId, status: "ACTIVE" },
      select: { userId: true },
    })
  ).map((m) => m.userId);

  const activities = await db.activity.findMany({
    where: {
      userId: { in: memberIds },
      visibility: "TEAM",
      startedAt: { gte: since },
    },
    select: { distanceM: true },
  });
  const totalMeters = activities.reduce((sum, a) => sum + (a.distanceM ?? 0), 0);

  // Race results in the last 7 days.
  const raceRows = await db.raceResult.findMany({
    where: { userId: { in: memberIds }, racedAt: { gte: since } },
    include: { user: { select: { displayName: true } } },
    orderBy: { racedAt: "desc" },
    take: 20,
  });
  const races = raceRows.map((r) => ({
    athleteFirstName: r.user.displayName.split(" ")[0],
    raceName: r.raceName,
    distanceLabel:
      STANDARD_RACE_DISTANCES.find((d) => d.meters === r.distanceM)?.label ??
      `${(r.distanceM / 1000).toFixed(1)}K`,
    timeLabel: formatDurationS(r.durationS),
    place: r.finishPlace,
    date: r.racedAt.toISOString().slice(0, 10),
  }));

  // Feed highlights: milestones, shoutouts, welcomes.
  const posts = await db.feedPost.findMany({
    where: {
      teamId,
      createdAt: { gte: since },
      kind: { in: ["MILESTONE", "SHOUTOUT", "WELCOME"] },
    },
    select: { kind: true, body: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const highlights = posts.map((p) => ({
    kind: p.kind as "MILESTONE" | "SHOUTOUT" | "WELCOME",
    text: (p.body ?? "").slice(0, 300),
    date: p.createdAt.toISOString().slice(0, 10),
  }));

  const provider = selectProvider();
  let draft: string;
  const input = {
    teamName: team.name,
    weekLabel,
    totalMiles: totalMeters / 1609.34,
    runCount: activities.length,
    races,
    highlights,
  };
  try {
    ({ draft } = await provider.weeklyRecap(input));
  } catch {
    const { LocalAnalyst } = await import("./providers.js");
    ({ draft } = await new LocalAnalyst().weeklyRecap(input));
  }

  await audit({
    actorId,
    action: "AI_WEEKLY_RECAP_DRAFTED",
    entityType: "Team",
    entityId: teamId,
    metadata: { races: races.length, highlights: highlights.length },
    ipAddress: undefined,
  });

  return { draft, races: races.length, highlights: highlights.length };
}

function formatDurationS(totalS: number): string {
  const h = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const s = totalS % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Coaching insights scoped to one training group — for assistant coaches.
 * The group's leader or a team manager may view it. Returns the same
 * athlete rows as the team digest but only for the group's runners.
 */
export async function getGroupDigest(
  actorId: string,
  groupId: string,
  days: number,
): Promise<TeamDigest> {
  const group = await db.teamGroup.findUnique({
    where: { id: groupId },
    include: {
      team: { select: { name: true } },
      members: {
        include: {
          user: { select: { displayName: true, lastLoginAt: true, hasAvatar: true } },
        },
      },
    },
  });
  if (!group) throw notFound("Group not found");

  const membership = await activeMembership(actorId, group.teamId);
  const team = await db.team.findUniqueOrThrow({
    where: { id: group.teamId },
    select: { ownerId: true },
  });
  const isOwner = team.ownerId === actorId;
  const leader = await isGroupLeaderOf(actorId, groupId);
  let allowed = isOwner || leader;
  if (!allowed && canManageTeam(membership)) {
    // Full managers may view any group's digest; designated leaders are
    // scoped to the groups they lead.
    const ledCount = await db.teamGroup.count({
      where: { teamId: group.teamId, leaderId: actorId },
    });
    allowed = ledCount === 0;
  }
  if (!allowed) {
    throw forbidden("Only this group's leader or a team manager can view this");
  }

  // Only runners get digest rows.
  const runnerIds = new Set(
    (
      await db.teamMembership.findMany({
        where: {
          teamId: group.teamId,
          status: "ACTIVE",
          role: "RUNNER",
          userId: { in: group.members.map((m) => m.userId) },
        },
        select: { userId: true },
      })
    ).map((m) => m.userId),
  );
  const athletes = group.members
    .filter((m) => runnerIds.has(m.userId))
    .map((m) => ({ userId: m.userId, user: m.user }));

  const rows = await digestRows(athletes, group.teamId, days);
  const provider = selectProvider();
  let summary: string;
  try {
    summary = await provider.teamSummary(`${group.team.name} — ${group.name}`, days, rows);
  } catch {
    const { LocalAnalyst } = await import("./providers.js");
    summary = await new LocalAnalyst().teamSummary(
      `${group.team.name} — ${group.name}`,
      days,
      rows,
    );
  }

  await audit({
    actorId,
    action: "AI_DIGEST_GENERATED",
    entityType: "TeamGroup",
    entityId: groupId,
    metadata: { days, provider: provider.name, athletes: rows.length },
  });

  return {
    teamId: group.teamId,
    teamName: `${group.team.name} — ${group.name}`,
    periodDays: days,
    athletes: rows,
    summary,
    provider: provider.name,
    generatedAt: new Date().toISOString(),
    coachHealth: { coachCount: 0, activeCoachCount: 0, noActiveCoach: false },
  };
}
