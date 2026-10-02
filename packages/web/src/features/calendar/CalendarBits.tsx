import { useMemo, useState } from "react";
import type { AssignmentDTO } from "@curvelo/shared";
import { addDaysYMD, formatYMDCompact, toYMD } from "../../lib/workoutFormat";
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
  monthOffset,
  selectedDate,
  onSelectDate,
}: {
  assignments: AssignmentDTO[];
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
    const map = new Map<string, AssignmentDTO[]>();
    for (const a of assignments) {
      const arr = map.get(a.scheduledDate) ?? [];
      arr.push(a);
      map.set(a.scheduledDate, arr);
    }
    return map;
  }, [assignments]);

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
                {(byDate.get(ymd) ?? []).slice(0, 3).map((a) => (
                  <span
                    key={a.id}
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      a.needsApproval ? "bg-amber-400" : "bg-volt-400",
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
}: {
  assignment: AssignmentDTO;
  showTeam?: boolean;
  onDelete?: () => void;
  deleting?: boolean;
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
  );
}
