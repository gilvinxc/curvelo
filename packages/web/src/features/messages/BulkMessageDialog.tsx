import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../lib/api";
import {
  Avatar,
  Button,
  ErrorBanner,
  Field,
  FullScreenLoader,
  Modal,
  Select,
  TextArea,
} from "../../components/ui";

export function BulkMessageDialog({
  teamId,
  open,
  onClose,
}: {
  teamId: string;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [groupIds, setGroupIds] = useState<Set<string>>(new Set());
  const [athleteIds, setAthleteIds] = useState<Set<string>>(new Set());
  const [athleteFilter, setAthleteFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setBody("");
      setGroupIds(new Set());
      setAthleteIds(new Set());
      setAthleteFilter("");
      setError(null);
      setResult(null);
    }
  }, [open]);

  const groupsQuery = useQuery({
    queryKey: ["groups", teamId],
    queryFn: () => api.listGroups(teamId),
    enabled: open,
  });
  const rosterQuery = useQuery({
    queryKey: ["roster", teamId],
    queryFn: () => api.getRoster(teamId),
    enabled: open,
  });

  const groups = groupsQuery.data?.groups ?? [];
  const athletes = (rosterQuery.data?.roster ?? []).filter((m) => m.role === "RUNNER");

  const toggle = (set: Set<string>, apply: (n: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    apply(next);
  };

  const mutation = useMutation({
    mutationFn: () =>
      api.bulkMessage(teamId, {
        groupIds: [...groupIds],
        athleteIds: [...athleteIds],
        body: body.trim(),
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["conversations", teamId] });
      queryClient.invalidateQueries({ queryKey: ["checkIns", teamId] });
      const parts: string[] = [];
      if (res.sentToGroups.length > 0)
        parts.push(`${res.sentToGroups.length} group${res.sentToGroups.length === 1 ? "" : "s"}`);
      if (res.sentToAthletes.length > 0)
        parts.push(
          `${res.sentToAthletes.length} athlete${res.sentToAthletes.length === 1 ? "" : "s"}`,
        );
      setResult(
        `Sent to ${parts.join(" and ") || "nobody"}` +
          (res.skipped.length > 0 ? ` — ${res.skipped.length} skipped` : ""),
      );
    },
    onError: (err) =>
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Couldn't send.",
      ),
  });

  const canSend =
    body.trim().length > 0 && (groupIds.size > 0 || athleteIds.size > 0);

  return (
    <Modal open={open} onClose={onClose} title="Message many at once">
      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}
      <div className="flex flex-col gap-4">
        <Field label="Message">
          <TextArea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Practice is moved to 5pm today…"
            maxLength={4000}
            rows={3}
          />
        </Field>

        <div>
          <p className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-mist">
            Groups ({groupIds.size} selected)
          </p>
          {groupsQuery.isLoading ? (
            <div className="flex justify-center py-4">
              <FullScreenLoader />
            </div>
          ) : groups.length === 0 ? (
            <p className="text-[14px] text-mist">No training groups yet.</p>
          ) : (
            <div className="flex max-h-[28vh] flex-col gap-1.5 overflow-y-auto">
              {groups.map((g) => (
                <label
                  key={g.id}
                  className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-ink-800 px-3 py-2.5"
                >
                  <input
                    type="checkbox"
                    checked={groupIds.has(g.id)}
                    onChange={() => toggle(groupIds, setGroupIds, g.id)}
                    className="h-5 w-5 shrink-0 accent-[#c8f542]"
                  />
                  <p className="min-w-0 flex-1 truncate text-[15px] font-semibold">
                    {g.name}
                    {g.leaderName ? ` — led by ${g.leaderName}` : ""}
                  </p>
                  <span className="text-[13px] text-mist">{g.memberCount}</span>
                </label>
              ))}
            </div>
          )}
          <p className="mt-1 text-[12px] text-mist">
            Posts into each group's Team Huddle channel.
          </p>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[13px] font-semibold uppercase tracking-wide text-mist">
              Athletes ({athleteIds.size} selected)
            </p>
            <Select
              value={athleteFilter}
              onChange={(e) => setAthleteFilter(e.target.value)}
              className="!w-auto !py-1.5 text-[13px]"
            >
              <option value="">All athletes</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </div>
          <BulkAthleteList
            teamId={teamId}
            groupId={athleteFilter || null}
            athletes={athletes}
            selected={athleteIds}
            onToggle={(id) => toggle(athleteIds, setAthleteIds, id)}
          />
          <p className="mt-1 text-[12px] text-mist">
            Sends to each athlete's check-in thread (guardians included for minors).
          </p>
        </div>

        {result ? (
          <div className="flex flex-col gap-3">
            <p className="rounded-xl bg-lime-400/10 px-4 py-3 text-[15px] font-semibold text-lime-200">
              {result}
            </p>
            <Button onClick={onClose}>Done</Button>
          </div>
        ) : (
          <Button
            disabled={!canSend}
            loading={mutation.isPending}
            onClick={() => {
              setError(null);
              mutation.mutate();
            }}
          >
            Send message
          </Button>
        )}
      </div>
    </Modal>
  );
}

function BulkAthleteList({
  teamId,
  groupId,
  athletes,
  selected,
  onToggle,
}: {
  teamId: string;
  groupId: string | null;
  athletes: Array<{ userId: string; displayName: string }>;
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  const groupQuery = useQuery({
    queryKey: ["group", groupId],
    queryFn: () => api.getGroup(groupId!),
    enabled: !!groupId,
  });
  const inGroup = groupId
    ? new Set((groupQuery.data?.group.members ?? []).map((m) => m.userId))
    : null;
  const list = inGroup ? athletes.filter((a) => inGroup.has(a.userId)) : athletes;
  void teamId;

  if (groupId && groupQuery.isLoading) {
    return (
      <div className="flex justify-center py-4">
        <FullScreenLoader />
      </div>
    );
  }
  return (
    <div className="flex max-h-[28vh] flex-col gap-1.5 overflow-y-auto">
      {list.map((a) => (
        <label
          key={a.userId}
          className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-ink-800 px-3 py-2.5"
        >
          <input
            type="checkbox"
            checked={selected.has(a.userId)}
            onChange={() => onToggle(a.userId)}
            className="h-5 w-5 shrink-0 accent-[#c8f542]"
          />
          <Avatar name={a.displayName} size="sm" />
          <p className="min-w-0 flex-1 truncate text-[15px] font-semibold">
            {a.displayName}
          </p>
        </label>
      ))}
      {list.length === 0 && (
        <p className="text-[14px] text-mist">No athletes match this filter.</p>
      )}
    </div>
  );
}
