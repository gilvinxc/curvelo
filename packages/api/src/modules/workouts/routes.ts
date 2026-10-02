import type { FastifyInstance } from "fastify";
import {
  createWorkoutSchema,
  teamParamsSchema,
  updateWorkoutSchema,
  workoutParamsSchema,
} from "@curvelo/shared";
import { z } from "zod";
import {
  createWorkout,
  deleteWorkout,
  getWorkout,
  listWorkouts,
  updateWorkout,
} from "./service.js";

const listQuery = z.object({
  templatesOnly: z.enum(["true", "false"]).optional(),
});

export async function workoutRoutes(app: FastifyInstance): Promise<void> {
  // Create a workout (with steps) for a team.
  app.post(
    "/teams/:id/workouts",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const body = createWorkoutSchema.parse(request.body);
      const workout = await createWorkout(request.user!.id, id, body, request.ip);
      return reply.status(201).send({ workout });
    },
  );

  // List a team's workouts (any member).
  app.get(
    "/teams/:id/workouts",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const query = listQuery.parse(request.query);
      const workouts = await listWorkouts(request.user!.id, id, {
        templatesOnly: query.templatesOnly === "true",
      });
      return reply.send({ workouts });
    },
  );

  app.get(
    "/workouts/:id",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = workoutParamsSchema.parse(request.params);
      const workout = await getWorkout(request.user!.id, id);
      return reply.send({ workout });
    },
  );

  app.patch(
    "/workouts/:id",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = workoutParamsSchema.parse(request.params);
      const body = updateWorkoutSchema.parse(request.body);
      const workout = await updateWorkout(request.user!.id, id, body, request.ip);
      return reply.send({ workout });
    },
  );

  app.delete(
    "/workouts/:id",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = workoutParamsSchema.parse(request.params);
      await deleteWorkout(request.user!.id, id, request.ip);
      return reply.send({ ok: true });
    },
  );
}
