import type { FastifyInstance } from "fastify";
import {
  bulkAssignSchema,
  calendarQuerySchema,
  createAssignmentSchema,
  teamParamsSchema,
} from "@curvelo/shared";
import { z } from "zod";
import {
  createAssignment,
  createBulkAssignments,
  deleteAssignment,
  myCalendar,
  teamCalendar,
} from "./service.js";
import { calendarActivities } from "../activities/service.js";
import { listTeamEvents, myTeamEvents } from "../team-events/service.js";
import { activeMembership } from "../../lib/permissions.js";

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

  // Coach assigns one workout to many athletes at once.
  app.post(
    "/teams/:id/assignments/bulk",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const body = bulkAssignSchema.parse(request.body);
      const result = await createBulkAssignments(
        request.user!.id,
        id,
        body,
        request.ip,
      );
      return reply.status(201).send(result);
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

  // Team training calendar: planned assignments + completed activities.
  app.get(
    "/teams/:id/calendar",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const { from, to } = calendarQuerySchema.parse(request.query);
      const actorId = request.user!.id;
      const membership = await activeMembership(actorId, id);
      const isManager =
        membership.role === "COACH" || membership.role === "TEAM_ADMIN";
      const [assignments, activities, events] = await Promise.all([
        teamCalendar(actorId, id, from, to),
        calendarActivities(actorId, id, from, to, isManager),
        listTeamEvents(actorId, id, from, to),
      ]);
      return reply.send({ assignments, activities, events });
    },
  );

  // Personal calendar across all my teams.
  app.get(
    "/users/me/calendar",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { from, to } = calendarQuerySchema.parse(request.query);
      const actorId = request.user!.id;
      const [assignments, activities, events] = await Promise.all([
        myCalendar(actorId, from, to),
        calendarActivities(actorId, null, from, to, false),
        myTeamEvents(actorId, from, to),
      ]);
      return reply.send({ assignments, activities, events });
    },
  );
}
