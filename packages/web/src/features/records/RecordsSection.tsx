import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { STANDARD_RACE_DISTANCES, type PersonalRecordDTO } from "@curvelo/shared";
import { api, ApiError } from "../../lib/api";
import { formatDurationS } from "../../lib/workoutFormat";
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

  const mutation = useMutation({
    mutationFn: () => {
      const parts = duration.split(":").map(Number);
      let durationS = 0;
      if (parts.length === 3) durationS = parts[0] * 3600 + parts[1] * 60 + parts[2];
      else if (parts.length === 2) durationS = parts[0] * 60 + parts[1];
      else durationS = Number(duration) || 0;
      const meters =
        distanceM === "custom" ? Math.round(Number(customDistance) * 1000) : Number(distanceM);
      return api.createRaceResult({
        raceName,
        distanceM: meters,
        durationS,
        racedAt: new Date(`${racedAt}T12:00:00Z`).toISOString(),
        activityId: defaults?.activityId,
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

export { AddRaceResultDialog };
