import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../lib/api";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  FullScreenLoader,
  Modal,
  TextInput,
} from "../../components/ui";

const CAN_MANAGE = new Set(["COACH", "TEAM_ADMIN"]);

function GroupRow({
  teamId,
  groupId,
  name,
  memberCount,
  canManage,
}: {
  teamId: string;
  groupId: string;
  name: string;
  memberCount: number;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ["group", groupId],
    queryFn: () => api.getGroup(groupId),
    enabled: expanded,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["groups", teamId] });
    queryClient.invalidateQueries({ queryKey: ["group", groupId] });
  };

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteGroup(groupId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groups", teamId] });
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : "Couldn't delete the group."),
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => api.removeGroupMember(groupId, userId),
    onSuccess: invalidate,
    onError: (err) =>
      setError(err instanceof Error ? err.message : "Couldn't remove that member."),
  });

  const members = detailQuery.data?.group.members ?? [];

  return (
    <Card className="p-4">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-3 text-left"
      >
        <Avatar name={name} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-extrabold tracking-tight">{name}</p>
          <p className="text-[13px] text-mist">
            {memberCount} {memberCount === 1 ? "member" : "members"}
          </p>
        </div>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          className={`shrink-0 text-mist transition-transform ${expanded ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {expanded && (
        <div className="mt-4 border-t border-white/10 pt-4">
          {error && (
            <div className="mb-3">
              <ErrorBanner message={error} />
            </div>
          )}
          {detailQuery.isLoading ? (
            <div className="flex justify-center py-4">
              <FullScreenLoader />
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {members.length === 0 && (
                <p className="text-[14px] text-mist">No members yet.</p>
              )}
              {members.map((m) => (
                <div
                  key={m.userId}
                  className="flex items-center gap-2.5 rounded-xl bg-ink-800 px-3 py-2"
                >
                  <Avatar name={m.displayName} size="sm" />
                  <p className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                    {m.displayName}
                  </p>
                  {canManage && (
                    <button
                      type="button"
                      aria-label={`Remove ${m.displayName}`}
                      onClick={() => removeMutation.mutate(m.userId)}
                      disabled={removeMutation.isPending}
                      className="flex h-9 w-9 items-center justify-center rounded-lg text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {canManage && (
            <div className="mt-4 flex gap-2">
              <AddMembersDialog teamId={teamId} groupId={groupId} groupName={name} onAdded={invalidate} />
              {confirmingDelete ? (
                <div className="flex flex-1 gap-2">
                  <Button
                    variant="danger"
                    className="flex-1"
                    loading={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate()}
                  >
                    Confirm delete
                  </Button>
                  <Button variant="secondary" onClick={() => setConfirmingDelete(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button variant="danger" className="flex-1" onClick={() => setConfirmingDelete(true)}>
                  Delete group
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function AddMembersDialog({
  teamId,
  groupId,
  groupName,
  onAdded,
}: {
  teamId: string;
  groupId: string;
  groupName: string;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ["group", groupId],
    queryFn: () => api.getGroup(groupId),
    enabled: open,
  });
  const rosterQuery = useQuery({
    queryKey: ["roster", teamId],
    queryFn: () => api.getRoster(teamId),
    enabled: open,
  });

  const inGroup = new Set((detailQuery.data?.group.members ?? []).map((m) => m.userId));
  const candidates = (rosterQuery.data?.roster ?? []).filter((m) => !inGroup.has(m.userId));

  const toggle = (userId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });

  const mutation = useMutation({
    mutationFn: () => api.addGroupMembers(groupId, [...selected]),
    onSuccess: () => {
      setSelected(new Set());
      setOpen(false);
      onAdded();
    },
    onError: (err) =>
      setError(
        err instanceof ApiError && err.code === "INVALID_MEMBERS"
          ? "Some of those people aren't on the team anymore."
          : err instanceof Error
            ? err.message
            : "Couldn't add members.",
      ),
  });

  return (
    <>
      <Button variant="secondary" className="flex-1" onClick={() => { setError(null); setOpen(true); }}>
        + Add members
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Add to ${groupName}`}>
        {error && (
          <div className="mb-4">
            <ErrorBanner message={error} />
          </div>
        )}
        {rosterQuery.isLoading ? (
          <div className="flex justify-center py-6">
            <FullScreenLoader />
          </div>
        ) : candidates.length === 0 ? (
          <p className="text-[14px] text-mist">Everyone on the roster is already in this group.</p>
        ) : (
          <>
            <div className="flex max-h-[50vh] flex-col gap-1.5 overflow-y-auto">
              {candidates.map((m) => (
                <label
                  key={m.userId}
                  className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-ink-800 px-3 py-2.5"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(m.userId)}
                    onChange={() => toggle(m.userId)}
                    className="h-5 w-5 shrink-0 accent-[#c8f542]"
                  />
                  <Avatar name={m.displayName} size="sm" />
                  <p className="min-w-0 flex-1 truncate text-[15px] font-semibold">
                    {m.displayName}
                  </p>
                </label>
              ))}
            </div>
            <Button
              className="mt-4 w-full"
              disabled={selected.size === 0}
              loading={mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              Add {selected.size > 0 ? `${selected.size} ` : ""}member{selected.size === 1 ? "" : "s"}
            </Button>
          </>
        )}
      </Modal>
    </>
  );
}

function CreateGroupDialog({
  teamId,
  onCreated,
}: {
  teamId: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const rosterQuery = useQuery({
    queryKey: ["roster", teamId],
    queryFn: () => api.getRoster(teamId),
    enabled: open,
  });

  const roster = rosterQuery.data?.roster ?? [];
  const toggle = (userId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });

  const mutation = useMutation({
    mutationFn: () =>
      api.createGroup(teamId, { name: name.trim(), memberIds: [...selected] }),
    onSuccess: () => {
      setName("");
      setSelected(new Set());
      setOpen(false);
      onCreated();
    },
    onError: (err) =>
      setError(
        err instanceof ApiError && err.code === "GROUP_EXISTS"
          ? "A group with that name already exists."
          : err instanceof Error
            ? err.message
            : "Couldn't create the group.",
      ),
  });

  return (
    <>
      <Button className="min-h-[44px] px-4 text-[14px]" onClick={() => { setError(null); setOpen(true); }}>
        + New group
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="New group">
        {error && (
          <div className="mb-4">
            <ErrorBanner message={error} />
          </div>
        )}
        <div className="flex flex-col gap-4">
          <Field label="Group name">
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Varsity squad"
              maxLength={80}
            />
          </Field>
          <div>
            <p className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-mist">
              Members
            </p>
            {rosterQuery.isLoading ? (
              <div className="flex justify-center py-4">
                <FullScreenLoader />
              </div>
            ) : (
              <div className="flex max-h-[40vh] flex-col gap-1.5 overflow-y-auto">
                {roster.map((m) => (
                  <label
                    key={m.userId}
                    className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-ink-800 px-3 py-2.5"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(m.userId)}
                      onChange={() => toggle(m.userId)}
                      className="h-5 w-5 shrink-0 accent-[#c8f542]"
                    />
                    <Avatar name={m.displayName} size="sm" />
                    <p className="min-w-0 flex-1 truncate text-[15px] font-semibold">
                      {m.displayName}
                    </p>
                  </label>
                ))}
              </div>
            )}
          </div>
          <Button
            disabled={name.trim().length < 2}
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Create group
          </Button>
        </div>
      </Modal>
    </>
  );
}

export function GroupsSection({
  teamId,
  myRole,
}: {
  teamId: string;
  myRole: string | null;
}) {
  const queryClient = useQueryClient();
  const groupsQuery = useQuery({
    queryKey: ["groups", teamId],
    queryFn: () => api.listGroups(teamId),
  });

  const canManage = myRole !== null && CAN_MANAGE.has(myRole);
  const groups = groupsQuery.data?.groups ?? [];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[13px] font-bold uppercase tracking-[0.18em] text-mist">
          {groups.length} {groups.length === 1 ? "group" : "groups"}
        </p>
        {canManage && (
          <CreateGroupDialog
            teamId={teamId}
            onCreated={() => queryClient.invalidateQueries({ queryKey: ["groups", teamId] })}
          />
        )}
      </div>

      {groupsQuery.isLoading ? (
        <div className="flex justify-center py-10">
          <FullScreenLoader />
        </div>
      ) : groupsQuery.isError ? (
        <ErrorBanner message="Couldn't load groups." />
      ) : groups.length === 0 ? (
        <EmptyState
          title="No groups yet"
          body={
            canManage
              ? "Split the roster into training groups — varsity, JV, distance crew — and assign workouts to them."
              : "Your coach hasn't created any training groups yet."
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g) => (
            <GroupRow
              key={g.id}
              teamId={teamId}
              groupId={g.id}
              name={g.name}
              memberCount={g.memberCount}
              canManage={canManage}
            />
          ))}
        </div>
      )}
    </div>
  );
}
