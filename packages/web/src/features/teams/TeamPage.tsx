import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
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
import { InviteDialog } from "./InviteDialog";

const CAN_INVITE = new Set(["COACH", "TEAM_ADMIN"]);

export function TeamPage() {
  const { id } = useParams<{ id: string }>();
  const [inviteOpen, setInviteOpen] = useState(false);

  const teamQuery = useQuery({
    queryKey: ["team", id],
    queryFn: () => api.getTeam(id!),
    enabled: !!id,
  });
  const rosterQuery = useQuery({
    queryKey: ["roster", id],
    queryFn: () => api.getRoster(id!),
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
  const roster = rosterQuery.data?.roster ?? [];
  const canInvite = team.myRole !== null && CAN_INVITE.has(team.myRole);

  // Coaches first, then admins, then everyone else — alphabetical within.
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
      <PageHeader title={team.name} backTo="/dashboard" />

      <Card className="mb-6">
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
          <span className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-mist">
            {team.memberCount} {team.memberCount === 1 ? "member" : "members"}
          </span>
        </div>
        {canInvite && (
          <Button
            onClick={() => setInviteOpen(true)}
            className="mt-5 w-full sm:w-auto"
          >
            + Invite athlete
          </Button>
        )}
      </Card>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13px] font-bold uppercase tracking-[0.18em] text-mist">
          Roster
        </h2>
      </div>

      {rosterQuery.isLoading ? (
        <div className="flex justify-center py-8">
          <FullScreenLoader />
        </div>
      ) : rosterQuery.isError ? (
        <ErrorBanner message="Couldn't load the roster." />
      ) : sorted.length === 0 ? (
        <EmptyState
          title="Nobody here yet"
          body="Invite your first athlete to get the team rolling."
          action={
            canInvite ? (
              <Button onClick={() => setInviteOpen(true)}>Invite athlete</Button>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {sorted.map((member) => (
            <Card key={member.userId} className="p-4">
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
                  <p className="text-[12px] text-mist/70">
                    Joined {formatDate(member.joinedAt)}
                  </p>
                </div>
                <RoleBadge role={member.role} />
              </div>
            </Card>
          ))}
        </div>
      )}

      <InviteDialog
        teamId={team.id}
        teamName={team.name}
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
      />
    </div>
  );
}
