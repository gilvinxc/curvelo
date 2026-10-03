import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  activeSeason,
  createSeason,
  deleteSeason,
  listSeasons,
  updateSeason,
} from "./service.js";

const seasonParamsSchema = z.object({ id: z.string().uuid() });
const seasonIdParamsSchema = z.object({
  id: z.string().uuid(),
  seasonId: z.string().uuid(),
});

const seasonBodySchema = z.object({
  name: z.string().min(1).max(80),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
  championshipName: z.string().max(80).optional().nullable(),
  championshipDate: z.string().min(1).optional().nullable(),
});

const seasonPatchSchema = seasonBodySchema.partial();

export async function seasonRoutes(app: FastifyInstance) {
  app.post(
    "/:id/seasons",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = seasonParamsSchema.parse(request.params);
      const body = seasonBodySchema.parse(request.body);
      const season = await createSeason(request.user!.id, id, body, request.ip);
      return reply.status(201).send({ season });
    },
  );

  app.get(
    "/:id/seasons",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = seasonParamsSchema.parse(request.params);
      const seasons = await listSeasons(request.user!.id, id);
      return reply.send({ seasons });
    },
  );

  app.get(
    "/:id/seasons/active",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = seasonParamsSchema.parse(request.params);
      const active = await activeSeason(request.user!.id, id);
      return reply.send({ active });
    },
  );

  app.patch(
    "/:id/seasons/:seasonId",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id, seasonId } = seasonIdParamsSchema.parse(request.params);
      const body = seasonPatchSchema.parse(request.body);
      const season = await updateSeason(
        request.user!.id,
        id,
        seasonId,
        body,
        request.ip,
      );
      return reply.send({ season });
    },
  );

  app.delete(
    "/:id/seasons/:seasonId",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id, seasonId } = seasonIdParamsSchema.parse(request.params);
      await deleteSeason(request.user!.id, id, seasonId, request.ip);
      return reply.send({ ok: true });
    },
  );
}
