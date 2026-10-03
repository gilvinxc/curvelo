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
    const { passwordHash: _ph, avatarImage: _av, ...safe } = user;
    return reply.send({ user: { ...safe, hasAvatar: _av != null } });
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

  const avatarSchema = z.object({
    image: z.string().max(2_000_000),
  });
  const AVATAR_RE = /^data:image\/(jpeg|png|webp);base64,/;
  const MAX_AVATAR_BYTES = 500_000;

  function parseAvatarImage(image: string): { buf: Buffer; mime: string } {
    const match = image.match(AVATAR_RE);
    if (!match) throw new Error("Invalid image data URL");
    const buf = Buffer.from(image.slice(match[0].length), "base64");
    if (buf.length === 0 || buf.length > MAX_AVATAR_BYTES) {
      throw new Error("Image is too large");
    }
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50;
    const isWebp = buf[0] === 0x52 && buf[1] === 0x49;
    if (!isJpeg && !isPng && !isWebp) throw new Error("Not a valid image");
    return { buf, mime: `image/${match[1]}` };
  }

  app.put("/me/avatar", { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = avatarSchema.parse(request.body);
    let parsed;
    try {
      parsed = parseAvatarImage(body.image);
    } catch (err) {
      return reply.status(400).send({
        error: { code: "BAD_REQUEST", message: (err as Error).message },
      });
    }
    await db.user.update({
      where: { id: request.user!.id },
      data: { avatarImage: parsed.buf, avatarMime: parsed.mime },
    });
    await audit({
      actorId: request.user!.id,
      action: "AVATAR_UPDATED",
      entityType: "User",
      entityId: request.user!.id,
    });
    return reply.send({ ok: true, hasAvatar: true });
  });

  app.delete("/me/avatar", { preHandler: [app.authenticate] }, async (request, reply) => {
    await db.user.update({
      where: { id: request.user!.id },
      data: { avatarImage: null, avatarMime: null },
    });
    return reply.send({ ok: true, hasAvatar: false });
  });

  app.get("/:id/avatar", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const user = await db.user.findUnique({
      where: { id },
      select: { avatarImage: true, avatarMime: true },
    });
    if (!user?.avatarImage) throw notFound("No avatar");
    return reply
      .header("Content-Type", user.avatarMime ?? "image/jpeg")
      .header("Cache-Control", "public, max-age=3600")
      .send(user.avatarImage);
  });
}
