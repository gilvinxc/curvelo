import type { FastifyInstance } from "fastify";
import {
  activityParamsSchema,
  activityQuerySchema,
  athleteParamsSchema,
  createActivitySchema,
  statsQuerySchema,
  updateActivitySchema,
} from "@curvelo/shared";
import {
  athleteView,
  createActivity,
  deleteActivity,
  getActivity,
  listMyActivities,
  myStats,
  updateActivity,
} from "./service.js";

export async function activityRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/activities",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const body = createActivitySchema.parse(request.body);
      const activity = await createActivity(
        request.user!.id,
        body,
        request.ip,
      );
      return reply.status(201).send({ activity });
    },
  );

  // My activities in a date range, optionally filtered to one team.
  app.get(
    "/activities",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { from, to, teamId } = activityQuerySchema.parse(request.query);
      const activities = await listMyActivities(
        request.user!.id,
        from,
        to,
        teamId,
      );
      return reply.send({ activities });
    },
  );

  app.get(
    "/activities/:id",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = activityParamsSchema.parse(request.params);
      const activity = await getActivity(request.user!.id, id);
      return reply.send({ activity });
    },
  );

  app.patch(
    "/activities/:id",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = activityParamsSchema.parse(request.params);
      const body = updateActivitySchema.parse(request.body);
      const activity = await updateActivity(
        request.user!.id,
        id,
        body,
        request.ip,
      );
      return reply.send({ activity });
    },
  );

  app.delete(
    "/activities/:id",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = activityParamsSchema.parse(request.params);
      await deleteActivity(request.user!.id, id, request.ip);
      return reply.send({ ok: true });
    },
  );

  app.get(
    "/users/me/stats",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { from, to } = statsQuerySchema.parse(request.query);
      const stats = await myStats(request.user!.id, from, to);
      return reply.send({ stats });
    },
  );

  // Coach view of one athlete on a team.
  app.get(
    "/teams/:id/athletes/:userId",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id, userId } = athleteParamsSchema.parse(request.params);
      const athlete = await athleteView(request.user!.id, id, userId);
      return reply.send({ athlete });
    },
  );
}
