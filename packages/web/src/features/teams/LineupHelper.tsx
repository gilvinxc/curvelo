import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { STANDARD_RACE_DISTANCES } from "@curvelo/shared";
import { api } from "../../lib/api";
import { EmptyState, Select } from "../../components/ui";
import { formatDurationS } from "../../lib/workoutFormat";

/**
 * Coaching tab: rank active runners by their best official time at one
 * distance in the last 12 months. Read-only — the coach decides the lineup.
 */
export function LineupHelper({ teamId }: { teamId: string }) {
  const [distanceM, setDistanceM] = useState("5000");

  const lineupQuery = useQuery({
    queryKey: ["lineup", teamId, distanceM],
    queryFn: () => api.getLineup(teamId, Number(distanceM)),
  });

  const label =
    STANDARD_RACE_DISTANCES.find((d) => String(d.meters) === distanceM)
      ?.label ?? `${distanceM}m`;

  const lineup = lineupQuery.data?.lineup ?? [];

  return (
    <section className="mt-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-bold uppercase tracking-[0.18em] text-mist">
          🏁 Lineup helper
        </h2>
        <Select
          value={distanceM}
          onChange={(e) => setDistanceM(e.target.value)}
          className="w-32"
          aria-label="Race distance"
        >
          {STANDARD_RACE_DISTANCES.map((d) => (
            <option key={d.meters} value={String(d.meters)}>
              {d.label}
            </option>
          ))}
        </Select>
      </div>
      {lineupQuery.isLoading ? (
        <p className="text-[14px] text-mist">Ranking runners…</p>
      ) : lineupQuery.isError ? (
        <p className="text-[14px] text-mist">Couldn't load the lineup.</p>
      ) : lineup.length === 0 ? (
        <EmptyState
          title={`No ${label} results`}
          body="No official results at this distance in the last 12 months."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {lineup.map((entry, i) => (
            <div
              key={entry.userId}
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-ink-900 px-4 py-3"
            >
              <span className="w-8 shrink-0 text-center text-[15px] font-black text-mist">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-bold">
                  {entry.displayName}
                </p>
                <p className="truncate text-[13px] text-mist">
                  {entry.raceName} · {entry.racedAt}
                </p>
              </div>
              <span className="shrink-0 text-[15px] font-black text-volt-300">
                {formatDurationS(entry.durationS)}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-[12px] text-mist">
        Best official {label} time per runner, last 12 months. You make the
        call.
      </p>
    </section>
  );
}
