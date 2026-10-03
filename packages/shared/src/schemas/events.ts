import { z } from "zod";

export const teamEventTypes = [
  "PRACTICE",
  "MEETING",
  "RACE",
  "SOCIAL",
  "OTHER",
] as const;

const recurrenceSchema = z.object({
  freq: z.literal("WEEKLY"),
  // 0 = Monday .. 6 = Sunday
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  until: z.string().date(),
});

export const createTeamEventSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  eventType: z.enum(teamEventTypes).default("PRACTICE"),
  // Local date + time as ISO-ish strings; stored as UTC instants.
  date: z.string().date(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  location: z.string().trim().max(200).optional(),
  itinerary: z.string().trim().max(4000).optional(),
  recurrence: recurrenceSchema.optional(),
});
export type CreateTeamEventInput = z.infer<typeof createTeamEventSchema>;

export const updateTeamEventSchema = createTeamEventSchema.partial();
export type UpdateTeamEventInput = z.infer<typeof updateTeamEventSchema>;

export const saveAttendanceSchema = z.object({
  date: z.string().date(),
  eventId: z.string().uuid().optional(),
  records: z.record(z.string().uuid(), z.boolean()).refine((r) => Object.keys(r).length >= 1 && Object.keys(r).length <= 500, {
    message: "Provide 1-500 attendance records",
  }),
});
export type SaveAttendanceInput = z.infer<typeof saveAttendanceSchema>;
