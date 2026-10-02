import { z } from "zod";

export const GUARDIAN_RELATIONSHIPS = [
  "parent",
  "guardian",
  "grandparent",
  "sibling",
  "other",
] as const;

export const CONSENT_TYPES = ["PARTICIPATION", "DATA_SHARING"] as const;

export const inviteGuardianSchema = z.object({
  email: z.string().email().max(255),
  relationship: z.enum(GUARDIAN_RELATIONSHIPS).default("parent"),
});
export type InviteGuardianInput = z.infer<typeof inviteGuardianSchema>;

export const guardianInviteParamsSchema = z.object({ token: z.string().min(8) });

export const acceptGuardianInviteSchema = z.object({
  consents: z.array(z.enum(CONSENT_TYPES)).default([]),
});
export type AcceptGuardianInviteInput = z.infer<typeof acceptGuardianInviteSchema>;

export const guardianLinkParamsSchema = z.object({ id: z.string().uuid() });

export const athleteGuardianParamsSchema = z.object({
  id: z.string().uuid(), // team id
  userId: z.string().uuid(), // athlete id
});
