import { z } from "zod";
import { TEAM_ROLES } from "../constants.js";

export const createInvitationSchema = z.object({
  email: z.string().email().max(255),
  role: z.enum(TEAM_ROLES).default("RUNNER"),
});
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

export const invitationTokenParamsSchema = z.object({
  token: z.string().min(16).max(128),
});
export type InvitationTokenParams = z.infer<typeof invitationTokenParamsSchema>;
