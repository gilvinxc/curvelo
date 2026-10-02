import type { FastifyInstance } from "fastify";
import {
  createInvitationSchema,
  invitationTokenParamsSchema,
  teamParamsSchema,
} from "@curvelo/shared";
import {
  acceptInvitation,
  createInvitation,
  previewInvitation,
} from "./service.js";

export async function invitationRoutes(app: FastifyInstance): Promise<void> {
  // Coach / team admin creates an invitation for a team.
  app.post(
    "/teams/:id/invitations",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const body = createInvitationSchema.parse(request.body);
      const invitation = await createInvitation(
        request.user!.id,
        id,
        body,
        request.ip,
      );
      return reply.status(201).send({ invitation });
    },
  );

  // Public preview — lets the invitee see what they're accepting.
  app.get("/invitations/:token", async (request, reply) => {
    const { token } = invitationTokenParamsSchema.parse(request.params);
    const preview = await previewInvitation(token);
    return reply.send({ invitation: preview });
  });

  // Logged-in user accepts (email must match the invitation).
  app.post(
    "/invitations/:token/accept",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { token } = invitationTokenParamsSchema.parse(request.params);
      const result = await acceptInvitation(request.user!.id, token, request.ip);
      return reply.send(result);
    },
  );
}
