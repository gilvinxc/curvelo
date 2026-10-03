import type {
  CreateTeamEventInput,
  TeamEventDTO,
  TeamEventRecurrence,
  UpdateTeamEventInput,
} from "@curvelo/shared";
import { Prisma } from "@prisma/client";
import { db } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { conflict, notFound } from "../../lib/errors.js";
import { activeMembership, requireManager } from "../../lib/permissions.js";

type EventRow = Prisma.TeamEventGetPayload<{
  include: { createdBy: { select: { displayName: true } } };
}>;

const EVENT_INCLUDE = {
  createdBy: { select: { displayName: true } },
} as const;

function parseRecurrence(raw: unknown): TeamEventRecurrence | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { freq?: string; days?: number[]; until?: string };
  if (r.freq !== "WEEKLY" || !Array.isArray(r.days) || typeof r.until !== "string") {
    return null;
  }
  return { freq: "WEEKLY", days: r.days, until: r.until };
}

function toDTO(e: EventRow, startAt?: Date, endAt?: Date | null): TeamEventDTO {
  return {
    id: e.id,
    teamId: e.teamId,
    title: e.title,
    description: e.description,
    eventType: e.eventType,
    startAt: (startAt ?? e.startAt).toISOString(),
    endAt: (endAt === undefined ? e.endAt : endAt)?.toISOString() ?? null,
    location: e.location,
    itinerary: e.itinerary,
    recurrence: parseRecurrence(e.recurrence),
    recurring: parseRecurrence(e.recurrence) !== null,
    createdByName: e.createdBy.displayName,
  };
}

function combineDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time}:00Z`);
}

// Monday = 0 .. Sunday = 6
function mondayBasedDay(d: Date): number {
  return (d.getUTCDay() + 6) % 7;
}

function expandRecurrence(
  e: EventRow,
  from: Date,
  to: Date,
): TeamEventDTO[] {
  const rec = parseRecurrence(e.recurrence);
  if (!rec) {
    return e.startAt >= from && e.startAt <= to ? [toDTO(e)] : [];
  }
  const days = new Set(rec.days);
  const until = new Date(rec.until + "T23:59:59Z");
  const durationMs =
    e.endAt !== null ? e.endAt.getTime() - e.startAt.getTime() : null;

  const out: TeamEventDTO[] = [];
  // Walk days from the later of `from` and the event's first date.
  const cursor = new Date(
    Math.max(from.getTime(), e.startAt.getTime() - 7 * 86400000),
  );
  cursor.setUTCHours(0, 0, 0, 0);
  const end = new Date(Math.min(to.getTime(), until.getTime()));
  for (let d = new Date(cursor); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    if (!days.has(mondayBasedDay(d))) continue;
    const start = new Date(d);
    start.setUTCHours(
      e.startAt.getUTCHours(),
      e.startAt.getUTCMinutes(),
      0,
      0,
    );
    // Don't emit occurrences before the series' first date.
    const firstDate = e.startAt.toISOString().slice(0, 10);
    if (start.toISOString().slice(0, 10) < firstDate) continue;
    if (start < from || start > to) continue;
    const endAt =
      durationMs !== null ? new Date(start.getTime() + durationMs) : null;
    out.push(toDTO(e, start, endAt));
  }
  return out.sort((a, b) => a.startAt.localeCompare(b.startAt));
}

function validateTimes(input: {
  date?: string;
  startTime?: string;
  endTime?: string | null;
}) {
  if (input.startTime && input.endTime && input.endTime <= input.startTime) {
    throw conflict("INVALID_TIME", "End time must be after start time");
  }
}

export async function listTeamEvents(
  actorId: string,
  teamId: string,
  from: string,
  to: string,
): Promise<TeamEventDTO[]> {
  await activeMembership(actorId, teamId);
  const fromDate = new Date(from + "T00:00:00Z");
  const toDate = new Date(to + "T23:59:59Z");

  const events = await db.teamEvent.findMany({
    where: { teamId },
    include: EVENT_INCLUDE,
    orderBy: { startAt: "asc" },
  });

  return events.flatMap((e) => expandRecurrence(e, fromDate, toDate));
}

export async function createTeamEvent(
  actorId: string,
  teamId: string,
  input: CreateTeamEventInput,
  ipAddress?: string,
): Promise<TeamEventDTO> {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);
  validateTimes(input);
  if (input.recurrence && input.recurrence.until < input.date) {
    throw conflict("INVALID_RECURRENCE", "Repeat-until must be on or after the first date");
  }

  const startAt = combineDateTime(input.date, input.startTime);
  const endAt = input.endTime ? combineDateTime(input.date, input.endTime) : null;

  const event = await db.teamEvent.create({
    data: {
      teamId,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      eventType: input.eventType,
      startAt,
      endAt,
      location: input.location?.trim() || null,
      itinerary: input.itinerary?.trim() || null,
      recurrence: input.recurrence ? { ...input.recurrence } : Prisma.DbNull,
      createdById: actorId,
    },
    include: EVENT_INCLUDE,
  });

  await audit({
    actorId,
    action: "TEAM_EVENT_CREATED",
    entityType: "TeamEvent",
    entityId: event.id,
    metadata: { teamId, title: event.title, eventType: event.eventType },
    ipAddress,
  });
  return toDTO(event);
}

async function getEventOrThrow(eventId: string, teamId: string) {
  const event = await db.teamEvent.findUnique({
    where: { id: eventId },
    include: EVENT_INCLUDE,
  });
  if (!event || event.teamId !== teamId) throw notFound("Event not found");
  return event;
}

export async function updateTeamEvent(
  actorId: string,
  teamId: string,
  eventId: string,
  input: UpdateTeamEventInput,
  ipAddress?: string,
): Promise<TeamEventDTO> {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);
  const existing = await getEventOrThrow(eventId, teamId);

  const date =
    input.date ?? existing.startAt.toISOString().slice(0, 10);
  const startTime =
    input.startTime ??
    existing.startAt.toISOString().slice(11, 16);
  validateTimes({ startTime, endTime: input.endTime });

  const event = await db.teamEvent.update({
    where: { id: eventId },
    data: {
      title: input.title?.trim(),
      description:
        input.description === undefined ? undefined : input.description?.trim() || null,
      eventType: input.eventType,
      startAt: input.date || input.startTime ? combineDateTime(date, startTime) : undefined,
      endAt:
        input.endTime === undefined
          ? undefined
          : input.endTime
            ? combineDateTime(date, input.endTime)
            : null,
      location:
        input.location === undefined ? undefined : input.location?.trim() || null,
      itinerary:
        input.itinerary === undefined ? undefined : input.itinerary?.trim() || null,
      recurrence:
        input.recurrence === undefined
          ? undefined
          : input.recurrence
            ? { ...input.recurrence }
            : Prisma.DbNull,
    },
    include: EVENT_INCLUDE,
  });

  await audit({
    actorId,
    action: "TEAM_EVENT_UPDATED",
    entityType: "TeamEvent",
    entityId: event.id,
    metadata: { teamId, fields: Object.keys(input) },
    ipAddress,
  });
  return toDTO(event);
}

export async function deleteTeamEvent(
  actorId: string,
  teamId: string,
  eventId: string,
  ipAddress?: string,
): Promise<void> {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);
  const event = await getEventOrThrow(eventId, teamId);
  await db.teamEvent.delete({ where: { id: eventId } });
  await audit({
    actorId,
    action: "TEAM_EVENT_DELETED",
    entityType: "TeamEvent",
    entityId: eventId,
    metadata: { teamId, title: event.title },
    ipAddress,
  });
}

/** Events across all of the user's active teams. */
export async function myTeamEvents(
  actorId: string,
  from: string,
  to: string,
): Promise<TeamEventDTO[]> {
  const memberships = await db.teamMembership.findMany({
    where: { userId: actorId, status: "ACTIVE" },
    select: { teamId: true, team: { select: { name: true } } },
  });
  const out: TeamEventDTO[] = [];
  for (const m of memberships) {
    const events = await listTeamEvents(actorId, m.teamId, from, to);
    out.push(...events.map((e) => ({ ...e, teamName: m.team.name })));
  }
  return out.sort((a, b) => a.startAt.localeCompare(b.startAt));
}
