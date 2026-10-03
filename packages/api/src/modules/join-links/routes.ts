import type { FastifyInstance } from "fastify";
import {
  approveJoinRequestSchema,
  createJoinLinkSchema,
  joinLinkParamsSchema,
  joinLinkTokenParamsSchema,
  joinRequestParamsSchema,
  teamParamsSchema,
} from "@curvelo/shared";
import {
  createJoinLink,
  decideJoinRequest,
  getJoinLinkLogo,
  listJoinLinks,
  listJoinRequests,
  previewJoinLink,
  requestJoin,
  revokeJoinLink,
} from "./service.js";

export async function joinLinkRoutes(app: FastifyInstance): Promise<void> {
  // Coach / team admin creates a shareable invite link.
  app.post(
    "/teams/:id/join-links",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const body = createJoinLinkSchema.parse(request.body);
      const result = await createJoinLink(request.user!.id, id, body, request.ip);
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/teams/:id/join-links",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      return reply.send(await listJoinLinks(request.user!.id, id));
    },
  );

  app.post(
    "/teams/:id/join-links/:linkId/revoke",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id, linkId } = joinLinkParamsSchema.parse(request.params);
      return reply.send(
        await revokeJoinLink(request.user!.id, id, linkId, request.ip),
      );
    },
  );

  // Pending join requests (coach approval queue).
  app.get(
    "/teams/:id/join-requests",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      return reply.send(await listJoinRequests(request.user!.id, id));
    },
  );

  app.post(
    "/teams/:id/join-requests/:requestId/approve",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id, requestId } = joinRequestParamsSchema.parse(request.params);
      const body = approveJoinRequestSchema.parse(request.body);
      return reply.send(
        await decideJoinRequest(
          request.user!.id,
          id,
          requestId,
          "APPROVED",
          body,
          request.ip,
        ),
      );
    },
  );

  app.post(
    "/teams/:id/join-requests/:requestId/deny",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id, requestId } = joinRequestParamsSchema.parse(request.params);
      return reply.send(
        await decideJoinRequest(
          request.user!.id,
          id,
          requestId,
          "DENIED",
          { role: "RUNNER" },
          request.ip,
        ),
      );
    },
  );

  // Public preview — no auth needed to see the team name.
  app.get("/join/:token", async (request, reply) => {
    const { token } = joinLinkTokenParamsSchema.parse(request.params);
    return reply.send(await previewJoinLink(token));
  });

  // Public team logo for the join page — same token gate as the preview.
  app.get("/join/:token/logo", async (request, reply) => {
    const { token } = joinLinkTokenParamsSchema.parse(request.params);
    const { image, mime } = await getJoinLinkLogo(token);
    return reply
      .header("Content-Type", mime)
      .header("Cache-Control", "public, max-age=3600")
      .send(image);
  });

  // Logged-in user requests to join via the link.
  app.post(
    "/join/:token/request",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { token } = joinLinkTokenParamsSchema.parse(request.params);
      const result = await requestJoin(request.user!.id, token, request.ip);
      return reply.status(201).send(result);
    },
  );
}
