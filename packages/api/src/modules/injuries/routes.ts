import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db.js";
import { activeMembership } from "../../lib/permissions.js";
import { forbidden } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";

const teamParams = z.object({ id: z.string().uuid() });
const injuryParams = z.object({ id: z.string().uuid(), injuryId: z.string().uuid() });

const createInjurySchema = z.object({
  athleteId: z.string().uuid(),
  title: z.string().trim().min(1).max(120),
  detail: z.string().trim().max(2000).optional(),
  expectedReturn: z.string().date().optional(),
});

const updateInjurySchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  detail: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(["ACTIVE", "RECOVERED"]).optional(),
  expectedReturn: z.string().date().nullable().optional(),
});

function toDTO(i: {
  id: string;
  athleteId: string;
  athlete: { displayName: string };
  reportedBy: { displayName: string };
  title: string;
  detail: string | null;
  status: string;
  expectedReturn: Date | null;
  resolvedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: i.id,
    athleteId: i.athleteId,
    athleteName: i.athlete.displayName,
    reportedByName: i.reportedBy.displayName,
    title: i.title,
    detail: i.detail,
    status: i.status,
    expectedReturn: i.expectedReturn?.toISOString().slice(0, 10) ?? null,
    resolvedAt: i.resolvedAt?.toISOString() ?? null,
    createdAt: i.createdAt.toISOString(),
  };
}

const INJURY_INCLUDE = {
  athlete: { select: { displayName: true } },
  reportedBy: { select: { displayName: true } },
} as const;

/**
 * Coaches see all; athletes see own; verified guardians see their athlete's.
 * Guardians are usually not team members, so a failed membership lookup
 * must not block their guardian-scoped access.
 */
async function visibleAthleteIds(actorId: string, teamId: string): Promise<string[] | null> {
  const membership = await activeMembership(actorId, teamId).catch(() => null);
  if (membership?.role === "COACH") return null; // all
  const ids: string[] = [];
  if (membership?.status === "ACTIVE") ids.push(actorId);
  const links = await db.guardianLink.findMany({
    where: { guardianId: actorId, status: "VERIFIED" },
    select: { athleteId: true },
  });
  for (const l of links) {
    const am = await db.teamMembership.findUnique({
      where: { teamId_userId: { teamId, userId: l.athleteId } },
    });
    if (am?.status === "ACTIVE" && !ids.includes(l.athleteId)) ids.push(l.athleteId);
  }
  if (ids.length === 0) {
    // No membership and no guardian link: don't leak team existence.
    const { notFound } = await import("../../lib/errors.js");
    throw notFound("Team not found");
  }
  return ids;
}

export async function injuryRoutes(app: FastifyInstance): Promise<void> {
  // List injuries (visibility-filtered).
  app.get(
    "/teams/:id/injuries",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { id } = teamParams.parse(request.params);
      const athleteIds = await visibleAthleteIds(request.user!.id, id);
      const injuries = await db.injury.findMany({
        where: {
          teamId: id,
          ...(athleteIds === null ? {} : { athleteId: { in: athleteIds } }),
        },
        include: INJURY_INCLUDE,
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      });
      return { injuries: injuries.map(toDTO) };
    },
  );

  // Report an injury: coach for any athlete, or athlete for self.
  app.post(
    "/teams/:id/injuries",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParams.parse(request.params);
      const body = createInjurySchema.parse(request.body);
      const membership = await activeMembership(request.user!.id, id);
      const isCoach = membership.role === "COACH";
      const isSelf = body.athleteId === request.user!.id;
      if (!isCoach && !isSelf) {
        throw forbidden("Only coaches or the athlete can report an injury");
      }
      // Athlete must be an active member.
      const target = await db.teamMembership.findUnique({
        where: { teamId_userId: { teamId: id, userId: body.athleteId } },
      });
      if (!target || target.status !== "ACTIVE") {
        throw forbidden("Athlete is not on this team");
      }
      const injury = await db.injury.create({
        data: {
          teamId: id,
          athleteId: body.athleteId,
          reportedById: request.user!.id,
          title: body.title,
          detail: body.detail,
          expectedReturn: body.expectedReturn
            ? new Date(body.expectedReturn + "T00:00:00Z")
            : undefined,
        },
        include: INJURY_INCLUDE,
      });
      await audit({
        actorId: request.user!.id,
        action: "INJURY_REPORTED",
        entityType: "Team",
        entityId: id,
        metadata: { athleteId: body.athleteId },
        ipAddress: request.ip,
      });
      // Notify the team's coaches — they can all see team injuries
      // (team admins cannot, so they are excluded). Never the reporter.
      const coaches = await db.teamMembership.findMany({
        where: { teamId: id, status: "ACTIVE", role: "COACH" },
        select: { userId: true },
      });
      for (const c of coaches) {
        if (c.userId === request.user!.id) continue;
        await db.notification.create({
          data: {
            userId: c.userId,
            type: "INJURY_REPORTED",
            title: `Injury reported: ${injury.athlete.displayName}`,
            body: injury.title,
            link: `/teams/${id}/coaching`,
          },
        });
      }
      return reply.status(201).send({ injury: toDTO(injury) });
    },
  );

  // Update: coach only.
  app.patch(
    "/teams/:id/injuries/:injuryId",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { id, injuryId } = injuryParams.parse(request.params);
      const body = updateInjurySchema.parse(request.body);
      const membership = await activeMembership(request.user!.id, id);
      if (membership.role !== "COACH") throw forbidden("Coaches only");
      const existing = await db.injury.findFirst({
        where: { id: injuryId, teamId: id },
      });
      if (!existing) throw forbidden("Injury not found");
      const injury = await db.injury.update({
        where: { id: injuryId },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.detail !== undefined ? { detail: body.detail } : {}),
          ...(body.status !== undefined
            ? {
                status: body.status,
                resolvedAt:
                  body.status === "RECOVERED" ? new Date() : null,
              }
            : {}),
          ...(body.expectedReturn !== undefined
            ? {
                expectedReturn: body.expectedReturn
                  ? new Date(body.expectedReturn + "T00:00:00Z")
                  : null,
              }
            : {}),
        },
        include: INJURY_INCLUDE,
      });
      return { injury: toDTO(injury) };
    },
  );

  // Delete: coach only.
  app.delete(
    "/teams/:id/injuries/:injuryId",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { id, injuryId } = injuryParams.parse(request.params);
      const membership = await activeMembership(request.user!.id, id);
      if (membership.role !== "COACH") throw forbidden("Coaches only");
      await db.injury.deleteMany({ where: { id: injuryId, teamId: id } });
      return { ok: true };
    },
  );
}
