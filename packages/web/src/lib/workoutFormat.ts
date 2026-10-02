import type { WorkoutStepDTO } from "@curvelo/shared";

export const WORKOUT_KIND_LABELS: Record<string, string> = {
  INTERVAL: "Intervals",
  TEMPO: "Tempo",
  PROGRESSION: "Progression",
  LONG_RUN: "Long run",
  RECOVERY: "Recovery",
  RACE: "Race",
  CROSS_TRAINING: "Cross training",
  STRENGTH: "Strength",
  CUSTOM: "Custom",
};

export const STEP_KIND_LABELS: Record<string, string> = {
  WARMUP: "Warmup",
  COOLDOWN: "Cooldown",
  INTERVAL: "Interval",
  RECOVERY: "Recovery",
  STEADY: "Steady",
  REST: "Rest",
};

export function workoutKindLabel(kind: string): string {
  return WORKOUT_KIND_LABELS[kind] ?? kind;
}

export function stepKindLabel(kind: string): string {
  return STEP_KIND_LABELS[kind] ?? kind;
}

/** 200 (sec/km) → "3:20/km". */
export function formatPaceSec(paceS: number): string {
  const total = Math.round(paceS);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

/** 800 → "800m", 1500 → "1.5km", 5000 → "5km". */
export function formatDistanceM(distanceM: number): string {
  if (distanceM >= 1000) {
    const km = distanceM / 1000;
    return `${Number.isInteger(km) ? km.toFixed(0) : km.toFixed(1)}km`;
  }
  return `${Math.round(distanceM)}m`;
}

/** 600 → "10:00", 5400 → "1:30:00". */
export function formatDurationS(durationS: number): string {
  const total = Math.round(durationS);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Human-readable one-line summary for a workout step.
 * e.g. "6 × 800m @ 3:20/km", "Warmup · 10:00", "Rest · 1:00".
 */
export function stepSummary(step: Pick<
  WorkoutStepDTO,
  | "kind"
  | "distanceM"
  | "durationS"
  | "targetPaceS"
  | "targetHrBpm"
  | "targetRpe"
  | "repetitions"
>): string {
  const parts: string[] = [];
  const base: string[] = [];
  if (step.distanceM != null) base.push(formatDistanceM(step.distanceM));
  if (step.durationS != null) base.push(formatDurationS(step.durationS));
  const targets: string[] = [];
  if (step.targetPaceS != null)
    targets.push(`@ ${formatPaceSec(step.targetPaceS)}`);
  if (step.targetHrBpm != null) targets.push(`${step.targetHrBpm}bpm`);
  if (step.targetRpe != null) targets.push(`RPE ${step.targetRpe}`);

  let core = base.join(" · ");
  if (targets.length > 0) core = core ? `${core} ${targets.join(" ")}` : targets.join(" ");
  if (!core) core = "—";

  const reps = step.repetitions > 1 ? `${step.repetitions} × ` : "";
  parts.push(`${reps}${core}`);
  return `${stepKindLabel(step.kind)}: ${parts.join(" ")}`;
}

/** Today's date as YYYY-MM-DD in the user's local timezone. */
export function todayYMD(): string {
  const d = new Date();
  return toYMD(d);
}

export function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Add n days to a YYYY-MM-DD string, staying in local time. */
export function addDaysYMD(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return toYMD(dt);
}

/** "2026-10-05" → "Mon, Oct 5" (parsed as local time, no TZ shift). */
export function formatYMDShort(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** "2026-10-05" → "Monday, October 5, 2026". */
export function formatYMDLong(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/** "2026-10-05" → "Oct 5". */
export function formatYMDCompact(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
