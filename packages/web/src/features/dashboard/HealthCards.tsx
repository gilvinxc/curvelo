import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ApiError, api } from "../../lib/api";
import { useUnits } from "../../lib/units";
import {
  addDaysYMD,
  formatDistanceM,
  formatPaceSec,
  formatYMDCompact,
  todayYMD,
} from "../../lib/workoutFormat";
import { Button, Card, Field, RoleBadge, TextInput } from "../../components/ui";
import { TeamLogo } from "../teams/TeamLogo";

/** Compact personal rollup: week miles, 28d pace, current streak. */
export function MyHealthCard() {
  const units = useUnits();
  const to = todayYMD();
  const weekFrom = addDaysYMD(to, -6);
  const paceFrom = addDaysYMD(to, -27);

  const weekQuery = useQuery({
    queryKey: ["myStats", weekFrom, to],
    queryFn: () => api.myStats(weekFrom, to),
    staleTime: 5 * 60 * 1000,
  });
  const paceQuery = useQuery({
    queryKey: ["myStats", paceFrom, to],
    queryFn: () => api.myStats(paceFrom, to),
    staleTime: 5 * 60 * 1000,
  });
  const streakQuery = useQuery({
    queryKey: ["myStreak"],
    queryFn: () => api.myProgress(1),
    staleTime: 5 * 60 * 1000,
  });

  const week = weekQuery.data?.stats;
  const pace = paceQuery.data?.stats;
  const streak = streakQuery.data?.progress.currentStreakDays;

  return (
    <div className="mb-6">
      <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.18em] text-mist">
        My health
      </h2>
      <Card className="p-4">
        <div className="flex divide-x divide-white/10">
          <div className="flex-1 pr-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-mist">
              Week
            </p>
            <p className="mt-1 text-[20px] font-black text-volt-400">
              {week ? formatDistanceM(week.totalDistanceM, units) : "—"}
            </p>
          </div>
          <div className="flex-1 px-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-mist">
              Pace · 28d
            </p>
            <p className="mt-1 text-[20px] font-black text-sky-400">
              {pace?.avgPaceS != null
                ? formatPaceSec(pace.avgPaceS, units)
                : "—"}
            </p>
          </div>
          <div className="flex-1 pl-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-mist">
              Streak
            </p>
            <p className="mt-1 text-[20px] font-black text-ember-400">
              {streak != null ? `${streak}d` : "—"}
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

/** One compact row per team: week miles, participation, injuries (coach only). */
export function TeamStatusRow({
  teamId,
  teamName,
  myRole,
}: {
  teamId: string;
  teamName: string;
  myRole: string | null;
}) {
  const units = useUnits();
  const healthQuery = useQuery({
    queryKey: ["teamHealth", teamId],
    queryFn: () => api.getTeamHealth(teamId),
    staleTime: 5 * 60 * 1000,
  });
  const h = healthQuery.data?.health;
  const isCoach = myRole === "COACH";

  return (
    <Link to={`/teams/${teamId}`} className="block">
      <Card className="p-4 transition hover:border-volt-400/40">
        <div className="flex items-center gap-3">
          <TeamLogo teamId={teamId} teamName={teamName} hasLogo={false} size={40} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-[15px] font-extrabold text-ink-50">
                {teamName}
              </p>
              {myRole && <RoleBadge role={myRole} />}
            </div>
            <p className="mt-0.5 truncate text-[13px] text-mist">
              {h ? (
                <>
                  {formatDistanceM(h.milesWeekM, units)} this week
                  {h.participationPct != null &&
                    ` · ${h.participationPct}% active`}
                  {isCoach &&
                    h.activeInjuries != null &&
                    h.activeInjuries > 0 &&
                    ` · 🏥 ${h.activeInjuries} injur${h.activeInjuries === 1 ? "y" : "ies"}`}
                </>
              ) : (
                "Loading…"
              )}
            </p>
          </div>
          <span className="shrink-0 text-mist">›</span>
        </div>
      </Card>
    </Link>
  );
}

/** Public team discovery: name + description only, request-to-join via coach approval. */
export function TeamDiscovery() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [requestedIds, setRequestedIds] = useState<string[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 400);
    return () => clearTimeout(t);
  }, [query]);

  const searchQuery = useQuery({
    queryKey: ["discoverTeams", debounced],
    queryFn: () => api.discoverTeams(debounced),
    enabled: debounced.length >= 2,
    staleTime: 30_000,
  });
  const results =
    searchQuery.data?.teams.filter((t) => !requestedIds.includes(t.id)) ?? [];

  const requestJoin = useMutation({
    mutationFn: (teamId: string) => api.requestJoinDirect(teamId),
    onSuccess: (_data, teamId) => setRequestedIds((ids) => [...ids, teamId]),
  });

  return (
    <div className="mb-6">
      <Field label="Find a team">
        <TextInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search public teams…"
        />
      </Field>
      {debounced.length >= 2 && (
        <div className="mt-2 flex flex-col gap-2">
          {searchQuery.isLoading && (
            <p className="text-[13px] text-mist">Searching…</p>
          )}
          {searchQuery.data && results.length === 0 && requestedIds.length === 0 && (
            <p className="text-[13px] text-mist">
              No public teams match "{debounced}".
            </p>
          )}
          {results.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-900/40 p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-bold text-ink-50">
                  {t.name}
                </p>
                {t.description && (
                  <p className="truncate text-[12px] text-mist">{t.description}</p>
                )}
              </div>
              <Button
                variant="secondary"
                className="shrink-0"
                loading={requestJoin.isPending}
                onClick={() => requestJoin.mutate(t.id)}
              >
                Request to join
              </Button>
            </div>
          ))}
          {requestedIds.length > 0 && (
            <p className="rounded-xl border border-emerald-400/30 bg-emerald-400/5 p-3 text-[13px] text-emerald-300">
              Request sent — a coach will review it.
            </p>
          )}
          {requestJoin.isError && (
            <p className="text-[13px] text-red-400">
              {requestJoin.error instanceof ApiError
                ? requestJoin.error.message
                : "Couldn't send the request."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** "What's today" nudge: today's workout assignment with a one-tap log link. */
export function TodayWorkout() {
  const today = todayYMD();
  const calQuery = useQuery({
    queryKey: ["myCalendar", today, today],
    queryFn: () => api.myCalendar(today, today),
    staleTime: 5 * 60 * 1000,
  });
  const todays = (calQuery.data?.assignments ?? []).filter(
    (a) => a.scheduledDate === today,
  );
  if (calQuery.isLoading || calQuery.isError || todays.length === 0) return null;
  const first = todays[0];
  const params = new URLSearchParams({
    assignmentId: first.id,
    workoutTitle: first.workoutTitle,
    scheduledDate: first.scheduledDate,
    teamId: first.teamId,
  });
  return (
    <Link
      to={`/activities/new?${params.toString()}`}
      className="mb-6 block"
    >
      <Card className="border-volt-400/40 bg-volt-400/10 p-4 transition hover:border-volt-400/70">
        <div className="flex items-center gap-3">
          <span className="text-[26px]">🏃</span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-volt-300">
              Today&apos;s workout
            </p>
            <p className="truncate text-[17px] font-extrabold text-ink-50">
              {first.workoutTitle}
            </p>
            <p className="truncate text-[13px] text-mist">
              {first.teamName}
              {todays.length > 1 && ` · +${todays.length - 1} more`}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-volt-400 px-4 py-2 text-[14px] font-extrabold text-ink-950">
            Log it
          </span>
        </div>
      </Card>
    </Link>
  );
}

/** Personal records shelf: fastest pace ever at each standard distance. */
export function PersonalRecords() {
  const units = useUnits();
  const recQuery = useQuery({
    queryKey: ["myPersonalRecords"],
    queryFn: () => api.myPersonalRecords(),
    staleTime: 5 * 60 * 1000,
  });
  const records = recQuery.data?.records ?? [];
  if (recQuery.isLoading || recQuery.isError || records.length === 0) return null;
  return (
    <div className="mb-6">
      <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.18em] text-mist">
        Personal records
      </h2>
      <Card className="p-4">
        <div className="flex flex-col divide-y divide-white/10">
          {records.map((r) => (
            <Link
              key={r.distanceM}
              to={`/activities/${r.activityId}`}
              className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              <span className="w-16 shrink-0 text-[13px] font-extrabold text-mist">
                {r.label}
              </span>
              <span className="flex-1 text-[17px] font-black text-sky-400">
                {formatPaceSec(r.bestPaceS, units)}
              </span>
              <span className="shrink-0 text-[12px] text-mist">
                {formatYMDCompact(r.achievedAt)}
              </span>
              <span className="shrink-0 text-mist">›</span>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
