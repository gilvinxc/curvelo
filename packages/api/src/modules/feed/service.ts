import type {
  ActivityDTO,
  CommentDTO,
  CreateCommentInput,
  CreatePostInput,
  PostDTO,
  ReactionSummaryDTO,
  ReportDTO,
} from "@curvelo/shared";
import { db } from "../../db.js";
import { audit } from "../../lib/audit.js";
import { AppError, forbidden, notFound } from "../../lib/errors.js";
import {
  activeMembership,
  requireManager,
} from "../../lib/permissions.js";
import {
  ACTIVITY_WITH_JOINS,
  toActivityDTO,
  type ActivityWithJoins,
} from "../activities/service.js";

type PostWithJoins = {
  id: string;
  teamId: string;
  kind: string;
  body: string | null;
  authorId: string;
  createdAt: Date;
  author: { displayName: string };
  activity: ActivityWithJoins | null;
  _count: { comments: number };
  reactions: Array<{ emoji: string; userId: string }>;
};

const POST_INCLUDE = {
  author: { select: { displayName: true } },
  activity: { include: ACTIVITY_WITH_JOINS },
  _count: { select: { comments: true } },
  reactions: { select: { emoji: true, userId: true } },
} as const;

function summarizeReactions(
  reactions: Array<{ emoji: string; userId: string }>,
  actorId: string,
): { reactions: ReactionSummaryDTO[]; myReactions: string[] } {
  const counts = new Map<string, number>();
  const mine = new Set<string>();
  for (const r of reactions) {
    counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
    if (r.userId === actorId) mine.add(r.emoji);
  }
  return {
    reactions: [...counts.entries()].map(([emoji, count]) => ({
      emoji,
      count,
    })),
    myReactions: [...mine],
  };
}

function toPostDTO(p: PostWithJoins, actorId: string): PostDTO {
  const { reactions, myReactions } = summarizeReactions(p.reactions, actorId);
  return {
    id: p.id,
    teamId: p.teamId,
    kind: p.kind,
    body: p.body,
    authorId: p.authorId,
    authorName: p.author.displayName,
    activity: p.activity ? toActivityDTO(p.activity) : null,
    commentCount: p._count.comments,
    reactions,
    myReactions,
    createdAt: p.createdAt.toISOString(),
  };
}

async function getPostOr404(postId: string) {
  const post = await db.feedPost.findUnique({
    where: { id: postId },
    include: POST_INCLUDE,
  });
  if (!post) throw notFound("Post not found");
  return post;
}

export async function createPost(
  actorId: string,
  teamId: string,
  input: CreatePostInput,
  ipAddress?: string,
): Promise<PostDTO> {
  await activeMembership(actorId, teamId);

  let activityId: string | null = null;
  if (input.activityId) {
    const activity = await db.activity.findUnique({
      where: { id: input.activityId },
    });
    // Only your own TEAM-visible activities can be shared, and only to a
    // team they belong to (or were logged without a team).
    if (
      !activity ||
      activity.userId !== actorId ||
      activity.visibility !== "TEAM" ||
      (activity.teamId !== null && activity.teamId !== teamId)
    ) {
      throw new AppError(
        422,
        "INVALID_ACTIVITY",
        "That activity cannot be shared to this team",
      );
    }
    activityId = activity.id;
  }

  const post = await db.feedPost.create({
    data: {
      teamId,
      authorId: actorId,
      kind: activityId ? "ACTIVITY_SHARE" : "TEXT",
      body: input.body?.trim() || null,
      activityId,
    },
    include: POST_INCLUDE,
  });

  await audit({
    actorId,
    action: "POST_CREATED",
    entityType: "FeedPost",
    entityId: post.id,
    metadata: { teamId, kind: post.kind },
    ipAddress,
  });

  return toPostDTO(post, actorId);
}

export async function listFeed(
  actorId: string,
  teamId: string,
  opts: { before?: string; limit: number },
): Promise<PostDTO[]> {
  await activeMembership(actorId, teamId);
  const posts = await db.feedPost.findMany({
    where: {
      teamId,
      ...(opts.before ? { createdAt: { lt: new Date(opts.before) } } : {}),
    },
    include: POST_INCLUDE,
    orderBy: { createdAt: "desc" },
    take: opts.limit,
  });
  return posts.map((p) => toPostDTO(p, actorId));
}

export async function deletePost(
  actorId: string,
  postId: string,
  ipAddress?: string,
): Promise<void> {
  const post = await getPostOr404(postId);
  const membership = await activeMembership(actorId, post.teamId);
  const isManager =
    membership.role === "COACH" || membership.role === "TEAM_ADMIN";
  if (post.authorId !== actorId && !isManager) {
    throw forbidden("You cannot delete this post");
  }

  await db.feedPost.delete({ where: { id: postId } });
  await audit({
    actorId,
    action: isManager && post.authorId !== actorId ? "POST_MODERATED" : "POST_DELETED",
    entityType: "FeedPost",
    entityId: postId,
    metadata: { teamId: post.teamId, authorId: post.authorId },
    ipAddress,
  });
}

export async function createComment(
  actorId: string,
  postId: string,
  input: CreateCommentInput,
  ipAddress?: string,
): Promise<CommentDTO> {
  const post = await getPostOr404(postId);
  await activeMembership(actorId, post.teamId);

  const comment = await db.postComment.create({
    data: { postId, authorId: actorId, body: input.body.trim() },
    include: { author: { select: { displayName: true } } },
  });

  await audit({
    actorId,
    action: "COMMENT_CREATED",
    entityType: "PostComment",
    entityId: comment.id,
    metadata: { postId, teamId: post.teamId },
    ipAddress,
  });

  return {
    id: comment.id,
    postId,
    authorId: comment.authorId,
    authorName: comment.author.displayName,
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
  };
}

export async function listComments(
  actorId: string,
  postId: string,
): Promise<CommentDTO[]> {
  const post = await getPostOr404(postId);
  await activeMembership(actorId, post.teamId);

  const comments = await db.postComment.findMany({
    where: { postId },
    include: { author: { select: { displayName: true } } },
    orderBy: { createdAt: "asc" },
  });
  return comments.map((c) => ({
    id: c.id,
    postId,
    authorId: c.authorId,
    authorName: c.author.displayName,
    body: c.body,
    createdAt: c.createdAt.toISOString(),
  }));
}

export async function deleteComment(
  actorId: string,
  commentId: string,
  ipAddress?: string,
): Promise<void> {
  const comment = await db.postComment.findUnique({
    where: { id: commentId },
    include: { post: { select: { teamId: true } } },
  });
  if (!comment) throw notFound("Comment not found");
  const membership = await activeMembership(actorId, comment.post.teamId);
  const isManager =
    membership.role === "COACH" || membership.role === "TEAM_ADMIN";
  if (comment.authorId !== actorId && !isManager) {
    throw forbidden("You cannot delete this comment");
  }

  await db.postComment.delete({ where: { id: commentId } });
  await audit({
    actorId,
    action:
      isManager && comment.authorId !== actorId
        ? "COMMENT_MODERATED"
        : "COMMENT_DELETED",
    entityType: "PostComment",
    entityId: commentId,
    metadata: { postId: comment.postId },
    ipAddress,
  });
}

/** Toggle: reacting twice with the same emoji removes it. */
export async function toggleReaction(
  actorId: string,
  postId: string,
  emoji: string,
): Promise<{ reactions: ReactionSummaryDTO[]; myReactions: string[] }> {
  const post = await getPostOr404(postId);
  await activeMembership(actorId, post.teamId);

  const existing = await db.postReaction.findUnique({
    where: { postId_userId_emoji: { postId, userId: actorId, emoji } },
  });
  if (existing) {
    await db.postReaction.delete({ where: { id: existing.id } });
  } else {
    await db.postReaction.create({
      data: { postId, userId: actorId, emoji },
    });
  }

  const reactions = await db.postReaction.findMany({
    where: { postId },
    select: { emoji: true, userId: true },
  });
  return summarizeReactions(reactions, actorId);
}

export async function reportPost(
  actorId: string,
  postId: string,
  reason: string,
  ipAddress?: string,
): Promise<ReportDTO> {
  const post = await getPostOr404(postId);
  await activeMembership(actorId, post.teamId);

  const dupe = await db.postReport.findFirst({
    where: { postId, reporterId: actorId, status: "OPEN" },
  });
  if (dupe) {
    throw new AppError(409, "REPORT_EXISTS", "You already reported this post");
  }

  const report = await db.postReport.create({
    data: { postId, reporterId: actorId, reason: reason.trim() },
    include: {
      reporter: { select: { displayName: true } },
      post: { select: { body: true, kind: true } },
    },
  });

  await audit({
    actorId,
    action: "POST_REPORTED",
    entityType: "PostReport",
    entityId: report.id,
    metadata: { postId, teamId: post.teamId },
    ipAddress,
  });

  return {
    id: report.id,
    postId,
    postExcerpt: (report.post.body ?? `[${report.post.kind}]`).slice(0, 120),
    reporterId: report.reporterId,
    reporterName: report.reporter.displayName,
    reason: report.reason,
    status: report.status,
    createdAt: report.createdAt.toISOString(),
  };
}

export async function listReports(
  actorId: string,
  teamId: string,
  status?: string,
): Promise<ReportDTO[]> {
  const membership = await activeMembership(actorId, teamId);
  requireManager(membership);

  const reports = await db.postReport.findMany({
    where: { post: { teamId }, ...(status ? { status } : {}) },
    include: {
      reporter: { select: { displayName: true } },
      post: { select: { body: true, kind: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return reports.map((r) => ({
    id: r.id,
    postId: r.postId,
    postExcerpt: (r.post.body ?? `[${r.post.kind}]`).slice(0, 120),
    reporterId: r.reporterId,
    reporterName: r.reporter.displayName,
    reason: r.reason,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function resolveReport(
  actorId: string,
  reportId: string,
  status: "RESOLVED" | "DISMISSED",
  ipAddress?: string,
): Promise<ReportDTO> {
  const report = await db.postReport.findUnique({
    where: { id: reportId },
    include: {
      reporter: { select: { displayName: true } },
      post: { select: { teamId: true, body: true, kind: true } },
    },
  });
  if (!report) throw notFound("Report not found");
  const membership = await activeMembership(actorId, report.post.teamId);
  requireManager(membership);

  const updated = await db.postReport.update({
    where: { id: reportId },
    data: { status, resolvedAt: new Date() },
  });

  await audit({
    actorId,
    action: "REPORT_RESOLVED",
    entityType: "PostReport",
    entityId: reportId,
    metadata: { status, postId: report.postId },
    ipAddress,
  });

  return {
    id: updated.id,
    postId: updated.postId,
    postExcerpt: (report.post.body ?? `[${report.post.kind}]`).slice(0, 120),
    reporterId: updated.reporterId,
    reporterName: report.reporter.displayName,
    reason: updated.reason,
    status: updated.status,
    createdAt: updated.createdAt.toISOString(),
  };
}

// Re-exported so route modules and tests share one DTO shape.
export type { ActivityDTO };
