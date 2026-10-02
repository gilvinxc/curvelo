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
  // Sane human ranges: height 100-250 cm, weight 25-350 kg.
  heightCm: z.number().min(100).max(250).optional().nullable(),
  weightKg: z.number().min(25).max(350).optional().nullable(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
