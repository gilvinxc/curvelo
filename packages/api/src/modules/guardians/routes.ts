import type { FastifyInstance } from "fastify";
import {
  acceptGuardianInviteSchema,
  athleteGuardianParamsSchema,
  guardianInviteParamsSchema,
  guardianLinkParamsSchema,
  inviteGuardianSchema,
} from "@curvelo/shared";
import {
  acceptInvite,
  inviteGuardian,
  listAthleteGuardians,
  myChildren,
  previewInvite,
  revokeLink,
} from "./service.js";

export async function guardianRoutes(app: FastifyInstance): Promise<void> {
  // Coach invites a parent/guardian for an athlete.
  app.post(
    "/teams/:id/athletes/:userId/guardians/invite",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id, userId } = athleteGuardianParamsSchema.parse(request.params);
      const body = inviteGuardianSchema.parse(request.body);
      const invite = await inviteGuardian(
        request.user!.id,
        id,
        userId,
        body,
        request.ip,
      );
      return reply.status(201).send({ invite });
    },
  );

  // Coach views an athlete's guardians + consents.
  app.get(
    "/teams/:id/athletes/:userId/guardians",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id, userId } = athleteGuardianParamsSchema.parse(request.params);
      const result = await listAthleteGuardians(request.user!.id, id, userId);
      return reply.send(result);
    },
  );

  // Public invite preview (no auth).
  app.get(
    "/guardian-invites/:token/preview",
    async (request, reply) => {
      const { token } = guardianInviteParamsSchema.parse(request.params);
      const invite = await previewInvite(token);
      return reply.send({ invite });
    },
  );

  // Parent accepts (email must match the invite).
  app.post(
    "/guardian-invites/:token/accept",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { token } = guardianInviteParamsSchema.parse(request.params);
      const body = acceptGuardianInviteSchema.parse(request.body);
      const link = await acceptInvite(request.user!.id, token, body, request.ip);
      return reply.send({ link });
    },
  );

  // Revoke a guardian link (guardian themselves or a coach/admin).
  app.delete(
    "/guardian-links/:id",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = guardianLinkParamsSchema.parse(request.params);
      await revokeLink(request.user!.id, id, request.ip);
      return reply.send({ ok: true });
    },
  );

  // Parent view: my linked athletes.
  app.get(
    "/users/me/children",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const children = await myChildren(request.user!.id);
      return reply.send({ children });
    },
  );
}
