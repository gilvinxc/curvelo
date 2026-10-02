import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { WORKOUT_KINDS, WORKOUT_STEP_KINDS } from "@curvelo/shared";
import { api, ApiError, type WorkoutStepPayload } from "../../lib/api";
import {
  Button,
  Card,
  ErrorBanner,
  Field,
  FullScreenLoader,
  PageHeader,
  Select,
  TextArea,
  TextInput,
} from "../../components/ui";
import {
  formatDurationS,
  stepKindLabel,
  stepSummary,
  workoutKindLabel,
} from "../../lib/workoutFormat";
import {
  distanceUnitLabel,
  formatPaceInput,
  fromMeters,
  parseDurationInput,
  parsePaceToSecPerKm,
  toMeters,
  useUnits,
  type Units,
} from "../../lib/units";

let localIdCounter = 0;
const nextLocalId = () => `step-${Date.now()}-${localIdCounter++}`;

interface StepDraft {
  localId: string;
  kind: string;
  distance: string;
  duration: string;
  pace: string;
  hrBpm: string;
  rpe: string;
  repetitions: string;
  notes: string;
}

function blankStep(kind = "STEADY"): StepDraft {
  return {
    localId: nextLocalId(),
    kind,
    distance: "",
    duration: "",
    pace: "",
    hrBpm: "",
    rpe: "",
    repetitions: "1",
    notes: "",
  };
}

function parsePositive(raw: string): number | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

/** Format a number for an input: up to 2 decimals, no trailing zeros. */
function trimNum(n: number): string {
  return String(parseFloat(n.toFixed(2)));
}

function toPayload(s: StepDraft, units: Units): WorkoutStepPayload {
  const distance = parsePositive(s.distance);
  const durationS = parseDurationInput(s.duration);
  const pace = parsePaceToSecPerKm(s.pace, units);
  const hr = parsePositive(s.hrBpm);
  const rpeRaw = s.rpe.trim();
  const repsRaw = s.repetitions.trim();
  return {
    kind: s.kind,
    ...(distance ? { distanceM: Math.round(toMeters(distance, units)) } : {}),
    ...(durationS ? { durationS } : {}),
    ...(pace ? { targetPaceS: pace } : {}),
    ...(hr ? { targetHrBpm: Math.round(hr) } : {}),
    ...(rpeRaw ? { targetRpe: Number(rpeRaw) } : {}),
    repetitions: repsRaw ? Number(repsRaw) : 1,
    ...(s.notes.trim() ? { notes: s.notes.trim() } : {}),
  };
}

function previewSummary(s: StepDraft, units: Units): string {
  const p = toPayload(s, units);
  return stepSummary({
    kind: p.kind,
    distanceM: p.distanceM ?? null,
    durationS: p.durationS ?? null,
    targetPaceS: p.targetPaceS ?? null,
    targetHrBpm: p.targetHrBpm ?? null,
    targetRpe: p.targetRpe ?? null,
    repetitions: Number.isFinite(p.repetitions) && p.repetitions! >= 1 ? p.repetitions! : 1,
  });
}

interface StepFieldErrors {
  distance?: string;
  numbers?: string;
}

function validateStep(s: StepDraft, units: Units): StepFieldErrors {
  const errors: StepFieldErrors = {};
  const p = toPayload(s, units);
  if (p.distanceM === undefined && p.durationS === undefined && s.kind !== "REST") {
    errors.distance = "Needs a distance or duration (REST steps excepted).";
  }
  const bad: string[] = [];
  if (Number.isNaN(p.distanceM)) bad.push("distance");
  if (Number.isNaN(parseDurationInput(s.duration))) bad.push("duration (mm:ss)");
  if (s.pace.trim() && parsePaceToSecPerKm(s.pace, units) === undefined)
    bad.push("pace (try 3:20)");
  if (Number.isNaN(p.targetHrBpm)) bad.push("heart rate");
  const rpeRaw = s.rpe.trim();
  if (rpeRaw && (!Number.isInteger(Number(rpeRaw)) || Number(rpeRaw) < 1 || Number(rpeRaw) > 10))
    bad.push("RPE (1–10)");
  const repsRaw = s.repetitions.trim();
  if (repsRaw && (!Number.isInteger(Number(repsRaw)) || Number(repsRaw) < 1 || Number(repsRaw) > 100))
    bad.push("repetitions (1–100)");
  if (bad.length > 0) errors.numbers = `Check: ${bad.join(", ")}.`;
  return errors;
}

export function WorkoutBuilderPage({ mode }: { mode: "create" | "edit" }) {
  const params = useParams<{ id?: string; workoutId?: string }>();
  const teamId = params.id; // create mode: team id from /teams/:id/workouts/new
  const workoutId = mode === "edit" ? params.workoutId : undefined;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const units = useUnits();
  const distUnit = distanceUnitLabel(units);

  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<string>("CUSTOM");
  const [description, setDescription] = useState("");
  const [isTemplate, setIsTemplate] = useState(false);
  const [steps, setSteps] = useState<StepDraft[]>([blankStep()]);
  const [stepErrors, setStepErrors] = useState<Record<string, StepFieldErrors>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(mode === "create");

  const editQuery = useQuery({
    queryKey: ["workout", workoutId],
    queryFn: () => api.getWorkout(workoutId!),
    enabled: mode === "edit" && !!workoutId,
  });

  // Prefill from the existing workout in edit mode.
  useEffect(() => {
    if (mode !== "edit" || hydrated) return;
    const w = editQuery.data?.workout;
    if (!w) return;
    setTitle(w.title);
    setKind(w.kind);
    setDescription(w.description ?? "");
    setIsTemplate(w.isTemplate);
    setSteps(
      w.steps.map((s) => ({
        localId: nextLocalId(),
        kind: s.kind,
        distance: s.distanceM != null ? trimNum(fromMeters(s.distanceM, units)) : "",
        duration: s.durationS != null ? formatDurationS(s.durationS) : "",
        pace: s.targetPaceS != null ? formatPaceInput(s.targetPaceS, units) : "",
        hrBpm: s.targetHrBpm != null ? String(s.targetHrBpm) : "",
        rpe: s.targetRpe != null ? String(s.targetRpe) : "",
        repetitions: String(s.repetitions),
        notes: s.notes ?? "",
      })),
    );
    setHydrated(true);
  }, [mode, hydrated, editQuery.data]);

  const mutation = useMutation({
    mutationFn: async () => {
      const errs: Record<string, StepFieldErrors> = {};
      steps.forEach((s) => {
        const e = validateStep(s, units);
        if (e.distance || e.numbers) errs[s.localId] = e;
      });
      const t = title.trim();
      if (t.length < 2) throw new Error("Give the workout a title (at least 2 characters).");
      if (steps.length === 0) throw new Error("Add at least one step.");
      if (Object.keys(errs).length > 0) {
        setStepErrors(errs);
        throw new Error("Fix the highlighted steps before saving.");
      }
      setStepErrors({});
      const payloadSteps = steps.map((s) => toPayload(s, units));
      if (mode === "create") {
        return (
          await api.createWorkout(teamId!, {
            title: t,
            description: description.trim() || undefined,
            kind,
            isTemplate,
            steps: payloadSteps,
          })
        ).workout;
      }
      return (
        await api.updateWorkout(workoutId!, {
          title: t,
          description: description.trim() ? description.trim() : null,
          kind,
          isTemplate,
          steps: payloadSteps,
        })
      ).workout;
    },
    onSuccess: (workout) => {
      queryClient.invalidateQueries({ queryKey: ["workouts"] });
      queryClient.invalidateQueries({ queryKey: ["workout", workout.id] });
      navigate(`/workouts/${workout.id}`);
    },
    onError: (err) => {
      if (err instanceof ApiError) setFormError(err.message);
      else setFormError(err instanceof Error ? err.message : "Couldn't save the workout.");
    },
  });

  const updateStep = (localId: string, patch: Partial<StepDraft>) =>
    setSteps((prev) => prev.map((s) => (s.localId === localId ? { ...s, ...patch } : s)));

  const removeStep = (localId: string) =>
    setSteps((prev) => prev.filter((s) => s.localId !== localId));

  const moveStep = (localId: string, dir: -1 | 1) =>
    setSteps((prev) => {
      const i = prev.findIndex((s) => s.localId === localId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  if (mode === "edit" && (editQuery.isLoading || !hydrated)) {
    return <FullScreenLoader />;
  }
  if (mode === "edit" && (editQuery.isError || !editQuery.data)) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Edit workout" backTo="/dashboard" />
        <ErrorBanner message="Couldn't load this workout." />
      </div>
    );
  }

  const teamBack = mode === "create" ? `/teams/${teamId}/workouts` : `/workouts/${workoutId}`;

  return (
    <div>
      <PageHeader
        title={mode === "create" ? "New workout" : "Edit workout"}
        backTo={teamBack}
      />

      {formError && (
        <div className="mb-4">
          <ErrorBanner message={formError} />
        </div>
      )}

      <div className="flex flex-col gap-5">
        <Card>
          <div className="flex flex-col gap-4">
            <Field label="Title">
              <TextInput
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Tuesday intervals"
                maxLength={120}
              />
            </Field>
            <Field label="Workout type">
              <Select value={kind} onChange={(e) => setKind(e.target.value)}>
                {WORKOUT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {workoutKindLabel(k)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Description" hint="Optional — tell athletes what this is for.">
              <TextArea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Aerobic capacity session…"
                maxLength={2000}
              />
            </Field>
            <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-white/10 bg-ink-800 px-4 py-3">
              <span>
                <span className="block text-[15px] font-semibold">
                  Reusable template
                </span>
                <span className="block text-[13px] text-mist">
                  Save as a template to reuse across weeks and seasons.
                </span>
              </span>
              <input
                type="checkbox"
                checked={isTemplate}
                onChange={(e) => setIsTemplate(e.target.checked)}
                className="h-6 w-6 shrink-0 accent-[#c8f542]"
              />
            </label>
          </div>
        </Card>

        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-bold uppercase tracking-[0.18em] text-mist">
            Steps ({steps.length})
          </h2>
          <Button
            variant="secondary"
            className="min-h-[44px] px-4 text-[14px]"
            onClick={() => setSteps((prev) => [...prev, blankStep()])}
          >
            + Add step
          </Button>
        </div>

        {steps.map((step, i) => {
          const errs = stepErrors[step.localId];
          return (
            <Card key={step.localId} className="border-l-4 border-l-volt-400/60">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-volt-400/15 text-[13px] font-bold text-volt-300">
                    {i + 1}
                  </span>
                  <p className="text-[15px] font-bold">{previewSummary(step, units)}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    aria-label="Move step up"
                    onClick={() => moveStep(step.localId, -1)}
                    disabled={i === 0}
                    className="flex h-10 w-10 items-center justify-center rounded-lg text-mist hover:bg-white/10 disabled:opacity-30"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="m18 15-6-6-6 6" /></svg>
                  </button>
                  <button
                    type="button"
                    aria-label="Move step down"
                    onClick={() => moveStep(step.localId, 1)}
                    disabled={i === steps.length - 1}
                    className="flex h-10 w-10 items-center justify-center rounded-lg text-mist hover:bg-white/10 disabled:opacity-30"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="m6 9 6 6 6-6" /></svg>
                  </button>
                  <button
                    type="button"
                    aria-label="Remove step"
                    onClick={() => removeStep(step.localId)}
                    className="flex h-10 w-10 items-center justify-center rounded-lg text-red-300 hover:bg-red-500/10"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Field label="Step type">
                    <Select
                      value={step.kind}
                      onChange={(e) => updateStep(step.localId, { kind: e.target.value })}
                    >
                      {WORKOUT_STEP_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {stepKindLabel(k)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <Field label={`Distance (${distUnit})`}>
                  <TextInput
                    value={step.distance}
                    onChange={(e) => updateStep(step.localId, { distance: e.target.value })}
                    placeholder="0.8"
                    inputMode="decimal"
                  />
                </Field>
                <Field label="Duration" hint="mm:ss">
                  <TextInput
                    value={step.duration}
                    onChange={(e) => updateStep(step.localId, { duration: e.target.value })}
                    placeholder="10:00"
                    autoCapitalize="off"
                    autoCorrect="off"
                  />
                </Field>
                <Field label={`Target pace (min/${distUnit})`} hint="e.g. 3:20">
                  <TextInput
                    value={step.pace}
                    onChange={(e) => updateStep(step.localId, { pace: e.target.value })}
                    placeholder="4:30"
                    inputMode="decimal"
                  />
                </Field>
                <Field label="Target HR (bpm)">
                  <TextInput
                    value={step.hrBpm}
                    onChange={(e) => updateStep(step.localId, { hrBpm: e.target.value })}
                    placeholder="150"
                    inputMode="numeric"
                  />
                </Field>
                <Field label="RPE (1–10)">
                  <TextInput
                    value={step.rpe}
                    onChange={(e) => updateStep(step.localId, { rpe: e.target.value })}
                    placeholder="7"
                    inputMode="numeric"
                  />
                </Field>
                <Field label="Repetitions">
                  <TextInput
                    value={step.repetitions}
                    onChange={(e) => updateStep(step.localId, { repetitions: e.target.value })}
                    placeholder="1"
                    inputMode="numeric"
                  />
                </Field>
                <div className="col-span-2">
                  <Field label="Notes">
                    <TextInput
                      value={step.notes}
                      onChange={(e) => updateStep(step.localId, { notes: e.target.value })}
                      placeholder="Smooth and controlled…"
                      maxLength={500}
                    />
                  </Field>
                </div>
              </div>

              {errs?.distance && (
                <p className="mt-2 text-[13px] font-medium text-red-400">{errs.distance}</p>
              )}
              {errs?.numbers && (
                <p className="mt-1 text-[13px] font-medium text-red-400">{errs.numbers}</p>
              )}
            </Card>
          );
        })}

        <Button
          onClick={() => {
            setFormError(null);
            mutation.mutate();
          }}
          loading={mutation.isPending}
          className="w-full"
        >
          {mode === "create" ? "Save workout" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}

/** Route wrappers so the same builder handles /teams/:id/workouts/new and /workouts/:workoutId/edit. */
export function NewWorkoutPage() {
  return <WorkoutBuilderPage mode="create" />;
}

export function EditWorkoutPage() {
  return <WorkoutBuilderPage mode="edit" />;
}
