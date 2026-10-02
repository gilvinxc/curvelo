import type { FastifyInstance } from "fastify";
import {
  athleteInsightParamsSchema,
  raceResultParamsSchema,
  teamDigestParamsSchema,
  teamDigestQuerySchema,
} from "@curvelo/shared";
import { getAthleteInsight, getMyInsight, getRaceAnalysis, getTeamDigest } from "./service.js";

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

  // Your own 28-day insight — same engine, your own data.
  app.get(
    "/users/me/insights",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const insight = await getMyInsight(request.user!.id, request.ip);
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

  // AI race analysis: pacing verdict + coaching cues for one official result.
  // Owner, or a coach/admin of any team the athlete is on.
  app.get(
    "/race-results/:raceResultId/analysis",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { raceResultId } = raceResultParamsSchema.parse(request.params);
      const analysis = await getRaceAnalysis(request.user!.id, raceResultId, request.ip);
      return reply.send({ analysis });
    },
  );
}
