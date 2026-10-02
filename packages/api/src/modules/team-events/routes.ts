import type { FastifyInstance } from "fastify";
import {
  createTeamEventSchema,
  teamParamsSchema,
  updateTeamEventSchema,
} from "@curvelo/shared";
import { z } from "zod";
import {
  createTeamEvent,
  deleteTeamEvent,
  listTeamEvents,
  updateTeamEvent,
} from "./service.js";

const eventParams = z.object({ eventId: z.string().uuid() });
const rangeQuery = z.object({ from: z.string().date(), to: z.string().date() });

export async function teamEventRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/teams/:id/events",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { id } = teamParamsSchema.parse(request.params);
      const { from, to } = rangeQuery.parse(request.query);
      const events = await listTeamEvents(request.user!.id, id, from, to);
      return { events };
    },
  );

  app.post(
    "/teams/:id/events",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const body = createTeamEventSchema.parse(request.body);
      const event = await createTeamEvent(request.user!.id, id, body, request.ip);
      return reply.status(201).send({ event });
    },
  );

  app.patch(
    "/teams/:id/events/:eventId",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { id } = teamParamsSchema.parse(request.params);
      const { eventId } = eventParams.parse(request.params);
      const body = updateTeamEventSchema.parse(request.body);
      const event = await updateTeamEvent(
        request.user!.id,
        id,
        eventId,
        body,
        request.ip,
      );
      return { event };
    },
  );

  app.delete(
    "/teams/:id/events/:eventId",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const { eventId } = eventParams.parse(request.params);
      await deleteTeamEvent(request.user!.id, id, eventId, request.ip);
      return reply.send({ ok: true });
    },
  );
}
