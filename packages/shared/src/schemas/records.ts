import { z } from "zod";

/** Official race distances, exact meters. */
export const STANDARD_RACE_DISTANCES = [
  { meters: 1609, label: "1 Mile" },
  { meters: 5000, label: "5K" },
  { meters: 10000, label: "10K" },
  { meters: 21097, label: "Half Marathon" },
  { meters: 42195, label: "Marathon" },
] as const;

export const raceSplitSchema = z.object({
  distanceM: z.number().positive().max(500000),
  durationS: z.number().int().positive().max(86400),
});
export type RaceSplit = z.infer<typeof raceSplitSchema>;

export const createRaceResultSchema = z
  .object({
    raceName: z.string().trim().min(2).max(120),
    distanceM: z.number().int().positive().max(200000),
    durationS: z.number().int().positive().max(86400),
    racedAt: z.string().datetime(),
    activityId: z.string().uuid().optional(),
    splits: z.array(raceSplitSchema).min(2).max(100).optional(),
    finishPlace: z.number().int().positive().max(1000000).optional(),
    ageGroupPlace: z.number().int().positive().max(1000000).optional(),
    fieldSize: z.number().int().positive().max(1000000).optional(),
  })
  .refine(
    (r) => {
      if (!r.splits || r.splits.length === 0) return true;
      const sum = r.splits.reduce((a, s) => a + s.durationS, 0);
      return Math.abs(sum - r.durationS) <= Math.max(60, r.durationS * 0.1);
    },
    { message: "Splits should add up to the official time" },
  )
  .refine(
    (r) =>
      r.finishPlace === undefined ||
      r.fieldSize === undefined ||
      r.finishPlace <= r.fieldSize,
    { message: "Finish place can't be larger than the field size" },
  );
export type CreateRaceResultInput = z.infer<typeof createRaceResultSchema>;

export const raceResultParamsSchema = z.object({
  raceResultId: z.string().uuid(),
});
export type RaceResultParams = z.infer<typeof raceResultParamsSchema>;

export const createShoeSchema = z.object({
  name: z.string().trim().min(1).max(80),
  brand: z.string().trim().max(60).optional(),
  model: z.string().trim().max(60).optional(),
  lifespanM: z.number().int().min(10000).max(5000000).optional(),
});
export type CreateShoeInput = z.infer<typeof createShoeSchema>;

export const updateShoeSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  brand: z.string().trim().max(60).optional().nullable(),
  model: z.string().trim().max(60).optional().nullable(),
  retired: z.boolean().optional(),
  lifespanM: z.number().int().min(10000).max(5000000).optional(),
});
export type UpdateShoeInput = z.infer<typeof updateShoeSchema>;

export const shoeParamsSchema = z.object({
  shoeId: z.string().uuid(),
});
export type ShoeParams = z.infer<typeof shoeParamsSchema>;

/** Coach bulk race entry: official results for many athletes in one race. */
export const logTeamRaceSchema = z
  .object({
    teamId: z.string().uuid(),
    raceName: z.string().trim().min(2).max(120),
    distanceM: z.number().int().positive().max(200000),
    racedAt: z.string().datetime(),
    fieldSize: z.number().int().positive().max(1000000).optional(),
    entries: z
      .array(
        z.object({
          userId: z.string().uuid(),
          durationS: z.number().int().positive().max(86400),
          finishPlace: z.number().int().positive().max(1000000).optional(),
          ageGroupPlace: z.number().int().positive().max(1000000).optional(),
          splits: z.array(raceSplitSchema).min(2).max(100).optional(),
        }),
      )
      .min(1)
      .max(200),
  })
  .refine((r) => new Date(r.racedAt).getTime() <= Date.now() + 5 * 60 * 1000, {
    message: "Cannot log a race in the future",
  });
export type LogTeamRaceInput = z.infer<typeof logTeamRaceSchema>;
