import { z } from "zod";

export const ACTIVITY_KINDS = [
  "RUN",
  "WALK",
  "CROSS_TRAINING",
  "STRENGTH",
  "REST_DAY",
  "OTHER",
] as const;

export const ACTIVITY_SOURCES = [
  "MANUAL",
  "GARMIN",
  "STRAVA",
  "APPLE_HEALTH",
  "GOOGLE_HEALTH",
  "FILE_IMPORT",
] as const;

export const ACTIVITY_VISIBILITY = ["PRIVATE", "TEAM"] as const;

const metrics = {
  distanceM: z.number().positive().max(500_000).optional(),
  durationS: z.number().int().positive().max(86400).optional(),
  avgHrBpm: z.number().int().positive().max(250).optional(),
  maxHrBpm: z.number().int().positive().max(250).optional(),
  effortRpe: z.number().int().min(1).max(10).optional(),
  calories: z.number().int().positive().max(50_000).optional(),
};

const notFuture = (startedAt: string) =>
  new Date(startedAt).getTime() <= Date.now() + 5 * 60 * 1000;

export const createActivitySchema = z
  .object({
    kind: z.enum(ACTIVITY_KINDS).default("RUN"),
    title: z.string().min(1).max(120).optional(),
    startedAt: z.string().datetime({ offset: true }),
    ...metrics,
    notes: z.string().max(2000).optional(),
    teamId: z.string().uuid().optional(),
    assignmentId: z.string().uuid().optional(),
    visibility: z.enum(ACTIVITY_VISIBILITY).optional(),
  })
  .refine((a) => a.distanceM !== undefined || a.durationS !== undefined, {
    message: "Log at least a distance or a duration",
  })
  .refine((a) => notFuture(a.startedAt), {
    message: "Cannot log an activity in the future",
  })
  .refine(
    (a) =>
      a.maxHrBpm === undefined ||
      a.avgHrBpm === undefined ||
      a.maxHrBpm >= a.avgHrBpm,
    { message: "Max HR must be at least average HR" },
  );
export type CreateActivityInput = z.infer<typeof createActivitySchema>;

export const updateActivitySchema = z
  .object({
    kind: z.enum(ACTIVITY_KINDS).optional(),
    title: z.string().min(1).max(120).optional().nullable(),
    startedAt: z.string().datetime({ offset: true }).optional(),
    ...metrics,
    notes: z.string().max(2000).optional().nullable(),
    teamId: z.string().uuid().optional().nullable(),
    assignmentId: z.string().uuid().optional().nullable(),
    visibility: z.enum(ACTIVITY_VISIBILITY).optional(),
  })
  .refine(
    (a) => a.startedAt === undefined || notFuture(a.startedAt),
    { message: "Cannot log an activity in the future" },
  )
  .refine(
    (a) =>
      a.maxHrBpm === undefined ||
      a.avgHrBpm === undefined ||
      a.maxHrBpm >= a.avgHrBpm,
    { message: "Max HR must be at least average HR" },
  );
export type UpdateActivityInput = z.infer<typeof updateActivitySchema>;

export const activityParamsSchema = z.object({ id: z.string().uuid() });

export const activityQuerySchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  teamId: z.string().uuid().optional(),
});
export type ActivityQuery = z.infer<typeof activityQuerySchema>;

export const statsQuerySchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
});
export type StatsQuery = z.infer<typeof statsQuerySchema>;

export const athleteParamsSchema = z.object({
  id: z.string().uuid(), // team id
  userId: z.string().uuid(),
});
