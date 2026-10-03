import type {
  CreateRaceResultInput,
  CreateShoeInput,
  LogTeamRaceInput,
  UpdateShoeInput,
} from "@curvelo/shared";
import { STANDARD_RACE_DISTANCES } from "@curvelo/shared";
import type {
  PersonalRecordDTO,
  RaceResultDTO,
  ShoeDTO,
  TeamRecordDTO,
} from "@curvelo/shared";
import { db } from "../../db.js";
import { AppError, forbidden, notFound } from "../../lib/errors.js";
import { activeMembership, requireManager } from "../../lib/permissions.js";
import { audit } from "../../lib/audit.js";

const distanceLabel = (meters: number): string =>
  STANDARD_RACE_DISTANCES.find((d) => d.meters === meters)?.label ??
  `${meters} m`;

// ---------------------------------------------------------------------------
// Race results (official: exact distance, exact time)
// ---------------------------------------------------------------------------

function parseSplits(
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

function toRaceResultDTO(r: {
  id: string;
  raceName: string;
  distanceM: number;
  durationS: number;
  racedAt: Date;
  activityId: string | null;
  splits: unknown;
  finishPlace: number | null;
  ageGroupPlace: number | null;
  fieldSize: number | null;
}): RaceResultDTO {
  return {
    id: r.id,
    raceName: r.raceName,
    distanceM: r.distanceM,
    durationS: r.durationS,
    racedAt: r.racedAt.toISOString(),
    activityId: r.activityId,
    splits: parseSplits(r.splits),
    finishPlace: r.finishPlace,
    ageGroupPlace: r.ageGroupPlace,
    fieldSize: r.fieldSize,
  };
}

export async function createRaceResult(
  userId: string,
  input: CreateRaceResultInput,
  ipAddress?: string,
  onBehalfOf?: { userId: string; loggedByUserId: string },
): Promise<RaceResultDTO> {
  const ownerId = onBehalfOf?.userId ?? userId;
  if (input.activityId) {
    const activity = await db.activity.findFirst({
      where: { id: input.activityId, userId: ownerId },
    });
    if (!activity) throw notFound("Activity not found");
  }
  const result = await db.raceResult.create({
    data: {
      userId: ownerId,
      raceName: input.raceName,
      distanceM: input.distanceM,
      durationS: input.durationS,
      racedAt: new Date(input.racedAt),
      activityId: input.activityId ?? null,
      splits: input.splits ?? undefined,
      finishPlace: input.finishPlace ?? null,
      ageGroupPlace: input.ageGroupPlace ?? null,
      fieldSize: input.fieldSize ?? null,
    },
  });
  await audit({
    actorId: userId,
    action: "RACE_RESULT_CREATED",
    entityType: "RaceResult",
    entityId: result.id,
    metadata: {
      distanceM: result.distanceM,
      ...(onBehalfOf ? { onBehalfOf: onBehalfOf.userId } : {}),
    },
    ipAddress,
  });
  return toRaceResultDTO(result);
}

export async function listMyRaceResults(userId: string): Promise<RaceResultDTO[]> {
  const rows = await db.raceResult.findMany({
    where: { userId },
    orderBy: { racedAt: "desc" },
  });
  return rows.map(toRaceResultDTO);
}

export async function deleteRaceResult(
  userId: string,
  raceResultId: string,
  ipAddress?: string,
): Promise<{ ok: true }> {
  const row = await db.raceResult.findFirst({ where: { id: raceResultId, userId } });
  if (!row) throw notFound("Race result not found");
  await db.raceResult.delete({ where: { id: row.id } });
  await audit({
    actorId: userId,
    action: "RACE_RESULT_DELETED",
    entityType: "RaceResult",
    entityId: row.id,
    ipAddress,
  });
  return { ok: true as const };
}

/**
 * Coach bulk race entry: official results for many athletes in one race.
 * Each athlete gets their own result; times/places/splits are per athlete.
 */
export async function logTeamRaceResults(
  coachId: string,
  input: LogTeamRaceInput,
  ipAddress?: string,
): Promise<{ count: number; raceResultIds: string[] }> {
  const membership = await activeMembership(coachId, input.teamId);
  requireManager(membership);

  const members = await db.teamMembership.findMany({
    where: {
      teamId: input.teamId,
      userId: { in: input.entries.map((e) => e.userId) },
      status: "ACTIVE",
    },
    select: { userId: true },
  });
  const found = new Set(members.map((m) => m.userId));
  const missing = input.entries.filter((e) => !found.has(e.userId));
  if (missing.length > 0) {
    throw forbidden("Some athletes are not on this team");
  }

  const ids: string[] = [];
  for (const entry of input.entries) {
    if (
      entry.finishPlace !== undefined &&
      input.fieldSize !== undefined &&
      entry.finishPlace > input.fieldSize
    ) {
      throw new AppError(
        400,
        "PLACE_EXCEEDS_FIELD",
        "Finish place can't be larger than the field size",
      );
    }
    const created = await createRaceResult(
      coachId,
      {
        raceName: input.raceName,
        distanceM: input.distanceM,
        durationS: entry.durationS,
        racedAt: input.racedAt,
        splits: entry.splits,
        finishPlace: entry.finishPlace,
        ageGroupPlace: entry.ageGroupPlace,
        fieldSize: input.fieldSize,
      },
      ipAddress,
      { userId: entry.userId, loggedByUserId: coachId },
    );
    ids.push(created.id);
  }

  await audit({
    actorId: coachId,
    action: "TEAM_RACE_LOGGED",
    entityType: "Team",
    entityId: input.teamId,
    metadata: { count: ids.length, raceName: input.raceName },
    ipAddress,
  });

  return { count: ids.length, raceResultIds: ids };
}

/** Fetch a race result the actor is allowed to analyze: the owner, or a coach/admin of any team the athlete is on. */
export async function getAnalyzableRaceResult(actorId: string, raceResultId: string) {
  const row = await db.raceResult.findUnique({
    where: { id: raceResultId },
    include: { user: { select: { id: true, displayName: true } } },
  });
  if (!row) throw notFound("Race result not found");
  if (row.userId !== actorId) {
    const memberships = await db.teamMembership.findMany({
      where: { userId: row.userId, status: "ACTIVE" },
      select: { teamId: true },
    });
    let manager = false;
    for (const m of memberships) {
      const mine = await activeMembership(actorId, m.teamId).catch(() => null);
      if (mine && (mine.role === "COACH" || mine.role === "TEAM_ADMIN")) {
        manager = true;
        break;
      }
    }
    if (!manager) throw forbidden("You cannot view this race result");
  }
  return row;
}

/** Personal bests: best official time at each standard distance. */
export async function getPersonalRecords(userId: string): Promise<PersonalRecordDTO[]> {
  const rows = await db.raceResult.findMany({
    where: { userId, distanceM: { in: STANDARD_RACE_DISTANCES.map((d) => d.meters) } },
    orderBy: [{ distanceM: "asc" }, { durationS: "asc" }],
  });
  const best = new Map<number, (typeof rows)[number]>();
  for (const r of rows) {
    if (!best.has(r.distanceM)) best.set(r.distanceM, r);
  }
  return [...best.values()]
    .sort((a, b) => a.distanceM - b.distanceM)
    .map((r) => ({
      distanceM: r.distanceM,
      label: distanceLabel(r.distanceM),
      durationS: r.durationS,
      raceName: r.raceName,
      racedAt: r.racedAt.toISOString(),
    }));
}

/**
 * Team records: the best official time at each standard distance across
 * team members. A result linked to a PRIVATE activity never counts.
 */
export async function getTeamRecords(
  userId: string,
  teamId: string,
): Promise<TeamRecordDTO[]> {
  await activeMembership(userId, teamId);
  const members = await db.teamMembership.findMany({
    where: { teamId, status: "ACTIVE" },
    select: { userId: true, user: { select: { displayName: true } } },
  });
  const names = new Map(members.map((m) => [m.userId, m.user.displayName]));
  const rows = await db.raceResult.findMany({
    where: {
      userId: { in: members.map((m) => m.userId) },
      distanceM: { in: STANDARD_RACE_DISTANCES.map((d) => d.meters) },
      OR: [{ activityId: null }, { activity: { visibility: "TEAM" } }],
    },
    orderBy: [{ distanceM: "asc" }, { durationS: "asc" }],
  });
  const best = new Map<number, (typeof rows)[number]>();
  for (const r of rows) {
    if (!best.has(r.distanceM)) best.set(r.distanceM, r);
  }
  return [...best.values()]
    .sort((a, b) => a.distanceM - b.distanceM)
    .map((r) => ({
      distanceM: r.distanceM,
      label: distanceLabel(r.distanceM),
      durationS: r.durationS,
      raceName: r.raceName,
      racedAt: r.racedAt.toISOString(),
      userId: r.userId,
      displayName: names.get(r.userId) ?? "Runner",
    }));
}

/**
 * Lineup helper: rank active runners by their best official time at one
 * distance in the last 12 months. Read-only — the coach always decides.
 */
export async function getLineup(
  actorId: string,
  teamId: string,
  distanceM: number,
): Promise<
  Array<{
    userId: string;
    displayName: string;
    durationS: number;
    raceName: string;
    racedAt: string;
  }>
> {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);

  const members = await db.teamMembership.findMany({
    where: { teamId, status: "ACTIVE", role: "RUNNER" },
    select: { userId: true, user: { select: { displayName: true } } },
  });
  const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const rows = await db.raceResult.findMany({
    where: {
      userId: { in: members.map((m) => m.userId) },
      distanceM,
      racedAt: { gte: since },
      OR: [{ activityId: null }, { activity: { visibility: "TEAM" } }],
    },
    orderBy: { durationS: "asc" },
  });
  const best = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    if (!best.has(r.userId)) best.set(r.userId, r);
  }
  const names = new Map(members.map((m) => [m.userId, m.user.displayName]));
  return [...best.values()]
    .sort((a, b) => a.durationS - b.durationS)
    .map((r) => ({
      userId: r.userId,
      displayName: names.get(r.userId) ?? "Runner",
      durationS: r.durationS,
      raceName: r.raceName,
      racedAt: r.racedAt.toISOString().slice(0, 10),
    }));
}

// ---------------------------------------------------------------------------
// Shoes
// ---------------------------------------------------------------------------

async function shoeMileageM(shoeId: string): Promise<number> {
  const agg = await db.activity.aggregate({
    where: { shoeId },
    _sum: { distanceM: true },
  });
  return agg._sum.distanceM ?? 0;
}

function toShoeDTO(
  s: {
    id: string;
    name: string;
    brand: string | null;
    model: string | null;
    retired: boolean;
    retiredAt: Date | null;
    isDefault: boolean;
    lifespanM: number;
    createdAt: Date;
  },
  mileageM: number,
): ShoeDTO {
  return {
    id: s.id,
    name: s.name,
    brand: s.brand,
    model: s.model,
    retired: s.retired,
    retiredAt: s.retiredAt?.toISOString() ?? null,
    isDefault: s.isDefault,
    mileageM,
    lifespanM: s.lifespanM,
    createdAt: s.createdAt.toISOString(),
  };
}

export async function createShoe(
  userId: string,
  input: CreateShoeInput,
  ipAddress?: string,
): Promise<ShoeDTO> {
  const shoe = await db.shoe.create({
    data: {
      userId,
      name: input.name,
      brand: input.brand?.trim() || null,
      model: input.model?.trim() || null,
    },
  });
  await audit({
    actorId: userId,
    action: "SHOE_CREATED",
    entityType: "Shoe",
    entityId: shoe.id,
    ipAddress,
  });
  return toShoeDTO(shoe, 0);
}

export async function listShoes(userId: string): Promise<ShoeDTO[]> {
  const shoes = await db.shoe.findMany({
    where: { userId },
    orderBy: [{ retired: "asc" }, { createdAt: "desc" }],
  });
  const out: ShoeDTO[] = [];
  for (const s of shoes) {
    out.push(toShoeDTO(s, await shoeMileageM(s.id)));
  }
  return out;
}

export async function updateShoe(
  userId: string,
  shoeId: string,
  input: UpdateShoeInput,
  ipAddress?: string,
): Promise<ShoeDTO> {
  const shoe = await db.shoe.findFirst({ where: { id: shoeId, userId } });
  if (!shoe) throw notFound("Shoe not found");
  const updated = await db.shoe.update({
    where: { id: shoe.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.brand !== undefined ? { brand: input.brand?.trim() || null } : {}),
      ...(input.model !== undefined ? { model: input.model?.trim() || null } : {}),
      ...(input.retired !== undefined
        ? {
            retired: input.retired,
            retiredAt: input.retired ? new Date() : null,
            // Retiring the default shoe clears the default.
            ...(input.retired && shoe.isDefault ? { isDefault: false } : {}),
          }
        : {}),
      ...(input.lifespanM !== undefined ? { lifespanM: input.lifespanM } : {}),
    },
  });
  await audit({
    actorId: userId,
    action: "SHOE_UPDATED",
    entityType: "Shoe",
    entityId: shoe.id,
    metadata: { retired: updated.retired },
    ipAddress,
  });
  return toShoeDTO(updated, await shoeMileageM(shoe.id));
}

export async function deleteShoe(
  userId: string,
  shoeId: string,
  ipAddress?: string,
): Promise<{ ok: true }> {
  const shoe = await db.shoe.findFirst({ where: { id: shoeId, userId } });
  if (!shoe) throw notFound("Shoe not found");
  const used = await db.activity.count({ where: { shoeId } });
  if (used > 0) {
    throw new AppError(
      400,
      "SHOE_IN_USE",
      "Retire this shoe instead — it's linked to logged runs.",
    );
  }
  await db.shoe.delete({ where: { id: shoe.id } });
  await audit({
    actorId: userId,
    action: "SHOE_DELETED",
    entityType: "Shoe",
    entityId: shoe.id,
    ipAddress,
  });
  return { ok: true as const };
}

/** Set one shoe as the default; it stays default until changed or retired. */
export async function setDefaultShoe(
  userId: string,
  shoeId: string,
  ipAddress?: string,
): Promise<ShoeDTO> {
  const shoe = await db.shoe.findFirst({ where: { id: shoeId, userId } });
  if (!shoe) throw notFound("Shoe not found");
  if (shoe.retired) {
    throw new AppError(400, "SHOE_RETIRED", "Retired shoes can't be the default.");
  }
  const [updated] = await db.$transaction([
    db.shoe.updateMany({ where: { userId }, data: { isDefault: false } }),
    db.shoe.update({ where: { id: shoe.id }, data: { isDefault: true } }),
  ]);
  void updated;
  const fresh = await db.shoe.findUniqueOrThrow({ where: { id: shoe.id } });
  await audit({
    actorId: userId,
    action: "SHOE_DEFAULT_SET",
    entityType: "Shoe",
    entityId: shoe.id,
    ipAddress,
  });
  return toShoeDTO(fresh, await shoeMileageM(shoe.id));
}

/** The user's default shoe id, or null when none / retired. */
export async function getDefaultShoeId(userId: string): Promise<string | null> {
  const shoe = await db.shoe.findFirst({
    where: { userId, isDefault: true, retired: false },
    select: { id: true },
  });
  return shoe?.id ?? null;
}

/** Validate that a shoe belongs to the user (for activity logging). */
export async function assertOwnShoe(userId: string, shoeId: string): Promise<void> {
  const shoe = await db.shoe.findFirst({ where: { id: shoeId, userId } });
  if (!shoe) throw forbidden("Shoe not found");
  if (shoe.retired) throw new AppError(400, "SHOE_RETIRED", "That shoe is retired.");
}

