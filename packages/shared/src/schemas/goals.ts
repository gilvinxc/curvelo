import { z } from "zod";

const goalKindSchema = z.enum(["DISTANCE", "SESSIONS", "STREAK"]);
const goalPeriodSchema = z.enum(["WEEK", "MONTH", "CUSTOM"]);

// ---- Personal goals (the athlete's own) ----

export const createPersonalGoalSchema = z.object({
  kind: goalKindSchema,
  period: goalPeriodSchema,
  // Human-unit value: miles/km for DISTANCE (converted server-side via profile
  // units), plain count for SESSIONS/STREAK.
  target: z.number().positive().max(100000),
  title: z.string().max(80).optional(),
  recurring: z.boolean().default(false),
  shareOnComplete: z.boolean().default(false),
  // Team to celebrate in when a shared goal completes.
  feedTeamId: z.string().uuid().optional(),
  // CUSTOM period only:
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
});
export type CreatePersonalGoalInput = z.infer<typeof createPersonalGoalSchema>;

// ---- Team goals (collective, created by a coach) ----

export const createTeamGoalSchema = z.object({
  kind: z.enum(["DISTANCE", "SESSIONS"]),
  title: z.string().min(2).max(80),
  target: z.number().positive().max(1000000),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
});
export type CreateTeamGoalInput = z.infer<typeof createTeamGoalSchema>;

export const goalParamsSchema = z.object({
  goalId: z.string().uuid(),
});
export type GoalParams = z.infer<typeof goalParamsSchema>;

// ---- Leaderboard ----

export const leaderboardQuerySchema = z.object({
  metric: z.enum(["distance", "sessions"]).default("distance"),
  days: z.coerce.number().int().min(1).max(90).default(7),
});
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;

// ---- Team logo ----

export const setTeamLogoSchema = z.object({
  // data URL: data:image/(jpeg|png|webp);base64,... — already resized client-side.
  image: z
    .string()
    .max(700_000, "Image is too large")
    .regex(/^data:image\/(jpeg|png|webp);base64,/, "Must be a JPEG, PNG, or WebP image"),
});
export type SetTeamLogoInput = z.infer<typeof setTeamLogoSchema>;

// ---- Progress analytics ----

export const progressQuerySchema = z.object({
  weeks: z.coerce.number().int().min(4).max(26).default(12),
});
export type ProgressQuery = z.infer<typeof progressQuerySchema>;
