import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../lib/api";
import { Modal, Button } from "../../components/ui";
import {
  distanceUnitLabel,
  parseDurationInput,
  toMeters,
  useUnits,
} from "../../lib/units";

function nowLocalInput(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/** Coach bulk-log: record one run for the whole team or a training group. */
export function TeamLogDialog({
  teamId,
  open,
  onClose,
}: {
  teamId: string;
  open: boolean;
  onClose: () => void;
}) {
  const units = useUnits();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<string>("team");
  const [selected, setSelected] = useState<string[]>([]);
  const [startedAt, setStartedAt] = useState(nowLocalInput());
  const [distance, setDistance] = useState("");
  const [duration, setDuration] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");

  const rosterQuery = useQuery({
    queryKey: ["teamRoster", teamId],
    queryFn: () => api.getRoster(teamId),
    enabled: open,
  });
  const groupsQuery = useQuery({
    queryKey: ["teamGroups", teamId],
    queryFn: () => api.listGroups(teamId),
    enabled: open,
  });
  const groupDetailQuery = useQuery({
    queryKey: ["group", scope],
    queryFn: () => api.getGroup(scope),
    enabled: open && scope !== "team",
  });

  const runners = useMemo(() => {
    const roster = rosterQuery.data?.roster ?? [];
    return roster.filter((m) => m.role === "RUNNER" && m.status === "ACTIVE");
  }, [rosterQuery.data]);

  const candidates = useMemo(() => {
    if (scope === "team") return runners;
    const members = groupDetailQuery.data?.group.members ?? [];
    const runnerIds = new Set(runners.map((r) => r.userId));
    return members
      .filter((m) => runnerIds.has(m.userId))
      .map((m) => ({ userId: m.userId, displayName: m.displayName }));
  }, [scope, runners, groupDetailQuery.data]);

  // Default: everyone in scope is selected (uncheck anyone who wasn't there).
  useEffect(() => {
    if (open) setSelected(candidates.map((c) => c.userId));
  }, [open, scope, candidates.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const mutation = useMutation({
    mutationFn: () => {
      const distanceM =
        distance.trim() === ""
          ? undefined
          : Math.round(toMeters(parseFloat(distance), units) * 10) / 10;
      const durationS =
        duration.trim() === "" ? undefined : parseDurationInput(duration);
      if (
        (distanceM !== undefined && !(distanceM > 0)) ||
        (durationS !== undefined && !(durationS > 0))
      ) {
        throw new Error("Enter a valid distance or duration.");
      }
      return api.logTeamRun({
        teamId,
        ...(scope === "team" ? {} : { groupId: scope }),
        userIds: selected,
        kind: "RUN",
        title: title.trim() || undefined,
        startedAt: new Date(startedAt).toISOString(),
        distanceM,
        durationS,
        notes: notes.trim() || undefined,
        visibility: "TEAM",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teamDigest", teamId] });
      onClose();
    },
  });

  const toggle = (userId: string) =>
    setSelected((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId],
    );

  const groups = groupsQuery.data?.groups ?? [];

  return (
    <Modal open={open} onClose={onClose} title="Log team run">
      <div className="flex flex-col gap-4">
        <div>
          <label className="mb-1 block text-[13px] font-bold text-mist">
            Who ran
          </label>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="min-h-[48px] w-full rounded-xl border border-white/15 bg-ink-900 px-3 text-[15px] text-ink-50"
          >
            <option value="team">Whole team</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.memberCount})
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-[13px] font-bold text-mist">
              Athletes ({selected.length} of {candidates.length})
            </label>
            <button
              type="button"
              className="text-[13px] font-semibold text-volt-300"
              onClick={() =>
                setSelected(
                  selected.length === candidates.length
                    ? []
                    : candidates.map((c) => c.userId),
                )
              }
            >
              {selected.length === candidates.length
                ? "Uncheck all"
                : "Check all"}
            </button>
          </div>
          <p className="mb-2 text-[12px] text-mist">
            Everyone is checked — uncheck anyone who wasn't there.
          </p>
          <div className="max-h-44 overflow-y-auto rounded-xl border border-white/10">
            {candidates.map((c) => (
              <label
                key={c.userId}
                className="flex cursor-pointer items-center gap-3 border-b border-white/5 px-3 py-2.5 last:border-0"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(c.userId)}
                  onChange={() => toggle(c.userId)}
                  className="h-5 w-5 accent-lime-400"
                />
                <span className="text-[15px] text-ink-50">
                  {c.displayName}
                </span>
              </label>
            ))}
            {candidates.length === 0 && (
              <p className="px-3 py-4 text-[13px] text-mist">
                No runners in this scope yet.
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="mb-1 block text-[13px] font-bold text-mist">
              Date &amp; time
            </label>
            <input
              type="datetime-local"
              value={startedAt}
              onChange={(e) => setStartedAt(e.target.value)}
              className="min-h-[48px] w-full rounded-xl border border-white/15 bg-ink-900 px-3 text-[15px] text-ink-50"
            />
          </div>
          <div>
            <label className="mb-1 block text-[13px] font-bold text-mist">
              Distance ({distanceUnitLabel(units)})
            </label>
            <input
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
              inputMode="decimal"
              placeholder="e.g. 5"
              className="min-h-[48px] w-full rounded-xl border border-white/15 bg-ink-900 px-3 text-[15px] text-ink-50"
            />
          </div>
          <div>
            <label className="mb-1 block text-[13px] font-bold text-mist">
              Duration
            </label>
            <input
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              inputMode="text"
              placeholder="e.g. 42:30"
              className="min-h-[48px] w-full rounded-xl border border-white/15 bg-ink-900 px-3 text-[15px] text-ink-50"
            />
          </div>
          <div className="col-span-2">
            <label className="mb-1 block text-[13px] font-bold text-mist">
              Title (optional)
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Tuesday tempo"
              maxLength={120}
              className="min-h-[48px] w-full rounded-xl border border-white/15 bg-ink-900 px-3 text-[15px] text-ink-50"
            />
          </div>
          <div className="col-span-2">
            <label className="mb-1 block text-[13px] font-bold text-mist">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Anything the team should know"
              className="w-full rounded-xl border border-white/15 bg-ink-900 px-3 py-2 text-[15px] text-ink-50"
            />
          </div>
        </div>

        {mutation.isError && (
          <p className="text-[13px] font-semibold text-red-300">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : mutation.error instanceof Error
                ? mutation.error.message
                : "Couldn't log the run."}
          </p>
        )}

        <Button
          onClick={() => mutation.mutate()}
          disabled={
            mutation.isPending ||
            selected.length === 0 ||
            (distance.trim() === "" && duration.trim() === "")
          }
        >
          {mutation.isPending
            ? "Logging…"
            : `Log run for ${selected.length} athlete${selected.length === 1 ? "" : "s"}`}
        </Button>
      </div>
    </Modal>
  );
}
