import type { ActivityDTO } from "@curvelo/shared";
import { formatDistanceM, formatDurationS, formatPaceSec } from "./workoutFormat";
import type { Units } from "./units";

export const ACTIVITY_KIND_LABELS: Record<string, string> = {
  RUN: "Run",
  WALK: "Walk",
  CROSS_TRAINING: "Cross training",
  STRENGTH: "Strength",
  REST_DAY: "Rest day",
  OTHER: "Other",
};

export function activityKindLabel(kind: string): string {
  return ACTIVITY_KIND_LABELS[kind] ?? kind;
}

/** "2026-10-05T18:30:00.000Z" → "Oct 5, 2026 · 6:30 PM" (local time). */
export function formatActivityDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date} · ${time}`;
}

/** "2026-10-05T18:30:00.000Z" → "Oct 5". */
export function formatActivityDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** ISO datetime → local YYYY-MM-DD for calendar grouping. */
export function activityYMD(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Compact metric summary for list rows.
 * e.g. "8.0km · 40:00 · 5:00/km", "45:00", "RPE 7".
 */
export function activitySummary(
  a: Pick<ActivityDTO, "distanceM" | "durationS" | "avgPaceS">,
  units: Units = "metric",
): string {
  const parts: string[] = [];
  if (a.distanceM != null) parts.push(formatDistanceM(a.distanceM, units));
  if (a.durationS != null) parts.push(formatDurationS(a.durationS));
  if (a.avgPaceS != null) parts.push(formatPaceSec(a.avgPaceS, units));
  return parts.join(" · ") || "—";
}

/** Display title: custom title or kind label. */
export function activityTitle(a: Pick<ActivityDTO, "title" | "kind">): string {
  return a.title?.trim() || activityKindLabel(a.kind);
}

/** Convert a datetime-local input value to an ISO string with offset. */
export function localInputToISO(local: string): string {
  return new Date(local).toISOString();
}

/** ISO datetime → datetime-local input value ("2026-10-05T18:30"). */
export function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:${min}`;
}

/** Now, rounded down to the nearest 5 minutes, as a datetime-local value. */
export function nowLocalInput(): string {
  const d = new Date();
  d.setMinutes(Math.floor(d.getMinutes() / 5) * 5, 0, 0);
  return isoToLocalInput(d.toISOString());
}
