import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type CreateActivityPayload } from "../../lib/api";
import { ShoePicker } from "../records/ShoesSection";
import { useAuth } from "../../lib/auth";
import {
  Button,
  Card,
  ErrorBanner,
  Field,
  FullScreenLoader,
  PageHeader,
  SegmentedControl,
  Select,
  TextArea,
  TextInput,
} from "../../components/ui";
import { cn } from "../../components/cx";
import {
  isoToLocalInput,
  localInputToISO,
  nowLocalInput,
} from "../../lib/activityFormat";
import { formatDurationS, formatYMDCompact } from "../../lib/workoutFormat";
import {
  distanceUnitLabel,
  formatHeight,
  formatWeight,
  fromKg,
  fromMeters,
  parseDurationInput,
  toKg,
  toMeters,
  useUnits,
  weightUnitLabel,
} from "../../lib/units";

const ACTIVITY_KINDS = [
  "RUN",
  "WALK",
  "CROSS_TRAINING",
  "STRENGTH",
  "REST_DAY",
  "OTHER",
] as const;

const KIND_LABELS: Record<string, string> = {
  RUN: "Run",
  WALK: "Walk",
  CROSS_TRAINING: "Cross training",
  STRENGTH: "Strength",
  REST_DAY: "Rest day",
  OTHER: "Other",
};

interface FormState {
  kind: string;
  title: string;
  startedAt: string; // datetime-local
  distance: string;
  duration: string;
  avgHr: string;
  maxHr: string;
  rpeOn: boolean;
  rpe: number;
  calories: string;
  notes: string;
  teamId: string;
  visibility: "TEAM" | "PRIVATE";
  shoeId: string | null;
  weight: string;
}

// Format a number for an input: up to 2 decimals, no trailing zeros.
function trimNum(n: number): string {
  return String(parseFloat(n.toFixed(2)));
}

function blankForm(): FormState {  return {
    kind: "RUN",
    title: "",
    startedAt: nowLocalInput(),
    distance: "",
    duration: "",
    avgHr: "",
    maxHr: "",
    rpeOn: false,
    rpe: 7,
    calories: "",
    notes: "",
    teamId: "",
    visibility: "TEAM",
    shoeId: null,
    weight: "",
  };
}

export function NewActivityPage() {
  return <ActivityForm mode="new" />;
}

export function EditActivityPage() {
  return <ActivityForm mode="edit" />;
}

function ActivityForm({ mode }: { mode: "new" | "edit" }) {
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const units = useUnits();
  const distUnit = distanceUnitLabel(units);

  const profileQuery = useQuery({
    queryKey: ["profile"],
    queryFn: () => api.getProfile(),
  });
  const profileHeightCm = profileQuery.data?.user.profile?.heightCm ?? null;
  const profileWeightKg = profileQuery.data?.user.profile?.weightKg ?? null;

  // Prefill the weight from the profile; editing it here updates the profile.
  useEffect(() => {
    if (mode === "new" && profileWeightKg != null) {
      setForm((f) =>
        f.weight === ""
          ? { ...f, weight: trimNum(fromKg(profileWeightKg, units)) }
          : f,
      );
    }
  }, [mode, profileWeightKg, units]);

  const assignmentId = mode === "new" ? searchParams.get("assignmentId") : null;
  const preWorkoutTitle = searchParams.get("workoutTitle") ?? "";
  const preScheduledDate = searchParams.get("scheduledDate") ?? "";
  const preTeamId = searchParams.get("teamId") ?? "";

  const [form, setForm] = useState<FormState>(() => {
    const f = blankForm();
    if (mode === "new") {
      if (preWorkoutTitle) f.title = preWorkoutTitle;
      if (preTeamId) f.teamId = preTeamId;
      if (preScheduledDate) {
        // Keep the scheduled date, use the current time of day.
        const time = f.startedAt.slice(11);
        f.startedAt = `${preScheduledDate}T${time}`;
      }
    }
    return f;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Edit mode: load the existing activity and prefill.
  const detailQuery = useQuery({
    queryKey: ["activity", id],
    queryFn: () => api.getActivity(id!),
    enabled: mode === "edit" && !!id,
  });

  useEffect(() => {
    const a = detailQuery.data?.activity;
    if (!a) return;
    setForm({
      kind: a.kind,
      title: a.title ?? "",
      startedAt: isoToLocalInput(a.startedAt),
      distance: a.distanceM != null ? trimNum(fromMeters(a.distanceM, units)) : "",
      duration: a.durationS != null ? formatDurationS(a.durationS) : "",
      avgHr: a.avgHrBpm != null ? String(a.avgHrBpm) : "",
      maxHr: a.maxHrBpm != null ? String(a.maxHrBpm) : "",
      rpeOn: a.effortRpe != null,
      rpe: a.effortRpe ?? 7,
      calories: a.calories != null ? String(a.calories) : "",
      notes: a.notes ?? "",
      teamId: a.teamId ?? "",
      visibility: a.visibility === "PRIVATE" ? "PRIVATE" : "TEAM",
      shoeId: a.shoeId ?? null,
      weight: "",
    });
  }, [detailQuery.data]);

  const teamsQuery = useQuery({
    queryKey: ["teams"],
    queryFn: () => api.listTeams(),
  });
  const teams = teamsQuery.data?.teams ?? [];

  const isOwner =
    mode === "new" || detailQuery.data?.activity.userId === user?.id;
  // A coach who logged this run on the athlete's behalf can edit it too.
  const canEdit =
    isOwner || detailQuery.data?.activity.loggedByUserId === user?.id;

  function validate(): boolean {
    const errs: Record<string, string> = {};
    const dist = parseFloat(form.distance);
    const durS = parseDurationInput(form.duration);
    if (
      (form.distance.trim() === "" || Number.isNaN(dist) || dist <= 0) &&
      (durS === undefined || Number.isNaN(durS))
    ) {
      errs.metrics = "Log at least a distance or a duration";
    }
    if (form.duration.trim() !== "" && Number.isNaN(durS)) {
      errs.duration = "Use mm:ss, e.g. 45:30";
    }
    const started = new Date(form.startedAt).getTime();
    if (Number.isNaN(started)) {
      errs.startedAt = "Pick a valid date and time";
    } else if (started > Date.now() + 5 * 60 * 1000) {
      errs.startedAt = "Cannot log an activity in the future";
    }
    const avg = parseInt(form.avgHr, 10);
    const max = parseInt(form.maxHr, 10);
    if (!Number.isNaN(avg) && !Number.isNaN(max) && max < avg) {
      errs.hr = "Max HR must be at least average HR";
    }
    if (form.weight.trim() !== "") {
      const w = parseFloat(form.weight);
      const wKg = Number.isNaN(w) ? NaN : toKg(w, units);
      if (Number.isNaN(wKg) || wKg < 25 || wKg > 350) {
        errs.weight = `Enter a sane weight (${Math.round(fromKg(25, units))}–${Math.round(fromKg(350, units))} ${weightUnitLabel(units)})`;
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: CreateActivityPayload = {
        kind: form.kind,
        startedAt: localInputToISO(form.startedAt),
        visibility: form.visibility,
      };
      const dist = parseFloat(form.distance);
      if (form.distance.trim() !== "" && !Number.isNaN(dist) && dist > 0)
        payload.distanceM = Math.round(toMeters(dist, units));
      const durSubmit = parseDurationInput(form.duration);
      if (durSubmit !== undefined && !Number.isNaN(durSubmit))
        payload.durationS = durSubmit;
      const avg = parseInt(form.avgHr, 10);
      if (!Number.isNaN(avg) && avg > 0) payload.avgHrBpm = avg;
      const max = parseInt(form.maxHr, 10);
      if (!Number.isNaN(max) && max > 0) payload.maxHrBpm = max;
      if (form.rpeOn) payload.effortRpe = form.rpe;
      const cal = parseInt(form.calories, 10);
      if (!Number.isNaN(cal) && cal > 0) payload.calories = cal;
      if (form.title.trim()) payload.title = form.title.trim();
      if (form.notes.trim()) payload.notes = form.notes.trim();
      if (form.teamId) payload.teamId = form.teamId;
      payload.shoeId = form.shoeId;
      const wVal = parseFloat(form.weight);
      if (form.weight.trim() !== "" && !Number.isNaN(wVal) && wVal > 0)
        payload.weightKg = toKg(wVal, units);
      if (mode === "new" && assignmentId) payload.assignmentId = assignmentId;

      if (mode === "edit" && id) {
        const res = await api.updateActivity(id, payload);
        return res.activity.id;
      }
      const res = await api.createActivity(payload);
      return res.activity.id;
    },
    onSuccess: (activityId) => {
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      queryClient.invalidateQueries({ queryKey: ["myStats"] });
      queryClient.invalidateQueries({ queryKey: ["teamCalendar"] });
      queryClient.invalidateQueries({ queryKey: ["myCalendar"] });
      queryClient.invalidateQueries({ queryKey: ["activity", id] });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      navigate(`/activities/${activityId}`);
    },
    onError: (err) => {
      setSubmitError(
        err instanceof ApiError ? err.message : "Couldn't save this activity.",
      );
    },
  });

  const pageTitle = useMemo(
    () => (mode === "new" ? "Log activity" : "Edit activity"),
    [mode],
  );

  if (mode === "edit" && detailQuery.isLoading) return <FullScreenLoader />;
  if (mode === "edit" && (detailQuery.isError || !detailQuery.data)) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Edit activity" backTo="/dashboard" />
        <ErrorBanner message="Couldn't load this activity." />
      </div>
    );
  }
  if (mode === "edit" && !canEdit) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Edit activity" backTo="/dashboard" />
        <ErrorBanner message="You can't edit this activity." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={pageTitle}
        subtitle={
          mode === "new" && preWorkoutTitle
            ? `Completing “${preWorkoutTitle}”`
            : undefined
        }
        backTo={mode === "new" ? "/dashboard" : `/activities/${id}`}
      />

      {mode === "new" && preWorkoutTitle && preScheduledDate && (
        <Card className="mb-5 border-volt-400/30 bg-volt-400/5">
          <p className="text-[14px] text-mist">
            Linked workout
          </p>
          <p className="mt-1 text-[16px] font-extrabold">
            {preWorkoutTitle}
            <span className="ml-2 text-[13px] font-semibold text-mist">
              {formatYMDCompact(preScheduledDate)}
            </span>
          </p>
        </Card>
      )}

      {submitError && (
        <div className="mb-4">
          <ErrorBanner message={submitError} />
        </div>
      )}

      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitError(null);
          if (validate()) mutation.mutate();
        }}
        noValidate
      >
        <Field label="Activity type">
          <Select
            value={form.kind}
            onChange={(e) => set("kind", e.target.value)}
          >
            {ACTIVITY_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Title" hint="Optional — e.g. “Morning easy run”">
          <TextInput
            value={form.title}
            maxLength={120}
            onChange={(e) => set("title", e.target.value)}
            placeholder="Morning easy run"
          />
        </Field>

        <Field label="Date & time" error={errors.startedAt}>
          <TextInput
            type="datetime-local"
            value={form.startedAt}
            max={nowLocalInput()}
            onChange={(e) => set("startedAt", e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label={`Distance (${distUnit})`}>
            <TextInput
              type="number"
              inputMode="decimal"
              min="0"
              step="0.1"
              value={form.distance}
              onChange={(e) => set("distance", e.target.value)}
              placeholder="8.0"
            />
          </Field>
          <Field label="Duration" hint="mm:ss" error={errors.duration}>
            <TextInput
              value={form.duration}
              onChange={(e) => set("duration", e.target.value)}
              placeholder="45:30"
              inputMode="text"
              autoCapitalize="off"
              autoCorrect="off"
            />
          </Field>
        </div>
        {errors.metrics && (
          <p className="-mt-3 text-[13px] font-medium text-red-400">
            {errors.metrics}
          </p>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Avg HR (bpm)">
            <TextInput
              type="number"
              inputMode="numeric"
              min="0"
              max="250"
              value={form.avgHr}
              onChange={(e) => set("avgHr", e.target.value)}
              placeholder="145"
            />
          </Field>
          <Field label="Max HR (bpm)" error={errors.hr}>
            <TextInput
              type="number"
              inputMode="numeric"
              min="0"
              max="250"
              value={form.maxHr}
              onChange={(e) => set("maxHr", e.target.value)}
              placeholder="172"
            />
          </Field>
        </div>

        <Field label="Effort (RPE 1–10)">
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={form.rpeOn}
              onClick={() => set("rpeOn", !form.rpeOn)}
              className={cn(
                "relative h-8 w-14 shrink-0 rounded-full transition",
                form.rpeOn ? "bg-volt-400" : "bg-white/10",
              )}
            >
              <span
                className={cn(
                  "absolute top-1 h-6 w-6 rounded-full bg-white transition-all",
                  form.rpeOn ? "left-7" : "left-1",
                )}
              />
            </button>
            {form.rpeOn ? (
              <input
                type="range"
                min={1}
                max={10}
                step={1}
                value={form.rpe}
                onChange={(e) => set("rpe", Number(e.target.value))}
                className="w-full accent-[#c8f542]"
                aria-label="Effort rating 1 to 10"
              />
            ) : (
              <span className="text-[14px] text-mist">Not rated</span>
            )}
            {form.rpeOn && (
              <span className="w-8 shrink-0 text-center text-[16px] font-extrabold text-volt-300">
                {form.rpe}
              </span>
            )}
          </div>
        </Field>

        <Field label="Calories" hint="Optional">
          <TextInput
            type="number"
            inputMode="numeric"
            min="0"
            value={form.calories}
            onChange={(e) => set("calories", e.target.value)}
            placeholder="520"
          />
        </Field>

        <Field label="Team" hint="Optional — tag the team this run was for">
          <Select
            value={form.teamId}
            onChange={(e) => set("teamId", e.target.value)}
          >
            <option value="">No team</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Who can see this?">
          <SegmentedControl<"TEAM" | "PRIVATE">
            ariaLabel="Activity visibility"
            value={form.visibility}
            onChange={(v) => set("visibility", v)}
            options={[
              { value: "TEAM", label: "Team" },
              { value: "PRIVATE", label: "Private" },
            ]}
          />
        </Field>

        {(mode === "new" || isOwner) && (
          <ShoePicker value={form.shoeId} onChange={(v) => set("shoeId", v)} applyDefault={mode === "new"} />
        )}

        <Field
          label={`Weight (${weightUnitLabel(units)})`}
          error={errors.weight}
          hint={
            profileHeightCm != null
              ? `Height ${formatHeight(profileHeightCm, units)} · updating weight here updates your profile`
              : "Updating weight here updates your profile"
          }
        >
          <TextInput
            value={form.weight}
            onChange={(e) => set("weight", e.target.value)}
            placeholder={
              profileWeightKg != null
                ? formatWeight(profileWeightKg, units)
                : units === "metric"
                  ? "70"
                  : "154"
            }
            inputMode="decimal"
          />
        </Field>

        <Field label="Notes" hint="Optional — how it felt, conditions, etc.">
          <TextArea
            value={form.notes}
            maxLength={2000}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Felt strong on the hills…"
          />
        </Field>

        <Button type="submit" loading={mutation.isPending} className="w-full">
          {mode === "new" ? "Save activity" : "Save changes"}
        </Button>
      </form>
    </div>
  );
}
