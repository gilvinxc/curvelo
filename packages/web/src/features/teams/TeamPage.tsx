import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  FullScreenLoader,
  PageHeader,
  RoleBadge,
  formatDate,
} from "../../components/ui";
import { cn } from "../../components/cx";
import { InviteDialog } from "./InviteDialog";
import { WorkoutList } from "../workouts/WorkoutList";
import { TeamCalendar } from "../calendar/TeamCalendar";
import { ManageTab } from "./ManageTab";
import { TeamLogo } from "./TeamLogo";
import { GoalsTab } from "../goals/GoalsTab";
import { FeedPage } from "../feed/FeedPage";
import { MessagesSection } from "../messages/MessagesSection";
import { TeamDigestSection } from "../insights/TeamDigestSection";
import { AlumniDigestDialog } from "../insights/AlumniDigestDialog";
import { PracticePlanner } from "./PracticePlanner";
import { TeamLogDialog } from "../activities/TeamLogDialog";
import { TeamRaceDialog } from "../records/TeamRaceDialog";
import { DocumentsTab } from "../documents/DocumentsTab";
import { PhotosTab } from "../photos/PhotosTab";

const CAN_INVITE = new Set(["COACH", "TEAM_ADMIN"]);

export type TeamTab =
  | "roster"
  | "photos"
  | "feed"
  | "messages"
  | "workouts"
  | "calendar"
  | "coaching"
  | "goals"
  | "documents"
  | "manage";

const TABS: { id: TeamTab; label: string; href: (id: string) => string; coachOnly?: boolean }[] = [
  { id: "roster", label: "Roster", href: (id) => `/teams/${id}` },
  { id: "photos", label: "Photos", href: (id) => `/teams/${id}/photos` },
  { id: "feed", label: "Feed", href: (id) => `/teams/${id}/feed` },
  { id: "messages", label: "Messages", href: (id) => `/teams/${id}/messages` },
  { id: "workouts", label: "Workouts", href: (id) => `/teams/${id}/workouts` },
  { id: "calendar", label: "Calendar", href: (id) => `/teams/${id}/calendar` },
  { id: "coaching", label: "Coaching", href: (id) => `/teams/${id}/coaching`, coachOnly: true },
  { id: "goals", label: "Goals", href: (id) => `/teams/${id}/goals` },
  { id: "documents", label: "Documents", href: (id) => `/teams/${id}/documents` },
  { id: "manage", label: "Manage", href: (id) => `/teams/${id}/manage`, coachOnly: true },
];

function RosterTab({
  teamId,
  canInvite,
  canViewAthlete,
  myUserId,
  isOwner,
  onInvite,
}: {
  teamId: string;
  canInvite: boolean;
  canViewAthlete: boolean;
  myUserId: string;
  isOwner: boolean;
  onInvite: () => void;
}) {
  const rosterQuery = useQuery({
    queryKey: ["roster", teamId],
    queryFn: () => api.getRoster(teamId),
    enabled: !!teamId,
  });
  const groupsQuery = useQuery({
    queryKey: ["groups", teamId],
    queryFn: () => api.listGroups(teamId),
    enabled: !!teamId && !canInvite,
  });

  if (rosterQuery.isLoading) {
    return (
      <div className="flex justify-center py-8">
        <FullScreenLoader />
      </div>
    );
  }
  if (rosterQuery.isError) return <ErrorBanner message="Couldn't load the roster." />;

  const roster = rosterQuery.data?.roster ?? [];
  const roleRank: Record<string, number> = {
    COACH: 0,
    TEAM_ADMIN: 1,
    PARENT: 2,
    RUNNER: 3,
    ALUMNI: 4,
  };
  const sorted = [...roster].sort(
    (a, b) =>
      (roleRank[a.role] ?? 9) - (roleRank[b.role] ?? 9) ||
      a.displayName.localeCompare(b.displayName),
  );

  return (
    <div>
      {sorted.length === 0 ? (
        <EmptyState
          title="Nobody here yet"
          body="Invite your first athlete to get the team rolling."
          action={
            canInvite ? (
              <Button onClick={onInvite}>Invite athlete</Button>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {sorted.map((member) => {
            const card = (
              <Card key={member.userId} className="p-4 transition hover:border-volt-400/40">
                <div className="flex items-center gap-3">
                  <Avatar name={member.displayName} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-bold">
                      {member.displayName}
                    </p>
                    {member.email && (
                      <p className="truncate text-[13px] text-mist">
                        {member.email}
                      </p>
                    )}
                    {member.phone && (
                      <a
                        href={`tel:${member.phone}`}
                        className="block truncate text-[13px] font-semibold text-volt-300"
                        onClick={(e) => e.stopPropagation()}
                      >
                        📞 {member.phone}
                      </a>
                    )}
                    {member.emergencyPhone && (
                      <p className="truncate text-[12px] text-mist">
                        🆘 {member.emergencyName ? `${member.emergencyName}: ` : ""}
                        {member.emergencyPhone}
                      </p>
                    )}
                    <p className="text-[12px] text-mist/70">
                      Joined {formatDate(member.joinedAt)}
                    </p>
                  </div>
                  <RoleBadge role={member.role} />
                  {canViewAthlete && (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a7ae97" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  )}
                </div>
              </Card>
            );
            return canViewAthlete ? (
              <Link
                key={member.userId}
                to={`/teams/${teamId}/athletes/${member.userId}`}
                aria-label={`View ${member.displayName}'s training`}
              >
                {card}
              </Link>
            ) : (
              card
            );
          })}
        </div>
      )}
      {!canInvite && (groupsQuery.data?.groups ?? []).length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2 text-[13px] font-black uppercase tracking-[0.14em] text-mist">
            My training groups
          </h3>
          <div className="flex flex-col gap-2">
            {(groupsQuery.data?.groups ?? [])
              .filter((g) =>
                (g.members ?? []).some((m) => m.userId === myUserId),
              )
              .map((g) => (
                <Card key={g.id} className="p-4">
                  <p className="text-[15px] font-bold text-ink-50">{g.name}</p>
                  <p className="mt-1 text-[13px] text-mist">
                    {(g.members ?? [])
                      .map((m) => m.displayName)
                      .join(", ")}
                  </p>
                </Card>
              ))}
          </div>
        </div>
      )}
      <LeaveTeamButton teamId={teamId} isOwner={isOwner} />
    </div>
  );
}

/** Voluntary departure. Owners must transfer ownership first (API enforces). */
function LeaveTeamButton({
  teamId,
  isOwner,
}: {
  teamId: string;
  isOwner: boolean;
}) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const leave = useMutation({
    mutationFn: () => api.leaveTeam(teamId),
    onSuccess: () => navigate("/dashboard"),
    onError: (err) =>
      setError(
        err instanceof ApiError ? err.message : "Couldn't leave the team.",
      ),
  });
  if (isOwner) return null;
  return (
    <div className="mt-8 border-t border-white/10 pt-4">
      {error && (
        <div className="mb-3">
          <ErrorBanner message={error} />
        </div>
      )}
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] text-mist">Leave this team?</span>
          <Button
            variant="secondary"
            className="min-h-[44px] px-4 text-[14px]"
            disabled={leave.isPending}
            onClick={() => leave.mutate()}
          >
            Yes, leave
          </Button>
          <Button
            variant="secondary"
            className="min-h-[44px] px-4 text-[14px]"
            onClick={() => setConfirming(false)}
          >
            Stay
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-[14px] font-semibold text-mist hover:text-red-300"
        >
          Leave team
        </button>
      )}
    </div>
  );
}

export function TeamPage({ initialTab = "roster" }: { initialTab?: TeamTab }) {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [teamLogOpen, setTeamLogOpen] = useState(false);
  const [teamRaceOpen, setTeamRaceOpen] = useState(false);
  const [alumniDigestOpen, setAlumniDigestOpen] = useState(false);

  const teamQuery = useQuery({
    queryKey: ["team", id],
    queryFn: () => api.getTeam(id!),
    enabled: !!id,
  });

  if (teamQuery.isLoading) return <FullScreenLoader />;

  if (teamQuery.isError || !teamQuery.data) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Team" backTo="/dashboard" />
        <ErrorBanner message="Couldn't load this team. You may not be a member." />
      </div>
    );
  }

  const { team } = teamQuery.data;
  const canInvite = team.myRole !== null && CAN_INVITE.has(team.myRole);
  // Alumni (outer tier): no photos, no manage tab.
  const isAlumni = team.myRole === "ALUMNI";
  const tabs = TABS.filter(
    (t) => (!t.coachOnly || canInvite) && !(isAlumni && t.id === "photos"),
  );

  return (
    <div>
      <PageHeader title={team.name} backTo="/dashboard" />

      <Card className="mb-5">
        <div className="mb-3 flex items-center gap-3">
          <TeamLogo teamId={team.id} teamName={team.name} hasLogo={team.hasLogo ?? false} size={52} />
          <div className="min-w-0">
            <p className="truncate text-[18px] font-extrabold text-ink-50">{team.name}</p>
            <p className="text-[12px] font-semibold text-mist">
              {team.memberCount} {team.memberCount === 1 ? "member" : "members"}
            </p>
          </div>
        </div>
        {team.description && (
          <p className="text-[15px] leading-relaxed text-ink-50/90">
            {team.description}
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {team.myRole && <RoleBadge role={team.myRole} />}
          <span className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-mist">
            {team.visibility === "PUBLIC" ? "Public" : "Private"}
          </span>
        </div>
        {canInvite && (
          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              onClick={() => setInviteOpen(true)}
              className="flex-1 sm:flex-none"
            >
              + Invite athlete
            </Button>
            <Link to={`/teams/${team.id}/reports`}>
              <Button variant="secondary" className="min-h-[48px]">
                Reported posts
              </Button>
            </Link>
          </div>
        )}
      </Card>

      <nav
        aria-label="Team sections"
        className="mb-5 flex gap-1 overflow-x-auto rounded-xl border border-white/10 bg-ink-900 p-1"
      >
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            to={tab.href(team.id)}
            aria-current={initialTab === tab.id ? "page" : undefined}
            className={cn(
              "min-h-[44px] shrink-0 whitespace-nowrap rounded-lg px-4 text-center text-[14px] font-semibold leading-[44px] transition",
              initialTab === tab.id
                ? "bg-volt-400 text-ink-950"
                : "text-mist hover:text-ink-50",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {initialTab === "roster" && (
        <RosterTab
          teamId={team.id}
          canInvite={canInvite}
          canViewAthlete={canInvite}
          myUserId={user?.id ?? ""}
          isOwner={team.isOwner ?? false}
          onInvite={() => setInviteOpen(true)}
        />
      )}
      {initialTab === "photos" && (
        <PhotosTab teamId={team.id} isCoach={canInvite} />
      )}
      {initialTab === "feed" && (
        <FeedPage teamId={team.id} myRole={team.myRole} />
      )}
      {initialTab === "messages" && (
        <MessagesSection teamId={team.id} myRole={team.myRole} />
      )}
      {initialTab === "workouts" && (
        <WorkoutList teamId={team.id} myRole={team.myRole} />
      )}
      {initialTab === "calendar" && (
        <TeamCalendar teamId={team.id} myRole={team.myRole} />
      )}
      {initialTab === "coaching" && canInvite && (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <Button onClick={() => setTeamLogOpen(true)}>
              🏃 Log team run
            </Button>
            <Button variant="secondary" onClick={() => setTeamRaceOpen(true)}>
              🏁 Log race results
            </Button>
          </div>
          <TeamDigestSection teamId={team.id} />
          <div className="mt-4">
            <Button
              variant="secondary"
              className="min-h-[44px] px-4 text-[14px]"
              onClick={() => setAlumniDigestOpen(true)}
            >
              ✍️ Draft alumni update
            </Button>
          </div>
          <div className="mt-6">
            <PracticePlanner teamId={team.id} />
          </div>
          {alumniDigestOpen && (
            <AlumniDigestDialog
              teamId={team.id}
              onClose={() => setAlumniDigestOpen(false)}
            />
          )}
        </>
      )}
      {initialTab === "goals" && (
        <GoalsTab teamId={team.id} canManage={canInvite} />
      )}
      {initialTab === "documents" && (
        <DocumentsTab teamId={team.id} isCoach={canInvite} />
      )}
      {initialTab === "manage" && canInvite && (
        <ManageTab teamId={team.id} teamName={team.name} isOwner={team.isOwner ?? false} myRole={team.myRole} />
      )}

      <InviteDialog
        teamId={team.id}
        teamName={team.name}
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
      />

      <TeamLogDialog
        teamId={team.id}
        open={teamLogOpen}
        onClose={() => setTeamLogOpen(false)}
      />

      <TeamRaceDialog
        teamId={team.id}
        open={teamRaceOpen}
        onClose={() => setTeamRaceOpen(false)}
      />
    </div>
  );
}
