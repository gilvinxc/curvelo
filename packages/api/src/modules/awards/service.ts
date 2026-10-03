import { z } from "zod";
import { db } from "../../db.js";
import { activeMembership, requireManager } from "../../lib/permissions.js";
import { forbidden, notFound } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import { createPost } from "../feed/service.js";
import type { AwardDTO } from "@curvelo/shared";

export const awardTypeSchema = z.enum([
  "MEDAL",
  "TROPHY",
  "RIBBON",
  "PLAQUE",
  "OTHER",
]);

export const createAwardSchema = z.object({
  athleteId: z.string().uuid(),
  type: awardTypeSchema,
  place: z.number().int().min(1).max(1000).optional(),
  eventName: z.string().trim().min(1).max(160),
  eventDate: z.string().date(),
  notes: z.string().trim().max(500).optional(),
  postToFeed: z.boolean().optional(),
});

export const updateAwardSchema = z.object({
  type: awardTypeSchema.optional(),
  place: z.number().int().min(1).max(1000).nullable().optional(),
  eventName: z.string().trim().min(1).max(160).optional(),
  eventDate: z.string().date().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export type CreateAwardInput = z.infer<typeof createAwardSchema>;
export type UpdateAwardInput = z.infer<typeof updateAwardSchema>;

const AWARD_INCLUDE = {
  athlete: { select: { displayName: true } },
} as const;

type AwardRow = {
  id: string;
  athleteId: string;
  teamId: string;
  athlete: { displayName: string };
  type: string;
  place: number | null;
  eventName: string;
  eventDate: Date;
  notes: string | null;
  createdAt: Date;
};

function toDTO(a: AwardRow): AwardDTO {
  return {
    id: a.id,
    athleteId: a.athleteId,
    athleteName: a.athlete.displayName,
    teamId: a.teamId,
    type: a.type as AwardDTO["type"],
    place: a.place,
    eventName: a.eventName,
    eventDate: a.eventDate.toISOString().slice(0, 10),
    notes: a.notes,
    createdAt: a.createdAt.toISOString(),
  };
}

async function requireCoachOfTeam(actorId: string, teamId: string) {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);
  return membership;
}

async function requireActiveRunner(teamId: string, athleteId: string) {
  const m = await db.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId: athleteId } },
  });
  if (!m || m.status !== "ACTIVE" || m.role !== "RUNNER") {
    throw forbidden("Athlete is not an active runner on this team");
  }
}

const AWARD_LABEL: Record<string, string> = {
  MEDAL: "a medal",
  TROPHY: "a trophy",
  RIBBON: "a ribbon",
  PLAQUE: "a plaque",
  OTHER: "an award",
};

export async function listTeamAwards(
  actorId: string,
  teamId: string,
): Promise<AwardDTO[]> {
  await activeMembership(actorId, teamId);
  const rows = await db.award.findMany({
    where: { teamId },
    include: AWARD_INCLUDE,
    orderBy: [{ eventDate: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(toDTO);
}

export async function listAthleteAwards(
  actorId: string,
  teamId: string,
  athleteId: string,
): Promise<AwardDTO[]> {
  const membership = await activeMembership(actorId, teamId);
  // Coaches see all; athletes see own; guardians see their athlete's.
  if (membership.role !== "COACH" && actorId !== athleteId) {
    const link = await db.guardianLink.findFirst({
      where: { guardianId: actorId, athleteId, status: "VERIFIED" },
    });
    if (!link) throw forbidden("Not your athlete");
  }
  const rows = await db.award.findMany({
    where: { teamId, athleteId },
    include: AWARD_INCLUDE,
    orderBy: [{ eventDate: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(toDTO);
}

export async function countTeamAwards(
  actorId: string,
  teamId: string,
  from?: Date,
  to?: Date,
): Promise<{ total: number }> {
  await activeMembership(actorId, teamId);
  const total = await db.award.count({
    where: {
      teamId,
      ...(from || to
        ? { eventDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    },
  });
  return { total };
}

export async function createAward(
  actorId: string,
  teamId: string,
  input: CreateAwardInput,
  ipAddress?: string,
): Promise<AwardDTO> {
  await requireCoachOfTeam(actorId, teamId);
  await requireActiveRunner(teamId, input.athleteId);

  const award = await db.award.create({
    data: {
      athleteId: input.athleteId,
      teamId,
      type: input.type,
      place: input.place ?? null,
      eventName: input.eventName,
      eventDate: new Date(`${input.eventDate}T12:00:00Z`),
      notes: input.notes?.trim() || null,
    },
    include: AWARD_INCLUDE,
  });

  if (input.postToFeed) {
    const placeStr = award.place ? ` (place ${award.place})` : "";
    await createPost(
      actorId,
      teamId,
      {
        kind: "SHOUTOUT",
        body: `🏆 ${award.athlete.displayName} earned ${AWARD_LABEL[award.type]} at ${award.eventName}${placeStr}!`,
      },
      ipAddress,
    );
  }

  await audit({
    actorId,
    action: "AWARD_CREATED",
    entityType: "Award",
    entityId: award.id,
    metadata: { teamId, athleteId: input.athleteId, type: input.type },
    ipAddress,
  });

  return toDTO(award);
}

export async function updateAward(
  actorId: string,
  awardId: string,
  input: UpdateAwardInput,
  ipAddress?: string,
): Promise<AwardDTO> {
  const existing = await db.award.findUnique({ where: { id: awardId } });
  if (!existing) throw notFound("Award not found");
  await requireCoachOfTeam(actorId, existing.teamId);

  const award = await db.award.update({
    where: { id: awardId },
    data: {
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.place !== undefined ? { place: input.place } : {}),
      ...(input.eventName !== undefined ? { eventName: input.eventName } : {}),
      ...(input.eventDate !== undefined
        ? { eventDate: new Date(`${input.eventDate}T12:00:00Z`) }
        : {}),
      ...(input.notes !== undefined
        ? { notes: input.notes?.trim() || null }
        : {}),
    },
    include: AWARD_INCLUDE,
  });

  await audit({
    actorId,
    action: "AWARD_UPDATED",
    entityType: "Award",
    entityId: award.id,
    metadata: { teamId: existing.teamId },
    ipAddress,
  });

  return toDTO(award);
}

export async function deleteAward(
  actorId: string,
  awardId: string,
  ipAddress?: string,
): Promise<void> {
  const existing = await db.award.findUnique({ where: { id: awardId } });
  if (!existing) throw notFound("Award not found");
  await requireCoachOfTeam(actorId, existing.teamId);

  await db.award.delete({ where: { id: awardId } });

  await audit({
    actorId,
    action: "AWARD_DELETED",
    entityType: "Award",
    entityId: awardId,
    metadata: { teamId: existing.teamId },
    ipAddress,
  });
}
