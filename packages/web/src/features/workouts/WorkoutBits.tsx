import { Link } from "react-router-dom";
import type { WorkoutDTO } from "@curvelo/shared";
import { Card } from "../../components/ui";
import { stepSummary, workoutKindLabel } from "../../lib/workoutFormat";

/* ------------------------------ kind badge ------------------------------ */

const kindStyles: Record<string, string> = {
  INTERVAL: "bg-volt-400/15 text-volt-300 border-volt-400/30",
  TEMPO: "bg-orange-400/15 text-orange-300 border-orange-400/30",
  PROGRESSION: "bg-amber-400/15 text-amber-300 border-amber-400/30",
  LONG_RUN: "bg-sky-400/15 text-sky-300 border-sky-400/30",
  RECOVERY: "bg-emerald-400/15 text-emerald-300 border-emerald-400/30",
  RACE: "bg-rose-400/15 text-rose-300 border-rose-400/30",
  CROSS_TRAINING: "bg-violet-400/15 text-violet-300 border-violet-400/30",
  STRENGTH: "bg-fuchsia-400/15 text-fuchsia-300 border-fuchsia-400/30",
};

export function WorkoutKindBadge({ kind }: { kind: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${kindStyles[kind] ?? "bg-white/5 text-mist border-white/15"}`}
    >
      {workoutKindLabel(kind)}
    </span>
  );
}

/* ------------------------------ workout card ----------------------------- */

export function WorkoutCard({ workout }: { workout: WorkoutDTO }) {
  return (
    <Link to={`/workouts/${workout.id}`} className="block">
      <Card className="transition hover:border-volt-400/40">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-[16px] font-extrabold tracking-tight">
            {workout.title}
          </h3>
          {workout.isTemplate && (
            <span className="shrink-0 rounded-full border border-volt-400/40 bg-volt-400/10 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-volt-300">
              Template
            </span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <WorkoutKindBadge kind={workout.kind} />
          <span className="text-[13px] text-mist">
            {workout.steps.length}{" "}
            {workout.steps.length === 1 ? "step" : "steps"}
          </span>
          <span className="text-[13px] text-mist/70">
            by {workout.createdByName}
          </span>
        </div>
        {workout.description && (
          <p className="mt-2 line-clamp-2 text-[14px] text-mist">
            {workout.description}
          </p>
        )}
      </Card>
    </Link>
  );
}

/* --------------------------------- step list ------------------------------ */

export function WorkoutSteps({
  workout,
  numbered = true,
}: {
  workout: WorkoutDTO;
  numbered?: boolean;
}) {
  return (
    <ol className="flex flex-col gap-2">
      {workout.steps.map((step, i) => (
        <li
          key={step.id}
          className="flex items-start gap-3 rounded-xl border border-white/10 bg-ink-800 px-4 py-3"
        >
          {numbered && (
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-[12px] font-bold text-mist">
              {i + 1}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold">{stepSummary(step)}</p>
            {step.notes && (
              <p className="mt-0.5 text-[13px] text-mist">{step.notes}</p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
