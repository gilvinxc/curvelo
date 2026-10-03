import type {
  ActiveSeasonDTO,
  SeasonDTO,
  SeasonWeekDTO,
} from "@curvelo/shared";
import { db } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { forbidden, notFound } from "../../lib/errors.js";
import { activeMembership } from "../../lib/permissions.js";

function toDTO(s: {
  id: string;
  teamId: string;
  name: string;
  startsAt: Date;
  endsAt: Date;
  isActive: boolean;
  championshipName: string | null;
  championshipDate: Date | null;
}): SeasonDTO {
  return {
    id: s.id,
    teamId: s.teamId,
    name: s.name,
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    isActive: s.isActive,
    championshipName: s.championshipName,
    championshipDate: s.championshipDate?.toISOString() ?? null,
  };
}

function requireCoachRole(role: string): void {
  if (role !== "COACH") throw forbidden("Coaches only");
}

/** Alumni (outer tier) get nothing beyond announcements. */
function requireNotAlumni(role: string): void {
  if (role === "ALUMNI") throw forbidden("Not available to alumni");
}

export interface SeasonInput {
  name: string;
  startsAt: string;
  endsAt: string;
  championshipName?: string | null;
  championshipDate?: string | null;
}

export async function createSeason(
  actorId: string,
  teamId: string,
  input: SeasonInput,
  ipAddress?: string,
): Promise<SeasonDTO> {
  const membership = await activeMembership(actorId, teamId);
  requireCoachRole(membership.role);
  const season = await db.season.create({
    data: {
      teamId,
      name: input.name.trim(),
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      championshipName: input.championshipName?.trim() || null,
      championshipDate: input.championshipDate
        ? new Date(input.championshipDate)
        : null,
      createdById: actorId,
    },
  });
  await audit({
    actorId,
    action: "SEASON_CREATED",
    entityType: "Team",
    entityId: teamId,
    metadata: { seasonId: season.id, name: season.name },
    ipAddress,
  });
  return toDTO(season);
}

export async function listSeasons(
  actorId: string,
  teamId: string,
): Promise<SeasonDTO[]> {
  const membership = await activeMembership(actorId, teamId);
  requireNotAlumni(membership.role);
  const seasons = await db.season.findMany({
    where: { teamId },
    orderBy: { startsAt: "desc" },
  });
  return seasons.map(toDTO);
}

export async function updateSeason(
  actorId: string,
  teamId: string,
  seasonId: string,
  input: Partial<SeasonInput>,
  ipAddress?: string,
): Promise<SeasonDTO> {
  const membership = await activeMembership(actorId, teamId);
  requireCoachRole(membership.role);
  const existing = await db.season.findFirst({
    where: { id: seasonId, teamId },
  });
  if (!existing) throw notFound("Season not found");
  const season = await db.season.update({
    where: { id: seasonId },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.startsAt !== undefined ? { startsAt: new Date(input.startsAt) } : {}),
      ...(input.endsAt !== undefined ? { endsAt: new Date(input.endsAt) } : {}),
      ...(input.championshipName !== undefined
        ? { championshipName: input.championshipName?.trim() || null }
        : {}),
      ...(input.championshipDate !== undefined
        ? {
            championshipDate: input.championshipDate
              ? new Date(input.championshipDate)
              : null,
          }
        : {}),
    },
  });
  await audit({
    actorId,
    action: "SEASON_UPDATED",
    entityType: "Team",
    entityId: teamId,
    metadata: { seasonId },
    ipAddress,
  });
  return toDTO(season);
}

export async function deleteSeason(
  actorId: string,
  teamId: string,
  seasonId: string,
  ipAddress?: string,
): Promise<void> {
  const membership = await activeMembership(actorId, teamId);
  requireCoachRole(membership.role);
  const existing = await db.season.findFirst({
    where: { id: seasonId, teamId },
  });
  if (!existing) throw notFound("Season not found");
  await db.season.delete({ where: { id: seasonId } });
  await audit({
    actorId,
    action: "SEASON_DELETED",
    entityType: "Team",
    entityId: teamId,
    metadata: { seasonId },
    ipAddress,
  });
}

/** Monday of the week containing `d` (UTC). */
function weekStartOf(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7; // Monday = 0
  x.setUTCDate(x.getUTCDate() - dow);
  return x;
}

export async function activeSeason(
  actorId: string,
  teamId: string,
): Promise<ActiveSeasonDTO | null> {
  const membership = await activeMembership(actorId, teamId);
  requireNotAlumni(membership.role);
  const isCoach = membership.role === "COACH";

  const now = new Date();
  const seasons = await db.season.findMany({
    where: { teamId },
    orderBy: { startsAt: "asc" },
  });
  if (seasons.length === 0) return null;
  // The season containing today wins; otherwise the next upcoming one.
  const season =
    seasons.find((s) => s.startsAt <= now && now <= s.endsAt) ??
    seasons.find((s) => s.startsAt > now) ??
    seasons[seasons.length - 1];
  if (!season) return null;

  // Weeks from the Monday of the start week through the end week.
  const weeks: Date[] = [];
  for (
    let w = weekStartOf(season.startsAt);
    w <= season.endsAt;
    w = new Date(w.getTime() + 7 * 86400_000)
  ) {
    weeks.push(w);
  }

  const [activities, events, injuries] = await Promise.all([
    db.activity.findMany({
      where: {
        teamId,
        visibility: "TEAM",
        startedAt: { gte: season.startsAt, lte: season.endsAt },
      },
      select: { distanceM: true, startedAt: true },
    }),
    db.teamEvent.findMany({
      where: {
        teamId,
        eventType: "RACE",
        startAt: { gte: season.startsAt, lte: season.endsAt },
      },
      select: { id: true, title: true, startAt: true },
      orderBy: { startAt: "asc" },
    }),
    isCoach
      ? db.injury.findMany({
          where: {
            teamId,
            createdAt: { gte: season.startsAt, lte: season.endsAt },
          },
          select: { createdAt: true },
        })
      : Promise.resolve([]),
  ]);

  const weekData: SeasonWeekDTO[] = weeks.map((w) => {
    const wEnd = new Date(w.getTime() + 7 * 86400_000);
    const milesM = activities
      .filter((a) => a.startedAt >= w && a.startedAt < wEnd)
      .reduce((sum, a) => sum + (a.distanceM ?? 0), 0);
    const races = events
      .filter((e) => e.startAt >= w && e.startAt < wEnd)
      .map((e) => ({
        id: e.id,
        title: e.title,
        date: e.startAt.toISOString().slice(0, 10),
      }));
    const injuryCount = isCoach
      ? injuries.filter((i) => i.createdAt >= w && i.createdAt < wEnd).length
      : null;
    return {
      weekStart: w.toISOString().slice(0, 10),
      milesM: Math.round(milesM),
      races,
      injuryCount,
    };
  });

  let daysToChampionship: number | null = null;
  if (season.championshipDate) {
    const ms =
      Date.UTC(
        season.championshipDate.getUTCFullYear(),
        season.championshipDate.getUTCMonth(),
        season.championshipDate.getUTCDate(),
      ) -
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    daysToChampionship = Math.round(ms / 86400_000);
  }

  return { season: toDTO(season), daysToChampionship, weeks: weekData };
}
