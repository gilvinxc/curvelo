import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { useUnits } from "../../lib/units";
import {
  addDaysYMD,
  formatDistanceM,
  formatPaceSec,
  todayYMD,
} from "../../lib/workoutFormat";
import { Card } from "../../components/ui";
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
            <p className="mt-1 text-[20px] font-black text-ink-50">
              {week ? formatDistanceM(week.totalDistanceM, units) : "—"}
            </p>
          </div>
          <div className="flex-1 px-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-mist">
              Pace · 28d
            </p>
            <p className="mt-1 text-[20px] font-black text-ink-50">
              {pace?.avgPaceS != null
                ? formatPaceSec(pace.avgPaceS, units)
                : "—"}
            </p>
          </div>
          <div className="flex-1 pl-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-mist">
              Streak
            </p>
            <p className="mt-1 text-[20px] font-black text-ink-50">
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
    <Link to={`/teams/${teamId}/health`} className="block">
      <Card className="p-4 transition hover:border-volt-400/40">
        <div className="flex items-center gap-3">
          <TeamLogo teamId={teamId} teamName={teamName} hasLogo={false} size={40} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-extrabold text-ink-50">
              {teamName}
            </p>
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
