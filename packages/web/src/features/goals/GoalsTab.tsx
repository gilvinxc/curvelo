import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GoalDTO, LeaderboardDTO } from "@curvelo/shared";
import { api, ApiError } from "../../lib/api";
import { formatDistance, useUnits } from "../../lib/units";
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

function goalTargetLabel(goal: GoalDTO, units: "metric" | "imperial"): string {
  if (goal.kind === "DISTANCE") {
    return formatDistance(goal.targetMeters ?? 0, units);
  }
  const n = goal.targetCount ?? 0;
  return goal.kind === "SESSIONS" ? `${n} sessions` : `${n}-day streak`;
}

function goalProgressLabel(goal: GoalDTO, units: "metric" | "imperial"): string {
  const target =
    goal.kind === "DISTANCE"
      ? formatDistance(goal.targetMeters ?? 0, units)
      : goalTargetLabel(goal, units);
  const done =
    goal.kind === "DISTANCE"
      ? formatDistance(Math.round(goal.progress), units)
      : `${Math.round(goal.progress)}`;
  return `${done} of ${target}`;
}

function GoalCard({
  goal,
  onArchive,
  canManage,
}: {
  goal: GoalDTO;
  onArchive?: () => void;
  canManage: boolean;
}) {
  const units = useUnits();
  const pct = Math.min(100, Math.round(Number(goal.progressLabel.replace("%", "")) || 0));
  const completed = goal.status === "COMPLETED";
  return (
    <Card className={completed ? "border-volt-400/50" : undefined}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-bold text-ink-50">
            {completed ? "🎉 " : ""}
            {goal.title ??
              (goal.kind === "DISTANCE"
                ? "Distance goal"
                : goal.kind === "SESSIONS"
                  ? "Sessions goal"
                  : "Streak goal")}
          </p>
          <p className="mt-0.5 text-[13px] text-mist">
            {goalProgressLabel(goal, units)}
            {goal.teamName ? ` · ${goal.teamName}` : ""}
          </p>
        </div>
        {canManage && onArchive && goal.status === "ACTIVE" && (
          <button
            onClick={onArchive}
            className="shrink-0 rounded-lg px-2 py-1 text-[13px] text-mist hover:text-ink-50"
          >
            End
          </button>
        )}
      </div>
      <div
        className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-full rounded-full transition-all ${completed ? "bg-volt-400" : "bg-volt-400/70"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1.5 text-[13px] font-semibold text-mist">
        {completed ? "Completed!" : `${pct}% complete`}
      </p>
    </Card>
  );
}

function CreateTeamGoalDialog({
  teamId,
  open,
  onClose,
}: {
  teamId: string;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const units = useUnits();
  const [kind, setKind] = useState<"DISTANCE" | "SESSIONS">("DISTANCE");
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [startAt, setStartAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [endAt, setEndAt] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });

  const mutation = useMutation({
    mutationFn: () =>
      api.createTeamGoal(teamId, {
        kind,
        title,
        target: Number(target),
        startAt: new Date(`${startAt}T00:00:00Z`).toISOString(),
        endAt: new Date(`${endAt}T00:00:00Z`).toISOString(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teamGoals", teamId] });
      onClose();
      setTitle("");
      setTarget("");
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="New team goal">
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
        <Field label="Goal">
          <TextInput
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="October mileage challenge"
            maxLength={80}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="DISTANCE">Total distance</option>
              <option value="SESSIONS">Total sessions</option>
            </Select>
          </Field>
          <Field label={kind === "DISTANCE" ? `Target (${units === "metric" ? "km" : "mi"})` : "Target (sessions)"}>
            <TextInput
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              inputMode="decimal"
              placeholder={kind === "DISTANCE" ? "400" : "100"}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts">
            <TextInput type="date" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
          </Field>
          <Field label="Ends">
            <TextInput type="date" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
          </Field>
        </div>
        <p className="text-[13px] text-mist">
          Only team-visible runs count. Everyone's efforts add up together.
        </p>
        <Button
          className="w-full"
          disabled={mutation.isPending || !title.trim() || !Number(target)}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? "Creating…" : "Create goal"}
        </Button>
      </div>
    </Modal>
  );
}

function LeaderboardCard({ teamId }: { teamId: string }) {
  const units = useUnits();
  const [metric, setMetric] = useState<"distance" | "sessions">("distance");
  const query = useQuery({
    queryKey: ["leaderboard", teamId, metric],
    queryFn: () => api.leaderboard(teamId, metric, 7),
  });
  const board: LeaderboardDTO | undefined = query.data?.leaderboard;

  const medal = ["🥇", "🥈", "🥉"];
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[16px] font-extrabold text-ink-50">This week's leaderboard</h3>
        <Select
          value={metric}
          onChange={(e) => setMetric(e.target.value as typeof metric)}
          aria-label="Leaderboard metric"
        >
          <option value="distance">Distance</option>
          <option value="sessions">Sessions</option>
        </Select>
      </div>
      {query.isLoading ? (
        <FullScreenLoader />
      ) : query.isError ? (
        <ErrorBanner message="Couldn't load the leaderboard." />
      ) : !board || board.entries.length === 0 ? (
        <EmptyState
          title="No runs yet this week"
          body="Log a team-visible run and you'll show up here."
        />
      ) : (
        <ol className="divide-y divide-white/5">
          {board.entries.map((e) => (
            <li key={e.userId} className="flex items-center gap-3 py-2.5">
              <span className="w-8 text-center text-[18px]">
                {e.rank <= 3 ? medal[e.rank - 1] : <span className="text-[14px] text-mist">{e.rank}</span>}
              </span>
              <span className="flex-1 truncate font-semibold text-ink-50">{e.displayName}</span>
              <span className="text-[14px] font-bold text-mist">
                {metric === "distance"
                  ? formatDistance(Math.round(e.value), units)
                  : `${Math.round(e.value)} runs`}
              </span>
            </li>
          ))}
        </ol>
      )}
      {board && board.myRank !== null && board.myRank > 10 && (
        <p className="mt-2 text-[13px] text-mist">You're ranked #{board.myRank} this week. Keep going!</p>
      )}
      <p className="mt-3 text-[12px] text-mist">
        Team-visible runs only. Effort counts — streaks and consistency beat speed here.
      </p>
    </Card>
  );
}

export function GoalsTab({
  teamId,
  canManage,
}: {
  teamId: string;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const goalsQuery = useQuery({
    queryKey: ["teamGoals", teamId],
    queryFn: () => api.teamGoals(teamId),
  });
  const goals: GoalDTO[] = goalsQuery.data?.goals ?? [];

  const archiveMutation = useMutation({
    mutationFn: (goalId: string) => api.archiveTeamGoal(teamId, goalId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["teamGoals", teamId] }),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-[16px] font-extrabold text-ink-50">Team goals</h3>
        {canManage && <Button onClick={() => setCreateOpen(true)}>+ New goal</Button>}
      </div>

      {goalsQuery.isLoading ? (
        <FullScreenLoader />
      ) : goalsQuery.isError ? (
        <ErrorBanner message="Couldn't load team goals." />
      ) : goals.length === 0 ? (
        <EmptyState
          title="No team goals yet"
          body="Coaches can set a collective challenge — total miles, total sessions — and the whole team chips in."
        />
      ) : (
        <div className="space-y-3">
          {goals.map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              canManage={canManage}
              onArchive={() => archiveMutation.mutate(g.id)}
            />
          ))}
        </div>
      )}

      <LeaderboardCard teamId={teamId} />

      <CreateTeamGoalDialog teamId={teamId} open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

/** Shared personal-goal card (also used on the training log). */
export function PersonalGoalCard({
  goal,
  onArchive,
}: {
  goal: GoalDTO;
  onArchive?: () => void;
}) {
  return <GoalCard goal={goal} canManage={!!onArchive} onArchive={onArchive} />;
}
