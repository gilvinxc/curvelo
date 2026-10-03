import { z } from "zod";

export const POST_KINDS = ["TEXT", "ACTIVITY_SHARE", "MILESTONE", "SHOUTOUT", "WELCOME", "PHOTO"] as const;

/** Small allowlist keeps reactions friendly and renderable everywhere. */
export const REACTION_EMOJIS = ["👍", "❤️", "🔥", "👏", "💪", "🎉", "🏃", "🍀"] as const;

export const createPostSchema = z
  .object({
    body: z.string().trim().min(1).max(2000).optional(),
    activityId: z.string().uuid().optional(),
    photoIds: z.array(z.string().uuid()).max(5).optional(),
    kind: z.enum(["TEXT", "SHOUTOUT"]).optional(),
    // Photo-share consent: athletes pictured, and inline consent grants for
    // the uploader's own kids (verified guardian only).
    picturedAthleteIds: z.array(z.string().uuid()).max(20).optional(),
    grantPhotoConsentFor: z.array(z.string().uuid()).max(20).optional(),
  })
  .refine((p) => p.body !== undefined || p.activityId !== undefined || (p.photoIds?.length ?? 0) > 0, {
    message: "A post needs text, a shared activity, or photos",
  });
export type CreatePostInput = z.infer<typeof createPostSchema>;

export const feedQuerySchema = z.object({
  before: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type FeedQuery = z.infer<typeof feedQuerySchema>;

export const postParamsSchema = z.object({ postId: z.string().uuid() });

export const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(1000),
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

export const commentParamsSchema = z.object({ commentId: z.string().uuid() });

export const toggleReactionSchema = z.object({
  emoji: z.enum(REACTION_EMOJIS),
});
export type ToggleReactionInput = z.infer<typeof toggleReactionSchema>;

export const reportPostSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type ReportPostInput = z.infer<typeof reportPostSchema>;

export const reportsQuerySchema = z.object({
  status: z.enum(["OPEN", "RESOLVED", "DISMISSED"]).optional(),
});
export type ReportsQuery = z.infer<typeof reportsQuerySchema>;

export const resolveReportSchema = z.object({
  status: z.enum(["RESOLVED", "DISMISSED"]),
});
export type ResolveReportInput = z.infer<typeof resolveReportSchema>;

export const reportParamsSchema = z.object({ reportId: z.string().uuid() });
