import type { FastifyInstance } from "fastify";
import {
  athleteInsightParamsSchema,
  teamDigestParamsSchema,
  teamDigestQuerySchema,
} from "@curvelo/shared";
import { getAthleteInsight, getTeamDigest } from "./service.js";

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  // Coach view: AI-assisted insight for one athlete (28-day window).
  app.get(
    "/teams/:id/athletes/:userId/insights",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id, userId } = athleteInsightParamsSchema.parse(request.params);
      const insight = await getAthleteInsight(request.user!.id, id, userId, request.ip);
      return reply.send({ insight });
    },
  );

  // Coach view: team digest over the last N days.
  app.get(
    "/teams/:id/digest",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamDigestParamsSchema.parse(request.params);
      const { days } = teamDigestQuerySchema.parse(request.query);
      const digest = await getTeamDigest(request.user!.id, id, days, request.ip);
      return reply.send({ digest });
    },
  );
}
