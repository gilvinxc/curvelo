import { z } from "zod";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const personalPlanDaySchema = z.object({
  date: ymd,
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(2000).optional(),
});

export const createPersonalPlanSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  days: z.array(personalPlanDaySchema).max(365),
});

export const updatePersonalPlanSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  days: z.array(personalPlanDaySchema).max(365).optional(),
});

export type CreatePersonalPlanInput = z.infer<typeof createPersonalPlanSchema>;
export type UpdatePersonalPlanInput = z.infer<typeof updatePersonalPlanSchema>;
