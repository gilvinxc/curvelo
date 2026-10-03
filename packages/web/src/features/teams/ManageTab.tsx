import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { GroupsSection } from "./GroupsSection";
import { AttendanceSection } from "./AttendanceSection";
import { TeamLogo, resizeImageFile } from "./TeamLogo";
import {
  Button,
  Card,
  ErrorBanner,
  Field,
  FullScreenLoader,
  RoleBadge,
  Select,
  TextInput,
  UserAvatar,} from "../../components/ui";

const MANAGEABLE_ROLES = ["COACH", "TEAM_ADMIN", "RUNNER", "ALUMNI"] as const;

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[13px] font-black uppercase tracking-[0.14em] text-mist">
      {children}
    </h3>
  );
}

/** Invite-link manager: create shareable links, copy, revoke. */
function JoinLinksSection({ teamId }: { teamId: string }) {
  const queryClient = useQueryClient();
  const [expiresInDays, setExpiresInDays] = useState("7");
  const [maxUses, setMaxUses] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const linksQuery = useQuery({
    queryKey: ["join-links", teamId],
    queryFn: () => api.listJoinLinks(teamId),
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["join-links", teamId] });

  const create = useMutation({
    mutationFn: () =>
      api.createJoinLink(teamId, {
        expiresInDays: Number(expiresInDays),
        ...(maxUses.trim() ? { maxUses: Number(maxUses) } : {}),
      }),
    onSuccess: () => {
      setError(null);
      setMaxUses("");
      invalidate();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Couldn't create the link."),
  });

  const revoke = useMutation({
    mutationFn: (linkId: string) => api.revokeJoinLink(teamId, linkId),
    onSuccess: invalidate,
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Couldn't revoke the link."),
  });

  const copyLink = (linkId: string, token: string) => {
    const url = `${window.location.origin}/join/${token}`;
    void navigator.clipboard.writeText(url).then(() => {
      setCopiedId(linkId);
      window.setTimeout(() => setCopiedId((c) => (c === linkId ? null : c)), 2000);
    });
  };

  const links = linksQuery.data?.links ?? [];

  return (
    <Card>
      <SectionTitle>Invite links</SectionTitle>
      <p className="mt-2 text-[13px] text-mist">
        Share a link anywhere — anyone with it can request to join, and you
        approve each request below.
      </p>
      {error && (
        <div className="mt-3">
          <ErrorBanner message={error} />
        </div>
      )}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Field label="Expires in">
          <Select
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(e.target.value)}
          >
            <option value="1">1 day</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
          </Select>
        </Field>
        <Field label="Max uses (optional)">
          <TextInput
            inputMode="numeric"
            placeholder="Unlimited"
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
          />
        </Field>
      </div>
      <Button
        className="mt-3 w-full"
        disabled={create.isPending}
        onClick={() => create.mutate()}
      >
        {create.isPending ? "Creating…" : "Create invite link"}
      </Button>

      <div className="mt-4 flex flex-col gap-2">
        {linksQuery.isLoading && (
          <p className="text-[13px] text-mist">Loading links…</p>
        )}
        {links.map((link) => (
          <div
            key={link.id}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-ink-800 px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-[13px] text-ink-50">
                /join/{link.token}
              </p>
              <p className="text-[12px] text-mist">
                {link.state === "ACTIVE" ? (
                  <>
                    Active · {link.useCount}
                    {link.maxUses != null ? `/${link.maxUses}` : ""} used · expires{" "}
                    {new Date(link.expiresAt).toLocaleDateString()}
                  </>
                ) : (
                  <span className="font-semibold text-red-400">
                    {link.state.charAt(0) + link.state.slice(1).toLowerCase()}
                  </span>
                )}
              </p>
            </div>
            {link.state === "ACTIVE" && link.token && (
              <Button
                variant="secondary"
                className="min-h-[40px] px-3 text-[13px]"
                onClick={() => copyLink(link.id, link.token!)}
              >
                {copiedId === link.id ? "Copied!" : "Copy"}
              </Button>
            )}
            {(link.state === "ACTIVE" || link.state === "FULL") && (
              <Button
                variant="secondary"
                className="min-h-[40px] px-3 text-[13px] text-red-400"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(link.id)}
              >
                Revoke
              </Button>
            )}
          </div>
        ))}
        {!linksQuery.isLoading && links.length === 0 && (
          <p className="text-[13px] text-mist">No invite links yet.</p>
        )}
      </div>
    </Card>
  );
}

/** Pending join requests awaiting coach approval. */
function JoinRequestsSection({ teamId }: { teamId: string }) {
  const queryClient = useQueryClient();
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const requestsQuery = useQuery({
    queryKey: ["join-requests", teamId],
    queryFn: () => api.listJoinRequests(teamId),
    refetchInterval: 30000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["join-requests", teamId] });
    void queryClient.invalidateQueries({ queryKey: ["roster", teamId] });
    void queryClient.invalidateQueries({ queryKey: ["team", teamId] });
  };

  const decide = useMutation({
    mutationFn: ({
      requestId,
      approve,
      role,
    }: {
      requestId: string;
      approve: boolean;
      role: string;
    }) =>
      approve
        ? api.approveJoinRequest(teamId, requestId, role as never)
        : api.denyJoinRequest(teamId, requestId),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Couldn't decide the request."),
  });

  const requests = requestsQuery.data?.requests ?? [];

  return (
    <Card>
      <SectionTitle>Join requests</SectionTitle>
      {error && (
        <div className="mt-3">
          <ErrorBanner message={error} />
        </div>
      )}
      <div className="mt-3 flex flex-col gap-2">
        {requestsQuery.isLoading && (
          <p className="text-[13px] text-mist">Loading requests…</p>
        )}
        {requests.map((r) => (
          <div
            key={r.id}
            className="flex flex-col gap-2 rounded-xl border border-white/10 bg-ink-800 px-3 py-3"
          >
            <div className="flex items-center gap-2">
              <UserAvatar userId={r.user.id} name={r.user.displayName} hasAvatar={r.user.hasAvatar} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-bold text-ink-50">
                  {r.user.displayName}
                </p>
                <p className="truncate text-[12px] text-mist">{r.user.email}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Select
                aria-label="Role for new member"
                className="min-h-[44px] flex-1"
                value={roles[r.id] ?? "RUNNER"}
                onChange={(e) =>
                  setRoles((prev) => ({ ...prev, [r.id]: e.target.value }))
                }
              >
                <option value="RUNNER">Runner</option>
                <option value="PARENT">Parent</option>
                <option value="COACH">Coach</option>
                <option value="TEAM_ADMIN">Team admin</option>
              </Select>
              <Button
                className="min-h-[44px] flex-1"
                disabled={decide.isPending}
                onClick={() =>
                  decide.mutate({
                    requestId: r.id,
                    approve: true,
                    role: roles[r.id] ?? "RUNNER",
                  })
                }
              >
                Approve
              </Button>
              <Button
                variant="secondary"
                className="min-h-[44px]"
                disabled={decide.isPending}
                onClick={() =>
                  decide.mutate({ requestId: r.id, approve: false, role: "RUNNER" })
                }
              >
                Deny
              </Button>
            </div>
          </div>
        ))}
        {!requestsQuery.isLoading && requests.length === 0 && (
          <p className="text-[13px] text-mist">No pending requests.</p>
        )}
      </div>
    </Card>
  );
}

/** Roster role management + removal. */
function MembersSection({
  teamId,
  myUserId,
  isOwner,
}: {
  teamId: string;
  myUserId: string;
  isOwner: boolean;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const rosterQuery = useQuery({
    queryKey: ["roster", teamId],
    queryFn: () => api.getRoster(teamId),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["roster", teamId] });
    void queryClient.invalidateQueries({ queryKey: ["team", teamId] });
  };

  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api.updateMemberRole(teamId, userId, role as never),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Couldn't change the role."),
  });

  const remove = useMutation({
    mutationFn: (userId: string) => api.removeMember(teamId, userId),
    onSuccess: () => {
      setError(null);
      setConfirmRemove(null);
      invalidate();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Couldn't remove the member."),
  });

  const roster = rosterQuery.data?.roster ?? [];

  return (
    <Card>
      <SectionTitle>Members</SectionTitle>
      {error && (
        <div className="mt-3">
          <ErrorBanner message={error} />
        </div>
      )}
      <div className="mt-3 flex flex-col gap-2">
        {roster.map((m) => {
          const isSelf = m.userId === myUserId;
          const elevated = m.role === "COACH" || m.role === "TEAM_ADMIN";
          // Only the owner may touch coach/admin roles.
          const canEditRole = !isSelf && (isOwner || !elevated);
          return (
            <div
              key={m.userId}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-ink-800 px-3 py-2.5"
            >
              <UserAvatar userId={m.userId} name={m.displayName} hasAvatar={m.hasAvatar} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-bold text-ink-50">
                  {m.displayName}
                  {isSelf && <span className="text-mist"> (you)</span>}
                </p>
                <RoleBadge role={m.role} />
              </div>
              {canEditRole && (
                <Select
                  aria-label={`Role for ${m.displayName}`}
                  className="min-h-[44px] w-32"
                  value={m.role}
                  disabled={changeRole.isPending}
                  onChange={(e) =>
                    changeRole.mutate({ userId: m.userId, role: e.target.value })
                  }
                >
                  {MANAGEABLE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r.charAt(0) + r.slice(1).toLowerCase().replace("_", " ")}
                    </option>
                  ))}
                </Select>
              )}
              {!isSelf &&
                (confirmRemove === m.userId ? (
                  <div className="flex gap-1">
                    <Button
                      className="min-h-[44px] px-3 text-[13px]"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(m.userId)}
                    >
                      Confirm
                    </Button>
                    <Button
                      variant="secondary"
                      className="min-h-[44px] px-3 text-[13px]"
                      onClick={() => setConfirmRemove(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="secondary"
                    className="min-h-[44px] px-3 text-[13px] text-red-400"
                    onClick={() => setConfirmRemove(m.userId)}
                  >
                    Remove
                  </Button>
                ))}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** Ownership transfer (owner only). */
function TransferSection({
  teamId,
  myUserId,
}: {
  teamId: string;
  myUserId: string;
}) {
  const queryClient = useQueryClient();
  const [newOwnerId, setNewOwnerId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const rosterQuery = useQuery({
    queryKey: ["roster", teamId],
    queryFn: () => api.getRoster(teamId),
  });

  const transfer = useMutation({
    mutationFn: () => api.transferTeam(teamId, newOwnerId),
    onSuccess: () => {
      setError(null);
      setDone(true);
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: ["team", teamId] });
      void queryClient.invalidateQueries({ queryKey: ["roster", teamId] });
    },
    onError: (err) =>
      setError(
        err instanceof ApiError ? err.message : "Couldn't transfer the team.",
      ),
  });

  const candidates = (rosterQuery.data?.roster ?? []).filter(
    (m) => m.userId !== myUserId,
  );

  if (done) {
    return (
      <Card>
        <SectionTitle>Team ownership</SectionTitle>
        <p className="mt-2 text-[14px] text-mist">
          Ownership transferred. You're now a coach on this team.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <SectionTitle>Team ownership</SectionTitle>
      <p className="mt-2 text-[13px] text-mist">
        Hand ownership to another member. They'll become a coach if they aren't
        one, and you'll stay on as a coach.
      </p>
      {error && (
        <div className="mt-3">
          <ErrorBanner message={error} />
        </div>
      )}
      {!confirming ? (
        <div className="mt-3 flex gap-2">
          <Select
            aria-label="New owner"
            className="min-h-[48px] flex-1"
            value={newOwnerId}
            onChange={(e) => setNewOwnerId(e.target.value)}
          >
            <option value="">Choose a member…</option>
            {candidates.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.displayName} ({m.role.toLowerCase()})
              </option>
            ))}
          </Select>
          <Button
            variant="secondary"
            className="min-h-[48px]"
            disabled={!newOwnerId}
            onClick={() => setConfirming(true)}
          >
            Transfer
          </Button>
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-red-400/30 bg-red-400/10 p-4">
          <p className="text-[14px] font-bold text-ink-50">
            Transfer ownership of this team?
          </p>
          <p className="mt-1 text-[13px] text-mist">
            You'll lose owner controls (adding coaches, transferring again).
            This can't be undone by you.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              className="flex-1"
              disabled={transfer.isPending}
              onClick={() => transfer.mutate()}
            >
              {transfer.isPending ? "Transferring…" : "Yes, transfer"}
            </Button>
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}


/** Team name + description. Managers only; audited server-side. */
function TeamSettingsSection({
  teamId,
  teamName,
}: {
  teamId: string;
  teamName: string;
}) {
  const queryClient = useQueryClient();
  const teamQuery = useQuery({
    queryKey: ["team", teamId],
    queryFn: () => api.getTeam(teamId),
  });
  const [name, setName] = useState(teamName);
  const [description, setDescription] = useState(
    teamQuery.data?.team.description ?? "",
  );
  const [editing, setEditing] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      api.updateTeam(teamId, {
        name: name.trim(),
        description: description.trim() || undefined,
      }),
    onSuccess: () => {
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ["team", teamId] });
      queryClient.invalidateQueries({ queryKey: ["teams"] });
    },
  });

  if (!editing) {
    return (
      <Card>
        <div className="flex items-center justify-between">
          <SectionTitle>Team settings</SectionTitle>
          <Button
            variant="secondary"
            onClick={() => {
              setName(teamQuery.data?.team.name ?? teamName);
              setDescription(teamQuery.data?.team.description ?? "");
              setEditing(true);
            }}
            className="min-h-[44px] px-4 text-[13px]"
          >
            Edit
          </Button>
        </div>
        <p className="mt-2 text-[15px] font-bold text-ink-50">
          {teamQuery.data?.team.name ?? teamName}
        </p>
        {teamQuery.data?.team.description && (
          <p className="mt-1 text-[13px] text-mist">
            {teamQuery.data.team.description}
          </p>
        )}
      </Card>
    );
  }

  return (
    <Card>
      <SectionTitle>Team settings</SectionTitle>
      <div className="mt-3 flex flex-col gap-3">
        {mutation.isError && (
          <ErrorBanner
            message={
              mutation.error instanceof ApiError
                ? mutation.error.message
                : "Couldn't save."
            }
          />
        )}
        <Field label="Team name">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
          />
        </Field>
        <Field label="Description (optional)">
          <TextInput
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={280}
            placeholder="What this team is about"
          />
        </Field>
        <div className="flex gap-2">
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !name.trim()}
            className="min-h-[48px] flex-1"
          >
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => setEditing(false)}
            className="min-h-[48px] px-5"
          >
            Cancel
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** Team logo: upload (resized in-browser) or remove. Stored in the database. */
function LogoSection({ teamId, teamName }: { teamId: string; teamName: string }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [logoTick, setLogoTick] = useState(0);

  const teamQuery = useQuery({
    queryKey: ["team", teamId],
    queryFn: () => api.getTeam(teamId),
  });
  const team = teamQuery.data?.team;

  const uploadMutation = useMutation({
    mutationFn: (image: string) => api.setTeamLogo(teamId, image),
    onSuccess: () => {
      setPreview(null);
      setLogoTick((t) => t + 1);
      queryClient.invalidateQueries({ queryKey: ["team", teamId] });
      queryClient.invalidateQueries({ queryKey: ["teams"] });
    },
    onError: (e) => {
      setError(e instanceof ApiError ? e.message : "Couldn't upload the logo.");
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => api.removeTeamLogo(teamId),
    onSuccess: () => {
      setLogoTick((t) => t + 1);
      queryClient.invalidateQueries({ queryKey: ["team", teamId] });
      queryClient.invalidateQueries({ queryKey: ["teams"] });
    },
    onError: (e) => {
      setError(e instanceof ApiError ? e.message : "Couldn't remove the logo.");
    },
  });

  async function onFile(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setError("Please choose a JPEG, PNG, or WebP image.");
      return;
    }
    try {
      const dataUrl = await resizeImageFile(file);
      setPreview(dataUrl);
    } catch {
      setError("Could not read that image.");
    }
  }

  return (
    <Card>
      <SectionTitle>Team logo</SectionTitle>
      <div className="mt-3 flex items-center gap-4">
        <TeamLogo
          teamId={teamId}
          teamName={teamName}
          hasLogo={team?.hasLogo ?? false}
          version={logoTick}
          size={64}
        />
        <div className="flex-1">
          {preview ? (
            <div className="flex items-center gap-3">
              <img
                src={preview}
                alt="New logo preview"
                className="h-16 w-16 rounded-xl object-cover"
              />
              <p className="text-[13px] font-semibold text-volt-400">
                New logo — hit Save to apply it.
              </p>
            </div>
          ) : (
            <p className="text-[13px] text-mist">
              A square image works best. It's resized in your browser before
              uploading.
            </p>
          )}
        </div>
      </div>
      {error && (
        <div className="mt-3">
          <ErrorBanner message={error} />
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <label className="inline-flex min-h-[44px] cursor-pointer items-center rounded-xl bg-white/10 px-4 text-[14px] font-bold text-ink-50 hover:bg-white/15">
          {preview ? "Choose a different image" : "Upload logo"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </label>
        {preview && (
          <Button
            onClick={() => preview && uploadMutation.mutate(preview)}
            disabled={uploadMutation.isPending}
          >
            {uploadMutation.isPending ? "Saving…" : "Save logo"}
          </Button>
        )}
        {!preview && team?.hasLogo && (
          <Button
            variant="secondary"
            onClick={() => removeMutation.mutate()}
            disabled={removeMutation.isPending}
          >
            Remove logo
          </Button>
        )}
      </div>
    </Card>
  );
}

export function ManageTab({
  teamId,
  teamName,
  isOwner,
  myRole,
}: {
  teamId: string;
  teamName: string;
  isOwner: boolean;
  myRole: string | null;
}) {
  const { user } = useAuth();
  if (!user) return <FullScreenLoader />;

  return (
    <div className="flex flex-col gap-4">
      <TeamSettingsSection teamId={teamId} teamName={teamName} />
      <LogoSection teamId={teamId} teamName={teamName} />
      <JoinLinksSection teamId={teamId} />
      <JoinRequestsSection teamId={teamId} />
      <MembersSection teamId={teamId} myUserId={user.id} isOwner={isOwner} />
      <Card>
        <SectionTitle>Training groups</SectionTitle>
        <div className="mt-3">
          <GroupsSection teamId={teamId} myRole={myRole} isOwner={isOwner} />
        </div>
      </Card>
      <Card>
        <SectionTitle>Attendance</SectionTitle>
        <div className="mt-3">
          <AttendanceSection teamId={teamId} />
        </div>
      </Card>
      {isOwner && <TransferSection teamId={teamId} myUserId={user.id} />}
    </div>
  );
}
