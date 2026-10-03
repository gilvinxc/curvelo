import type { FastifyInstance } from "fastify";
import {
  createPersonalPlanSchema,
  teamParamsSchema,
  updatePersonalPlanSchema,
} from "@curvelo/shared";
import { z } from "zod";
import {
  appliedPlanDays,
  assertCanViewAthletePlan,
  athletePlannedDays,
  createPersonalPlan,
  deletePersonalPlan,
  listPersonalPlans,
  setPlanApplied,
  updatePersonalPlan,
} from "./service.js";

const planParams = z.object({ planId: z.string().uuid() });
const rangeQuery = z.object({ from: z.string(), to: z.string() });
const athleteParams = z.object({ id: z.string().uuid(), userId: z.string().uuid() });

/**
 * Personal training plans (slice: individual plans).
 * - GET /personal-plans — my plans
 * - POST /personal-plans — create
 * - PATCH /personal-plans/:planId — update
 * - DELETE /personal-plans/:planId — delete
 * - POST /personal-plans/:planId/apply — show on my calendar
 * - POST /personal-plans/:planId/unapply — hide from my calendar
 * - GET /personal-plans/days?from&to — applied plan days for my calendar
 * - GET /teams/:id/athletes/:userId/planned?from&to — coach view of an
 *   athlete's upcoming planned workouts (off-season visibility)
 */
export async function personalPlanRoutes(app: FastifyInstance): Promise<void> {
  app.get("/personal-plans", { preHandler: [app.authenticate] }, async (request) => {
    const plans = await listPersonalPlans(request.user!.id);
    return { plans };
  });

  app.post("/personal-plans", { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = createPersonalPlanSchema.parse(request.body);
    const plan = await createPersonalPlan(request.user!.id, body);
    return reply.status(201).send({ plan });
  });

  app.patch(
    "/personal-plans/:planId",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { planId } = planParams.parse(request.params);
      const body = updatePersonalPlanSchema.parse(request.body);
      const plan = await updatePersonalPlan(request.user!.id, planId, body);
      return { plan };
    },
  );

  app.delete(
    "/personal-plans/:planId",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { planId } = planParams.parse(request.params);
      await deletePersonalPlan(request.user!.id, planId);
      return { ok: true };
    },
  );

  app.post(
    "/personal-plans/:planId/apply",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { planId } = planParams.parse(request.params);
      const plan = await setPlanApplied(request.user!.id, planId, true);
      return { plan };
    },
  );

  app.post(
    "/personal-plans/:planId/unapply",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { planId } = planParams.parse(request.params);
      const plan = await setPlanApplied(request.user!.id, planId, false);
      return { plan };
    },
  );

  app.get(
    "/personal-plans/days",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { from, to } = rangeQuery.parse(request.query);
      const days = await appliedPlanDays(request.user!.id, from, to);
      return { days };
    },
  );

  app.get(
    "/teams/:id/athletes/:userId/planned",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { id, userId } = athleteParams.parse(request.params);
      const { from, to } = rangeQuery.parse(request.query);
      await assertCanViewAthletePlan(request.user!.id, userId, id);
      const days = await athletePlannedDays(userId, from, to);
      return { days };
    },
  );
}
