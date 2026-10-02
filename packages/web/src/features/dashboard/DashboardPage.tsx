import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  FullScreenLoader,
  RoleBadge,
} from "../../components/ui";
import { UpcomingWorkouts } from "../calendar/PersonalCalendar";
import { TrainingLog } from "../activities/TrainingLog";

export function DashboardPage() {
  const { user } = useAuth();
  const teamsQuery = useQuery({
    queryKey: ["teams"],
    queryFn: () => api.listTeams(),
  });

  if (teamsQuery.isLoading) return <FullScreenLoader />;

  const teams = teamsQuery.data?.teams ?? [];
  const firstName = user?.displayName.split(" ")[0] ?? "Runner";

  return (
    <div>
      <div className="mb-6">
        <p className="text-[13px] font-bold uppercase tracking-[0.2em] text-volt-400">
          Empower your run
        </p>
        <h1 className="mt-1 text-3xl font-black tracking-tight">
          Hey, {firstName}
        </h1>
        <p className="mt-1 text-[15px] text-mist">
          {teams.length === 0
            ? "Let's get you on a team."
            : `${teams.length} ${teams.length === 1 ? "team" : "teams"} and counting.`}
        </p>
      </div>

      {teamsQuery.isError && (
        <ErrorBanner message="Couldn't load your teams. Pull to retry." />
      )}

      {teams.length > 0 && (
        <>
          <UpcomingWorkouts />
          <TrainingLog />
        </>
      )}

      {teams.length === 0 && !teamsQuery.isError ? (
        <EmptyState
          title="No teams yet"
          body="Create a team to coach, or ask your coach for an invite link to join theirs."
          action={
            <Link to="/teams/new">
              <Button>Create a team</Button>
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-bold uppercase tracking-[0.18em] text-mist">
              My teams
            </h2>
            <Link to="/teams/new">
              <Button variant="secondary" className="min-h-[44px] px-4 text-[14px]">
                + New team
              </Button>
            </Link>
          </div>
          {teams.map((team) => (
            <Link key={team.id} to={`/teams/${team.id}`} className="block">
              <Card className="transition hover:border-volt-400/40">
                <div className="flex items-center gap-3">
                  <Avatar name={team.name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-[17px] font-extrabold tracking-tight">
                        {team.name}
                      </h3>
                    </div>
                    <p className="mt-0.5 text-[13px] text-mist">
                      {team.memberCount}{" "}
                      {team.memberCount === 1 ? "member" : "members"}
                      {team.visibility === "PUBLIC" ? " · Public" : " · Private"}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    {team.myRole && <RoleBadge role={team.myRole} />}
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a7ae97" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
