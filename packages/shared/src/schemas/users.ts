import { z } from "zod";

export const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(80).optional(),
  bio: z.string().max(500).optional().nullable(),
  city: z.string().max(120).optional().nullable(),
  units: z.enum(["metric", "imperial"]).optional(),
  defaultShareLevel: z
    .enum(["FULL", "SUMMARY", "ACHIEVEMENT_ONLY", "NONE"])
    .optional(),
  dateOfBirth: z.string().date().optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  emergencyName: z.string().max(80).optional().nullable(),
  emergencyPhone: z.string().max(30).optional().nullable(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
