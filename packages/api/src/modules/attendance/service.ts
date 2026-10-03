import type { AttendanceDTO, SaveAttendanceInput } from "@curvelo/shared";
import { db } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { AppError, notFound } from "../../lib/errors.js";
import { activeMembership, requireManager } from "../../lib/permissions.js";

type AttendanceWithJoins = {
  id: string;
  teamId: string;
  date: Date;
  eventId: string | null;
  event: { title: string } | null;
  records: unknown;
  createdBy: { displayName: string };
  createdAt: Date;
};

function recordsOf(a: AttendanceWithJoins): Record<string, boolean> {
  const r = a.records as Record<string, boolean> | null;
  return r && typeof r === "object" ? r : {};
}

function toDTO(a: AttendanceWithJoins, includeRecords: boolean): AttendanceDTO {
  const records = recordsOf(a);
  const values = Object.values(records);
  const presentCount = values.filter(Boolean).length;
  return {
    id: a.id,
    teamId: a.teamId,
    date: a.date.toISOString().slice(0, 10),
    eventId: a.eventId,
    eventTitle: a.event?.title ?? null,
    presentCount,
    absentCount: values.length - presentCount,
    presentPct: values.length > 0 ? Math.round((presentCount / values.length) * 100) : 0,
    ...(includeRecords ? { records } : {}),
    createdByName: a.createdBy.displayName,
    createdAt: a.createdAt.toISOString(),
  };
}

const WITH_JOINS = {
  event: { select: { title: true } },
  createdBy: { select: { displayName: true } },
} as const;

/**
 * Take (or re-take) attendance for a date, optionally tied to a team event.
 * Every userId in records must be an ACTIVE team member. Upserts: one record
 * per team+date+event.
 */
export async function saveAttendance(
  actorId: string,
  teamId: string,
  input: SaveAttendanceInput,
  ipAddress?: string,
): Promise<AttendanceDTO> {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);

  const userIds = Object.keys(input.records);
  const members = await db.teamMembership.findMany({
    where: { teamId, userId: { in: userIds }, status: "ACTIVE" },
    select: { userId: true },
  });
  const valid = new Set(members.map((m) => m.userId));
  const invalid = userIds.filter((id) => !valid.has(id));
  if (invalid.length > 0) {
    throw new AppError(422, "INVALID_MEMBERS", "Some people are not on this team", {
      userIds: invalid,
    });
  }

  if (input.eventId) {
    const event = await db.teamEvent.findUnique({ where: { id: input.eventId } });
    if (!event || event.teamId !== teamId) throw notFound("Event not found");
  }

  const date = new Date(input.date + "T00:00:00Z");
  const existing = await db.attendance.findFirst({
    where: { teamId, date, eventId: input.eventId ?? null },
  });

  const saved = existing
    ? await db.attendance.update({
        where: { id: existing.id },
        data: { records: input.records, createdById: actorId },
        include: WITH_JOINS,
      })
    : await db.attendance.create({
        data: {
          teamId,
          date,
          eventId: input.eventId ?? null,
          records: input.records,
          createdById: actorId,
        },
        include: WITH_JOINS,
      });

  await audit({
    actorId,
    action: "ATTENDANCE_SAVED",
    entityType: "Attendance",
    entityId: saved.id,
    metadata: { teamId, date: input.date, eventId: input.eventId ?? null, count: userIds.length },
    ipAddress,
  });

  return toDTO(saved, true);
}

/** Attendance history for the team, newest first. Coach-only. */
export async function listAttendance(
  actorId: string,
  teamId: string,
): Promise<AttendanceDTO[]> {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);
  const rows = await db.attendance.findMany({
    where: { teamId },
    include: WITH_JOINS,
    orderBy: { date: "desc" },
    take: 100,
  });
  return rows.map((r) => toDTO(r, false));
}

/** One attendance record with per-athlete present/absent + names. */
export async function getAttendance(
  actorId: string,
  teamId: string,
  attendanceId: string,
): Promise<AttendanceDTO> {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);
  const row = await db.attendance.findFirst({
    where: { id: attendanceId, teamId },
    include: WITH_JOINS,
  });
  if (!row) throw notFound("Attendance not found");

  const records = recordsOf(row);
  const users = await db.user.findMany({
    where: { id: { in: Object.keys(records) } },
    select: { id: true, displayName: true },
  });
  const names = new Map(users.map((u) => [u.id, u.displayName]));
  const dto = toDTO(row, true);
  dto.members = Object.entries(records).map(([userId, present]) => ({
    userId,
    displayName: names.get(userId) ?? "Unknown",
    present,
  }));
  dto.members.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return dto;
}
