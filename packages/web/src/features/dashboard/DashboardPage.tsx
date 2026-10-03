import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ApiError, api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  FullScreenLoader,
  Modal,
  RoleBadge,
} from "../../components/ui";
import { TeamLogo } from "../teams/TeamLogo";
import { UpcomingWorkouts } from "../calendar/PersonalCalendar";
import { TrainingLog } from "../activities/TrainingLog";

export function DashboardPage() {
  const { user } = useAuth();
  const teamsQuery = useQuery({
    queryKey: ["teams"],
    queryFn: () => api.listTeams(),
  });
  const childrenQuery = useQuery({
    queryKey: ["children"],
    queryFn: () => api.myChildren(),
  });

  if (teamsQuery.isLoading) return <FullScreenLoader />;

  const teams = teamsQuery.data?.teams ?? [];
  const children = childrenQuery.data?.children ?? [];
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

      <div className="mb-6 flex flex-wrap gap-2">
        <Link to="/activities/new">
          <Button className="min-h-[48px] px-6 text-[15px]">
            🏃 Log activity
          </Button>
        </Link>
        <Link to="/calendar">
          <Button variant="secondary" className="min-h-[48px] px-5 text-[15px]">
            📅 My calendar
          </Button>
        </Link>
        <Link to="/activities/import">
          <Button variant="secondary" className="min-h-[48px] px-5 text-[15px]">
            ⭳ Import
          </Button>
        </Link>
      </div>
      <SelfReportInjuryLink teams={teams} userId={user?.id} />

      {teamsQuery.isError && (
        <ErrorBanner message="Couldn't load your teams. Pull to retry." />
      )}

      {user?.systemRole === "SYSTEM_ADMIN" && (
        <div className="mb-6">
          <Link to="/admin" className="block">
            <Card className="border-volt-400/30 transition hover:border-volt-400/60">
              <div className="flex items-center gap-3">
                <span className="text-[22px]">🛡️</span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[16px] font-extrabold text-ink-50">
                    Site admin
                  </h3>
                  <p className="text-[13px] text-mist">
                    Users, teams, and the audit log.
                  </p>
                </div>
                <span className="text-mist">›</span>
              </div>
            </Card>
          </Link>
        </div>
      )}

      {teams.length > 0 && (
        <>
          <UpcomingWorkouts />
          <TrainingLog />
        </>
      )}

      {children.length > 0 && (
        <div className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[13px] font-bold uppercase tracking-[0.18em] text-mist">
              My athletes
            </h2>
            <Link to="/family">
              <Button variant="secondary" className="min-h-[44px] px-4 text-[14px]">
                View all
              </Button>
            </Link>
          </div>
          <div className="flex flex-col gap-3">
            {children.slice(0, 3).map((child) => (
              <Link key={child.athleteId} to="/family" className="block">
                <Card className="transition hover:border-volt-400/40">
                  <div className="flex items-center gap-3">
                    <Avatar name={child.athleteName} />
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-[17px] font-extrabold tracking-tight">
                        {child.athleteName}
                      </h3>
                      <p className="mt-0.5 truncate text-[13px] text-mist">
                        {child.teamName}
                      </p>
                    </div>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a7ae97" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </div>
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
                  <TeamLogo teamId={team.id} teamName={team.name} hasLogo={team.hasLogo ?? false} size={44} />
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


/** Subtle self-report entry: runners can flag an injury to their coach. */
function SelfReportInjuryLink({
  teams,
  userId,
}: {
  teams: Array<{ id: string; name: string }>;
  userId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const report = useMutation({
    mutationFn: () =>
      api.reportInjury(teamId, {
        athleteId: userId!,
        title: title.trim(),
        detail: detail.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["injuries"] });
      setOpen(false);
      setTitle("");
      setDetail("");
      setError(null);
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Couldn't report."),
  });

  if (teams.length === 0 || !userId) return null;
  const canSubmit =
    teamId !== "" && title.trim() !== "" && !report.isPending;

  return (
    <>
      <div className="mb-6 -mt-4">
        <button
          type="button"
          onClick={() => {
            setTeamId(teams[0]?.id ?? "");
            setOpen(true);
          }}
          className="text-[13px] font-semibold text-mist/70 hover:text-mist"
        >
          🩹 Hurt? Let your coach know
        </button>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Report an injury">
        <div className="flex flex-col gap-3">
          {error && <ErrorBanner message={error} />}
          {teams.length > 1 && (
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-bold text-mist">Team</span>
              <select
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                className="min-h-[44px] rounded-xl border border-white/10 bg-ink-900 px-3 text-[14px]"
              >
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-bold text-mist">What hurts?</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Shin splints, sore knee"
              maxLength={120}
              className="min-h-[44px] rounded-xl border border-white/10 bg-ink-900 px-3 text-[14px]"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-bold text-mist">
              Details <span className="font-normal">(optional)</span>
            </span>
            <textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="When did it start, what makes it worse…"
              className="rounded-xl border border-white/10 bg-ink-900 px-3 py-2.5 text-[14px]"
            />
          </label>
          <p className="text-[12px] text-mist/70">
            Your coach will see this in the team injury log.
          </p>
          <Button
            disabled={!canSubmit}
            onClick={() => report.mutate()}
            className="min-h-[48px]"
          >
            {report.isPending ? "Sending…" : "Report to coach"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
