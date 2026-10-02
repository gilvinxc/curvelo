import type { FastifyInstance } from "fastify";
import { updateProfileSchema } from "@curvelo/shared";
import { z } from "zod";
import { db } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { notFound } from "../../lib/errors.js";

const idParams = z.object({ id: z.string().uuid() });

/**
 * Users module (slice 1).
 * - GET /users/me — own user + profile
 * - PATCH /users/me — update own profile
 * - GET /users/:id — teammate-visible public card. Only reachable when the
 *   requester shares an ACTIVE team with the target (or is the target).
 */
export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get("/me", { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = await db.user.findUnique({
      where: { id: request.user!.id },
      include: { profile: true },
    });
    if (!user) throw notFound("User not found");
    const { passwordHash: _ph, ...safe } = user;
    return reply.send({ user: safe });
  });

  app.patch("/me", { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = updateProfileSchema.parse(request.body);
    const userId = request.user!.id;

    const updated = await db.$transaction(async (tx) => {
      if (body.displayName !== undefined) {
        await tx.user.update({
          where: { id: userId },
          data: { displayName: body.displayName },
        });
      }
      const { displayName: _dn, dateOfBirth, ...profileData } = body;
      const profile = await tx.profile.upsert({
        where: { userId },
        create: { userId, ...profileData },
        update: profileData,
      });
      if (dateOfBirth !== undefined) {
        await tx.user.update({
          where: { id: userId },
          data: { dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null },
        });
      }
      return tx.user.findUnique({
        where: { id: userId },
        include: { profile: true },
      });
    });

    await audit({
      actorId: userId,
      action: "PROFILE_UPDATED",
      entityType: "User",
      entityId: userId,
      ipAddress: request.ip,
    });

    const { passwordHash: _ph, ...safe } = updated!;
    return reply.send({ user: safe });
  });

  app.get("/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const requesterId = request.user!.id;

    if (id !== requesterId) {
      // Must share an ACTIVE team — no cross-team snooping.
      const shared = await db.teamMembership.findFirst({
        where: {
          userId: requesterId,
          status: "ACTIVE",
          team: { memberships: { some: { userId: id, status: "ACTIVE" } } },
        },
        select: { id: true },
      });
      if (!shared) throw notFound("User not found");
    }

    const user = await db.user.findUnique({
      where: { id },
      select: {
        id: true,
        displayName: true,
        profile: {
          select: { avatarUrl: true, bio: true, city: true },
        },
      },
    });
    if (!user) throw notFound("User not found");
    return reply.send({ user });
  });
}
