import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { ActivityStatsDTO } from "@curvelo/shared";
import { api } from "../../lib/api";
import { Button, ErrorBanner } from "../../components/ui";
import { ActivityRow } from "./ActivityRow";
import {
  addDaysYMD,
  formatDistanceM,
  formatDurationS,
  formatPaceSec,
  todayYMD,
} from "../../lib/workoutFormat";

function startOfWeekYMD(): string {
  // Monday-based week.
  const now = new Date();
  const dow = (now.getDay() + 6) % 7;
  return addDaysYMD(todayYMD(), -dow);
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 px-2 py-1 text-center">
      <p className="text-lg font-extrabold tracking-tight">{value}</p>
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-mist">
        {label}
      </p>
    </div>
  );
}

export function TrainingLog() {
  const weekFrom = startOfWeekYMD();
  const weekTo = addDaysYMD(weekFrom, 6);
  const logFrom = addDaysYMD(todayYMD(), -29);
  const logTo = todayYMD();

  const statsQuery = useQuery({
    queryKey: ["myStats", weekFrom, weekTo],
    queryFn: () => api.myStats(weekFrom, weekTo),
  });
  const logQuery = useQuery({
    queryKey: ["activities", logFrom, logTo],
    queryFn: () => api.listActivities(logFrom, logTo),
  });

  const stats: ActivityStatsDTO | undefined = statsQuery.data?.stats;
  const recent = [...(logQuery.data?.activities ?? [])]
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
    .slice(0, 10);

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13px] font-bold uppercase tracking-[0.18em] text-mist">
          Training log
        </h2>
        <Link to="/activities/new">
          <Button variant="secondary" className="min-h-[40px] px-4 text-[14px]">
            + Log activity
          </Button>
        </Link>
      </div>

      {statsQuery.isError && (
        <div className="mb-3">
          <ErrorBanner message="Couldn't load your stats." />
        </div>
      )}
      {stats && (
        <div className="mb-3 flex divide-x divide-white/10 rounded-2xl border border-white/10 bg-ink-900 py-2">
          <StatCell label="Runs" value={String(stats.count)} />
          <StatCell
            label="Distance"
            value={formatDistanceM(stats.totalDistanceM)}
          />
          <StatCell
            label="Time"
            value={formatDurationS(stats.totalDurationS)}
          />
          <StatCell
            label="Avg pace"
            value={
              stats.avgPaceS != null ? formatPaceSec(stats.avgPaceS) : "—"
            }
          />
        </div>
      )}
      <p className="-mt-1 mb-3 text-[12px] text-mist/70">This week</p>

      {logQuery.isError ? (
        <ErrorBanner message="Couldn't load your recent activities." />
      ) : recent.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-white/15 bg-ink-900/50 px-6 py-8 text-center text-[14px] text-mist">
          Nothing logged yet. Tap{" "}
          <Link to="/activities/new" className="font-bold text-volt-300">
            Log activity
          </Link>{" "}
          to record your first run.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {recent.map((a) => (
            <ActivityRow key={a.id} activity={a} />
          ))}
        </div>
      )}
    </section>
  );
}
