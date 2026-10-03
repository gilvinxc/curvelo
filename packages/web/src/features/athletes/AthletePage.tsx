import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../../lib/api";
import {
  Avatar,
  EmptyState,
  ErrorBanner,
  FullScreenLoader,
  PageHeader,
  RoleBadge,
} from "../../components/ui";
import { AssignmentRow } from "../calendar/CalendarBits";
import { ActivityRow } from "../activities/ActivityRow";
import { AthleteGuardians } from "../guardians/AthleteGuardians";
import { AthleteInsights } from "../insights/AthleteInsights";
import {
  addDaysYMD,
  formatDistanceM,
  formatDurationS,
  formatPaceSec,
  formatYMDLong,
  todayYMD,
} from "../../lib/workoutFormat";
import { useUnits } from "../../lib/units";

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

/** What the athlete plans to do on their own (off-season, no team plan). */
function AthletePlannedWorkouts({
  teamId,
  userId,
  firstName,
}: {
  teamId: string;
  userId: string;
  firstName: string;
}) {
  const from = todayYMD();
  const to = addDaysYMD(from, 29);
  const plannedQuery = useQuery({
    queryKey: ["athletePlanned", teamId, userId, from, to],
    queryFn: () => api.athletePlannedDays(teamId, userId, from, to),
  });
  if (plannedQuery.isLoading || plannedQuery.isError) return null;
  const days = plannedQuery.data?.days ?? [];
  if (days.length === 0) return null;
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.18em] text-mist">
        {firstName}&apos;s planned workouts
      </h2>
      <div className="flex flex-col gap-2">
        {days.map((d) => (
          <div
            key={d.id}
            className="rounded-2xl border border-volt-400/25 bg-volt-400/[0.06] p-4"
          >
            <p className="text-[12px] font-bold uppercase tracking-wider text-mist">
              {formatYMDLong(d.date)} · {d.planName}
            </p>
            <p className="mt-1 text-[15px] font-bold text-ink-50">{d.title}</p>
            {d.notes && (
              <p className="mt-0.5 text-[13px] text-mist">{d.notes}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function AthletePage() {
  const units = useUnits();
  const { id: teamId, userId } = useParams<{ id: string; userId: string }>();

  const athleteQuery = useQuery({
    queryKey: ["athlete", teamId, userId],
    queryFn: () => api.getAthlete(teamId!, userId!),
    enabled: !!teamId && !!userId,
  });

  if (athleteQuery.isLoading) return <FullScreenLoader />;

  if (athleteQuery.isError || !athleteQuery.data) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Athlete" backTo={teamId ? `/teams/${teamId}` : "/dashboard"} />
        <ErrorBanner message="Couldn't load this athlete. Coaches and team admins only." />
      </div>
    );
  }

  const { athlete } = athleteQuery.data;

  return (
    <div>
      <PageHeader
        title={athlete.displayName}
        subtitle="Athlete overview"
        backTo={`/teams/${teamId}`}
      />

      <div className="mb-5 flex items-center gap-3">
        <Avatar name={athlete.displayName} size="lg" />
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-black tracking-tight">
              {athlete.displayName}
            </h2>
            <RoleBadge role={athlete.role} />
          </div>
          <p className="mt-0.5 text-[13px] text-mist">Last 28 days</p>
        </div>
      </div>

      <div className="mb-8 flex divide-x divide-white/10 rounded-2xl border border-white/10 bg-ink-900 py-2">
        <StatCell label="Activities" value={String(athlete.stats.count)} />
        <StatCell
          label="Distance"
          value={formatDistanceM(athlete.stats.totalDistanceM, units)}
        />
        <StatCell
          label="Time"
          value={formatDurationS(athlete.stats.totalDurationS)}
        />
        <StatCell
          label="Avg pace"
          value={
            athlete.stats.avgPaceS != null
              ? formatPaceSec(athlete.stats.avgPaceS, units)
              : "—"
          }
        />
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.18em] text-mist">
          Upcoming assignments
        </h2>
        {athlete.upcomingAssignments.length === 0 ? (
          <p className="text-[14px] text-mist">Nothing scheduled.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {athlete.upcomingAssignments.map((a) => (
              <AssignmentRow key={a.id} assignment={a} />
            ))}
          </div>
        )}
      </section>

      <AthletePlannedWorkouts
        teamId={teamId!}
        userId={userId!}
        firstName={athlete.displayName.split(" ")[0]}
      />

      <section>
        <h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.18em] text-mist">
          Recent activities
        </h2>
        {athlete.recentActivities.length === 0 ? (
          <EmptyState
            title="No activities yet"
            body={`${athlete.displayName.split(" ")[0]} hasn't logged anything in the last stretch.`}
          />
        ) : (
          <div className="flex flex-col gap-2">
            {athlete.recentActivities.map((a) => (
              <ActivityRow key={a.id} activity={a} />
            ))}
          </div>
        )}
      </section>

      {teamId && userId && (
        <AthleteInsights
          teamId={teamId}
          athleteId={userId}
          athleteName={athlete.displayName}
        />
      )}

      <div className="mt-8">
        <Link
          to={`/teams/${teamId}`}
          className="text-[14px] font-bold text-volt-300 hover:text-volt-400"
        >
          ← Back to team
        </Link>
      </div>

      {teamId && userId && (
        <AthleteGuardians
          teamId={teamId}
          athleteId={userId}
          athleteName={athlete.displayName}
        />
      )}
    </div>
  );
}
