import type { FastifyInstance } from "fastify";
import {
  applyTrainingPlanSchema,
  createPracticePlanSchema,
  createTrainingPlanSchema,
  teamParamsSchema,
  updateTrainingPlanSchema,
} from "@curvelo/shared";
import { z } from "zod";
import { createPracticePlan } from "../assignments/service.js";
import {
  applyTrainingPlan,
  createTrainingPlan,
  deleteTrainingPlan,
  listTrainingPlans,
  updateTrainingPlan,
} from "./service.js";

const planParams = z.object({ planId: z.string().uuid() });

export async function trainingPlanRoutes(app: FastifyInstance): Promise<void> {
  // Single-session planner: schedule now, optionally announce to the feed.
  app.post(
    "/teams/:id/practice-plans",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const body = createPracticePlanSchema.parse(request.body);
      const result = await createPracticePlan(
        request.user!.id,
        id,
        body,
        request.ip,
      );
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/teams/:id/training-plans",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { id } = teamParamsSchema.parse(request.params);
      const plans = await listTrainingPlans(request.user!.id, id);
      return { plans };
    },
  );

  app.post(
    "/teams/:id/training-plans",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const body = createTrainingPlanSchema.parse(request.body);
      const plan = await createTrainingPlan(request.user!.id, id, body, request.ip);
      return reply.status(201).send({ plan });
    },
  );

  app.patch(
    "/teams/:id/training-plans/:planId",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { id } = teamParamsSchema.parse(request.params);
      const { planId } = planParams.parse(request.params);
      const body = updateTrainingPlanSchema.parse(request.body);
      const plan = await updateTrainingPlan(
        request.user!.id,
        id,
        planId,
        body,
        request.ip,
      );
      return { plan };
    },
  );

  app.delete(
    "/teams/:id/training-plans/:planId",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const { planId } = planParams.parse(request.params);
      await deleteTrainingPlan(request.user!.id, id, planId, request.ip);
      return reply.send({ ok: true });
    },
  );

  app.post(
    "/teams/:id/training-plans/:planId/apply",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const { planId } = planParams.parse(request.params);
      const body = applyTrainingPlanSchema.parse(request.body);
      const result = await applyTrainingPlan(
        request.user!.id,
        id,
        planId,
        body,
        request.ip,
      );
      return reply.status(201).send(result);
    },
  );
}
