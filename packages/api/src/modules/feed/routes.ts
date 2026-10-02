import type { FastifyInstance } from "fastify";
import {
  commentParamsSchema,
  createCommentSchema,
  createPostSchema,
  feedQuerySchema,
  postParamsSchema,
  reportParamsSchema,
  reportPostSchema,
  reportsQuerySchema,
  resolveReportSchema,
  teamParamsSchema,
  toggleReactionSchema,
} from "@curvelo/shared";
import {
  createComment,
  createPost,
  deleteComment,
  deletePost,
  listComments,
  listFeed,
  listReports,
  reportPost,
  resolveReport,
  toggleReaction,
} from "./service.js";

export async function feedRoutes(app: FastifyInstance): Promise<void> {
  // Team feed.
  app.post(
    "/teams/:id/feed",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const body = createPostSchema.parse(request.body);
      const post = await createPost(request.user!.id, id, body, request.ip);
      return reply.status(201).send({ post });
    },
  );

  app.get(
    "/teams/:id/feed",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const { before, limit } = feedQuerySchema.parse(request.query);
      const posts = await listFeed(request.user!.id, id, { before, limit });
      return reply.send({ posts });
    },
  );

  app.delete(
    "/posts/:postId",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { postId } = postParamsSchema.parse(request.params);
      await deletePost(request.user!.id, postId, request.ip);
      return reply.send({ ok: true });
    },
  );

  // Comments.
  app.post(
    "/posts/:postId/comments",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { postId } = postParamsSchema.parse(request.params);
      const body = createCommentSchema.parse(request.body);
      const comment = await createComment(
        request.user!.id,
        postId,
        body,
        request.ip,
      );
      return reply.status(201).send({ comment });
    },
  );

  app.get(
    "/posts/:postId/comments",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { postId } = postParamsSchema.parse(request.params);
      const comments = await listComments(request.user!.id, postId);
      return reply.send({ comments });
    },
  );

  app.delete(
    "/comments/:commentId",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { commentId } = commentParamsSchema.parse(request.params);
      await deleteComment(request.user!.id, commentId, request.ip);
      return reply.send({ ok: true });
    },
  );

  // Reactions (toggle).
  app.post(
    "/posts/:postId/reactions",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { postId } = postParamsSchema.parse(request.params);
      const { emoji } = toggleReactionSchema.parse(request.body);
      const result = await toggleReaction(request.user!.id, postId, emoji);
      return reply.send(result);
    },
  );

  // Reports / moderation queue.
  app.post(
    "/posts/:postId/report",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { postId } = postParamsSchema.parse(request.params);
      const { reason } = reportPostSchema.parse(request.body);
      const report = await reportPost(
        request.user!.id,
        postId,
        reason,
        request.ip,
      );
      return reply.status(201).send({ report });
    },
  );

  app.get(
    "/teams/:id/reports",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = teamParamsSchema.parse(request.params);
      const { status } = reportsQuerySchema.parse(request.query);
      const reports = await listReports(request.user!.id, id, status);
      return reply.send({ reports });
    },
  );

  app.post(
    "/reports/:reportId/resolve",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { reportId } = reportParamsSchema.parse(request.params);
      const { status } = resolveReportSchema.parse(request.body);
      const report = await resolveReport(
        request.user!.id,
        reportId,
        status,
        request.ip,
      );
      return reply.send({ report });
    },
  );
}
