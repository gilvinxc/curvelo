import { z } from "zod";

/** Official race distances, exact meters. */
export const STANDARD_RACE_DISTANCES = [
  { meters: 1609, label: "1 Mile" },
  { meters: 5000, label: "5K" },
  { meters: 10000, label: "10K" },
  { meters: 21097, label: "Half Marathon" },
  { meters: 42195, label: "Marathon" },
] as const;

export const createRaceResultSchema = z.object({
  raceName: z.string().trim().min(2).max(120),
  distanceM: z.number().int().positive().max(200000),
  durationS: z.number().int().positive().max(86400),
  racedAt: z.string().datetime(),
  activityId: z.string().uuid().optional(),
});
export type CreateRaceResultInput = z.infer<typeof createRaceResultSchema>;

export const raceResultParamsSchema = z.object({
  raceResultId: z.string().uuid(),
});
export type RaceResultParams = z.infer<typeof raceResultParamsSchema>;

export const createShoeSchema = z.object({
  name: z.string().trim().min(1).max(80),
  brand: z.string().trim().max(60).optional(),
  model: z.string().trim().max(60).optional(),
});
export type CreateShoeInput = z.infer<typeof createShoeSchema>;

export const updateShoeSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  brand: z.string().trim().max(60).optional().nullable(),
  model: z.string().trim().max(60).optional().nullable(),
  retired: z.boolean().optional(),
});
export type UpdateShoeInput = z.infer<typeof updateShoeSchema>;

export const shoeParamsSchema = z.object({
  shoeId: z.string().uuid(),
});
export type ShoeParams = z.infer<typeof shoeParamsSchema>;
