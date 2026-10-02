import { z } from "zod";

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const createTeamSchema = z.object({
  name: z.string().min(2).max(80),
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(slugRegex, "lowercase letters, numbers, and hyphens only")
    .optional(),
  description: z.string().max(2000).optional(),
  visibility: z.enum(["PRIVATE", "PUBLIC"]).default("PRIVATE"),
});
export type CreateTeamInput = z.infer<typeof createTeamSchema>;

export const updateTeamSchema = createTeamSchema.partial().extend({
  slug: z.string().min(2).max(60).regex(slugRegex).optional(),
});
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;

export const teamParamsSchema = z.object({
  id: z.string().uuid(),
});
export type TeamParams = z.infer<typeof teamParamsSchema>;
