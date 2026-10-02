import { z } from "zod";

export const athleteInsightParamsSchema = z.object({
  id: z.string().uuid(), // team id
  userId: z.string().uuid(), // athlete id
});

export const teamDigestParamsSchema = z.object({
  id: z.string().uuid(), // team id
});

export const teamDigestQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(90).default(28),
});
