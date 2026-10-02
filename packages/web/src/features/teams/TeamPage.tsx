import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../../lib/api";
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
import { GroupsSection } from "./GroupsSection";
import { ManageTab } from "./ManageTab";
import { TeamLogo } from "./TeamLogo";
import { GoalsTab } from "../goals/GoalsTab";
import { FeedPage } from "../feed/FeedPage";
import { MessagesSection } from "../messages/MessagesSection";
import { TeamDigestSection } from "../insights/TeamDigestSection";
import { TeamLogDialog } from "../activities/TeamLogDialog";
import { TeamRaceDialog } from "../records/TeamRaceDialog";
import { DocumentsTab } from "../documents/DocumentsTab";

const CAN_INVITE = new Set(["COACH", "TEAM_ADMIN"]);

export type TeamTab =
  | "roster"
  | "feed"
  | "messages"
  | "workouts"
  | "groups"
  | "calendar"
  | "coaching"
  | "goals"
  | "documents"
  | "manage";

const TABS: { id: TeamTab; label: string; href: (id: string) => string; coachOnly?: boolean }[] = [
  { id: "roster", label: "Roster", href: (id) => `/teams/${id}` },
  { id: "feed", label: "Feed", href: (id) => `/teams/${id}/feed` },
  { id: "messages", label: "Messages", href: (id) => `/teams/${id}/messages` },
  { id: "workouts", label: "Workouts", href: (id) => `/teams/${id}/workouts` },
  { id: "groups", label: "Groups", href: (id) => `/teams/${id}/groups` },
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
  onInvite,
}: {
  teamId: string;
  canInvite: boolean;
  canViewAthlete: boolean;
  onInvite: () => void;
}) {
  const rosterQuery = useQuery({
    queryKey: ["roster", teamId],
    queryFn: () => api.getRoster(teamId),
    enabled: !!teamId,
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
    </div>
  );
}

export function TeamPage({ initialTab = "roster" }: { initialTab?: TeamTab }) {
  const { id } = useParams<{ id: string }>();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [teamLogOpen, setTeamLogOpen] = useState(false);
  const [teamRaceOpen, setTeamRaceOpen] = useState(false);

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
  const tabs = TABS.filter((t) => !t.coachOnly || canInvite);

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
        className="mb-5 grid auto-cols-fr grid-flow-col gap-1 overflow-x-auto rounded-xl border border-white/10 bg-ink-900 p-1"
      >
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            to={tab.href(team.id)}
            aria-current={initialTab === tab.id ? "page" : undefined}
            className={cn(
              "min-h-[44px] whitespace-nowrap rounded-lg px-3 text-center text-[14px] font-semibold leading-[44px] transition",
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
          onInvite={() => setInviteOpen(true)}
        />
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
      {initialTab === "groups" && (
        <GroupsSection teamId={team.id} myRole={team.myRole} />
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
        </>
      )}
      {initialTab === "goals" && (
        <GoalsTab teamId={team.id} canManage={canInvite} />
      )}
      {initialTab === "documents" && (
        <DocumentsTab teamId={team.id} isCoach={canInvite} />
      )}
      {initialTab === "manage" && canInvite && (
        <ManageTab teamId={team.id} teamName={team.name} isOwner={team.isOwner ?? false} />
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
