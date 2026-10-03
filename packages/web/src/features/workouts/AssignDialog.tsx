import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../lib/api";
import {
  Avatar,
  Button,
  ErrorBanner,
  Field,
  Modal,
  Select,
  TextArea,
  TextInput,
} from "../../components/ui";
import { todayYMD } from "../../lib/workoutFormat";

type Target = "team" | "group" | "athlete" | "bulk";

export function AssignDialog({
  teamId,
  workoutId,
  workoutTitle,
  open,
  onClose,
}: {
  teamId: string;
  workoutId: string;
  workoutTitle: string;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<Target>("team");
  const [groupId, setGroupId] = useState("");
  const [athleteId, setAthleteId] = useState("");
  const [bulkIds, setBulkIds] = useState<Set<string>>(new Set());
  const [bulkGroupFilter, setBulkGroupFilter] = useState("");
  const [date, setDate] = useState(todayYMD());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setTarget("team");
      setDate(todayYMD());
      setNotes("");
      setBulkIds(new Set());
      setBulkGroupFilter("");
    }
  }, [open, workoutId]);

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
  const athletes = (rosterQuery.data?.roster ?? []).filter(
    (m) => m.role === "RUNNER",
  );
  const [bulkGroupMembers, setBulkGroupMembers] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!open || !bulkGroupFilter) {
      setBulkGroupMembers(null);
      return;
    }
    api.getGroup(bulkGroupFilter).then(
      (res) => setBulkGroupMembers(new Set((res.group.members ?? []).map((m) => m.userId))),
      () => setBulkGroupMembers(new Set()),
    );
  }, [open, bulkGroupFilter]);
  const bulkAthletes = bulkGroupMembers
    ? athletes.filter((a) => bulkGroupMembers.has(a.userId))
    : athletes;
  const toggleBulk = (userId: string) =>
    setBulkIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  const bulkAllVisible = bulkAthletes.every((a) => bulkIds.has(a.userId));

  const [bulkResult, setBulkResult] = useState<string | null>(null);
  type AssignResult =
    | { kind: "single"; assignment: unknown }
    | { kind: "bulk"; created: number; skipped: Array<{ athleteId: string; reason: string }> };
  const mutation = useMutation({
    mutationFn: async (): Promise<AssignResult> => {
      if (target === "bulk") {
        const r = await api.bulkAssign(teamId, {
          workoutId,
          athleteIds: [...bulkIds],
          scheduledDate: date,
          notes: notes.trim() || undefined,
        });
        return { kind: "bulk", ...r };
      }
      const r = await api.createAssignment(teamId, {
            workoutId,
            ...(target === "group" && groupId ? { groupId } : {}),
            ...(target === "athlete" && athleteId ? { assignedToUserId: athleteId } : {}),
            scheduledDate: date,
            notes: notes.trim() || undefined,
          });
        return { kind: "single", ...r };
      },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["teamCalendar", teamId] });
      queryClient.invalidateQueries({ queryKey: ["myCalendar"] });
      if (result.kind === "bulk") {
        const skipped = result.skipped.length;
        setBulkResult(
          `Assigned to ${result.created} athlete${result.created === 1 ? "" : "s"}` +
            (skipped > 0 ? ` — ${skipped} skipped` : ""),
        );
      } else {
        onClose();
      }
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 403) {
        setError(
          err.message ||
            "This assignment is blocked by the team's compliance policy.",
        );
      } else {
        setError(err instanceof Error ? err.message : "Couldn't assign the workout.");
      }
    },
  });

  const canSave =
    date.length === 10 &&
    (target === "team" ||
      (target === "group" && groupId) ||
      (target === "athlete" && athleteId) ||
      (target === "bulk" && bulkIds.size > 0));

  return (
    <Modal open={open} onClose={onClose} title={`Assign "${workoutTitle}"`}>
      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      <div className="flex flex-col gap-4">
        <Field label="Assign to">
          <Select value={target} onChange={(e) => setTarget(e.target.value as Target)}>
            <option value="team">Whole team</option>
            <option value="group">A group</option>
            <option value="athlete">An athlete</option>
            <option value="bulk">Multiple athletes</option>
          </Select>
        </Field>

        {target === "group" && (
          <Field label="Group">
            <Select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">Choose a group…</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.memberCount})
                </option>
              ))}
            </Select>
          </Field>
        )}

        {target === "athlete" && (
          <Field label="Athlete">
            <Select value={athleteId} onChange={(e) => setAthleteId(e.target.value)}>
              <option value="">Choose an athlete…</option>
              {athletes.map((a) => (
                <option key={a.userId} value={a.userId}>
                  {a.displayName}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {target === "bulk" && (
          <>
            <Field label="Filter by group">
              <Select value={bulkGroupFilter} onChange={(e) => setBulkGroupFilter(e.target.value)}>
                <option value="">All athletes</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.memberCount})
                  </option>
                ))}
              </Select>
            </Field>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[13px] font-semibold uppercase tracking-wide text-mist">
                  Athletes ({bulkIds.size} selected)
                </p>
                <button
                  type="button"
                  className="text-[13px] font-semibold text-lime-300"
                  onClick={() =>
                    setBulkIds(
                      bulkAllVisible ? new Set() : new Set(bulkAthletes.map((a) => a.userId)),
                    )
                  }
                >
                  {bulkAllVisible ? "Clear all" : "Select all"}
                </button>
              </div>
              <div className="flex max-h-[40vh] flex-col gap-1.5 overflow-y-auto">
                {bulkAthletes.map((a) => (
                  <label
                    key={a.userId}
                    className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-ink-800 px-3 py-2.5"
                  >
                    <input
                      type="checkbox"
                      checked={bulkIds.has(a.userId)}
                      onChange={() => toggleBulk(a.userId)}
                      className="h-5 w-5 shrink-0 accent-[#c8f542]"
                    />
                    <Avatar name={a.displayName} size="sm" />
                    <p className="min-w-0 flex-1 truncate text-[15px] font-semibold">
                      {a.displayName}
                    </p>
                  </label>
                ))}
                {bulkAthletes.length === 0 && (
                  <p className="text-[14px] text-mist">No athletes match this filter.</p>
                )}
              </div>
            </div>
          </>
        )}

        <Field label="Date">
          <TextInput
            type="date"
            value={date}
            min={todayYMD()}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>

        <Field label="Notes" hint="Optional — shown to the athletes.">
          <TextArea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Easy effort, focus on form…"
            maxLength={1000}
          />
        </Field>

        {bulkResult ? (
          <div className="flex flex-col gap-3">
            <p className="rounded-xl bg-lime-400/10 px-4 py-3 text-[15px] font-semibold text-lime-200">
              {bulkResult}
            </p>
            <Button onClick={onClose}>Done</Button>
          </div>
        ) : (
          <Button
            onClick={() => {
              setError(null);
              setBulkResult(null);
              mutation.mutate();
            }}
            disabled={!canSave}
            loading={mutation.isPending}
          >
            {target === "bulk"
              ? `Assign to ${bulkIds.size} athlete${bulkIds.size === 1 ? "" : "s"}`
              : "Assign workout"}
          </Button>
        )}
      </div>
    </Modal>
  );
}
