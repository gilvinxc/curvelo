import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { ActivityDTO, AssignmentDTO } from "@curvelo/shared";
import { addDaysYMD, formatYMDCompact, toYMD } from "../../lib/workoutFormat";
import { activityYMD } from "../../lib/activityFormat";
import { cn } from "../../components/cx";

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function monthRange(offset: number): { from: string; to: string; label: string } {
  const base = new Date();
  base.setMonth(base.getMonth() + offset);
  const first = startOfMonth(base);
  const last = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  // Pad the range a few days so assignments near the edges still show.
  return {
    from: addDaysYMD(toYMD(first), -3),
    to: addDaysYMD(toYMD(last), 3),
    label: first.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
  };
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

export function CalendarMonth({
  assignments,
  activities = [],
  monthOffset,
  selectedDate,
  onSelectDate,
}: {
  assignments: AssignmentDTO[];
  activities?: ActivityDTO[];
  monthOffset: number;
  selectedDate: string | null;
  onSelectDate: (ymd: string) => void;
}) {
  const cells = useMemo(() => {
    const base = new Date();
    base.setMonth(base.getMonth() + monthOffset);
    const first = startOfMonth(base);
    const startPad = first.getDay();
    const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    const list: (string | null)[] = [];
    for (let i = 0; i < startPad; i++) list.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      list.push(toYMD(new Date(base.getFullYear(), base.getMonth(), d)));
    }
    while (list.length % 7 !== 0) list.push(null);
    return list;
  }, [monthOffset]);

  const byDate = useMemo(() => {
    const map = new Map<string, { kind: "planned" | "done"; id: string; needsApproval?: boolean }[]>();
    for (const a of assignments) {
      const arr = map.get(a.scheduledDate) ?? [];
      arr.push({ kind: "planned", id: a.id, needsApproval: a.needsApproval });
      map.set(a.scheduledDate, arr);
    }
    for (const act of activities) {
      const ymd = activityYMD(act.startedAt);
      const arr = map.get(ymd) ?? [];
      arr.push({ kind: "done", id: act.id });
      map.set(ymd, arr);
    }
    return map;
  }, [assignments, activities]);

  const today = toYMD(new Date());

  return (
    <div>
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((w, i) => (
          <div
            key={i}
            className="pb-1 text-center text-[11px] font-bold uppercase tracking-wider text-mist/60"
          >
            {w}
          </div>
        ))}
        {cells.map((ymd, i) =>
          ymd === null ? (
            <div key={i} />
          ) : (
            <button
              key={ymd}
              type="button"
              onClick={() => onSelectDate(ymd)}
              className={cn(
                "flex min-h-[52px] flex-col items-center justify-start rounded-xl border px-1 py-1.5 text-[14px] font-semibold transition",
                selectedDate === ymd
                  ? "border-volt-400 bg-volt-400/15 text-ink-50"
                  : "border-transparent text-ink-50 hover:bg-white/5",
                ymd === today && selectedDate !== ymd && "border-volt-400/50",
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full",
                  ymd === today && "bg-volt-400 text-ink-950",
                )}
              >
                {Number(ymd.slice(8))}
              </span>
              <span className="mt-1 flex h-1.5 items-center gap-[3px]">
                {(byDate.get(ymd) ?? []).slice(0, 3).map((e) => (
                  <span
                    key={`${e.kind}-${e.id}`}
                    title={e.kind === "done" ? "Completed" : "Planned"}
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      e.needsApproval
                        ? "bg-amber-400"
                        : e.kind === "done"
                          ? "bg-volt-400"
                          : "border border-volt-400/70",
                    )}
                  />
                ))}
              </span>
            </button>
          ),
        )}
      </div>
    </div>
  );
}

export function assignmentTargetLabel(a: AssignmentDTO): string {
  if (a.assignedToName) return a.assignedToName;
  if (a.groupName) return a.groupName;
  return "Whole team";
}

/** Shared assignment list row. */
export function AssignmentRow({
  assignment,
  showTeam,
  onDelete,
  deleting,
  logHref,
}: {
  assignment: AssignmentDTO;
  showTeam?: boolean;
  onDelete?: () => void;
  deleting?: boolean;
  /** When set, renders a "log completion" action linking to the activity form. */
  logHref?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-ink-900 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-bold">{assignment.workoutTitle}</p>
        <p className="mt-0.5 text-[13px] text-mist">
          {showTeam ? `${assignment.teamName} · ` : ""}
          {assignmentTargetLabel(assignment)}
          {" · "}
          {formatYMDCompact(assignment.scheduledDate)}
        </p>
        {assignment.notes && (
          <p className="mt-0.5 text-[13px] text-mist/80">{assignment.notes}</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {assignment.needsApproval && (
            <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-amber-300">
              Needs approval
            </span>
          )}
          <span className="text-[12px] text-mist/70">
            by {assignment.createdByName}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {logHref && (
          <Link
            to={logHref}
            aria-label={`Log completion for ${assignment.workoutTitle}`}
            title="Log completion"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-volt-300 hover:bg-volt-400/10"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /><path d="m22 10-7.5 7.5L13 19" opacity="0.4" /></svg>
          </Link>
        )}
        {onDelete &&
        (confirming ? (
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              disabled={deleting}
              onClick={onDelete}
              className="rounded-lg bg-red-500/20 px-3 py-2 text-[13px] font-bold text-red-300"
            >
              {deleting ? "…" : "Yes"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg bg-white/10 px-3 py-2 text-[13px] font-bold text-mist"
            >
              No
            </button>
          </div>
        ) : (
          <button
            type="button"
            aria-label="Delete assignment"
            onClick={() => setConfirming(true)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-red-300 hover:bg-red-500/10"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
          </button>
        ))}
      </div>
    </div>
  );
}
