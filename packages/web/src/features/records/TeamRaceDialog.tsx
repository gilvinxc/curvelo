import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { STANDARD_RACE_DISTANCES } from "@curvelo/shared";
import { api, ApiError } from "../../lib/api";
import { Modal, Button, ErrorBanner } from "../../components/ui";
import { parseDurationInput } from "../../lib/units";
import { AwardDialog } from "./AwardsSection";

function todayInput(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Coach bulk race entry: official results for many athletes in one race. */
export function TeamRaceDialog({
  teamId,
  open,
  onClose,
}: {
  teamId: string;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [raceName, setRaceName] = useState("");
  const [distanceM, setDistanceM] = useState("5000");
  const [racedAt, setRacedAt] = useState(todayInput());
  const [fieldSize, setFieldSize] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  // After saving: athletes with a podium finish get an award suggestion.
  const [podiums, setPodiums] = useState<
    Array<{ userId: string; displayName: string; place: number }> | null
  >(null);
  const [awardFor, setAwardFor] = useState<{
    userId: string;
    displayName: string;
    place: number;
  } | null>(null);
  // Per-athlete: time is required, place optional.
  const [rows, setRows] = useState<Record<string, { time: string; place: string }>>({});

  const rosterQuery = useQuery({
    queryKey: ["teamRoster", teamId],
    queryFn: () => api.getRoster(teamId),
    enabled: open,
  });

  const runners = useMemo(() => {
    const roster = rosterQuery.data?.roster ?? [];
    return roster.filter((m) => m.role === "RUNNER" && m.status === "ACTIVE");
  }, [rosterQuery.data]);

  useEffect(() => {
    if (open) {
      setSelected(runners.map((r) => r.userId));
      setRows({});
    }
  }, [open, runners.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const setRow = (userId: string, patch: Partial<{ time: string; place: string }>) =>
    setRows((prev) => {
      const existing = prev[userId] ?? { time: "", place: "" };
      return { ...prev, [userId]: { ...existing, ...patch } };
    });

  const toggle = (userId: string) =>
    setSelected((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );

  const mutation = useMutation({
    mutationFn: () => {
      const meters = Number(distanceM);
      const fs = fieldSize.trim() === "" ? undefined : parseInt(fieldSize, 10);
      const entries: Array<{
        userId: string;
        durationS: number;
        finishPlace?: number;
      }> = [];
      for (const userId of selected) {
        const row = rows[userId];
        const durationS =
          row?.time.trim() === "" ? undefined : parseDurationInput(row.time);
        if (durationS === undefined || !(durationS > 0)) {
          throw new Error("Every selected athlete needs a valid time.");
        }
        const place =
          row?.place.trim() === "" || !row ? undefined : parseInt(row.place, 10);
        if (place !== undefined && !(place > 0)) {
          throw new Error("Places must be positive numbers.");
        }
        entries.push({ userId, durationS, finishPlace: place });
      }
      return api.logTeamRace({
        teamId,
        raceName: raceName.trim(),
        distanceM: meters,
        racedAt: new Date(`${racedAt}T12:00:00Z`).toISOString(),
        fieldSize: fs,
        entries,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teamRecords", teamId] });
      const nameById = new Map(runners.map((r) => [r.userId, r.displayName]));
      const podium = selected
        .map((userId) => {
          const place = parseInt(rows[userId]?.place ?? "", 10);
          return { userId, place };
        })
        .filter((e) => e.place >= 1 && e.place <= 3)
        .map((e) => ({
          userId: e.userId,
          displayName: nameById.get(e.userId) ?? "Runner",
          place: e.place,
        }));
      if (podium.length > 0) {
        setPodiums(podium);
      } else {
        onClose();
      }
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Log race results">
      <div className="flex flex-col gap-4">
        {mutation.isError && (
          <ErrorBanner
            message={
              mutation.error instanceof ApiError
                ? mutation.error.message
                : mutation.error instanceof Error
                  ? mutation.error.message
                  : "Couldn't save the race results."
            }
          />
        )}

        <div>
          <label className="mb-1 block text-[13px] font-bold text-mist">Race name</label>
          <input
            value={raceName}
            onChange={(e) => setRaceName(e.target.value)}
            placeholder="Winchester 5K Classic"
            maxLength={120}
            className="min-h-[48px] w-full rounded-xl border border-white/15 bg-ink-900 px-3 text-[15px] text-ink-50"
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="mb-1 block text-[13px] font-bold text-mist">Distance</label>
            <select
              value={distanceM}
              onChange={(e) => setDistanceM(e.target.value)}
              className="min-h-[48px] w-full rounded-xl border border-white/15 bg-ink-900 px-3 text-[15px] text-ink-50"
            >
              {STANDARD_RACE_DISTANCES.map((d) => (
                <option key={d.meters} value={String(d.meters)}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[13px] font-bold text-mist">Date</label>
            <input
              type="date"
              value={racedAt}
              onChange={(e) => setRacedAt(e.target.value)}
              className="min-h-[48px] w-full rounded-xl border border-white/15 bg-ink-900 px-3 text-[15px] text-ink-50"
            />
          </div>
          <div>
            <label className="mb-1 block text-[13px] font-bold text-mist">Field size</label>
            <input
              value={fieldSize}
              onChange={(e) => setFieldSize(e.target.value)}
              inputMode="numeric"
              placeholder="342"
              className="min-h-[48px] w-full rounded-xl border border-white/15 bg-ink-900 px-3 text-[15px] text-ink-50"
            />
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-[13px] font-bold text-mist">
              Athletes ({selected.length} of {runners.length})
            </label>
            <button
              type="button"
              className="text-[13px] font-semibold text-volt-300"
              onClick={() =>
                setSelected(
                  selected.length === runners.length ? [] : runners.map((r) => r.userId),
                )
              }
            >
              {selected.length === runners.length ? "Uncheck all" : "Check all"}
            </button>
          </div>
          <p className="mb-2 text-[12px] text-mist">
            Enter each athlete's official chip time and place.
          </p>
          <div className="max-h-64 overflow-y-auto rounded-xl border border-white/10">
            {runners.map((r) => {
              const row = rows[r.userId] ?? { time: "", place: "" };
              const isSel = selected.includes(r.userId);
              return (
                <div
                  key={r.userId}
                  className={`flex items-center gap-2 border-b border-white/5 px-3 py-2 last:border-0 ${isSel ? "" : "opacity-50"}`}
                >
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => toggle(r.userId)}
                    className="h-5 w-5 shrink-0 accent-lime-400"
                    aria-label={`Include ${r.displayName}`}
                  />
                  <span className="min-w-0 flex-1 truncate text-[14px] text-ink-50">
                    {r.displayName}
                  </span>
                  <input
                    value={row.time}
                    onChange={(e) => setRow(r.userId, { time: e.target.value })}
                    placeholder="24:30"
                    disabled={!isSel}
                    aria-label={`Time for ${r.displayName}`}
                    className="w-24 shrink-0 rounded-lg border border-white/15 bg-ink-900 px-2 py-1.5 text-[13px] text-ink-50 placeholder:text-mist/60"
                  />
                  <input
                    value={row.place}
                    onChange={(e) => setRow(r.userId, { place: e.target.value })}
                    inputMode="numeric"
                    placeholder="place"
                    disabled={!isSel}
                    aria-label={`Place for ${r.displayName}`}
                    className="w-16 shrink-0 rounded-lg border border-white/15 bg-ink-900 px-2 py-1.5 text-[13px] text-ink-50 placeholder:text-mist/60"
                  />
                </div>
              );
            })}
            {runners.length === 0 && (
              <p className="px-3 py-4 text-[13px] text-mist">
                No runners on this team yet.
              </p>
            )}
          </div>
        </div>

        <p className="text-[12px] text-mist">
          Official course distance and chip times only — these power personal
          and team records.
        </p>

        <Button
          onClick={() => mutation.mutate()}
          disabled={
            mutation.isPending || !raceName.trim() || selected.length === 0
          }
        >
          {mutation.isPending
            ? "Saving…"
            : `Save results for ${selected.length} athlete${selected.length === 1 ? "" : "s"}`}
        </Button>
      </div>
      {podiums && (
        <Modal
          open
          onClose={() => {
            setPodiums(null);
            onClose();
          }}
          title="🏆 Podium finishes!"
        >
          <div className="flex flex-col gap-3">
            <p className="text-[14px] text-mist">
              These athletes placed top 3. Add an award to their shelf?
            </p>
            {podiums.map((pd) => (
              <div
                key={pd.userId}
                className="flex items-center gap-3 rounded-2xl border border-white/10 bg-ink-900 px-4 py-3"
              >
                <span className="text-xl">
                  {pd.place === 1 ? "🥇" : pd.place === 2 ? "🥈" : "🥉"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-bold">{pd.displayName}</p>
                  <p className="text-[13px] text-mist">
                    #{pd.place} · {raceName.trim()}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  className="min-h-[44px] px-3 text-[13px]"
                  onClick={() => setAwardFor(pd)}
                >
                  Add award
                </Button>
              </div>
            ))}
            <Button
              variant="secondary"
              className="mt-2 min-h-[48px]"
              onClick={() => {
                setPodiums(null);
                onClose();
              }}
            >
              Done
            </Button>
          </div>
          {awardFor && (
            <AwardDialog
              teamId={teamId}
              athleteId={awardFor.userId}
              athleteName={awardFor.displayName}
              prefill={{
                type: "MEDAL",
                place: awardFor.place,
                eventName: raceName.trim(),
                eventDate: racedAt,
              }}
              open
              onClose={() => {
                setAwardFor(null);
                // Remove from the suggestion list once awarded.
                setPodiums((prev) =>
                  prev ? prev.filter((x) => x.userId !== awardFor.userId) : prev,
                );
              }}
            />
          )}
        </Modal>
      )}
    </Modal>
  );
}
