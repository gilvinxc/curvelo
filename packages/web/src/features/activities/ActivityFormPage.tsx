import { useEffect, useMemo, useRef, useState } from "react";
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
  TextInput,
} from "../../components/ui";
import { cn } from "../../components/cx";
import { CityInput } from "../../components/CityInput";
import {
  isoToLocalInput,
  localInputToISO,
  nowLocalInput,
} from "../../lib/activityFormat";
import { formatDurationS, formatYMDCompact } from "../../lib/workoutFormat";
import {
  distanceUnitLabel,
  elevationUnitLabel,
  fromMetersElev,
  toMetersElev,
  formatHeight,
  formatWeight,
  parseHeightInput,
  toCm,
  fromKg,
  fromMeters,
  fromTemp,
  parseDurationInput,
  toKg,
  toTemp,
  toMeters,
  tempUnitLabel,
  useUnits,
  weightUnitLabel,
} from "../../lib/units";
import { estimateCalories, estimateSteps } from "@curvelo/shared";
import { MentionTextarea } from "../../components/MentionTextarea";

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

interface SplitRow {
  distance: string;
  duration: string;
}

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
  steps: string;
  elevation: string;
  cadence: string;
  splits: SplitRow[];
  splitsOpen: boolean;
  city: string;
  cityLat: number | null;
  cityLon: number | null;
  cityVerified: boolean;
  terrain: string;
  weatherTemp: string;
  weatherCondition: string;
  notes: string;
  teamId: string;
  visibility: "TEAM" | "PRIVATE";
  shareToFeed: boolean;
  taggedUserIds: string[];
  shoeId: string | null;
  weight: string;
  height: string;
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
    steps: "",
    elevation: "",
    cadence: "",
    splits: [],
    splitsOpen: false,
    city: "",
    cityLat: null,
    cityLon: null,
    cityVerified: false,
    terrain: "",
    weatherTemp: "",
    weatherCondition: "",
    notes: "",
    teamId: "",
    visibility: "TEAM",
    shareToFeed: false,
    taggedUserIds: [],
    shoeId: null,
    weight: "",
    height: "",
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
  const profileCity = profileQuery.data?.user.profile?.city ?? null;

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

  // Prefill the height from the profile; editing it here updates the profile.
  useEffect(() => {
    if (mode === "new" && profileHeightCm != null) {
      setForm((f) =>
        f.height === ""
          ? { ...f, height: formatHeight(profileHeightCm, units) }
          : f,
      );
    }
  }, [mode, profileHeightCm, units]);

  // Prefill the city from the profile; weather auto-fills from it.
  useEffect(() => {
    if (mode === "new" && profileCity) {
      setForm((f) => (f.city === "" ? { ...f, city: profileCity } : f));
    }
  }, [mode, profileCity]);

  const assignmentId = mode === "new" ? searchParams.get("assignmentId") : null;
  const preWorkoutTitle = searchParams.get("workoutTitle") ?? "";
  const preScheduledDate = searchParams.get("scheduledDate") ?? "";
  const preTeamId = searchParams.get("teamId") ?? "";
  const fromTagId = mode === "new" ? searchParams.get("fromTag") : null;

  const tagQuery = useQuery({
    queryKey: ["activityTag", fromTagId],
    queryFn: () => api.getActivityTag(fromTagId!),
    enabled: mode === "new" && !!fromTagId,
    retry: false,
  });

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
      steps: a.steps != null ? String(a.steps) : "",
      elevation:
        a.elevationGainM != null ? trimNum(fromMetersElev(a.elevationGainM, units)) : "",
      cadence: a.avgCadenceSpm != null ? String(a.avgCadenceSpm) : "",
      splits: (a.splits ?? []).map((sp) => ({
        distance: sp.distanceM != null ? trimNum(fromMeters(sp.distanceM, units)) : "",
        duration: sp.durationS != null ? formatDurationS(sp.durationS) : "",
      })),
      splitsOpen: (a.splits ?? []).length > 0,
      city: a.city ?? "",
      cityLat: a.cityLat ?? null,
      cityLon: a.cityLon ?? null,
      cityVerified: a.cityLat != null && a.cityLon != null,
      terrain: a.terrain ?? "",
      weatherTemp: a.weatherTempC != null ? String(Math.round(fromTemp(a.weatherTempC, units) * 10) / 10) : "",
      weatherCondition: a.weatherCondition ?? "",
      notes: a.notes ?? "",
      teamId: a.teamId ?? "",
      visibility: a.visibility === "PRIVATE" ? "PRIVATE" : "TEAM",
      shareToFeed: false,
      taggedUserIds: [],
      shoeId: a.shoeId ?? null,
      weight: "",
      height: profileHeightCm != null ? formatHeight(profileHeightCm, units) : "",
    });
  }, [detailQuery.data]);

  // Teammate tag: prefill the form from the tagged run. Everything stays
  // editable — saving creates the user's OWN activity and accepts the tag.
  const tagPrefilled = useRef(false);
  useEffect(() => {
    const tag = tagQuery.data?.tag;
    if (mode !== "new" || !tag || tag.status !== "PENDING" || tagPrefilled.current) return;
    tagPrefilled.current = true;
    const pf = tag.prefill;
    setForm((f) => ({
      ...blankForm(),
      weight: f.weight,
      height: f.height,
      title: pf.title ?? "",
      startedAt: isoToLocalInput(pf.startedAt),
      distance: pf.distanceM != null ? trimNum(fromMeters(pf.distanceM, units)) : "",
      duration: pf.durationS != null ? formatDurationS(pf.durationS) : "",
      avgHr: pf.avgHrBpm != null ? String(pf.avgHrBpm) : "",
      maxHr: pf.maxHrBpm != null ? String(pf.maxHrBpm) : "",
      rpeOn: pf.effortRpe != null,
      rpe: pf.effortRpe ?? 7,
      calories: pf.calories != null ? String(pf.calories) : "",
      steps: pf.steps != null ? String(pf.steps) : "",
      elevation:
        pf.elevationGainM != null ? trimNum(fromMetersElev(pf.elevationGainM, units)) : "",
      cadence: pf.avgCadenceSpm != null ? String(pf.avgCadenceSpm) : "",
      city: pf.city ?? "",
      terrain: pf.terrain ?? "",
      notes: pf.notes ?? "",
      teamId: tag.teamId ?? "",
      visibility: "TEAM",
    }));
  }, [mode, tagQuery.data, units]);

  const teamsQuery = useQuery({
    queryKey: ["teams"],
    queryFn: () => api.listTeams(),
  });
  const teams = teamsQuery.data?.teams ?? [];

  // Default the team: last-used team if still a member, else first team.
  // The user can change it or clear it, and adjust visibility after.
  useEffect(() => {
    if (mode !== "new" || teams.length === 0) return;
    setForm((f) => {
      if (f.teamId !== "") return f;
      const last = localStorage.getItem("curvelo.lastTeamId");
      const match = teams.find((t) => t.id === last);
      return { ...f, teamId: match ? match.id : teams[0].id };
    });
  }, [mode, teams]);

  // Roster for the teammate tag picker (new TEAM-visible runs only).
  const tagRosterQuery = useQuery({
    queryKey: ["roster", form.teamId],
    queryFn: () => api.getRoster(form.teamId),
    enabled:
      mode === "new" &&
      !fromTagId &&
      form.teamId !== "" &&
      form.visibility === "TEAM",
  });
  const taggableTeammates =
    tagRosterQuery.data?.roster.filter(
      (m) => m.status === "ACTIVE" && m.userId !== user?.id,
    ) ?? [];
  const toggleTagged = (id: string) =>
    set("taggedUserIds", form.taggedUserIds.includes(id)
      ? form.taggedUserIds.filter((t) => t !== id)
      : [...form.taggedUserIds, id]);

  const declineTagMutation = useMutation({
    mutationFn: () => api.declineActivityTag(fromTagId!),
    onSuccess: () => navigate("/dashboard"),
  });

  const isOwner =
    mode === "new" || detailQuery.data?.activity.userId === user?.id;
  // A coach who logged this run on the athlete's behalf can edit it too.
  const canEdit =
    isOwner || detailQuery.data?.activity.loggedByUserId === user?.id;

  // Live estimates (labeled as such; the athlete's own numbers always win).
  const formHeightCm = useMemo(() => {
    const parsed = parseHeightInput(form.height, units);
    if (parsed !== undefined) return toCm(parsed, units);
    return profileHeightCm;
  }, [form.height, profileHeightCm, units]);

  const estSteps = useMemo(() => {
    const d = parseFloat(form.distance);
    if (form.distance.trim() === "" || Number.isNaN(d) || d <= 0) return null;
    return estimateSteps(Math.round(toMeters(d, units)), formHeightCm, form.kind);
  }, [form.distance, form.kind, formHeightCm, units]);

  const estCalories = useMemo(() => {
    const d = parseFloat(form.distance);
    const durS = parseDurationInput(form.duration);
    const w = parseFloat(form.weight);
    const wKg =
      form.weight.trim() === ""
        ? profileWeightKg
        : Number.isNaN(w) || w <= 0
          ? null
          : toKg(w, units);
    const distanceM =
      form.distance.trim() === "" || Number.isNaN(d) || d <= 0
        ? null
        : Math.round(toMeters(d, units));
    return estimateCalories({
      kind: form.kind,
      distanceM,
      durationS: durS ?? null,
      weightKg: wKg,
    });
  }, [form.distance, form.duration, form.kind, form.weight, profileWeightKg, units]);

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (form.height.trim() !== "") {
      const h = parseHeightInput(form.height, units);
      if (h === undefined || toCm(h, units) < 100 || toCm(h, units) > 250) {
        errs.height =
          units === "metric"
            ? "Enter a height between 100 and 250 cm."
            : "Enter a height like 5'10\".";
      }
    }
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
    const elev = parseFloat(form.elevation);
    if (form.elevation.trim() !== "" && (Number.isNaN(elev) || elev < 0)) {
      errs.elevation = "Elevation gain can't be negative.";
    }
    const cad = parseInt(form.cadence, 10);
    if (form.cadence.trim() !== "" && (Number.isNaN(cad) || cad < 0 || cad > 300)) {
      errs.cadence = "Cadence must be 0–300 spm.";
    }
    form.splits.forEach((row, i) => {
      const d = parseFloat(row.distance);
      const t = parseDurationInput(row.duration);
      const hasD = row.distance.trim() !== "" && !Number.isNaN(d) && d > 0;
      const hasT = row.duration.trim() !== "" && t !== undefined && !Number.isNaN(t);
      if (!hasD && !hasT) {
        errs.splits = `Split ${i + 1} needs a distance or a time.`;
      }
    });
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
      shareToFeed: form.shareToFeed || undefined,
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
      const stp = parseInt(form.steps, 10);
      if (!Number.isNaN(stp) && stp > 0) payload.steps = stp;
      const elevM = parseFloat(form.elevation);
      if (form.elevation.trim() !== "" && !Number.isNaN(elevM) && elevM >= 0)
        payload.elevationGainM = Math.round(toMetersElev(elevM, units) * 10) / 10;
      const cadV = parseInt(form.cadence, 10);
      if (form.cadence.trim() !== "" && !Number.isNaN(cadV) && cadV >= 0 && cadV <= 300)
        payload.avgCadenceSpm = cadV;
      const splitRows = form.splits
        .map((row) => {
          const d = parseFloat(row.distance);
          const t = parseDurationInput(row.duration);
          return {
            distanceM:
              row.distance.trim() !== "" && !Number.isNaN(d) && d > 0
                ? Math.round(toMeters(d, units))
                : undefined,
            durationS:
              row.duration.trim() !== "" && t !== undefined && !Number.isNaN(t)
                ? t
                : undefined,
          };
        })
        .filter((r) => r.distanceM !== undefined || r.durationS !== undefined);
      if (splitRows.length > 0) payload.splits = splitRows;
      if (form.terrain) payload.terrain = form.terrain;
      if (form.city.trim()) {
        payload.city = form.city.trim();
        if (form.cityLat != null && form.cityLon != null) {
          payload.cityLat = form.cityLat;
          payload.cityLon = form.cityLon;
        }
      }
      const wt = parseFloat(form.weatherTemp);
      if (!Number.isNaN(wt)) payload.weatherTempC = Math.round(toTemp(wt, units) * 10) / 10;
      if (form.weatherCondition.trim()) payload.weatherCondition = form.weatherCondition.trim();
      if (form.title.trim()) payload.title = form.title.trim();
      if (form.notes.trim()) payload.notes = form.notes.trim();
      if (form.teamId) payload.teamId = form.teamId;
      payload.shoeId = form.shoeId;
      const wVal = parseFloat(form.weight);
      if (form.weight.trim() !== "" && !Number.isNaN(wVal) && wVal > 0)
        payload.weightKg = toKg(wVal, units);
      if (mode === "new" && assignmentId) payload.assignmentId = assignmentId;
      if (mode === "new" && form.taggedUserIds.length > 0)
        payload.taggedUserIds = form.taggedUserIds;
      if (mode === "new" && fromTagId) payload.fromTagId = fromTagId;

      if (mode === "edit" && id) {
        const res = await api.updateActivity(id, payload);
        return res.activity.id;
      }
      const res = await api.createActivity(payload);
      return res.activity.id;
    },
    onSuccess: (activityId) => {
      if (form.teamId) {
        try {
          localStorage.setItem("curvelo.lastTeamId", form.teamId);
        } catch {
          /* private mode */
        }
      }
      // Sync height to profile if the user changed it here.
      const hCm = formHeightCm;
      if (
        hCm != null &&
        (profileHeightCm == null || Math.abs(hCm - profileHeightCm) > 0.5)
      ) {
        void api
          .updateProfile({ heightCm: Math.round(hCm) })
          .then(() =>
            queryClient.invalidateQueries({ queryKey: ["profile"] }),
          );
      }
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

      {mode === "new" && fromTagId && (
        <Card className="mb-5 border-volt-400/30 bg-volt-400/5">
          {tagQuery.isLoading ? (
            <p className="text-[14px] text-mist">Loading tagged run…</p>
          ) : tagQuery.isError || tagQuery.data?.tag.status !== "PENDING" ? (
            <p className="text-[14px] text-mist">
              This tag is no longer available — the run may have been deleted,
              made private, or already handled.
            </p>
          ) : (
            <>
              <p className="text-[15px] font-bold text-white">
                {tagQuery.data.tag.taggerName} tagged you in their run
              </p>
              <p className="mt-1 text-[14px] text-mist">
                Review the prefilled values below and save to add it to your
                log — your numbers, your call.
              </p>
              <button
                type="button"
                onClick={() => declineTagMutation.mutate()}
                disabled={declineTagMutation.isPending}
                className="mt-3 text-[14px] font-semibold text-mist underline hover:text-white"
              >
                {declineTagMutation.isPending ? "Declining…" : "Not my run — decline"}
              </button>
            </>
          )}
        </Card>
      )}

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

        <Field label="Terrain" hint="Optional">
          <Select value={form.terrain} onChange={(e) => set("terrain", e.target.value)}>
            <option value="">Not specified</option>
            <option value="ROAD">Road</option>
            <option value="TRAIL">Trail</option>
            <option value="TRACK">Track</option>
            <option value="TREADMILL">Treadmill</option>
            <option value="GRASS">Grass</option>
            <option value="OTHER">Other</option>
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

        <Field
          label="Calories"
          hint={
            form.calories.trim() === "" && estCalories != null
              ? `Optional · ~${estCalories.toLocaleString()} estimated`
              : "Optional"
          }
        >
          <TextInput
            type="number"
            inputMode="numeric"
            min="0"
            value={form.calories}
            onChange={(e) => set("calories", e.target.value)}
            placeholder={estCalories != null ? `~${estCalories.toLocaleString()}` : "520"}
          />
        </Field>

        <Field
          label="Steps"
          hint={
            form.steps.trim() === "" && estSteps != null
              ? `Optional · ~${estSteps.toLocaleString()} estimated`
              : "Optional"
          }
        >
          <TextInput
            type="number"
            inputMode="numeric"
            min="0"
            value={form.steps}
            onChange={(e) => set("steps", e.target.value)}
            placeholder={estSteps != null ? `~${estSteps.toLocaleString()}` : "8000"}
          />
        </Field>

        <Field
          label={`Elevation gain (${elevationUnitLabel(units)})`}
          hint="Optional"
          error={errors.elevation}
        >
          <TextInput
            type="number"
            inputMode="decimal"
            min="0"
            value={form.elevation}
            onChange={(e) => set("elevation", e.target.value)}
            placeholder={units === "metric" ? "46" : "150"}
          />
        </Field>

        <Field label="Cadence (spm)" hint="Optional" error={errors.cadence}>
          <TextInput
            type="number"
            inputMode="numeric"
            min="0"
            max="300"
            value={form.cadence}
            onChange={(e) => set("cadence", e.target.value)}
            placeholder="170"
          />
        </Field>

        <div className="rounded-xl border border-white/10 bg-ink-900">
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, splitsOpen: !f.splitsOpen }))}
            aria-expanded={form.splitsOpen}
            className="flex w-full items-center justify-between px-4 py-3 text-left"
          >
            <span className="text-[14px] font-bold text-white">
              Lap splits{" "}
              <span className="font-normal text-mist">
                {form.splits.length > 0 ? `(${form.splits.length})` : "· optional"}
              </span>
            </span>
            <span className="text-mist">{form.splitsOpen ? "▾" : "▸"}</span>
          </button>
          {form.splitsOpen && (
            <div className="flex flex-col gap-2 px-4 pb-4">
              {errors.splits && (
                <p className="text-[13px] font-semibold text-red-400">{errors.splits}</p>
              )}
              {form.splits.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-8 shrink-0 text-[13px] font-bold text-mist">
                    {i + 1}
                  </span>
                  <TextInput
                    type="number"
                    inputMode="decimal"
                    min="0"
                    value={row.distance}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        splits: f.splits.map((r, j) =>
                          j === i ? { ...r, distance: e.target.value } : r,
                        ),
                      }))
                    }
                    placeholder={`Dist (${distanceUnitLabel(units)})`}
                    aria-label={`Split ${i + 1} distance`}
                  />
                  <TextInput
                    value={row.duration}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        splits: f.splits.map((r, j) =>
                          j === i ? { ...r, duration: e.target.value } : r,
                        ),
                      }))
                    }
                    placeholder="Time (m:ss)"
                    aria-label={`Split ${i + 1} time`}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        splits: f.splits.filter((_, j) => j !== i),
                      }))
                    }
                    aria-label={`Remove split ${i + 1}`}
                    className="shrink-0 rounded-full border border-white/10 px-2.5 py-1.5 text-[14px] text-mist hover:border-white/25 hover:text-white"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    splits: [...f.splits, { distance: "", duration: "" }],
                  }))
                }
                className="mt-1 self-start rounded-full border border-volt-400/40 px-4 py-2 text-[13px] font-bold text-volt-300 hover:bg-volt-400/10"
              >
                + Add split
              </button>
            </div>
          )}
        </div>

        <Field
          label="City"
          hint="Pick a verified place for exact weather — or type your own"
        >
          <CityInput
            value={form.city}
            verified={form.cityVerified}
            placeholder="Winchester"
            onChange={(value, place) =>
              setForm((f) => ({
                ...f,
                city: value,
                cityLat: place ? place.lat : null,
                cityLon: place ? place.lon : null,
                cityVerified: place != null,
              }))
            }
          />
        </Field>

        <Field
          label={`Temp (${tempUnitLabel(units)})`}
          hint="Optional — auto-filled from the city, or enter your own"
        >
          <TextInput
            type="number"
            inputMode="decimal"
            value={form.weatherTemp}
            onChange={(e) => set("weatherTemp", e.target.value)}
            placeholder="72"
          />
        </Field>

        <Field label="Conditions" hint="Optional — auto-filled from the city, or enter your own">
          <TextInput
            value={form.weatherCondition}
            onChange={(e) => set("weatherCondition", e.target.value)}
            placeholder="Clear"
            maxLength={40}
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

        {mode === "new" && form.teamId && form.visibility === "TEAM" && (
          <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-ink-900 px-4 py-3">
            <input
              type="checkbox"
              checked={form.shareToFeed}
              onChange={(e) => set("shareToFeed", e.target.checked)}
              className="h-5 w-5 accent-lime-400"
            />
            <span className="text-[15px]">
              <span className="font-semibold">Share to team feed</span>
              <span className="block text-[13px] text-mist">
                Post this activity to the team feed when you save it
              </span>
            </span>
          </label>
        )}

        {mode === "new" && !fromTagId && form.teamId && form.visibility === "TEAM" && (
          <Field
            label="Tag teammates"
            hint="They'll get a nudge to add this run to their own log — nothing is logged for them automatically."
          >
            {tagRosterQuery.isLoading ? (
              <p className="text-[14px] text-mist">Loading teammates…</p>
            ) : taggableTeammates.length === 0 ? (
              <p className="text-[14px] text-mist">No teammates to tag.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {taggableTeammates.map((m) => (
                  <label
                    key={m.userId}
                    className="flex items-center gap-3 rounded-xl border border-white/10 bg-ink-900 px-4 py-2.5"
                  >
                    <input
                      type="checkbox"
                      checked={form.taggedUserIds.includes(m.userId)}
                      onChange={() => toggleTagged(m.userId)}
                      className="h-5 w-5 accent-lime-400"
                    />
                    <span className="text-[15px] font-medium">{m.displayName}</span>
                  </label>
                ))}
              </div>
            )}
          </Field>
        )}

        {(mode === "new" || isOwner) && (
          <ShoePicker value={form.shoeId} onChange={(v) => set("shoeId", v)} applyDefault={mode === "new"} />
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field
            label={`Height (${units === "metric" ? "cm" : "ft/in"})`}
            error={errors.height}
            hint="Updates your profile"
          >
            <TextInput
              value={form.height}
              onChange={(e) => set("height", e.target.value)}
              placeholder={
                profileHeightCm != null
                  ? formatHeight(profileHeightCm, units)
                  : units === "metric"
                    ? "178"
                    : "5'10\""
              }
              inputMode="text"
            />
          </Field>
          <Field
            label={`Weight (${weightUnitLabel(units)})`}
            error={errors.weight}
            hint="Updates your profile"
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
        </div>

        <Field label="Notes" hint="Optional — how it felt, conditions, etc.">
          <MentionTextarea
            teamId={form.teamId}
            value={form.notes}
            maxLength={2000}
            onChange={(v) => set("notes", v)}
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
