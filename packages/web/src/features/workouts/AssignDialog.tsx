import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../lib/api";
import {
  Button,
  ErrorBanner,
  Field,
  Modal,
  Select,
  TextArea,
  TextInput,
} from "../../components/ui";
import { todayYMD } from "../../lib/workoutFormat";

type Target = "team" | "group" | "athlete";

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
  const [date, setDate] = useState(todayYMD());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setTarget("team");
      setDate(todayYMD());
      setNotes("");
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

  const mutation = useMutation({
    mutationFn: () =>
      api.createAssignment(teamId, {
        workoutId,
        ...(target === "group" && groupId ? { groupId } : {}),
        ...(target === "athlete" && athleteId ? { assignedToUserId: athleteId } : {}),
        scheduledDate: date,
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teamCalendar", teamId] });
      queryClient.invalidateQueries({ queryKey: ["myCalendar"] });
      onClose();
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
    (target === "team" || (target === "group" && groupId) || (target === "athlete" && athleteId));

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

        <Button
          onClick={() => {
            setError(null);
            mutation.mutate();
          }}
          disabled={!canSave}
          loading={mutation.isPending}
        >
          Assign workout
        </Button>
      </div>
    </Modal>
  );
}
