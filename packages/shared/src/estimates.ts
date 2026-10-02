/**
 * Rough, transparent estimates for steps and calories. These are explicitly
 * labeled as estimates in the UI and are always overwritable.
 */

const STRIDE_RATIO: Record<string, number> = {
  WALK: 0.415,
  RUN: 0.413,
};

/** Steps ≈ distance / stride length, stride ≈ 0.413 × height. */
export function estimateSteps(
  distanceM: number | undefined,
  heightCm: number | undefined | null,
  kind: string,
): number | null {
  if (!distanceM || distanceM <= 0 || !heightCm || heightCm <= 0) return null;
  const strideM = (heightCm / 100) * (STRIDE_RATIO[kind] ?? 0.413);
  if (strideM <= 0) return null;
  return Math.round(distanceM / strideM);
}

const METS: Record<string, number> = {
  RUN: 9.8,
  WALK: 3.5,
  CROSS_TRAINING: 6,
  STRENGTH: 5,
  REST_DAY: 1,
  OTHER: 4,
};

/**
 * Calories ≈ 1.03 kcal per kg per km for run/walk (distance-based);
 * MET × kg × hours for everything else.
 */
export function estimateCalories(input: {
  kind: string;
  distanceM?: number | null;
  durationS?: number | null;
  weightKg?: number | null;
}): number | null {
  const { kind, distanceM, durationS, weightKg } = input;
  if (!weightKg || weightKg <= 0) return null;
  if ((kind === "RUN" || kind === "WALK") && distanceM && distanceM > 0) {
    return Math.round(1.03 * weightKg * (distanceM / 1000));
  }
  if (durationS && durationS > 0) {
    return Math.round((METS[kind] ?? 4) * weightKg * (durationS / 3600));
  }
  return null;
}
