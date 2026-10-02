import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GoalDTO } from "@curvelo/shared";
import { api, ApiError } from "../../lib/api";
import { useUnits } from "../../lib/units";
import {
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  FullScreenLoader,
  Modal,
  Select,
  TextInput,
} from "../../components/ui";
import { PersonalGoalCard } from "./GoalsTab";

function CreateGoalDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const units = useUnits();
  const [kind, setKind] = useState<"DISTANCE" | "SESSIONS" | "STREAK">("DISTANCE");
  const [period, setPeriod] = useState<"WEEK" | "MONTH">("WEEK");
  const [target, setTarget] = useState("");
  const [recurring, setRecurring] = useState(true);
  const [share, setShare] = useState(false);
  const [feedTeamId, setFeedTeamId] = useState("");

  const teamsQuery = useQuery({
    queryKey: ["myTeams"],
    queryFn: () => api.listTeams(),
    enabled: open,
  });
  const teams = teamsQuery.data?.teams ?? [];

  const mutation = useMutation({
    mutationFn: () =>
      api.createGoal({
        kind,
        period,
        target: Number(target),
        recurring,
        shareOnComplete: share,
        feedTeamId: share && feedTeamId ? feedTeamId : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["myGoals"] });
      onClose();
      setTarget("");
    },
  });

  const targetLabel =
    kind === "DISTANCE"
      ? `Target (${units === "metric" ? "km" : "miles"})`
      : kind === "SESSIONS"
        ? "Target (runs)"
        : "Target (days)";

  return (
    <Modal open={open} onClose={onClose} title="New personal goal">
      <div className="space-y-4">
        {mutation.isError && (
          <ErrorBanner
            message={
              mutation.error instanceof ApiError
                ? mutation.error.message
                : "Couldn't create the goal."
            }
          />
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="DISTANCE">Distance</option>
              <option value="SESSIONS">Runs</option>
              <option value="STREAK">Day streak</option>
            </Select>
          </Field>
          <Field label="Every">
            <Select value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}>
              <option value="WEEK">Week</option>
              <option value="MONTH">Month</option>
            </Select>
          </Field>
        </div>
        <Field label={targetLabel}>
          <TextInput
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            inputMode="decimal"
            placeholder={kind === "DISTANCE" ? (units === "metric" ? "30" : "20") : kind === "SESSIONS" ? "4" : "14"}
          />
        </Field>
        <label className="flex items-center gap-2 text-[14px] text-ink-50">
          <input
            type="checkbox"
            checked={recurring}
            onChange={(e) => setRecurring(e.target.checked)}
            className="h-5 w-5 accent-lime-400"
          />
          Repeat every {period === "WEEK" ? "week" : "month"}
        </label>
        <label className="flex items-center gap-2 text-[14px] text-ink-50">
          <input
            type="checkbox"
            checked={share}
            onChange={(e) => setShare(e.target.checked)}
            className="h-5 w-5 accent-lime-400"
          />
          Celebrate in the team feed when I hit it
        </label>
        {share && (
          <Field label="Celebrate in">
            <Select value={feedTeamId} onChange={(e) => setFeedTeamId(e.target.value)}>
              <option value="">Choose a team…</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Button
          className="w-full"
          disabled={mutation.isPending || !Number(target) || (share && !feedTeamId)}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? "Creating…" : "Create goal"}
        </Button>
      </div>
    </Modal>
  );
}

export function MyGoalsSection() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const goalsQuery = useQuery({
    queryKey: ["myGoals"],
    queryFn: () => api.myGoals(),
  });
  const goals: GoalDTO[] = goalsQuery.data?.goals ?? [];

  const archiveMutation = useMutation({
    mutationFn: (goalId: string) => api.archiveGoal(goalId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["myGoals"] }),
  });

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[16px] font-extrabold text-ink-50">My goals</h3>
        <Button onClick={() => setCreateOpen(true)}>+ New goal</Button>
      </div>
      {goalsQuery.isLoading ? (
        <FullScreenLoader />
      ) : goalsQuery.isError ? (
        <ErrorBanner message="Couldn't load your goals." />
      ) : goals.length === 0 ? (
        <EmptyState
          title="No goals yet"
          body="Set a weekly mileage target, a run count, or a day streak — progress fills in automatically."
        />
      ) : (
        <div className="space-y-3">
          {goals.map((g) => (
            <PersonalGoalCard key={g.id} goal={g} onArchive={() => archiveMutation.mutate(g.id)} />
          ))}
        </div>
      )}
      <CreateGoalDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </Card>
  );
}
