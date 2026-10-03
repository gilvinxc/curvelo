import type { FastifyInstance } from "fastify";
import {
  activityParamsSchema,
  activityQuerySchema,
  athleteParamsSchema,
  createActivitySchema,
  logTeamRunSchema,
  statsQuerySchema,
  updateActivitySchema,
} from "@curvelo/shared";
import {
  athleteView,
  createActivity,
  deleteActivity,
  getActivity,
  listMyActivities,
  logTeamRun,
  myRecords,
  myStats,
  transferActivities,
  updateActivity,
} from "./service.js";
import { createPost, createSystemPost } from "../feed/service.js";
import { detectMilestones } from "../../lib/milestones.js";

export async function activityRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/activities/transfer",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const body = request.body as { fromTeamId?: string; toTeamId?: string };
      if (!body?.fromTeamId || !body?.toTeamId) {
        return reply.status(400).send({ error: "fromTeamId and toTeamId required" });
      }
      const result = await transferActivities(
        request.user!.id,
        body.fromTeamId,
        body.toTeamId,
      );
      return reply.send(result);
    },
  );
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
      // Opt-in at log time: share the new activity to the team feed.
      // Sharing is best-effort — the activity itself is already saved.
      if (
        body.shareToFeed &&
        activity.teamId &&
        activity.visibility === "TEAM"
      ) {
        try {
          await createPost(
            request.user!.id,
            activity.teamId,
            { activityId: activity.id },
            request.ip,
          );
        } catch {
          // Share validation failed (e.g. visibility changed); activity stands.
        }
      }
      // Milestone celebrations: personal progress, posted to the team feed.
      // Best-effort; never blocks the save. Skipped for bulk file imports.
      if (
        activity.teamId &&
        activity.visibility === "TEAM" &&
        activity.source !== "FILE_IMPORT"
      ) {
        try {
          const milestones = await detectMilestones({
            userId: request.user!.id,
            activityId: activity.id,
            distanceM: activity.distanceM,
          });
          for (const m of milestones) {
            await createSystemPost({
              teamId: activity.teamId,
              authorId: request.user!.id,
              kind: "MILESTONE",
              body: `🎉 ${activity.userName ?? "Someone"} — ${m.title}!`,
              activityId: activity.id,
            });
          }
        } catch {
          // Celebration failed; activity stands.
        }
      }
      return reply.status(201).send({ activity });
    },
  );

  // Coach bulk-log: one run for the whole team or a training group.
  app.post(
    "/activities/team-log",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const body = logTeamRunSchema.parse(request.body);
      const result = await logTeamRun(request.user!.id, body, request.ip);
      return reply.status(201).send(result);
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

  app.get(
    "/users/me/pace-records",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const records = await myRecords(request.user!.id);
      return reply.send({ records });
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
