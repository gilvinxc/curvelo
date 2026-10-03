import type {
  ActivityDTO,
  CommentDTO,
  CreateCommentInput,
  CreatePostInput,
  PostDTO,
  ReactionSummaryDTO,
  ReportDTO,
} from "@curvelo/shared";
import { matchMentionedNames } from "@curvelo/shared";
import { db } from "../../db.js";
import { mentionRefsFor, syncMentions } from "../../lib/mentions.js";
import { attachPhotosToPost } from "../photos/service.js";
import type { PhotoDTO } from "@curvelo/shared";
import { audit } from "../../lib/audit.js";
import { AppError, forbidden, notFound } from "../../lib/errors.js";
import {
  activeMembership,
  requireManager,
} from "../../lib/permissions.js";
import {
  assertPhotoConsentForShare,
  checkPhotoConsents,
  grantPhotoConsent,
} from "../../lib/photoConsent.js";
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
  author: { displayName: string; hasAvatar: boolean };
  activity: ActivityWithJoins | null;
  _count: { comments: number };
  reactions: Array<{ emoji: string; userId: string }>;
  photos: Array<{
    id: string;
    teamId: string;
    albumId: string | null;
    postId: string | null;
    uploaderId: string;
    uploader: { displayName: string };
    mimeType: string;
    caption: string | null;
    status: string;
    subjects: Array<{ athleteId: string }>;
    createdAt: Date;
  }>;
};

const POST_INCLUDE = {
  author: { select: { displayName: true, hasAvatar: true } },
  activity: { include: ACTIVITY_WITH_JOINS },
  _count: { select: { comments: true } },
  reactions: { select: { emoji: true, userId: true } },
  photos: {
    where: { status: "APPROVED" },
    include: {
      uploader: { select: { displayName: true } },
      subjects: { select: { athleteId: true } },
    },
    orderBy: { createdAt: "asc" },
  },
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

function toPhotoDTO(p: {
  id: string;
  teamId: string;
  albumId: string | null;
  postId: string | null;
  uploaderId: string;
  uploader: { displayName: string };
  mimeType: string;
  caption: string | null;
  status: string;
  subjects: Array<{ athleteId: string }>;
  createdAt: Date;
}): PhotoDTO {
  return {
    id: p.id,
    teamId: p.teamId,
    albumId: p.albumId,
    postId: p.postId,
    uploaderId: p.uploaderId,
    uploaderName: p.uploader.displayName,
    mimeType: p.mimeType,
    caption: p.caption,
    status: p.status,
    picturedAthleteIds: p.subjects.map((sub) => sub.athleteId),
    createdAt: p.createdAt.toISOString(),
  };
}

async function toPostDTO(
  p: PostWithJoins,
  actorId: string,
  mentions: Map<string, { userId: string; displayName: string }[]>,
): Promise<PostDTO> {
  const { reactions, myReactions } = summarizeReactions(p.reactions, actorId);
  return {
    id: p.id,
    teamId: p.teamId,
    kind: p.kind,
    body: p.body,
    authorId: p.authorId,
    authorName: p.author.displayName,
    authorHasAvatar: p.author.hasAvatar,
    activity: p.activity ? await toActivityDTO(p.activity) : null,
    commentCount: p._count.comments,
    reactions,
    myReactions,
    mentions: mentions.get(p.id) ?? [],
    photos: (p.photos ?? []).map(toPhotoDTO),
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

/**
 * Parents are real team members (PARENT role, granted via verified
 * GuardianLink). They participate in the feed — view, comment, react, share
 * photos — but never moderate and can only publish photo posts. Everything
 * flows from the membership; there is no separate guardian-access path.
 */
function isParentRole(role: string): boolean {
  return role === "PARENT";
}

function isManagerRole(role: string): boolean {
  return role === "COACH" || role === "TEAM_ADMIN";
}

/**
 * "No minor's name in the caption without consent": any @-mentioned athlete
 * who is a minor must have photo consent before a photo post publishes.
 */
async function assertCaptionConsent(teamId: string, body: string | null | undefined) {
  if (!body || !body.includes("@")) return;
  const memberships = await db.teamMembership.findMany({
    where: { teamId, status: "ACTIVE" },
    include: { user: { select: { id: true, displayName: true } } },
  });
  const matched = matchMentionedNames(
    body,
    memberships.map((m) => m.user.displayName),
  );
  const ids: string[] = [];
  for (const name of matched) {
    const candidates = memberships.filter(
      (m) => m.user.displayName.toLowerCase() === name.toLowerCase(),
    );
    if (candidates.length === 1) ids.push(candidates[0].user.id);
  }
  if (ids.length === 0) return;
  const checks = await checkPhotoConsents([...new Set(ids)]);
  const lacking = checks.filter((c) => c.isMinor && !c.hasConsent);
  if (lacking.length > 0) {
    throw new AppError(
      422,
      "PHOTO_CONSENT_MISSING",
      `Can't share: photo consent is missing for ${lacking.map((c) => c.displayName).join(", ")}.`,
    );
  }
}

export async function createPost(
  actorId: string,
  teamId: string,
  input: CreatePostInput,
  ipAddress?: string,
): Promise<PostDTO> {
  const membership = await activeMembership(actorId, teamId);
  if (membership.role === "ALUMNI") {
    throw forbidden("Alumni can't post to the team wall");
  }

  const wantsPhotos = (input.photoIds?.length ?? 0) > 0;
  if (isParentRole(membership.role) && (!wantsPhotos || input.activityId)) {
    throw forbidden("Parents can share photos to the team feed");
  }

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

  const kind = activityId
    ? "ACTIVITY_SHARE"
    : wantsPhotos
      ? "PHOTO"
      : input.kind === "SHOUTOUT"
        ? "SHOUTOUT"
        : "TEXT";
  const post = await db.feedPost.create({
    data: {
      teamId,
      authorId: actorId,
      kind,
      body: input.body?.trim() || null,
      activityId,
    },
    include: POST_INCLUDE,
  });

  let fullPost = post;
  if (input.photoIds?.length) {
    // Tag pictured athletes at share time. Inline grants let a guardian
    // consent for their own kid in the same share. The per-share consent
    // gate itself runs inside attachPhotosToPost (never cached).
    const pictured = [...new Set(input.picturedAthleteIds ?? [])];
    if (pictured.length > 0) {
      const photos = await db.photo.findMany({
        where: { id: { in: input.photoIds } },
        select: { id: true, teamId: true },
      });
      for (const photo of photos) {
        if (photo.teamId !== teamId) continue;
        await db.photoSubject.createMany({
          data: pictured.map((athleteId) => ({ photoId: photo.id, athleteId })),
          skipDuplicates: true,
        });
      }
    }
    for (const athleteId of input.grantPhotoConsentFor ?? []) {
      await grantPhotoConsent(actorId, athleteId, ipAddress);
    }
    await assertCaptionConsent(teamId, input.body);
    await attachPhotosToPost(actorId, teamId, post.id, input.photoIds, ipAddress);
    // Re-fetch so the attached photos are included in the response.
    fullPost = await db.feedPost.findUniqueOrThrow({
      where: { id: post.id },
      include: POST_INCLUDE,
    });
  }

  const author = await db.user.findUnique({
    where: { id: actorId },
    select: { displayName: true },
  });
  await syncMentions({
    targetType: "POST",
    targetId: post.id,
    teamId,
    mentionerId: actorId,
    mentionerName: author?.displayName ?? "Someone",
    text: fullPost.body,
    link: `/teams/${teamId}/feed#post-${post.id}`,
  });

  await audit({
    actorId,
    action: "POST_CREATED",
    entityType: "FeedPost",
    entityId: post.id,
    metadata: { teamId, kind: post.kind },
    ipAddress,
  });

  const mentions = await mentionRefsFor("POST", [post.id]);
  return toPostDTO(fullPost, actorId, mentions);
}

/**
 * System-generated celebration posts (milestones, member welcomes).
 * Internal only — the public API cannot set these kinds.
 */
export async function createSystemPost(opts: {
  teamId: string;
  authorId: string;
  kind: "MILESTONE" | "WELCOME";
  body: string;
  activityId?: string;
}): Promise<PostDTO> {
  const post = await db.feedPost.create({
    data: {
      teamId: opts.teamId,
      authorId: opts.authorId,
      kind: opts.kind,
      body: opts.body,
      activityId: opts.activityId ?? null,
    },
    include: POST_INCLUDE,
  });

  const author = await db.user.findUnique({
    where: { id: opts.authorId },
    select: { displayName: true },
  });
  await syncMentions({
    targetType: "POST",
    targetId: post.id,
    teamId: opts.teamId,
    mentionerId: opts.authorId,
    mentionerName: author?.displayName ?? "Someone",
    text: post.body,
    link: `/teams/${opts.teamId}/feed#post-${post.id}`,
  });

  await audit({
    actorId: opts.authorId,
    action: "POST_CREATED",
    entityType: "FeedPost",
    entityId: post.id,
    metadata: { teamId: opts.teamId, kind: post.kind, system: true },
  });

  const mentions = await mentionRefsFor("POST", [post.id]);
  return toPostDTO(post, opts.authorId, mentions);
}

/** Post kinds visible to the alumni (outer) tier. No training data, no photos. */
export const ALUMNI_VISIBLE_KINDS = ["MILESTONE", "SHOUTOUT", "WELCOME"] as const;

export async function listFeed(
  actorId: string,
  teamId: string,
  opts: { before?: string; limit: number },
): Promise<PostDTO[]> {
  const membership = await activeMembership(actorId, teamId);
  const posts = await db.feedPost.findMany({
    where: {
      teamId,
      ...(opts.before ? { createdAt: { lt: new Date(opts.before) } } : {}),
      // Alumni (outer tier) see only celebratory kinds — no workout logs,
      // no training posts, no photos. Parents see the full inner feed.
      ...(membership.role === "ALUMNI"
        ? { kind: { in: [...ALUMNI_VISIBLE_KINDS] } }
        : {}),
    },
    include: POST_INCLUDE,
    orderBy: { createdAt: "desc" },
    take: opts.limit,
  });
  const mentions = await mentionRefsFor(
    "POST",
    posts.map((p) => p.id),
  );
  return Promise.all(posts.map((p) => toPostDTO(p, actorId, mentions)));
}

export async function deletePost(
  actorId: string,
  postId: string,
  ipAddress?: string,
): Promise<void> {
  const post = await getPostOr404(postId);
  const membership = await activeMembership(actorId, post.teamId);
  const isManager = isManagerRole(membership.role);
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
    include: { author: { select: { displayName: true, hasAvatar: true } } },
  });

  await syncMentions({
    targetType: "COMMENT",
    targetId: comment.id,
    teamId: post.teamId,
    mentionerId: actorId,
    mentionerName: comment.author.displayName,
    text: comment.body,
    link: `/teams/${post.teamId}/feed#post-${postId}`,
  });

  await audit({
    actorId,
    action: "COMMENT_CREATED",
    entityType: "PostComment",
    entityId: comment.id,
    metadata: { postId, teamId: post.teamId },
    ipAddress,
  });

  const mentions = await mentionRefsFor("COMMENT", [comment.id]);
  return {
    id: comment.id,
    postId,
    authorId: comment.authorId,
    authorName: comment.author.displayName,
    authorHasAvatar: comment.author.hasAvatar,
    body: comment.body,
    mentions: mentions.get(comment.id) ?? [],
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
    include: { author: { select: { displayName: true, hasAvatar: true } } },
    orderBy: { createdAt: "asc" },
  });
  const mentions = await mentionRefsFor(
    "COMMENT",
    comments.map((c) => c.id),
  );
  return comments.map((c) => ({
    id: c.id,
    postId,
    authorId: c.authorId,
    authorName: c.author.displayName,
    authorHasAvatar: c.author.hasAvatar,
    body: c.body,
    mentions: mentions.get(c.id) ?? [],
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
  const isManager = isManagerRole(membership.role);
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
      reporter: { select: { displayName: true, hasAvatar: true } },
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
    reporterHasAvatar: report.reporter.hasAvatar,
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
      reporter: { select: { displayName: true, hasAvatar: true } },
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
    reporterHasAvatar: r.reporter.hasAvatar,
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
      reporter: { select: { displayName: true, hasAvatar: true } },
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
    reporterHasAvatar: report.reporter.hasAvatar,
    reason: updated.reason,
    status: updated.status,
    createdAt: updated.createdAt.toISOString(),
  };
}

// Re-exported so route modules and tests share one DTO shape.
export type { ActivityDTO };
