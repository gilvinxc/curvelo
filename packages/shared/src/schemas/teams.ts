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
  city: z.string().min(1).max(80).optional(),
  state: z.string().min(1).max(40).optional(),
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

const teamRoleSchema = z.enum(["COACH", "RUNNER", "PARENT", "TEAM_ADMIN", "ALUMNI"]);

// ---- Shareable join links ----

export const createJoinLinkSchema = z.object({
  expiresInDays: z.number().int().min(1).max(30).default(7),
  maxUses: z.number().int().min(1).max(500).optional(),
});
export type CreateJoinLinkInput = z.infer<typeof createJoinLinkSchema>;

export const joinLinkTokenParamsSchema = z.object({
  token: z.string().min(1).max(64),
});
export type JoinLinkTokenParams = z.infer<typeof joinLinkTokenParamsSchema>;

export const joinLinkParamsSchema = teamParamsSchema.extend({
  linkId: z.string().uuid(),
});

export const approveJoinRequestSchema = z.object({
  role: teamRoleSchema.default("RUNNER"),
});
export type ApproveJoinRequestInput = z.infer<typeof approveJoinRequestSchema>;

export const joinRequestParamsSchema = teamParamsSchema.extend({
  requestId: z.string().uuid(),
});

// ---- Public team directory ----
export const directoryQuerySchema = z.object({
  q: z.string().min(1).max(80).optional(),
  city: z.string().min(1).max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export type DirectoryQuery = z.infer<typeof directoryQuerySchema>;

// ---- Member management ----

export const teamMemberParamsSchema = teamParamsSchema.extend({
  userId: z.string().uuid(),
});

export const updateMemberRoleSchema = z.object({
  role: teamRoleSchema,
});
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

export const transferTeamSchema = z.object({
  newOwnerId: z.string().uuid(),
});
export type TransferTeamInput = z.infer<typeof transferTeamSchema>;
