import type { FastifyInstance } from "fastify";
import {
  calendarQuerySchema,
  createAssignmentSchema,
  teamParamsSchema,
} from "@curvelo/shared";
import { z } from "zod";
import {
  createAssignment,
  deleteAssignment,
  myCalendar,
  teamCalendar,
} from "./service.js";

const assignmentParams = z.object({ assignmentId: z.string().uuid() });

export async function assignmentRoutes(app: FastifyInstance): Promise<void> {
  // Coach assigns a workout (team / group / individual).
  app.post(
    "/teams/:id/assignments",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const body = createAssignmentSchema.parse(request.body);
      const assignment = await createAssignment(
        request.user!.id,
        id,
        body,
        request.ip,
      );
      return reply.status(201).send({ assignment });
    },
  );

  app.delete(
    "/assignments/:assignmentId",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { assignmentId } = assignmentParams.parse(request.params);
      await deleteAssignment(request.user!.id, assignmentId, request.ip);
      return reply.send({ ok: true });
    },
  );

  // Team training calendar.
  app.get(
    "/teams/:id/calendar",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const { from, to } = calendarQuerySchema.parse(request.query);
      const assignments = await teamCalendar(request.user!.id, id, from, to);
      return reply.send({ assignments });
    },
  );

  // Personal calendar across all my teams.
  app.get(
    "/users/me/calendar",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { from, to } = calendarQuerySchema.parse(request.query);
      const assignments = await myCalendar(request.user!.id, from, to);
      return reply.send({ assignments });
    },
  );
}
