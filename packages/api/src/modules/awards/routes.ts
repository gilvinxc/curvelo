import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  countTeamAwards,
  createAward,
  createAwardSchema,
  deleteAward,
  listAthleteAwards,
  listTeamAwards,
  updateAward,
  updateAwardSchema,
} from "./service.js";

const teamParams = z.object({ id: z.string().uuid() });
const awardParams = z.object({ awardId: z.string().uuid() });
const athleteParams = z.object({ athleteId: z.string().uuid() });
const countQuery = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});

export async function awardRoutes(app: FastifyInstance) {
  // Team awards list + season count (any active member).
  app.get(
    "/teams/:id/awards",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { id } = teamParams.parse(request.params);
      return { awards: await listTeamAwards(request.user!.id, id) };
    },
  );

  app.get(
    "/teams/:id/awards/count",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { id } = teamParams.parse(request.params);
      const q = countQuery.parse(request.query);
      return await countTeamAwards(
        request.user!.id,
        id,
        q.from ? new Date(`${q.from}T00:00:00Z`) : undefined,
        q.to ? new Date(`${q.to}T23:59:59Z`) : undefined,
      );
    },
  );

  // Athlete awards (coach, athlete themself, verified guardian).
  app.get(
    "/teams/:id/athletes/:athleteId/awards",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { id } = teamParams.parse(request.params);
      const { athleteId } = athleteParams.parse(request.params);
      return {
        awards: await listAthleteAwards(request.user!.id, id, athleteId),
      };
    },
  );

  // Coach-only create/update/delete.
  app.post(
    "/teams/:id/awards",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParams.parse(request.params);
      const input = createAwardSchema.parse(request.body);
      const award = await createAward(request.user!.id, id, input, request.ip);
      return reply.code(201).send({ award });
    },
  );

  app.patch(
    "/awards/:awardId",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { awardId } = awardParams.parse(request.params);
      const input = updateAwardSchema.parse(request.body);
      return { award: await updateAward(request.user!.id, awardId, input, request.ip) };
    },
  );

  app.delete(
    "/awards/:awardId",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { awardId } = awardParams.parse(request.params);
      await deleteAward(request.user!.id, awardId, request.ip);
      return reply.code(204).send();
    },
  );
}
