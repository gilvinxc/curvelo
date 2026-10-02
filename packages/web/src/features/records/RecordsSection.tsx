import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { STANDARD_RACE_DISTANCES, type PersonalRecordDTO } from "@curvelo/shared";
import { api, ApiError } from "../../lib/api";
import { formatDurationS } from "../../lib/workoutFormat";
import {
  distanceUnitLabel,
  parseDurationInput,
  toMeters,
  useUnits,
} from "../../lib/units";
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

function AddRaceResultDialog({
  open,
  onClose,
  defaults,
}: {
  open: boolean;
  onClose: () => void;
  defaults?: { activityId?: string; racedAt?: string; durationS?: number | null };
}) {
  const queryClient = useQueryClient();
  const [raceName, setRaceName] = useState("");
  const [distanceM, setDistanceM] = useState("5000");
  const [customDistance, setCustomDistance] = useState("");
  const [duration, setDuration] = useState(
    defaults?.durationS ? formatDurationS(defaults.durationS) : "",
  );
  const [racedAt, setRacedAt] = useState(
    (defaults?.racedAt ?? new Date().toISOString()).slice(0, 10),
  );
  const units = useUnits();
  const [splits, setSplits] = useState<Array<{ distance: string; duration: string }>>([]);
  const [finishPlace, setFinishPlace] = useState("");
  const [ageGroupPlace, setAgeGroupPlace] = useState("");
  const [fieldSize, setFieldSize] = useState("");

  const setSplit = (i: number, patch: Partial<{ distance: string; duration: string }>) =>
    setSplits((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const mutation = useMutation({
    mutationFn: () => {
      const parts = duration.split(":").map(Number);
      let durationS = 0;
      if (parts.length === 3) durationS = parts[0] * 3600 + parts[1] * 60 + parts[2];
      else if (parts.length === 2) durationS = parts[0] * 60 + parts[1];
      else durationS = Number(duration) || 0;
      const meters =
        distanceM === "custom" ? Math.round(Number(customDistance) * 1000) : Number(distanceM);
      const parsedSplits = splits
        .map((s) => ({
          distanceM:
            s.distance.trim() === ""
              ? NaN
              : Math.round(toMeters(parseFloat(s.distance), units)),
          durationS:
            s.duration.trim() === "" ? NaN : (parseDurationInput(s.duration) ?? NaN),
        }))
        .filter((s) => Number.isFinite(s.distanceM) && Number.isFinite(s.durationS) && s.distanceM > 0 && s.durationS > 0);
      if (splits.length > 0 && parsedSplits.length < 2) {
        throw new Error("Enter at least two valid splits, or remove them.");
      }
      const fp = finishPlace.trim() === "" ? undefined : parseInt(finishPlace, 10);
      const agp = ageGroupPlace.trim() === "" ? undefined : parseInt(ageGroupPlace, 10);
      const fs = fieldSize.trim() === "" ? undefined : parseInt(fieldSize, 10);
      return api.createRaceResult({
        raceName,
        distanceM: meters,
        durationS,
        racedAt: new Date(`${racedAt}T12:00:00Z`).toISOString(),
        activityId: defaults?.activityId,
        splits: parsedSplits.length >= 2 ? parsedSplits : undefined,
        finishPlace: fp,
        ageGroupPlace: agp,
        fieldSize: fs,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["myRecords"] });
      queryClient.invalidateQueries({ queryKey: ["myRaceResults"] });
      onClose();
      setRaceName("");
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Log a race result">
      <div className="space-y-4">
        {mutation.isError && (
          <ErrorBanner
            message={
              mutation.error instanceof ApiError
                ? mutation.error.message
                : mutation.error instanceof Error
                  ? mutation.error.message
                  : "Couldn't save the race result."
            }
          />
        )}
        <Field label="Race name">
          <TextInput
            value={raceName}
            onChange={(e) => setRaceName(e.target.value)}
            placeholder="Winchester 5K Classic"
            maxLength={120}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Distance">
            <Select value={distanceM} onChange={(e) => setDistanceM(e.target.value)}>
              {STANDARD_RACE_DISTANCES.map((d) => (
                <option key={d.meters} value={String(d.meters)}>
                  {d.label}
                </option>
              ))}
              <option value="custom">Custom…</option>
            </Select>
          </Field>
          {distanceM === "custom" ? (
            <Field label="Custom (km)">
              <TextInput
                value={customDistance}
                onChange={(e) => setCustomDistance(e.target.value)}
                inputMode="decimal"
                placeholder="7.5"
              />
            </Field>
          ) : (
            <Field label="Official time">
              <TextInput
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="24:30 or 1:32:10"
              />
            </Field>
          )}
        </div>
        {distanceM === "custom" && (
          <Field label="Official time">
            <TextInput
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="24:30 or 1:32:10"
            />
          </Field>
        )}
        <Field label="Race date">
          <TextInput type="date" value={racedAt} onChange={(e) => setRacedAt(e.target.value)} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Place">
            <TextInput
              value={finishPlace}
              onChange={(e) => setFinishPlace(e.target.value)}
              inputMode="numeric"
              placeholder="7"
            />
          </Field>
          <Field label="Age group">
            <TextInput
              value={ageGroupPlace}
              onChange={(e) => setAgeGroupPlace(e.target.value)}
              inputMode="numeric"
              placeholder="2"
            />
          </Field>
          <Field label="Field size">
            <TextInput
              value={fieldSize}
              onChange={(e) => setFieldSize(e.target.value)}
              inputMode="numeric"
              placeholder="342"
            />
          </Field>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[13px] font-bold text-mist">Splits (optional)</span>
            <button
              type="button"
              onClick={() => setSplits((prev) => [...prev, { distance: "", duration: "" }])}
              className="text-[13px] font-semibold text-volt-300"
            >
              + Add split
            </button>
          </div>
          {splits.length === 0 ? (
            <p className="text-[12px] text-mist">
              Add per-mile or per-kilometer splits to unlock pacing analysis.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {splits.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-6 shrink-0 text-[12px] font-bold text-mist">{i + 1}</span>
                  <TextInput
                    value={s.distance}
                    onChange={(e) => setSplit(i, { distance: e.target.value })}
                    inputMode="decimal"
                    placeholder={distanceUnitLabel(units)}
                    aria-label={`Split ${i + 1} distance`}
                  />
                  <TextInput
                    value={s.duration}
                    onChange={(e) => setSplit(i, { duration: e.target.value })}
                    placeholder="6:20"
                    aria-label={`Split ${i + 1} time`}
                  />
                  <button
                    type="button"
                    onClick={() => setSplits((prev) => prev.filter((_, j) => j !== i))}
                    className="shrink-0 px-1 text-[13px] font-semibold text-mist hover:text-ink-50"
                    aria-label={`Remove split ${i + 1}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <p className="text-[13px] text-mist">
          Race results use the official course distance and your official chip
          time — no GPS estimates. These power your personal records.
        </p>
        <Button
          className="w-full"
          disabled={mutation.isPending || !raceName.trim() || !duration}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? "Saving…" : "Save race result"}
        </Button>
      </div>
    </Modal>
  );
}

export function PersonalRecordsSection() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const recordsQuery = useQuery({
    queryKey: ["myRecords"],
    queryFn: () => api.myRecords(),
  });
  const records: PersonalRecordDTO[] = recordsQuery.data?.records ?? [];

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[16px] font-extrabold text-ink-50">Personal records</h3>
        <Button onClick={() => setDialogOpen(true)}>+ Race result</Button>
      </div>
      {recordsQuery.isLoading ? (
        <FullScreenLoader />
      ) : recordsQuery.isError ? (
        <ErrorBanner message="Couldn't load your records." />
      ) : records.length === 0 ? (
        <EmptyState
          title="No race results yet"
          body="Log an official race result — exact course distance, exact chip time — and your PRs will live here."
        />
      ) : (
        <ol className="divide-y divide-white/5">
          {records.map((r) => (
            <li key={r.distanceM} className="flex items-center gap-3 py-2.5">
              <span className="w-24 shrink-0 text-[14px] font-bold text-volt-300">
                {r.label}
              </span>
              <span className="flex-1 truncate text-[14px] text-mist">
                {r.raceName} · {new Date(r.racedAt).toLocaleDateString(undefined, { year: "numeric", month: "short" })}
              </span>
              <span className="text-[15px] font-extrabold text-ink-50">
                {formatDurationS(r.durationS)}
              </span>
            </li>
          ))}
        </ol>
      )}
      <AddRaceResultDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </Card>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function RaceAnalysisView({ raceResultId }: { raceResultId: string }) {
  const q = useQuery({
    queryKey: ["raceAnalysis", raceResultId],
    queryFn: () => api.raceAnalysis(raceResultId),
  });
  if (q.isLoading) return <FullScreenLoader />;
  if (q.isError || !q.data)
    return <ErrorBanner message="Couldn't load the race analysis." />;
  const a = q.data.analysis;
  const verdictColor =
    a.pacingVerdict === "negative"
      ? "text-emerald-300"
      : a.pacingVerdict === "positive"
        ? "text-amber-300"
        : a.pacingVerdict === "even"
          ? "text-volt-300"
          : "text-mist";
  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
      <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-mist">
        AI race analysis
      </p>
      <p className="mt-1 text-[14px] text-ink-50">{a.narrative}</p>
      <p className={`mt-2 text-[13px] font-bold ${verdictColor}`}>
        {a.pacingVerdict === "insufficient"
          ? "Pacing: not enough split data"
          : `Pacing: ${a.pacingVerdict} split`}
        {a.fadeOrKick ? ` · ${a.fadeOrKick}` : ""}
      </p>
      {a.highlights.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {a.highlights.map((h, i) => (
            <li key={i} className="text-[13px] text-emerald-300">✓ {h}</li>
          ))}
        </ul>
      )}
      {a.coachingCues.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {a.coachingCues.map((c, i) => (
            <li key={i} className="text-[13px] text-mist">→ {c}</li>
          ))}
        </ul>
      )}
      {a.splits.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.15em] text-mist">
            Splits
          </p>
          <ol className="flex flex-col gap-1">
            {a.splits.map((s) => (
              <li
                key={s.index}
                className="flex items-center justify-between text-[13px]"
              >
                <span className="text-mist">Split {s.index}</span>
                <span className="font-bold text-ink-50">
                  {formatDurationS(s.durationS)}
                </span>
                <span
                  className={
                    s.vsAvgPct > 3
                      ? "text-amber-300"
                      : s.vsAvgPct < -3
                        ? "text-emerald-300"
                        : "text-mist"
                  }
                >
                  {s.vsAvgPct > 0 ? "+" : ""}
                  {s.vsAvgPct.toFixed(0)}%
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

export function RaceHistorySection() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [analysisFor, setAnalysisFor] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["myRaceResults"],
    queryFn: () => api.myRaceResults(),
  });
  const results = q.data?.raceResults ?? [];

  return (
    <Card>
      <h3 className="mb-3 text-[16px] font-extrabold text-ink-50">Race history</h3>
      {q.isLoading ? (
        <FullScreenLoader />
      ) : q.isError ? (
        <ErrorBanner message="Couldn't load your races." />
      ) : results.length === 0 ? (
        <p className="text-[13px] text-mist">
          Your logged races will appear here with splits, places, and AI
          pacing analysis.
        </p>
      ) : (
        <ol className="divide-y divide-white/5">
          {results.map((r) => {
            const label =
              STANDARD_RACE_DISTANCES.find((d) => d.meters === r.distanceM)?.label ??
              `${r.distanceM} m`;
            const isOpen = expanded === r.id;
            return (
              <li key={r.id} className="py-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setExpanded(isOpen ? null : r.id);
                    if (isOpen) setAnalysisFor(null);
                  }}
                  className="flex w-full items-center gap-3 text-left"
                >
                  <span className="w-16 shrink-0 text-[14px] font-bold text-volt-300">
                    {label}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[14px] text-mist">
                    {r.raceName} ·{" "}
                    {new Date(r.racedAt).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                    })}
                    {r.finishPlace != null &&
                      ` · ${ordinal(r.finishPlace)}${r.fieldSize != null ? ` of ${r.fieldSize}` : ""}`}
                  </span>
                  <span className="shrink-0 text-[15px] font-extrabold text-ink-50">
                    {formatDurationS(r.durationS)}
                  </span>
                  <span className="shrink-0 text-mist">{isOpen ? "▾" : "▸"}</span>
                </button>
                {isOpen && (
                  <div className="mt-2 pl-1">
                    {r.splits && r.splits.length > 0 ? (
                      <ol className="flex flex-col gap-1">
                        {r.splits.map((s, i) => (
                          <li
                            key={i}
                            className="flex items-center justify-between text-[13px]"
                          >
                            <span className="text-mist">
                              Split {i + 1} · {(s.distanceM / 1000).toFixed(2)} km
                            </span>
                            <span className="font-bold text-ink-50">
                              {formatDurationS(s.durationS)}
                            </span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="text-[13px] text-mist">
                        No splits logged for this race.
                      </p>
                    )}
                    {analysisFor === r.id ? (
                      <RaceAnalysisView raceResultId={r.id} />
                    ) : (
                      <Button
                        variant="secondary"
                        className="mt-2 min-h-[40px] px-4 text-[13px]"
                        onClick={() => setAnalysisFor(r.id)}
                      >
                        AI race analysis
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

export { AddRaceResultDialog };
