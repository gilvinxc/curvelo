import { z } from "zod";

export const WORKOUT_KINDS = [
  "INTERVAL",
  "TEMPO",
  "PROGRESSION",
  "LONG_RUN",
  "RECOVERY",
  "RACE",
  "CROSS_TRAINING",
  "STRENGTH",
  "CUSTOM",
] as const;

export const WORKOUT_STEP_KINDS = [
  "WARMUP",
  "COOLDOWN",
  "INTERVAL",
  "RECOVERY",
  "STEADY",
  "REST",
] as const;

export const workoutStepSchema = z
  .object({
    kind: z.enum(WORKOUT_STEP_KINDS),
    // Canonical units: meters, seconds, sec/km pace, bpm, RPE 1–10.
    distanceM: z.number().positive().max(500_000).optional(),
    durationS: z.number().int().positive().max(86400).optional(),
    targetPaceS: z.number().positive().max(3600).optional(),
    targetHrBpm: z.number().int().positive().max(250).optional(),
    targetRpe: z.number().int().min(1).max(10).optional(),
    repetitions: z.number().int().min(1).max(100).default(1),
    notes: z.string().max(500).optional(),
  })
  .refine(
    (s) => s.distanceM !== undefined || s.durationS !== undefined || s.kind === "REST",
    { message: "Step needs a distance or duration (REST steps excepted)" },
  );
export type WorkoutStepInput = z.infer<typeof workoutStepSchema>;

export const createWorkoutSchema = z.object({
  title: z.string().min(2).max(120),
  description: z.string().max(2000).optional(),
  kind: z.enum(WORKOUT_KINDS).default("CUSTOM"),
  isTemplate: z.boolean().default(false),
  steps: z.array(workoutStepSchema).min(1).max(50),
});
export type CreateWorkoutInput = z.infer<typeof createWorkoutSchema>;

export const updateWorkoutSchema = z.object({
  title: z.string().min(2).max(120).optional(),
  description: z.string().max(2000).optional().nullable(),
  kind: z.enum(WORKOUT_KINDS).optional(),
  isTemplate: z.boolean().optional(),
  // Full replacement of the step list when provided (simpler + safer than diffing).
  steps: z.array(workoutStepSchema).min(1).max(50).optional(),
});
export type UpdateWorkoutInput = z.infer<typeof updateWorkoutSchema>;

export const workoutParamsSchema = z.object({ id: z.string().uuid() });

export const createAssignmentSchema = z
  .object({
    workoutId: z.string().uuid(),
    // Exactly one target: whole team (neither), one group, or one athlete.
    groupId: z.string().uuid().optional(),
    assignedToUserId: z.string().uuid().optional(),
    scheduledDate: z.string().date(),
    notes: z.string().max(1000).optional(),
  })
  .refine((a) => !(a.groupId && a.assignedToUserId), {
    message: "Assign to a group or an individual, not both",
  });
export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;

export const calendarQuerySchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
});
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;

export const createGroupSchema = z.object({
  name: z.string().min(2).max(80),
  memberIds: z.array(z.string().uuid()).max(500).default([]),
});
export type CreateGroupInput = z.infer<typeof createGroupSchema>;

export const groupParamsSchema = z.object({ groupId: z.string().uuid() });

export const addGroupMembersSchema = z.object({
  memberIds: z.array(z.string().uuid()).min(1).max(500),
});
export type AddGroupMembersInput = z.infer<typeof addGroupMembersSchema>;
