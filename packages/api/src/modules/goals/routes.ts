import type { FastifyInstance } from "fastify";
import {
  createPersonalGoalSchema,
  createTeamGoalSchema,
  goalParamsSchema,
  leaderboardQuerySchema,
  progressQuerySchema,
  teamParamsSchema,
} from "@curvelo/shared";
import {
  archivePersonalGoal,
  archiveTeamGoal,
  createPersonalGoal,
  createTeamGoal,
  getLeaderboard,
  getProgress,
  listMyGoals,
  listTeamGoals,
} from "./service.js";

const teamGoalParamsSchema = teamParamsSchema.and(goalParamsSchema);

export async function goalRoutes(app: FastifyInstance) {
  // ---- Personal goals ----
  app.post("/goals", { preHandler: [app.authenticate] }, async (request, reply) => {
    const input = createPersonalGoalSchema.parse(request.body);
    const goal = await createPersonalGoal(request.user!.id, input, request.ip);
    return reply.code(201).send({ goal });
  });

  app.get("/goals", { preHandler: [app.authenticate] }, async (request, reply) => {
    return reply.send({ goals: await listMyGoals(request.user!.id) });
  });

  app.delete("/goals/:goalId", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { goalId } = goalParamsSchema.parse(request.params);
    await archivePersonalGoal(request.user!.id, goalId, request.ip);
    return reply.send({ ok: true });
  });

  // ---- Team goals (collective) ----
  app.post("/teams/:id/goals", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = teamParamsSchema.parse(request.params);
    const input = createTeamGoalSchema.parse(request.body);
    const goal = await createTeamGoal(request.user!.id, id, input, request.ip);
    return reply.code(201).send({ goal });
  });

  app.get("/teams/:id/goals", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = teamParamsSchema.parse(request.params);
    return reply.send({ goals: await listTeamGoals(request.user!.id, id) });
  });

  app.delete(
    "/teams/:id/goals/:goalId",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id, goalId } = teamGoalParamsSchema.parse(request.params);
      await archiveTeamGoal(request.user!.id, id, goalId, request.ip);
      return reply.send({ ok: true });
    },
  );

  // ---- Leaderboard (within-team only) ----
  app.get("/teams/:id/leaderboard", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = teamParamsSchema.parse(request.params);
    const { metric, days } = leaderboardQuerySchema.parse(request.query);
    return reply.send({
      leaderboard: await getLeaderboard(request.user!.id, id, metric, days),
    });
  });

  // ---- Personal progress analytics ----
  app.get("/users/me/progress", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { weeks } = progressQuerySchema.parse(request.query);
    return reply.send({ progress: await getProgress(request.user!.id, weeks) });
  });
}
