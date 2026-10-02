import type {
  CreateRaceResultInput,
  CreateShoeInput,
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
import { activeMembership } from "../../lib/permissions.js";
import { audit } from "../../lib/audit.js";

const distanceLabel = (meters: number): string =>
  STANDARD_RACE_DISTANCES.find((d) => d.meters === meters)?.label ??
  `${meters} m`;

// ---------------------------------------------------------------------------
// Race results (official: exact distance, exact time)
// ---------------------------------------------------------------------------

function toRaceResultDTO(r: {
  id: string;
  raceName: string;
  distanceM: number;
  durationS: number;
  racedAt: Date;
  activityId: string | null;
}): RaceResultDTO {
  return {
    id: r.id,
    raceName: r.raceName,
    distanceM: r.distanceM,
    durationS: r.durationS,
    racedAt: r.racedAt.toISOString(),
    activityId: r.activityId,
  };
}

export async function createRaceResult(
  userId: string,
  input: CreateRaceResultInput,
  ipAddress?: string,
): Promise<RaceResultDTO> {
  if (input.activityId) {
    const activity = await db.activity.findFirst({
      where: { id: input.activityId, userId },
    });
    if (!activity) throw notFound("Activity not found");
  }
  const result = await db.raceResult.create({
    data: {
      userId,
      raceName: input.raceName,
      distanceM: input.distanceM,
      durationS: input.durationS,
      racedAt: new Date(input.racedAt),
      activityId: input.activityId ?? null,
    },
  });
  await audit({
    actorId: userId,
    action: "RACE_RESULT_CREATED",
    entityType: "RaceResult",
    entityId: result.id,
    metadata: { distanceM: result.distanceM },
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
    mileageM,
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
        ? { retired: input.retired, retiredAt: input.retired ? new Date() : null }
        : {}),
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

/** Validate that a shoe belongs to the user (for activity logging). */
export async function assertOwnShoe(userId: string, shoeId: string): Promise<void> {
  const shoe = await db.shoe.findFirst({ where: { id: shoeId, userId } });
  if (!shoe) throw forbidden("Shoe not found");
  if (shoe.retired) throw new AppError(400, "SHOE_RETIRED", "That shoe is retired.");
}

