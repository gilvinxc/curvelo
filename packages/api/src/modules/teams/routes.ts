import type { FastifyInstance } from "fastify";
import { createTeamSchema, teamParamsSchema, updateTeamSchema } from "@curvelo/shared";
import {
  createTeam,
  getRoster,
  getTeam,
  listMyTeams,
  updateTeam,
} from "./service.js";

export async function teamRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const body = createTeamSchema.parse(request.body);
      const team = await createTeam(request.user!.id, body, request.ip);
      return reply.status(201).send({ team });
    },
  );

  app.get("/", { preHandler: [app.authenticate] }, async (request, reply) => {
    const teams = await listMyTeams(request.user!.id);
    return reply.send({ teams });
  });

  app.get(
    "/:id",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const team = await getTeam(request.user!.id, id);
      return reply.send({ team });
    },
  );

  app.patch(
    "/:id",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const body = updateTeamSchema.parse(request.body);
      const team = await updateTeam(request.user!.id, id, body, request.ip);
      return reply.send({ team });
    },
  );

  app.get(
    "/:id/roster",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const roster = await getRoster(request.user!.id, id);
      return reply.send({ roster });
    },
  );
}
