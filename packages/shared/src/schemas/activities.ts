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
  steps: z.number().int().positive().max(200_000).optional(),
  elevationGainM: z.number().min(0).max(100_000).optional(),
  avgCadenceSpm: z.number().int().min(0).max(300).optional(),
  shareToFeed: z.boolean().optional(),
  city: z.string().trim().max(120).optional(),
  cityLat: z.number().min(-90).max(90).optional(),
  cityLon: z.number().min(-180).max(180).optional(),
  terrain: z.enum(["ROAD", "TRAIL", "TRACK", "TREADMILL", "GRASS", "OTHER"]).optional(),
  weatherTempC: z.number().min(-60).max(60).optional(),
  weatherCondition: z.string().trim().max(40).optional(),
};

const notFuture = (startedAt: string) =>
  new Date(startedAt).getTime() <= Date.now() + 5 * 60 * 1000;

/** One lap split: at least one of distance or duration required. */
export const activitySplitSchema = z
  .object({
    distanceM: z.number().positive().max(500_000).optional(),
    durationS: z.number().int().positive().max(86400).optional(),
  })
  .refine((s) => s.distanceM !== undefined || s.durationS !== undefined, {
    message: "Split needs a distance or a duration",
  });
export type ActivitySplitInput = z.infer<typeof activitySplitSchema>;

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
    shoeId: z.string().uuid().optional().nullable(),
    // Current body weight; when provided it also updates the profile.
    weightKg: z.number().min(25).max(350).optional(),
    splits: z.array(activitySplitSchema).max(200).optional(),
    // Teammate tags: user ids to notify ("add it to your log?").
    // Only valid on TEAM-visible activities; enforced in the service.
    taggedUserIds: z.array(z.string().uuid()).max(20).optional(),
    // Accepting a tag: marks the tag ACCEPTED after this activity saves.
    fromTagId: z.string().uuid().optional(),
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

/**
 * Coach bulk-log: one run recorded for many athletes at once (e.g. after a
 * team practice). Omit userIds to target every active runner on the team
 * (or every member of groupId when given).
 */
export const logTeamRunSchema = z
  .object({
    teamId: z.string().uuid(),
    groupId: z.string().uuid().optional(),
    userIds: z.array(z.string().uuid()).min(1).max(200).optional(),
    kind: z.enum(ACTIVITY_KINDS).default("RUN"),
    title: z.string().min(1).max(120).optional(),
    startedAt: z.string().datetime({ offset: true }),
    ...metrics,
    notes: z.string().max(2000).optional(),
    visibility: z.enum(ACTIVITY_VISIBILITY).default("TEAM"),
    // Per-athlete overrides: blank fields fall back to the team-level values.
    overrides: z
      .array(
        z.object({
          userId: z.string().uuid(),
          distanceM: z.number().positive().max(500_000).optional(),
          durationS: z.number().int().positive().max(86400).optional(),
          avgHrBpm: z.number().int().positive().max(250).optional(),
          maxHrBpm: z.number().int().positive().max(250).optional(),
        }),
      )
      .max(200)
      .optional(),
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
export type LogTeamRunInput = z.infer<typeof logTeamRunSchema>;

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
    shoeId: z.string().uuid().optional().nullable(),
    // Current body weight; when provided it also updates the profile.
    weightKg: z.number().min(25).max(350).optional(),
    // Replace-all: providing splits replaces the activity's splits.
    splits: z.array(activitySplitSchema).max(200).optional(),
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
