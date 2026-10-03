import { Link } from "react-router-dom";
import type { ActivityDTO } from "@curvelo/shared";
import { cn } from "../../components/cx";
import { GpsBadge } from "../../components/ui";
import {
  activityKindLabel,
  activitySummary,
  activityTitle,
  formatActivityDateShort,
} from "../../lib/activityFormat";
import { useUnits } from "../../lib/units";

const kindDot: Record<string, string> = {
  RUN: "bg-volt-400",
  WALK: "bg-sky-400",
  CROSS_TRAINING: "bg-amber-400",
  STRENGTH: "bg-orange-400",
  REST_DAY: "bg-zinc-400",
  OTHER: "bg-violet-400",
};

/** Shared activity list row — dashboard, athlete view, calendar day lists. */
export function ActivityRow({
  activity,
  showAthlete,
}: {
  activity: ActivityDTO;
  showAthlete?: boolean;
}) {
  const units = useUnits();
  return (
    <Link
      to={`/activities/${activity.id}`}
      className="flex items-start gap-3 rounded-xl border border-white/10 bg-ink-900 px-4 py-3 transition hover:border-volt-400/40"
    >
      <span
        aria-hidden
        className={cn(
          "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full",
          kindDot[activity.kind] ?? "bg-volt-400",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[15px] font-bold">
            {activityTitle(activity)}
          </p>
          {activity.visibility === "PRIVATE" && (
            <span className="shrink-0 rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-mist">
              Private
            </span>
          )}
          {activity.assignmentId && (
            <span className="shrink-0 rounded-full border border-volt-400/30 bg-volt-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-volt-300">
              Workout
            </span>
          )}
          {activity.hasGpsRoute && <GpsBadge />}
        </div>
        <p className="mt-0.5 text-[13px] text-mist">
          {formatActivityDateShort(activity.startedAt)}
          {" · "}
          {activitySummary(activity, units)}
        </p>
        <p className="mt-0.5 text-[12px] text-mist/70">
          {showAthlete ? `${activity.userName} · ` : ""}
          {activityKindLabel(activity.kind)}
          {activity.teamName ? ` · ${activity.teamName}` : ""}
          {activity.effortRpe != null ? ` · RPE ${activity.effortRpe}` : ""}
        </p>
      </div>
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#a7ae97"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="mt-1 shrink-0"
      >
        <path d="m9 18 6-6-6-6" />
      </svg>
    </Link>
  );
}
