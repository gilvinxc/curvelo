import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../lib/api";
import {
  Button,
  Card,
  ErrorBanner,
  Field,
  Select,
  TextArea,
  TextInput,
} from "../../components/ui";
import { todayYMD } from "../../lib/workoutFormat";
import type {
  ApplyTrainingPlanInput,
  CreateTrainingPlanInput,
  TrainingPlanDTO,
} from "@curvelo/shared";

const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

type Target = "team" | "group" | "athlete";

function nextMondayYMD(): string {
  const d = new Date();
  const diff = (8 - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[13px] font-black uppercase tracking-[0.14em] text-mist">
      {children}
    </h3>
  );
}

function TargetPicker({
  teamId,
  target,
  setTarget,
  groupId,
  setGroupId,
  athleteId,
  setAthleteId,
}: {
  teamId: string;
  target: Target;
  setTarget: (t: Target) => void;
  groupId: string;
  setGroupId: (v: string) => void;
  athleteId: string;
  setAthleteId: (v: string) => void;
}) {
  const groupsQuery = useQuery({
    queryKey: ["groups", teamId],
    queryFn: () => api.listGroups(teamId),
  });
  const rosterQuery = useQuery({
    queryKey: ["roster", teamId],
    queryFn: () => api.getRoster(teamId),
  });
  const groups = groupsQuery.data?.groups ?? [];
  const athletes = (rosterQuery.data?.roster ?? []).filter(
    (m) => m.role === "RUNNER",
  );
  return (
    <>
      <Field label="Assign to">
        <Select
          value={target}
          onChange={(e) => setTarget(e.target.value as Target)}
        >
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
          <Select
            value={athleteId}
            onChange={(e) => setAthleteId(e.target.value)}
          >
            <option value="">Choose an athlete…</option>
            {athletes.map((a) => (
              <option key={a.userId} value={a.userId}>
                {a.displayName}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </>
  );
}

/** Single-session planner: schedule now, optionally announce to the feed. */
function PlanSessionForm({ teamId }: { teamId: string }) {
  const queryClient = useQueryClient();
  const [workoutId, setWorkoutId] = useState("");
  const [date, setDate] = useState(todayYMD());
  const [target, setTarget] = useState<Target>("team");
  const [groupId, setGroupId] = useState("");
  const [athleteId, setAthleteId] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const workoutsQuery = useQuery({
    queryKey: ["workouts", teamId],
    queryFn: () => api.listWorkouts(teamId),
  });
  const workouts = workoutsQuery.data?.workouts ?? [];

  const mutation = useMutation({
    mutationFn: (announce: boolean) =>
      api.createPracticePlan(teamId, {
        workoutId,
        ...(target === "group" && groupId ? { groupId } : {}),
        ...(target === "athlete" && athleteId
          ? { assignedToUserId: athleteId }
          : {}),
        scheduledDate: date,
        notes: notes.trim() || undefined,
        announce,
      }),
    onSuccess: (res, announce) => {
      setDone(
        announce && res.postId
          ? "Scheduled and announced to the team feed."
          : "Session scheduled.",
      );
      setError(null);
      setNotes("");
      queryClient.invalidateQueries({ queryKey: ["teamCalendar", teamId] });
      queryClient.invalidateQueries({ queryKey: ["myCalendar"] });
      queryClient.invalidateQueries({ queryKey: ["feed", teamId] });
    },
    onError: (err) => {
      setDone(null);
      setError(
        err instanceof ApiError
          ? err.message
          : "Couldn't schedule that session.",
      );
    },
  });

  const canSave =
    workoutId && date.length === 10 && !mutation.isPending &&
    (target === "team" ||
      (target === "group" && groupId) ||
      (target === "athlete" && athleteId));

  return (
    <Card>
      <SectionTitle>Plan a session</SectionTitle>
      <div className="mt-3 flex flex-col gap-3">
        {error && <ErrorBanner message={error} />}
        {done && (
          <p className="rounded-xl border border-volt-400/30 bg-volt-400/10 p-3 text-[13px] text-volt-200">
            {done}
          </p>
        )}
        <Field label="Workout">
          <Select value={workoutId} onChange={(e) => setWorkoutId(e.target.value)}>
            <option value="">Choose a workout…</option>
            {workouts.map((w) => (
              <option key={w.id} value={w.id}>
                {w.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date">
          <TextInput
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <TargetPicker
          teamId={teamId}
          target={target}
          setTarget={setTarget}
          groupId={groupId}
          setGroupId={setGroupId}
          athleteId={athleteId}
          setAthleteId={setAthleteId}
        />
        <Field label="Note for athletes (optional)">
          <TextArea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="e.g. Bring spikes, meet at the track"
          />
        </Field>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            onClick={() => mutation.mutate(false)}
            disabled={!canSave}
            className="min-h-[48px] flex-1"
          >
            {mutation.isPending ? "Scheduling…" : "Schedule"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => mutation.mutate(true)}
            disabled={!canSave}
            className="min-h-[48px] flex-1"
          >
            📣 Schedule & announce
          </Button>
        </div>
      </div>
    </Card>
  );
}

interface DayRow {
  key: number;
  dayOfWeek: number;
  workoutId: string;
  target: Target;
  groupId: string;
  athleteId: string;
  notes: string;
}

/** Week-template builder + applier. */
function TemplatesSection({ teamId }: { teamId: string }) {
  const queryClient = useQueryClient();
  const [showBuilder, setShowBuilder] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rows, setRows] = useState<DayRow[]>([]);
  const [rowKey, setRowKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState(nextMondayYMD());

  const plansQuery = useQuery({
    queryKey: ["trainingPlans", teamId],
    queryFn: () => api.listTrainingPlans(teamId),
  });
  const workoutsQuery = useQuery({
    queryKey: ["workouts", teamId],
    queryFn: () => api.listWorkouts(teamId),
  });
  const plans = plansQuery.data?.plans ?? [];
  const workouts = workoutsQuery.data?.workouts ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["trainingPlans", teamId] });
    queryClient.invalidateQueries({ queryKey: ["teamCalendar", teamId] });
    queryClient.invalidateQueries({ queryKey: ["myCalendar"] });
    queryClient.invalidateQueries({ queryKey: ["feed", teamId] });
  };

  const createMutation = useMutation({
    mutationFn: () => {
      const input: CreateTrainingPlanInput = {
        name: name.trim(),
        description: description.trim() || undefined,
        days: rows.map((r) => ({
          dayOfWeek: r.dayOfWeek,
          workoutId: r.workoutId,
          ...(r.target === "group" && r.groupId ? { groupId: r.groupId } : {}),
          ...(r.target === "athlete" && r.athleteId
            ? { assignedToUserId: r.athleteId }
            : {}),
          notes: r.notes.trim() || undefined,
        })),
      };
      return api.createTrainingPlan(teamId, input);
    },
    onSuccess: () => {
      setShowBuilder(false);
      setName("");
      setDescription("");
      setRows([]);
      setError(null);
      invalidate();
    },
    onError: (err) =>
      setError(
        err instanceof ApiError ? err.message : "Couldn't save the template.",
      ),
  });

  const deleteMutation = useMutation({
    mutationFn: (planId: string) => api.deleteTrainingPlan(teamId, planId),
    onSuccess: invalidate,
  });

  const applyMutation = useMutation({
    mutationFn: ({
      planId,
      announce,
    }: {
      planId: string;
      announce: boolean;
    }) => {
      const input: ApplyTrainingPlanInput = {
        weekStart,
        announce,
      };
      return api.applyTrainingPlan(teamId, planId, input);
    },
    onSuccess: (res, { announce }) => {
      setApplying(null);
      setError(null);
      invalidate();
      alert(
        announce && res.postId
          ? `Applied ${res.assignments.length} sessions and announced to the feed.`
          : `Applied ${res.assignments.length} sessions.`,
      );
    },
    onError: (err) => {
      setApplying(null);
      setError(
        err instanceof ApiError ? err.message : "Couldn't apply the template.",
      );
    },
  });

  const addRow = () => {
    setRows((rs) => [
      ...rs,
      {
        key: rowKey,
        dayOfWeek: 0,
        workoutId: "",
        target: "team" as Target,
        groupId: "",
        athleteId: "",
        notes: "",
      },
    ]);
    setRowKey((k) => k + 1);
  };

  const updateRow = (key: number, patch: Partial<DayRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const builderValid =
    name.trim().length > 0 &&
    rows.length > 0 &&
    rows.every(
      (r) =>
        r.workoutId &&
        (r.target === "team" ||
          (r.target === "group" && r.groupId) ||
          (r.target === "athlete" && r.athleteId)),
    );

  return (
    <Card>
      <div className="flex items-center justify-between">
        <SectionTitle>Week templates</SectionTitle>
        <Button
          variant="secondary"
          onClick={() => {
            setShowBuilder((s) => !s);
            setError(null);
          }}
          className="min-h-[44px] px-4 text-[13px]"
        >
          {showBuilder ? "Cancel" : "＋ New template"}
        </Button>
      </div>
      <p className="mt-1 text-[13px] text-mist">
        Save a reusable week (e.g. “Base week”, “Race week”), then apply it to
        any Monday.
      </p>

      {error && (
        <div className="mt-3">
          <ErrorBanner message={error} />
        </div>
      )}

      {showBuilder && (
        <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <Field label="Template name">
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="Base week"
            />
          </Field>
          <Field label="Description (optional)">
            <TextInput
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
            />
          </Field>
          {rows.map((r) => (
            <div
              key={r.key}
              className="flex flex-col gap-2 rounded-xl border border-white/10 p-3"
            >
              <div className="flex items-center justify-between">
                <Select
                  value={r.dayOfWeek}
                  onChange={(e) =>
                    updateRow(r.key, { dayOfWeek: Number(e.target.value) })
                  }
                  className="w-auto"
                  aria-label="Day of week"
                >
                  {DAY_NAMES.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </Select>
                <button
                  type="button"
                  onClick={() =>
                    setRows((rs) => rs.filter((x) => x.key !== r.key))
                  }
                  className="text-[13px] text-mist hover:text-red-300"
                >
                  Remove
                </button>
              </div>
              <Select
                value={r.workoutId}
                onChange={(e) => updateRow(r.key, { workoutId: e.target.value })}
                aria-label="Workout"
              >
                <option value="">Choose a workout…</option>
                {workouts.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.title}
                  </option>
                ))}
              </Select>
              <TargetPicker
                teamId={teamId}
                target={r.target}
                setTarget={(t) => updateRow(r.key, { target: t })}
                groupId={r.groupId}
                setGroupId={(v) => updateRow(r.key, { groupId: v })}
                athleteId={r.athleteId}
                setAthleteId={(v) => updateRow(r.key, { athleteId: v })}
              />
              <TextInput
                value={r.notes}
                onChange={(e) => updateRow(r.key, { notes: e.target.value })}
                placeholder="Note (optional)"
                maxLength={1000}
              />
            </div>
          ))}
          <Button variant="secondary" onClick={addRow} className="min-h-[44px]">
            ＋ Add a day
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!builderValid || createMutation.isPending}
            className="min-h-[48px]"
          >
            {createMutation.isPending ? "Saving…" : "Save template"}
          </Button>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3">
        {plansQuery.isLoading && (
          <p className="text-[13px] text-mist">Loading templates…</p>
        )}
        {plans.map((plan: TrainingPlanDTO) => (
          <div
            key={plan.id}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[15px] font-bold text-ink-50">{plan.name}</p>
                {plan.description && (
                  <p className="mt-0.5 text-[13px] text-mist">
                    {plan.description}
                  </p>
                )}
                <ul className="mt-2 flex flex-col gap-1">
                  {plan.days.map((d) => (
                    <li key={d.id} className="text-[13px] text-mist">
                      <span className="font-semibold text-ink-100">
                        {DAY_NAMES[d.dayOfWeek]}
                      </span>
                      {" — "}
                      {d.workoutTitle}
                      {d.groupName && ` (${d.groupName})`}
                      {d.assignedToName && ` — ${d.assignedToName}`}
                    </li>
                  ))}
                </ul>
              </div>
              <button
                type="button"
                onClick={() => deleteMutation.mutate(plan.id)}
                className="shrink-0 text-[13px] text-mist hover:text-red-300"
              >
                Delete
              </button>
            </div>
            {applying === plan.id ? (
              <div className="mt-3 flex flex-col gap-2 rounded-xl border border-white/10 p-3">
                <Field label="Apply to the week of (Monday)">
                  <TextInput
                    type="date"
                    value={weekStart}
                    onChange={(e) => setWeekStart(e.target.value)}
                  />
                </Field>
                <div className="flex gap-2">
                  <Button
                    onClick={() =>
                      applyMutation.mutate({ planId: plan.id, announce: false })
                    }
                    disabled={applyMutation.isPending}
                    className="min-h-[44px] flex-1 text-[13px]"
                  >
                    Apply
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      applyMutation.mutate({ planId: plan.id, announce: true })
                    }
                    disabled={applyMutation.isPending}
                    className="min-h-[44px] flex-1 text-[13px]"
                  >
                    📣 Apply & announce
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setApplying(null)}
                    className="min-h-[44px] px-4 text-[13px]"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="secondary"
                onClick={() => {
                  setWeekStart(nextMondayYMD());
                  setApplying(plan.id);
                }}
                className="mt-3 min-h-[44px] w-full text-[13px]"
              >
                Apply to a week…
              </Button>
            )}
          </div>
        ))}
        {!plansQuery.isLoading && plans.length === 0 && !showBuilder && (
          <p className="text-[13px] text-mist">
            No templates yet. Create one to reuse a training week.
          </p>
        )}
      </div>
    </Card>
  );
}

/** Upcoming planned sessions with cancel. */
function UpcomingSessions({ teamId }: { teamId: string }) {
  const queryClient = useQueryClient();
  const from = todayYMD();
  const toDate = new Date();
  toDate.setDate(toDate.getDate() + 60);
  const to = toDate.toISOString().slice(0, 10);

  const calQuery = useQuery({
    queryKey: ["teamCalendar", teamId, "planner"],
    queryFn: () => api.teamCalendar(teamId, from, to),
  });
  const sessions = useMemo(
    () =>
      (calQuery.data?.assignments ?? [])
        .filter((a) => a.scheduledDate >= from)
        .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate)),
    [calQuery.data, from],
  );

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteAssignment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teamCalendar"] });
      queryClient.invalidateQueries({ queryKey: ["myCalendar"] });
    },
  });

  if (sessions.length === 0) return null;

  return (
    <Card>
      <SectionTitle>Upcoming planned sessions</SectionTitle>
      <ul className="mt-3 flex flex-col gap-2">
        {sessions.map((a) => (
          <li
            key={a.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold text-ink-50">
                {a.workoutTitle}
              </p>
              <p className="text-[12px] text-mist">
                {a.scheduledDate}
                {a.groupName && ` · ${a.groupName}`}
                {a.assignedToName && ` · ${a.assignedToName}`}
                {!a.groupName && !a.assignedToName && " · Whole team"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => deleteMutation.mutate(a.id)}
              className="shrink-0 rounded-lg px-3 py-2 text-[13px] text-mist hover:text-red-300"
            >
              Cancel
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function PracticePlanner({ teamId }: { teamId: string }) {
  return (
    <div className="flex flex-col gap-4">
      <PlanSessionForm teamId={teamId} />
      <TemplatesSection teamId={teamId} />
      <UpcomingSessions teamId={teamId} />
    </div>
  );
}
