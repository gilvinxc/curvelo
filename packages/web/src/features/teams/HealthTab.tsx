import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { useUnits } from "../../lib/units";
import { formatDistanceM, formatPaceSec } from "../../lib/workoutFormat";
import { distanceUnitLabel } from "../../lib/units";
import {
  Card,
  EmptyState,
  ErrorBanner,
  FullScreenLoader,
} from "../../components/ui";
import { cn } from "../../components/cx";

function Tile({
  label,
  value,
  sub,
  to,
  onClick,
  accent = "text-volt-400",
}: {
  label: string;
  value: string;
  sub: string;
  to?: string;
  onClick?: () => void;
  accent?: string;
}) {
  const inner = (
    <div className="flex h-full flex-col">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-mist">
        {label}
      </p>
      <p className={`mt-1 text-[22px] font-black tracking-tight ${accent}`}>
        {value}
      </p>
      <p className="mt-auto pt-1 text-[12px] font-medium text-mist">{sub}</p>
    </div>
  );
  const cls =
    "min-h-[104px] p-4 transition hover:border-volt-400/40 text-left w-full";
  if (to) {
    return (
      <Link to={to} className="block">
        <Card className={cls}>{inner}</Card>
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className="block w-full">
      <Card className={cls}>{inner}</Card>
    </button>
  );
}

function trendSub(weekM: number, prevM: number, units: "metric" | "imperial") {
  if (prevM <= 0) return weekM > 0 ? "first week tracked" : "no miles yet";
  const pct = Math.round(((weekM - prevM) / prevM) * 100);
  const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "▬";
  const unit = distanceUnitLabel(units);
  return `${arrow} ${Math.abs(pct)}% vs last week · ${unit}`;
}

export function HealthTab({
  teamId,
  myRole,
}: {
  teamId: string;
  myRole: string | null;
}) {
  const units = useUnits();
  const [racesOpen, setRacesOpen] = useState(false);
  const healthQuery = useQuery({
    queryKey: ["teamHealth", teamId],
    queryFn: () => api.getTeamHealth(teamId),
  });

  if (healthQuery.isLoading) return <FullScreenLoader />;
  if (healthQuery.isError || !healthQuery.data) {
    return <ErrorBanner message="Couldn't load team health. Pull to retry." />;
  }

  const h = healthQuery.data.health;
  const isCoach = myRole === "COACH";
  const races = h.races;

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <Tile
          label="Miles"
          value={formatDistanceM(h.milesWeekM, units)}
          sub={trendSub(h.milesWeekM, h.milesPrevWeekM, units)}
          to={`/teams/${teamId}/feed`}
          accent="text-volt-400"
        />
        <Tile
          label="Pace"
          value={h.avgPaceS != null ? formatPaceSec(h.avgPaceS, units) : "—"}
          sub="28-day team avg"
          to={`/teams/${teamId}/feed`}
          accent="text-sky-400"
        />
        <Tile
          label="Effort"
          value={h.avgRpe != null ? `${h.avgRpe}/10` : "—"}
          sub="avg RPE · 28d"
          to={`/teams/${teamId}/feed`}
          accent="text-ember-400"
        />
        <Tile
          label="Races"
          value={`${races.prs30d} PR${races.prs30d === 1 ? "" : "s"}`}
          sub={`${races.races30d} races · ${races.results30d} results · 30d`}
          onClick={() => setRacesOpen((v) => !v)}
          accent="text-volt-300"
        />
        <Tile
          label="Participation"
          value={
            h.participationPct != null ? `${h.participationPct}%` : "—"
          }
          sub={
            h.runnerCount > 0
              ? `${h.activeRunnerCount}/${h.runnerCount} runners active · 7d`
              : "no runners yet"
          }
          to={`/teams/${teamId}`}
          accent="text-mint-400"
        />
        {isCoach && (
          <Tile
            label="Injuries"
            value={h.activeInjuries != null ? String(h.activeInjuries) : "—"}
            sub="active · coach only"
            to={`/teams/${teamId}/coaching`}
            accent="text-rose-400"
          />
        )}
      </div>

      {racesOpen && (
        <Card className="mt-3 p-4">
          <h3 className="text-[13px] font-bold uppercase tracking-[0.16em] text-mist">
            Race health
          </h3>

          {races.paceByDistance.length > 0 && (
            <div className="mt-3">
              <p className="mb-2 text-[12px] font-bold text-mist">
                Pace by distance · 90d
              </p>
              <div className="flex flex-col gap-1.5">
                {races.paceByDistance.map((g) => (
                  <div
                    key={g.distanceM}
                    className="flex items-center justify-between rounded-lg bg-ink-950 px-3 py-2"
                  >
                    <span className="text-[14px] font-bold text-ink-50">
                      {formatDistanceM(g.distanceM, units)}
                    </span>
                    <span className="text-[14px] font-semibold text-mist">
                      {formatPaceSec(g.avgPaceS, units)}
                      <span className="ml-2 text-[12px]">
                        · {g.resultsCount} result{g.resultsCount === 1 ? "" : "s"}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4">
            <p className="mb-2 text-[12px] font-bold text-mist">Recent races</p>
            {races.recent.length === 0 ? (
              <EmptyState title="No races yet" body="Log race results from the Coaching tab." />
            ) : (
              <div className="flex flex-col gap-1.5">
                {races.recent.map((r) => (
                  <div
                    key={`${r.raceName}|${r.racedAt}`}
                    className="flex items-center justify-between gap-2 rounded-lg bg-ink-950 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-bold text-ink-50">
                        {r.raceName}
                      </p>
                      <p className="text-[12px] text-mist">
                        {r.racedAt} · {r.resultsCount} result
                        {r.resultsCount === 1 ? "" : "s"}
                      </p>
                    </div>
                    {r.prCount > 0 && (
                      <span
                        className={cn(
                          "shrink-0 rounded-full bg-volt-400/15 px-2.5 py-1",
                          "text-[12px] font-extrabold text-volt-400",
                        )}
                      >
                        🏆 {r.prCount} PR{r.prCount === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <Link
            to={`/teams/${teamId}/coaching`}
            className="mt-3 block text-center text-[13px] font-bold text-volt-400"
          >
            Full race history on the Coaching tab ›
          </Link>
        </Card>
      )}

      <p className="mt-4 text-center text-[12px] text-mist">
        Pace counts only runs with distance and time. Private activities stay
        private.
      </p>
    </div>
  );
}
